// Validation script for Phase 3 structural changes
// Inlines only the math from canonicalStickRig.ts — no build required.

// ── Config (matches canonicalStickRig.ts) ─────────────────────────────────
const CFG = {
  controlZoneForwardFactor: 0.5,
  controlZoneSideFactor: 0.22,
  maxStickRelativeAngleRad: Math.PI * 0.5,
  shaftLength: 14,
  bladeLength: 12,
  bladeCenterOffset: 6,
  carryAnchorOffset: 6,
  strikeForwardOffset: 2.5,
  chestForwardFactor: 0.42,
  chestSideFactor: 0.48,
  chargeTopHandFwdFactor: 0.42,
  chargeTopHandSideFactor: 0.48,
  chargeShaftReachFactor: 0.55,
  chargeShaftReachBase: 12.0,
  chargeWindupAngleFactor: 0.30,
  chargeCarryForwardFactor: 2.0,
  chargeCarrySideFactor: 0.22,
  gripRatioNormal: 0.38,
  gripRatioCharge: 0.28,
  turningPenaltyAngularSpeed: 4.2,
  turningPenaltyRange: 5.6,
  maxTurningPenalty: 0.18,
  releaseDurationSec: 0.08,
  releaseFollowThroughFactor: 0.06,
  assistBackOffset: 3.5,
  passForwardBoost: 2.5,
  crosscheckBladeReach: 0.8,
  crosscheckTopHandFwdFactor: 0.74,
  crosscheckTopHandSideFactor: -0.81,
  crosscheckBottomHandFwdFactor: 0.74,
  crosscheckBottomHandSideFactor: 0.81,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}
function projectAngleToFrontArc(relativeAngle, maxAbs) {
  const wrapped = wrapAngle(relativeAngle);
  const resolvedMax = clamp(maxAbs, 0, Math.PI * 0.5);
  if (resolvedMax <= 0) return 0;
  const absWrapped = Math.abs(wrapped);
  if (absWrapped <= resolvedMax) return wrapped;
  const backRange = Math.max(0.0001, Math.PI - resolvedMax);
  const t = clamp((absWrapped - resolvedMax) / backRange, 0, 1);
  return (wrapped >= 0 ? 1 : -1) * lerp(resolvedMax, 0, t);
}

