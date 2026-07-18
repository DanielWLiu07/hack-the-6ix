// Shared GPU hygiene for every r3f Canvas in the app. Chrome's GPU process was
// crashing under combined WebGL load, so each Canvas drops <CanvasGuard/> inside
// it to: (1) pause the render loop while the document is hidden (a backgrounded
// tab must not keep feeding the GPU), and (2) recover from a context loss / GPU
// reset instead of leaving a dead black canvas.
//
// Also export SAFE_DPR so no Canvas asks for more than 1.5x device pixels.

import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

export const SAFE_DPR = [1, 1.5]

export function CanvasGuard() {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const setFrameloop = useThree((s) => s.setFrameloop)

  // Pause/resume the loop with page visibility. setFrameloop('never') stops all
  // useFrame work (including manual render passes); 'always' resumes it.
  useEffect(() => {
    const sync = () => {
      if (document.hidden) {
        setFrameloop('never')
      } else {
        setFrameloop('always')
        invalidate()
      }
    }
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      document.removeEventListener('visibilitychange', sync)
      setFrameloop('always')
    }
  }, [setFrameloop, invalidate])

  // GPU context recovery. Calling preventDefault on the loss event lets the
  // browser restore the same canvas; on restore we kick a frame so the picture
  // comes back instead of staying black.
  useEffect(() => {
    const canvas = gl.domElement
    const onLost = (event) => {
      event.preventDefault()
      setFrameloop('never')
    }
    const onRestored = () => {
      setFrameloop('always')
      invalidate()
    }
    canvas.addEventListener('webglcontextlost', onLost, false)
    canvas.addEventListener('webglcontextrestored', onRestored, false)
    return () => {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }
  }, [gl, setFrameloop, invalidate])

  return null
}
