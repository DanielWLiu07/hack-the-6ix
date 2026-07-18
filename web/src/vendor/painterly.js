// painterly.js - anisotropic Kuwahara, faithful port of the reference
// implementation by Garrett Gunnell (Acerola), the shader behind the
// well-known painterly post-process demos:
//   https://github.com/GarrettGunnell/Post-Processing (Kuwahara Filter)
// Same math as Blender's compositor Kuwahara node in ANISOTROPIC mode
// (Kyprianidis & Kang polynomial-weighted sectors).
//
// Chain: scene RT -> structure tensor -> gaussian blur X -> gaussian blur
// Y + eigen analysis (TFM: flow direction, angle, anisotropy) ->
// polynomial-sector kuwahara -> composite (canvas grain, edge darkening,
// palette shift, vignette). Post-process only: the scene animates free.

import * as THREE from 'three';

const FSQ_VERT = /* glsl */`
  out vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

// Pass 1 - structure tensor from Sobel derivatives (reference: /4.0)
const TENSOR_FRAG = /* glsl */`
  precision highp float;
  in vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  out vec4 outColor;
  vec3 g(vec2 o){ return texture(tSrc, vUv + o * uTexel).rgb; }
  void main(){
    vec2 d = vec2(1.0);
    vec3 Sx = (
       1.0 * g(vec2(-1.,-1.)) + 2.0 * g(vec2(-1., 0.)) + 1.0 * g(vec2(-1., 1.))
     - 1.0 * g(vec2( 1.,-1.)) - 2.0 * g(vec2( 1., 0.)) - 1.0 * g(vec2( 1., 1.))
    ) / 4.0;
    vec3 Sy = (
       1.0 * g(vec2(-1.,-1.)) + 2.0 * g(vec2( 0.,-1.)) + 1.0 * g(vec2( 1.,-1.))
     - 1.0 * g(vec2(-1., 1.)) - 2.0 * g(vec2( 0., 1.)) - 1.0 * g(vec2( 1., 1.))
    ) / 4.0;
    outColor = vec4(dot(Sx, Sx), dot(Sy, Sy), dot(Sx, Sy), 1.0);
  }`;

// Pass 2 - separable gaussian blur, horizontal (radius 5, sigma 2)
const BLURX_FRAG = /* glsl */`
  precision highp float;
  in vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  out vec4 outColor;
  float gauss(float x){ return exp(-(x*x) / 8.0); }   // sigma 2
  void main(){
    vec4 col = vec4(0.0); float sum = 0.0;
    for(int x = -5; x <= 5; x++){
      float w = gauss(float(x));
      col += texture(tSrc, vUv + vec2(float(x), 0.0) * uTexel) * w;
      sum += w;
    }
    outColor = col / sum;
  }`;

// Pass 3 - vertical blur + eigen analysis -> TFM (t.xy, phi, anisotropy)
const TFM_FRAG = /* glsl */`
  precision highp float;
  in vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  out vec4 outColor;
  float gauss(float x){ return exp(-(x*x) / 8.0); }
  void main(){
    vec4 col = vec4(0.0); float sum = 0.0;
    for(int y = -5; y <= 5; y++){
      float w = gauss(float(y));
      col += texture(tSrc, vUv + vec2(0.0, float(y)) * uTexel) * w;
      sum += w;
    }
    vec3 g = col.rgb / sum;   // (Sx.Sx, Sy.Sy, Sx.Sy)

    float disc = sqrt(max(g.y*g.y - 2.0*g.x*g.y + g.x*g.x + 4.0*g.z*g.z, 0.0));
    float lambda1 = 0.5 * (g.y + g.x + disc);
    float lambda2 = 0.5 * (g.y + g.x - disc);

    vec2 v = vec2(lambda1 - g.x, -g.z);
    vec2 t = length(v) > 0.0 ? normalize(v) : vec2(0.0, 1.0);
    float phi = -atan(t.y, t.x);
    float A = (lambda1 + lambda2 > 0.0)
      ? (lambda1 - lambda2) / (lambda1 + lambda2) : 0.0;
    outColor = vec4(t, phi, A);
  }`;

// Pass 4 - anisotropic Kuwahara with POLYNOMIAL sector weights (the part
// that makes clean paint daubs: every sample feeds all 8 sectors softly)
const KUWAHARA_FRAG = /* glsl */`
  precision highp float;
  in vec2 vUv;
  uniform sampler2D tSrc;
  uniform sampler2D tTFM;
  uniform vec2 uTexel;
  uniform float uKernelSize;   // full kernel size in px (radius = /2)
  uniform float uHardness;     // reference _Hardness
  uniform float uQ;            // reference _Q
  uniform float uAlpha;        // eccentricity control (1.0)
  uniform float uZeroCrossing; // sector overlap angle (0.58)
  out vec4 outColor;

  void main(){
    vec4 t = texture(tTFM, vUv);

    float kernelRadius = uKernelSize * 0.5;
    float a = kernelRadius * clamp((uAlpha + t.w) / uAlpha, 0.1, 2.0);
    float b = kernelRadius * clamp(uAlpha / (uAlpha + t.w), 0.1, 2.0);

    float cos_phi = cos(t.z);
    float sin_phi = sin(t.z);

    mat2 R = mat2(cos_phi, sin_phi, -sin_phi, cos_phi);   // column-major
    mat2 S = mat2(0.5 / a, 0.0, 0.0, 0.5 / b);
    mat2 SR = S * R;

    int max_x = int(sqrt(a*a*cos_phi*cos_phi + b*b*sin_phi*sin_phi));
    int max_y = int(sqrt(a*a*sin_phi*sin_phi + b*b*cos_phi*cos_phi));

    float zeta = 2.0 / kernelRadius;
    float sinZC = sin(uZeroCrossing);
    float eta = (zeta + cos(uZeroCrossing)) / (sinZC * sinZC);

    vec4 m[8];
    vec3 s[8];
    for(int k = 0; k < 8; k++){ m[k] = vec4(0.0); s[k] = vec3(0.0); }

    const int MAXR = 13;
    for(int y = -MAXR; y <= MAXR; y++){
      if(y < -max_y || y > max_y) continue;
      for(int x = -MAXR; x <= MAXR; x++){
        if(x < -max_x || x > max_x) continue;
        vec2 v = SR * vec2(float(x), float(y));
        if(dot(v, v) > 0.25) continue;
        vec3 c = clamp(texture(tSrc, vUv + vec2(float(x), float(y)) * uTexel).rgb,
                       0.0, 1.0);
        float sum = 0.0;
        float w[8];
        float z, vxx, vyy;
        /* polynomial sector weights (reference verbatim) */
        vxx = zeta - eta * v.x * v.x;
        vyy = zeta - eta * v.y * v.y;
        z = max(0.0,  v.y + vxx); w[0] = z * z; sum += w[0];
        z = max(0.0, -v.x + vyy); w[2] = z * z; sum += w[2];
        z = max(0.0, -v.y + vxx); w[4] = z * z; sum += w[4];
        z = max(0.0,  v.x + vyy); w[6] = z * z; sum += w[6];
        v = 0.70710678 * vec2(v.x - v.y, v.x + v.y);
        vxx = zeta - eta * v.x * v.x;
        vyy = zeta - eta * v.y * v.y;
        z = max(0.0,  v.y + vxx); w[1] = z * z; sum += w[1];
        z = max(0.0, -v.x + vyy); w[3] = z * z; sum += w[3];
        z = max(0.0, -v.y + vxx); w[5] = z * z; sum += w[5];
        z = max(0.0,  v.x + vyy); w[7] = z * z; sum += w[7];

        float g = exp(-3.125 * dot(v, v)) / max(sum, 1e-6);

        for(int k = 0; k < 8; k++){
          float wk = w[k] * g;
          m[k] += vec4(c * wk, wk);
          s[k] += c * c * wk;
        }
      }
    }

    vec4 acc = vec4(0.0);
    for(int k = 0; k < 8; k++){
      float mw = max(m[k].w, 1e-6);
      vec3 mean = m[k].rgb / mw;
      vec3 varc = abs(s[k] / mw - mean * mean);
      float sigma2 = varc.r + varc.g + varc.b;
      float w = 1.0 / (1.0 + pow(uHardness * 1000.0 * sigma2, 0.5 * uQ));
      acc += vec4(mean * w, w);
    }
    outColor = vec4(clamp(acc.rgb / max(acc.w, 1e-6), 0.0, 1.0), 1.0);
  }`;

// Pass 5 - composite: canvas grain, pigment edge darkening, painter
// palette, vignette, effect mix. Kept SUBTLE - the reference filter is
// the star; this is varnish.
const COMPOSITE_FRAG = /* glsl */`
  precision highp float;
  in vec2 vUv;
  uniform sampler2D tPaint;
  uniform sampler2D tScene;
  uniform sampler2D tTensor;
  uniform vec2 uRes;
  uniform float uMix;
  uniform float uCutout;   // 1 = transparent-background cutout (alpha from coverage)
  out vec4 outColor;

  float hash(vec2 p){
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }

  void main(){
    vec3 paint = texture(tPaint, vUv).rgb;
    vec3 scene = texture(tScene, vUv).rgb;

    vec2 px = vUv * uRes;
    float weave = (noise(px * vec2(0.9, 0.22)) * 0.5 +
                   noise(px * vec2(0.22, 0.9)) * 0.5) - 0.5;
    paint += weave * 0.035;

    vec3 t = texture(tTensor, vUv).rgb;
    float edge = clamp((t.x + t.y) * 14.0, 0.0, 1.0);
    paint *= 1.0 - edge * 0.18;

    float lum = dot(paint, vec3(0.299, 0.587, 0.114));
    paint += (lum - 0.5) * vec3(0.06, 0.025, -0.045);

    // Center vignette only makes sense for a full-frame effect. In cutout mode
    // the painted content sits at the edges, so skip it.
    if (uCutout < 0.5) {
      float d = distance(vUv, vec2(0.5));
      paint *= 1.0 - smoothstep(0.5, 0.9, d) * 0.28;
    }

    vec3 col = mix(scene, paint, uMix);

    if (uCutout > 0.5) {
      // Alpha from the captured scene coverage, dilated a couple of texels so a
      // sliver of the painted edge survives, then premultiplied so it composites
      // cleanly over the layer behind.
      vec2 texel = 1.0 / uRes;
      float cov = texture(tScene, vUv).a;
      cov = max(cov, texture(tScene, vUv + texel * vec2( 2.0,  0.0)).a);
      cov = max(cov, texture(tScene, vUv + texel * vec2(-2.0,  0.0)).a);
      cov = max(cov, texture(tScene, vUv + texel * vec2( 0.0,  2.0)).a);
      cov = max(cov, texture(tScene, vUv + texel * vec2( 0.0, -2.0)).a);
      cov = max(cov, texture(tScene, vUv + texel * vec2( 2.0,  2.0)).a);
      cov = max(cov, texture(tScene, vUv + texel * vec2(-2.0, -2.0)).a);
      cov = max(cov, texture(tScene, vUv + texel * vec2( 2.0, -2.0)).a);
      cov = max(cov, texture(tScene, vUv + texel * vec2(-2.0,  2.0)).a);
      float alpha = smoothstep(0.15, 0.6, cov);
      outColor = vec4(col * alpha, alpha);
    } else {
      outColor = vec4(col, 1.0);
    }
  }`;

export class PainterlyPipeline {
  constructor(renderer, { renderScale = 0.85 } = {}) {
    this.renderer = renderer;
    this.renderScale = renderScale;
    // reference defaults (Acerola demo ballpark)
    this.kernelSize = 12;     // "stroke size", full kernel in px
    this.hardness = 8.0;
    this.q = 9.0;
    this.alpha = 1.0;
    // When true, composite outputs a premultiplied cutout (alpha from scene
    // coverage) so the paint can layer over another canvas. Default full-frame.
    this.cutout = false;
    this.zeroCrossing = 0.58;
    this.mix = 1.0;

    const rtOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: false,
    };
    this.rtScene = new THREE.WebGLRenderTarget(2, 2,
      { ...rtOpts, depthBuffer: true });
    this.rtTensor = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtBlurX = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtTFM = new THREE.WebGLRenderTarget(2, 2, rtOpts);
    this.rtPaint = new THREE.WebGLRenderTarget(2, 2, rtOpts);

    this.fsqCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.fsqScene = new THREE.Scene();
    this.fsqMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.fsqScene.add(this.fsqMesh);

    const mk = (frag, uniforms) => new THREE.ShaderMaterial({
      vertexShader: FSQ_VERT,
      fragmentShader: frag,
      uniforms,
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
    });

    this.matTensor = mk(TENSOR_FRAG, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    });
    this.matBlurX = mk(BLURX_FRAG, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    });
    this.matTFM = mk(TFM_FRAG, {
      tSrc: { value: null }, uTexel: { value: new THREE.Vector2() },
    });
    this.matKuwahara = mk(KUWAHARA_FRAG, {
      tSrc: { value: null }, tTFM: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uKernelSize: { value: this.kernelSize },
      uHardness: { value: this.hardness },
      uQ: { value: this.q },
      uAlpha: { value: this.alpha },
      uZeroCrossing: { value: this.zeroCrossing },
    });
    this.matComposite = mk(COMPOSITE_FRAG, {
      tPaint: { value: null }, tScene: { value: null },
      tTensor: { value: null },
      uRes: { value: new THREE.Vector2() }, uMix: { value: 1 },
      uCutout: { value: 0 },
    });
    // Cutout mode composites premultiplied over the existing frame; allow blend.
    this.matComposite.transparent = true;
    this.matComposite.blending = THREE.NormalBlending;
    this._prevColor = new THREE.Color();
  }

  setSize(w, h) {
    const sw = Math.max(2, Math.round(w * this.renderScale));
    const sh = Math.max(2, Math.round(h * this.renderScale));
    for (const rt of [this.rtScene, this.rtTensor, this.rtBlurX,
                      this.rtTFM, this.rtPaint])
      rt.setSize(sw, sh);
    this.texel = new THREE.Vector2(1 / sw, 1 / sh);
    this.res = new THREE.Vector2(sw, sh);
  }

  _pass(mat, target) {
    this.fsqMesh.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsqScene, this.fsqCam);
  }

  render(scene, camera) {
    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    const prevClearAlpha = r.getClearAlpha();
    r.getClearColor(this._prevColor);

    // In cutout mode the scene must clear transparent so coverage (alpha) is
    // meaningful. Caller is expected to null scene.background for this pass.
    if (this.cutout) r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);

    this.matTensor.uniforms.tSrc.value = this.rtScene.texture;
    this.matTensor.uniforms.uTexel.value = this.texel;
    this._pass(this.matTensor, this.rtTensor);

    this.matBlurX.uniforms.tSrc.value = this.rtTensor.texture;
    this.matBlurX.uniforms.uTexel.value = this.texel;
    this._pass(this.matBlurX, this.rtBlurX);

    this.matTFM.uniforms.tSrc.value = this.rtBlurX.texture;
    this.matTFM.uniforms.uTexel.value = this.texel;
    this._pass(this.matTFM, this.rtTFM);

    this.matKuwahara.uniforms.tSrc.value = this.rtScene.texture;
    this.matKuwahara.uniforms.tTFM.value = this.rtTFM.texture;
    this.matKuwahara.uniforms.uTexel.value = this.texel;
    this.matKuwahara.uniforms.uKernelSize.value = this.kernelSize;
    this.matKuwahara.uniforms.uHardness.value = this.hardness;
    this.matKuwahara.uniforms.uQ.value = this.q;
    this.matKuwahara.uniforms.uAlpha.value = this.alpha;
    this.matKuwahara.uniforms.uZeroCrossing.value = this.zeroCrossing;
    this._pass(this.matKuwahara, this.rtPaint);

    this.matComposite.uniforms.tPaint.value = this.rtPaint.texture;
    this.matComposite.uniforms.tScene.value = this.rtScene.texture;
    this.matComposite.uniforms.tTensor.value = this.rtBlurX.texture;
    this.matComposite.uniforms.uRes.value = this.res;
    this.matComposite.uniforms.uMix.value = this.mix;
    this.matComposite.uniforms.uCutout.value = this.cutout ? 1 : 0;
    // Cutout composites over whatever is already on screen (the ink pass), so
    // do not let the final pass clear it.
    if (this.cutout) r.autoClear = false;
    this._pass(this.matComposite, null);

    r.setRenderTarget(null);
    r.autoClear = prevAutoClear;
    r.setClearColor(this._prevColor, prevClearAlpha);
  }
}
