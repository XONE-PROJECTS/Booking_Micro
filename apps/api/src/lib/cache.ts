/** Small in-process TTL cache. Values are per-instance; callers invalidate on writes they make. */
export class TtlCache<V> {
  private readonly store = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 5000,
  ) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  deleteWhere(predicate: (key: string) => boolean): void {
    for (const k of this.store.keys()) if (predicate(k)) this.store.delete(k);
  }

  clear(): void {
    this.store.clear();
  }
}
