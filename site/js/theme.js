// Loaded in <head> so the saved theme is applied before first paint. Storage can throw (private windows,
// blocked cookies), so every access is wrapped; without it the page simply follows the system setting.
(() => {
  const KEY = 'ai-signal-theme';
  const root = document.documentElement;
  const dark = matchMedia('(prefers-color-scheme: dark)');

  const read = () => {
    try {
      const v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch {
      return null;
    }
  };
  const write = (v) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* not persisted */
    }
  };
  const effective = () => root.getAttribute('data-theme') ?? (dark.matches ? 'dark' : 'light');

  const saved = read();
  if (saved) root.setAttribute('data-theme', saved);

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    const sync = () => button.setAttribute('aria-pressed', String(effective() === 'dark'));
    sync();
    dark.addEventListener('change', sync);
    button.addEventListener('click', () => {
      const next = effective() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      write(next);
      sync();
    });
  });
})();
