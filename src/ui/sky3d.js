// The knowledge map's sky in 3D (three.js): every book is a sun, its chapters
// are orbits on a slightly tilted plane, its concepts are planets going round.
// Planets are real spheres lit by their own sun (a day side, a night side and
// a bright rim of atmosphere where the light grazes the edge), so they wax and
// wane as they go round and as you turn the camera. Suns and mastered planets
// bloom. Books that share ideas are joined by a glowing stream with motes of
// light drifting along it; a planet's own links arc between planets when you
// point at it. Planets you're forgetting (low recall chance) dim, lose their
// colour and sit in a haze. A learning path is drawn as a constellation.
// Names are drawn on a 2D canvas over the scene, nearest and most important
// first, and come in as you get closer.
//
// This file knows nothing about React or the store: the map page gives it
// systems and planets (layout from lib/orbits.js, looks from the store) and
// calls setLooks / setFocus / setPath / setVisible as things change.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { sunSprites } from "./sky.js";
import { seeded } from "../lib/orbits.js";

const SLIPPING = new THREE.Color("#F2A65A");
const DUST = new THREE.Color("#77767B");
const WHITE_ARC = new THREE.Color(1.2, 1.25, 1.4), FAINT_ARC = new THREE.Color(0.55, 0.6, 0.75);
const DEPTH = 1.15;            // the 2D layout is squashed for wide screens; give back some depth
const FOV = 38;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v, a, b) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** How a planet is drawn for its kind ("bright", "lit", "slipping", "dark", "dust"). */
function kindLook(kind, color) {
  const c = kind === "slipping" ? SLIPPING.clone() : kind === "dust" ? DUST.clone() : color.clone();
  if (kind === "lit") c.lerp(new THREE.Color("#9CA3B5"), 0.18);
  return {
    color: c,
    glow: kind === "bright" ? 0.55 : kind === "slipping" ? 0.5 : 0,
    pulse: kind === "slipping" ? 1 : 0,
    dark: kind === "dark" ? 1 : 0,
    halo: kind === "bright" ? 1 : kind === "slipping" ? 0.8 : 0,
    scale: kind === "dust" ? 0.72 : 1,
  };
}

// ── Shaders ────────────────────────────────────────────────────────────────

const PLANET_VS = /* glsl */`
  attribute vec3 aColor; attribute vec3 aSun;
  attribute float aGlow; attribute float aFog; attribute float aSeed; attribute float aDim; attribute float aPulse; attribute float aDark;
  varying vec3 vN; varying vec3 vW; varying vec3 vColor; varying vec3 vSun; varying vec3 vObj;
  varying float vGlow; varying float vFog; varying float vSeed; varying float vDim; varying float vPulse; varying float vDark;
  void main() {
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vObj = position; vColor = aColor; vSun = aSun;
    vGlow = aGlow; vFog = aFog; vSeed = aSeed; vDim = aDim; vPulse = aPulse; vDark = aDark;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const PLANET_FS = /* glsl */`
  uniform float uTime;
  varying vec3 vN; varying vec3 vW; varying vec3 vColor; varying vec3 vSun; varying vec3 vObj;
  varying float vGlow; varying float vFog; varying float vSeed; varying float vDim; varying float vPulse; varying float vDark;
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    vec3 L = normalize(vSun - vW);
    float ndl = dot(N, L);
    float day = smoothstep(-0.1, 0.55, ndl);
    // Faint cloud bands, a little different on every planet.
    float band = sin(vObj.y * (6.0 + vSeed * 7.0) + sin(vObj.x * 3.0 + vSeed * 12.0) * 0.7) * 0.5 + 0.5;
    vec3 albedo = vColor * (0.8 + 0.3 * band);
    float facing = max(dot(N, V), 0.0);
    float rim = pow(1.0 - facing, 2.4) * smoothstep(-0.4, 0.45, ndl);
    vec3 col = albedo * (0.03 + 1.1 * day) * (1.0 - vDark * 0.86);
    col += mix(albedo, vec3(1.0, 0.97, 0.9), 0.45) * rim * (0.5 + vDark * 0.7);
    float pulse = vPulse > 0.5 ? 0.45 + 0.55 * sin(uTime * 2.6) : 1.0;
    col += vColor * vGlow * pulse * (0.6 + 0.4 * day);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * vec3(0.8, 0.88, 1.05), vFog * 0.8) * (1.0 - vFog * 0.55);
    gl_FragColor = vec4(col * vDim, 1.0);
  }`;

const SUN_VS = /* glsl */`
  varying vec3 vN; varying vec3 vW; varying vec3 vObj;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vObj = position;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const SUN_FS = /* glsl */`
  uniform vec3 uColor; uniform float uTime; uniform float uDim; uniform float uClose;
  varying vec3 vN; varying vec3 vW; varying vec3 vObj;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  void main() {
    vec3 V = normalize(cameraPosition - vW);
    float mu = max(dot(normalize(vN), V), 0.0);
    vec3 p = normalize(vObj) * 4.0;
    float g = noise(p + uTime * 0.05) * 0.6 + noise(p * 2.3 - uTime * 0.03) * 0.4;   // granulation
    vec3 hot = vec3(1.0, 0.97, 0.9);
    vec3 warm = mix(uColor, vec3(1.0, 0.82, 0.55), 0.6);
    float g2 = noise(p * 6.0 + uTime * 0.08);
    vec3 col = mix(warm, hot, pow(mu, 0.5) * (1.0 - 0.55 * uClose));
    col *= 0.82 + 0.3 * g;                                                        // granulation
    // Up close: a deep, boiling photosphere rather than a white disc.
    vec3 photo = mix(vec3(1.0, 0.56, 0.22), uColor, 0.18) * (0.55 + 0.55 * g + 0.35 * g2);
    col = mix(col, photo, uClose * 0.8);
    col *= 0.45 + 0.55 * pow(mu, 0.35);                                           // limb darkening
    gl_FragColor = vec4(col * 2.6 * uDim, 1.0);
  }`;

const POINTS_VS = /* glsl */`
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha; varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / -mv.z;
    vAlpha = aAlpha; vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }`;

const POINTS_FS = /* glsl */`
  varying float vAlpha; varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2) * vAlpha;
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor * a, a);
  }`;

const STARS_VS = /* glsl */`
  attribute float aSize; attribute float aPhase; attribute vec3 aColor;
  uniform float uTime; uniform float uPixel;
  varying vec3 vColor; varying float vTw;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vTw = 0.75 + 0.25 * sin(uTime * (0.6 + aPhase) + aPhase * 40.0);
    gl_PointSize = aSize * uPixel;
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }`;

const STARS_FS = /* glsl */`
  varying vec3 vColor; varying float vTw;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.0, d);
    a = a * a;
    gl_FragColor = vec4(vColor * a * vTw, a);
  }`;

