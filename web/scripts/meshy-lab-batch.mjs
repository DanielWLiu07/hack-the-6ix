#!/usr/bin/env node
// Batch-generate the "tech lab" props for /stage, then optimize each GLB.
// Runs the same Meshy preview+refine flow as meshy-gen.mjs but for a fixed
// list, sequentially (keeps us under the account's concurrent-task cap), and
// pipes every result through gltf-transform so the stage stays light.
//
//   node scripts/meshy-lab-batch.mjs
//
// Safe to re-run: props whose optimized GLB already exists are skipped.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function loadKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY.trim()
  const env = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
  const m = env.match(/^MESHY_API_KEY=(.*)$/m)
  if (m && m[1].trim()) return m[1].trim()
  throw new Error('No MESHY_API_KEY in env or .env.local')
}

const API = 'https://api.meshy.ai/openapi/v2/text-to-3d'
const KEY = loadKey()
const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Cartoon-leaning prompts so the mesh already reads toon before the manga pass.
const PROPS = [
  ['server-rack', 'a tall sci-fi server rack full of blinking computers and cables, cartoon style, clean single object'],
  ['lab-bench', 'a science lab workbench covered in glass beakers flasks and test tubes with colored liquid, cartoon style'],
  ['control-console', 'a futuristic control console desk with monitors buttons and levers, glowing screens, cartoon style'],
  ['robot-arm-lab', 'an industrial robotic arm on a heavy base, mechanical sci-fi laboratory equipment, cartoon style'],
  ['oscilloscope', 'a retro scientific oscilloscope instrument with round green screen and many knobs, cartoon style'],
  ['storage-shelf', 'a metal warehouse storage shelf stacked with labeled boxes and equipment, cartoon style'],
]

async function createTask(prompt, mode, extra = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode, prompt, art_style: 'realistic', ...extra }),
  })
  if (!res.ok) throw new Error(`create ${mode} -> ${res.status} ${await res.text()}`)
  return (await res.json()).result
}

async function poll(id) {
  for (;;) {
    const res = await fetch(`${API}/${id}`, { headers })
    if (!res.ok) throw new Error(`poll -> ${res.status} ${await res.text()}`)
    const t = await res.json()
    process.stdout.write(`\r  ${t.status} ${t.progress ?? 0}%   `)
    if (t.status === 'SUCCEEDED') return t
    if (t.status === 'FAILED' || t.status === 'CANCELED')
      throw new Error(`task ${t.status}: ${t.task_error?.message ?? ''}`)
    await sleep(5000)
  }
}

async function genOne(name, prompt) {
  const out = resolve(ROOT, 'public/assets', `${name}.glb`)
  if (existsSync(out)) { console.log(`= skip ${name} (exists)`); return }
  console.log(`\n> ${name}: "${prompt}"`)
  console.log('  preview...')
  const previewId = await createTask(prompt, 'preview')
  const preview = await poll(previewId)
  console.log('\n  refine...')
  const refineId = await createTask(prompt, 'refine', { preview_task_id: preview.id ?? previewId })
  const refined = await poll(refineId)
  const glbUrl = refined.model_urls?.glb
  if (!glbUrl) throw new Error('no GLB in result')
  const raw = resolve(ROOT, 'public/assets', `${name}.raw.glb`)
  const glb = Buffer.from(await (await fetch(glbUrl)).arrayBuffer())
  writeFileSync(raw, glb)
  console.log(`\n  wrote raw ${(glb.length / 1e6).toFixed(2)} MB, optimizing...`)
  execFileSync(
    'npx',
    ['--no-install', '@gltf-transform/cli', 'optimize', raw, out, '--compress', 'quantize', '--texture-size', '1024'],
    { cwd: ROOT, stdio: 'inherit' },
  )
  console.log(`  done ${name}`)
}

for (const [name, prompt] of PROPS) {
  try {
    await genOne(name, prompt)
  } catch (e) {
    console.error(`\nx ${name}: ${e.message}`)
  }
}
console.log('\nbatch complete')
