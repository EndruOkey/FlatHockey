import { hasRequiredServerFeatures, NET_PROTOCOL_VERSION, type RuntimeEnvironment, sanitizeRuntimeEnvironment } from '@flathockey/shared';

const VALID_LOCOMOTION_STATES = new Set(['idle', 'driving', 'gliding', 'stopping', 'reorienting']);

type HandshakeLike = {
  type?: unknown;
  proto?: unknown;
  runtime?: unknown;
  serverBuild?: unknown;
  features?: unknown;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function serverBuildSuffix(serverBuild: unknown) {
  if (typeof serverBuild !== 'string' || serverBuild.length === 0) return '';
  return ` (server build ${serverBuild.slice(0, 12)})`;
}

export function getServerHandshakeMismatch(msg: HandshakeLike, expectedRuntime: RuntimeEnvironment) {
  if (msg.type !== 'welcome' && msg.type !== 'net:welcome' && msg.type !== 'join:ok') {
    return null;
  }

  const proto = isFiniteNumber(msg.proto) ? msg.proto : NaN;
  if (!Number.isFinite(proto)) {
    return 'server handshake is missing protocol version';
  }
  if (proto !== NET_PROTOCOL_VERSION) {
    return `server protocol ${proto} does not match client protocol ${NET_PROTOCOL_VERSION}${serverBuildSuffix(msg.serverBuild)}`;
  }

  const runtime = sanitizeRuntimeEnvironment(msg.runtime);
  if (runtime === 'unknown') {
    return `server handshake is missing runtime environment${serverBuildSuffix(msg.serverBuild)}`;
  }
  if (expectedRuntime !== 'unknown' && runtime !== expectedRuntime) {
    return `connected to ${runtime} backend, expected ${expectedRuntime}${serverBuildSuffix(msg.serverBuild)}`;
  }

  const features = Array.isArray(msg.features) ? msg.features.filter((feature): feature is string => typeof feature === 'string') : [];
  if (!hasRequiredServerFeatures(features)) {
    const featureList = features.length > 0 ? features.join(', ') : 'none';
    return `server is missing required features (${featureList})${serverBuildSuffix(msg.serverBuild)}`;
  }

  return null;
}

export function getSnapshotPlayerStateMismatch(player: unknown) {
  if (!player || typeof player !== 'object' || Array.isArray(player)) {
    return 'snapshot player payload is invalid';
  }

  const candidate = player as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return 'snapshot player is missing id';
  }
  if (
    !isFiniteNumber(candidate.x) ||
    !isFiniteNumber(candidate.y) ||
    !isFiniteNumber(candidate.vx) ||
    !isFiniteNumber(candidate.vy) ||
    !isFiniteNumber(candidate.angle) ||
    !isFiniteNumber(candidate.aimAngle) ||
    !isFiniteNumber(candidate.desiredHeading)
  ) {
    return `snapshot player ${candidate.id} is missing locomotion numbers`;
  }
  if (typeof candidate.locomotionState !== 'string' || !VALID_LOCOMOTION_STATES.has(candidate.locomotionState)) {
    return `snapshot player ${candidate.id} is missing locomotion state`;
  }

  return null;
}
