import { NavLink, Outlet, Link } from 'react-router-dom'
import { useRobot } from '../lib/robot.jsx'
import '../ui.css'

export default function Layout() {
  const { connected, sim } = useRobot()
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          🍎 Battery, <span className="accent">not Blood.</span>
        </Link>
        <nav>
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/teleop">Teleop</NavLink>
          <NavLink to="/lidar">Lidar</NavLink>
          <NavLink to="/analytics">Analytics</NavLink>
        </nav>
        {sim && <span className="simnote">SIM MODE — fake data</span>}
        <span className={`conn ${connected ? 'ok' : ''}`}>
          <span className="dot" />
          {connected ? (sim ? 'SIMULATED' : 'CONNECTED') : 'OFFLINE'}
        </span>
      </header>
      <div className="page">
        <Outlet />
      </div>
    </div>
  )
}
