// RobotFringe - the machine fringe that hangs into the TOP of the POV frame,
// ported from public/scene/pov.js MINUS the painterly world. Robo camera-eyes,
// spinning gears, drooping cables, pipes, chains, antennas, a sensor dish,
// monitors, a hazard beam and vents - all rendered in the gritty black-and-white
// manga/ink cutout shader (src/lib/mangaPass.js) on a TRANSPARENT canvas, so it
// composites straight over whatever the robot is looking at.
//
// Self-contained: bundled three + three-stdlib GLTFLoader + the vendored
// MangaPass. GLB props load from /scene/models/ and degrade gracefully if any
// are missing (e.g. not deployed) - the procedural machinery always shows.

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader, MeshoptDecoder } from 'three-stdlib'
import { MangaPass } from '../lib/mangaPass.js'
import {
  FRINGE_MODELS,
  FRINGE_PROPS,
  FRINGE_DEFAULT_SCALE,
  FRINGE_DEFAULT_Z,
} from '../lib/fringeProps.js'

const MODELS = '/scene/models/'

// Idle motion so every fringe prop reads "alive". Each is additive to the
// prop's baked transform (applied around a captured rest pose in the loop). A
// global toggle and the currently-selected prop freeze it so editing is stable.
const ANIM_KINDS = {
  bob: { kind: 'bob', spd: 1.1, amp: 0.09 },     // vertical hover
  sway: { kind: 'sway', spd: 0.9, amp: 0.08 },   // roll rock
  spin: { kind: 'spin', spd: 0.6, amp: 0 },      // continuous yaw (beacon)
  nod: { kind: 'nod', spd: 1.3, amp: 0.13 },     // pitch scan (cam head)
  pulse: { kind: 'pulse', spd: 1.6, amp: 0.05 }, // scale breathing (vents)
}
// Thematic motion per model, with a cycle fallback for anything unlisted.
const FILE_ANIM = {
  'beacon.glb': ANIM_KINDS.spin,
  'camhead2.glb': ANIM_KINDS.nod,
  'vent2.glb': ANIM_KINDS.pulse,
  'manifold.glb': ANIM_KINDS.sway,
  'console.glb': ANIM_KINDS.bob,
  'infosign.glb': ANIM_KINDS.sway,
}
const ANIM_CYCLE = [ANIM_KINDS.bob, ANIM_KINDS.sway, ANIM_KINDS.spin, ANIM_KINDS.nod, ANIM_KINDS.pulse]

// scale a loaded model to a target longest-edge and recenter it
function fitUnit(root, len) {
  const box = new THREE.Box3().setFromObject(root)
  const size = box.getSize(new THREE.Vector3())
  const s = len / Math.max(size.x, size.y, size.z)
  const inner = new THREE.Group()
  inner.add(root)
  root.scale.setScalar(s)
  const b2 = new THREE.Box3().setFromObject(inner)
  root.position.sub(b2.getCenter(new THREE.Vector3()))
  return inner
}

