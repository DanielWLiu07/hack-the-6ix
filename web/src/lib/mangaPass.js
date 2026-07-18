// mangaPass.js - self-contained manga / ink post-process for a small r3f
// mascot canvas. Screen-space: posterized tone bands, halftone dots in the
// midtones, crosshatch in the shadows, sobel ink outlines, subtle paper grain.
// Patterns are PROCEDURAL (no external textures). Alpha passes through so a
// transparent-background scene composites as a clean CUTOUT onto the page.

import * as THREE from 'three'

const FSQ_VERT = /* glsl */ `
  out vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

const MANGA_FRAG = /* glsl */ `
  precision highp float;
  in vec2 vUv;
  uniform sampler2D tScene;
  uniform vec2 uRes;
  uniform float uGrit;   // 0..1 heavier blacks / crosshatch / grain
  uniform float uInk;    // ink colour (dark)
  out vec4 outColor;

  float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // rotated halftone dot field: 1 inside a dot, 0 in the gaps. Dot radius
  // grows as tone darkens (amt high => bigger dots => darker fill).
  float halftone(vec2 px, float scale, float amt){
    float c = cos(0.7854), s = sin(0.7854);
    vec2 r = mat2(c, -s, s, c) * px;
    vec2 g = fract(r / scale) - 0.5;
    float d = length(g) * 2.0;
    return smoothstep(amt + 0.08, amt - 0.08, d);
  }
  // diagonal crosshatch line coverage
  float hatch(vec2 px, float scale, float dir){
    float v = (dir > 0.5) ? (px.x + px.y) : (px.x - px.y);
    return smoothstep(0.5, 0.9, abs(sin(v / scale * 3.14159)));
  }

  void main(){
    vec2 texel = 1.0 / uRes;
    vec4 srcC = texture(tScene, vUv);
    vec3 scene = srcC.rgb;
    float alpha = srcC.a;

    // ---- sobel ink outline on luminance ----
    float l00 = luma(texture(tScene, vUv + texel * vec2(-1,-1)).rgb);
    float l10 = luma(texture(tScene, vUv + texel * vec2( 0,-1)).rgb);
    float l20 = luma(texture(tScene, vUv + texel * vec2( 1,-1)).rgb);
    float l01 = luma(texture(tScene, vUv + texel * vec2(-1, 0)).rgb);
    float l21 = luma(texture(tScene, vUv + texel * vec2( 1, 0)).rgb);
    float l02 = luma(texture(tScene, vUv + texel * vec2(-1, 1)).rgb);
    float l12 = luma(texture(tScene, vUv + texel * vec2( 0, 1)).rgb);
    float l22 = luma(texture(tScene, vUv + texel * vec2( 1, 1)).rgb);
    float gx = (l20 + 2.0*l21 + l22) - (l00 + 2.0*l01 + l02);
    float gy = (l02 + 2.0*l12 + l22) - (l00 + 2.0*l10 + l20);
    float edge = clamp(sqrt(gx*gx + gy*gy) * (1.6 + uGrit), 0.0, 1.0);
    // alpha silhouette edge -> outline the whole cutout too
    float aE = 0.0;
    aE = max(aE, abs(alpha - texture(tScene, vUv + texel * vec2(1,0)).a));
    aE = max(aE, abs(alpha - texture(tScene, vUv + texel * vec2(0,1)).a));
    edge = max(edge, smoothstep(0.1, 0.4, aE));

    // ---- tone bands (gamma-lifted; the model is darker than a manga page) ----
    float L = pow(clamp(luma(scene), 0.0, 1.0), 0.8);
    vec2 px = vUv * uRes;
    float dots  = halftone(px, 4.0, clamp((0.62 - L) * 2.4, 0.0, 1.0));
    float hatchA = hatch(px, 3.2, 0.0);
    float hatchB = hatch(px, 3.8, 1.0);
    float shade = mix(hatchA, max(hatchA, hatchB), uGrit);

    float tone;                       // 1 = paper white, 0 = ink
    if (L > 0.72)      tone = 1.0;                       // highlight = paper
    else if (L > 0.42) tone = 1.0 - dots * 0.9;          // midtone = halftone
    else if (L > 0.20) tone = mix(0.5, 0.12, shade);     // shadow = hatch
    else               tone = mix(0.12, 0.03, uGrit);    // core shadow = black

    // FULLY black & white: pure ink -> pure paper, no colour.
    vec3 ink = vec3(uInk);
    vec3 paper = vec3(0.96);
    vec3 col = mix(ink, paper, tone);
    col = mix(col, ink, edge);        // ink outlines on top

    // heavy grainy-manga tooth: coarse paper grain + fine film grain, biased
    // into the midtones so highlights/blacks stay printy.
    float g1 = hash(floor(px * 0.5));
    float g2 = hash(floor(px));
    float grain = (g1 - 0.5) * 0.11 + (g2 - 0.5) * (0.10 + 0.22 * uGrit);
    col += grain * (0.45 + 0.55 * (1.0 - abs(tone - 0.5) * 2.0));
    col = clamp(col, 0.0, 1.0);

    outColor = vec4(col, alpha);
  }`

export class MangaPass {
  constructor(renderer, { grit = 0.35, ink = 0.07 } = {}) {
    this.renderer = renderer
    this.rtScene = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
    })
    this.fsqCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this.fsqScene = new THREE.Scene()
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FSQ_VERT,
      fragmentShader: MANGA_FRAG,
      glslVersion: THREE.GLSL3,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tScene: { value: null },
        uRes: { value: new THREE.Vector2() },
        uGrit: { value: grit },
        uInk: { value: ink },
      },
    })
    this.mat.blending = THREE.NoBlending
    this.fsqScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat))
  }

  setSize(w, h) {
    const sw = Math.max(2, Math.round(w))
    const sh = Math.max(2, Math.round(h))
    this.rtScene.setSize(sw, sh)
    this.mat.uniforms.uRes.value.set(sw, sh)
  }

  render(scene, camera) {
    const r = this.renderer
    const prevClear = r.getClearAlpha()
    r.setRenderTarget(this.rtScene)
    r.setClearColor(0x000000, 0)
    r.clear()
    r.render(scene, camera)
    this.mat.uniforms.tScene.value = this.rtScene.texture
    r.setRenderTarget(null)
    r.setClearAlpha(prevClear)
    r.render(this.fsqScene, this.fsqCam)
  }
}
