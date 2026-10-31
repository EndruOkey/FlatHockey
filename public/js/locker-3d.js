// Locker 3D player viewer — turntable preview of the player in the current kit.
// Lazy-loaded: this module (and three.js) is only fetched when the 3D toggle is first used,
// so the initial page weight is unchanged. three.js core comes from cdnjs (pinned 0.160.0 via the
// import map in index.html); GLTFLoader + OrbitControls addons from jsdelivr at the same version.
//
// Loads a real CC0 human base (Quaternius "Animated Human", public/models/human-base.glb — see
// CREDITS.md), recolors its single body material to the JERSEY colour (body = jersey/suit) and plays
// its "Idle" clip so the figure gently breathes on the turntable. Hockey gear (helmet, gloves, stick,
// number) is OUR geometry, built in world space and attach()-ed to the glb's bones so it follows the
// animation. recolor(kit) maps the locker kit onto the body + all gear live.
// If the glb is missing/parse-fails, a low-poly placeholder is built from primitives; if three itself
// fails, main.js stays on 2D. Default toggle stays 2D (production safe).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MODEL_URL = '/models/human-base.glb';

// Material names the Blender artist MUST use so a real .glb "just works" (documented in MODEL_3D.md).
const MAT = {
  JERSEY: 'MAT_JERSEY', HELMET: 'MAT_HELMET', GLOVES: 'MAT_GLOVES', STICK: 'MAT_STICK',
  TAPE: 'MAT_TAPE', VISOR: 'MAT_VISOR', SHORTS: 'MAT_SHORTS', SKATES: 'MAT_SKATES', NUMBER: 'MAT_NUMBER',
};

