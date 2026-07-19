import { useEffect, useState } from 'react'

// drei's <Splat> loader (core/Splat.js) reads response.headers.get('Content-Length')
// and throws "Failed to get content length" when it is absent. Vercel Brotli-
// compresses the .splat and drops Content-Length, so the splat loads in dev (Vite
// serves it raw) but fails in production. Fetch the file ourselves - the browser
// transparently decompresses the transfer encoding - and hand drei a blob: URL,
// which always reports a correct Content-Length and carries no Content-Encoding.
export function useSplatBlobUrl(url) {
  const [blobUrl, setBlobUrl] = useState(null)
  useEffect(() => {
    let objectUrl
    let cancelled = false
    fetch(url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }))
        setBlobUrl(objectUrl)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])
  return blobUrl
}
