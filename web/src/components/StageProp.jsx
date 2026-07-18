// A placeable prop for the /stage manga room. Loads a catalog GLB, fits it to a
// target height, rests it on the floor (base at the group origin), and carries
// the stage's shared drag `bind` so it selects/drags/slider-edits exactly like
// the monkey and the painting. Existence is React state (add / place / delete);
// the live transform is mutated straight on the THREE object like everything
// else on the stage, so no re-render happens while dragging or sliding.

import { Component, useLayoutEffect, useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Stable 0..2pi phase from an instance id so two copies of one prop (the two
// banana bunches) idle out of sync without needing Math.random at mount.
function phaseFromId(id) {
  let h = 0
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) % 997
  return (h / 997) * Math.PI * 2
}

export function StageProp({ inst, catalog, bind, onReady }) {
  const { scene } = useGLTF(catalog.url)
  // Clone so two instances of one model do not share (and fight over) a graph.
  // Lab props sit far behind the front spotlight in a low-ambient room, so the
  // manga pass posterizes their unlit surfaces into dark ink. Whiten them: a
  // light base colour with a self-illumination lift keeps every face in the
  // paper/light tone bands, while the retained normal detail + diffuse gradient
  // still give the ink outlines. Dark baked albedo / vertex colours are stripped
  // (they were the thing forcing the props black).
  const model = useMemo(() => {
    const clone = scene.clone(true)
    if (catalog.whiten !== false && catalog.lab) {
      clone.traverse((node) => {
        if (!node.isMesh || !node.material) return
        const wasArray = Array.isArray(node.material)
        const list = wasArray ? node.material : [node.material]
        const lit = list.map((m) => {
          const w = m.clone()
          w.color?.set?.(0xe0e0dc)
          if (w.emissive) {
            w.emissive.set(0x4c4c49)
            w.emissiveIntensity = 1
          }
          w.map = null
          w.emissiveMap = null
          w.aoMap = null
          w.vertexColors = false
          if ('metalness' in w) w.metalness = 0
          if ('roughness' in w) w.roughness = 0.85
          w.needsUpdate = true
          return w
        })
        node.material = wasArray ? lit : lit[0]
      })
    }
    return clone
  }, [scene, catalog.lab, catalog.whiten])
  // Fit to catalog.height, centered on X/Z, base resting on y=0 within the
  // inner group so the outer placement group sits the prop on the floor.
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3()
    box.getSize(size)
    const s = catalog.height / (size.y || 1)
    return {
      s,
      pos: [
        -((box.min.x + box.max.x) / 2) * s,
        -box.min.y * s,
        -((box.min.z + box.max.z) / 2) * s,
      ],
    }
  }, [model, catalog.height])

  // Idle background motion. Applied to an INNER group so the editor's drag /
  // slider writes on the outer placement group are never fought. `anim` comes
  // from the catalog: 'sway' = pendulum (hanging fruit), 'scan' = slow base yaw
  // (idle robot arm sweeping). Frameloop is already paused when the tab hides
  // (CanvasGuard), so this stops itself off-screen.
  const anim = catalog.anim
  const phase = useMemo(() => phaseFromId(inst.id), [inst.id])
  const animRef = useRef(null)
  useFrame((state) => {
    const g = animRef.current
    if (!g || !anim) return
    const t = state.clock.elapsedTime
    if (anim === 'sway') {
      g.rotation.z = Math.sin(t * 0.9 + phase) * 0.06
      g.rotation.x = Math.sin(t * 0.7 + phase * 1.3) * 0.035
    } else if (anim === 'scan') {
      g.rotation.y = Math.sin(t * 0.35 + phase) * 0.16
    }
  })

  const groupRef = useRef(null)
  useLayoutEffect(() => {
    const g = groupRef.current
    if (!g) return
    // Tag the group so the editor can map a selected object back to its
    // instance (for delete / duplicate) and auto-select a freshly placed prop.
    g.userData.instanceId = inst.id
    g.userData.catalogId = catalog.id
    onReady?.(inst.id, g)
  }, [inst.id, catalog.id, onReady])

  return (
    <group
      ref={groupRef}
      name={catalog.label}
      position={inst.position}
      rotation={inst.rotation || [0, 0, 0]}
      scale={inst.scale || [1, 1, 1]}
      {...bind}
    >
      <group ref={animRef}>
        <group scale={fit.s} position={fit.pos}>
          <primitive object={model} />
        </group>
      </group>
    </group>
  )
}

// A not-yet-generated GLB (the Meshy batch may still be running) 404s and would
// otherwise suspend forever or throw. Drop just that prop and keep the stage.
export class PropBoundary extends Component {
  state = { dead: false }
  static getDerivedStateFromError() {
    return { dead: true }
  }
  render() {
    return this.state.dead ? null : this.props.children
  }
}
