// Resource Owner Password Grant (ROPG) sign-in: authenticate against Auth0
// WITHOUT the hosted-page redirect, by POSTing credentials straight to the
// tenant token endpoint. Used by the in-scene board login form.
//
// Tenant prerequisites (Auth0 dashboard):
//   - Application > Advanced > Grant Types: enable "Password".
//   - A database connection (default: Username-Password-Authentication) with a
//     user, enabled on the application.
//   - Settings > Allowed Web Origins: include this app's origin (CORS for the
//     token endpoint call below).
//   - Tenant default directory set to that connection, or rely on the
//     password-realm grant + realm param used here.

const DOMAIN = import.meta.env.VITE_AUTH0_DOMAIN
const CLIENT_ID = import.meta.env.VITE_AUTH0_CLIENT_ID
const AUDIENCE = import.meta.env.VITE_AUTH0_AUDIENCE
// The database connection to authenticate against. Override with
// VITE_AUTH0_REALM if the tenant uses a differently named connection.
const REALM = import.meta.env.VITE_AUTH0_REALM || 'Username-Password-Authentication'

export const ROPG_CONFIGURED = Boolean(DOMAIN && CLIENT_ID)

// The only redirect_uri registered for this SPA app in the tenant. Signup
// returns here; the app then strips the code and sends the user to the board.
const SIGNUP_RETURN_PATH = '/teleop'

// "Create an account": leave the app for Auth0's hosted signup screen. We do not
// complete the returned code exchange (the user signs in via the on-board form
// afterward with their new credentials), so a static PKCE challenge just to
// satisfy the public-client requirement to start the flow is fine.
export function signupRedirect() {
  if (!ROPG_CONFIGURED) return
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: window.location.origin + SIGNUP_RETURN_PATH,
    response_type: 'code',
    scope: 'openid profile email',
    screen_hint: 'signup',
    code_challenge: 'ht6orchardpassht6orchardpassht6orchardpass1',
    code_challenge_method: 'S256',
  })
  window.location.href = `https://${DOMAIN}/authorize?${params.toString()}`
}

// Decode a JWT payload (no verification; just to read name/email for display).
function decodeJwt(token) {
  try {
    const payload = token.split('.')[1]
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(decodeURIComponent(escape(json)))
  } catch {
    return {}
  }
}

// Attempt a password sign-in. Resolves to { ok, user, token } on success or
// { ok: false, error } with a human-readable message on failure.
export async function passwordLogin(username, password) {
  if (!ROPG_CONFIGURED) {
    return { ok: false, error: 'Auth is not configured.' }
  }
  const body = {
    grant_type: 'http://auth0.com/oauth/grant-type/password-realm',
    realm: REALM,
    username,
    password,
    client_id: CLIENT_ID,
    scope: 'openid profile email',
    ...(AUDIENCE ? { audience: AUDIENCE } : {}),
  }
  let res
  try {
    res = await fetch(`https://${DOMAIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // A network/CORS failure lands here (e.g. origin not in Allowed Web Origins).
    return { ok: false, error: 'Could not reach the sign-in service.' }
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Auth0 returns generic 'invalid_grant' for bad credentials on purpose.
    const map = {
      invalid_grant: 'Wrong username or password.',
      invalid_request: 'Sign-in is not enabled for this tenant yet.',
      unauthorized_client: 'Password sign-in is not enabled for this app.',
      access_denied: data.error_description || 'Access denied.',
    }
    return { ok: false, error: map[data.error] || data.error_description || 'Sign-in failed.' }
  }
  const claims = decodeJwt(data.id_token || '')
  // Session expiry: prefer the token's own exp, else now + expires_in.
  const exp = claims.exp
    || (data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : null)
  return {
    ok: true,
    token: data.access_token || data.id_token || '',
    exp,
    user: {
      name: claims.name || claims.nickname || claims.email || username,
      email: claims.email || username,
      picture: claims.picture || '',
    },
  }
}
