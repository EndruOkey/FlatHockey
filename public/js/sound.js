// Web Audio API synthesized SFX — no external files needed
let _ctx = null;
function _ac() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
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
    src.connect(bp); bp.connect(ng); ng.connect(ac.destination);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.042, t + 0.007);
    ng.gain.setValueAtTime(0.042, t + dur - 0.02);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.04);
    src.start(t); src.stop(t + dur + 0.06);
    const osc = ac.createOscillator();
    const og  = ac.createGain();
    osc.connect(og); og.connect(ac.destination);
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
      src.connect(bp); bp.connect(ng); ng.connect(ac.destination);
      ng.gain.setValueAtTime(0, s);
      ng.gain.linearRampToValueAtTime(0.038, s + 0.008);
      ng.gain.setValueAtTime(0.038, s + dur - 0.025);
      ng.gain.exponentialRampToValueAtTime(0.001, s + dur + 0.03);
      src.start(s); src.stop(s + dur + 0.06);

      // Tónová složka
      const osc = ac.createOscillator();
      const og  = ac.createGain();
      osc.connect(og); og.connect(ac.destination);
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
    src.connect(bp); bp.connect(ng); ng.connect(ac.destination);
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.07, t + 0.01);
    ng.gain.setValueAtTime(0.07, t + dur - 0.08);
    ng.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.06);
    src.start(t); src.stop(t + dur + 0.08);

    // Tón — stoupá a pak drží
    const osc = ac.createOscillator();
    const og  = ac.createGain();
    osc.connect(og); og.connect(ac.destination);
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
      osc.connect(lp); lp.connect(g); g.connect(ac.destination);
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
  // Reálná tyčka: 5cm průměr, ocel, ~1.2m délka → inharmonické parciály, pomalý útlum
  post() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    // Impulsní transient (<3ms) — fyzický náraz puku o kov
    const ib = ac.createBuffer(1, Math.ceil(sr * 0.003), sr);
    const id = ib.getChannelData(0);
    for (let i = 0; i < id.length; i++) id[i] = (Math.random() * 2 - 1) * Math.exp(-i * 4 / id.length);
    const is = ac.createBufferSource(), ihp = ac.createBiquadFilter(), ig = ac.createGain();
    is.buffer = ib; ihp.type = 'highpass'; ihp.frequency.value = 1000;
    is.connect(ihp); ihp.connect(ig); ig.connect(ac.destination);
    ig.gain.value = 0.30; is.start(t);
    // Modální rezonance (inharmonické — dutá ocelová trubka nemá přesné harmonické)
    for (const [f, a, d] of [
      [865,  0.28, 0.36],  // 1. mode — dominantní tón
      [1740, 0.09, 0.20],  // ~2× (mírně inharmonické)
      [2720, 0.04, 0.12],  // ~3.1×
      [3950, 0.02, 0.07],  // ~4.6×
      [520,  0.13, 0.28],  // délkový rezonátor trubky
      [400,  0.07, 0.42],  // nejnižší body mode (nejdelší útlum)
    ]) {
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.connect(g); g.connect(ac.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f * 1.004, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.02);
      g.gain.setValueAtTime(a, t + 0.001);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.start(t); osc.stop(t + d + 0.01);
    }
  },

  // Mantinel — layered: impakt + nízké tělo + plexisklo rattle
  // Boards v NHL: kompozit/dřevo dole + plexisklo nahoře → charakteristické "bum"
  boards(intensity = 1) {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const v = Math.min(intensity, 1);
    // 1. Wideband impact transient (2ms) — první kontakt puku s plochou
    const ib = ac.createBuffer(1, Math.ceil(sr * 0.002), sr);
    const idd = ib.getChannelData(0);
    for (let i = 0; i < idd.length; i++) idd[i] = (Math.random() * 2 - 1) * (1 - i / idd.length);
    const is = ac.createBufferSource(), ihp = ac.createBiquadFilter(), ig = ac.createGain();
    is.buffer = ib; ihp.type = 'highpass'; ihp.frequency.value = 1400;
    is.connect(ihp); ihp.connect(ig); ig.connect(ac.destination);
    ig.gain.value = 0.28 * v; is.start(t);
    // 2. Nízký tělesný rezonátor (wood/composite: 55-110Hz)
    for (const [f, a, d] of [[88, 0.52, 0.26], [55, 0.32, 0.32], [176, 0.18, 0.15]]) {
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.connect(g); g.connect(ac.destination);
      osc.type = 'sine'; osc.frequency.value = f;
      g.gain.setValueAtTime(a * v, t + 0.001);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.start(t); osc.stop(t + d + 0.01);
    }
    // 3. Plexisklo vibrace (400-600Hz filtered noise, krátký rattle)
    const pb = ac.createBuffer(1, Math.ceil(sr * 0.07), sr);
    const pd = pb.getChannelData(0);
    for (let i = 0; i < pd.length; i++) pd[i] = (Math.random() * 2 - 1) * Math.exp(-i * 5 / pd.length);
    const ps = ac.createBufferSource(), pbp = ac.createBiquadFilter(), ppk = ac.createBiquadFilter(), pg = ac.createGain();
    ps.buffer = pb;
    pbp.type = 'bandpass'; pbp.frequency.value = 480; pbp.Q.value = 1.4;
    ppk.type = 'peaking';  ppk.frequency.value = 320; ppk.gain.value = 6;
    ps.connect(pbp); pbp.connect(ppk); ppk.connect(pg); pg.connect(ac.destination);
    pg.gain.value = 0.22 * v; ps.start(t);
  },

  // Dopad puku na led — krátký click + scrape při přistání
  iceDrop() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    // Impaktní click (4ms)
    const cb = ac.createBuffer(1, Math.ceil(sr * 0.004), sr);
    const cd = cb.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / cd.length);
    const cs = ac.createBufferSource(), clp = ac.createBiquadFilter(), cg = ac.createGain();
    cs.buffer = cb; clp.type = 'lowpass'; clp.frequency.value = 900;
    cs.connect(clp); clp.connect(cg); cg.connect(ac.destination);
    cg.gain.value = 0.24; cs.start(t);
    // Scrape na ledě (55ms filtered noise)
    const sb = ac.createBuffer(1, Math.ceil(sr * 0.055), sr);
    const sd = sb.getChannelData(0);
    for (let i = 0; i < sd.length; i++) sd[i] = (Math.random() * 2 - 1) * Math.exp(-i * 4 / sd.length);
    const ss = ac.createBufferSource(), sbp = ac.createBiquadFilter(), sg = ac.createGain();
    ss.buffer = sb; sbp.type = 'bandpass'; sbp.frequency.value = 260; sbp.Q.value = 1.5;
    ss.connect(sbp); sbp.connect(sg); sg.connect(ac.destination);
    sg.gain.value = 0.16; ss.start(t);
  },

  // Výstřel — kompozitní "crack": krátký tvrdý transient + stick flex + puk thud
  // Moderní hokejka (uhlíkové vlákno): velmi ostrý, krátký zvuk s klesající pitch
  shoot(power = 1) {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const v = 0.10 + 0.14 * Math.min(power, 1);
    // 1. Crack transient (8ms, high-mid, soft-clipped pro "snap")
    const crb = ac.createBuffer(1, Math.ceil(sr * 0.008), sr);
    const crd = crb.getChannelData(0);
    for (let i = 0; i < crd.length; i++) crd[i] = (Math.random() * 2 - 1) * Math.exp(-i * 4 / crd.length);
    const crs = ac.createBufferSource(), crbp = ac.createBiquadFilter(), crhp = ac.createBiquadFilter();
    const crws = ac.createWaveShaper(), crg = ac.createGain();
    crs.buffer = crb;
    crbp.type = 'bandpass'; crbp.frequency.value = 1100; crbp.Q.value = 0.9;
    crhp.type = 'highpass'; crhp.frequency.value = 380;
    const wsd = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; wsd[i] = x / (1 + Math.abs(x) * 0.9); }
    crws.curve = wsd;
    crs.connect(crbp); crbp.connect(crhp); crhp.connect(crws); crws.connect(crg); crg.connect(ac.destination);
    crg.gain.value = v * 2.4; crs.start(t);
    // 2. Stick flex (sawtooth s klesající frekvencí — ohyb hole)
    const fo = ac.createOscillator(), flp = ac.createBiquadFilter(), fg = ac.createGain();
    fo.connect(flp); flp.connect(fg); fg.connect(ac.destination);
    fo.type = 'sawtooth';
    fo.frequency.setValueAtTime(560, t); fo.frequency.exponentialRampToValueAtTime(180, t + 0.038);
    flp.type = 'lowpass'; flp.frequency.value = 950;
    fg.gain.setValueAtTime(v * 0.50, t + 0.001); fg.gain.exponentialRampToValueAtTime(0.001, t + 0.042);
    fo.start(t); fo.stop(t + 0.05);
    // 3. Puk thud (nízký "hmm" — hmotnost puku)
    const to = ac.createOscillator(), tg = ac.createGain();
    to.connect(tg); tg.connect(ac.destination);
    to.type = 'sine';
    to.frequency.setValueAtTime(125, t); to.frequency.exponentialRampToValueAtTime(58, t + 0.035);
    tg.gain.setValueAtTime(v * 0.40, t); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    to.start(t); to.stop(t + 0.045);
  },

  // Pickup puku — jemný gumový tap na čepeli (velmi krátký, tlumený)
  pickup() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const nb = ac.createBuffer(1, Math.ceil(sr * 0.006), sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.exp(-i * 4 / nd.length);
    const ns = ac.createBufferSource(), lp1 = ac.createBiquadFilter(), lp2 = ac.createBiquadFilter(), g = ac.createGain();
    ns.buffer = nb; lp1.type = 'lowpass'; lp1.frequency.value = 700; lp2.type = 'lowpass'; lp2.frequency.value = 380;
    ns.connect(lp1); lp1.connect(lp2); lp2.connect(g); g.connect(ac.destination);
    g.gain.value = 0.30; ns.start(t);
    // Stick body micro-resonance
    const osc = ac.createOscillator(), og = ac.createGain();
    osc.connect(og); og.connect(ac.destination); osc.type = 'sine';
    osc.frequency.setValueAtTime(250, t); osc.frequency.exponentialRampToValueAtTime(155, t + 0.022);
    og.gain.setValueAtTime(0.07, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
    osc.start(t); osc.stop(t + 0.03);
  },

  // Lapačka — kožená "thwap": double-lowpass, 3ms attack (kůže se ohnout před zachycením)
  glove() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    // Hlavní tělo: leather absorbs puck (dlouhý decay přes pěnu)
    const nb = ac.createBuffer(1, Math.ceil(sr * 0.09), sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) {
      const att = Math.min(1, i / (sr * 0.003));
      nd[i] = (Math.random() * 2 - 1) * att * Math.exp(-i * 4.5 / nd.length);
    }
    const ns = ac.createBufferSource(), lp1 = ac.createBiquadFilter(), lp2 = ac.createBiquadFilter();
    const pk = ac.createBiquadFilter(), g = ac.createGain();
    ns.buffer = nb;
    lp1.type = 'lowpass'; lp1.frequency.value = 620; lp1.Q.value = 0.5;
    lp2.type = 'lowpass'; lp2.frequency.value = 310; lp2.Q.value = 0.8;
    pk.type  = 'peaking'; pk.frequency.value = 245;  pk.gain.value = 7;
    ns.connect(lp1); lp1.connect(lp2); lp2.connect(pk); pk.connect(g); g.connect(ac.destination);
    g.gain.value = 0.55; ns.start(t);
    // Plesknutí do kapsy lapačky (krátký mid-freq transient)
    const sb = ac.createBuffer(1, Math.ceil(sr * 0.004), sr);
    const sd = sb.getChannelData(0);
    for (let i = 0; i < sd.length; i++) sd[i] = (Math.random() * 2 - 1) * (1 - i / sd.length);
    const ss = ac.createBufferSource(), sbp = ac.createBiquadFilter(), sg = ac.createGain();
    ss.buffer = sb; sbp.type = 'bandpass'; sbp.frequency.value = 500; sbp.Q.value = 1.2;
    ss.connect(sbp); sbp.connect(sg); sg.connect(ac.destination);
    sg.gain.value = 0.20; ss.start(t);
  },

  // Vyrážečka — plastový "smack": tvrdší než lapačka, více výšek, kratší
  blocker() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    // Plastový transient (3ms, vyšší frekvence)
    const tb = ac.createBuffer(1, Math.ceil(sr * 0.003), sr);
    const td = tb.getChannelData(0);
    for (let i = 0; i < td.length; i++) td[i] = (Math.random() * 2 - 1) * (1 - i / td.length);
    const ts = ac.createBufferSource(), tbp = ac.createBiquadFilter(), tg = ac.createGain();
    ts.buffer = tb; tbp.type = 'bandpass'; tbp.frequency.value = 1900; tbp.Q.value = 1.0;
    ts.connect(tbp); tbp.connect(tg); tg.connect(ac.destination);
    tg.gain.value = 0.25; ts.start(t);
    // Tělo blocker-padu (foam + plastic)
    const nb = ac.createBuffer(1, Math.ceil(sr * 0.06), sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * Math.exp(-i * 5.5 / nd.length);
    const ns = ac.createBufferSource(), lp = ac.createBiquadFilter(), ppk = ac.createBiquadFilter(), ng = ac.createGain();
    ns.buffer = nb;
    lp.type  = 'lowpass'; lp.frequency.value  = 850;
    ppk.type = 'peaking'; ppk.frequency.value = 520; ppk.gain.value = 5;
    ns.connect(lp); lp.connect(ppk); ppk.connect(ng); ng.connect(ac.destination);
    ng.gain.value = 0.32; ns.start(t);
    // Krátký plastový ring
    const osc = ac.createOscillator(), og = ac.createGain();
    osc.connect(og); og.connect(ac.destination); osc.type = 'sine'; osc.frequency.value = 660;
    og.gain.setValueAtTime(0.08, t + 0.001); og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.start(t); osc.stop(t + 0.07);
  },

  // Beton — nejměkčí zákrok: trojnásobný lowpass, pomalý attack (pěna se komprimuje)
  pads() {
    const ac = _ac(), t = ac.currentTime, sr = ac.sampleRate;
    const nb = ac.createBuffer(1, Math.ceil(sr * 0.10), sr);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) {
      const att = Math.min(1, i / (sr * 0.005));
      nd[i] = (Math.random() * 2 - 1) * att * Math.exp(-i * 3.5 / nd.length);
    }
    const ns = ac.createBufferSource(), lp1 = ac.createBiquadFilter(), lp2 = ac.createBiquadFilter();
    const pk = ac.createBiquadFilter(), g = ac.createGain();
    ns.buffer = nb;
    lp1.type = 'lowpass'; lp1.frequency.value = 440;
    lp2.type = 'lowpass'; lp2.frequency.value = 240;
    pk.type  = 'peaking'; pk.frequency.value = 155; pk.gain.value = 9;
    ns.connect(lp1); lp1.connect(lp2); lp2.connect(pk); pk.connect(g); g.connect(ac.destination);
    g.gain.value = 0.55; ns.start(t);
    // Nízký sinusový "weight" (hmotnost brankáře padá na kolena)
    const osc = ac.createOscillator(), og = ac.createGain();
    osc.connect(og); og.connect(ac.destination); osc.type = 'sine';
    osc.frequency.setValueAtTime(105, t); osc.frequency.exponentialRampToValueAtTime(62, t + 0.075);
    og.gain.setValueAtTime(0.20, t + 0.003); og.gain.exponentialRampToValueAtTime(0.001, t + 0.095);
    osc.start(t); osc.stop(t + 0.10);
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
    src.connect(lo); lo.connect(mid); mid.connect(g); g.connect(ac.destination);
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
    src.connect(lo); lo.connect(g); g.connect(ac.destination);
    const t = ac.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.start(t); src.stop(t + dur);
  },
};
