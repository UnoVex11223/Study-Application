// The knowledge map's sky in 3D (three.js), drawn like a real orrery: every
// book is a star, its chapters are hairline orbits on a slightly tilted plane,
// its concepts are planets going round.
//
// Planets are real worlds lit by their own star: rocky, gas giants, ice
// giants and ocean worlds (each concept always the same kind), with a day
// side, a near-black night side and a thin atmosphere at the lit limb, so they
// wax and wane as they go round and as you turn the camera. Their surface
// carries the course's colour; how much says how well you know it (a concept
// you haven't started is a grey world, one you're forgetting greys out and
// dims, one that's slipping turns amber). Only the stars are bright enough to
// glow. Books that share ideas are joined by one thin line with the number of
// links on it; a planet's own links arc between planets when you point at it.
// A learning path is drawn as a constellation. Names are drawn on a 2D canvas
// over the scene, nearest and most important first, and come in as you get
// closer.
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
import { seeded } from "../lib/orbits.js";

const SLIPPING = new THREE.Color("#E0974A");
const ARC = new THREE.Color(0.9, 0.92, 0.98), FAINT_ARC = new THREE.Color(0.5, 0.54, 0.62);
const DEPTH = 1.15;            // the 2D layout is squashed for wide screens; give back some depth
const FOV = 38;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (v, a, b) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/**
 * How a planet is drawn for its kind ("bright" mastered, "lit" learning,
 * "slipping", "dark" not started, "dust" in a chapter you haven't read):
 * how much of the course's colour its surface carries, how bright it is, how
 * much atmosphere shows at the limb, and its size.
 */
function kindLook(kind) {
  switch (kind) {
    case "bright": return { sat: 1, bright: 1, atmo: 1, scale: 1, amber: false };
    case "lit": return { sat: 0.72, bright: 0.86, atmo: 0.5, scale: 1, amber: false };
    case "slipping": return { sat: 1.3, bright: 0.98, atmo: 0.6, scale: 1, amber: true };
    case "dust": return { sat: 0, bright: 0.38, atmo: 0, scale: 0.7, amber: false };
    default: return { sat: 0.06, bright: 0.58, atmo: 0, scale: 1, amber: false };
  }
}

/** What kind of world a concept is: rocky, gas giant, ice giant or ocean (always the same for a concept). Core concepts lean to the giants. */
function worldType(p) {
  const r = seeded(p.id, 11);
  if (p.core) return r < 0.42 ? 1 : r < 0.66 ? 2 : r < 0.84 ? 3 : 0;
  return r < 0.46 ? 0 : r < 0.64 ? 3 : r < 0.84 ? 1 : 2;
}

/** A star's colour: near-white, leaning a little toward its course's colour. */
function starColor(hex) {
  const hsl = {};
  new THREE.Color(hex).getHSL(hsl);
  return new THREE.Color().setHSL(hsl.h, 0.5, 0.84);
}

// ── Shaders ────────────────────────────────────────────────────────────────

