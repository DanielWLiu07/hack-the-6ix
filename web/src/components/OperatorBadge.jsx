import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useOperator, operatorLabel } from '../lib/auth.jsx'
import './OperatorBadge.css'

// Global signed-in indicator. Best-practice account pattern: a small avatar
// button in the corner that opens a menu with the identity + Sign out, so it
// takes almost no space. Rendered once at the app root; rides over every route.
// Hidden on the landing (its own on-board chip) and the immersive stage.
const HIDE_ON = new Set(['/', '/stage', '/stage/tv', '/pov-slam'])

function initials(label) {
  if (!label) return '?'
  const local = label.split('@')[0]
  const parts = local.split(/[.\-_\s]+/).filter(Boolean)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2)
  return chars.toUpperCase()
}

export default function OperatorBadge() {
  const { operator, logout } = useOperator()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!operator || HIDE_ON.has(pathname)) return null
  const label = operatorLabel(operator)

  return (
    <div className="operator-badge" ref={ref}>
      <button
        type="button"
        className="operator-avatar"
        title={label}
        aria-label={`Account: ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {initials(label)}
      </button>
      {open && (
        <div className="operator-menu" role="menu">
          <div className="operator-menu-id">
            <span className="operator-menu-eyebrow">Signed in as</span>
            <span className="operator-menu-name" title={label}>{label}</span>
          </div>
          <button type="button" className="operator-menu-signout" onClick={() => { setOpen(false); logout() }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