function computeRig(input) {
  const r = Math.max(8, input.playerRadius ?? 18);
  const mode = input.mode ?? 'control';
  const shotCharge = clamp(input.shotCharge ?? 0, 0, 1);
  const releaseCharge = clamp(input.releaseCharge ?? 0, 0, 1);
  const stateTimerSec = Math.max(0, input.stateTimerSec ?? 0);
  const handSign = input.handedness === 'left' ? -1 : 1;

  const aimBodyAngle = (input.aimAngle ?? 0) - (input.bodyAngle ?? 0);
  const aimRelAngle = projectAngleToFrontArc(aimBodyAngle, CFG.maxStickRelativeAngleRad);

  let bladeCenterOffset = CFG.bladeCenterOffset;

  const controlZoneFwd = r * CFG.controlZoneForwardFactor;
  const controlZoneSide = r * CFG.controlZoneSideFactor * handSign;

  let topHandFwd, topHandSide, bottomHandFwd, bottomHandSide;
  let bladeBaseFwd, bladeBaseSide, bladeCenterFwd, bladeCenterSide;
  let strikeOriginFwd, strikeOriginSide;
  let bladeForwardFwd, bladeForwardSide;

  if (mode === 'charge' || mode === 'release') {
    topHandFwd = r * CFG.chargeTopHandFwdFactor;
    topHandSide = r * CFG.chargeTopHandSideFactor * handSign;

    let windupRelAngle, gripRatio;
    if (mode === 'charge') {
      const windupTarget = handSign * Math.PI * CFG.chargeWindupAngleFactor * shotCharge;
      const aimBlend = clamp(shotCharge / 0.25, 0, 1);
      windupRelAngle = lerp(aimRelAngle, windupTarget, aimBlend);
      gripRatio = lerp(CFG.gripRatioNormal, CFG.gripRatioCharge, shotCharge);
    } else {
      const relProg = stateTimerSec > 0
        ? clamp(1 - stateTimerSec / CFG.releaseDurationSec, 0, 1) : 1;
      const peak = handSign * Math.PI * CFG.chargeWindupAngleFactor * releaseCharge;
      const follow = -handSign * Math.PI * CFG.releaseFollowThroughFactor;
      windupRelAngle = lerp(peak, follow, relProg);
      gripRatio = lerp(CFG.gripRatioCharge, CFG.gripRatioNormal, relProg);
    }

    bladeForwardFwd = Math.cos(windupRelAngle);
    bladeForwardSide = Math.sin(windupRelAngle);
    const shaftReach = r * CFG.chargeShaftReachFactor + CFG.chargeShaftReachBase;

    bladeBaseFwd = topHandFwd + bladeForwardFwd * shaftReach;
    bladeBaseSide = topHandSide + bladeForwardSide * shaftReach;
    bottomHandFwd = topHandFwd + bladeForwardFwd * shaftReach * gripRatio;
    bottomHandSide = topHandSide + bladeForwardSide * shaftReach * gripRatio;

    strikeOriginFwd = bladeBaseFwd + bladeForwardFwd * bladeCenterOffset;
    strikeOriginSide = bladeBaseSide + bladeForwardSide * bladeCenterOffset;

    if (mode === 'charge') {
      let carryFwd = r * CFG.chargeCarryForwardFactor;
      let carrySide = r * CFG.chargeCarrySideFactor * handSign;
      if (input.prevPose) {
        const blendT = clamp(shotCharge / 0.2, 0, 1);
        carryFwd = lerp(input.prevPose.bladeCenterFwd, carryFwd, blendT);
        carrySide = lerp(input.prevPose.bladeCenterSide, carrySide, blendT);
      }
      const bridgeBlend = shotCharge * shotCharge * 0.2;
      bladeCenterFwd = lerp(carryFwd, strikeOriginFwd, bridgeBlend);
      bladeCenterSide = lerp(carrySide, strikeOriginSide, bridgeBlend);
    } else {
      bladeCenterFwd = strikeOriginFwd;
      bladeCenterSide = strikeOriginSide;
    }
  } else {
    // blade-driven (control)
    bladeForwardFwd = Math.cos(aimRelAngle);
    bladeForwardSide = Math.sin(aimRelAngle);
    const topHandReach = r * 0.035 + 0.9;
    const bottomHandSpacing = r * 0.3 + 2.7;
    const bottomHandBladeReach = CFG.shaftLength * 0.8;
    const bladeBaseReach = topHandReach + bottomHandSpacing + bottomHandBladeReach;
    bladeBaseFwd = controlZoneFwd + bladeForwardFwd * bladeBaseReach;
    bladeBaseSide = controlZoneSide + bladeForwardSide * bladeBaseReach;
    bladeCenterFwd = bladeBaseFwd + bladeForwardFwd * bladeCenterOffset;
    bladeCenterSide = bladeBaseSide + bladeForwardSide * bladeCenterOffset;
    strikeOriginFwd = bladeCenterFwd + bladeForwardFwd * CFG.strikeForwardOffset;
    strikeOriginSide = bladeCenterSide + bladeForwardSide * CFG.strikeForwardOffset;

    topHandFwd = r * CFG.chestForwardFactor;
    topHandSide = r * CFG.chestSideFactor * handSign;
    const spanFwd = bladeBaseFwd - topHandFwd;
    const spanSide = bladeBaseSide - topHandSide;
    const spanLen = Math.hypot(spanFwd, spanSide);
    const unitFwd = spanLen > 0.001 ? spanFwd / spanLen : bladeForwardFwd;
    const unitSide = spanLen > 0.001 ? spanSide / spanLen : bladeForwardSide;
    const gripDist = spanLen * CFG.gripRatioNormal;
    bottomHandFwd = topHandFwd + unitFwd * gripDist;
    bottomHandSide = topHandSide + unitSide * gripDist;
  }

  return { mode, topHandFwd, topHandSide, bottomHandFwd, bottomHandSide,
    bladeBaseFwd, bladeBaseSide, bladeCenterFwd, bladeCenterSide,
    strikeOriginFwd, strikeOriginSide,
    bladeForwardFwd, bladeForwardSide };
}

