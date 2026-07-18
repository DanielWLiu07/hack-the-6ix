// poseRig.js - retarget MediaPipe BlazePose world-landmarks onto the rigged
// humanoid GLB (suzanne-fullbody-rigged.glb, Mixamo-style bone names). Each
// limb segment is driven by a look-at: rotate the bone so its rest child-bone
// direction points along the live direction between two body landmarks. Torso
// and head are left at rest for stability; arms and legs are the expressive part.
//
// No absolute positioning is applied, only joint rotations, so the character
// stays put on the stage and only its pose mirrors the operator.

import * as THREE from 'three'

// MediaPipe pose world-landmark indices.
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
}

// Driven segments. `bone` rotates so the direction to `child` (its rest child
// bone) matches the landmark a->b direction. Parents precede children so the
// top-down pass reads already-updated parent world transforms.
const SEGMENTS = [
  { bone: 'LeftArm', child: 'LeftForeArm', a: LM.L_SHOULDER, b: LM.L_ELBOW },
  { bone: 'LeftForeArm', child: 'LeftHand', a: LM.L_ELBOW, b: LM.L_WRIST },
  { bone: 'RightArm', child: 'RightForeArm', a: LM.R_SHOULDER, b: LM.R_ELBOW },
  { bone: 'RightForeArm', child: 'RightHand', a: LM.R_ELBOW, b: LM.R_WRIST },
  { bone: 'LeftUpLeg', child: 'LeftLeg', a: LM.L_HIP, b: LM.L_KNEE },
  { bone: 'LeftLeg', child: 'LeftFoot', a: LM.L_KNEE, b: LM.L_ANKLE },
  { bone: 'RightUpLeg', child: 'RightLeg', a: LM.R_HIP, b: LM.R_KNEE },
  { bone: 'RightLeg', child: 'RightFoot', a: LM.R_KNEE, b: LM.R_ANKLE },
]

// Normalize a bone name so both the Meshy rig ('LeftArm') and a Mixamo rig
// ('mixamorig:LeftArm', sanitized by three to 'mixorigLeftArm') resolve the same.
const normBone = (name) => name.toLowerCase().replace(/[^a-z]/g, '').replace(/^mixamorig/, '')

// Build the retarget rig once from a GLB scene in its rest (bind) pose. Captures
// each bone's rest child-direction and rest world orientation in model space.
export function buildRig(scene) {
  const bones = {}
  scene.updateMatrixWorld(true)
  scene.traverse((o) => { if (o.isBone) bones[normBone(o.name)] = o })
  const wp = new THREE.Vector3()
  const cp = new THREE.Vector3()
  const segs = []
  for (const s of SEGMENTS) {
    const bone = bones[normBone(s.bone)]
    const child = bones[normBone(s.child)]
    if (!bone || !child) continue
    bone.getWorldPosition(wp)
    child.getWorldPosition(cp)
    const restDir = cp.clone().sub(wp)
    if (restDir.lengthSq() < 1e-8) continue
    restDir.normalize()
    segs.push({
      bone,
      restDir,
      restWorldQuat: bone.getWorldQuaternion(new THREE.Quaternion()),
      a: s.a,
      b: s.b,
    })
  }
  return { bones, segs, ok: segs.length > 0 }
}

// Scratch objects reused every frame to avoid per-frame allocation.
const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _pq = new THREE.Quaternion()
const _delta = new THREE.Quaternion()
const _des = new THREE.Quaternion()
const _loc = new THREE.Quaternion()

// Map a MediaPipe world landmark into three space. MP is x-right, y-down,
// z-toward-camera; three here is y-up with the character facing +z toward the
// stage camera. mirror gives a natural selfie mimic; flipZ corrects front/back
// if the operator ends up posing the character backwards.
function toThree(lm, mirror, flipZ, out) {
  return out.set(mirror ? -lm.x : lm.x, -lm.y, flipZ ? lm.z : -lm.z)
}

// Apply one frame of landmarks to the rig. Slerps toward the target so tracking
// jitter is smoothed. Low-visibility joints are skipped so a dropped limb holds
// its last pose instead of snapping to garbage.
export function applyPose(rig, world, opts = {}) {
  const { mirror = true, flipZ = false, smooth = 0.35, minVis = 0.5 } = opts
  for (const seg of rig.segs) {
    const la = world[seg.a]
    const lb = world[seg.b]
    if (!la || !lb) continue
    if ((la.visibility ?? 1) < minVis || (lb.visibility ?? 1) < minVis) continue
    toThree(la, mirror, flipZ, _a)
    toThree(lb, mirror, flipZ, _b)
    _dir.copy(_b).sub(_a)
    if (_dir.lengthSq() < 1e-6) continue
    _dir.normalize()
    const bone = seg.bone
    if (!bone.parent) continue
    bone.parent.getWorldQuaternion(_pq)
    _delta.setFromUnitVectors(seg.restDir, _dir)
    _des.copy(_delta).multiply(seg.restWorldQuat)
    _loc.copy(_pq).invert().multiply(_des)
    bone.quaternion.slerp(_loc, smooth)
    bone.updateWorldMatrix(false, false)
  }
}
