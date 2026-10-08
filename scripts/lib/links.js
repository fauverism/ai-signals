// Link liveness: does a URL answer a HEAD request with 2xx or 3xx within the timeout?
// 401, 403 and 429 also count as alive: the server answered, it just won't serve a bot (paywalls, Cloudflare challenges, rate limits).
const ALIVE_BOT_BLOCKS = new Set([401, 403, 429]);
export const LINK_TIMEOUT_MS = 5000;
const USER_AGENT = 'AI-Signal/0.1 (+https://github.com/fauverism/ai-signals; daily AI news aggregator)';

/**
 * 2xx and 3xx pass; redirects are not followed (the link answered, which is what we're asking).
 * A server that doesn't implement HEAD (405/501) isn't a dead link, so it gets one tiny GET instead.
 * The timeout covers both requests together.
 * @returns {Promise<{ ok: boolean, status: number|null, error?: string }>}
 */
export async function checkLink(url, { timeoutMs = LINK_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const attempt = async (method) => {
    const res = await fetchImpl(url, {
      method,
      redirect: 'manual',
      signal,
      headers: { 'user-agent': USER_AGENT, ...(method === 'GET' ? { range: 'bytes=0-0' } : {}) },
    });
    res.body?.cancel().catch(() => {}); // we only want the status line
    return res.status;
  };
  try {
    let status = await attempt('HEAD');
    if (status === 405 || status === 501) status = await attempt('GET');
    return (status >= 200 && status < 400) || ALIVE_BOT_BLOCKS.has(status) ? { ok: true, status } : { ok: false, status, error: `HTTP ${status}` };
  } catch (e) {
    return { ok: false, status: null, error: e.name === 'TimeoutError' || e.name === 'AbortError' ? `timed out after ${timeoutMs / 1000}s` : (e.cause?.code ?? e.message) };
  }
}

/** Checks many URLs with limited concurrency; results keep the input order. */
export async function checkLinks(urls, { concurrency = 6, ...options } = {}) {
  const results = new Array(urls.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
      while (next < urls.length) {
        const i = next++;
        results[i] = await checkLink(urls[i], options);
      }
    }),
  );
  return results;
}
