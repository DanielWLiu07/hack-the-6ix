// capture-favicon.mjs - grab the REAL painterly apple from the landing scene and
// derive the site favicons. Headless-loads /scene/icon.html (natureScene hero
// apple, watercolor pass, transparent bg), waits for the first painted frame, and
// screenshots the apple as a transparent 512 PNG, then writes:
//   public/favicon.png            32x32 transparent
//   public/apple-touch-icon.png   180x180 on paper (iOS ignores alpha)
//   public/favicon.svg            256 apple embedded as PNG-in-SVG
//
// Requires the Vite dev server running (default http://localhost:5173).
// WebGL in headless is via swiftshader (needs --enable-unsafe-swiftshader on
// recent Chrome).  Run:  node scripts/capture-favicon.mjs

import puppeteer from 'puppeteer'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUB = path.resolve(__dirname, '../public')
const URL_ = process.env.ICON_URL || 'http://localhost:5173/scene/icon.html?grow=1&icon=1'
const PAPER = '#f4f3ee'

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--no-sandbox',
  ],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.warn('[page error]', e.message))
  await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 60000 })
  await page.waitForFunction('window.__iconReady === true', { timeout: 60000 })
  await new Promise((r) => setTimeout(r, 400)) // let a few more frames settle

  const el = await page.$('#c')
  const shot = await el.screenshot({ omitBackground: true }) // transparent cutout

  // trim transparent margins, then re-pad to a square so the apple is centered
  const trimmed = await sharp(shot).trim({ threshold: 10 }).toBuffer()
  const meta = await sharp(trimmed).metadata()
  const side = Math.round(Math.max(meta.width, meta.height) * 1.12)
  const square = await sharp({
    create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: trimmed, gravity: 'center' }])
    .png()
    .toBuffer()

  await sharp(square).resize(512, 512).png().toFile(path.join(PUB, 'favicon-apple-512.png'))
  await sharp(square).resize(32, 32).png().toFile(path.join(PUB, 'favicon.png'))
  await sharp(square)
    .resize(160, 160)
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: PAPER })
    .flatten({ background: PAPER })
    .png()
    .toFile(path.join(PUB, 'apple-touch-icon.png'))

  const png256 = await sharp(square).resize(256, 256).png().toBuffer()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <title>Battery, not Blood - apple</title>
  <image width="256" height="256" href="data:image/png;base64,${png256.toString('base64')}"/>
</svg>
`
  await fs.writeFile(path.join(PUB, 'favicon.svg'), svg)
  console.log('favicon assets written to', PUB)
} finally {
  await browser.close()
}
