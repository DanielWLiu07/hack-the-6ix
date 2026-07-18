// Warm a lazy page's chunk before navigating to it, so the TV tune-in reveals
// the real page instead of a blank Suspense fallback. import() is cached and
// resolves to the same module as main.jsx's React.lazy, so the lazy component
// mounts instantly once this has run. Called on TV click (startZoom), which
// gives the chunk the camera zoom + static cover + hold to finish loading.
const IMPORTERS = {
  '/pov': () => import('../pages/RobotPOV.jsx'),
  '/teleop': () => import('../pages/Teleop.jsx'),
  '/lidar': () => import('../pages/LidarView.jsx'),
  '/analytics': () => import('../pages/Analytics.jsx'),
  '/swarm': () => import('../pages/Swarm.jsx'),
  '/harvest': () => import('../pages/Harvest.jsx'),
  '/info': () => import('../pages/Info.jsx'),
}

export function preloadRoute(to) {
  IMPORTERS[to]?.().catch(() => {})
}
