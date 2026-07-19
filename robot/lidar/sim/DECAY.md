# Scan accumulation & decay - reference for the web app

How to turn 2 Hz `lidar_scan` events into the "map-ish" glowing point cloud in
the react-three-fiber view. You implement this in JS; this doc is the spec.

## Constraint that shapes the design

`lidar_scan` points are in the **robot frame** and the schema carries **no robot
pose/odometry**. So true world-frame map building isn't possible from this event
alone - accumulated scans must be rendered **robot-centered** (the world appears
to rotate/slide around a fixed robot, like a ship radar). That looks great and
is exactly the "few seconds of decay" effect in the plan. Don't attempt
world-frame accumulation; without pose it just smears.

## Algorithm (ring buffer + age-based fade)

Keep the last K scans; fade each by age; drop when fully faded.

- 2 Hz input, fade time T = 4 s -> K = 8 scans ≈ ≤2 880 points. Trivial for three.js.
- Per-scan alpha: `alpha = max(0, 1 - age/T)` (linear) or `exp(-age/tau)`, tau ≈ 1.5 s.
- Newest scan full brightness; optionally tint by age (e.g. lerp cyan -> deep blue).

### Simple version (recommended first): one `<points>` per scan

```jsx
// scans: [{id, ts, positions: Float32Array}]  - ring buffer, push on socket event
socket.on("lidar_scan", ({ points }) => {
  const pos = new Float32Array(points.length * 3);
  points.forEach(([x, y], i) => pos.set([x, 0, -y], i * 3)); // lidar frame -> three.js
  setScans(s => [...s, { id: nextId++, ts: performance.now(), positions: pos }].slice(-K));
});

// per frame (useFrame): material.opacity = Math.max(0, 1 - (now - scan.ts) / 4000)
// render: <points><bufferGeometry attach="geometry" ...pos/><pointsMaterial
//   size={0.06} transparent depthWrite={false} color={...} /></points>
```

~8 draw calls - fine. `depthWrite={false}` + additive blending gives the glow look.

### Optimized version (only if needed): single preallocated buffer

One `THREE.Points` with a `K*360*3` position buffer and a per-point float
`aBirth` attribute; a tiny shader computes alpha from `uTime - aBirth`. Write
each new scan into slot `i % K`. Zero allocation, one draw call. Not needed at
these point counts - do the simple version first.

## Frame mapping (get this right or the map is mirrored)

Lidar/robot frame: **+x forward, +y left, CCW positive, meters** (ROS
convention). For a three.js ground plane with Y-up:

    three.x = lidar.x        (forward)
    three.y = 0              (or small per-scan height offset for style)
    three.z = -lidar.y       (three.js is right-handed Y-up; negate to avoid mirror)

Draw a small robot marker (cone pointing +x) at the origin so orientation is
obvious, and a faint 1 m grid for scale. Room in the sim is 8×6 m - camera at
~10 m works.

## Nice-to-haves (cheap)

- Color newest scan white/cyan, older scans darker blue -> motion trails read instantly.
- `sizeAttenuation` on, point size 0.05-0.08 world units.
- Clamp/ignore scans with `points.length === 0` (possible on dropout).
- If scans stop arriving (robot offline), let everything fade out - free "signal lost" UX.

## Test source

`robot/lidar/sim/` emits realistic scans (moving robot, moving obstacle, noise,
dropout) to the server at 2 Hz - see its README. Point count varies ~340-360
per scan; handle variable length.
