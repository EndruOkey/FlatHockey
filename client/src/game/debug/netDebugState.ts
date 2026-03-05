export type NetDebugMetrics = {
  pingMs: number;
  serverTick: number;
  snapshotRate: number;
  players: number;
  snapshotDelayMs: number;
  inputDelayMs: number;
  inputRate: number;
  pendingInputs: number;
  clientFps: number;
};

const DEFAULT_METRICS: NetDebugMetrics = {
  pingMs: -1,
  serverTick: 0,
  snapshotRate: 0,
  players: 0,
  snapshotDelayMs: 0,
  inputDelayMs: 0,
  inputRate: 0,
  pendingInputs: 0,
  clientFps: 0
};

let currentMetrics: NetDebugMetrics = { ...DEFAULT_METRICS };

export function setNetDebugMetrics(next: Partial<NetDebugMetrics>) {
  currentMetrics = { ...currentMetrics, ...next };
}

export function getNetDebugMetrics(): NetDebugMetrics {
  return { ...currentMetrics };
}
