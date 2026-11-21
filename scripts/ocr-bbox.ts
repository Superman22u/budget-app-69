import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

const buffer = await readFile(process.argv[2])
const { data, info } = await sharp(buffer, { failOn: 'none' }).rotate().grayscale().raw().toBuffer({ resolveWithObject: true })
const width = info.width
const height = info.height
const bright = 188
const rowCount = new Uint32Array(height)
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) if (data[y * width + x] >= bright) rowCount[y]++
}
const rowMin = Math.floor(width * 0.28)
let top = 0
let bottom = height - 1
while (top < bottom && rowCount[top] < rowMin) top++
while (bottom > top && rowCount[bottom] < rowMin) bottom--
const paperH = bottom - top + 1
const colCount = new Uint32Array(width)
for (let y = top; y <= bottom; y++) {
  const row = y * width
  for (let x = 0; x < width; x++) if (data[row + x] >= bright) colCount[x]++
}
const marks: string[] = []
for (let x = 0; x < width; x += 20) {
  const frac = colCount[x] / paperH
  if (frac > 0.05) marks.push(`${x}:${frac.toFixed(2)}`)
}
console.log({ width, height, top, bottom, paperH })
console.log(marks.join(' '))
