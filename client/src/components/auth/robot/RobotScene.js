import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { gazeInput } from './gaze';

/* ------------------------------------------------------------------ *
 * Tuning
 * ------------------------------------------------------------------ */
const BODY_YAW = 0.72; // torso turned toward the auth panel
const YAW_BASE = -0.16; // neutral head offset, slightly toward the viewer
const YAW_RANGE = 0.38; // ~±22° total, shared between neck and head
const PITCH_RANGE = 0.13; // ~±7.5°
const ROLL_RANGE = 0.03; // ~±1.7°
const NECK_SHARE = 0.35;

const HEAD_R = 0.5;
const SX = 0.9;
const SY = 1.1;
const SZ = 1.08;
const HEAD_HEIGHT = HEAD_R * 2 * SY;
const FOV = 26;
const CAM_DIST = 7;

const spring = (x = 0) => ({ x, v: 0 });
function stepSpring(s, target, k, dt, zeta = 0.92) {
  const c = 2 * Math.sqrt(k) * zeta;
  s.v += (k * (target - s.x) - c * s.v) * dt;
  s.x += s.v * dt;
}

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */
// Point on the head ellipsoid. a = azimuth (0 = face forward, + = robot's left / +x).
function ell(theta, a, k = 1) {
  const r = HEAD_R * k;
  return new THREE.Vector3(
    r * SX * Math.sin(a) * Math.sin(theta),
    r * SY * Math.cos(theta),
    r * SZ * Math.cos(a) * Math.sin(theta)
  );
}
function ellNormal(p) {
  return new THREE.Vector3(p.x / (SX * SX), p.y / (SY * SY), p.z / (SZ * SZ)).normalize();
}
function headSegment(k, a0, a1, t0, t1, mat) {
  const geo = new THREE.SphereGeometry(HEAD_R * k, 96, 64, Math.PI / 2 + a0, a1 - a0, t0, t1 - t0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(SX, SY, SZ);
  return mesh;
}
function tube(points, radius, mat, closed = false, segments = 140) {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.Mesh(new THREE.TubeGeometry(curve, segments, radius, 8, closed), mat);
}
function range(n, f) {
  return Array.from({ length: n }, (_, i) => f(i / (n - 1)));
}
const lerp = (a, b, t) => a + (b - a) * t;

// Torso is a lathe with an elliptical cross-section.
const TORSO_PROFILE = [
  [0.9, -2.8],
  [1.0, -1.7],
  [1.08, -1.05],
  [1.1, -0.64],
  [1.0, -0.37],
  [0.78, -0.18],
  [0.46, -0.06],
  [0.24, 0.0],
];
const TORSO_Z = 0.58;
function torsoRadius(y) {
  for (let i = 0; i < TORSO_PROFILE.length - 1; i++) {
    const [r0, y0] = TORSO_PROFILE[i];
    const [r1, y1] = TORSO_PROFILE[i + 1];
    if (y >= y0 && y <= y1) return lerp(r0, r1, (y - y0) / (y1 - y0));
  }
  return TORSO_PROFILE[TORSO_PROFILE.length - 1][0];
}
function torsoPoint(y, phi, lift = 1.01) {
  const r = torsoRadius(y) * lift;
  return new THREE.Vector3(r * Math.sin(phi), y, TORSO_Z * r * Math.cos(phi));
}

function radialTexture(stops) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Same silhouette SVG brand mark (32×32 box, y down).
const F_POINTS = [
  [9, 4],
  [30, 4],
  [27.6, 10],
  [13.4, 10],
  [12.5, 12.6],
  [23, 12.6],
  [20.6, 18.6],
  [10.5, 18.6],
  [7.4, 28],
  [1, 28],
];
function fShape(size) {
  const shape = new THREE.Shape();
  F_POINTS.forEach(([x, y], i) => {
    const px = ((x - 16) / 32) * size;
    const py = (-(y - 16) / 32) * size;
    if (i === 0) shape.moveTo(px, py);
    else shape.lineTo(px, py);
  });
  shape.closePath();
  return shape;
}

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */
export class RobotScene {
  renderer = null;
  composer = null;
  bloom = null;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60);
  root = new THREE.Group();
  torso = new THREE.Group();
  neckJoint = new THREE.Group();
  headJoint = new THREE.Group();
  particles = new THREE.Points();
  glowMats = [];
  disposables = [];

  placement = null;
  raf = 0;
  last = 0;
  lastRender = 0;
  time = 0;
  running = false;
  reducedMotion = null;
  readyNotified = false;

  neckYaw = spring(YAW_BASE * NECK_SHARE);
  headYaw = spring(YAW_BASE * (1 - NECK_SHARE));
  neckPitch = spring();
  headPitch = spring();
  roll = spring();

  onReady = null;
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.reducedMotion = opts.reducedMotion;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.setClearColor(0x060708, 1);

    const target = new THREE.WebGLRenderTarget(2, 2, {
      type: THREE.HalfFloatType,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.38, 0.22, 1.0);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.buildEnvironment();
    this.buildRobot();
    this.buildAtmosphere();

    this.scene.add(this.root);
    this.root.rotation.y = BODY_YAW;
    this.applyPose();
    this.root.updateMatrixWorld(true);

    // Aim the camera straight at the neutral head centre.
    const head = this.headCenterWorld();
    this.camera.position.set(head.x, head.y, head.z + CAM_DIST);
    this.camera.lookAt(head.x, head.y, head.z);
  }

  /* ---------------------------- public API ---------------------------- */

  setPlacement(p) {
    this.placement = p;
    const area = p.width * p.height;
    const dpr = Math.min(window.devicePixelRatio || 1, area > 1.6e6 ? 1.25 : 1.5);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(p.width, p.height, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(p.width, p.height);
    this.bloom.resolution.set(p.width / 2, p.height / 2);

    const cam = this.camera;
    cam.aspect = p.width / p.height;
    cam.zoom =
      (p.size * 2 * CAM_DIST * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / (HEAD_HEIGHT * p.height);
    cam.setViewOffset(p.width, p.height, p.width / 2 - p.ax, p.height / 2 - p.ay, p.width, p.height);
    cam.updateProjectionMatrix();
    this.requestFrame();
  }

  setReducedMotion(value) {
    this.reducedMotion = value;
    this.requestFrame();
  }

  start() {
    if (this.running) return;
    this.running = true;
    // Rebase the frame clock. The tab may have been hidden for minutes, so
    // `performance.now() - this.last` would be a huge delta that would make
    // the springs jump and the breathing phase skip. Restarting from "now"
    // keeps the pose continuous.
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  dispose() {
    this.stop();
    this.scene.traverse((obj) => {
      const mesh = obj;
      mesh.geometry?.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.disposables.forEach((d) => d.dispose());
    this.composer.dispose();
    this.renderer.dispose();
  }

  /* ---------------------------- frame loop ---------------------------- */

  requestFrame() {
    if (!this.placement) return;
    if (this.reducedMotion) {
      // Static, neutral pose; no continuous loop.
      this.snapToTarget();
      this.render();
    } else if (!this.running) {
      this.render();
    }
  }

  loop = (now) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.reducedMotion) return;
    const dt = Math.min((now - this.last) / 1000, 1 / 30);
    this.last = now;
    this.time += dt;
    const settled = this.update(dt);
    // When the gaze has settled, idle at ~30fps to save GPU.
    if (settled && now - this.lastRender < 32) return;
    this.lastRender = now;
    this.render();
  };

  gazeTarget() {
    let nx = 0;
    let ny = 0;
    let amp = 1;
    let active = false;
    const p = this.placement;
    const point = gazeInput.override ?? (gazeInput.active ? gazeInput : null);
    if (point && p) {
      const rect = this.canvas.getBoundingClientRect();
      nx = (point.x - (rect.left + p.ax)) / (p.size * 1.5);
      ny = (point.y - (rect.top + p.ay)) / (p.size * 1.3);
      amp = gazeInput.override ? 0.8 : gazeInput.touch ? 0.55 : 1;
      active = true;
    }
    const tx = Math.tanh(nx * 1.15) * amp;
    const ty = Math.tanh(ny * 1.2) * amp;
    return {
      yaw: YAW_BASE + YAW_RANGE * tx,
      pitch: PITCH_RANGE * ty + 0.015,
      roll: -ROLL_RANGE * tx,
      active,
    };
  }

  /** Advances springs; returns true when motion has settled. */
  update(dt) {
    const t = this.gazeTarget();
    // Faster when following, gentle when drifting back to neutral.
    const kNeck = t.active ? 26 : 9;
    const kHead = t.active ? 70 : 14;
    stepSpring(this.neckYaw, t.yaw * NECK_SHARE, kNeck, dt);
    stepSpring(this.neckPitch, t.pitch * 0.3, kNeck, dt);
    stepSpring(this.headYaw, t.yaw - this.neckYaw.x, kHead, dt, 0.86);
    stepSpring(this.headPitch, t.pitch - this.neckPitch.x, kHead, dt, 0.86);
    stepSpring(this.roll, t.roll + this.headYaw.v * -0.01, kHead * 0.6, dt);
    this.applyPose();

    // Breathing: lighting and a tiny torso rise. Head motion stays pointer-driven.
    const breath = Math.sin(this.time * 0.85);
    this.torso.position.y = breath * 0.006;
    for (const g of this.glowMats) {
      g.mat.color.copy(g.base).multiplyScalar(1 + 0.07 * Math.sin(this.time * 1.1 + g.phase));
    }
    this.particles.rotation.y += dt * 0.012;

    const v = Math.abs(this.neckYaw.v) + Math.abs(this.headYaw.v) + Math.abs(this.headPitch.v);
    return v < 0.002;
  }

  snapToTarget() {
    // The static (reduced-motion) pose: the head rests at its neutral
    // offset, never at a pointer-driven target.
    this.neckYaw = spring(YAW_BASE * NECK_SHARE);
    this.headYaw = spring(YAW_BASE * (1 - NECK_SHARE));
    this.neckPitch = spring(0.015 * 0.3);
    this.headPitch = spring(0.015 * 0.7);
    this.roll = spring(0);
    this.applyPose();
  }

  applyPose() {
    this.neckJoint.rotation.set(this.neckPitch.x, this.neckYaw.x, 0, 'YXZ');
    this.headJoint.rotation.set(this.headPitch.x, this.headYaw.x, this.roll.x, 'YXZ');
  }

  render() {
    if (!this.placement) return;
    this.composer.render();
    if (!this.readyNotified) {
      this.readyNotified = true;
      this.onReady?.();
    }
  }

  headCenterWorld() {
    const v = new THREE.Vector3(0, 0.4, 0.03);
    return this.headJoint.localToWorld(v);
  }

  /* ---------------------------- construction ---------------------------- */

  buildEnvironment() {
    // A hand-built "studio" so reflections stay warm and controlled.
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x020203);
    const panel = (w, h, color, k, pos) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(...color).multiplyScalar(k),
          side: THREE.DoubleSide,
        })
      );
      m.position.set(...pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    panel(5, 3.5, [1, 0.36, 0.12], 0.75, [-6, 1.5, -3.5]); // warm key, back-left
    panel(0.8, 7, [1, 0.48, 0.18], 1.4, [5.5, 1.2, -2.5]); // amber rim strip, back-right
    panel(9, 0.35, [1, 0.88, 0.78], 0.55, [0, 6, 0.5]); // soft top strip
    panel(4.5, 0.22, [1, 0.84, 0.7], 0.95, [-2.4, 3.4, 5]); // thin specular strip, front-top
    panel(7, 2.2, [0.12, 0.09, 0.08], 1, [3, -1.5, 6]); // faint front fill
    panel(6, 3, [0.5, 0.1, 0.04], 0.45, [-5, -3, 1]); // deep red bounce
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envMap = pmrem.fromScene(env, 0.035).texture;
    this.scene.environment = envMap;
    this.disposables.push(envMap, pmrem);
    env.traverse((o) => {
      const m = o;
      m.geometry?.dispose();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });

    this.scene.add(new THREE.AmbientLight(0x1c120c, 0.15));
    const rimL = new THREE.DirectionalLight(0xff6a2a, 2.4);
    rimL.position.set(-4, 2.5, -3);
    const rimR = new THREE.DirectionalLight(0xff9b45, 1.6);
    rimR.position.set(4.5, 1.2, -2.5);
    const fill = new THREE.DirectionalLight(0xffd8bc, 0.18);
    fill.position.set(1.5, 1.5, 5);
    const glow = new THREE.PointLight(0xff6a2a, 2.2, 4.5, 1.6);
    glow.position.set(-0.4, 0.7, -1.1);
    this.scene.add(rimL, rimR, fill, glow);
  }

  glow(k, tint = [1, 0.42, 0.14]) {
    const base = new THREE.Color(...tint).multiplyScalar(k);
    const mat = new THREE.MeshBasicMaterial({ color: base.clone() });
    this.glowMats.push({ mat, base, phase: this.glowMats.length * 0.7 });
    return mat;
  }

  buildRobot() {
    const shell = new THREE.MeshPhysicalMaterial({
      color: 0x060607,
      metalness: 0.5,
      roughness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
      envMapIntensity: 1.0,
      side: THREE.DoubleSide,
    });
    const graphite = new THREE.MeshPhysicalMaterial({
      color: 0x141518,
      metalness: 0.8,
      roughness: 0.38,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25,
      envMapIntensity: 0.9,
    });
    const inner = new THREE.MeshStandardMaterial({
      color: 0x101012,
      metalness: 0.8,
      roughness: 0.55,
      side: THREE.DoubleSide,
    });
    const visor = new THREE.MeshPhysicalMaterial({
      color: 0x030304,
      metalness: 0.35,
      roughness: 0.03,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.9,
      transparent: true,
      opacity: 0.8,
    });
    const strong = this.glow(2.6);
    const medium = this.glow(1.6);
    const dim = this.glow(0.7, [1, 0.35, 0.12]);
    const emblem = this.glow(3.0, [1, 0.5, 0.16]);

    /* ----- Head ----- */
    const head = new THREE.Group();
    head.position.set(0, 0.4, 0.03);

    const V = { a0: -1.05, a1: 1.05, t0: 0.86, t1: 2.08 }; // visor opening
    head.add(
      headSegment(1, 0, Math.PI * 2, 0, V.t0, shell), // crown
      headSegment(1, 0, Math.PI * 2, V.t1, Math.PI, shell), // jaw
      headSegment(1, V.a1, Math.PI * 2 + V.a0, V.t0, V.t1, shell), // sides/back
      headSegment(1.012, Math.PI - 1.25, Math.PI + 1.25, 0.32, 2.35, graphite), // raised back plate
      headSegment(1.008, V.a0 - 0.05, V.a1 + 0.05, V.t1 + 0.02, 2.42, graphite), // chin plate
      headSegment(0.9, V.a0 - 0.2, V.a1 + 0.2, V.t0 - 0.18, V.t1 + 0.18, inner), // internal face
      headSegment(1.016, V.a0, V.a1, V.t0, V.t1, visor) // glass visor
    );

    // Visor frame + glowing outline
    const outline = [
      ...range(14, (t) => ell(V.t0, lerp(V.a0, V.a1, t), 1.018)),
      ...range(10, (t) => ell(lerp(V.t0, V.t1, t), V.a1, 1.018)).slice(1),
      ...range(14, (t) => ell(V.t1, lerp(V.a1, V.a0, t), 1.018)).slice(1),
      ...range(10, (t) => ell(lerp(V.t1, V.t0, t), V.a0, 1.018)).slice(1, -1),
    ];
    head.add(tube(outline, 0.022, graphite, true, 220));
    head.add(
      tube(
        range(24, (t) => ell(V.t0 - 0.035, lerp(V.a0 + 0.05, V.a1 - 0.05, t), 1.03)),
        0.0075,
        strong
      )
    );
    head.add(
      tube(
        range(16, (t) => ell(lerp(V.t0 + 0.05, V.t1 - 0.05, t), V.a0 - 0.04, 1.03)),
        0.006,
        strong
      )
    );
    head.add(
      tube(
        range(16, (t) => ell(lerp(V.t0 + 0.05, V.t1 - 0.05, t), V.a1 + 0.04, 1.03)),
        0.006,
        medium
      )
    );
    head.add(
      tube(
        range(20, (t) => ell(V.t1 + 0.04, lerp(V.a0 + 0.1, V.a1 - 0.1, t), 1.025)),
        0.005,
        dim
      )
    );

    // Centre ridge down the visor: a strong cue for where the head is facing.
    head.add(
      tube(
        range(14, (t) => ell(lerp(V.t0 - 0.3, V.t1 + 0.25, t), 0, 1.02)),
        0.012,
        graphite
      )
    );

    // Machinery behind the glass
    for (const th of [1.32, 1.72]) {
      head.add(
        tube(
          range(14, (t) => ell(th, lerp(-0.7, 0.7, t), 0.915)),
          0.004,
          dim
        )
      );
    }
    for (const a of [-0.6, -0.2, 0.2, 0.6]) {
      head.add(
        tube(
          range(10, (t) => ell(lerp(0.95, 2.0, t), a, 0.912)),
          0.012,
          graphite
        )
      );
    }

    // Crown strips (over the top, front to back)
    for (const x0 of [-0.075, 0.075]) {
      const k = Math.sqrt(1 - (x0 / (HEAD_R * SX)) ** 2);
      const pts = range(30, (t) => {
        const u = lerp(0.72, -2.25, t);
        return new THREE.Vector3(
          x0,
          HEAD_R * 1.022 * SY * k * Math.cos(u),
          HEAD_R * 1.022 * SZ * k * Math.sin(u)
        );
      });
      head.add(tube(pts, 0.0065, x0 < 0 ? strong : medium));
    }

    // Temple strips on both sides
    for (const s of [-1, 1]) {
      const pts = [
        ell(0.62, s * 1.2, 1.02),
        ell(1.0, s * 1.38, 1.02),
        ell(1.55, s * 1.5, 1.02),
        ell(2.05, s * 1.35, 1.02),
        ell(2.4, s * 1.05, 1.02),
      ];
      head.add(tube(pts, 0.006, s < 0 ? strong : medium));
      head.add(
        tube(
          range(18, (t) => ell(lerp(0.55, 2.3, t), s * 2.25, 1.026)),
          0.0045,
          dim
        )
      );
    }

    // Ear modules
    for (const s of [-1, 1]) {
      const ear = new THREE.Group();
      ear.position.set(s * HEAD_R * SX * 0.985, -0.02, -0.04);
      ear.rotation.z = Math.PI / 2;
      const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.165, 0.07, 64), shell);
      const face = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.075, 48), graphite);
      // Cylinder is rotated about z, so local -s·y points away from the head.
      face.position.y = -s * 0.006;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.118, 0.007, 12, 96), s < 0 ? strong : medium);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -s * 0.04;
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.014, 12, 96), graphite);
      lip.rotation.x = Math.PI / 2;
      lip.position.y = -s * 0.03;
      ear.add(housing, face, ring, lip);
      head.add(ear);
    }

    // Frieday F emblem on the camera-facing side of the visor
    const fPos = ell(1.36, -0.5, 1.03);
    const n = ellNormal(fPos);
    const xAxis = new THREE.Vector3(0, 1, 0).cross(n).normalize();
    const yAxis = n.clone().cross(xAxis);
    const fMesh = new THREE.Mesh(new THREE.ShapeGeometry(fShape(0.24)), emblem);
    fMesh.position.copy(fPos);
    fMesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, n));
    head.add(fMesh);

    this.headJoint.add(head);

    /* ----- Neck ----- */
    this.headJoint.position.y = 0.44;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.5, 40), graphite);
    core.position.y = 0.22;
    this.neckJoint.add(core);
    for (const [y, r] of [
      [0.05, 0.17],
      [0.17, 0.155],
      [0.29, 0.148],
    ]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.028, 16, 64), shell);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      this.neckJoint.add(ring);
    }
    const neckGlow = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.005, 8, 64), medium);
    neckGlow.rotation.x = Math.PI / 2;
    neckGlow.position.y = 0.11;
    this.neckJoint.add(neckGlow);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.46, 10), shell);
      rod.position.set(Math.sin(a) * 0.175, 0.22, Math.cos(a) * 0.175);
      rod.rotation.set(Math.cos(a) * -0.12, 0, Math.sin(a) * 0.12);
      this.neckJoint.add(rod);
    }
    this.neckJoint.add(
      tube(
        [
          new THREE.Vector3(-0.07, 0.0, 0.19),
          new THREE.Vector3(-0.065, 0.2, 0.175),
          new THREE.Vector3(-0.06, 0.42, 0.15),
        ],
        0.005,
        strong
      )
    );
    this.neckJoint.add(this.headJoint);

    /* ----- Torso ----- */
    const profile = TORSO_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
    const bodyShell = new THREE.Group();
    bodyShell.scale.setScalar(0.84);
    bodyShell.position.y = -0.06;
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), shell);
    body.scale.z = TORSO_Z;
    bodyShell.add(body);
    const platePts = TORSO_PROFILE.filter(([, y]) => y <= -0.18 && y >= -1.8).map(
      ([r, y]) => new THREE.Vector2(r * 1.014, y)
    );
    for (const [start, len] of [
      [-0.95, 1.9],
      [Math.PI - 1.0, 2.0],
    ]) {
      const plate = new THREE.Mesh(new THREE.LatheGeometry(platePts, 64, start, len), graphite);
      plate.scale.z = TORSO_Z;
      bodyShell.add(plate);
    }

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.055, 20, 80), graphite);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = -0.01;
    const collarGlow = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.006, 8, 96), medium);
    collarGlow.rotation.x = Math.PI / 2;
    collarGlow.scale.y = 0.72;
    collarGlow.position.y = -0.06;
    bodyShell.add(collar, collarGlow);

    for (const s of [-1, 1]) {
      const mat = s < 0 ? strong : medium;
      bodyShell.add(
        tube(
          [
            [-0.08, 0.35],
            [-0.17, 0.72],
            [-0.29, 1.02],
            [-0.4, 1.28],
          ].map(([y, p]) => torsoPoint(y, s * p, 1.016)),
          0.007,
          mat
        )
      );
      bodyShell.add(
        tube(
          [
            [-0.3, 0.4],
            [-0.8, 0.47],
            [-1.4, 0.5],
            [-2.4, 0.47],
          ].map(([y, p]) => torsoPoint(y, s * p, 1.02)),
          0.0065,
          mat
        )
      );
      bodyShell.add(
        tube(
          [
            [-0.45, 0.85],
            [-1.0, 0.92],
            [-1.7, 0.9],
          ].map(([y, p]) => torsoPoint(y, s * p, 1.02)),
          0.005,
          dim
        )
      );

      // Shoulder armour with a ring light
      const shoulder = new THREE.Group();
      shoulder.position.set(s * 0.98, -0.42, 0);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.4, 64, 48), shell);
      dome.scale.set(1.05, 0.88, 0.92);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.415, 64, 32, 0, Math.PI * 2, 0, 1.05), graphite);
      cap.scale.set(1.05, 0.88, 0.92);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.05, 64), graphite);
      disc.rotation.z = Math.PI / 2;
      disc.position.x = s * 0.41;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.009, 12, 96), mat);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = s * 0.44;
      const outer = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.018, 12, 96), shell);
      outer.rotation.y = Math.PI / 2;
      outer.position.x = s * 0.425;
      shoulder.add(dome, cap, disc, ring, outer);
      shoulder.add(
        tube(
          range(16, (t) => {
            const u = lerp(-1.2, 1.25, t);
            return new THREE.Vector3(s * 0.1, 0.36 * Math.cos(u) * 0.95, 0.38 * Math.sin(u) * 0.95)
              .multiply(new THREE.Vector3(1.05, 0.98, 1))
              .add(new THREE.Vector3(0, 0.02, 0));
          }),
          0.006,
          dim
        )
      );
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.24, 1.8, 40), graphite);
      arm.position.set(s * 1.14, -1.45, 0);
      bodyShell.add(shoulder, arm);
    }

    this.torso.add(bodyShell);
    this.torso.add(this.neckJoint);
    this.root.add(this.torso);
  }

  buildAtmosphere() {
    const glowTex = radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.25, 'rgba(255,255,255,0.45)'],
      [0.6, 'rgba(255,255,255,0.1)'],
      [1, 'rgba(255,255,255,0)'],
    ]);
    this.disposables.push(glowTex);
    const plane = (size, color, opacity, pos) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({
          map: glowTex,
          color: new THREE.Color(...color),
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      m.position.set(...pos);
      m.renderOrder = -1;
      this.scene.add(m);
    };
    plane(7, [1, 0.34, 0.1], 0.14, [-0.3, 0.8, -3.2]); // halo behind head
    plane(14, [0.55, 0.1, 0.04], 0.28, [-4.6, -1.4, -5]); // deep red, outer left
    plane(7, [1, 0.4, 0.12], 0.06, [1.2, -1.8, -2.4]); // under-shoulder warmth

    const count = 170;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.1 + Math.random() * 2.4;
      const a = Math.random() * Math.PI * 2;
      const y = (Math.random() - 0.35) * 3.2;
      positions.set([Math.cos(a) * r, y + 0.6, Math.sin(a) * r * 0.6 - 0.6], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particles = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        map: glowTex,
        color: new THREE.Color(1, 0.55, 0.2).multiplyScalar(1.2),
        size: 0.035,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.scene.add(this.particles);
  }
}