function f(n) { return n.toFixed(2).padStart(7); }
function pct(n, r) { return (n / r).toFixed(2).padStart(5) + 'r'; }

// ── Test 1: Charge entry continuity ──────────────────────────────────────────
console.log('\n═══ 1. CHARGE ENTRY CONTINUITY ═══\n');

const R = 18;
// Control pose (aim straight = 0)
const ctrl = computeRig({ playerRadius: R, mode: 'control', aimAngle: 0, bodyAngle: 0 });
console.log('Control topHand:    fwd=' + f(ctrl.topHandFwd) + '  side=' + f(ctrl.topHandSide) + '  (' + pct(ctrl.topHandFwd,R) + ', ' + pct(ctrl.topHandSide,R) + ')');
console.log('Control carryAnchor:fwd=' + f(ctrl.bladeCenterFwd) + '  side=' + f(ctrl.bladeCenterSide));

// Charge entry at charge=0 (no prevPose — worst case snap)
const c0 = computeRig({ playerRadius: R, mode: 'charge', shotCharge: 0, aimAngle: 0, bodyAngle: 0 });
console.log('\nCharge@0 topHand:    fwd=' + f(c0.topHandFwd) + '  side=' + f(c0.topHandSide) + '  (' + pct(c0.topHandFwd,R) + ', ' + pct(c0.topHandSide,R) + ')');
console.log('Charge@0 carryAnchor:fwd=' + f(c0.bladeCenterFwd) + '  side=' + f(c0.bladeCenterSide));
const topHandDeltaFwd = Math.abs(c0.topHandFwd - ctrl.topHandFwd);
const topHandDeltaSide = Math.abs(c0.topHandSide - ctrl.topHandSide);
const carryAnchorDelta = Math.hypot(c0.bladeCenterFwd - ctrl.bladeCenterFwd, c0.bladeCenterSide - ctrl.bladeCenterSide);
console.log('\ntopHand delta at entry:    Δfwd=' + f(topHandDeltaFwd) + '  Δside=' + f(topHandDeltaSide) + (topHandDeltaFwd < 0.01 && topHandDeltaSide < 0.01 ? '  ✓ continuous' : '  ✗ SNAP'));
console.log('carryAnchor delta (no prevPose): Δ=' + f(carryAnchorDelta) + (carryAnchorDelta < 0.5 ? '  ✓ ok' : '  ✗ snap=' + carryAnchorDelta.toFixed(1) + 'wu'));

// With prevPose: carry anchor should smoothly blend
const c0_with_prev = computeRig({ playerRadius: R, mode: 'charge', shotCharge: 0.001,
  aimAngle: 0, bodyAngle: 0, prevPose: ctrl });
const carryAnchorWithPrev = Math.hypot(c0_with_prev.bladeCenterFwd - ctrl.bladeCenterFwd, c0_with_prev.bladeCenterSide - ctrl.bladeCenterSide);
console.log('carryAnchor delta (with prevPose, charge=0.001): Δ=' + f(carryAnchorWithPrev) + (carryAnchorWithPrev < 0.5 ? '  ✓ blending' : '  ✗ not blending'));

const c01 = computeRig({ playerRadius: R, mode: 'charge', shotCharge: 0.1,
  aimAngle: 0, bodyAngle: 0, prevPose: ctrl });
const c02 = computeRig({ playerRadius: R, mode: 'charge', shotCharge: 0.2,
  aimAngle: 0, bodyAngle: 0, prevPose: ctrl });
