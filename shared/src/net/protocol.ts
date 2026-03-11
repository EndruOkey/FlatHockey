export const NET_PROTOCOL_VERSION = 3;

export const SERVER_FEATURES = [
  'player-state-v2',
  'locomotion-v1',
  'puck-state-v1'
] as const;

export const REQUIRED_SERVER_FEATURES = [
  'player-state-v2',
  'locomotion-v1'
] as const;

export type ServerFeature = (typeof SERVER_FEATURES)[number];
export type RuntimeEnvironment = 'local' | 'dev' | 'prod' | 'unknown';

export function hasRequiredServerFeatures(features: readonly string[] | undefined) {
  if (!features || features.length === 0) return false;
  return REQUIRED_SERVER_FEATURES.every((feature) => features.includes(feature));
}

export function sanitizeRuntimeEnvironment(value: unknown): RuntimeEnvironment {
  if (value === 'local' || value === 'dev' || value === 'prod') return value;
  return 'unknown';
}
