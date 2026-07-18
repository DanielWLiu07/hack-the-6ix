// blob.js - optional Vercel Blob upload for pick photos.
//
// Fully env-gated: with BLOB_READ_WRITE_TOKEN unset this is a no-op and callers
// fall back to the local file the hub serves at /media. When the token IS set,
// each pick photo also lands on public Blob storage so it loads on the Vercel
// dashboard and judges' phones - not just clients that can reach the laptop hub.
//
// Get a token: Vercel dashboard → project hack-the-6ix → Storage → Blob → create
// store (or `vercel blob store add ht6-media`); put BLOB_READ_WRITE_TOKEN in
// web/server/.env. Cloud is fine here - the Qualcomm "no cloud" rule is about
// robot vision INFERENCE, not the web app's images.

import { put } from '@vercel/blob';

const token = () => process.env.BLOB_READ_WRITE_TOKEN;

export function blobEnabled() {
  return !!token();
}

// Upload bytes → return the public https URL, or null on any failure (caller
// falls back to the local /media copy). Never throws.
export async function uploadImage(pathname, bytes, contentType) {
  const t = token();
  if (!t) return null;
  try {
    const { url } = await put(pathname, bytes, {
      access: 'public',
      token: t,
      contentType,
      addRandomSuffix: false, // pick_<ts> names are already unique
      allowOverwrite: true, // idempotent re-runs shouldn't error
      cacheControlMaxAge: 3600,
    });
    return url;
  } catch (err) {
    console.warn('[blob] upload failed, using local fallback:', err.message);
    return null;
  }
}
