import { useLocation } from 'react-router-dom'
import { useOperator, operatorLabel } from '../lib/auth.jsx'
import './OperatorBadge.css'

// Global signed-in chip. Rendered once at the app root, it rides over every
// route as a fixed element so the persistent session is visible and revocable
// anywhere. Hidden on the landing (which has its own on-board chip) and on the
// immersive stage so it never covers those bespoke scenes.
const HIDE_ON = new Set(['/', '/stage', '/stage/tv', '/pov-slam'])

export default function OperatorBadge() {
  const { operator, logout } = useOperator()
  const { pathname } = useLocation()
  if (!operator || HIDE_ON.has(pathname)) return null
  const label = operatorLabel(operator)
  return (
    <div className="operator-badge" title={label}>
      <span className="operator-badge-dot" aria-hidden="true" />
      <span className="operator-badge-name">{label}</span>
      <button type="button" onClick={logout}>Sign out</button>
    </div>
  )
}
