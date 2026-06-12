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

  // Tyčka — kovový "ping" (sinusový náraz, rychlý útlum)
  // Real ref: čistý krátký tón ~900Hz s okamžitým decayem a harmonickým overtone
  post() {
    const ac = _ac();
    const t  = ac.currentTime;
    for (const [freq, vol, dur] of [[920, 0.28, 0.22], [1840, 0.10, 0.12], [460, 0.08, 0.14]]) {
      const osc = ac.createOscillator();
      const g   = ac.createGain();
      osc.connect(g); g.connect(ac.destination);
      osc.type = 'sine'; osc.frequency.value = freq;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.start(t); osc.stop(t + dur + 0.01);
    }
    // Přidat krátký noise burst pro realismus
    const nlen = Math.ceil(ac.sampleRate * 0.025);
    const nbuf = ac.createBuffer(1, nlen, ac.sampleRate);
    const nd   = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nlen);
    const nsrc = ac.createBufferSource();
    const nbp  = ac.createBiquadFilter();
    const ng   = ac.createGain();
    nsrc.buffer = nbuf;
    nbp.type = 'bandpass'; nbp.frequency.value = 1100; nbp.Q.value = 1.5;
    nsrc.connect(nbp); nbp.connect(ng); ng.connect(ac.destination);
    ng.gain.value = 0.12;
    nsrc.start(t);
  },

  // Mantinel — dřevěné/plexisklové bum (nízký impact + rezonance)
  // Real ref: hluboký "thud" s krátkou vibrací desky, ~120-220Hz
  boards(intensity = 1) {
    const ac  = _ac();
    const t   = ac.currentTime;
    const vol = Math.min(intensity, 1);
    // Základní tělesný tón (sinusový, rychlý útlum)
    for (const [f, v, d] of [[130, 0.35, 0.18], [260, 0.12, 0.10]]) {
      const osc = ac.createOscillator();
      const g   = ac.createGain();
      osc.connect(g); g.connect(ac.destination);
      osc.type = 'sine'; osc.frequency.value = f;
      g.gain.setValueAtTime(v * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      osc.start(t); osc.stop(t + d + 0.01);
    }
    // Noise transient pro úder
    const nlen = Math.ceil(ac.sampleRate * 0.055);
    const nbuf = ac.createBuffer(1, nlen, ac.sampleRate);
    const nd   = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 1.2);
    const nsrc = ac.createBufferSource();
    const lp   = ac.createBiquadFilter();
    const ng   = ac.createGain();
    nsrc.buffer = nbuf;
    lp.type = 'lowpass'; lp.frequency.value = 500;
    nsrc.connect(lp); lp.connect(ng); ng.connect(ac.destination);
    ng.gain.value = 0.22 * vol;
    nsrc.start(t);
  },

  // Dopad puku na led — jemný plastický "slap/skid" (~100-200Hz)
  // Real ref: puk dopadá na ledovou plochu — nízký krátký šum bez výšek
  iceDrop() {
    const ac   = _ac();
    const t    = ac.currentTime;
    const dur  = 0.045;
    const nlen = Math.ceil(ac.sampleRate * dur);
    const nbuf = ac.createBuffer(1, nlen, ac.sampleRate);
    const nd   = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 0.9);
    const nsrc = ac.createBufferSource();
    const lp   = ac.createBiquadFilter();
    const bp   = ac.createBiquadFilter();
    const g    = ac.createGain();
    nsrc.buffer = nbuf;
    lp.type = 'lowpass';  lp.frequency.value  = 280;
    bp.type = 'peaking';  bp.frequency.value  = 160; bp.gain.value = 5;
    nsrc.connect(lp); lp.connect(bp); bp.connect(g); g.connect(ac.destination);
    g.gain.value = 0.18;
    nsrc.start(t);
  },

  // Vystřelení puku (slapshot/wrist shot) — dřevěný úder + vzduch
  // Real ref: puk se odrazí od hole — tvrdý krátký "crack" s high-mid transientem ~600-1400Hz
  shoot(power = 1) {
    const ac  = _ac();
    const t   = ac.currentTime;
    const vol = 0.14 + 0.10 * Math.min(power, 1);
    // Hlavní úder
    const nlen = Math.ceil(ac.sampleRate * 0.04);
    const nbuf = ac.createBuffer(1, nlen, ac.sampleRate);
    const nd   = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 0.7);
    const nsrc = ac.createBufferSource();
    const bp   = ac.createBiquadFilter();
    const hp   = ac.createBiquadFilter();
    const g    = ac.createGain();
    nsrc.buffer = nbuf;
    bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.8;
    hp.type = 'highpass'; hp.frequency.value = 300;
    nsrc.connect(bp); bp.connect(hp); hp.connect(g); g.connect(ac.destination);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    nsrc.start(t);
    // Tónový transient (dřevo/kompozit)
    const osc = ac.createOscillator();
    const og  = ac.createGain();
    osc.connect(og); og.connect(ac.destination);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(700, t);
    osc.frequency.exponentialRampToValueAtTime(350, t + 0.035);
    og.gain.setValueAtTime(vol * 0.55, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.start(t); osc.stop(t + 0.05);
  },

  // Přijetí/pickup puku — měkký plastický "thud" (~200-350Hz)
  // Real ref: puk kontaktuje čepel hole — tlumený nízký žuchnutí bez ostrých výšek
  pickup() {
    const ac   = _ac();
    const t    = ac.currentTime;
    const nlen = Math.ceil(ac.sampleRate * 0.038);
    const nbuf = ac.createBuffer(1, nlen, ac.sampleRate);
    const nd   = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 1.1);
    const nsrc = ac.createBufferSource();
    const bp   = ac.createBiquadFilter();
    const lp   = ac.createBiquadFilter();
    const g    = ac.createGain();
    nsrc.buffer = nbuf;
    bp.type = 'bandpass'; bp.frequency.value = 270; bp.Q.value = 1.4;
    lp.type = 'lowpass';  lp.frequency.value = 600;
    nsrc.connect(bp); bp.connect(lp); lp.connect(g); g.connect(ac.destination);
    g.gain.value = 0.16;
    nsrc.start(t);
  },

  // Lapačka golmana — tlumená kožená "thwap" (~350-550Hz, komprimovaná)
  // Real ref: puk do catch-glove — měkký pleskavý zvuk, tlumí energii
  glove() {
    const ac  = _ac();
    const t   = ac.currentTime;
    // Pleskavý transient
    const nlen = Math.ceil(ac.sampleRate * 0.06);
    const nbuf = ac.createBuffer(1, nlen, ac.sampleRate);
    const nd   = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 0.8);
    const nsrc = ac.createBufferSource();
    const bp   = ac.createBiquadFilter();
    const lp   = ac.createBiquadFilter();
    const ng   = ac.createGain();
    nsrc.buffer = nbuf;
    bp.type = 'bandpass'; bp.frequency.value = 430; bp.Q.value = 1.8;
    lp.type = 'lowpass';  lp.frequency.value = 700;
    nsrc.connect(bp); bp.connect(lp); lp.connect(ng); ng.connect(ac.destination);
    ng.gain.setValueAtTime(0.20, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    nsrc.start(t);
    // Měkký tón pro "polštářový" efekt lapačky
    const osc = ac.createOscillator();
    const og  = ac.createGain();
    osc.connect(og); og.connect(ac.destination);
    osc.type = 'sine'; osc.frequency.value = 310;
    og.gain.setValueAtTime(0.06, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.start(t); osc.stop(t + 0.07);
  },

  // Vyrážečka golmana — tvrdší plastový "clack" (~700-1000Hz)
  // Real ref: puk narazí do blocker-pad — tvrdší, ostrý, kratší zvuk než lapačka
  blocker() {
    const ac  = _ac();
    const t   = ac.currentTime;
    const nlen = Math.ceil(ac.sampleRate * 0.035);
    const nbuf = ac.createBuffer(1, nlen, ac.sampleRate);
    const nd   = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 0.6);
    const nsrc = ac.createBufferSource();
    const bp   = ac.createBiquadFilter();
    const ng   = ac.createGain();
    nsrc.buffer = nbuf;
    bp.type = 'bandpass'; bp.frequency.value = 820; bp.Q.value = 2.2;
    nsrc.connect(bp); bp.connect(ng); ng.connect(ac.destination);
    ng.gain.setValueAtTime(0.18, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    nsrc.start(t);
    // Krátký tónový "clack"
    const osc = ac.createOscillator();
    const og  = ac.createGain();
    osc.connect(og); og.connect(ac.destination);
    osc.type = 'square'; osc.frequency.value = 680;
    og.gain.setValueAtTime(0.055, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.start(t); osc.stop(t + 0.035);
  },

  // Beton golmana — měkký "fump" (puk dopadne do mäkkého pádu, ~150-300Hz)
  // Real ref: puk narazí do leg-pad — tlumený, rozplizlý nízký úder, téměř bez výšek
  pads() {
    const ac   = _ac();
    const t    = ac.currentTime;
    const nlen = Math.ceil(ac.sampleRate * 0.07);
    const nbuf = ac.createBuffer(1, nlen, ac.sampleRate);
    const nd   = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / nlen, 0.65);
    const nsrc = ac.createBufferSource();
    const lp   = ac.createBiquadFilter();
    const bp   = ac.createBiquadFilter();
    const ng   = ac.createGain();
    nsrc.buffer = nbuf;
    lp.type = 'lowpass';  lp.frequency.value  = 380;
    bp.type = 'peaking';  bp.frequency.value  = 200; bp.gain.value = 6;
    nsrc.connect(lp); lp.connect(bp); bp.connect(ng); ng.connect(ac.destination);
    ng.gain.setValueAtTime(0.22, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    nsrc.start(t);
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
