import { StrictMode, Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react'
import './index.css'
import App from './App.jsx'
import Layout from './components/Layout.jsx'
import Teleop from './pages/Teleop.jsx'
import Analytics from './pages/Analytics.jsx'
import Harvest from './pages/Harvest.jsx'

// three.js is ~1 MB - only load it when the lidar page is opened
const LidarView = lazy(() => import('./pages/LidarView.jsx'))
// Robot POV also pulls in three.js - lazy for the same reason
const RobotPOV = lazy(() => import('./pages/RobotPOV.jsx'))
// monkey-page stage (TV + rising manga monkey) - heavy 3D, lazy-loaded
const MonkeyStage = lazy(() => import('./pages/MonkeyStage.jsx'))
import { RobotProvider } from './lib/robot.jsx'

const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID
const AUTH0_AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE

// Auth0 is optional for local UI work. When enabled, fetch an API access token
// before opening the Socket.IO connection so the hub can verify it and stamp
// commands/picks with the authenticated operator.
function AuthenticatedRobotProvider({ children }) {
  const { isLoading, isAuthenticated, getAccessTokenSilently } = useAuth0()
  const [token, setToken] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let active = true
    if (isLoading) return undefined
    if (!isAuthenticated || !AUTH0_AUDIENCE) {
      setToken(null)
      setReady(true)
      return undefined
    }

    setReady(false)
    getAccessTokenSilently({
      authorizationParams: { audience: AUTH0_AUDIENCE },
    })
      .then((nextToken) => {
        if (active) setToken(nextToken)
      })
      .catch((error) => {
        // Keep read-only pages usable; Teleop remains behind its login gate.
        console.warn('Could not get Auth0 API access token:', error.message)
        if (active) setToken(null)
      })
      .finally(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [isLoading, isAuthenticated, getAccessTokenSilently])

  return <RobotProvider authToken={token} authReady={ready}>{children}</RobotProvider>
}

function MaybeRobotProvider({ children }) {
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID) return <RobotProvider>{children}</RobotProvider>
  return <AuthenticatedRobotProvider>{children}</AuthenticatedRobotProvider>
}

function MaybeAuth0({ children }) {
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID) return children
  return (
    <Auth0Provider
      domain={AUTH0_DOMAIN}
      clientId={AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin + '/teleop',
        ...(AUTH0_AUDIENCE ? { audience: AUTH0_AUDIENCE } : {}),
      }}
    >
      {children}
    </Auth0Provider>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MaybeAuth0>
      <MaybeRobotProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />} />
            <Route
              path="/stage"
              element={
                <Suspense fallback={<p className="empty">Loading...</p>}>
                  {/* Direct visit: play the fuzzy-screen -> zoom-out intro too. */}
                  <MonkeyStage playIntro />
                </Suspense>
              }
            />
            {/* Robot POV: real robot feed + manga machine-fringe overlay. The
                painterly/apple scene is landing-only; do not embed it here. */}
            <Route
              path="/pov"
              element={
                <Suspense fallback={<p className="empty">Loading POV...</p>}>
                  <RobotPOV />
                </Suspense>
              }
            />
            <Route path="/teleop" element={<Teleop />} />
            <Route element={<Layout />}>
            {/* Kept as a compatibility redirect; the stage is the app hub. */}
            <Route path="/dashboard" element={<Navigate replace to="/stage" />} />
              <Route
                path="/lidar"
                element={
                  <Suspense fallback={<p className="empty">Loading 3D view...</p>}>
                    <LidarView />
                  </Suspense>
                }
              />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/harvest" element={<Harvest />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </MaybeRobotProvider>
    </MaybeAuth0>
  </StrictMode>,
)
