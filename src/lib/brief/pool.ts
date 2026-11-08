export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type Deadline = { remaining(): number; expired(): boolean };

export function deadline(budgetMs: number, now: () => number = Date.now): Deadline {
  const end = now() + budgetMs;
  return { remaining: () => Math.max(0, end - now()), expired: () => now() >= end };
}

/** Resolves to `fallback` if `p` has not settled within `ms`; `p` keeps running but its result is ignored. */
export function within<T, F>(p: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<F>((resolve) => (timer = setTimeout(() => resolve(fallback), ms)));
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