console.log('\nCarry anchor blend progress (with prevPose):');
console.log('  charge=0.1: carryAnchor fwd=' + f(c01.bladeCenterFwd) + '  side=' + f(c01.bladeCenterSide));
console.log('  charge=0.2: carryAnchor fwd=' + f(c02.bladeCenterFwd) + '  side=' + f(c02.bladeCenterSide));
console.log('  charge=1.0 target: fwd=' + f(R * CFG.chargeCarryForwardFactor) + '  side=' + f(R * CFG.chargeCarrySideFactor));

// ── Test 2: Full charge silhouette ────────────────────────────────────────────
console.log('\n═══ 2. FULL CHARGE SILHOUETTE ═══\n');

for (const q of [0, 0.25, 0.5, 0.75, 1.0]) {
  const c = computeRig({ playerRadius: R, mode: 'charge', shotCharge: q, aimAngle: 0, bodyAngle: 0 });
  const windupDeg = (Math.atan2(c.bladeForwardSide, c.bladeForwardFwd) * 180 / Math.PI).toFixed(1);
  console.log(`charge=${q.toFixed(2)}: shaft=${windupDeg.padStart(6)}°  topHand(${f(c.topHandFwd)},${f(c.topHandSide)})  bladeBase(${f(c.bladeBaseFwd)},${f(c.bladeBaseSide)})  carry(${f(c.bladeCenterFwd)},${f(c.bladeCenterSide)})  strike(${f(c.strikeOriginFwd)},${f(c.strikeOriginSide)})`);
}

// carryAnchor vs shaft: how decoupled are they?
const full = computeRig({ playerRadius: R, mode: 'charge', shotCharge: 1.0, aimAngle: 0, bodyAngle: 0 });
const decoupledDist = Math.hypot(full.bladeCenterFwd - full.strikeOriginFwd, full.bladeCenterSide - full.strikeOriginSide);
console.log('\nAt full charge: carry-to-strike separation = ' + decoupledDist.toFixed(1) + 'wu (shaft tip vs puck position)');

// ── Test 3: Shot release direction blend ──────────────────────────────────────
console.log('\n═══ 3. SHOT DIRECTION BLEND ═══\n');

// Simulate shot while skating in various directions
function blendedShotDir(bfx, bfy, pvx, pvy) {
  const pvLen = Math.hypot(pvx, pvy);
  let dx = bfx * 0.7 + (pvLen > 0.001 ? pvx / pvLen * 0.3 : 0);
  let dy = bfy * 0.7 + (pvLen > 0.001 ? pvy / pvLen * 0.3 : 0);
  const dl = Math.hypot(dx, dy);
  if (dl > 0.001) { dx /= dl; dy /= dl; }
  return { dx, dy };
}
function angleDeg(x, y) { return (Math.atan2(y, x) * 180 / Math.PI).toFixed(1); }

// Pure blade forward (aim=0°)
const bf = { x: 1, y: 0 };
const cases = [
  { label: 'skating 0° (same dir)      ', vx:  80, vy:   0 },
  { label: 'skating 90° (perpendicular) ', vx:   0, vy:  80 },
  { label: 'skating 180° (opposite)     ', vx: -80, vy:   0 },
  { label: 'skating 45°                 ', vx:  57, vy:  57 },
  { label: 'no skating                  ', vx:   0, vy:   0 },
];
console.log('Blade aim = 0°. Shot direction after blend:');
for (const { label, vx, vy } of cases) {
  const { dx, dy } = blendedShotDir(bf.x, bf.y, vx, vy);
  const shotDeg = angleDeg(dx, dy);
  const bladeOnlyDeg = angleDeg(bf.x, bf.y);
  const deviation = (parseFloat(shotDeg) - parseFloat(bladeOnlyDeg)).toFixed(1);
  console.log(`  ${label}: shot=${shotDeg.padStart(6)}°  (blade-only=0°, deviation=${deviation}°)`);
}

