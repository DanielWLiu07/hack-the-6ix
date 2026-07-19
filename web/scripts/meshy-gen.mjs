#!/usr/bin/env node
// Meshy AI -> GLB generator (local tooling; key stays out of the frontend).
//
// Usage:
//   node scripts/meshy-gen.mjs "a cute cartoon monkey mascot, standing" monkey
//   node scripts/meshy-gen.mjs "<prompt>" <output-basename> [art_style]
//
// Writes public/assets/<output-basename>.glb. Reads MESHY_API_KEY from
// web/.env.local (or the environment). art_style: "realistic" | "sculpture".
// After generating, optimize with gltf-transform the same way we did for
// tree/apple (quantize + texture-size) before shipping.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

function loadKey() {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY.trim()
  try {
    const env = readFileSync(resolve(ROOT, '.env.local'), 'utf8')
    const m = env.match(/^MESHY_API_KEY=(.*)$/m)
    if (m && m[1].trim()) return m[1].trim()
  } catch {
    /* no .env.local */
  }
  console.error('x No MESHY_API_KEY. Paste it into web/.env.local and retry.')
  process.exit(1)
}

const API = 'https://api.meshy.ai/openapi/v2/text-to-3d'
const KEY = loadKey()
const [, , prompt, name, artStyle = 'realistic'] = process.argv

if (!prompt || !name) {
  console.error('Usage: node scripts/meshy-gen.mjs "<prompt>" <output-basename> [art_style]')
  process.exit(1)
}

const headers = {
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function createTask(mode, extra = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode, prompt, art_style: artStyle, ...extra }),
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

async function main() {
  console.log(`▶ Meshy: "${prompt}" (${artStyle}) -> public/assets/${name}.glb`)
  console.log('  preview pass...')
  const previewId = await createTask('preview')
  const preview = await poll(previewId)
  console.log('\n  refine pass...')
  const refineId = await createTask('refine', { preview_task_id: preview.id ?? previewId })
  const refined = await poll(refineId)

  const glbUrl = refined.model_urls?.glb
  if (!glbUrl) throw new Error('no GLB in result')
  const glb = Buffer.from(await (await fetch(glbUrl)).arrayBuffer())
  const out = resolve(ROOT, 'public/assets', `${name}.glb`)
  writeFileSync(out, glb)
  console.log(`\n✔ wrote ${out} (${(glb.length / 1e6).toFixed(2)} MB)`)
  console.log(`  next: npx @gltf-transform/cli optimize ${out} ${out} --compress quantize --texture-size 1024`)
}

main().catch((e) => {
  console.error('\nx', e.message)
  process.exit(1)
})
