import { Link } from 'react-router-dom'
import './BackToStage.css'

// Fixed back-to-stage control for the non-landing, non-stage views so every
// page has a one-tap route back to the hub. Landing and the stage own their
// own navigation and do not render this. Pages that already ship a bespoke
// stage link (Swarm, Info) are left as-is.
export default function BackToStage() {
  return (
    <Link to="/stage" className="back-to-stage" aria-label="Back to stage">
      <svg className="back-to-stage-chevron" width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
        <path
          d="M9.2 3 L4.7 7.5 L9.2 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>Stage</span>
    </Link>
  )
}
