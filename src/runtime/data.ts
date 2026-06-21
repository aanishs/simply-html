// Browser-side data layer. localStorage is the instant local cache (and the only store
// locally / when --db is off). When deployed with --db on, writes also go through to the
// function's /data endpoint, and components can `pull()` the shared server value. ETag
// versions are tracked so writes carry a compare-and-swap precondition.

const NS = `simply-html:${location.pathname}`;
const versions = new Map<string, string>();

function cfg(): { base: string; token?: string; mode: string } | undefined {
  return window.__SIMPLY_HTML__;
}
function deployed(): boolean {
  return cfg()?.mode === "deployed";
}
function headers(json = false): Record<string, string> {
  const k = cfg();
  const h: Record<string, string> = {};
  if (json) h["content-type"] = "application/json";
  if (k?.token) h["authorization"] = `Bearer ${k.token}`;
  return h;
}

async function serverPut(key: string, value: unknown): Promise<void> {
  const k = cfg();
  if (!k) return;
  try {
    const r = await fetch(`${k.base}/data?key=${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: headers(true),
      body: JSON.stringify({ key, value, expectedVersion: versions.get(key) }),
    });
    const d = (await r.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
    if (r.ok && d?.ok && d.version) {
      versions.set(key, d.version);
    } else if (r.status === 409) {
      // Stale: refresh our version so the next write is based on the latest.
      const g = await fetch(`${k.base}/data?key=${encodeURIComponent(key)}`, { headers: headers() });
      const gd = (await g.json().catch(() => null)) as { ok?: boolean; version?: string } | null;
      if (g.ok && gd?.ok && gd.version) versions.set(key, gd.version);
    }
  } catch {
    /* offline: localStorage already holds the value; degrade silently */
  }
}

export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`${NS}:${key}`);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(`${NS}:${key}`, JSON.stringify(value));
    } catch {
      /* storage full/disabled: page stays readable */
    }
    if (deployed()) void serverPut(key, value);
  },
  /** Pull the shared server value (deployed + --db only). Returns undefined otherwise. */
  async pull<T>(key: string): Promise<T | undefined> {
    if (!deployed()) return undefined;
    const k = cfg();
    if (!k) return undefined;
    try {
      const r = await fetch(`${k.base}/data?key=${encodeURIComponent(key)}`, { headers: headers() });
      if (!r.ok) return undefined; // 404 = --db off or no value yet
      const d = (await r.json()) as { ok?: boolean; value?: T; version?: string };
      if (d.ok && d.version) {
        versions.set(key, d.version);
        try { localStorage.setItem(`${NS}:${key}`, JSON.stringify(d.value)); } catch { /* ignore */ }
        return d.value;
      }
    } catch {
      /* offline */
    }
    return undefined;
  },
};
