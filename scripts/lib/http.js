// Polite HTTP client: timeout, per-host concurrency cap, one retry on 429/503, robots.txt for feeds.
export const USER_AGENT = 'AI-Signal/0.1 (+https://github.com/fauverism/ai-signals; daily AI news aggregator)';
const ROBOTS_TOKEN = 'ai-signal';

class Semaphore {
  constructor(max) {
    this.free = max;
    this.waiting = [];
  }
  async acquire() {
    if (this.free > 0) {
      this.free--;
      return;
    }
    await new Promise((resolve) => this.waiting.push(resolve));
  }
  release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.free++;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Parses robots.txt and returns a function (path) => allowed for our user agent. */
export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === 'allow', pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const group = groups.find((g) => g.agents.includes(ROBOTS_TOKEN)) ?? groups.find((g) => g.agents.includes('*'));
  const rules = (group?.rules ?? []).map((r) => ({
    allow: r.allow,
    length: r.pattern.length,
    re: new RegExp(`^${r.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`),
  }));
  return (path) => {
    let best = null;
    for (const r of rules) {
      if (!r.re.test(path)) continue;
      if (!best || r.length > best.length || (r.length === best.length && r.allow)) best = r;
    }
    return best ? best.allow : true;
  };
}

/**
 * @param {{ timeoutMs?: number, perHost?: number, globalMax?: number, fetchImpl?: typeof fetch }} [opts]
 */
export function createHttp({ timeoutMs = 10000, perHost = 3, globalMax = 12, fetchImpl = fetch } = {}) {
  const hostLimits = new Map();
  const globalLimit = new Semaphore(globalMax);
  const robotsCache = new Map();

  async function limited(url, fn) {
    const host = new URL(url).host;
    if (!hostLimits.has(host)) hostLimits.set(host, new Semaphore(perHost));
    const hostLimit = hostLimits.get(host);
    await hostLimit.acquire();
    await globalLimit.acquire();
    try {
      return await fn();
    } finally {
      globalLimit.release();
      hostLimit.release();
    }
  }

  async function once(url, headers) {
    const res = await fetchImpl(url, {
      headers: { 'user-agent': USER_AGENT, ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = res.status === 304 ? '' : await res.text();
    return { status: res.status, headers: res.headers, text };
  }

  /** GET with limits. Resolves for 200/304; throws HttpError for anything else. */
  async function get(url, { headers = {} } = {}) {
    return limited(url, async () => {
      let res = await once(url, headers);
      if (res.status === 429 || res.status === 503) {
        const wait = Math.min(Number(res.headers.get('retry-after')) || 3, 10);
        await sleep(wait * 1000);
        res = await once(url, headers);
      }
      if (res.status !== 200 && res.status !== 304) throw new HttpError(`HTTP ${res.status}`, res.status);
      return res;
    });
  }

  /** True if robots.txt allows our agent to fetch this URL. Fails open if robots.txt is unreachable. */
  async function robotsAllows(url) {
    const { origin, pathname, search } = new URL(url);
    if (!robotsCache.has(origin)) {
      robotsCache.set(
        origin,
        limited(`${origin}/robots.txt`, () => once(`${origin}/robots.txt`, {}))
          .then((r) => (r.status === 200 ? parseRobots(r.text) : () => true))
          .catch(() => () => true),
      );
    }
    return (await robotsCache.get(origin))(pathname + search);
  }

  return { get, robotsAllows };
}
