import { useEffect, useState } from 'react'

// Landing intro beat: an apple flies up, the "camera" pulls out, and the
// monkey mascot pops in with a speech bubble — then it fades to reveal the
// scene + nav. Skippable (click) and plays once per session.
export default function IntroSequence({ onDone }) {
  const [gone, setGone] = useState(false)

  const finish = () => {
    if (gone) return
    setGone(true)
    onDone?.()
  }

  useEffect(() => {
    const t = setTimeout(finish, 3400)
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (gone) return null

  return (
    <div className="intro" onClick={finish} role="presentation">
      <div className="intro-stage">
        <div className="intro-apple" aria-hidden>🍎</div>
        <div className="intro-monkey" aria-hidden>🐒</div>
        <div className="intro-bubble">
          Battery, <span className="accent">not Blood.</span>
        </div>
      </div>
      <div className="intro-skip">click to skip</div>
    </div>
  )
}
