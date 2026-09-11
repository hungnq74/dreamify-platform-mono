import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';
type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'dreamify-theme';

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
  }
}

// ---------------------------------------------------------------------------
// Module-level singleton — ONE source of truth shared by all hook instances.
// Without this, every component that calls useTheme() holds independent React
// state. When Clerk triggers a re-render during auth transitions, any stale
// instance still holding `theme = 'dark'` fires applyTheme('dark') and
// overwrites the correct DOM state, causing the post-login dark-mode flash.
// ---------------------------------------------------------------------------
let moduleTheme: Theme = (() => {
  try {
    return (localStorage.getItem(STORAGE_KEY) as Theme) || 'light';
  } catch {
    return 'light';
  }
})();

const subscribers = new Set<() => void>();

function notifyAll() {
  subscribers.forEach(fn => fn());
}

// No module-load applyTheme() call here on purpose. The bootstrap script in
// app/layout.tsx runs the same resolution before first paint, and each hook
// instance re-applies on mount via the resolvedTheme effect below, so doing it
// again during import was redundant — and a side effect on import makes this
// module order-dependent. (The comment this replaces referenced an inline script
// in main.tsx, which no longer exists under the Next app.)

export function useTheme() {
  // forceUpdate is the only per-instance state — it triggers a re-render when
  // the shared moduleTheme changes so all consumers stay in sync.
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const notify = () => forceUpdate(n => n + 1);
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  const resolvedTheme: ResolvedTheme =
    moduleTheme === 'system' ? getSystemTheme() : moduleTheme;

  // Apply to DOM whenever the resolved theme changes (handles initial mount
  // and any subsequent changes from other instances).
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Track system preference changes when theme is 'system'.
  useEffect(() => {
    if (moduleTheme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      applyTheme(getSystemTheme());
      notifyAll();
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  function setTheme(next: Theme) {
    moduleTheme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage may be unavailable in restricted contexts
    }
    // Apply immediately — don't wait for React re-render cycle.
    applyTheme(next === 'system' ? getSystemTheme() : next);
    // Notify all hook instances so they re-render with the new theme.
    notifyAll();
  }

  return { theme: moduleTheme, setTheme, resolvedTheme };
}