export default function RobotFringe({ edit = false }) {
  const canvasRef = useRef(null)
  // Imperative bridge into the three.js scene, populated once by the effect and
  // called by the DOM editor panel (add / delete / duplicate / export).
  const apiRef = useRef(null)
  // Latest edit flag, read inside the (build-once) effect's pointer handlers.
  const editRef = useRef(edit)
  editRef.current = edit
  // Selected prop summary for the panel (id + file), or null. The effect owns
  // the live THREE object; this only drives which panel/handles show.
  const [sel, setSel] = useState(null)
  const setSelRef = useRef(setSel)
  setSelRef.current = setSel

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false
    let renderer
    let manga
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: true,
        premultipliedAlpha: false,
      })
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
      manga = new MangaPass(renderer, { grit: 1, ink: 0.05 })
    } catch {
      // no WebGL (headless / unsupported GPU) - skip the fringe silently
      return
    }

    // ---- deco scene: the machine fringe ----
    const deco = new THREE.Scene()
    const dcam = new THREE.PerspectiveCamera(40, 2, 0.1, 100)
    dcam.position.set(0, 2.3, 8.4)
    dcam.lookAt(0, 2.1, 0)
    {
      const key = new THREE.DirectionalLight('#ffffff', 3.0)
      key.position.set(4, 6, 3)
      deco.add(key)
      const front = new THREE.DirectionalLight('#ffffff', 1.5)
      front.position.set(0.5, 2.5, 10)
      deco.add(front)
      deco.add(new THREE.AmbientLight('#46424e', 1.1))
    }
    const fringe = new THREE.Group()
    fringe.position.y = -1.08
    deco.add(fringe)

    const MAT = {
      body: new THREE.MeshStandardMaterial({ color: '#d7d9de', roughness: 0.55, metalness: 0.15 }),
      dark: new THREE.MeshStandardMaterial({ color: '#75727e', roughness: 0.6, metalness: 0.2 }),
      joint: new THREE.MeshStandardMaterial({ color: '#f2a03c', roughness: 0.6, metalness: 0.1 }),
    }
    function part(geo, mat, parent, x = 0, y = 0, z = 0) {
      const m = new THREE.Mesh(geo, mat)
      m.position.set(x, y, z)
      parent.add(m)
      return m
    }

    const TOP = 6.05 // frame top at z=0 depth for this camera

    const spinners = []
    const gearSpots = [
      { x: -5.7, y: TOP + 0.15, s: 2.6, v: 0.14 },
      { x: 6.2, y: TOP + 0.05, s: 2.0, v: -0.1 },
      { x: -0.6, y: TOP + 0.55, s: 1.5, v: 0.2 },
    ]

    function sideSpine(x, lean = 0.1) {
      const rig = new THREE.Group()
      part(new THREE.BoxGeometry(0.24, 4.8, 0.24), MAT.body, rig, 0, -2.2, 0)
      for (const oy of [-0.3, -1.2, -2.25, -3.35]) {
        part(new THREE.BoxGeometry(0.95, 0.14, 0.2), MAT.dark, rig, lean * 1.8, oy, 0.02)
      }
      const braceA = part(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), MAT.dark, rig, 0.34, -1.2, 0)
      braceA.rotation.z = Math.PI / 4
      const braceB = part(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), MAT.dark, rig, -0.28, -2.65, 0)
      braceB.rotation.z = -Math.PI / 3.6
      rig.position.set(x, TOP + 0.72, -1.46)
      rig.rotation.z = lean
      fringe.add(rig)
      return rig
    }
    sideSpine(-8.95, -0.08)
    sideSpine(8.95, 0.08)

    function hangingPod(x, y, scale = 1) {
      const pod = new THREE.Group()
      part(new THREE.CylinderGeometry(0.09 * scale, 0.09 * scale, 1.1 * scale, 8), MAT.dark, pod, 0, 0.45 * scale, 0)
      part(new THREE.BoxGeometry(0.7 * scale, 0.5 * scale, 0.28 * scale), MAT.body, pod, 0, -0.1 * scale, 0)
      for (const ox of [-0.18, 0, 0.18]) {
        part(new THREE.CylinderGeometry(0.045 * scale, 0.045 * scale, 0.08 * scale, 8).rotateX(Math.PI / 2), MAT.joint, pod, ox * scale, -0.08 * scale, 0.16 * scale)
      }
      const clawL = part(new THREE.BoxGeometry(0.09 * scale, 0.46 * scale, 0.08 * scale), MAT.dark, pod, -0.16 * scale, -0.48 * scale, 0)
      clawL.rotation.z = 0.3
      const clawR = part(new THREE.BoxGeometry(0.09 * scale, 0.46 * scale, 0.08 * scale), MAT.dark, pod, 0.16 * scale, -0.48 * scale, 0)
      clawR.rotation.z = -0.3
      pod.position.set(x, y, -1.24)
      fringe.add(pod)
      return pod
    }
    hangingPod(-6.85, 5.32, 0.92)
    hangingPod(6.95, 5.24, 0.86)

    // drooping cables
    function wire(ax, ay, bx, by, sag, r) {
      const mid = new THREE.Vector3((ax + bx) / 2, Math.min(ay, by) - sag, -1.6)
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(ax, ay, -1.6), mid, new THREE.Vector3(bx, by, -1.6),
      ])
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 6), MAT.dark)
      fringe.add(m)
      return m
    }
    wire(-7.5, TOP + 0.6, -1.4, TOP + 0.9, 1.35, 0.07)
    wire(-2.2, TOP + 0.8, 3.6, TOP + 0.7, 1.05, 0.055)
    wire(2.4, TOP + 0.9, 7.5, TOP + 0.5, 1.5, 0.08)
    wire(-6.4, TOP + 0.4, -3.1, TOP + 0.6, 0.8, 0.045)
    wire(0.4, TOP + 0.7, 5.2, TOP + 0.8, 1.7, 0.06)
    wire(-8.3, TOP + 0.95, -6.55, 5.55, 0.65, 0.045)
    wire(8.35, TOP + 0.88, 6.58, 5.48, 0.7, 0.045)
    wire(-8.1, 4.95, -6.8, 5.85, 0.45, 0.04)
    wire(8.12, 5.05, 6.9, 5.72, 0.42, 0.04)

    // pipe run along the top edge
    {
      const pipe = new THREE.Group()
      part(new THREE.CylinderGeometry(0.14, 0.14, 9.4, 10).rotateZ(Math.PI / 2), MAT.body, pipe, -2.6, 0, 0)
      part(new THREE.SphereGeometry(0.19, 10, 8), MAT.dark, pipe, 2.1, 0, 0)
      part(new THREE.CylinderGeometry(0.14, 0.14, 1.3, 10), MAT.body, pipe, 2.1, 0.6, 0)
      for (const cx of [-6.4, -4.1, -0.8, 1.4]) {
        part(new THREE.BoxGeometry(0.16, 0.4, 0.34), MAT.dark, pipe, cx, 0, 0)
      }
      pipe.position.set(0, TOP + 0.72, -1.45)
      fringe.add(pipe)
    }

    // bolted plates
    for (const [px, pw, ph] of [[-7.2, 1.6, 0.9], [3.1, 1.2, 0.7], [7.3, 1.4, 0.8]]) {
      const plate = new THREE.Group()
      part(new THREE.BoxGeometry(pw, ph, 0.14), MAT.body, plate)
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        part(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8).rotateX(Math.PI / 2),
          MAT.dark, plate, sx * (pw / 2 - 0.12), sy * (ph / 2 - 0.12), 0.06)
      }
      plate.position.set(px, TOP + 0.28, -1.35)
      plate.rotation.z = (px > 0 ? -1 : 1) * 0.06
      fringe.add(plate)
    }

    // dangling chain stubs
    const chain = new THREE.Group()
    {
      let parent = chain
      for (let i = 0; i < 4; i++) {
        const j = new THREE.Group()
        j.position.y = i === 0 ? 0 : -0.42
        part(new THREE.CylinderGeometry(0.13, 0.13, 0.4, 10).rotateZ(Math.PI / 2), MAT.joint, j)
        part(i % 2 ? new THREE.BoxGeometry(0.24, 0.34, 0.26) : new THREE.CylinderGeometry(0.13, 0.14, 0.34, 10),
          MAT.body, j, 0, -0.22, 0)
        parent.add(j)
        parent = j
      }
      part(new THREE.SphereGeometry(0.16, 10, 8), MAT.dark, parent, 0, -0.5, 0)
      chain.position.set(1.6, 7.12, -1.3)
      fringe.add(chain)
    }
    const chain2 = chain.clone(true)
    chain2.position.set(-3.4, 6.55, -1.4)
    chain2.rotation.z = -0.03
    chain2.scale.setScalar(0.75)
    fringe.add(chain2)

    // tech clutter: antennas, dish, monitors, hazard beam, vents
    {
      for (const [ax, h] of [[-8.6, 1.9], [8.2, 1.5]]) {
        const m = new THREE.Group()
        part(new THREE.CylinderGeometry(0.045, 0.07, h, 8), MAT.dark, m, 0, -h / 2, 0)
        part(new THREE.SphereGeometry(0.09, 8, 8), MAT.joint, m, 0, 0.04, 0)
        for (const ry of [0.25, 0.55]) {
          part(new THREE.CylinderGeometry(0.012, 0.012, 0.66, 6).rotateZ(Math.PI / 2), MAT.dark, m, 0, -h * ry, 0)
        }
        m.position.set(ax, TOP + 0.9, -1.35)
        fringe.add(m)
      }
      const dish = new THREE.Group()
      part(new THREE.SphereGeometry(0.5, 14, 10, 0, Math.PI * 2, 0, 1.1), MAT.body, dish).rotation.x = Math.PI * 0.62
      part(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), MAT.dark, dish, 0, 0, 0.28).rotation.x = Math.PI / 2
      part(new THREE.SphereGeometry(0.06, 8, 8), MAT.joint, dish, 0, 0, 0.55)
      part(new THREE.BoxGeometry(0.16, 0.7, 0.16), MAT.dark, dish, 0, 0.5, -0.1)
      dish.position.set(-3.97, 6.27, -1.5)
      dish.rotation.z = -0.25
      fringe.add(dish)
      for (const [mx, my, mw] of [[0.7, TOP + 0.42, 0.9], [5.3, TOP + 0.55, 0.7]]) {
        const mon = new THREE.Group()
        part(new THREE.BoxGeometry(mw, mw * 0.72, 0.22), MAT.dark, mon)
        part(new THREE.PlaneGeometry(mw * 0.8, mw * 0.52), new THREE.MeshBasicMaterial({ color: '#f3f4ee' }), mon, 0, 0.02, 0.115)
        for (let b = 0; b < 3; b++) {
          part(new THREE.CylinderGeometry(0.025, 0.025, 0.06, 6).rotateX(Math.PI / 2), MAT.joint, mon, -mw * 0.28 + b * 0.12, -mw * 0.28, 0.12)
        }
        mon.position.set(mx, my, -1.28)
        mon.rotation.z = (mx > 3 ? 1 : -1) * 0.08
        fringe.add(mon)
      }
      {
        const beam = new THREE.Group()
        part(new THREE.BoxGeometry(4.6, 0.34, 0.3), MAT.body, beam)
        for (let i = 0; i < 6; i++) {
          part(new THREE.BoxGeometry(0.36, 0.34, 0.31), MAT.dark, beam, -1.9 + i * 0.76, 0, 0)
        }
        beam.position.set(-2.2, TOP + 0.62, -1.55)
        beam.rotation.z = 0.03
        fringe.add(beam)
      }
      for (const [vx, vy] of [[-6.6, 6.23], [2.3, 6.48]]) {
        const vent = new THREE.Group()
        part(new THREE.BoxGeometry(0.9, 0.55, 0.16), MAT.dark, vent)
        for (let sIdx = 0; sIdx < 4; sIdx++) {
          part(new THREE.BoxGeometry(0.74, 0.06, 0.18), MAT.body, vent, 0, -0.18 + sIdx * 0.12, 0.02)
        }
        vent.position.set(vx, vy, -1.32)
        fringe.add(vent)
      }
      for (const [sx, sy] of [[-8.2, 4.95], [8.15, 4.88]]) {
        const sideBox = new THREE.Group()
        part(new THREE.BoxGeometry(0.84, 1.16, 0.22), MAT.body, sideBox)
        part(new THREE.PlaneGeometry(0.54, 0.72), new THREE.MeshBasicMaterial({ color: '#f5f4ef' }), sideBox, 0, 0.06, 0.12)
        for (const oy of [-0.3, -0.08, 0.14]) {
          part(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 6).rotateX(Math.PI / 2), MAT.joint, sideBox, -0.22, oy, 0.14)
        }
        sideBox.position.set(sx, sy, -1.34)
        sideBox.rotation.z = sx < 0 ? -0.18 : 0.18
        fringe.add(sideBox)
      }
    }

    // ---- the eyes: Meshy housings on stalks, idle-scanning ----
    const eyes = []
    function makeEyeMount(x, y) {
      const mount = new THREE.Group()
      const head = new THREE.Group()
      mount.add(head)
      mount.position.set(x, y, -1.1)
      fringe.add(mount)
      eyes.push({ head, ph: Math.random() * 6.28 })
      return head
    }
    const eyeHeadA = makeEyeMount(-2.42, 5.63)
    const eyeHeadB = makeEyeMount(2.57, 5.56)

    const loader = new GLTFLoader()
    // The fringe GLBs (roboeye, gears, props) are meshopt-compressed
    // (EXT_meshopt_compression). Without this decoder the loader silently fails
    // to build their geometry - which is why the eye/models never appeared.
    // NOTE: three-stdlib exports MeshoptDecoder as a factory FUNCTION - it must
    // be CALLED to get the actual decoder object (passing the function is a no-op).
    loader.setMeshoptDecoder(MeshoptDecoder())
    const liftedMat = () => new THREE.MeshStandardMaterial({
      color: '#e6e8ec', roughness: 0.5, metalness: 0.1,
      emissive: '#63676d', emissiveIntensity: 0.85,
    })

    loader.load(MODELS + 'roboeye.glb', (g) => {
      if (disposed) return
      const lifted = liftedMat()
      g.scene.traverse((o) => { if (o.isMesh) o.material = lifted })
      const irisMat = new THREE.MeshStandardMaterial({ color: '#f2a03c', emissive: '#ff8c1a', emissiveIntensity: 1.6, roughness: 0.4 })
      const pupilMat = new THREE.MeshStandardMaterial({ color: '#0b0b10', roughness: 0.25, metalness: 0.3 })
      for (const [head, size] of [[eyeHeadA, 1.5], [eyeHeadB, 0.95]]) {
        const inner = fitUnit(g.scene.clone(true), size)
        head.add(inner)
        const s = size
        const cornea = new THREE.Group()
        cornea.position.z = s * 0.46
        cornea.add(new THREE.Mesh(new THREE.CylinderGeometry(s * 0.13, s * 0.13, 0.05, 20).rotateX(Math.PI / 2), pupilMat))
        cornea.add(new THREE.Mesh(new THREE.TorusGeometry(s * 0.17, s * 0.028, 8, 28), irisMat))
        const glint = new THREE.Mesh(new THREE.SphereGeometry(s * 0.035, 8, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
        glint.position.set(s * 0.07, s * 0.07, 0.05)
        cornea.add(glint)
        head.add(cornea)
      }
      deco.traverse((o) => { o.frustumCulled = false })
    }, undefined, () => console.warn('[pov] roboeye.glb missing'))

    loader.load(MODELS + 'gears.glb', (g) => {
      if (disposed) return
      const lifted = liftedMat()
      g.scene.traverse((o) => { if (o.isMesh) o.material = lifted })
      for (const spot of gearSpots) {
        const inner = fitUnit(g.scene.clone(true), spot.s)
        inner.rotation.x = Math.PI / 2
        const holder = new THREE.Group()
        holder.add(inner)
        holder.position.set(spot.x, spot.y, -1.2)
        holder.userData.v = spot.v
        fringe.add(holder)
        spinners.push(holder)
      }
      deco.traverse((o) => { o.frustumCulled = false })
    }, undefined, () => console.warn('[pov] gears.glb missing'))

    // ---- editable props (the "stuff" the editor adds / arranges) ----
    // Each spec becomes a holder group added to `fringe`. `editable` keeps
    // insertion order so exportProps() emits the layout you see. The eyes/gears
    // above are NOT in this list, so the editor never grabs them.
    const editable = []
    let editSeq = 0
    const round = (n) => Number(n.toFixed(3))

    function spawnProp(spec, select = false) {
      const editId = (editSeq += 1)
      const baseScale = spec.s ?? FRINGE_DEFAULT_SCALE
      const holder = new THREE.Group()
      holder.position.set(spec.x, spec.y, spec.z ?? FRINGE_DEFAULT_Z)
      holder.rotation.set(spec.rx ?? 0, spec.ry ?? 0, spec.rz ?? 0)
      holder.userData.editId = editId
      fringe.add(holder)
      const rec = {
        editId,
        file: spec.file,
        holder,
        baseScale,
        anim: FILE_ANIM[spec.file] || ANIM_CYCLE[(editId - 1) % ANIM_CYCLE.length],
        phase: editId * 1.7, // deterministic per-prop offset so they desync
        // rest pose the idle motion oscillates around; edits (while selected)
        // write back into it, so animation resumes from the new placement.
        base: {
          px: holder.position.x, py: holder.position.y, pz: holder.position.z,
          rx: holder.rotation.x, ry: holder.rotation.y, rz: holder.rotation.z, sc: 1,
        },
      }
      editable.push(rec)
      loader.load(MODELS + spec.file, (g) => {
        if (disposed) return
        const lifted = new THREE.MeshStandardMaterial({ color: '#e8eaee', roughness: 0.55, metalness: 0.05, emissive: '#75797f', emissiveIntensity: 0.9 })
        g.scene.traverse((o) => { if (o.isMesh) o.material = lifted })
        holder.add(fitUnit(g.scene, baseScale))
        holder.traverse((o) => { o.frustumCulled = false })
        if (select) selectProp(rec)
      }, undefined, () => console.warn('[pov]', spec.file, 'missing'))
      return rec
    }

    // ---- selection + pick/drag/nudge (raw three.js; the manga pass makes a
    // TransformControls gizmo unusable, so props are grabbed on a camera-facing
    // plane like the /stage editor). Gated by editRef so the normal POV never
    // captures pointer/keys. ----
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const selBox = new THREE.BoxHelper(new THREE.Object3D(), 0xff8c1a)
    selBox.visible = false
    selBox.material.depthTest = false
    deco.add(selBox)
    let selected = null
    let animEnabled = true
    const drag = { active: false, plane: new THREE.Plane(), offset: new THREE.Vector3() }

    function selectProp(rec) {
      selected = rec || null
      if (selected) {
        selBox.setFromObject(selected.holder)
        selBox.visible = true
        setSelRef.current({ editId: selected.editId, file: selected.file })
      } else {
        selBox.visible = false
        setSelRef.current(null)
      }
    }

    function recFromHit(obj) {
      let o = obj
      while (o) {
        if (o.userData?.editId) return editable.find((r) => r.editId === o.userData.editId) || null
        o = o.parent
      }
      return null
    }

    function toNdc(event) {
      const rect = canvas.getBoundingClientRect()
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    }

    function onDown(event) {
      if (!editRef.current) return
      toNdc(event)
      raycaster.setFromCamera(ndc, dcam)
      const hits = raycaster.intersectObjects(editable.map((r) => r.holder), true)
      const rec = hits.length ? recFromHit(hits[0].object) : null
      selectProp(rec)
      if (!rec) return
      event.preventDefault()
      canvas.setPointerCapture(event.pointerId)
      const worldPos = rec.holder.getWorldPosition(new THREE.Vector3())
      const normal = dcam.getWorldDirection(new THREE.Vector3())
      drag.plane.setFromNormalAndCoplanarPoint(normal, worldPos)
      const grab = new THREE.Vector3()
      raycaster.ray.intersectPlane(drag.plane, grab)
      drag.offset.copy(worldPos).sub(grab)
      drag.active = true
    }

    function onMove(event) {
      if (!drag.active || !selected) return
      toNdc(event)
      raycaster.setFromCamera(ndc, dcam)
      const hit = new THREE.Vector3()
      if (!raycaster.ray.intersectPlane(drag.plane, hit)) return
      hit.add(drag.offset)
      fringe.worldToLocal(hit)
      selected.holder.position.x = hit.x
      selected.holder.position.y = hit.y
    }

    function onUp(event) {
      if (!drag.active) return
      drag.active = false
      try { canvas.releasePointerCapture(event.pointerId) } catch { /* was not captured */ }
    }

    function onKey(event) {
      if (!editRef.current || !selected) return
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const h = selected.holder
      const step = event.shiftKey ? 0.25 : 0.06
      const turn = event.shiftKey ? 0.12 : 0.03
      let used = true
      switch (event.key) {
        case 'ArrowLeft': h.position.x -= step; break
        case 'ArrowRight': h.position.x += step; break
        case 'ArrowUp': h.position.y += step; break
        case 'ArrowDown': h.position.y -= step; break
        case '[': h.position.z -= step; break
        case ']': h.position.z += step; break
        case ',': h.rotation.z += turn; break
        case '.': h.rotation.z -= turn; break
        case '-': case '_': h.scale.multiplyScalar(0.96); break
        case '=': case '+': h.scale.multiplyScalar(1.04); break
        case 'Delete': case 'Backspace': api.deleteSelected(); break
        default: used = false
      }
      if (used) event.preventDefault()
    }

    // Imperative bridge for the DOM editor panel.
    const api = {
      add(file) {
        return spawnProp({ file, x: 0, y: 6.2, s: FRINGE_DEFAULT_SCALE, rz: 0 }, true)
      },
      deleteSelected() {
        if (!selected) return
        fringe.remove(selected.holder)
        const i = editable.indexOf(selected)
        if (i >= 0) editable.splice(i, 1)
        selectProp(null)
      },
      duplicateSelected() {
        if (!selected) return
        const h = selected.holder
        spawnProp({
          file: selected.file,
          x: h.position.x + 0.5,
          y: h.position.y,
          z: h.position.z,
          s: selected.baseScale * h.scale.x,
          rx: h.rotation.x,
          ry: h.rotation.y,
          rz: h.rotation.z,
        }, true)
      },
      clearSelection() { selectProp(null) },
      getSelected() { return selected ? selected.holder : null },
      setAnimate(on) { animEnabled = Boolean(on) },
      getAnimate() { return animEnabled },
      // live transform sample (used by the editor/tests to inspect motion)
      sample() {
        return editable.map((r) => ({
          file: r.file,
          y: r.holder.position.y,
          rx: r.holder.rotation.x,
          ry: r.holder.rotation.y,
          rz: r.holder.rotation.z,
          s: r.holder.scale.x,
        }))
      },
      exportProps() {
        const rows = editable.map((r) => {
          const h = r.holder
          const s = round(r.baseScale * h.scale.x)
          const zPart = round(h.position.z) === round(FRINGE_DEFAULT_Z) ? '' : `, z: ${round(h.position.z)}`
          const rxPart = round(h.rotation.x) === 0 ? '' : `, rx: ${round(h.rotation.x)}`
          const ryPart = round(h.rotation.y) === 0 ? '' : `, ry: ${round(h.rotation.y)}`
          return `  { file: '${r.file}', x: ${round(h.position.x)}, y: ${round(h.position.y)}, s: ${s}${rxPart}${ryPart}, rz: ${round(h.rotation.z)}${zPart} },`
        })
        return `export const FRINGE_PROPS = [\n${rows.join('\n')}\n]`
      },
    }
    apiRef.current = api
    if (typeof window !== 'undefined') window.__fringe = api

    for (const p of FRINGE_PROPS) spawnProp(p)

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)

    // ---- resize + loop ----
    function resize() {
      const w = canvas.clientWidth || innerWidth
      const h = canvas.clientHeight || innerHeight
      renderer.setSize(w, h, false)
      dcam.aspect = w / h
      dcam.updateProjectionMatrix()
      const pr = renderer.getPixelRatio()
      manga.setSize(w * pr, h * pr)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    window.addEventListener('resize', resize)
    resize()

    const clock = new THREE.Clock()
    const gaze = new THREE.Vector3()
    let raf
    const loop = () => {
      if (disposed) return
      const t = clock.getElapsedTime()
      for (const sp of spinners) sp.rotation.z = t * sp.userData.v
      chain.rotation.z = Math.sin(t * 0.9) * 0.1
      chain2.rotation.z = Math.sin(t * 0.9 + 1.7) * 0.12
      for (const e of eyes) {
        gaze.copy(dcam.position)
        gaze.x += Math.sin(t * 0.5 + e.ph) * 2.2
        gaze.y += Math.sin(t * 1.0 + e.ph) * 1.1
        e.head.lookAt(gaze)
      }
      // per-prop idle motion. The selected prop follows the user (its rest pose
      // tracks the live edit); everything else oscillates around its rest pose.
      // Global toggle off snaps each prop back to rest.
      for (const r of editable) {
        const h = r.holder
        const b = r.base
        if (r === selected) {
          b.px = h.position.x; b.py = h.position.y; b.pz = h.position.z
          b.rx = h.rotation.x; b.ry = h.rotation.y; b.rz = h.rotation.z; b.sc = h.scale.x
          continue
        }
        h.position.set(b.px, b.py, b.pz)
        h.rotation.set(b.rx, b.ry, b.rz)
        h.scale.setScalar(b.sc)
        if (!animEnabled) continue
        const a = r.anim
        const w = Math.sin(t * a.spd + r.phase)
        switch (a.kind) {
          case 'bob': h.position.y = b.py + w * a.amp; break
          case 'sway': h.rotation.z = b.rz + w * a.amp; break
          case 'nod': h.rotation.x = b.rx + w * a.amp; break
          case 'spin': h.rotation.y = b.ry + t * a.spd; break
          case 'pulse': h.scale.setScalar(b.sc * (1 + w * a.amp)); break
          default: break
        }
      }
      // keep the selection outline glued to a prop while it is dragged/nudged
      if (selBox.visible && selected) selBox.setFromObject(selected.holder)
      manga.render(deco, dcam)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('resize', resize)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
      apiRef.current = null
      if (typeof window !== 'undefined' && window.__fringe === api) window.__fringe = null
      renderer.dispose()
    }
  }, [])

  // Toggle pointer capture with edit mode without rebuilding the scene. The
  // fringe canvas is pointer-transparent in normal POV; in edit mode it grabs
  // clicks so props can be picked/dragged.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.pointerEvents = edit ? 'auto' : 'none'
    if (!edit) apiRef.current?.clearSelection?.()
  }, [edit])

  return (
    <>
      <canvas ref={canvasRef} className={`pov-fringe${edit ? ' editing' : ''}`} aria-hidden />
      {edit && <FringeEditor apiRef={apiRef} sel={sel} />}
    </>
  )
}