const RING_VS = /* glsl */`
  attribute vec3 aColor; attribute float aAlpha;
  varying float vR; varying vec3 vColor; varying float vAlpha;
  void main() {
    vR = length(position); vColor = aColor; vAlpha = aAlpha;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }`;

const RING_FS = /* glsl */`
  uniform float uInner; uniform float uOuter;
  varying float vR; varying vec3 vColor; varying float vAlpha;
  void main() {
    float t = (vR - uInner) / (uOuter - uInner);
    float edge = smoothstep(0.0, 0.14, t) * smoothstep(1.0, 0.78, t);
    float bands = 0.6 + 0.4 * sin(t * 41.0) * sin(t * 13.0 + 1.3);
    float gap = 1.0 - 0.85 * smoothstep(0.035, 0.0, abs(t - 0.64));
    float a = edge * bands * gap * vAlpha;
    if (a < 0.002) discard;
    gl_FragColor = vec4(vColor * a, a);
  }`;

const STREAM_FS = /* glsl */`
  uniform vec3 uA; uniform vec3 uB; uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    float u = vUv.x;
    vec3 mid = vec3(0.84, 0.87, 1.0);
    vec3 col = u < 0.5 ? mix(uA, mid, u * 2.0) : mix(mid, uB, (u - 0.5) * 2.0);
    float ends = smoothstep(0.0, 0.18, u) * smoothstep(1.0, 0.82, u);
    float across = pow(sin(vUv.y * 3.14159), 2.0);
    float a = uAlpha * ends * (0.35 + 0.65 * across);
    gl_FragColor = vec4(col * a, a);
  }`;

const STREAM_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// ── The Milky Way, painted once onto the inside of a sphere ───────────────

