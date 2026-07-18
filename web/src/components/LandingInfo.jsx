import '../pages/Info.css'

// Shared "how it works" body: color key, the dual-brain architecture board, the
// command safety gate, the pick-and-sort loop, and the technology-stack icon
// wall. Rendered both on the /info route (with page chrome) and below the
// landing hero (scroll-reveal). Self-contained styling lives in Info.css; the
// --i-* palette vars are defined on .info-body so this works anywhere.

function Tile({ icon, name, role }) {
  return (
    <div className="ti">
      <div className="ico">{icon}</div>
      <div className="lab">
        <b>{name}</b>
        <span>{role}</span>
      </div>
    </div>
  )
}

const Mono = ({ children }) => <span className="mono">{children}</span>

export default function LandingInfo() {
  return (
    <div className="info-body">
      <div className="info-legend" role="list" aria-label="Color key">
        <span className="info-key" role="listitem"><span className="dot" style={{ background: '#123f3980', borderColor: 'var(--i-teal)' }} />Perception and planning (Linux MPU)</span>
        <span className="info-key" role="listitem"><span className="dot" style={{ background: '#143a5280', borderColor: 'var(--i-sky)' }} />AI models</span>
        <span className="info-key" role="listitem"><span className="dot" style={{ background: '#4a341380', borderColor: 'var(--i-amber)' }} />Real-time control (MCU)</span>
        <span className="info-key" role="listitem"><span className="dot" style={{ background: '#4d211a80', borderColor: 'var(--i-safety)' }} />Safety reflexes</span>
        <span className="info-key" role="listitem"><span className="dot" style={{ background: '#17401f80', borderColor: 'var(--i-leaf)' }} />Web and data</span>
        <span className="info-key" role="listitem"><span className="dot" style={{ background: '#6b7770', borderColor: '#8a978f' }} />Sensors and actuators</span>
      </div>

      {/* 01 architecture */}
      <section className="info-section">
        <div className="info-sechead">
          <span className="info-secnum">01</span>
          <h2>Dual-brain architecture and technology stack</h2>
        </div>
        <div className="screen">
          <div className="arch">
            <div className="arch-robot">
              <p className="arch-tag">FarmHand robot</p>
              <div className="brains">
                <div className="brain mpu">
                  <h4>Perception and planning</h4>
                  <small>Qualcomm QRB2210 · Debian Linux · about 5 W</small>
                  <ul className="nodes">
                    <li className="node n-slate">Eye-in-hand camera</li>
                    <li className="node n-ai">Vision model<br /><small>YOLOv8n int8 on-device, OpenCV HSV fallback</small></li>
                    <li className="node n-sky">FarmHand model<br /><small>Qwen3.5-0.8B, NL to validated JSON</small></li>
                    <li className="node n-mpu">Pick and sort state machine<br /><small>SEEK, ALIGN, PICK, SORT, DROP</small></li>
                    <li className="node n-mpu">Lidar reader and SLAM-lite</li>
                  </ul>
                </div>
                <div className="bridge">App Lab Bridge<br />MsgPack-RPC</div>
                <div className="brain mcu">
                  <h4>Real-time control and safety</h4>
                  <small>STM32U585</small>
                  <ul className="nodes">
                    <li className="node n-mcu">Tank-drive PWM</li>
                    <li className="node n-mcu">Servo interpolation<br /><small>PCA9685, 20 ms, no snapping</small></li>
                    <li className="node n-safety">Ultrasonic reflex stop<br /><small>under 10 ms</small></li>
                    <li className="node n-safety">Motion watchdog<br /><small>500 ms</small></li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="arch-row">
              <p className="arch-tag">Sensors and actuators</p>
              <div className="flowchips">
                <span className="fchip">RPLIDAR C1, 360 degrees</span>
                <span className="fchip">HC-SR04 ultrasonic</span>
                <span className="fchip">2 drive motors</span>
                <span className="fchip">5 arm servos and gripper</span>
                <span className="fchip">PlayStation controller (Gamepad API)</span>
              </div>
            </div>

            <div className="arch-row">
              <p className="arch-tag">Laptop server and web</p>
              <div className="flowchips">
                <span className="fchip">Socket.IO hub (Express, Node.js)</span>
                <span className="fchip">Dashboard (React, Three.js, Vite)</span>
                <span className="fchip">MongoDB Atlas</span>
                <span className="fchip">Auth0 operator login</span>
                <span className="fchip">Vercel</span>
                <span className="fchip">Base44 webhook (Orchard OS)</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 02 command gate */}
      <section className="info-section">
        <div className="info-sechead">
          <span className="info-secnum">02</span>
          <h2>FarmHand command safety gate</h2>
          <p className="info-secsub">Invalid model output physically cannot reach the robot.</p>
        </div>
        <div className="screen">
          <div className="flow">
            <span className="step n-slate">Plain English<br /><small>&ldquo;grab every ripe banana&rdquo;</small></span>
            <span className="arrow">&rarr;</span>
            <span className="step n-sky">FarmHand model<br /><small>Qwen3.5-0.8B</small></span>
            <span className="arrow">&rarr;</span>
            <span className="decision">Schema valid?</span>
            <span className="arrow">&rarr;</span>
            <div className="branches">
              <div className="branch"><span className="tagm">valid</span><span className="step n-web">Robot executes<br /><small>pick, sort, drive, stop</small></span></div>
              <div className="branch"><span className="tagm">invalid</span><span className="step n-safety">Rejected, never reaches the robot</span></div>
              <div className="branch"><span className="tagm">ambiguous</span><span className="step n-mcu">Asks a clarifying question</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* 03 pick and sort loop */}
      <section className="info-section">
        <div className="info-sechead">
          <span className="info-secnum">03</span>
          <h2>Pick and sort loop</h2>
          <p className="info-secsub">Autonomous state machine on the Linux side.</p>
        </div>
        <div className="screen">
          <div className="flow">
            <span className="step n-mpu">SEEK</span>
            <span className="arrow">&rarr;</span>
            <span className="step n-mpu">ALIGN<br /><small>center the box</small></span>
            <span className="arrow">&rarr;</span>
            <span className="step n-mpu">PICK<br /><small>grasp</small></span>
            <span className="arrow">&rarr;</span>
            <span className="step n-mpu">SORT<br /><small>bin by type and ripeness</small></span>
            <span className="arrow">&rarr;</span>
            <span className="step n-web">DROP</span>
            <span className="arrow">&#8630;</span>
            <span className="step n-slate">back to SEEK</span>
          </div>
        </div>
      </section>

      {/* 04 tech stack */}
      <section className="info-section">
        <div className="info-sechead">
          <span className="info-secnum">04</span>
          <h2>Technology stack</h2>
          <p className="info-secsub">What runs where.</p>
        </div>
        <div className="stack">
          <div className="group g-teal">
            <h3>Edge compute</h3>
            <div className="tiles">
              <Tile name="Arduino UNO Q" role="dual-brain board" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="#00979D" strokeWidth="1.7"><circle cx="8" cy="12" r="3.4" /><circle cx="16" cy="12" r="3.4" /><path d="M6.4 12h3.2M14.4 12H17.6M16 10.4v3.2" strokeWidth="1.3" /></svg>
              } />
              <Tile name="Qualcomm QRB2210" role="Linux MPU" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="#3253DC" strokeWidth="2"><circle cx="11" cy="11" r="7.5" /><path d="M13 15l4 4" strokeLinecap="round" /></svg>
              } />
              <Tile name="STM32U585" role="real-time MCU" icon={<Mono>ST</Mono>} />
              <Tile name="Debian Linux" role="on-device OS" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="#A80030" strokeWidth="1.8"><path d="M15 5a7.5 7.5 0 1 0 3.6 9.2A5.6 5.6 0 1 1 15 6.5" /></svg>
              } />
            </div>
          </div>

          <div className="group g-sky">
            <h3>On-device AI</h3>
            <div className="tiles">
              <Tile name="YOLOv8n" role="detector" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="#111F68" strokeWidth="1.6"><rect x="4" y="6" width="12" height="10" rx="1" strokeDasharray="3 2" /><circle cx="18" cy="17" r="2.1" fill="#0AC0CB" stroke="none" /></svg>
              } />
              <Tile name="ONNX Runtime" role="inference" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l7 4v10l-7 4-7-4V7z" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><path d="M12 12l5-3M12 12l-5 3M12 12v5" /></svg>
              } />
              <Tile name="OpenCV" role="HSV fallback" icon={
                <svg viewBox="0 0 24 24"><circle cx="12" cy="5.6" r="3.1" fill="#E1251B" /><circle cx="6.6" cy="15" r="3.1" fill="#5CB531" /><circle cx="17.4" cy="15" r="3.1" fill="#2A5CAA" /></svg>
              } />
              <Tile name="int8 quant" role="compressed" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3.5" y="9" width="17" height="6" rx="1" /><path d="M7 9V7.5M11 9V6.5M15 9V7.5M9 15v1.5M13 15v2M17 15v1.5" strokeWidth="1.2" /></svg>
              } />
            </div>
          </div>

          <div className="group g-sky">
            <h3>Language model</h3>
            <div className="tiles">
              <Tile name="FarmHand" role="NL to JSON" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6.5C4 5 5 4 7 4h10c2 0 3 1 3 2.5v7c0 1.5-1 2.5-3 2.5h-6l-4 3v-3H7c-2 0-3-1-3-2.5z" /><path d="M8.5 8.5l2 2-2 2M12.5 12.5h3" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              } />
              <Tile name="Qwen3.5-0.8B" role="base model" icon={<Mono>Qwen</Mono>} />
              <Tile name="Freesolo" role="SFT + GRPO" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15 3l-2 6h4l-8 12 2-8H7z" fill="currentColor" stroke="none" opacity="0.9" /></svg>
              } />
              <Tile name="JSON schema gate" role="hard validator" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 4H7a3 3 0 0 0-3 3v2a2 2 0 0 1-2 2 2 2 0 0 1 2 2v2a3 3 0 0 0 3 3h2M15 4h2a3 3 0 0 1 3 3v2a2 2 0 0 0 2 2 2 2 0 0 0-2 2v2a3 3 0 0 1-3 3h-2" strokeLinecap="round" /></svg>
              } />
            </div>
          </div>

          <div className="group g-amber">
            <h3>Robot I/O</h3>
            <div className="tiles">
              <Tile name="PCA9685" role="servo driver" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="7" y="7" width="10" height="10" rx="1" /><path d="M9.5 7V4M12 7V4M14.5 7V4M9.5 20v-3M12 20v-3M14.5 20v-3M4 9.5h3M4 12h3M4 14.5h3M17 9.5h3M17 12h3M17 14.5h3" /></svg>
              } />
              <Tile name="HC-SR04" role="ultrasonic" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8.5" cy="12" r="3.4" /><circle cx="15.5" cy="12" r="3.4" /><path d="M19.5 8.2c1.4 2.4 1.4 5.2 0 7.6" strokeWidth="1" /></svg>
              } />
              <Tile name="RPLIDAR C1" role="360 lidar" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="2.6" /><path d="M12 12a8 8 0 0 1 8 8" strokeWidth="1.2" /><path d="M12 12l7-4.5" /><circle cx="12" cy="12" r="9" strokeDasharray="1.5 3" strokeWidth="1" /></svg>
              } />
              <Tile name="PlayStation" role="Gamepad API" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="#2E6DE6" strokeWidth="1.5"><path d="M12 3.5l2.3 3.8h-4.6z" /><circle cx="18.2" cy="12" r="2.1" /><path d="M4 10.2l3.2 3.2M7.2 10.2L4 13.4" /><rect x="10" y="16.6" width="4" height="4" rx="0.6" /></svg>
              } />
            </div>
          </div>

          <div className="group g-leaf">
            <h3>Web and telemetry</h3>
            <div className="tiles">
              <Tile name="React" role="dashboard" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="#61DAFB" strokeWidth="1.3"><circle cx="12" cy="12" r="1.6" fill="#61DAFB" stroke="none" /><ellipse cx="12" cy="12" rx="10" ry="4" /><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)" /></svg>
              } />
              <Tile name="Three.js" role="3D view" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M12 3l9 16H3z" /><path d="M12 3v16M12 19l-5-7M12 19l5-7M3 19l9-6 9 6" /></svg>
              } />
              <Tile name="Vite" role="build" icon={
                <svg viewBox="0 0 24 24"><path d="M13 2.5 4.5 13.5H10l-1.2 8L20 9.5h-6.6z" fill="#FFC521" stroke="#8E48E8" strokeWidth="0.7" /></svg>
              } />
              <Tile name="Socket.IO" role="realtime hub" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="5" /><path d="M8 14.2c2.2 2 6 1.8 8-1M16 9.8c-2.2-2-6-1.8-8 1" strokeWidth="1.4" strokeLinecap="round" /></svg>
              } />
              <Tile name="Express" role="server" icon={<Mono>ex</Mono>} />
              <Tile name="Node.js" role="runtime" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="#539E43" strokeWidth="1.6"><path d="M12 2.5 20 7v10l-8 4.5L4 17V7z" /><path d="M9 15c0 1.1 1.1 1.7 3 1.7s3-.8 3-2c0-2.5-5.6-1.2-5.6-3.6 0-1 1-1.6 2.6-1.6 1.5 0 2.5.5 2.5 1.6" strokeWidth="1.1" /></svg>
              } />
            </div>
          </div>

          <div className="group g-leaf">
            <h3>Cloud and services</h3>
            <div className="tiles">
              <Tile name="MongoDB Atlas" role="datastore" icon={
                <svg viewBox="0 0 24 24"><path d="M12 2.2c1.9 2.9 4.6 4.7 4.6 8.6 0 3.8-2.7 5.7-3.7 6.7l-.6 2.6-.3-2.5c-1.1-1-3.6-2.9-3.6-6.8 0-3.9 1.7-5.7 3.6-8.6z" fill="#10AA50" /><path d="M12 4.5v14.5" stroke="#0a7c3a" strokeWidth="0.9" /></svg>
              } />
              <Tile name="Auth0" role="operator login" icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="#EB5424" strokeWidth="1.5"><path d="M12 2.5l7 2v6c0 5-3.2 8-7 9.9C8.2 18.5 5 15.5 5 10.5v-6z" /><path d="M12 7l1.7 5.1h-3.4z" fill="#EB5424" stroke="none" /></svg>
              } />
              <Tile name="Vercel" role="hosting" icon={
                <svg viewBox="0 0 24 24"><path d="M12 4 21 20H3z" fill="currentColor" /></svg>
              } />
              <Tile name="Base44" role="Orchard OS" icon={<Mono>B44</Mono>} />
            </div>
          </div>
        </div>
      </section>

      <p className="info-foot">
        Battery, not Blood. One board, two brains, on-device AI, no cloud.
      </p>
    </div>
  )
}
