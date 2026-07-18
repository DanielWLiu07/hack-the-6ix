// MimicCam - webcam pose capture for the stage "mimic" mode. Runs MediaPipe
// PoseLandmarker fully on-device in the browser (wasm + model self-hosted under
// /mediapipe so it works on an offline venue hotspot) and writes the latest
// world-landmark array into poseRef for the 3D monkey to retarget against.
//
// Renders a small live preview with a status line. All heavy work (getUserMedia,
// model load, the detect loop) is torn down on unmount.

import { useEffect, useRef, useState } from 'react'
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

const WASM_PATH = '/mediapipe/wasm'
const MODEL_PATH = '/mediapipe/models/pose_landmarker_lite.task'

const MESSAGES = {
  camera: 'Requesting camera',
  model: 'Loading pose model',
  tracking: 'Tracking. Move your body.',
  nobody: 'Step into frame',
  error: 'Camera or model failed',
}

export default function MimicCam({ poseRef, mirror = true }) {
  const videoRef = useRef(null)
  const [status, setStatus] = useState('camera')

  useEffect(() => {
    let cancelled = false
    let raf = 0
    let stream = null
    let landmarker = null
    let lastTs = -1
    const video = videoRef.current

    async function init() {
      try {
        setStatus('camera')
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
          audio: false,
        })
        if (cancelled) return
        video.srcObject = stream
        await video.play()

        setStatus('model')
        const vision = await FilesetResolver.forVisionTasks(WASM_PATH)
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_PATH, delegate: 'GPU' },
          runningMode: 'VIDEO',
          numPoses: 1,
        })
        if (cancelled) return
        setStatus('tracking')

        const loop = () => {
          if (cancelled) return
          if (!document.hidden && video.readyState >= 2) {
            const ts = performance.now()
            // detectForVideo requires strictly increasing timestamps.
            if (ts > lastTs) {
              lastTs = ts
              try {
                const res = landmarker.detectForVideo(video, ts)
                const found = res.worldLandmarks && res.worldLandmarks.length
                poseRef.current = found ? res.worldLandmarks[0] : null
                setStatus(found ? 'tracking' : 'nobody')
              } catch {
                // transient inference hiccup, keep the loop alive
              }
            }
          }
          raf = requestAnimationFrame(loop)
        }
        loop()
      } catch {
        if (!cancelled) setStatus('error')
      }
    }

    init()
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      poseRef.current = null
      try { landmarker?.close?.() } catch { /* already gone */ }
      if (stream) stream.getTracks().forEach((t) => t.stop())
    }
  }, [poseRef])

  return (
    <div className="mimic-cam">
      <video
        ref={videoRef}
        playsInline
        muted
        className="mimic-video"
        style={{ transform: mirror ? 'scaleX(-1)' : 'none' }}
      />
      <span className="mimic-status">{MESSAGES[status] || status}</span>
    </div>
  )
}
