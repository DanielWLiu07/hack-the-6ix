import { Outlet } from 'react-router-dom'
import '../ui.css'

export default function Layout() {
  return (
    <div className="shell">
      <div className="page">
        <Outlet />
      </div>
    </div>
  )
}
