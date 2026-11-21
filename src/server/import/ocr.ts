import path from 'node:path'
import sharp from 'sharp'
import { createWorker, PSM, type Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null

async function engine(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker('deu', 1, {
      langPath: path.resolve('ocr'),
      cachePath: path.resolve('data/tess'),
      gzip: true,
    }).then(async (created) => {
      await created.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, user_defined_dpi: '300' })
      return created
    }).catch((error) => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

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
  const paperHeight = Math.max(1, bottom - top + 1)
  const colCount = new Uint32Array(width)
  for (let y = top; y <= bottom; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) if (data[row + x] >= bright) colCount[x]++
  }
  const colMin = paperHeight * 0.45
  let left = 0
  let right = width - 1
  while (left < right && colCount[left] < colMin) left++
  while (right > left && colCount[right] < colMin) right--
  if (right - left < 40 || bottom - top < 40) {
    left = 0
    top = 0
    right = width - 1
    bottom = height - 1
  }
  const pad = 16
  left = Math.max(0, left - pad)
  top = Math.max(0, top - pad)
  right = Math.min(width - 1, right + pad)
  bottom = Math.min(height - 1, bottom + pad)
  const cropWidth = right - left + 1
  const cropHeight = bottom - top + 1
  const scale = Math.min(2.6, 4800 / cropHeight)
  const target = Math.round(cropWidth * Math.max(scale, 1.6))
  return oriented.clone()
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .grayscale()
    .resize({ width: target, kernel: 'lanczos3' })
    .normalize()
    .sharpen({ sigma: 0.8 })
    .extend({ top: 30, bottom: 30, left: 30, right: 30, background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer()
}

function joinSlices(parts: string[]): string {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const part of parts) {
    for (const line of part.split('\n')) {
      const cleaned = line.trim()
      if (!cleaned) continue
      const key = cleaned.toLowerCase().replace(/[^a-z0-9äöü.,+-]/g, '')
      if (!key || seen.has(key)) continue
      seen.add(key)
      lines.push(cleaned)
    }
  }
  return lines.join('\n')
}

export async function readReceiptPhoto(buffer: Buffer): Promise<string> {
  const prepared = await prepareReceiptPhoto(buffer)
  const binary = await sharp(prepared).threshold(200).png().toBuffer()
  const meta = await sharp(binary).metadata()
  const width = meta.width || 1
  const height = meta.height || 1
  const slice = Math.ceil(height / 3)
  const reader = await engine()
  const parts: string[] = []
  for (let index = 0; index < 3; index++) {
    const top = Math.max(0, index * slice - 40)
    const clip = await sharp(binary).extract({
      left: 0,
      top,
      width,
      height: Math.min(slice + 80, height - top),
    }).png().toBuffer()
    const page = await reader.recognize(clip)
    parts.push(page.data.text || '')
  }
  return joinSlices(parts)
}
