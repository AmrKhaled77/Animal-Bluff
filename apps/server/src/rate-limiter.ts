export class SlidingWindowRateLimiter {
  private readonly windows = new Map<
    string,
    { startsAt: number; count: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now = () => Date.now(),
  ) {}

  consume(key: string): boolean {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || now - window.startsAt >= this.windowMs) {
      window = { startsAt: now, count: 0 };
      this.windows.set(key, window);
    }
    window.count++;

    if (this.windows.size > 10_000) {
      for (const [entry, current] of this.windows)
        if (now - current.startsAt >= this.windowMs) this.windows.delete(entry);
    }

    return window.count <= this.limit;
  }
}
