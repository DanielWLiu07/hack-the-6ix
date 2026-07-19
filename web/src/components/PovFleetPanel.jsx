import { useState } from 'react'
import { Link } from 'react-router-dom'
import FarmHandChat from './FarmHandChat.jsx'
import FleetRobotSplat from './FleetRobotSplat.jsx'

// PovFleetPanel - the cockpit's mission-control sidebar. Two side-by-side tabs:
// FLEET (a splat capture of the scanned rover + the live roster, click a rover to
// "enter" it in POV) and CHAT (the FarmHand NL command console, which owns
// nl_command/nl_action broadcast to the fleet - the real robot executes, sim
// rovers stand in). Roster is the live `fleet` event. No mock data. Purely
// presentational; the parent (RobotPOV) owns fleet + selection.

// Darker state tones so the dots/pills read on the light frosted-glass panel.
const stateColorMap = {
  IDLE: '#6f6a61', SEEK: '#2f7db0', PICK: '#c2781f', SORT: '#2f9d54', ESTOP: '#d4483a',
}
const stateColor = (s) => stateColorMap[s] || '#8a857b'
const battPct = (v) => (typeof v === 'number' ? Math.max(0, Math.min(1, (v - 9.9) / 2.7)) : 0)

export default function PovFleetPanel({ fleet, activeId, onPick }) {
  const [tab, setTab] = useState('fleet') // fleet | chat

  return (
    <div className="povf">
      <div className="povf-tabs">
        <button
          className={`povf-tab ${tab === 'fleet' ? 'on' : ''}`}
          onClick={() => setTab('fleet')}
        >
          FLEET · {fleet.length}
        </button>
        <button
          className={`povf-tab ${tab === 'chat' ? 'on' : ''}`}
          onClick={() => setTab('chat')}
        >
          COMMAND
        </button>
      </div>

      {tab === 'fleet' ? (
        <div className="povf-pane">
          <FleetRobotSplat />
          <div className="povf-sec-head">
            <span>FLEET · {fleet.length}</span>
            <Link className="povf-swarm" to="/swarm" title="Full swarm command center">SWARM ›</Link>
          </div>
          <div className="povf-roster">
            {fleet.length === 0 && <div className="povf-empty">no robots on the hub</div>}
            {fleet.map((r) => {
              const col = stateColor(r.state)
              const pct = battPct(r.battery_v)
              return (
                <button
                  key={r.id}
                  className={`povf-card ${activeId === r.id ? 'on' : ''}`}
                  onClick={() => onPick(r.id)}
                  title={`Enter ${r.id}`}
                >
                  <span className="povf-card-top">
                    <i className="povf-led" style={{ background: col }} />
                    <span className="povf-id">{r.id}</span>
                    {r.sim && <span className="povf-sim">sim</span>}
                    <span className="povf-state" style={{ color: col, borderColor: col }}>{r.state || 'IDLE'}</span>
                  </span>
                  <span className="povf-batt">
                    <span className="track">
                      <span
                        className={pct < 0.2 ? 'crit' : pct < 0.4 ? 'warn' : ''}
                        style={{ width: `${pct * 100}%` }}
                      />
                    </span>
                    <span className="povf-batt-v">{typeof r.battery_v === 'number' ? `${r.battery_v.toFixed(1)}V` : '-'}</span>
                  </span>
                  <span className="povf-drive">
                    DRIVE L {(r.drive?.l ?? 0).toFixed(2)} · R {(r.drive?.r ?? 0).toFixed(2)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="povf-pane povf-pane-chat">
          <div className="povf-sec-head">FARMHAND · fleet command</div>
          <div className="povf-cmd">
            <FarmHandChat variant="pov" fill showHeader={false} />
          </div>
        </div>
      )}
    </div>
  )
}
