/** Clock provider: all time-dependent logic takes a Clock so tests travel in time (BUILD_PLAN §3). */
export interface Clock { now(): Date }

export class SystemClock implements Clock {
  now(): Date { return new Date(); }
}

/** FAKE for tests: a controllable clock. Never used in production wiring. */
export class FakeClock implements Clock {
  private current: Date;
  constructor(start: Date) { this.current = new Date(start); }
  now(): Date { return new Date(this.current); }
  set(to: Date): void { this.current = new Date(to); }
  advanceMs(ms: number): void { this.current = new Date(this.current.getTime() + ms); }
  advanceDays(days: number): void { this.advanceMs(days * 86_400_000); }
}
