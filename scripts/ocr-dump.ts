import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { createWorker, PSM } from 'tesseract.js'

async function prepareReceiptPhoto(buffer: Buffer): Promise<Buffer> {
  const oriented = sharp(buffer, { failOn: 'none' }).rotate()
  const { data, info } = await oriented.clone().grayscale().raw().toBuffer({ resolveWithObject: true })
  const width = info.width
  const height = info.height
  const bright = 188
  const rowCount = new Uint32Array(height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) if (data[row + x] >= bright) rowCount[y]++
  }
  const rowMin = Math.floor(width * 0.22)
  let top = 0
  let bottom = height - 1
  while (top < bottom && rowCount[top] < rowMin) top++
  while (bottom > top && rowCount[bottom] < rowMin) bottom--
  const paperH = Math.max(1, bottom - top + 1)
  const colCount = new Uint32Array(width)
  for (let y = top; y <= bottom; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) if (data[row + x] >= bright) colCount[x]++
  }
  const colMin = paperH * 0.45
  let left = 0
  let right = width - 1
  while (left < right && colCount[left] < colMin) left++
  while (right > left && colCount[right] < colMin) right--
  const pad = 16
  left = Math.max(0, left - pad)
  top = Math.max(0, top - pad)
  right = Math.min(width - 1, right + pad)
  bottom = Math.min(height - 1, bottom + pad)
  const cropW = right - left + 1
  const cropH = bottom - top + 1
  const scale = Math.min(2.6, 4800 / cropH)
  const target = Math.round(cropW * Math.max(scale, 1.6))
  console.log('crop', { width, height, left, top, cropW, cropH, target })
  return oriented.clone()
    .extract({ left, top, width: cropW, height: cropH })
    .grayscale()
    .resize({ width: target, kernel: 'lanczos3' })
    .normalize()
    .sharpen({ sigma: 0.8 })
    .extend({ top: 30, bottom: 30, left: 30, right: 30, background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer()
}

const worker = await createWorker('deu', 1, {
  langPath: path.resolve('ocr'),
  cachePath: path.resolve('data/tess'),
  gzip: true,
})
await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, user_defined_dpi: '300' })

for (const file of process.argv.slice(2)) {
  const prepared = await prepareReceiptPhoto(await readFile(file))
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, user_defined_dpi: '300' })
  const plain = await worker.recognize(prepared)
  const binary = await sharp(prepared).grayscale().normalize().threshold(200).png().toBuffer()
  const meta = await sharp(binary).metadata()
  const width = meta.width || 1
  const height = meta.height || 1
  const slice = Math.ceil(height / 3)
  const parts: string[] = []
  for (let index = 0; index < 3; index++) {
    const top = Math.max(0, index * slice - 30)
    const clip = await sharp(binary).extract({ left: 0, top, width, height: Math.min(slice + 60, height - top) }).png().toBuffer()
    parts.push((await worker.recognize(clip)).data.text.trim())
  }
  console.log(`\n==== ${path.basename(file)} plain ${plain.data.confidence} ====\n`)
  console.log(plain.data.text)
  console.log(`\n==== ${path.basename(file)} slices ====\n`)
  console.log(parts.join('\n'))
}
await worker.terminate()
