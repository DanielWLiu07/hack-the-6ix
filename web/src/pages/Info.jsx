import { Link } from 'react-router-dom'
import LandingInfo from '../components/LandingInfo.jsx'
import './Info.css'

// /info route: the shared LandingInfo body plus page chrome (nav + intro).
export default function Info() {
  return (
    <div className="info-page">
      <nav className="info-nav">
        <Link className="home" to="/">Home</Link>
        <Link to="/stage">Stage</Link>
        <Link to="/teleop">Teleop</Link>
        <Link to="/lidar">Lidar</Link>
        <Link to="/analytics">Analytics</Link>
      </nav>

      <header className="info-hero">
        <p className="info-eyebrow">How it works</p>
        <h1>The dual-brain <span className="amber">harvest robot</span></h1>
        <p className="info-lede">
          One board, two brains. A Qualcomm Linux processor does all the seeing
          and thinking; a separate real-time microcontroller owns motion and
          safety. The AI runs on the robot itself, on about the power of a phone
          charger, with no cloud. Below: the full technology stack, the command
          safety gate, and the pick-and-sort loop.
        </p>
      </header>

      <LandingInfo />
    </div>
  )
}