// ── Test 4: Hand placement relative to body ────────────────────────────────────
console.log('\n═══ 4. HAND PLACEMENT ═══\n');

for (const mode of ['control', 'charge']) {
  for (const q of (mode === 'charge' ? [0, 0.5, 1.0] : [0])) {
    const rig = computeRig({ playerRadius: R, mode, shotCharge: q, aimAngle: 0, bodyAngle: 0 });
    const topDist = Math.hypot(rig.topHandFwd, rig.topHandSide);
    const botDist = Math.hypot(rig.bottomHandFwd, rig.bottomHandSide);
    const insideBody = topDist < R ? '✗ INSIDE BODY' : '✓ outside';
    const botInside = botDist < R ? '✗ INSIDE BODY' : '✓ outside';
    console.log(`${mode} charge=${q.toFixed(1)}: topHand dist=${topDist.toFixed(1)}wu (r=${R}) ${insideBody}`);
    console.log(`${' '.repeat(22)}  botHand dist=${botDist.toFixed(1)}wu ${botInside}`);
    console.log(`${' '.repeat(22)}  topHand=(${f(rig.topHandFwd)},${f(rig.topHandSide)})  bot=(${f(rig.bottomHandFwd)},${f(rig.bottomHandSide)})`);
  }
}

// Also check at right-angle aim (stick swept 90°) for blade-driven
const ctrlSwept = computeRig({ playerRadius: R, mode: 'control', aimAngle: Math.PI*0.5, bodyAngle: 0 });
const topDistSwept = Math.hypot(ctrlSwept.topHandFwd, ctrlSwept.topHandSide);
console.log('\nControl at aim=90° (stick swept far right):');
console.log('  topHand: (' + f(ctrlSwept.topHandFwd) + ', ' + f(ctrlSwept.topHandSide) + ') dist=' + topDistSwept.toFixed(1) + 'wu');
console.log('  topHand is chest-anchored (should NOT change with aim):');
const ctrlAim0 = computeRig({ playerRadius: R, mode: 'control', aimAngle: 0, bodyAngle: 0 });
const topHandAimDelta = Math.hypot(ctrlAim0.topHandFwd - ctrlSwept.topHandFwd, ctrlAim0.topHandSide - ctrlSwept.topHandSide);
console.log('  topHand delta aim0 vs aim90 = ' + topHandAimDelta.toFixed(3) + (topHandAimDelta < 0.01 ? '  ✓ locked' : '  ✗ drifts'));

// Check bottomHand: should always be on shaft, not body-relative
console.log('\nBottomHand shaft alignment (should lie on topHand→bladeBase vector):');
for (const mode of ['control', 'charge']) {
  for (const q of (mode === 'charge' ? [0, 0.5, 1.0] : [0])) {
    const rig = computeRig({ playerRadius: R, mode, shotCharge: q, aimAngle: 0, bodyAngle: 0 });
    const spanFwd = rig.bladeBaseFwd - rig.topHandFwd;
    const spanSide = rig.bladeBaseSide - rig.topHandSide;
    const spanLen = Math.hypot(spanFwd, spanSide);
    const toBot = { fwd: rig.bottomHandFwd - rig.topHandFwd, side: rig.bottomHandSide - rig.topHandSide };
    const toBotLen = Math.hypot(toBot.fwd, toBot.side);
    // dot product / lengths = cos(angle)
    const cos = spanLen > 0.001 && toBotLen > 0.001
      ? (spanFwd * toBot.fwd + spanSide * toBot.side) / (spanLen * toBotLen) : 1;
    const angleDegVal = (Math.acos(Math.min(1, Math.abs(cos))) * 180 / Math.PI).toFixed(2);
    const gripRatio = toBotLen / spanLen;
    console.log(`  ${mode} q=${q.toFixed(1)}: gripRatio=${gripRatio.toFixed(3)}  shaft-alignment angle=${angleDegVal}° ${parseFloat(angleDegVal) < 1 ? '✓' : '✗ misaligned'}`);
  }
}