const NOISE = /* glsl */`
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;

const PLANET_VS = /* glsl */`
  attribute vec3 aColor; attribute vec3 aSun; attribute vec4 aLook; attribute vec2 aKind; attribute float aDim;
  varying vec3 vN; varying vec3 vW; varying vec3 vObj; varying vec3 vColor; varying vec3 vSun;
  varying vec4 vLook; varying vec2 vKind; varying float vDim;
  void main() {
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vObj = position; vColor = aColor; vSun = aSun; vLook = aLook; vKind = aKind; vDim = aDim;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// aLook: how much of the course's colour, brightness, atmosphere, memory fog. aKind: seed, world type.
const PLANET_FS = /* glsl */`
  uniform float uTime;
  varying vec3 vN; varying vec3 vW; varying vec3 vObj; varying vec3 vColor; varying vec3 vSun;
  varying vec4 vLook; varying vec2 vKind; varying float vDim;
  ${NOISE}
  void main() {
    vec3 N = normalize(vN), V = normalize(cameraPosition - vW), L = normalize(vSun - vW);
    vec3 p = normalize(vObj);
    float seed = vKind.x * 17.0, type = vKind.y;
    vec3 albedo; float spec = 0.0;
    if (type < 0.5) {            // rocky: mottled highlands and maria, a few dark craters
      float h = fbm(p * 2.4 + seed), d = fbm(p * 9.0 - seed);
      albedo = vec3(0.52, 0.48, 0.44) * (0.5 + 0.75 * h) * (0.86 + 0.28 * d);
      albedo *= 1.0 - 0.28 * smoothstep(0.64, 0.72, noise(p * 7.0 + seed * 3.0));
    } else if (type < 1.5) {     // gas giant: banded, with turbulence between the bands
      float t = fbm(p * vec3(1.6, 5.0, 1.6) + seed);
      float lat = p.y + (t - 0.5) * 0.32;
      float bands = sin(lat * (10.0 + fract(seed) * 9.0)) * 0.5 + 0.5;
      float fine = sin(lat * 38.0 + t * 5.0) * 0.5 + 0.5;
      albedo = mix(vec3(0.58, 0.47, 0.36), vec3(0.88, 0.81, 0.68), bands * 0.72 + fine * 0.28);
    } else if (type < 2.5) {     // ice giant: smooth, with faint streaks
      float t = fbm(p * vec3(1.2, 4.2, 1.2) + seed);
      albedo = mix(vec3(0.6, 0.75, 0.84), vec3(0.8, 0.89, 0.93), t);
      spec = 0.18;
    } else {                     // ocean world: seas, land and drifting cloud
      float land = smoothstep(0.5, 0.56, fbm(p * 2.2 + seed));
      albedo = mix(vec3(0.06, 0.14, 0.27), mix(vec3(0.33, 0.34, 0.25), vec3(0.55, 0.48, 0.36), fbm(p * 8.0)), land);
      spec = (1.0 - land) * 0.55;
      float cloud = smoothstep(0.55, 0.8, fbm(p * 3.4 + vec3(seed, uTime * 0.004, 0.0)));
      albedo = mix(albedo, vec3(0.9), cloud * 0.75);
      spec *= 1.0 - cloud;
    }
    // The course's colour carried by the surface's own light and dark; none of it on a world you haven't started.
    float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
    vec3 tinted = mix(albedo, vColor * lum * 1.7, clamp(0.7 * vLook.x, 0.0, 0.92));
    vec3 col = mix(vec3(lum) * vec3(0.95, 0.96, 1.0), tinted, min(vLook.x, 1.0)) * vLook.y;

    float ndl = dot(N, L);
    float term = smoothstep(-0.1, 0.22, ndl);
    vec3 lit = col * (0.018 + 1.2 * max(ndl, 0.0) * term + 0.03 * term);
    vec3 H = normalize(L + V);
    lit += vec3(1.0, 0.97, 0.92) * spec * pow(max(dot(N, H), 0.0), 42.0) * term * 0.55;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.2);
    lit += mix(vec3(0.5, 0.68, 1.0), vColor, 0.35) * fres * smoothstep(-0.25, 0.35, ndl) * vLook.z * 0.85;
    // Forgetting: the colour drains and the world dims.
    float fog = vLook.w, l2 = dot(lit, vec3(0.299, 0.587, 0.114));
    lit = mix(lit, vec3(l2) * vec3(0.92, 0.95, 1.0), fog * 0.85) * (1.0 - fog * 0.42);
    gl_FragColor = vec4(lit * vDim, 1.0);
  }`;

const SUN_VS = /* glsl */`
  varying vec3 vN; varying vec3 vW; varying vec3 vObj;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vObj = position;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// A star: white-hot in the middle, warmer and darker toward the limb, with
// granulation. Bright enough to glow from afar; up close it burns less hot so
// its surface shows instead of a white disc.
const SUN_FS = /* glsl */`
  uniform vec3 uColor; uniform float uTime; uniform float uDim; uniform float uClose;
  varying vec3 vN; varying vec3 vW; varying vec3 vObj;
  ${NOISE}
  void main() {
    vec3 V = normalize(cameraPosition - vW);
    float mu = max(dot(normalize(vN), V), 0.0);
    vec3 p = normalize(vObj) * 6.0;
    float g = noise(p + uTime * 0.05) * 0.55 + noise(p * 2.7 - uTime * 0.03) * 0.3 + noise(p * 7.0 + uTime * 0.07) * 0.15;
    vec3 limbCol = mix(vec3(1.0, 0.55, 0.26), uColor, 0.3);
    vec3 col = mix(limbCol, mix(uColor, vec3(1.0), 0.55), pow(mu, 0.55));
    col *= (0.42 + 0.58 * pow(mu, 0.45)) * (0.84 + 0.3 * g);
    gl_FragColor = vec4(col * mix(2.6, 0.92, uClose) * uDim, 1.0);
  }`;

const STARS_VS = /* glsl */`
  attribute float aSize; attribute vec3 aColor;
  uniform float uPixel;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixel;
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }`;

const STARS_FS = /* glsl */`
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = smoothstep(1.0, 0.25, d);
    gl_FragColor = vec4(vColor * a, a);
  }`;

// ── The sky behind everything, painted once onto the inside of a sphere ────

/** A faint, grey Milky Way: a band of unresolved stars with dust down the middle, like a long exposure. */
function paintDome(w = 2048, h = 1024) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, w, h);
  let seed = 4021;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const gauss = () => (rand() + rand() + rand() - 1.5) / 1.5;
  const bandY = (x) => h * 0.5 + Math.sin((x / w) * Math.PI * 2 + 0.6) * h * 0.18;
  const blob = (x, y, r, rgb, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`);
    gr.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (let i = 0; i < 220; i++) {
    const x = rand() * w, y = bandY(x) + gauss() * h * 0.06;
    blob(x, y, h * (0.05 + rand() * 0.1), [150, 150, 160], 0.03 + rand() * 0.025);
  }
  // Unresolved stars along the band: a fine grain rather than clouds.
  for (let i = 0; i < 26000; i++) {
    const x = rand() * w, y = bandY(x) + gauss() * h * 0.07;
    const v = 140 + Math.floor(rand() * 90);
    g.fillStyle = `rgba(${v}, ${v}, ${v + 8}, ${0.05 + rand() * 0.12})`;
    g.fillRect(x, y, 1, 1);
  }
  for (let i = 0; i < 120; i++) {
    const x = rand() * w, y = bandY(x) + gauss() * h * 0.016;
    blob(x, y, h * (0.01 + rand() * 0.03), [0, 0, 0], 0.5);
  }
  // Seen magnified on the dome, single-pixel grain turns into a crosshatch: soften it into haze.
  const soft = document.createElement("canvas");
  soft.width = w; soft.height = h;
  const sg = soft.getContext("2d");
  sg.filter = "blur(2.5px)";
  sg.drawImage(c, 0, 0);
  const tex = new THREE.CanvasTexture(sg.filter === "blur(2.5px)" ? soft : c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A star's soft glow: a smooth falloff with no rays or rings. */
function paintGlow(size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2);
      const a = d >= 1 ? 0 : Math.pow(1 - d, 2.2) * (0.35 * Math.exp(-d * 9) + 0.65 * Math.exp(-d * 3.2));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * Math.min(1, a));
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Star colours by temperature, mostly white.
const STAR_COLORS = [[1, 1, 1], [1, 1, 1], [0.86, 0.9, 1], [1, 0.95, 0.86], [1, 0.86, 0.72], [0.74, 0.82, 1]];

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
    this.mono = getComputedStyle(document.documentElement).getPropertyValue("--mono").trim() || "monospace";
    this.disposables = [];   // the world's resources (rebuilt by setData)
    this.backdrop = [];      // the sky's (kept until dispose)

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
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

    // Post: only the stars are bright enough to glow, the way a camera sees them; then tone mapping.
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.34, 0.12, 0.9);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.glowTex = paintGlow();
    this.backdrop.push(this.glowTex);
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
      new THREE.MeshBasicMaterial({ map: paintDome(), side: THREE.BackSide, depthWrite: false, toneMapped: false, color: new THREE.Color(0.6, 0.6, 0.6) }),
    );
    dome.rotation.z = 0.5;
    dome.rotation.x = -0.35;
    this.scene.add(dome);
    this.backdrop.push(dome.geometry, dome.material, dome.material.map);

    // Stars: crisp points, most of them faint, a few bright, a third of them along the Milky Way. They don't twinkle: there's no air up here.
    const n = 9000, pos = new Float32Array(n * 3), size = new Float32Array(n), col = new Float32Array(n * 3);
    let s = 77;
    const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const v = new THREE.Vector3();
    const band = new THREE.Euler(-0.35, 0, 0.5);
    for (let i = 0; i < n; i++) {
      if (i % 3 === 0) {
        const a = rand() * Math.PI * 2, off = (rand() + rand() + rand() - 1.5) * 0.08;
        v.set(Math.cos(a), off, Math.sin(a)).normalize().applyEuler(band);
      } else {
        v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
        if (v.lengthSq() < 0.01) v.set(0, 1, 0);
        v.normalize();
      }
      v.multiplyScalar(26000);
      pos.set([v.x, v.y, v.z], i * 3);
      const m = Math.pow(rand(), 7);
      size[i] = 1.1 + m * 2.4;
      const c = STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)];
      const b = 0.16 + Math.pow(rand(), 3) * 0.32 + m * 0.9;
      col.set([c[0] * b, c[1] * b, c[2] * b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    this.starMat = new THREE.ShaderMaterial({
      vertexShader: STARS_VS, fragmentShader: STARS_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uPixel: { value: 1 } },
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
   * oneCourse: true when the map shows a single course
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
      // The star: a granulated, limb-darkened ball in a soft glow.
      const color = starColor(sys.color);
      const sunMat = new THREE.ShaderMaterial({ vertexShader: SUN_VS, fragmentShader: SUN_FS, uniforms: { uColor: { value: color }, uTime: { value: 0 }, uDim: { value: 1 }, uClose: { value: 0 } } });
      const sun = new THREE.Mesh(new THREE.SphereGeometry(sys.sunR, 48, 32), sunMat);
      g.add(sun);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }));
      glow.scale.setScalar(sys.sunR * 7);
      g.add(glow);
      this.disposables.push(sun.geometry, sunMat, glow.material);
      // Chapters: hairline orbits, fainter for chapters you haven't read.
      const rings = sys.rings.map(ring => {
        const pts = new THREE.EllipseCurve(0, 0, ring.r, ring.r, 0, Math.PI * 2).getPoints(200).map(p => new THREE.Vector3(p.x, 0, p.y));
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const base = ring.locked ? 0.035 : 0.085;
        const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.78, 0.8, 0.86), transparent: true, opacity: base, depthWrite: false });
        const line = new THREE.LineLoop(geo, mat);
        g.add(line);
        this.disposables.push(geo, mat);
        return { line, mat, base, locked: ring.locked };
      });
      return { ...sys, center, group: g, sun, sunMat, glow, rings, matrix: null };
    });
    const sysById = new Map(this.systems.map(s => [s.id, s]));
    for (const s of this.systems) { s.group.updateMatrixWorld(true); s.matrix = s.group.matrixWorld.clone(); }

    // Planets: one instanced mesh, their own lighting (see PLANET_FS).
    const n = planets.length;
    this.planets = planets.map((p, i) => ({ ...p, i, sys: sysById.get(p.courseId), pos: new THREE.Vector3(), base: new THREE.Color(p.color) }));
    this.byId = new Map(this.planets.map(p => [p.id, p]));
    const geo = new THREE.SphereGeometry(1, 48, 32);
    const attr = (k, dynamic = false) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * k), k);
      if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.attrs = { aColor: attr(3), aSun: attr(3), aLook: attr(4), aKind: attr(2), aDim: attr(1, true) };
    for (const [k, a] of Object.entries(this.attrs)) geo.setAttribute(k, a);
    this.planetMat = new THREE.ShaderMaterial({ vertexShader: PLANET_VS, fragmentShader: PLANET_FS, uniforms: { uTime: { value: 0 } } });
    this.mesh = new THREE.InstancedMesh(geo, this.planetMat, Math.max(1, n));
    this.mesh.count = n;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(this.mesh);
    this.disposables.push(geo, this.planetMat);
    this.planets.forEach(p => {
      this.attrs.aKind.setXY(p.i, seeded(p.id, 5), worldType(p));
      this.attrs.aDim.setX(p.i, 1);
      const c = p.sys?.center || new THREE.Vector3();
      this.attrs.aSun.setXYZ(p.i, c.x, c.y, c.z);
    });

    // Links between books: one thin line from one system's edge to the other's, bowed a little, with how many links it stands for.
    this.bridges = bridges.map(br => {
      const A = sysById.get(br.a), B = sysById.get(br.b);
      if (!A || !B) return null;
      const dir = B.center.clone().sub(A.center).normalize();
      const a = A.center.clone().addScaledVector(dir, Math.max(A.sunR * 3, A.radius - 30));
      const b = B.center.clone().addScaledVector(dir, -Math.max(B.sunR * 3, B.radius - 30));
      if (a.distanceTo(A.center) > b.distanceTo(A.center)) return null; // systems overlap: nothing to draw between them
      const mid = a.clone().lerp(b, 0.5);
      mid.y += a.distanceTo(b) * 0.12;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const strength = Math.min(1, 0.45 + br.n / 30);
      const geo2 = new THREE.BufferGeometry().setFromPoints(curve.getPoints(80));
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.82, 0.85, 0.92), transparent: true, opacity: 0.3 * strength, depthWrite: false });
      const line = new THREE.Line(geo2, mat);
      group.add(line);
      this.disposables.push(geo2, mat);
      return { curve, line, mat, strength, n: br.n, a: br.a, b: br.b, mid: curve.getPoint(0.5) };
    }).filter(Boolean);

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
      const k = kindLook(l.kind);
      p.look = { ...k, fog: l.fog || 0 };
      const c = k.amber ? SLIPPING : p.base;
      this.attrs.aColor.setXYZ(p.i, c.r, c.g, c.b);
      this.attrs.aLook.setXYZW(p.i, k.sat, k.bright, k.atmo, l.fog || 0);
    }
    this.attrs.aColor.needsUpdate = true;
    this.attrs.aLook.needsUpdate = true;
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
    this.perPx = this.size.h / (2 * Math.tan((FOV * Math.PI) / 360));

    const near = f.id ? this.adj.get(f.id) : null;
    const isNear = (id) => id === f.id || Boolean(near?.has(id));
    const path = this.path;
    const dimFor = (p) => {
      let d = 1;
      if (f.id && !isNear(p.id)) d *= 1 - 0.72 * f.mix;
      if (path && !path.set.has(p.id)) d *= 1 - 0.82 * this.pathMix;
      return d;
    };

    // Planets (and their appearance in the time-lapse). Each turns slowly on its own axis.
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), ax = new THREE.Vector3(0.18, 1, 0).normalize(), sc = new THREE.Vector3();
    for (const p of this.planets) {
      const shown = !this.visible || this.visible.has(p.id);
      const g = this.grow.get(p.id) ?? (shown ? 1 : 0);
      const ng = g + ((shown ? 1 : 0) - g) * Math.min(1, dt * 5);
      this.grow.set(p.id, ng);
      const r = p.r * (p.look?.scale ?? 1) * (ng < 0.002 ? 0 : 0.2 + 0.8 * ng);
      q.setFromAxisAngle(ax, tm * 0.06 + p.i * 1.7);
      m.compose(p.pos, q, sc.set(r, r, r));
      this.mesh.setMatrixAt(p.i, m);
      this.attrs.aDim.setX(p.i, dimFor(p) * (0.25 + 0.75 * ng));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.attrs.aDim.needsUpdate = true;

    // Stars (dimmer when the focus is elsewhere; hidden in the time-lapse until their first planet).
    const camPos = this.camera.position;
    let nearest = 0;
    for (const s of this.systems) {
      const anyShown = !this.visible || this.planets.some(p => p.courseId === s.id && this.visible.has(p.id));
      const holds = !f.id || this.planets.some(p => p.courseId === s.id && isNear(p.id));
      const pathHolds = !path || this.planets.some(p => p.courseId === s.id && path.set.has(p.id));
      const target2 = (anyShown ? 1 : 0) * (holds ? 1 : 1 - 0.5 * f.mix) * (pathHolds ? 1 : 1 - 0.6 * this.pathMix);
      s.vis = (s.vis ?? target2) + (target2 - (s.vis ?? target2)) * Math.min(1, dt * 5);
      s.sunMat.uniforms.uTime.value = tm;
      s.sun.scale.setScalar(0.3 + 0.7 * s.vis);
      // Seen from afar the glow carries the star; close up it draws in (it would fog the whole view) and the disc burns less hot.
      const dist = Math.max(1, camPos.distanceTo(s.center));
      const rpx = (s.sunR / dist) * this.perPx;
      const close = smooth(rpx, 8, 40), disc = smooth(rpx, 10, 60);
      s.glow.scale.setScalar(Math.min(s.sunR * (7 - 3 * close), 220 * dist / this.perPx));
      s.glow.material.opacity = 0.7 * s.vis * (1 - 0.9 * close);
      s.sunMat.uniforms.uDim.value = s.vis;
      s.sunMat.uniforms.uClose.value = disc;
      nearest = Math.max(nearest, disc * s.vis);
      for (const [k, ring] of s.rings.entries()) {
        const ringShown = !this.visible || this.planets.some(p => p.courseId === s.id && p.orbit.ring === k && this.visible.has(p.id));
        const lit = f.id && this.byId.get(f.id)?.courseId === s.id && this.byId.get(f.id)?.orbit.ring === k;
        ring.mat.opacity = (ringShown ? ring.base : 0) * s.vis * (1 - 0.6 * this.pathMix) + (lit ? 0.14 * f.mix : 0);
      }
    }
    // Next to a star its glow would wash over everything: keep it tight.
    this.bloom.strength = 0.34 * (1 - 0.7 * nearest);
    this.bloom.radius = 0.12 * (1 - 0.6 * nearest);

    // Lines between books fade while you look at a planet or a path.
    for (const br of this.bridges) {
      const a = Math.min(this.systems.find(s => s.id === br.a)?.vis ?? 1, this.systems.find(s => s.id === br.b)?.vis ?? 1);
      br.fade = a * (1 - 0.75 * f.mix) * (1 - 0.85 * this.pathMix);
      br.mat.opacity = 0.3 * br.strength * br.fade;
    }

    // Links: the ones of the planet you point at or opened, as arcs (unconfirmed ones fainter).
    let v = 0;
    const SEG = this.arcSeg, P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), Cc = new THREE.Vector3();
    const curveSeg = (A, B, color, alpha) => {
      Cc.copy(A).lerp(B, 0.5);
      Cc.y += A.distanceTo(B) * 0.22 + 8;
      for (let k = 0; k < SEG; k++) {
        const t0 = k / SEG, t1 = (k + 1) / SEG;
        P0.copy(A).multiplyScalar((1 - t0) * (1 - t0)).addScaledVector(Cc, 2 * (1 - t0) * t0).addScaledVector(B, t0 * t0);
        P1.copy(A).multiplyScalar((1 - t1) * (1 - t1)).addScaledVector(Cc, 2 * (1 - t1) * t1).addScaledVector(B, t1 * t1);
        const fade = Math.sin(Math.PI * (t0 + t1) / 2) * 0.5 + 0.5;
        this.arc.pos.set([P0.x, P0.y, P0.z, P1.x, P1.y, P1.z], v * 3);
        const cr = color.r * alpha * fade, cg = color.g * alpha * fade, cb = color.b * alpha * fade;
        this.arc.color.set([cr, cg, cb, cr, cg, cb], v * 3);
        v += 2;
      }
    };
    if (f.id && f.mix > 0) {
      for (const l of this.links) {
        if (l.a !== f.id && l.b !== f.id) continue;
        if (this.visible && !(this.visible.has(l.a) && this.visible.has(l.b))) continue;
        curveSeg(l.A.pos, l.B.pos, l.provisional ? FAINT_ARC : ARC, f.mix * (l.provisional ? 0.5 : 0.7));
      }
    }
    this.arcs.geometry.setDrawRange(0, v);
    this.arcs.geometry.attributes.position.needsUpdate = true;
    this.arcs.geometry.attributes.color.needsUpdate = true;

    this.composer.render(dt);
    this.drawLabels();
  }

  /** Names: books always; planets nearest and most important first, as they get big enough on screen. The learning path, and a ring round what you point at. */
  drawLabels() {
    const g = this.lctx, { w, h } = this.size, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const v = new THREE.Vector3();
    const f = this.focus, near = f.id ? this.adj.get(f.id) : null;
    const isNear = (id) => id === f.id || Boolean(near?.has(id));
    const path = this.path;
    const perPx = this.perPx || 1;
    this.screen.clear();
    const placed = [];
    const claim = (x0, y0, x1, y1, force = false) => {
      if (!force) for (const q of placed) if (x0 < q[2] && x1 > q[0] && y0 < q[3] && y1 > q[1]) return false;
      placed.push([x0, y0, x1, y1]);
      return true;
    };
    const shadow = (blur, color = "rgba(0, 0, 0, .85)") => { g.shadowBlur = blur; g.shadowColor = color; };

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
      const own = smooth(r, p.core ? 4.6 : 6.8, p.core ? 7 : 9.6);
      let a = own;
      if (f.id) a = isNear(p.id) ? Math.max(own, f.mix) : own * (1 - 0.85 * f.mix);
      if (path) a = path.set.has(p.id) ? Math.max(a, this.pathMix) : a * (1 - 0.9 * this.pathMix);
      const focus = p.id === f.id && f.mix > 0.05;
      if (a > 0.03 || focus) cands.push({ p, x, y, r, a: focus ? Math.max(a, f.mix) : a, focus, rank: (focus ? -2 : 0) + (path?.set.has(p.id) ? 0 : 1) + (f.id && isNear(p.id) ? 0 : 1) + (p.core ? 0 : 1), dist });
    }

    // What you point at (or opened): a thin ring round it, like a telescope's finder.
    const ringed = f.id && this.screen.get(f.id);
    if (ringed && f.mix > 0.02) {
      g.save();
      g.globalAlpha = f.mix * 0.9;
      g.strokeStyle = "rgba(255, 255, 255, .85)";
      g.lineWidth = 1;
      g.beginPath();
      g.arc(ringed.x, ringed.y, ringed.r + 5 + (1 - f.mix) * 6, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    // The learning path: a constellation, a fine line from each step to the next, and a circle round each step.
    if (path) this.lastPath = path;
    const pp = path || (this.pathMix > 0.01 ? this.lastPath : null);
    if (pp) {
      g.save();
      g.globalAlpha = this.pathMix;
      g.strokeStyle = "rgba(244, 226, 190, .9)";
      g.lineWidth = 1.25;
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
      g.strokeStyle = "rgba(244, 226, 190, .55)";
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
      c.text = step ? `${step}  ${c.p.fullName || c.p.name}` : c.p.fullName || c.p.name;
      c.font = c.focus ? `600 12.5px ${this.font}` : `500 11.5px ${this.font}`;
      g.font = c.font;
      const tw = g.measureText(c.text).width, y = c.y + c.r + (c.focus ? 20 : 16);
      c.box = [c.x - tw / 2 - 3, y - 11, c.x + tw / 2 + 3, y + 4];
      c.ty = y;
      if (!claim(...c.box, c.focus)) { c.text = null; continue; }
      must.push(c);
    }

    // Books' names, in the serif, just under their stars' glow.
    this.sunScreen = [];
    const fs = 14.5;
    for (const s of this.systems) {
      v.copy(s.center).project(this.camera);
      if (v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const dist = this.camera.position.distanceTo(s.center);
      const r = (s.sunR / dist) * perPx;
      this.sunScreen.push({ id: s.id, x, y, r, lines: s.lines });
      if ((s.vis ?? 1) < 0.05) continue;
      const y0 = y + Math.max(r * 1.6, 16) + fs + 6;
      g.font = `500 ${fs}px ${this.serif}`;
      const half = Math.max(...s.lines.map(l => g.measureText(l).width)) / 2;
      const box = [x - half, y0 - fs, x + half, y0 + (s.lines.length - 1) * fs * 1.25 + 4];
      const under = must.some(c => box[0] < c.box[2] && box[2] > c.box[0] && box[1] < c.box[3] && box[3] > c.box[1]);
      placed.push(box);
      g.globalAlpha = (s.vis ?? 1) * (under ? 0.2 : 0.96);
      shadow(8);
      g.fillStyle = "#F4F3EF";
      s.lines.forEach((line, i) => g.fillText(line, x, y0 + i * fs * 1.25));
    }

    // How many links each line between books stands for, at its middle.
    g.font = `400 10.5px ${this.mono}`;
    for (const br of this.bridges) {
      if ((br.fade ?? 1) < 0.05) continue;
      v.copy(br.mid).project(this.camera);
      if (v.z > 1) continue;
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const text = `${br.n} link${br.n === 1 ? "" : "s"}`;
      const tw = g.measureText(text).width;
      if (!claim(x - tw / 2 - 6, y - 16, x + tw / 2 + 6, y - 2)) continue;
      g.globalAlpha = 0.6 * br.fade;
      shadow(6);
      g.fillStyle = "#C9CDD6";
      g.fillText(text, x, y - 6);
    }

    // Planets' names: those placed above, then the rest where there's room.
    shadow(4);
    for (const c of must) {
      g.font = c.font;
      g.globalAlpha = Math.min(1, c.a);
      g.fillStyle = c.focus ? "#FFFFFF" : "#F4E8D0";
      g.fillText(c.text, c.x, c.ty);
    }
    g.font = `450 11px ${this.font}`;
    for (const c of cands) {
      if (c.box) continue;
      const tw = g.measureText(c.p.name).width;
      const y = c.y + c.r + 13;
      if (!claim(c.x - tw / 2 - 2, y - 10, c.x + tw / 2 + 2, y + 3)) continue;
      g.globalAlpha = Math.min(1, c.a) * 0.88;
      g.fillStyle = "#DADDE4";
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
      || (Math.abs(x - s.x) < 80 && y > s.y + s.r && y < s.y + Math.max(s.r * 1.6, 16) + 18 * s.lines.length + 10));
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
