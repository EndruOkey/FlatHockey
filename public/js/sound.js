// Web Audio API synthesized SFX — no external files needed
let _ctx = null;
function _ac() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

export const SFX = {
  // Referee whistle — two short blasts (breath noise + tonal sine)
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

  // Puck hitting boards/post
  puckHit(intensity = 1) {
    const ac  = _ac();
    const dur = 0.06;
    const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
    }
    const src  = ac.createBufferSource();
    const filt = ac.createBiquadFilter();
    const g    = ac.createGain();
    src.buffer = buf;
    filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 0.8;
    src.connect(filt); filt.connect(g); g.connect(ac.destination);
    g.gain.value = Math.min(intensity, 1) * 0.6;
    src.start();
  },

  // Puck on stick (softer click)
  puckStick() {
    const ac  = _ac();
    const osc = ac.createOscillator();
    const g   = ac.createGain();
    osc.connect(g); g.connect(ac.destination);
    osc.type = 'triangle'; osc.frequency.value = 320;
    const t = ac.currentTime;
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.start(t); osc.stop(t + 0.08);
  },

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
