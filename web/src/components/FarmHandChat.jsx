// FarmHand chat - the NL command console, rendered chat-style.
//
// Drop into the Robot POV page (or anywhere): `import FarmHandChat from
// '../components/FarmHandChat.jsx'` then `<FarmHandChat />`. Self-contained
// (inline styles, no extra CSS), overlay-friendly (semi-transparent panel).
//
// Data contract (owned by ml/freesolo-agent/client): it emits `nl_command
// {text}` and renders the `nl_action` replies the hub sends back. No mock data -
// every bubble comes from a live hub event.
import { useState, useRef, useEffect, useCallback } from 'react'
import { useRobot, useRobotEvent } from '../lib/robot.jsx'

// nl_action -> a renderable thread entry
function replyEntry(a) {
  if (!a) return null
  if (a.ok && a.action) {
    const { task, fruit, filter, zone } = a.action
    const words = [task, fruit, filter, zone].filter((w) => w && w !== 'any')
    return { kind: 'action', text: words.join(' '), action: a.action, fallback: !!a.fallback }
  }
  if (a.clarification) return { kind: 'clarify', text: a.clarification }
  return { kind: 'reject', text: a.error || 'not understood' }
}

export default function FarmHandChat({ variant = 'default', fill = false, showHeader = true }) {
  const { emit, connected } = useRobot()
  const [thread, setThread] = useState([]) // {who:'you'|'bot', ...}
  const [text, setText] = useState('')
  const scrollRef = useRef(null)
  const S = variant === 'pov' ? S_POV : S_DEFAULT
  const panelStyle = fill
    ? { ...S.panel, width: '100%', maxWidth: 'none', height: '100%', borderRadius: 0, border: 'none', background: 'transparent' }
    : S.panel

  useRobotEvent('nl_action', (a) => {
    const e = replyEntry(a)
    if (e) setThread((t) => [...t, { who: 'bot', ...e }])
  })

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread])

  const send = useCallback(() => {
    const t = text.trim()
    if (!t) return
    setThread((prev) => [...prev, { who: 'you', text: t }])
    emit('nl_command', { text: t })
    setText('')
  }, [text, emit])

  return (
    <div style={panelStyle} className={`farmhand-chat farmhand-chat--${variant}`}>
      {showHeader && (
        <div style={S.header}>
          <span>Pomme</span>
          <span style={{ ...S.dot, background: connected ? '#3ddc84' : '#e5533c' }} />
        </div>
      )}
      <div ref={scrollRef} style={S.thread}>
        {thread.length === 0 && (
          <div style={S.hint}>Command the robot in plain English.</div>
        )}
        {thread.map((m, i) =>
          m.who === 'you' ? (
            <div key={i} style={{ ...S.row, justifyContent: 'flex-end' }}>
              <div style={{ ...S.bubble, ...S.you }}>{m.text}</div>
            </div>
          ) : (
            <div key={i} style={{ ...S.row, justifyContent: 'flex-start' }}>
              <div style={{ ...S.bubble, ...S.bot }}>
                {m.kind === 'action' && (
                  <span>
                    <span style={S.chip}>{m.text}</span>
                    <span style={S.sent}>{m.fallback ? 'sent (offline rules)' : 'sent to robot'}</span>
                  </span>
                )}
                {m.kind === 'clarify' && <span>{m.text}</span>}
                {m.kind === 'reject' && <span style={S.reject}>{m.text}</span>}
              </div>
            </div>
          )
        )}
      </div>
      <div style={S.inputRow}>
        <input
          style={S.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="pick all the ripe apples"
          aria-label="FarmHand command"
        />
        <button style={S.btn} onClick={send} aria-label="send command">Send</button>
      </div>
    </div>
  )
}

const S_DEFAULT = {
  panel: { display: 'flex', flexDirection: 'column', width: 320, maxWidth: '90vw', height: 360,
    background: 'rgba(12,16,20,0.72)', backdropFilter: 'blur(6px)', color: '#e8edf2',
    borderRadius: 12, border: '1px solid rgba(255,255,255,0.12)', overflow: 'hidden',
    fontFamily: 'system-ui, sans-serif', fontSize: 13 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 12px', fontWeight: 600, letterSpacing: 0.3,
    borderBottom: '1px solid rgba(255,255,255,0.1)' },
  dot: { width: 8, height: 8, borderRadius: 8 },
  thread: { flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 6 },
  hint: { opacity: 0.5, textAlign: 'center', marginTop: 24 },
  row: { display: 'flex' },
  bubble: { maxWidth: '82%', padding: '6px 10px', borderRadius: 12, lineHeight: 1.35 },
  you: { background: '#2563eb', color: '#fff', borderBottomRightRadius: 3 },
  bot: { background: 'rgba(255,255,255,0.09)', borderBottomLeftRadius: 3 },
  chip: { display: 'inline-block', background: '#1c7c46', color: '#fff', padding: '1px 8px',
    borderRadius: 6, fontWeight: 600, marginRight: 6 },
  sent: { opacity: 0.6, fontSize: 11 },
  reject: { color: '#ff9b8a' },
  inputRow: { display: 'flex', gap: 6, padding: 8, borderTop: '1px solid rgba(255,255,255,0.1)' },
  input: { flex: 1, background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8, color: '#fff', padding: '7px 10px', outline: 'none' },
  btn: { background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8,
    padding: '7px 12px', fontWeight: 600, cursor: 'pointer' },
}

// POV variant: mono/ink-on-paper theme matching the cockpit's frosted-glass HUD
// (ink text, no blue). The panel sits inside a light glass sidebar.
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const INK = '#191713'
const S_POV = {
  ...S_DEFAULT,
  panel: { display: 'flex', flexDirection: 'column', width: '100%', height: 300,
    background: 'transparent', color: INK, overflow: 'hidden',
    fontFamily: MONO, fontSize: 12 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 2px', fontWeight: 700, letterSpacing: '0.12em', color: 'rgba(25,23,19,0.68)',
    borderBottom: '1px solid rgba(17,16,13,0.16)' },
  thread: { flex: 1, overflowY: 'auto', padding: '8px 2px', display: 'flex', flexDirection: 'column', gap: 6 },
  hint: { opacity: 0.5, textAlign: 'center', marginTop: 18, fontSize: 11, color: 'rgba(25,23,19,0.5)' },
  bubble: { maxWidth: '86%', padding: '5px 9px', borderRadius: 8, lineHeight: 1.35 },
  you: { background: 'rgba(17,16,13,0.9)', color: '#fffdfa', borderBottomRightRadius: 2 },
  bot: { background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(17,16,13,0.14)', color: INK, borderBottomLeftRadius: 2 },
  chip: { display: 'inline-block', background: '#2f7d4e', color: '#fff', padding: '1px 8px',
    borderRadius: 5, fontWeight: 700, marginRight: 6, letterSpacing: '0.04em' },
  sent: { opacity: 0.55, fontSize: 10 },
  reject: { color: '#b23b2b' },
  inputRow: { display: 'flex', gap: 6, padding: '8px 0 0', borderTop: '1px solid rgba(17,16,13,0.16)' },
  input: { flex: 1, background: 'rgba(255,255,255,0.7)', border: '1px solid rgba(17,16,13,0.2)',
    borderRadius: 6, color: INK, padding: '7px 9px', outline: 'none', fontFamily: MONO, fontSize: 12 },
  btn: { background: INK, color: '#fffdfa', border: 'none', borderRadius: 6,
    padding: '7px 11px', fontWeight: 700, cursor: 'pointer', fontFamily: MONO },
}
