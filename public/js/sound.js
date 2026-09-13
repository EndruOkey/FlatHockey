// Web Audio API synthesized SFX — no external files needed
let _ctx    = null;
let _master = null;  // DynamicsCompressor as master bus — prevents clipping when sounds stack
let _volGain = null; // Master volume GainNode (after compressor, before destination)

function _ac() {
  if (!_ctx) {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
    _master = _ctx.createDynamicsCompressor();
    _master.threshold.value = -16;
    _master.knee.value      = 10;
    _master.ratio.value     = 6;
    _master.attack.value    = 0.003;
    _master.release.value   = 0.12;
    _volGain = _ctx.createGain();
    _volGain.gain.value = parseFloat(localStorage.getItem('sfx-vol') ?? '0.8');
    _master.connect(_volGain);
    _volGain.connect(_ctx.destination);
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

export function setVolume(v) {
  const val = Math.max(0, Math.min(1, v));
  localStorage.setItem('sfx-vol', String(val));
  if (_volGain) _volGain.gain.value = val;
}

export function getVolume() {
  return parseFloat(localStorage.getItem('sfx-vol') ?? '0.8');
}

export const SFX = {
  // Jeden krátký hvizd — přerušení hry (faul, offside, icing, buly-setup)
  // Tón: 2600 Hz (ostřejší než rozehrávkový), délka 0.18s
  stopWhistle() {
    const ac = _ac();
    const t  = ac.currentTime;
    const FREQ = 2600;
    const dur  = 0.18;
    const len  = Math.ceil(ac.sampleRate * (dur + 0.06));
    const buf  = ac.createBuffer(1, len, ac.sampleRate);
    const d    = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    const bp  = ac.createBiquadFilter();
    const ng  = ac.createGain();
    src.buffer = buf;
    bp.type = 'bandpass'; bp.frequency.value = FREQ; bp.Q.value = 60;
    src.connect(bp); bp.connect(ng); ng.connect(_master);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.042, t + 0.007);
    ng.gain.setValueAtTime(0.042, t + dur - 0.02);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.04);
    src.start(t); src.stop(t + dur + 0.06);
    const osc = ac.createOscillator();
    const og  = ac.createGain();
    osc.connect(og); og.connect(_master);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(FREQ - 60, t);
    osc.frequency.linearRampToValueAtTime(FREQ + 40, t + 0.05);
    osc.frequency.linearRampToValueAtTime(FREQ - 20, t + dur);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.034, t + 0.007);
    og.gain.setValueAtTime(0.034, t + dur - 0.02);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.04);
    osc.start(t); osc.stop(t + dur + 0.05);
  },

  // Dva krátké hvizdy — rozehrávka (puk back in play, buly)
  whistle() {
    const ac = _ac();
    const t  = ac.currentTime;
    const FREQ = 2400;   // lehce hlubší tón

    for (let i = 0; i < 2; i++) {
      const s   = t + i * 0.28;
      const dur = i === 0 ? 0.22 : 0.16;

      // Vzduchová složka — úzký bandpass šum
      const len = Math.ceil(ac.sampleRate * (dur + 0.06));
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const d   = buf.getChannelData(0);
      for (let j = 0; j < len; j++) d[j] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      const bp  = ac.createBiquadFilter();
      const ng  = ac.createGain();
      src.buffer = buf;
      bp.type = 'bandpass'; bp.frequency.value = FREQ; bp.Q.value = 55;
      src.connect(bp); bp.connect(ng); ng.connect(_master);
      ng.gain.setValueAtTime(0, s);
      ng.gain.linearRampToValueAtTime(0.038, s + 0.008);
      ng.gain.setValueAtTime(0.038, s + dur - 0.025);
      ng.gain.exponentialRampToValueAtTime(0.001, s + dur + 0.03);
      src.start(s); src.stop(s + dur + 0.06);

      // Tónová složka
      const osc = ac.createOscillator();
      const og  = ac.createGain();
      osc.connect(og); og.connect(_master);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(FREQ - 80, s);
      osc.frequency.linearRampToValueAtTime(FREQ + 50, s + 0.06);
      osc.frequency.setValueAtTime(FREQ + 20, s + dur - 0.04);
      osc.frequency.linearRampToValueAtTime(FREQ - 30, s + dur);
      og.gain.setValueAtTime(0, s);
      og.gain.linearRampToValueAtTime(0.030, s + 0.008);
      og.gain.setValueAtTime(0.030, s + dur - 0.025);
      og.gain.exponentialRampToValueAtTime(0.001, s + dur + 0.03);
      osc.start(s); osc.stop(s + dur + 0.04);
    }
  },

  // Long single blast — goal/major stoppage (Fox 40 style: sustained piercing)
  goalWhistle() {
    const ac  = _ac();
    const t   = ac.currentTime;
    const dur = 0.90;
    const FREQ = 2200;   // dlouhý blast — hlubší než buly-píšťalka

    // Vzduch — úzký bandpass šum
    const len = Math.ceil(ac.sampleRate * (dur + 0.06));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource();
    const bp  = ac.createBiquadFilter();
    const ng  = ac.createGain();
    src.buffer = buf;
    bp.type = 'bandpass'; bp.frequency.value = FREQ; bp.Q.value = 50;
    src.connect(bp); bp.connect(ng); ng.connect(_master);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.07, t + 0.01);
    ng.gain.setValueAtTime(0.07, t + dur - 0.08);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.06);
    src.start(t); src.stop(t + dur + 0.08);

    // Tón — stoupá a pak drží
    const osc = ac.createOscillator();
    const og  = ac.createGain();
    osc.connect(og); og.connect(_master);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(FREQ - 120, t);
    osc.frequency.linearRampToValueAtTime(FREQ + 80, t + 0.07);
    osc.frequency.setValueAtTime(FREQ + 30, t + dur - 0.08);
    osc.frequency.linearRampToValueAtTime(FREQ - 60, t + dur);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.055, t + 0.01);
    og.gain.setValueAtTime(0.055, t + dur - 0.08);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.06);
    osc.start(t); osc.stop(t + dur + 0.08);
  },

  // Stadium goal horn — classic foghorn chord
  goalHorn() {
    const ac = _ac();
    const t  = ac.currentTime;
    for (const [freq, vol] of [[185, 0.055], [233, 0.038], [277, 0.030]]) {
      const osc  = ac.createOscillator();
      const lp   = ac.createBiquadFilter();
      const g    = ac.createGain();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      osc.connect(lp); lp.connect(g); g.connect(_master);
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.08);
      g.gain.setValueAtTime(vol, t + 1.6);
      g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
      osc.start(t); osc.stop(t + 2.5);
    }
  },

  // Tyčka — modal synthesis dutého ocelového postu
  post() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const ib = ac.createBuffer(1, Math.ceil(sr * 0.003), sr);
    const id = ib.getChannelData(0);
    for (let i = 0; i < id.length; i++) id[i] = (Math.random() * 2 - 1) * Math.exp(-i * 4 / id.length);
    const is = ac.createBufferSource(), ihp = ac.createBiquadFilter(), ig = ac.createGain();
    is.buffer = ib; ihp.type = 'highpass'; ihp.frequency.value = 1000;
    is.connect(ihp); ihp.connect(ig); ig.connect(_master);
    ig.gain.setValueAtTime(0, t); ig.gain.linearRampToValueAtTime(0.22, t + 0.001);
    ig.gain.exponentialRampToValueAtTime(0.001, t + 0.006); is.start(t);
    for (const [f, a, d] of [
      [865,  0.22, 0.36],
      [1740, 0.07, 0.20],
      [2720, 0.03, 0.12],
      [3950, 0.015, 0.07],
      [520,  0.10, 0.28],
      [400,  0.055, 0.42],
    ]) {
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.connect(g); g.connect(_master);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * 1.004, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.02);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.start(t); osc.stop(t + d + 0.01);
    }
  },

  // Břevno — vyšší, kratší ping horizontálního profilu (tenčí trubka než boční tyč)
  crossbar() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const ib = ac.createBuffer(1, Math.ceil(sr * 0.002), sr);
    const id = ib.getChannelData(0);
    for (let i = 0; i < id.length; i++) id[i] = (Math.random() * 2 - 1) * Math.exp(-i * 5 / id.length);
    const is = ac.createBufferSource(), ihp = ac.createBiquadFilter(), ig = ac.createGain();
    is.buffer = ib; ihp.type = 'highpass'; ihp.frequency.value = 1800;
    is.connect(ihp); ihp.connect(ig); ig.connect(_master);
    ig.gain.setValueAtTime(0, t); ig.gain.linearRampToValueAtTime(0.16, t + 0.001);
    ig.gain.exponentialRampToValueAtTime(0.001, t + 0.004); is.start(t);
    for (const [f, a, d] of [
      [1240, 0.16, 0.24],
      [2500, 0.07, 0.14],
      [3800, 0.025, 0.09],
      [780,  0.05, 0.18],
      [5200, 0.010, 0.06],
    ]) {
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.connect(g); g.connect(_master);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * 1.008, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.012);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.start(t); osc.stop(t + d + 0.01);
    }
  },

  // Spojnice/zadní stěna sítě — tlumený úder do trubky, krátký a temný
  spojnice() {
    const ac = _ac(), t = ac.currentTime;
    for (const [f, a, d] of [
      [310,  0.10, 0.16],
      [620,  0.045, 0.10],
      [170,  0.065, 0.20],
      [980,  0.020, 0.07],
    ]) {
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.connect(g); g.connect(_master);
      osc.type = 'sine';
      osc.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.start(t); osc.stop(t + d + 0.01);
    }
  },

  // Mantinel — impakt + nízké tělo + plexisklo rattle
  boards(intensity = 1) {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const v = Math.min(intensity, 1);
    const ib = ac.createBuffer(1, Math.ceil(sr * 0.002), sr);
    const idd = ib.getChannelData(0);
    for (let i = 0; i < idd.length; i++) idd[i] = (Math.random() * 2 - 1) * (1 - i / idd.length);
    const is = ac.createBufferSource(), ihp = ac.createBiquadFilter(), ig = ac.createGain();
    is.buffer = ib; ihp.type = 'highpass'; ihp.frequency.value = 1400;
    is.connect(ihp); ihp.connect(ig); ig.connect(_master);
    ig.gain.setValueAtTime(0, t); ig.gain.linearRampToValueAtTime(0.20 * v, t + 0.001);
    ig.gain.exponentialRampToValueAtTime(0.001, t + 0.004); is.start(t);
    for (const [f, a, d] of [[88, 0.38, 0.26], [55, 0.24, 0.32], [176, 0.14, 0.15]]) {
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.connect(g); g.connect(_master);
      osc.type = 'sine'; osc.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a * v, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.start(t); osc.stop(t + d + 0.01);
    }
    const pb = ac.createBuffer(1, Math.ceil(sr * 0.07), sr);
    const pd = pb.getChannelData(0);
    for (let i = 0; i < pd.length; i++) pd[i] = (Math.random() * 2 - 1) * Math.exp(-i * 5 / pd.length);
    const ps = ac.createBufferSource(), pbp = ac.createBiquadFilter(), pg = ac.createGain();
    ps.buffer = pb;
    pbp.type = 'bandpass'; pbp.frequency.value = 480; pbp.Q.value = 1.4;
    ps.connect(pbp); pbp.connect(pg); pg.connect(_master);
    pg.gain.setValueAtTime(0, t); pg.gain.linearRampToValueAtTime(0.16 * v, t + 0.002);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.07); ps.start(t);
  },

  // Dopad puku na led — click + scrape
  iceDrop() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const cb = ac.createBuffer(1, Math.ceil(sr * 0.004), sr);
    const cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / cd.length);
    const cs = ac.createBufferSource(), clp = ac.createBiquadFilter(), cg = ac.createGain();
    cs.buffer = cb; clp.type = 'lowpass'; clp.frequency.value = 900;
    cs.connect(clp); clp.connect(cg); cg.connect(_master);
    cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(0.18, t + 0.001);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.006); cs.start(t);
    const sb = ac.createBuffer(1, Math.ceil(sr * 0.055), sr);
    const sd = sb.getChannelData(0);
    for (let i = 0; i < sd.length; i++) sd[i] = (Math.random() * 2 - 1) * Math.exp(-i * 4 / sd.length);
    const ss = ac.createBufferSource(), sbp = ac.createBiquadFilter(), sg = ac.createGain();
    ss.buffer = sb; sbp.type = 'bandpass'; sbp.frequency.value = 260; sbp.Q.value = 1.5;
    ss.connect(sbp); sbp.connect(sg); sg.connect(_master);
    sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.12, t + 0.002);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.06); ss.start(t);
  },

  // Výstřel — crack + stick flex + puk thud
  shoot(power = 1) {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const v = 0.10 + 0.12 * Math.min(power, 1);
    const crb = ac.createBuffer(1, Math.ceil(sr * 0.008), sr);
    const crd = crb.getChannelData(0);
    for (let i = 0; i < crd.length; i++) crd[i] = (Math.random() * 2 - 1) * Math.exp(-i * 4 / crd.length);
    const crs = ac.createBufferSource(), crbp = ac.createBiquadFilter(), crws = ac.createWaveShaper(), crg = ac.createGain();
    crs.buffer = crb;
    crbp.type = 'bandpass'; crbp.frequency.value = 1100; crbp.Q.value = 0.9;
    const wsd = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; wsd[i] = x / (1 + Math.abs(x) * 1.2); }
    crws.curve = wsd;
    crs.connect(crbp); crbp.connect(crws); crws.connect(crg); crg.connect(_master);
    crg.gain.setValueAtTime(0, t); crg.gain.linearRampToValueAtTime(v * 1.8, t + 0.001);
    crg.gain.exponentialRampToValueAtTime(0.001, t + 0.012); crs.start(t);
    const fo = ac.createOscillator(), flp = ac.createBiquadFilter(), fg = ac.createGain();
    fo.connect(flp); flp.connect(fg); fg.connect(_master);
    fo.type = 'sawtooth';
    fo.frequency.setValueAtTime(560, t); fo.frequency.exponentialRampToValueAtTime(180, t + 0.038);
    flp.type = 'lowpass'; flp.frequency.value = 950;
    fg.gain.setValueAtTime(0, t); fg.gain.linearRampToValueAtTime(v * 0.40, t + 0.003);
    fg.gain.exponentialRampToValueAtTime(0.001, t + 0.042); fo.start(t); fo.stop(t + 0.05);
    const to = ac.createOscillator(), tg = ac.createGain();
    to.connect(tg); tg.connect(_master); to.type = 'sine';
    to.frequency.setValueAtTime(125, t); to.frequency.exponentialRampToValueAtTime(58, t + 0.035);
    tg.gain.setValueAtTime(0, t); tg.gain.linearRampToValueAtTime(v * 0.32, t + 0.002);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.04); to.start(t); to.stop(t + 0.045);
  },

  // Pickup puku — jemný tap na čepeli
  pickup() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const nb = ac.createBuffer(1, Math.ceil(sr * 0.006), sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.exp(-i * 4 / nd.length);
    const ns = ac.createBufferSource(), lp1 = ac.createBiquadFilter(), lp2 = ac.createBiquadFilter(), g = ac.createGain();
    ns.buffer = nb; lp1.type = 'lowpass'; lp1.frequency.value = 700; lp2.type = 'lowpass'; lp2.frequency.value = 380;
    ns.connect(lp1); lp1.connect(lp2); lp2.connect(g); g.connect(_master);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.001);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.008); ns.start(t);
    const osc = ac.createOscillator(), og = ac.createGain();
    osc.connect(og); og.connect(_master); osc.type = 'sine';
    osc.frequency.setValueAtTime(250, t); osc.frequency.exponentialRampToValueAtTime(155, t + 0.022);
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.055, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.025); osc.start(t); osc.stop(t + 0.03);
  },

  // Lapačka — kožená "thwap"
  glove() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const nb = ac.createBuffer(1, Math.ceil(sr * 0.09), sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) {
      const att = Math.min(1, i / (sr * 0.003));
      nd[i] = (Math.random() * 2 - 1) * att * Math.exp(-i * 4.5 / nd.length);
    }
    const ns = ac.createBufferSource(), lp1 = ac.createBiquadFilter(), lp2 = ac.createBiquadFilter(), g = ac.createGain();
    ns.buffer = nb;
    lp1.type = 'lowpass'; lp1.frequency.value = 620; lp1.Q.value = 0.5;
    lp2.type = 'lowpass'; lp2.frequency.value = 310; lp2.Q.value = 0.8;
    ns.connect(lp1); lp1.connect(lp2); lp2.connect(g); g.connect(_master);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.40, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.10); ns.start(t);
    const sb = ac.createBuffer(1, Math.ceil(sr * 0.004), sr);
    const sd = sb.getChannelData(0);
    for (let i = 0; i < sd.length; i++) sd[i] = (Math.random() * 2 - 1) * (1 - i / sd.length);
    const ss = ac.createBufferSource(), sbp = ac.createBiquadFilter(), sg = ac.createGain();
    ss.buffer = sb; sbp.type = 'bandpass'; sbp.frequency.value = 500; sbp.Q.value = 1.2;
    ss.connect(sbp); sbp.connect(sg); sg.connect(_master);
    sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(0.15, t + 0.001);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.006); ss.start(t);
  },

  // Vyrážečka — plastový "smack"
  blocker() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const tb = ac.createBuffer(1, Math.ceil(sr * 0.003), sr);
    const td = tb.getChannelData(0);
    for (let i = 0; i < td.length; i++) td[i] = (Math.random() * 2 - 1) * (1 - i / td.length);
    const ts = ac.createBufferSource(), tbp = ac.createBiquadFilter(), tg = ac.createGain();
    ts.buffer = tb; tbp.type = 'bandpass'; tbp.frequency.value = 1900; tbp.Q.value = 1.0;
    ts.connect(tbp); tbp.connect(tg); tg.connect(_master);
    tg.gain.setValueAtTime(0, t); tg.gain.linearRampToValueAtTime(0.18, t + 0.001);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.005); ts.start(t);
    const nb = ac.createBuffer(1, Math.ceil(sr * 0.06), sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.exp(-i * 5.5 / nd.length);
    const ns = ac.createBufferSource(), lp = ac.createBiquadFilter(), ng = ac.createGain();
    ns.buffer = nb; lp.type = 'lowpass'; lp.frequency.value = 850;
    ns.connect(lp); lp.connect(ng); ng.connect(_master);
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.24, t + 0.002);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.07); ns.start(t);
    const osc = ac.createOscillator(), og = ac.createGain();
    osc.connect(og); og.connect(_master); osc.type = 'sine'; osc.frequency.value = 660;
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.06, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.06); osc.start(t); osc.stop(t + 0.07);
  },

  // Beton — nejměkčí zákrok
  pads() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const nb = ac.createBuffer(1, Math.ceil(sr * 0.10), sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) {
      const att = Math.min(1, i / (sr * 0.005));
      nd[i] = (Math.random() * 2 - 1) * att * Math.exp(-i * 3.5 / nd.length);
    }
    const ns = ac.createBufferSource(), lp1 = ac.createBiquadFilter(), lp2 = ac.createBiquadFilter(), g = ac.createGain();
    ns.buffer = nb;
    lp1.type = 'lowpass'; lp1.frequency.value = 440;
    lp2.type = 'lowpass'; lp2.frequency.value = 240;
    ns.connect(lp1); lp1.connect(lp2); lp2.connect(g); g.connect(_master);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.40, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11); ns.start(t);
    const osc = ac.createOscillator(), og = ac.createGain();
    osc.connect(og); og.connect(_master); osc.type = 'sine';
    osc.frequency.setValueAtTime(105, t); osc.frequency.exponentialRampToValueAtTime(62, t + 0.075);
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(0.15, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.095); osc.start(t); osc.stop(t + 0.10);
  },

  // Hockey stop — křupavý začátek + HP sweep v pozadí (2kHz→5kHz→1.5kHz)
  iceStop(spd = 100) {
    const ac  = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const f   = Math.min(1, Math.max(0, (spd - 35) / 145));
    const dur = 0.35 + f * 0.45;
    const vol = 0.18 + f * 0.14;   // tišší — efekt v pozadí

    // Křupavý úvodní transient: 6ms HP burst na 5.5kHz = ostrý počáteční křup
    const cb = ac.createBuffer(1, Math.ceil(sr * 0.006), sr);
    const cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / cd.length);
    const cs = ac.createBufferSource(), chp = ac.createBiquadFilter(), cg = ac.createGain();
    cs.buffer = cb; chp.type = 'highpass'; chp.frequency.value = 5500;
    cs.connect(chp); chp.connect(cg); cg.connect(_master);
    cg.gain.setValueAtTime(vol * 1.8, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.006);
    cs.start(t); cs.stop(t + 0.008);

    // Hlavní scrape: začíná hned vysoko (4500Hz) a klesá → žádný písek na začátku
    const dur2 = 0.20 + f * 0.22;  // 200–420ms (kratší)
    const len = Math.ceil(sr * (dur2 + 0.02));
    const buf = ac.createBuffer(1, len, sr);
    const dat = buf.getChannelData(0);
    for (let i = 0; i < len; i++) dat[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(), hp = ac.createBiquadFilter(), g = ac.createGain();
    src.buffer = buf; hp.type = 'highpass';
    hp.frequency.setValueAtTime(4500, t);                             // hned na peaku, bez 2kHz "písku"
    hp.frequency.exponentialRampToValueAtTime(1800, t + dur2);        // klesá dolů
    src.connect(hp); hp.connect(g); g.connect(_master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.55, t + dur2 * 0.08);
    g.gain.linearRampToValueAtTime(vol, t + dur2 * 0.28);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur2);
    src.start(t); src.stop(t + dur2 + 0.02);
  },

  // Poke check — krátký plesknutí hole na hole/puk
  poke(success = true) {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    // Transient: krátký HP burst
    const cb = ac.createBuffer(1, Math.ceil(sr * 0.004), sr);
    const cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / cd.length);
    const cs = ac.createBufferSource(), chp = ac.createBiquadFilter(), cg = ac.createGain();
    cs.buffer = cb; chp.type = 'bandpass'; chp.frequency.value = success ? 2200 : 1600; chp.Q.value = 1.2;
    cs.connect(chp); chp.connect(cg); cg.connect(_master);
    cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(success ? 0.28 : 0.18, t + 0.001);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.018); cs.start(t);
    // Tělo zvuku: krátký clack
    const osc = ac.createOscillator(), og = ac.createGain();
    osc.connect(og); og.connect(_master); osc.type = 'sine';
    osc.frequency.setValueAtTime(success ? 820 : 560, t);
    osc.frequency.exponentialRampToValueAtTime(success ? 340 : 280, t + 0.022);
    og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(success ? 0.10 : 0.065, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.028); osc.start(t); osc.stop(t + 0.03);
  },

  // Puck hitting boards/post (legacy alias → boards)
  puckHit(intensity = 1) { this.boards(intensity); },

  // Puck on stick (legacy alias → pickup)
  puckStick() { this.pickup(); },

  // Crowd roar (brief cheer)
  crowd(dur = 2.5) {
    const ac  = _ac();
    const buf = ac.createBuffer(2, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    }
    const src  = ac.createBufferSource();
    const lo   = ac.createBiquadFilter();
    const mid  = ac.createBiquadFilter();
    const g    = ac.createGain();
    src.buffer = buf;
    lo.type  = 'lowpass';  lo.frequency.value  = 600;
    mid.type = 'peaking';  mid.frequency.value = 300; mid.gain.value = 8;
    src.connect(lo); lo.connect(mid); mid.connect(g); g.connect(_master);
    const t = ac.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.18, t + 0.4);
    g.gain.setValueAtTime(0.18, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t); src.stop(t + dur);
  },

  // Short boo / crowd reaction for away goal
  boo(dur = 1.5) {
    const ac  = _ac();
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1);
    const src  = ac.createBufferSource();
    const lo   = ac.createBiquadFilter();
    const g    = ac.createGain();
    src.buffer = buf;
    lo.type = 'lowpass'; lo.frequency.value = 350;
    src.connect(lo); lo.connect(g); g.connect(_master);
    const t = ac.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t); src.stop(t + dur);
  },
};
