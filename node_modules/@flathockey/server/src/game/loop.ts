import { FIXED_DT, SIM_HZ } from '@flathockey/shared/constants/ticks';

export class FixedLoop {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private accumulatorMs = 0;
  private lastNowMs = 0;

  private readonly STEP_MS = 1000 / SIM_HZ;
  private readonly MAX_STEPS_PER_TICK = 3;
  private readonly HITCH_RESET_MS = 200;
  private readonly MAX_CARRY_MS = 1000 / SIM_HZ;

  constructor(
    private readonly step: (dt: number) => void,
    private readonly onFrame?: (frameDtMs: number) => void
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.accumulatorMs = 0;
    this.lastNowMs = performance.now();
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number) {
    this.timer = setTimeout(() => this.tick(), Math.max(0, delayMs));
  }

  private tick() {
    if (!this.running) return;

    const nowMs = performance.now();
    const frameDtMs = nowMs - this.lastNowMs;
    this.lastNowMs = nowMs;
    this.onFrame?.(frameDtMs);

    if (frameDtMs > this.HITCH_RESET_MS) {
      this.accumulatorMs = 0;
    } else {
      this.accumulatorMs += frameDtMs;
    }

    let steps = 0;
    while (this.accumulatorMs >= this.STEP_MS && steps < this.MAX_STEPS_PER_TICK) {
      this.step(FIXED_DT);
      this.accumulatorMs -= this.STEP_MS;
      steps += 1;
    }

    if (this.accumulatorMs >= this.STEP_MS) {
      this.accumulatorMs = Math.min(this.accumulatorMs, this.MAX_CARRY_MS);
    }

    const nextDelayMs = this.STEP_MS - this.accumulatorMs;
    this.schedule(nextDelayMs);
  }
}
