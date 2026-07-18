#!/usr/bin/env node
// Batch-generate machine-fringe props for the /pov cam-tab overlay, then
// optimize each GLB. Same Meshy preview+refine flow as meshy-lab-batch.mjs but
// the output lands in public/scene/models/ (where RobotFringe loads props from)
// and is meshopt-compressed - the fringe loader installs MeshoptDecoder, so the
// GLBs must use EXT_meshopt_compression, NOT the quantize path the /stage props use.
//
//   node scripts/meshy-fringe-batch.mjs
//
// After it runs, add a row to FRINGE_MODELS in src/lib/fringeProps.js for each
// new file so it shows up in the editor palette (/pov?tab=cam&edit=1). Safe to
// re-run: props whose optimized GLB already exists are skipped.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'public/scene/models')

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

// The fringe reads as gritty black-and-white manga machinery after the ink
// pass, so prompts favor hard mechanical shapes and a single clean object.
const PROPS = [
  ['coolingfan', 'a chunky industrial cooling fan unit in a square metal housing, mechanical sci-fi, cartoon style, single clean object'],
  ['sensorpod', 'a futuristic robot sensor pod with a glass lens on a short mount bracket, sci-fi machinery, cartoon style'],
  ['gaugecluster', 'a cluster of round analog dial gauges on a metal panel with pipes, industrial control, cartoon style'],
  ['junctionbox', 'an electrical junction box with conduit pipes and cable connectors, industrial machinery, cartoon style'],
  ['pistonarm', 'a hydraulic piston actuator cylinder with a chrome rod and mounting clevis, mechanical part, cartoon style'],
  ['warnlight', 'a rotating warning beacon light on a metal base, hazard siren lamp, industrial, cartoon style'],
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
  const out = resolve(OUT_DIR, `${name}.glb`)
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
  const raw = resolve(OUT_DIR, `${name}.raw.glb`)
  const glb = Buffer.from(await (await fetch(glbUrl)).arrayBuffer())
  writeFileSync(raw, glb)
  console.log(`\n  wrote raw ${(glb.length / 1e6).toFixed(2)} MB, optimizing (meshopt)...`)
  execFileSync(
    'npx',
    ['--no-install', '@gltf-transform/cli', 'optimize', raw, out, '--compress', 'meshopt', '--texture-size', '1024'],
    { cwd: ROOT, stdio: 'inherit' },
  )
  console.log(`  done ${name} -> public/scene/models/${name}.glb`)
}

for (const [name, prompt] of PROPS) {
  try {
    await genOne(name, prompt)
  } catch (e) {
    console.error(`\nx ${name}: ${e.message}`)
  }
}
console.log('\nbatch complete. Add each new file to FRINGE_MODELS in src/lib/fringeProps.js.')
