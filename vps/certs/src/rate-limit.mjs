// Fixed-window limit per client address, kept in memory (one container).
export class RateLimiter {
  constructor(max, windowMs, now = Date.now) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.hits = new Map();
  }

  allow(key) {
    const t = this.now();
    if (this.hits.size > 20000) {
      for (const [k, v] of this.hits) if (t >= v.resetAt) this.hits.delete(k);
    }
    const entry = this.hits.get(key);
    if (!entry || t >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }
}