// DOM editor panel (only mounted in edit mode). Palette adds props; the sliders
// read/write the selected THREE object live via rAF (no React re-render while
// dragging), mirroring the /stage transform panel. "copy FRINGE_PROPS" emits a
// paste-ready array for src/lib/fringeProps.js.
const FRINGE_SLIDERS = [
  ['pos x', 'position', 'x', -10, 10, 0.01],
  ['pos y', 'position', 'y', -4, 8, 0.01],
  ['pos z', 'position', 'z', -4, 2, 0.01],
  ['rot x', 'rotation', 'x', -Math.PI, Math.PI, 0.005],
  ['rot y', 'rotation', 'y', -Math.PI, Math.PI, 0.005],
  ['rot z', 'rotation', 'z', -Math.PI, Math.PI, 0.005],
  ['scale', 'scale', 'uniform', 0.1, 4, 0.01],
]

function FringeEditor({ apiRef, sel }) {
  const inputs = useRef([])
  const outs = useRef([])
  const editing = useRef(false)
  const [copied, setCopied] = useState('')
  const [animOn, setAnimOn] = useState(true)

  const toggleAnim = () => {
    setAnimOn((v) => {
      const next = !v
      apiRef.current?.setAnimate?.(next)
      return next
    })
  }

  useEffect(() => {
    let raf
    const tick = () => {
      const obj = apiRef.current?.getSelected?.()
      if (obj && !editing.current) {
        for (let i = 0; i < FRINGE_SLIDERS.length; i++) {
          const [, prop, axis] = FRINGE_SLIDERS[i]
          const v = axis === 'uniform' ? obj[prop].x : obj[prop][axis]
          const inp = inputs.current[i]
          const out = outs.current[i]
          if (inp && document.activeElement !== inp) inp.value = String(v)
          if (out) out.textContent = v.toFixed(2)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [apiRef])

  const onInput = (i) => (e) => {
    const obj = apiRef.current?.getSelected?.()
    if (!obj) return
    const [, prop, axis] = FRINGE_SLIDERS[i]
    const v = parseFloat(e.target.value)
    if (axis === 'uniform') obj.scale.set(v, v, v)
    else obj[prop][axis] = v
    if (outs.current[i]) outs.current[i].textContent = v.toFixed(2)
  }

  const copyProps = () => {
    const text = apiRef.current?.exportProps?.()
    if (!text) return
    navigator.clipboard?.writeText(text).then(
      () => { setCopied('copied to clipboard'); setTimeout(() => setCopied(''), 1400) },
      () => setCopied('copy failed - see console') || console.log(text),
    )
  }

  return (
    <div className="fringe-edit">
      <div className="fringe-edit-head">MACHINE FRINGE EDITOR</div>
      <div className="fringe-edit-hint">
        click a prop to select · drag to move · arrows nudge · , . roll · - = scale · del removes
      </div>
      <button
        className={`fringe-edit-anim${animOn ? ' on' : ''}`}
        type="button"
        onClick={toggleAnim}
      >
        idle animation: {animOn ? 'ON' : 'OFF'}
      </button>
      <div className="fringe-edit-palette">
        {FRINGE_MODELS.map((m) => (
          <button key={m.id} type="button" onClick={() => apiRef.current?.add?.(m.file)}>
            + {m.label}
          </button>
        ))}
      </div>
      {sel ? (
        <>
          <div className="fringe-edit-sel">{sel.file}</div>
          <div className="fringe-edit-sliders">
            {FRINGE_SLIDERS.map(([label, , , min, max, step], i) => (
              <label className="fringe-slider-row" key={label}>
                <span>{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  ref={(el) => { inputs.current[i] = el }}
                  onPointerDown={() => { editing.current = true }}
                  onPointerUp={() => { editing.current = false }}
                  onPointerCancel={() => { editing.current = false }}
                  onInput={onInput(i)}
                />
                <output ref={(el) => { outs.current[i] = el }} />
              </label>
            ))}
          </div>
          <div className="fringe-edit-row">
            <button type="button" onClick={() => apiRef.current?.duplicateSelected?.()}>duplicate</button>
            <button type="button" onClick={() => apiRef.current?.deleteSelected?.()}>delete</button>
          </div>
        </>
      ) : (
        <div className="fringe-edit-sel muted">no prop selected</div>
      )}
      <button className="fringe-edit-copy" type="button" onClick={copyProps}>copy FRINGE_PROPS</button>
      {copied && <div className="fringe-edit-copied">{copied}</div>}
    </div>
  )
}
