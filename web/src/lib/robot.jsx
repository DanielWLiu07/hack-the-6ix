import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { io } from 'socket.io-client'
import { startSim } from './sim.js'
import { startSlamDemo } from './slamDemo.js'

export const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || 'http://localhost:3001'

const SIM = new URLSearchParams(window.location.search).has('sim')

const RobotContext = createContext(null)

// Tiny event bus shared by the socket and the browser sim so every page
// consumes one stream regardless of source.
function makeBus() {
  const listeners = new Map()
  return {
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(cb)
      return () => listeners.get(event)?.delete(cb)
    },
    push(event, payload) {
      listeners.get(event)?.forEach((cb) => cb(payload))
    },
    onCommand: null, // sim hook: web -> robot commands loop back here
  }
}

export function RobotProvider({ children, authToken = null, authReady = true }) {
  const busRef = useRef(null)
  if (!busRef.current) busRef.current = makeBus()
  const bus = busRef.current

  const socketRef = useRef(null)
  const [connected, setConnected] = useState(false)
  const [telemetry, setTelemetry] = useState(null)
  const [detections, setDetections] = useState([])
  const [picks, setPicks] = useState([])
  // SLAM demo: local frozen+navigable map feed for when there is no live hub
  // (deployed site). Operator-toggled; routes commands to the demo, not a socket.
  // State is mirrored in localStorage so the POV page and its /pov-slam iframe
  // (separate documents, separate providers) stay in sync: the DEMO button
  // lives in the iframe while the command console lives in the parent.
  const [demo, setDemo] = useState(() => {
    try { return localStorage.getItem('ht6-demo') === '1' } catch { return false }
  })
  const demoRef = useRef(false)
  demoRef.current = demo
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'ht6-demo') setDemo(e.newValue === '1')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  useEffect(() => {
    const offs = [
      bus.on('telemetry', setTelemetry),
      bus.on('detection', (d) =>
        setDetections((prev) => [d, ...prev].slice(0, 20)),
      ),
      bus.on('pick_event', (p) => setPicks((prev) => [p, ...prev].slice(0, 50))),
    ]
    return () => offs.forEach((off) => off())
  }, [bus])

  useEffect(() => {
    if (!authReady) return undefined
    if (SIM) {
      setConnected(true)
      return startSim(bus)
    }
    const socket = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      auth: { role: 'ui', ...(authToken ? { token: authToken } : {}) },
    })
    socketRef.current = socket
    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    const SLAM_EVENTS = new Set(['lidar_scan', 'slam_map', 'slam_pose', 'nav_path'])
    for (const ev of [
      'telemetry',
      'detection',
      'pick_event',
      'lidar_scan',
      'slam_map',
      'slam_pose',
      'nav_path',
      'nl_action',
      'fleet',
    ]) {
      socket.on(ev, (payload) => {
        // While the local SLAM demo is on it owns the map: drop live slam_* so the
        // two feeds don't fight (the demo is meant for the no-hub deployment).
        if (demoRef.current && SLAM_EVENTS.has(ev)) return
        bus.push(ev, payload)
      })
    }
    return () => socket.disconnect()
  }, [bus, authReady, authToken])

  // Demo feed lives alongside the socket: when on, it pushes slam_* into the bus.
  useEffect(() => {
    if (!demo) return undefined
    return startSlamDemo(bus)
  }, [bus, demo])

  const emit = useCallback((event, payload = {}) => {
    if (SIM || demoRef.current) bus.onCommand?.(event, payload)
    else socketRef.current?.emit(event, payload)
  }, [bus])

  const toggleDemo = useCallback(() => {
    setDemo((d) => {
      const next = !d
      try { localStorage.setItem('ht6-demo', next ? '1' : '0') } catch { /* private mode */ }
      return next
    })
  }, [])

  const value = useMemo(
    () => ({ connected, sim: SIM, demo, toggleDemo, telemetry, detections, picks, emit, bus }),
    [connected, demo, toggleDemo, telemetry, detections, picks, emit, bus],
  )
  return <RobotContext.Provider value={value}>{children}</RobotContext.Provider>
}

export function useRobot() {
  const ctx = useContext(RobotContext)
  if (!ctx) throw new Error('useRobot must be used inside <RobotProvider>')
  return ctx
}

// Subscribe to a raw event stream (e.g. lidar_scan) without re-rendering
// through React state.
export function useRobotEvent(event, cb) {
  const { bus } = useRobot()
  const cbRef = useRef(cb)
  cbRef.current = cb
  useEffect(() => bus.on(event, (p) => cbRef.current(p)), [bus, event])
}