function paintDome(w = 2048, h = 1024) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#020309";
  g.fillRect(0, 0, w, h);
  let seed = 4021;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const bandY = (x) => h * 0.5 + Math.sin((x / w) * Math.PI * 2 + 0.6) * h * 0.2;
  const blob = (x, y, r, rgb, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`);
    gr.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    if (x - r < 0) { g.save(); g.translate(w, 0); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
    if (x + r > w) { g.save(); g.translate(-w, 0); g.fillRect(x - r, y - r, r * 2, r * 2); g.restore(); }
  };
  // The band's glow, then clouds of colour along it, then dark dust down the middle.
  for (let i = 0; i < 260; i++) {
    const x = rand() * w, y = bandY(x) + gauss() * h * 0.07;
    blob(x, y, h * (0.05 + rand() * 0.12), [120, 130, 190], 0.035 + rand() * 0.03);
  }
  const tones = [[98, 120, 220], [150, 110, 210], [80, 170, 190], [210, 120, 160], [230, 200, 160]];
  for (let i = 0; i < 70; i++) {
    const x = rand() * w, y = bandY(x) + gauss() * h * 0.08;
    blob(x, y, h * (0.03 + rand() * 0.08), tones[Math.floor(rand() * tones.length)], 0.03 + rand() * 0.05);
  }
  for (let i = 0; i < 110; i++) {
    const x = rand() * w, y = bandY(x) + gauss() * h * 0.018;
    blob(x, y, h * (0.012 + rand() * 0.035), [2, 3, 9], 0.35);
  }
  // Two faint nebulae away from the band.
  for (const [fx, fy, rgb] of [[0.2, 0.22, [120, 150, 230]], [0.72, 0.8, [200, 110, 150]]]) {
    let x = w * fx, y = h * fy, dir = rand() * 6.28;
    for (let i = 0; i < 60; i++) {
      dir += (rand() - 0.5) * 0.9; x += Math.cos(dir) * 14; y += Math.sin(dir) * 9;
      blob(x, y, 30 + rand() * 70, rgb, 0.012 + rand() * 0.018);
    }
  }
  // The browser dithers gradients; seen magnified on the dome that's a fine crosshatch, so soften it away.
  const soft = document.createElement("canvas");
  soft.width = w; soft.height = h;
  const sg = soft.getContext("2d");
  sg.filter = "blur(3px)";
  sg.drawImage(c, 0, 0);
  const tex = new THREE.CanvasTexture(sg.filter === "blur(3px)" ? soft : c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const STAR_COLORS = [[1, 1, 1], [0.84, 0.89, 1], [1, 0.96, 0.86], [1, 0.84, 0.67], [0.67, 0.77, 1]];

// ── The engine ─────────────────────────────────────────────────────────────

export class Sky {
  constructor(host, { onHover, onSelect, onSun, still = false } = {}) {
    this.host = host;
    this.onHover = onHover;
    this.onSelect = onSelect;
    this.onSun = onSun;
    this.still = still;
    this.clock = { t: (Date.now() / 1000) % 1e5, speed: still ? 0 : 1, hold: false };
    this.focus = { id: null, mix: 0, selected: null, hover: null };
    this.path = null;
    this.pathMix = 0;
    this.visible = null;     // Set of planet ids shown (time-lapse), or null for all
    this.grow = new Map();   // id → 0..1 as planets appear
    this.fly = null;
    this.screen = new Map(); // id → { x, y, r, depth } last frame
    this.sunScreen = [];
    this.size = { w: 1, h: 1 };
    this.font = getComputedStyle(document.body).fontFamily || "sans-serif";
    this.serif = getComputedStyle(document.documentElement).getPropertyValue("--serif").trim() || "serif";
    this.disposables = [];   // the world's resources (rebuilt by setData)
    this.backdrop = [];      // the sky's (kept until dispose)

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "sky3d-canvas";
    host.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.labels = document.createElement("canvas");
    this.labels.className = "sky3d-labels";
    host.appendChild(this.labels);
    this.lctx = this.labels.getContext("2d");

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 60000);
    this.camera.position.set(0, 900, 1400);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.085;
    controls.screenSpacePanning = false;
    controls.zoomToCursor = true;
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.minPolarAngle = 0.18;
    controls.maxPolarAngle = 1.32;
    controls.minDistance = 40;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 1.1;
    controls.addEventListener("start", () => { this.fly = null; });
    this.controls = controls;

    // Post: bloom on everything bright (suns, mastered planets, streams), then tone mapping.
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.72, 0.38, 0.7);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildBackdrop();
    this.world = new THREE.Group();
    this.scene.add(this.world);

    // Pointer: OrbitControls moves the camera; a press that doesn't move is a click.
    const el = renderer.domElement;
    this.down = null;
    this.handlers = {
      down: (e) => { this.down = { x: e.clientX, y: e.clientY, moved: false }; },
      move: (e) => {
        if (this.down) {
          if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4) this.down.moved = true;
          return;
        }
        const p = this.pick(e);
        el.style.cursor = p ? "pointer" : this.pickSun(e) ? "zoom-in" : "grab";
        this.setHover(p?.id ?? null);
      },
      up: (e) => {
        const d = this.down;
        this.down = null;
        if (!d || d.moved || e.button !== 0) return;
        const p = this.pick(e);
        if (p) { this.onSelect?.(p.id); return; }
        const s = this.pickSun(e);
        if (s) { this.flyToSystem(s.id); this.onSun?.(s.id); return; }
        this.onSelect?.(null);
      },
      leave: () => { this.down = null; this.setHover(null); },
      context: (e) => e.preventDefault(),
    };
    el.addEventListener("pointerdown", this.handlers.down);
    el.addEventListener("pointermove", this.handlers.move);
    el.addEventListener("pointerup", this.handlers.up);
    el.addEventListener("pointerleave", this.handlers.leave);
    el.addEventListener("contextmenu", this.handlers.context);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();

    this.last = performance.now();
    const loop = (now) => { this.raf = requestAnimationFrame(loop); this.frame(now); };
    this.raf = requestAnimationFrame(loop);
  }

  // ── Building the scene ──────────────────────────────────────────────────

  buildBackdrop() {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(30000, 48, 24),
      new THREE.MeshBasicMaterial({ map: paintDome(), side: THREE.BackSide, depthWrite: false, toneMapped: false, color: new THREE.Color(0.75, 0.75, 0.75) }),
    );
    dome.rotation.z = 0.5;
    dome.rotation.x = -0.35;
    this.scene.add(dome);
    this.backdrop.push(dome.geometry, dome.material, dome.material.map);

    // Stars: most faint, a few bright, a third of them along the Milky Way.
    const n = 12000, pos = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n), col = new Float32Array(n * 3);
    let s = 77;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const v = new THREE.Vector3();
    const band = new THREE.Euler(-0.35, 0, 0.5);
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) {
        const a = rand() * Math.PI * 2, off = (rand() + rand() + rand() - 1.5) * (rand() < 0.75 ? 0.07 : 0.16);
        v.set(Math.cos(a), off, Math.sin(a)).normalize().applyEuler(band);
      } else {
        v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        if (v.lengthSq() < 0.01) v.set(0, 1, 0);
        v.normalize();
      }
      v.multiplyScalar(26000);
      pos.set([v.x, v.y, v.z], i * 3);
      const m = Math.pow(rand(), 6);
      size[i] = (i % 2 === 0 ? 0.6 : 0.7) + m * 4.6;
      phase[i] = rand();
      const c = STAR_COLORS[Math.floor(Math.pow(rand(), 1.8) * STAR_COLORS.length)];
      const b = (i % 2 === 0 ? 0.22 : 0.35) + m * 1.2 + rand() * 0.25;
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STARS_VS, fragmentShader: STARS_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixel: { value: 1 } },
    });
    const stars = new THREE.Points(geo, this.starMat);
    stars.frustumCulled = false;
    this.scene.add(stars);
    this.backdrop.push(geo, this.starMat);
  }

  /**
   * Replace what's in the sky.
   * systems: [{ id, name, color, lines, x, y, radius, sunR, rings: [{ r, locked }] }]
   * planets: [{ id, courseId, name, core, r, orbit: { r, phase, omega, ring }, color, kind, fog }]
   * links: [{ a, b, cross, provisional }] (planet ids)   bridges: [{ a, b, n }] (system ids)
   * oneCourse: true when the map shows a single course (its links are drawn faintly)
   */
  setData({ systems, planets, links, bridges, oneCourse = false }) {
    this.clearWorld();
    this.oneCourse = oneCourse;
    const group = this.world;
    this.systems = systems.map(sys => {
      const center = new THREE.Vector3(sys.x, 0, sys.y * DEPTH);
      const tilt = new THREE.Euler((seeded(sys.id, 1) - 0.5) * 0.22, 0, (seeded(sys.id, 2) - 0.5) * 0.16);
      const g = new THREE.Group();
      g.position.copy(center);
      g.rotation.copy(tilt);
      group.add(g);
      // The sun: a granulated, limb-darkened ball, a corona and diffraction spikes.
      const color = new THREE.Color(sys.color);
      const sunMat = new THREE.ShaderMaterial({ vertexShader: SUN_VS, fragmentShader: SUN_FS, uniforms: { uColor: { value: color }, uTime: { value: 0 }, uDim: { value: 1 }, uClose: { value: 0 } } });
      const sun = new THREE.Mesh(new THREE.SphereGeometry(sys.sunR, 48, 32), sunMat);
      g.add(sun);
      const sp = sunSprites(sys.color);
      const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture(sp.corona), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
      corona.scale.setScalar(sys.sunR * 12);
      g.add(corona);
      const spikes = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture(sp.spikes), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.32, rotation: 0.21 }));
      spikes.scale.setScalar(sys.sunR * 14);
      g.add(spikes);
      this.disposables.push(sun.geometry, sunMat, corona.material, spikes.material);
      // Chapters: hairline orbits, fainter for chapters you haven't read.
      const rings = sys.rings.map(ring => {
        const pts = new THREE.EllipseCurve(0, 0, ring.r, ring.r, 0, Math.PI * 2).getPoints(160).map(p => new THREE.Vector3(p.x, 0, p.y));
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.8, 0.84, 0.95), transparent: true, opacity: ring.locked ? 0.05 : 0.11, depthWrite: false });
        const line = new THREE.LineLoop(geo, mat);
        g.add(line);
        this.disposables.push(geo, mat);
        return { line, mat, base: ring.locked ? 0.05 : 0.11, locked: ring.locked };
      });
      return { ...sys, center, group: g, sun, sunMat, corona, spikes, rings, matrix: null };
    });
    const sysById = new Map(this.systems.map(s => [s.id, s]));
    for (const s of this.systems) { s.group.updateMatrixWorld(true); s.matrix = s.group.matrixWorld.clone(); }

    // Planets: one instanced mesh, their own lighting (see PLANET_FS).
    const n = planets.length;
    this.planets = planets.map((p, i) => ({ ...p, i, sys: sysById.get(p.courseId), pos: new THREE.Vector3(), base: new THREE.Color(p.color) }));
    this.byId = new Map(this.planets.map(p => [p.id, p]));
    const geo = new THREE.SphereGeometry(1, 36, 24);
    const attr = (k) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * k), k); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.attrs = { aColor: attr(3), aSun: attr(3), aGlow: attr(1), aFog: attr(1), aSeed: attr(1), aDim: attr(1), aPulse: attr(1), aDark: attr(1) };
    for (const [k, a] of Object.entries(this.attrs)) geo.setAttribute(k, a);
    this.planetMat = new THREE.ShaderMaterial({ vertexShader: PLANET_VS, fragmentShader: PLANET_FS, uniforms: { uTime: { value: 0 } } });
    this.mesh = new THREE.InstancedMesh(geo, this.planetMat, Math.max(1, n));
    this.mesh.count = n;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(this.mesh);
    this.disposables.push(geo, this.planetMat);
    this.planets.forEach(p => {
      this.attrs.aSeed.setX(p.i, seeded(p.id, 5));
      this.attrs.aDim.setX(p.i, 1);
      const c = p.sys?.center || new THREE.Vector3();
      this.attrs.aSun.setXYZ(p.i, c.x, c.y, c.z);
    });

    // Glow and haze around planets: soft additive points.
    const hg = new THREE.BufferGeometry();
    this.halo = { pos: new Float32Array(n * 2 * 3), size: new Float32Array(n * 2), alpha: new Float32Array(n * 2), color: new Float32Array(n * 2 * 3) };
    hg.setAttribute("position", new THREE.BufferAttribute(this.halo.pos, 3).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute("aSize", new THREE.BufferAttribute(this.halo.size, 1).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute("aAlpha", new THREE.BufferAttribute(this.halo.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    hg.setAttribute("aColor", new THREE.BufferAttribute(this.halo.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.pointsMat = new THREE.ShaderMaterial({ vertexShader: POINTS_VS, fragmentShader: POINTS_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: { value: 1 } } });
    this.halos = new THREE.Points(hg, this.pointsMat);
    this.halos.frustumCulled = false;
    group.add(this.halos);
    this.disposables.push(hg, this.pointsMat);

    // Core concepts carry a faint ring of fine bands, seen nearly edge-on.
    const cores = this.planets.filter(p => p.core);
    const rg = new THREE.RingGeometry(1.5, 2.45, 96, 1);
    rg.rotateX(-Math.PI / 2 + 0.35);
    const rk = Math.max(1, cores.length);
    this.ringAttrs = { aColor: new THREE.InstancedBufferAttribute(new Float32Array(rk * 3), 3), aAlpha: new THREE.InstancedBufferAttribute(new Float32Array(rk), 1).setUsage(THREE.DynamicDrawUsage) };
    rg.setAttribute("aColor", this.ringAttrs.aColor);
    rg.setAttribute("aAlpha", this.ringAttrs.aAlpha);
    this.ringMat = new THREE.ShaderMaterial({ vertexShader: RING_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, uniforms: { uInner: { value: 1.5 }, uOuter: { value: 2.45 } } });
    this.ringMesh = new THREE.InstancedMesh(rg, this.ringMat, rk);
    this.ringMesh.count = cores.length;
    this.ringMesh.frustumCulled = false;
    this.ringMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const warm = new THREE.Color(1, 0.95, 0.86);
    cores.forEach((p, k) => { p.ringIndex = k; const c = p.base.clone().lerp(warm, 0.35); this.ringAttrs.aColor.setXYZ(k, c.r, c.g, c.b); });
    group.add(this.ringMesh);
    this.disposables.push(rg, this.ringMat);

    // Streams between books.
    this.bridges = bridges.map(br => {
      const A = sysById.get(br.a), B = sysById.get(br.b);
      if (!A || !B) return null;
      const dir = B.center.clone().sub(A.center).normalize();
      const a = A.center.clone().addScaledVector(dir, A.sunR * 2.6), b = B.center.clone().addScaledVector(dir, -B.sunR * 2.6);
      const mid = a.clone().lerp(b, 0.5);
      mid.y += a.distanceTo(b) * 0.16;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const strength = Math.min(1, 0.45 + br.n / 40);
      const mat = new THREE.ShaderMaterial({
        vertexShader: STREAM_VS, fragmentShader: STREAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uA: { value: new THREE.Color(A.color) }, uB: { value: new THREE.Color(B.color) }, uAlpha: { value: 0.16 * strength } },
      });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 5 + strength * 5, 10), mat);
      const inner = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 1.4, 6), mat.clone());
      inner.material.uniforms.uAlpha.value = 0.5 * strength;
      group.add(tube, inner);
      this.disposables.push(tube.geometry, mat, inner.geometry, inner.material);
      const motes = Array.from({ length: Math.min(44, 14 + br.n) }, (_, k) => ({
        u: seeded(`${br.a}${br.b}`, k * 3 + 1), speed: 0.012 + seeded(`${br.a}${br.b}`, k * 3 + 2) * 0.018,
        off: new THREE.Vector3(seeded(`${br.a}${br.b}`, k * 7) - 0.5, seeded(`${br.a}${br.b}`, k * 7 + 1) - 0.5, seeded(`${br.a}${br.b}`, k * 7 + 2) - 0.5).multiplyScalar(26),
      }));
      return { curve, tube, inner, mat, innerMat: inner.material, motes, strength, a: br.a, b: br.b };
    }).filter(Boolean);
    const moteCount = this.bridges.reduce((k, b) => k + b.motes.length, 0);
    const mg = new THREE.BufferGeometry();
    this.mote = { pos: new Float32Array(Math.max(1, moteCount) * 3), size: new Float32Array(Math.max(1, moteCount)), alpha: new Float32Array(Math.max(1, moteCount)), color: new Float32Array(Math.max(1, moteCount) * 3).fill(0.9) };
    mg.setAttribute("position", new THREE.BufferAttribute(this.mote.pos, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute("aSize", new THREE.BufferAttribute(this.mote.size, 1));
    mg.setAttribute("aAlpha", new THREE.BufferAttribute(this.mote.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute("aColor", new THREE.BufferAttribute(this.mote.color, 3));
    this.motes = new THREE.Points(mg, this.pointsMat);
    this.motes.frustumCulled = false;
    group.add(this.motes);
    this.disposables.push(mg);
    let mi = 0;
    for (const br of this.bridges) for (const m of br.motes) { this.mote.size[mi] = 10 + seeded(`${br.a}`, mi) * 14; m.i = mi++; }

    // Links between planets: arcs, rebuilt each frame for the few that show.
    this.links = links.map(l => ({ ...l, A: this.byId.get(l.a), B: this.byId.get(l.b) })).filter(l => l.A && l.B);
    this.adj = new Map();
    for (const l of this.links) {
      if (!this.adj.has(l.a)) this.adj.set(l.a, new Set());
      if (!this.adj.has(l.b)) this.adj.set(l.b, new Set());
      this.adj.get(l.a).add(l.b);
      this.adj.get(l.b).add(l.a);
    }
    const SEG = 18, maxLinks = Math.max(1, this.links.length);
    this.arcSeg = SEG;
    const ag = new THREE.BufferGeometry();
    this.arc = { pos: new Float32Array(maxLinks * SEG * 2 * 3), color: new Float32Array(maxLinks * SEG * 2 * 3) };
    ag.setAttribute("position", new THREE.BufferAttribute(this.arc.pos, 3).setUsage(THREE.DynamicDrawUsage));
    ag.setAttribute("color", new THREE.BufferAttribute(this.arc.color, 3).setUsage(THREE.DynamicDrawUsage));
    ag.setDrawRange(0, 0);
    this.arcMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.arcs = new THREE.LineSegments(ag, this.arcMat);
    this.arcs.frustumCulled = false;
    group.add(this.arcs);
    this.disposables.push(ag, this.arcMat);

    this.looks = new Map();
    this.setLooks(Object.fromEntries(planets.map(p => [p.id, { kind: p.kind, fog: p.fog || 0 }])));
    this.positionPlanets(this.clock.t);
  }

  texture(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(t);
    return t;
  }

  clearWorld() {
    for (const d of this.disposables.splice(0)) d.dispose?.();
    this.scene.remove(this.world);
    this.world = new THREE.Group();
    this.scene.add(this.world);
  }

  // ── Changing what's shown ───────────────────────────────────────────────

  /** Status and fog per planet: { id: { kind, fog } }. */
  setLooks(looks) {
    if (!this.planets) return;
    for (const p of this.planets) {
      const l = looks[p.id] || this.looks.get(p.id) || { kind: p.kind, fog: 0 };
      this.looks.set(p.id, l);
      const k = kindLook(l.kind, p.base);
      p.look = { ...k, fog: l.fog || 0 };
      this.attrs.aColor.setXYZ(p.i, k.color.r, k.color.g, k.color.b);
      this.attrs.aGlow.setX(p.i, k.glow);
      this.attrs.aPulse.setX(p.i, k.pulse);
      this.attrs.aDark.setX(p.i, k.dark);
      this.attrs.aFog.setX(p.i, l.fog || 0);
    }
    for (const k of ["aColor", "aGlow", "aPulse", "aDark", "aFog"]) this.attrs[k].needsUpdate = true;
  }

  /** Only these planets are in the sky (the time-lapse); null shows them all. */
  setVisible(ids) {
    this.visible = ids ? new Set(ids) : null;
  }

  setFocus({ selected = null } = {}) {
    this.focus.selected = selected;
    this.clock.hold = Boolean(selected) || Boolean(this.focus.hover);
  }

  setHover(id) {
    if (id === this.focus.hover) return;
    this.focus.hover = id;
    this.clock.hold = Boolean(id) || Boolean(this.focus.selected);
    this.onHover?.(id);
  }

  /** A learning path ({ nodes, links } from prereqPath), or null. */
  setPath(path) {
    this.path = path && path.nodes.length > 1 ? { ...path, set: new Set(path.nodes), step: new Map(path.nodes.map((id, i) => [id, i + 1])) } : null;
  }

  // ── The camera ──────────────────────────────────────────────────────────

  bounds(systems = this.systems || []) {
    if (!systems.length) return { center: new THREE.Vector3(), radius: 400 };
    const box = new THREE.Box3();
    for (const s of systems) {
      box.expandByPoint(s.center.clone().add(new THREE.Vector3(s.radius, 0, s.radius)));
      box.expandByPoint(s.center.clone().add(new THREE.Vector3(-s.radius, 0, -s.radius)));
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    return { center, radius: Math.max(size.x, size.z * 1.4) / 2 };
  }

  /** Where to put the camera to see a sphere of this radius around a point. */
  viewFor(center, radius, polar = 0.98) {
    const aspect = this.size.w / this.size.h;
    const vfov = (FOV * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = radius / Math.sin(Math.min(vfov, hfov) / 2) * 0.82;
    const az = this.controls.getAzimuthalAngle?.() ?? 0;
    const off = new THREE.Vector3().setFromSphericalCoords(dist, polar, az);
    return { target: center.clone(), position: center.clone().add(off) };
  }

  /** Glide the camera; the target can be a function (to follow a moving planet). */
  flyTo(view, ms = 900) {
    if (this.still) {
      const v = typeof view === "function" ? view() : view;
      this.controls.target.copy(v.target);
      this.camera.position.copy(v.position);
      this.controls.update();
      return;
    }
    this.fly = { from: { target: this.controls.target.clone(), position: this.camera.position.clone() }, to: view, t0: performance.now(), ms };
  }

  fit(ms = 700) {
    const systems = this.systems || [];
    if (!systems.length) return;
    const box = new THREE.Box3();
    for (const sy of systems) {
      box.expandByPoint(sy.center.clone().add(new THREE.Vector3(sy.radius, 0, sy.radius)));
      box.expandByPoint(sy.center.clone().add(new THREE.Vector3(-sy.radius, 0, -sy.radius)));
    }
    const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const polar = 0.9;
    const vfov = (FOV * Math.PI) / 180, tanV = Math.tan(vfov / 2), tanH = tanV * (this.size.w / this.size.h);
    // Room below for the books' names and the legend.
    const halfX = size.x / 2, halfZ = (size.z / 2) * Math.cos(polar) + 60;
    const dist = Math.max(halfX / tanH, halfZ / tanV, 260) * 1.14;
    center.z += dist * 0.035;
    const v = { target: center, position: center.clone().add(new THREE.Vector3().setFromSphericalCoords(dist, polar, 0)) };
    this.controls.maxDistance = dist * 3.2;
    this.fitDist = dist;
    this.flyTo(v, ms);
  }

  flyToSystem(id) {
    const s = this.systems?.find(x => x.id === id);
    if (s) this.flyTo(this.viewFor(s.center, s.radius * 0.95, 0.9), 1000);
  }

  /** Bring a planet close, a little left of the middle (the panel is on the right). */
  flyToPlanet(id, panelPx = 0) {
    const p = this.byId?.get(id);
    if (!p) return;
    const dist = Math.max(140, Math.min(320, (p.sys?.radius || 300) * 0.55));
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(() => {
      const target = p.pos.clone();
      return this.besidePanel({ target, position: target.clone().addScaledVector(dir, dist) }, panelPx);
    }, 1100);
  }

  /** The same view, moved so what it looks at sits in the middle of the part the panel leaves free. */
  besidePanel(view, panelPx) {
    if (!panelPx) return view;
    const dir = view.position.clone().sub(view.target);
    const perPx = (2 * dir.length() * Math.tan((FOV * Math.PI) / 360)) / this.size.h;
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const shift = right.multiplyScalar((panelPx / 2) * perPx);
    return { target: view.target.clone().add(shift), position: view.position.clone().add(shift) };
  }

  /** Frame a set of planets (a learning path). */
  flyToPlanets(ids, panelPx = 0) {
    const ps = ids.map(id => this.byId?.get(id)).filter(Boolean);
    if (!ps.length) return;
    this.flyTo(() => {
      const box = new THREE.Box3();
      for (const p of ps) box.expandByPoint(p.pos);
      const c = box.getCenter(new THREE.Vector3());
      const r = Math.max(110, box.getSize(new THREE.Vector3()).length() / 2 + 30);
      const free = Math.max(0.4, 1 - panelPx / Math.max(1, this.size.w));
      return this.besidePanel(this.viewFor(c, r / free, 0.85), panelPx);
    }, 1200);
  }

  zoom(f) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance || Infinity, off.length() / f));
    this.flyTo({ target: this.controls.target.clone(), position: this.controls.target.clone().add(off.setLength(len)) }, 380);
  }

  /** Where a planet is on screen right now (for the panel's morph, and tests). */
  project(id) {
    const s = this.screen.get(id);
    return s ? { x: s.x, y: s.y, r: s.r } : null;
  }

  // ── Each frame ──────────────────────────────────────────────────────────

  resize() {
    const r = this.host.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.size = { w, h };
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w * dpr * 0.5, h * dpr * 0.5);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.labels.width = Math.round(w * dpr);
    this.labels.height = Math.round(h * dpr);
    this.labels.style.width = `${w}px`;
    this.labels.style.height = `${h}px`;
    this.dpr = dpr;
    this.starMat.uniforms.uPixel.value = dpr;
  }

  positionPlanets(t) {
    const local = new THREE.Vector3();
    for (const p of this.planets || []) {
      const a = p.orbit.phase + p.orbit.omega * t;
      local.set(p.orbit.r * Math.cos(a), 0, p.orbit.r * Math.sin(a));
      p.pos.copy(local).applyMatrix4(p.sys.matrix);
    }
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.planets) { this.renderer.render(this.scene, this.camera); return; }
    const secs = now / 1000;
    const c = this.clock;
    const target = this.still || c.hold ? 0 : 1;
    c.speed += (target - c.speed) * Math.min(1, dt * 3.2);
    if (Math.abs(target - c.speed) < 0.003) c.speed = target;
    c.t += dt * c.speed;

    // Highlight fades in and out.
    const f = this.focus, want = f.hover ?? f.selected;
    if (want && want !== f.id) { f.id = want; f.mix = Math.max(f.mix, 0.35); }
    f.mix += ((want ? 1 : 0) - f.mix) * Math.min(1, dt * 8);
    if (!want && f.mix < 0.01) { f.mix = 0; f.id = null; }
    this.pathMix += ((this.path ? 1 : 0) - this.pathMix) * Math.min(1, dt * 5);

    // Camera glides.
    if (this.fly) {
      const fl = this.fly, p = fl.ms ? Math.min(1, (now - fl.t0) / fl.ms) : 1, e = ease(p);
      const to = typeof fl.to === "function" ? fl.to() : fl.to;
      this.controls.target.lerpVectors(fl.from.target, to.target, e);
      this.camera.position.lerpVectors(fl.from.position, to.position, e);
      if (p >= 1) this.fly = null;
    }
    this.controls.update();

    this.positionPlanets(c.t);
    const tm = this.still ? 0 : secs;
    this.planetMat.uniforms.uTime.value = tm;
    this.starMat.uniforms.uTime.value = tm;
    this.pointsMat.uniforms.uScale.value = this.size.h / (2 * Math.tan((FOV * Math.PI) / 360));

    const near = f.id ? this.adj.get(f.id) : null;
    const isNear = (id) => id === f.id || Boolean(near?.has(id));
    const path = this.path;
    const dimFor = (p) => {
      let d = 1;
      if (f.id && !isNear(p.id)) d *= 1 - 0.78 * f.mix;
      if (path && !path.set.has(p.id)) d *= 1 - 0.85 * this.pathMix;
      return d;
    };

    // Planets (and their appearance in the time-lapse).
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    const camPos = this.camera.position;
    let ringK = 0;
    const ringScale = smooth(camPos.distanceTo(this.controls.target), 1600, 650);
    for (const p of this.planets) {
      const shown = !this.visible || this.visible.has(p.id);
      const g = this.grow.get(p.id) ?? (shown ? 1 : 0);
      const ng = g + ((shown ? 1 : 0) - g) * Math.min(1, dt * 5);
      this.grow.set(p.id, ng);
      const r = p.r * (p.look?.scale ?? 1) * (ng < 0.002 ? 0 : 0.2 + 0.8 * ng);
      q.setFromAxisAngle(sc.set(0.3, 1, 0).normalize(), secs * 0.15 + p.i);
      m.compose(p.pos, q, sc.set(r, r, r));
      this.mesh.setMatrixAt(p.i, m);
      this.attrs.aDim.setX(p.i, dimFor(p));
      if (p.ringIndex != null) {
        q.setFromAxisAngle(sc.set(0, 0, 1), 0.2 + seeded(p.id, 9) * 0.3);
        m.compose(p.pos, q, sc.set(r, r, r));
        this.ringMesh.setMatrixAt(p.ringIndex, m);
        const L0 = p.look || {};
        this.ringAttrs.aAlpha.setX(p.ringIndex, 0.42 * ringScale * dimFor(p) * ng * (1 - 0.6 * (L0.fog || 0)) * (L0.dark ? 0.45 : 1) * (L0.scale < 1 ? 0 : 1));
        ringK++;
      }
      // Halo: a glow for mastered and slipping planets, a haze for fading ones.
      const L = p.look || {};
      const pulse = L.pulse ? 0.45 + 0.55 * Math.sin(tm * 2.6) : 1;
      const d = dimFor(p) * ng;
      const hi = p.i * 2, fi = p.i * 2 + 1;
      this.halo.pos.set([p.pos.x, p.pos.y, p.pos.z], hi * 3);
      this.halo.pos.set([p.pos.x, p.pos.y, p.pos.z], fi * 3);
      this.halo.size[hi] = r * 7.5;
      this.halo.alpha[hi] = (L.halo || 0) * 0.42 * pulse * d;
      const col = L.pulse ? SLIPPING : p.base;
      this.halo.color.set([col.r, col.g, col.b], hi * 3);
      this.halo.size[fi] = r * (6 + 6 * (L.fog || 0));
      this.halo.alpha[fi] = (L.fog || 0) * 0.28 * d;
      this.halo.color.set([0.55, 0.62, 0.8], fi * 3);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.ringMesh.instanceMatrix.needsUpdate = ringK > 0;
    this.ringAttrs.aAlpha.needsUpdate = ringK > 0;
    this.attrs.aDim.needsUpdate = true;
    const hg = this.halos.geometry;
    for (const k of ["position", "aSize", "aAlpha", "aColor"]) hg.attributes[k].needsUpdate = true;

    // Suns (dimmer when the focus is elsewhere; hidden in the time-lapse until their first planet).
    let nearest = 0;
    for (const s of this.systems) {
      const anyShown = !this.visible || this.planets.some(p => p.courseId === s.id && this.visible.has(p.id));
      const holds = !f.id || this.planets.some(p => p.courseId === s.id && isNear(p.id));
      const pathHolds = !path || this.planets.some(p => p.courseId === s.id && path.set.has(p.id));
      const target2 = (anyShown ? 1 : 0) * (holds ? 1 : 1 - 0.55 * f.mix) * (pathHolds ? 1 : 1 - 0.6 * this.pathMix);
      s.vis = (s.vis ?? target2) + (target2 - (s.vis ?? target2)) * Math.min(1, dt * 5);
      s.sunMat.uniforms.uTime.value = tm;
      s.sun.scale.setScalar(0.3 + 0.7 * s.vis);
      // Seen from afar the corona carries the sun; close up it (and the bloom of a big bright disc)
      // would fog the whole view, so the corona draws in and the disc burns less hot.
      const rpx = (s.sunR / Math.max(1, camPos.distanceTo(s.center))) * this.pointsMat.uniforms.uScale.value;
      const close = smooth(rpx, 12, 70), disc = smooth(rpx, 36, 200);
      // ...and never grows past a few hundred pixels across.
      const perWorld = this.pointsMat.uniforms.uScale.value / Math.max(1, camPos.distanceTo(s.center));
      s.corona.scale.setScalar(Math.min(s.sunR * (12 - 7 * close), 300 / perWorld));
      s.spikes.scale.setScalar(Math.min(s.sunR * (14 - 8 * close), 360 / perWorld));
      s.corona.material.opacity = 0.9 * s.vis * (1 - 0.45 * close) * (1 - 0.8 * disc) * (this.still ? 1 : 1 + 0.035 * Math.sin(secs * 0.9));
      s.spikes.material.opacity = 0.32 * s.vis * (1 - 0.85 * close);
      s.sunMat.uniforms.uDim.value = s.vis * (1 - 0.42 * disc);
      s.sunMat.uniforms.uClose.value = disc;
      nearest = Math.max(nearest, disc * s.vis);
      for (const [k, ring] of s.rings.entries()) {
        const ringShown = !this.visible || this.planets.some(p => p.courseId === s.id && p.orbit.ring === k && this.visible.has(p.id));
        const lit = f.id && this.byId.get(f.id)?.courseId === s.id && this.byId.get(f.id)?.orbit.ring === k;
        ring.mat.opacity = (ringShown ? ring.base : 0) * s.vis + (lit ? 0.16 * f.mix : 0);
      }
    }

    // Next to a sun, bloom would wash its light over everything: keep it tight.
    this.bloom.strength = 0.72 * (1 - 0.6 * nearest);
    this.bloom.radius = 0.38 * (1 - 0.7 * nearest);

    // Streams and their motes.
    let mi = 0;
    for (const br of this.bridges) {
      const shown = this.systems.find(s => s.id === br.a)?.vis ?? 1;
      const shownB = this.systems.find(s => s.id === br.b)?.vis ?? 1;
      const a = Math.min(shown, shownB) * (1 - 0.7 * f.mix) * (1 - 0.8 * this.pathMix);
      br.mat.uniforms.uAlpha.value = 0.16 * br.strength * a;
      br.innerMat.uniforms.uAlpha.value = 0.5 * br.strength * a;
      for (const mo of br.motes) {
        const u = this.still ? mo.u : (mo.u + secs * mo.speed) % 1;
        const pt = br.curve.getPoint(u).addScaledVector(mo.off, Math.sin(Math.PI * u));
        this.mote.pos.set([pt.x, pt.y, pt.z], mo.i * 3);
        this.mote.alpha[mo.i] = Math.pow(Math.sin(Math.PI * u), 1.4) * 0.9 * a;
        mi++;
      }
    }
    if (mi) { this.motes.geometry.attributes.position.needsUpdate = true; this.motes.geometry.attributes.aAlpha.needsUpdate = true; }

    // Links: the focused planet's (bright arcs), or, in one course, all of them faintly.
    let v = 0;
    const SEG = this.arcSeg, P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), Cc = new THREE.Vector3();
    const curveSeg = (A, B, color, alpha) => {
      Cc.copy(A).lerp(B, 0.5);
      const lift = A.distanceTo(B) * 0.22 + 8;
      Cc.y += lift;
      for (let k = 0; k < SEG; k++) {
        const t0 = k / SEG, t1 = (k + 1) / SEG;
        P0.copy(A).multiplyScalar((1 - t0) * (1 - t0)).addScaledVector(Cc, 2 * (1 - t0) * t0).addScaledVector(B, t0 * t0);
        P1.copy(A).multiplyScalar((1 - t1) * (1 - t1)).addScaledVector(Cc, 2 * (1 - t1) * t1).addScaledVector(B, t1 * t1);
        const fade = Math.sin(Math.PI * (t0 + t1) / 2) * 0.6 + 0.4;
        this.arc.pos.set([P0.x, P0.y, P0.z, P1.x, P1.y, P1.z], v * 3);
        const cr = color.r * alpha * fade, cg = color.g * alpha * fade, cb = color.b * alpha * fade;
        this.arc.color.set([cr, cg, cb, cr, cg, cb], v * 3);
        v += 2;
      }
    };
    const white = WHITE_ARC, faint = FAINT_ARC;
    // A book's own web of links shows its shape from afar; close up it would just be lines across the view.
    const web = this.oneCourse ? smooth(camPos.distanceTo(this.controls.target) / (this.fitDist || 1000), 0.3, 0.75) : 0;
    for (const l of this.links) {
      const on = f.id && (l.a === f.id || l.b === f.id) && f.mix > 0;
      const vis = (!this.visible || (this.visible.has(l.a) && this.visible.has(l.b)));
      if (!vis) continue;
      if (on) curveSeg(l.A.pos, l.B.pos, white, f.mix * (l.provisional ? 0.5 : 0.95));
      else if (web > 0.01) curveSeg(l.A.pos, l.B.pos, faint, web * (l.provisional ? 0.05 : 0.09) * (1 - 0.7 * f.mix) * (1 - 0.85 * this.pathMix));
    }
    this.arcs.geometry.setDrawRange(0, v);
    this.arcs.geometry.attributes.position.needsUpdate = true;
    this.arcs.geometry.attributes.color.needsUpdate = true;

    this.composer.render(dt);
    this.drawLabels();
  }

  /** Names: books always; planets nearest and most important first, as they get big enough on screen. And the learning path. */
  drawLabels() {
    const g = this.lctx, { w, h } = this.size, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const v = new THREE.Vector3();
    const f = this.focus, near = f.id ? this.adj.get(f.id) : null;
    const isNear = (id) => id === f.id || Boolean(near?.has(id));
    const path = this.path;
    const perPx = this.size.h / (2 * Math.tan((FOV * Math.PI) / 360));
    this.screen.clear();
    const placed = [];
    const claim = (x0, y0, x1, y1, force = false) => {
      if (!force) for (const q of placed) if (x0 < q[2] && x1 > q[0] && y0 < q[3] && y1 > q[1]) return false;
      placed.push([x0, y0, x1, y1]);
      return true;
    };
    const shadow = (blur, color = "rgba(0, 0, 0, .9)") => { g.shadowBlur = blur; g.shadowColor = color; };

    // Planets: project them all (for picking and the path), then label the ones that earn it.
    const cands = [];
    for (const p of this.planets) {
      if (this.visible && !this.visible.has(p.id)) continue;
      v.copy(p.pos).project(this.camera);
      if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) continue;
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const dist = this.camera.position.distanceTo(p.pos);
      const r = Math.max(1.5, (p.r * (p.look?.scale ?? 1) / dist) * perPx);
      this.screen.set(p.id, { x, y, r, depth: dist });
      const own = smooth(r, p.core ? 3.4 : 5.2, p.core ? 5.2 : 7.4);
      let a = own;
      if (f.id) a = isNear(p.id) ? Math.max(own, f.mix) : own * (1 - 0.8 * f.mix);
      if (path) a = path.set.has(p.id) ? Math.max(a, this.pathMix) : a * (1 - 0.85 * this.pathMix);
      const focus = p.id === f.id && f.mix > 0.05;
      if (a > 0.03 || focus) cands.push({ p, x, y, r, a: focus ? Math.max(a, f.mix) : a, focus, rank: (focus ? -2 : 0) + (path?.set.has(p.id) ? 0 : 1) + (f.id && isNear(p.id) ? 0 : 1) + (p.core ? 0 : 1), dist });
    }

    // The learning path: a constellation, a fine gold line from each step to the next, and a circle round each step.
    if (path) this.lastPath = path;
    const pp = path || (this.pathMix > 0.01 ? this.lastPath : null);
    if (pp) {
      g.save();
      g.globalAlpha = this.pathMix;
      shadow(7, "rgba(255, 196, 110, .6)");
      g.strokeStyle = "rgba(255, 230, 182, .95)";
      g.lineWidth = 1.5;
      for (const l of pp.links) {
        const A = this.screen.get(l.from), B = this.screen.get(l.to);
        if (!A || !B) continue;
        const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy);
        const a0 = A.r + 6, b0 = B.r + 6;
        if (len < a0 + b0 + 4) continue;
        const ux = dx / len, uy = dy / len;
        g.beginPath();
        g.moveTo(A.x + ux * a0, A.y + uy * a0);
        g.lineTo(B.x - ux * b0, B.y - uy * b0);
        g.stroke();
      }
      g.lineWidth = 1;
      g.strokeStyle = "rgba(255, 228, 176, .6)";
      for (const id of pp.nodes) {
        const S = this.screen.get(id);
        if (!S) continue;
        g.beginPath();
        g.arc(S.x, S.y, S.r + 4, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }

    // Names that must show (what you're pointing at, the path's steps) are placed first.
    cands.sort((a, b) => a.rank - b.rank || a.dist - b.dist);
    const must = [];
    g.textAlign = "center";
    for (const c of cands) {
      const step = pp?.step.get(c.p.id);
      if (!c.focus && !step) continue;
      c.text = step ? `${step}  ${c.p.name}` : c.p.name;
      c.font = c.focus ? `600 12px ${this.font}` : `500 11.5px ${this.font}`;
      g.font = c.font;
      const tw = g.measureText(c.text).width, y = c.y + c.r + (c.focus ? 15 : 14);
      c.box = [c.x - tw / 2 - 3, y - 11, c.x + tw / 2 + 3, y + 4];
      c.ty = y;
      if (!claim(...c.box, c.focus)) { c.text = null; continue; }
      must.push(c);
    }

    // Books' names, in the serif, under their suns.
    this.sunScreen = [];
    for (const s of this.systems) {
      v.copy(s.center).project(this.camera);
      if (v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const dist = this.camera.position.distanceTo(s.center);
      const r = (s.sunR / dist) * perPx;
      this.sunScreen.push({ id: s.id, x, y, r, lines: s.lines });
      if ((s.vis ?? 1) < 0.05) continue;
      const fs = 15;
      const y0 = y + Math.max(r * 1.25, 14) + fs + 4;
      g.font = `500 ${fs}px ${this.serif}`;
      const half = Math.max(...s.lines.map(l => g.measureText(l).width)) / 2;
      const box = [x - half, y0 - fs, x + half, y0 + (s.lines.length - 1) * fs * 1.25 + 4];
      const under = must.some(c => box[0] < c.box[2] && box[2] > c.box[0] && box[1] < c.box[3] && box[3] > c.box[1]);
      placed.push(box);
      g.globalAlpha = 0.95 * (s.vis ?? 1) * (under ? 0.22 : 1);
      shadow(10);
      g.fillStyle = "#F3F2EE";
      s.lines.forEach((line, i) => g.fillText(line, x, y0 + i * fs * 1.25));
    }

    // Planets' names: those placed above, then the rest where there's room.
    shadow(5);
    for (const c of must) {
      g.font = c.font;
      g.globalAlpha = Math.min(1, c.a);
      g.fillStyle = c.focus ? "#FFFFFF" : "#FFF0CF";
      g.fillText(c.text, c.x, c.ty);
    }
    g.font = `500 11px ${this.font}`;
    for (const c of cands) {
      if (c.box) continue;
      const tw = g.measureText(c.p.name).width;
      const y = c.y + c.r + 13;
      if (!claim(c.x - tw / 2 - 2, y - 10, c.x + tw / 2 + 2, y + 3)) continue;
      g.globalAlpha = Math.min(1, c.a) * 0.92;
      g.fillStyle = "#D6DBE6";
      g.fillText(c.p.name, c.x, y);
    }
    shadow(0, "transparent");
    g.globalAlpha = 1;
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let best = null, bestD = Infinity;
    for (const [id, s] of this.screen) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < s.r + 8 && d < bestD) { best = { id }; bestD = d; }
    }
    return best;
  }

  pickSun(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    return this.sunScreen.find(s => Math.hypot(s.x - x, s.y - y) < Math.max(14, s.r * 1.6)
      || (Math.abs(x - s.x) < 80 && y > s.y + s.r && y < s.y + Math.max(s.r * 1.6, 14) + 18 * s.lines.length + 8));
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this.handlers.down);
    el.removeEventListener("pointermove", this.handlers.move);
    el.removeEventListener("pointerup", this.handlers.up);
    el.removeEventListener("pointerleave", this.handlers.leave);
    el.removeEventListener("contextmenu", this.handlers.context);
    this.controls.dispose();
    for (const d of [...this.disposables, ...this.backdrop]) d.dispose?.();
    this.composer.dispose?.();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
    this.labels.remove();
  }
}
