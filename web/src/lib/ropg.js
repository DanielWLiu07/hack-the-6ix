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
  return {
    ok: true,
    token: data.access_token || data.id_token || '',
    user: {
      name: claims.name || claims.nickname || claims.email || username,
      email: claims.email || '',
      picture: claims.picture || '',
    },
  }
}
