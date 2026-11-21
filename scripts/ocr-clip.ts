import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { createWorker, PSM } from 'tesseract.js'

const buffer = await readFile(process.argv[2])
const meta = await sharp(buffer).metadata()
const width = meta.width || 1
const height = meta.height || 1
const worker = await createWorker('deu', 1, {
  langPath: path.resolve('ocr'),
  cachePath: path.resolve('data/tess'),
  gzip: true,
})
await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, user_defined_dpi: '300' })
const top = Math.round(height * 0.16)
const band = Math.round(height * 0.22)
for (const threshold of [0, 150, 180, 200]) {
  let image = sharp(buffer).extract({ left: 0, top, width, height: band }).grayscale().normalize()
  if (threshold) image = image.threshold(threshold)
  const clip = await image.png().toBuffer()
  if (threshold === 180) await import('node:fs/promises').then((fs) => fs.writeFile('data/ocr-preview/ochsner-band.png', clip))
  const text = (await worker.recognize(clip)).data.text
  console.log(`\n---- threshold ${threshold} ----\n${text}`)
}
await worker.terminate()
