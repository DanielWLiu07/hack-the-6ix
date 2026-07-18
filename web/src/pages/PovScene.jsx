import { Link } from 'react-router-dom'
import '../App.css'

// The original scene's robot-POV design, self-hosted at /scene/pov.html and
// embedded fullscreen (same pattern as the landing scene embed). The React POV
// rebuild stays reachable at /pov-live.
export default function PovScene() {
  return (
    <main className="hero-stage">
      <iframe className="hero-embed" src="/scene/pov.html" title="Robot POV" />
      <Link className="scene-chip" to="/stage">
        Stage
      </Link>
    </main>
  )
}
