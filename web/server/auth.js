// auth.js - optional Auth0 JWT verification for the hub.
//
// Env-gated: with AUTH0_DOMAIN + AUTH0_AUDIENCE unset this is a no-op (dev
// bypass, current behavior) - verifyToken() returns null and clients are
// treated as anonymous. When set, the hub verifies the Auth0 access token a
// browser passes on the socket handshake and attaches the operator identity.
//
// HACKATHON POSTURE: we authenticate + ATTRIBUTE, we do NOT restrict data -
// every logged-in user sees the same shared dashboard. The identity is used
// only to stamp `operator` on picks/commands (the Atlas audit trail) - the
// MongoDB<->Auth0 synergy for the tracks. See docs/MONGODB_AUTH0.md.

import { createRemoteJWKSet, jwtVerify } from 'jose';

const DOMAIN = () => process.env.AUTH0_DOMAIN; // e.g. dev-xxx.us.auth0.com (no https://)
const AUDIENCE = () => process.env.AUTH0_AUDIENCE; // the Auth0 API identifier
const ROLES_CLAIM = process.env.AUTH0_ROLES_CLAIM || 'https://ht6/roles';

let jwks = null;
function getJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(`https://${DOMAIN()}/.well-known/jwks.json`));
  return jwks;
}

export function authEnabled() {
  return !!(DOMAIN() && AUDIENCE());
}

// Verify a bearer access token -> { sub, email, name, roles } or null (invalid,
// absent, or auth disabled). Never throws.
export async function verifyToken(token) {
  if (!authEnabled() || !token) return null;
  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://${DOMAIN()}/`,
      audience: AUDIENCE(),
    });
    return {
      sub: payload.sub,
      email: payload.email ?? payload[`${ROLES_CLAIM}/email`] ?? null,
      name: payload.name ?? payload.nickname ?? null,
      roles: Array.isArray(payload[ROLES_CLAIM]) ? payload[ROLES_CLAIM] : [],
    };
  } catch (err) {
    console.warn('[auth] token verify failed:', err.message);
    return null;
  }
}

// A short, stable operator label for attribution/audit (Auth0 sub is canonical).
export function operatorLabel(identity) {
  return identity ? identity.email || identity.sub : null;
}
