// Global operator session for the ROPG sign-in (see lib/ropg.js). Holds the
// signed-in operator, persists it to localStorage so it survives refreshes and
// is shared across every page/route, and drops it when the token expires.
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const KEY = 'ht6.operator'
const AuthCtx = createContext(null)

function loadStored() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    // Expired sessions are dropped on load so a stale token never lingers.
    if (data?.exp && Date.now() / 1000 >= data.exp) {
      localStorage.removeItem(KEY)
      return null
    }
    return data && data.user ? data : null
  } catch {
    return null
  }
}

export function OperatorAuthProvider({ children }) {
  const [operator, setOperator] = useState(loadStored)

  const login = useCallback((result) => {
    // result: { token, user, exp } from passwordLogin
    const data = { user: result.user, token: result.token, exp: result.exp || null }
    setOperator(data)
    try { localStorage.setItem(KEY, JSON.stringify(data)) } catch { /* private mode */ }
  }, [])

  const logout = useCallback(() => {
    setOperator(null)
    try { localStorage.removeItem(KEY) } catch { /* private mode */ }
  }, [])

  // Auto sign-out when the token's lifetime runs out mid-session. setTimeout
  // overflows past ~24.8 days (fires instantly), so cap it and re-arm on wake.
  useEffect(() => {
    if (!operator?.exp) return undefined
    const ms = operator.exp * 1000 - Date.now()
    if (ms <= 0) { logout(); return undefined }
    const id = setTimeout(logout, Math.min(ms, 2 ** 31 - 1))
    return () => clearTimeout(id)
  }, [operator, logout])

  // A session can lapse while the tab is hidden (timers are throttled/parked):
  // re-check whenever the tab regains focus and drop it if it expired.
  useEffect(() => {
    const recheck = () => {
      const cur = loadStored()
      if (!cur && operator) setOperator(null)
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [operator])

  // Keep tabs in sync: signing in/out in one tab updates the others.
  useEffect(() => {
    const onStorage = (e) => { if (e.key === KEY) setOperator(loadStored()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return <AuthCtx.Provider value={{ operator, login, logout }}>{children}</AuthCtx.Provider>
}

export function useOperator() {
  return useContext(AuthCtx) || { operator: null, login: () => {}, logout: () => {} }
}

// Display handle for an operator: prefer the email (real identification), then
// name, then a generic fallback.
export function operatorLabel(operator) {
  if (!operator?.user) return ''
  return operator.user.email || operator.user.name || 'Operator'
}