// pick a readable number color (dark text on light jersey, white on dark)
function _lum(hex) {
  const h = String(hex || '#888').replace('#', '');
  const r = parseInt(h.substr(0, 2), 16) / 255, g = parseInt(h.substr(2, 2), 16) / 255, b = parseInt(h.substr(4, 2), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function initLocker3D({ canvas, getKit }) {
  const prefersReduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 1.15, 4.4);

  // Soft studio lighting (matches the locker's blue/pink atmosphere)
  scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x20242e, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(3, 6, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xb6c4ff, 0.55); fill.position.set(-4, 2, 2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffade2, 0.55); rim.position.set(0, 3, -5); scene.add(rim);
  scene.add(new THREE.AmbientLight(0xffffff, 0.25));

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 2.6;
  controls.maxDistance = 7;
  controls.minPolarAngle = Math.PI * 0.12;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.target.set(0, 0.95, 0);
  controls.autoRotate = !prefersReduced;   // respect prefers-reduced-motion: no auto-turntable
  controls.autoRotateSpeed = 1.5;

  // name -> [materials] registry so recolor can address them uniformly (placeholder or glb)
  const mats = {};
  const register = (name, mat) => { if (!name) return; (mats[name] || (mats[name] = [])).push(mat); };

  // ── jersey number as a canvas texture (chest plane / MAT_NUMBER) ──
  const numCanvas = document.createElement('canvas');
  numCanvas.width = numCanvas.height = 256;
  const numTex = new THREE.CanvasTexture(numCanvas);
  numTex.colorSpace = THREE.SRGBColorSpace;
  function drawNumber(num, jersey) {
    const ctx = numCanvas.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    const n = parseInt(num, 10);
    if (!Number.isFinite(n)) { numTex.needsUpdate = true; return; }
    const txt = String(Math.max(0, Math.min(99, n)));
    ctx.fillStyle = _lum(jersey) > 0.55 ? '#1a1f29' : '#f4f7fb';
    ctx.font = '900 150px Barlow Condensed, Arial Narrow, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(txt, 128, 138);
    numTex.needsUpdate = true;
  }

  let root = null;

  function setCol(name, hex) {
    if (hex == null) return;
    (mats[name] || []).forEach(m => { if (m.color) m.color.set(hex); });
  }
  function recolor(kit) {
    if (!kit) return;
    setCol(MAT.JERSEY, kit.jersey);
    setCol(MAT.HELMET, kit.helmet);
    setCol(MAT.GLOVES, kit.gloves);
    setCol(MAT.STICK, kit.stick);
    setCol(MAT.TAPE, kit.tape);
    setCol(MAT.VISOR, kit.visor);
    setCol(MAT.SHORTS, kit.shorts);
    // MAT_SKATES: kit has no skate color → stays the default dark the model ships with.
    drawNumber(kit.num, kit.jersey);
  }

  // ── Stylized low-poly hockey player, built from three.js geometry ──
  // This is the real, final model (no Blender pipeline). Clean rounded shapes, slightly chibi
  // (biggish head, chunky gloves) to match the game's 2D art. Proportions/colours mirror
  // public/player-hero.svg (jersey #df2626, helmet #f4f7fb, gloves/stick #1a1f29, skin #eab3a5).
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  function std(color, opts) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.58, metalness: 0.06, flatShading: false }, opts || {})); }
  // oriented tapered capsule-ish limb between two points (cylinder + rounded end caps)
  function limb(group, a, b, r1, r2, mat) {
    const dir = new THREE.Vector3().subVectors(b, a); const len = dir.length();
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, len, 18), mat);
    cyl.position.copy(a).addScaledVector(dir, 0.5);
    cyl.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
    group.add(cyl);
    const ca = new THREE.Mesh(new THREE.SphereGeometry(r1, 16, 12), mat); ca.position.copy(a); group.add(ca);
    const cb = new THREE.Mesh(new THREE.SphereGeometry(r2, 16, 12), mat); cb.position.copy(b); group.add(cb);
    return cyl;
  }
  function buildPlaceholder() {
    const g = new THREE.Group();
    // shared materials — one per kit slot so recolor() hits every mesh using it
    const jersey = std('#df2626'); register(MAT.JERSEY, jersey);
    const shorts = std('#df2626'); register(MAT.SHORTS, shorts);
    const gloves = std('#1a1f29', { roughness: 0.5 }); register(MAT.GLOVES, gloves);
    const helmet = std('#f4f7fb', { roughness: 0.35, metalness: 0.12 }); register(MAT.HELMET, helmet);
    const skates = std('#14171f', { roughness: 0.4 }); register(MAT.SKATES, skates);
    const stickMat = std('#1a1f29', { roughness: 0.45 }); register(MAT.STICK, stickMat);
    const tapeMat = std('#f4f7fb', { roughness: 0.7 }); register(MAT.TAPE, tapeMat);
    const visorMat = new THREE.MeshPhysicalMaterial({ color: '#bfe0ff', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.45, transmission: 0.2, side: THREE.DoubleSide }); register(MAT.VISOR, visorMat);
    // fixed (not kit-driven) materials
    const skin = std('#eab3a5', { roughness: 0.75 });
    const steel = std('#c9ced8', { roughness: 0.3, metalness: 0.65 });
    const dark = std('#0e1016', { roughness: 0.6 });

    // ── legs: socks (jersey) + skate boot (dark) + steel blade, slight stance ──
    for (const sx of [-1, 1]) {
      const hipX = sx * 0.145;
      limb(g, V(hipX, 0.84, 0), V(sx * 0.17, 0.17, 0.02), 0.115, 0.1, jersey);   // sock, knee->ankle
      // skate boot
      const boot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 18, 14), skates);
      boot.position.set(sx * 0.17, 0.11, 0.06); boot.scale.set(1.0, 0.85, 1.5); g.add(boot);
      // blade (steel runner)
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.42), steel);
      blade.position.set(sx * 0.17, 0.025, 0.06); g.add(blade);
    }

    // ── hips / shorts (rounded pill) ──
    const hip = new THREE.Mesh(new THREE.CapsuleGeometry(0.235, 0.12, 8, 20), shorts);
    hip.position.set(0, 0.86, 0); hip.scale.set(1.1, 1, 0.82); hip.rotation.z = Math.PI / 2; g.add(hip);

    // ── torso (jersey) + shoulder bulk ──
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.245, 0.26, 10, 22), jersey);
    torso.position.set(0, 1.2, 0); torso.scale.set(1.12, 1, 0.8); g.add(torso);
    limb(g, V(-0.3, 1.46, 0.02), V(0.3, 1.46, 0.02), 0.15, 0.15, jersey);  // shoulder pads

    // ── head: skin + helmet shell + eyes + curved visor (biggish, chibi) ──
    const headY = 1.82, headR = 0.25;
    limb(g, V(0, 1.5, 0), V(0, 1.64, 0), 0.1, 0.11, skin);                 // neck
    const head = new THREE.Mesh(new THREE.SphereGeometry(headR, 30, 24), skin);
    head.position.set(0, headY, 0); head.scale.set(1, 1.04, 1.02); g.add(head);
    // helmet shell — top/back cap, face left open
    const shell = new THREE.Mesh(new THREE.SphereGeometry(headR + 0.022, 30, 22, 0, Math.PI * 2, 0, Math.PI * 0.62), helmet);
    shell.position.set(0, headY, 0); shell.scale.set(1.03, 1.08, 1.05); g.add(shell);
    // little ear covers
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 12), helmet);
      ear.position.set(sx * (headR + 0.01), headY - 0.02, 0); ear.scale.set(0.7, 1, 1.1); g.add(ear);
    }
    // eyes
    for (const sx of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), dark);
      eye.position.set(sx * 0.082, headY + 0.015, headR * 0.93); g.add(eye);
    }
    // curved visor band across the eyes
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(headR + 0.03, headR + 0.03, 0.14, 24, 1, true, -0.85, 1.7), visorMat);
    visor.position.set(0, headY + 0.03, 0); g.add(visor);

    // ── stick resting on the ice, held with both chunky gloves ──
    const heel = V(0.34, 0.02, 0.6), top = V(0.07, 1.16, 0.26);
    limb(g, heel, top, 0.028, 0.03, stickMat);                            // shaft
    const bladeGeo = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.075, 0.03), stickMat);
    bladeGeo.position.set(0.5, 0.055, 0.6); bladeGeo.rotation.y = Math.PI / 2; bladeGeo.rotation.z = 0.12; g.add(bladeGeo);
    // tape wrap near the heel
    const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.12, 14), tapeMat);
    tape.position.copy(heel).addScaledVector(new THREE.Vector3().subVectors(top, heel).normalize(), 0.11);
    tape.quaternion.setFromUnitVectors(V(0, 1, 0), new THREE.Vector3().subVectors(top, heel).normalize()); g.add(tape);
    const tapeKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.05, 14), tapeMat);
    tapeKnob.position.copy(top); g.add(tapeKnob);

    // hands on the stick + arms from shoulders (natural cross grip)
    const topHand = V(0.1, 1.12, 0.28), lowHand = V(0.22, 0.66, 0.44);
    limb(g, V(-0.28, 1.42, 0.03), topHand, 0.095, 0.08, jersey);          // far arm to top hand
    limb(g, V(0.3, 1.42, 0.03), lowHand, 0.095, 0.08, jersey);            // near arm to low hand
    for (const h of [topHand, lowHand]) {
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 14), gloves);
      glove.position.copy(h); glove.scale.set(1.15, 1.25, 1.35); g.add(glove);
    }

    // ── jersey number on chest and back (canvas texture) ──
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true, side: THREE.DoubleSide });
    register(MAT.NUMBER, numMat);
    const chest = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), numMat);
    chest.position.set(0, 1.22, 0.205); g.add(chest);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), numMat);
    back.position.set(0, 1.26, -0.205); back.rotation.y = Math.PI; back.scale.x = -1; g.add(back);  // un-mirror

    // ── soft contact shadow blob under the skates ──
    g.add(makeContactShadow());

    return g;
  }

  // radial-gradient soft shadow on a flat plane at ice level
  function makeContactShadow() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const cx = c.getContext('2d');
    const grd = cx.createRadialGradient(64, 64, 2, 64, 64, 62);
    grd.addColorStop(0, 'rgba(0,0,0,0.5)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = grd; cx.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(0.08, 0.004, 0.18);
    return m;
  }

  // ── gear materials (OUR geometry added onto the human base) ──
  // one material per kit slot so recolor() reaches every mesh built from it.
  let mixer = null;
  function buildGearMats() {
    return {
      helmet: std('#f4f7fb', { roughness: 0.32, metalness: 0.14 }),
      gloves: std('#1a1f29', { roughness: 0.5 }),
      stick:  std('#1a1f29', { roughness: 0.45 }),
      tape:   std('#f4f7fb', { roughness: 0.7 }),
      shorts: std('#1a1f29', { roughness: 0.6 }),
      visor:  new THREE.MeshPhysicalMaterial({ color: '#bfe0ff', roughness: 0.08, metalness: 0, transparent: true, opacity: 0.5, transmission: 0.25, side: THREE.DoubleSide }),
      dark:   std('#0e1016', { roughness: 0.6 }),
      steel:  std('#c9ced8', { roughness: 0.3, metalness: 0.65 }),
    };
  }

  // Build gear in WORLD space at the posed rest frame, then bone.attach() it so it follows idle.
  function addGear(obj) {
    scene.updateMatrixWorld(true);
    const bone = n => obj.getObjectByName(n);
    const Head = bone('Head'), LHand = bone('LeftHand'), RHand = bone('RightHand'),
          Spine2 = bone('Spine2'), LLeg = bone('LeftLeg'), RLeg = bone('RightLeg'),
          LFoot = bone('LeftFoot'), RFoot = bone('RightFoot');
    const gm = buildGearMats();
    register(MAT.HELMET, gm.helmet); register(MAT.VISOR, gm.visor);
    register(MAT.GLOVES, gm.gloves); register(MAT.STICK, gm.stick);
    register(MAT.TAPE, gm.tape); register(MAT.SHORTS, gm.shorts);

    const wp = new THREE.Vector3(), wq = new THREE.Quaternion();
    // reparent a world-space object onto a bone, preserving its look
    const attach = (b, o) => { scene.add(o); o.updateMatrixWorld(true); b.attach(o); };

    // ── HELMET: a real hockey dome covering the crown, ears and back of the head, with a visor
    //    across the eyes. No side "ear cup" blobs — they read as headphones. (front = +Z) ──
    if (Head) {
      Head.getWorldPosition(wp);
      const g = new THREE.Group();
      const hc = wp.clone(); hc.y += 0.10;                  // dome centre ≈ head centre (head is biggish/chibi)
      // Dome sits OUTSIDE the (large) head sphere. Full-azimuth cap for crown/forehead, then a
      // back-and-sides shell with a FRONT GAP (centred on +Z) so the face shows through.
      const R = 0.205;
      // top cap: covers crown + forehead all the way round, down to just above the brow
      const cap = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.42), gm.helmet);
      cap.scale.set(1.0, 1.05, 1.03); g.add(cap);
      // back + sides shell: reaches down past the ears; leaves a ~85° gap at the front for the face
      const shell = new THREE.Mesh(new THREE.SphereGeometry(R, 32, 28, Math.PI * 0.72, Math.PI * 1.56, 0, Math.PI * 0.74), gm.helmet);
      shell.scale.set(1.0, 1.05, 1.03); g.add(shell);
      // dark brim across the brow (front), curved
      const brim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 10, 30, Math.PI * 0.9), gm.stick);
      brim.rotation.x = Math.PI / 2; brim.rotation.y = Math.PI; brim.position.set(0, 0.055, 0.03); g.add(brim);
      // clear-ish visor band across the eyes (light blue glass)
      const visor = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.98, R * 0.98, 0.075, 28, 1, true, Math.PI * 0.28, Math.PI * 0.44), gm.visor);
      visor.position.set(0, -0.005, 0); g.add(visor);
      g.position.copy(hc);
      attach(Head, g);
    }

    // ── GLOVES: a boxy hockey glove (rounded) + short cuff on each hand bone ──
    for (const H of [LHand, RHand]) {
      if (!H) continue;
      H.getWorldPosition(wp);
      const grp = new THREE.Group();
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, 0.08), gm.gloves);
      // round the box a bit by overlaying a slightly smaller sphere (cheap bevel look)
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.052, 16, 12), gm.gloves);
      pad.scale.set(1.1, 1.0, 1.05); pad.position.y = -0.01; grp.add(hand, pad);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.06, 16), gm.gloves);
      cuff.position.y = 0.075; grp.add(cuff);                // cuff toward the forearm
      grp.position.copy(wp);
      attach(H, grp);
    }

    // ── STICK: shaft from the right hand down to a blade lying FLAT on the ice, out in front ──
    if (RHand) {
      RHand.getWorldPosition(wp);
      const g = new THREE.Group();
      const top = wp.clone();                               // at the hand (top of shaft)
      const side = Math.sign(wp.x) || 1;                    // keep the blade on the hand's side, not across the legs
      const heelXZ = new THREE.Vector3(wp.x + side * 0.05, 0.035, wp.z + 0.46);  // where shaft meets blade, on the ice & forward
      limb(g, heelXZ, top, 0.02, 0.023, gm.stick);          // shaft (slightly thicker)
      const dir = new THREE.Vector3().subVectors(top, heelXZ).normalize();
      // blade: long, thin box lying flat (length along +Z = forward), heel at the shaft, toe ahead
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.065, 0.34), gm.stick);
      blade.position.set(heelXZ.x, 0.033, heelXZ.z + 0.15); blade.rotation.z = 0.06; g.add(blade);
      // tape wrap on the lower shaft + knob on top
      const tape = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 14), gm.tape);
      tape.position.copy(heelXZ).addScaledVector(dir, 0.14);
      tape.quaternion.setFromUnitVectors(V(0, 1, 0), dir); g.add(tape);
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.045, 14), gm.tape);
      knob.position.copy(top); g.add(knob);
      attach(RHand, g);
    }

    // ── SOCK sleeves on the lower legs (kit.shorts colour, to break up the one-tone body) ──
    for (const L of [LLeg, RLeg]) {
      if (!L) continue;
      L.getWorldPosition(wp);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.3, 16), gm.shorts);
      sock.position.copy(wp); sock.position.y -= 0.16;
      attach(L, sock);
    }

    // ── SKATES: dark boot + steel blade under each foot ──
    register(MAT.SKATES, gm.dark);
    for (const F of [LFoot, RFoot]) {
      if (!F) continue;
      F.getWorldPosition(wp);
      const grp = new THREE.Group();
      const boot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 14), gm.dark);
      boot.scale.set(0.95, 0.8, 1.5); boot.position.set(0, 0.0, 0.03); grp.add(boot);  // boot hugs the foot, longer toward the toe (+Z)
      const ankle = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.06, 0.08, 14), gm.dark);
      ankle.position.set(0, 0.05, -0.01); grp.add(ankle);                               // ankle cuff
      const holder = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.19), gm.dark);
      holder.position.set(0, -0.075, 0.03); grp.add(holder);                            // blade holder
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.22), gm.steel);
      blade.position.set(0, -0.11, 0.03); grp.add(blade);                               // steel blade on the ice
      grp.position.copy(wp);
      attach(F, grp);
    }

    // ── NUMBER on chest + back (canvas texture), on the Spine2/chest area ──
    const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true, side: THREE.DoubleSide });
    register(MAT.NUMBER, numMat);
    if (Spine2) {
      Spine2.getWorldPosition(wp);
      const chest = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), numMat);
      chest.position.set(wp.x, wp.y + 0.04, wp.z + 0.16);   // front, +Z (camera side)
      attach(Spine2, chest);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), numMat);
      back.position.set(wp.x, wp.y + 0.06, wp.z - 0.16); back.rotation.y = Math.PI; back.scale.x = -1;
      attach(Spine2, back);
    }
  }

  function adoptGlb(gltf) {
    const obj = gltf.scene;
    // body = the single "Texture" material; drop vertex colours so the jersey recolour is uniform.
    obj.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach(m => { m.vertexColors = false; m.roughness = 0.62; m.metalness = 0.04; register(MAT.JERSEY, m); });
    });

    // this Quaternius base already faces +Z (toward the camera), so no Y rotation is needed.
    obj.rotation.y = 0;

    // idle animation (subtle breathe/sway) at a gentle rate — pose it BEFORE measuring,
    // because this is a SkinnedMesh: its geometry bounding box is the (huge) bind pose, so we
    // must measure the REAL size from the posed bones, not from Box3.setFromObject.
    const clip = (gltf.animations || []).find(a => /idle/i.test(a.name)) || (gltf.animations || [])[0];
    if (clip) {
      mixer = new THREE.AnimationMixer(obj);
      const act = mixer.clipAction(clip);
      act.timeScale = 0.55;
      act.play();
    }
    obj.updateMatrixWorld(true);
    if (mixer) mixer.update(0);
    obj.updateMatrixWorld(true);

    // bone-based bounds (true rendered size) → scale to ~1.7u, center x/z, feet near y=0
    const bones = [];
    obj.traverse(o => { if (o.isBone) bones.push(o); });
    const bp = new THREE.Vector3();
    let minY = Infinity, maxY = -Infinity, sx = 0, sz = 0;
    for (const bone of bones) { bone.getWorldPosition(bp); minY = Math.min(minY, bp.y); maxY = Math.max(maxY, bp.y); sx += bp.x; sz += bp.z; }
    const span = (maxY - minY) || 1;
    const cx = sx / bones.length, cz = sz / bones.length;
    const s = 1.62 / span;               // bones span ≈ feet→head-top; leaves room for the helmet on top
    obj.scale.setScalar(s);
    obj.position.set(-cx * s, -minY * s + 0.02, -cz * s);
    obj.updateMatrixWorld(true);

    addGear(obj);        // our hockey gear, parented to the bones
    return obj;
  }

  function mount(node) { root = node; scene.add(root); recolor(getKit()); if (!raf) render(); }

  // Try the real human base; fall back to the procedural placeholder on any error (404/parse/build).
  new GLTFLoader().load(
    MODEL_URL,
    gltf => { try { mount(adoptGlb(gltf)); } catch (e) { console.warn('[locker-3d] glb build failed, placeholder:', e?.message || e); mixer = null; mount(buildPlaceholder()); } },
    undefined,
    () => mount(buildPlaceholder()),
  );

  // ── render loop ──
  let raf = null;
  const clock = new THREE.Clock();
  function render() { renderer.render(scene, camera); }
  function frame() { raf = requestAnimationFrame(frame); const dt = clock.getDelta(); if (mixer) mixer.update(dt); controls.update(); render(); }
  function start() { if (!raf) { resize(); clock.getDelta(); raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

  function resize() {
    const host = canvas.parentElement || canvas;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(() => { resize(); if (!raf) render(); });
  ro.observe(canvas.parentElement || canvas);

  function dispose() {
    stop();
    try { ro.disconnect(); } catch {}
    controls.dispose();
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    Object.values(mats).flat().forEach(m => { try { m.dispose && m.dispose(); } catch {} });
    numTex.dispose();
    renderer.dispose();
  }

  return { recolor, start, stop, dispose, resize, running: () => raf != null };
}
