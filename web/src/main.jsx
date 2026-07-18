import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Auth0Provider } from '@auth0/auth0-react'
import './index.css'
import App from './App.jsx'
import Layout from './components/Layout.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Teleop from './pages/Teleop.jsx'
import Analytics from './pages/Analytics.jsx'

// three.js is ~1 MB — only load it when the lidar page is opened
const LidarView = lazy(() => import('./pages/LidarView.jsx'))
import { RobotProvider } from './lib/robot.jsx'

const AUTH0_DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN
const AUTH0_CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID

function MaybeAuth0({ children }) {
  if (!AUTH0_DOMAIN || !AUTH0_CLIENT_ID) return children
  return (
    <Auth0Provider
      domain={AUTH0_DOMAIN}
      clientId={AUTH0_CLIENT_ID}
      authorizationParams={{ redirect_uri: window.location.origin + '/teleop' }}
    >
      {children}
    </Auth0Provider>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MaybeAuth0>
      <RobotProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<App />} />
            <Route element={<Layout />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/teleop" element={<Teleop />} />
              <Route
                path="/lidar"
                element={
                  <Suspense fallback={<p className="empty">Loading 3D view…</p>}>
                    <LidarView />
                  </Suspense>
                }
              />
              <Route path="/analytics" element={<Analytics />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </RobotProvider>
    </MaybeAuth0>
  </StrictMode>,
)
