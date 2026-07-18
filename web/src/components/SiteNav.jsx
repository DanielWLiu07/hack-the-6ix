import { NavLink } from 'react-router-dom'
import { createPortal } from 'react-dom'
import '../ui.css'

const LINKS = [
  { to: '/stage', label: 'Stage' },
  { to: '/pov', label: 'Robot POV' },
  { to: '/teleop', label: 'Teleop' },
  { to: '/lidar', label: 'Lidar' },
  { to: '/swarm', label: 'Swarm' },
  { to: '/analytics', label: 'Analytics' },
]

// Used by the immersive views as well as the app shell, so no destination is
// ever hidden just because the page has a custom fullscreen presentation.
export default function SiteNav({ variant = 'control', children }) {
  const stageOverlay = variant === 'stage'
    ? {
        position: 'fixed',
        inset: '0 0 auto 0',
        zIndex: 2147483647,
      }
    : undefined
  const navigation = (
    <header className={`site-nav site-nav--${variant}`} style={stageOverlay}>
      <nav className="site-nav-links" aria-label="Main navigation">
        {LINKS.map(({ to, label, end }) => (
          <NavLink key={to} to={to} end={end}>
            {variant === 'stage' ? (
              <>
                <span className="tv-screen" aria-hidden="true" />
                <span className="tv-label">{label}</span>
              </>
            ) : (
              label
            )}
          </NavLink>
        ))}
      </nav>
      {children && <div className="site-nav-meta">{children}</div>}
    </header>
  )

  // drei's fullscreen HTML layer uses an enormous z-index. The stage nav must
  // live outside that WebGL tree or it can be visually swallowed by the canvas.
  return variant === 'stage' ? createPortal(navigation, document.body) : navigation
}
