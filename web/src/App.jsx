import './App.css'

const stats = [
  { label: 'Fruit picked', value: '—' },
  { label: 'Sort accuracy', value: '—' },
  { label: 'Est. waste avoided', value: '—' },
  { label: 'Robot status', value: 'OFFLINE' },
]

export default function App() {
  return (
    <main className="hero">
      <p className="kicker">HACK THE 6IX 2026</p>
      <h1>
        Battery, <span className="accent">not Blood.</span>
      </h1>
      <p className="sub">
        An autonomous harvest rover that sees fruit with on-arm edge AI, picks
        it, and sorts it into the right bin — apples, bananas, ripe or not.
        Lower food costs. Less waste. No back-breaking labor.
      </p>
      <div className="stats">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <span className="value">{s.value}</span>
            <span className="label">{s.label}</span>
          </div>
        ))}
      </div>
      <p className="note">
        Live dashboard, lidar map & three.js goodness landing here soon 🍎🍌🤖
      </p>
    </main>
  )
}
