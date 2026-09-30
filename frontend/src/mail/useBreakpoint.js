import { useEffect, useState } from 'react';

/**
 * Which of the three layout behaviours applies.
 *
 * Breakpoints match docs/design/silk_neomorphic_dark.md: 1280 is where all
 * three panes fit without the reading pane falling under its 560px minimum,
 * 768 is where the rail must go.
 *
 * `matchMedia`, not a resize listener. A resize listener fires continuously
 * while a window is being dragged, and each fire re-renders the whole shell.
 */
const QUERY = '(min-width: 1280px)';
const MID_QUERY = '(min-width: 768px)';

export function useBreakpoint() {
  const [bp, setBp] = useState(() => read());

  useEffect(() => {
    const wide = window.matchMedia(QUERY);
    const mid = window.matchMedia(MID_QUERY);
    const update = () => setBp(read());
    update();
    wide.addEventListener('change', update);
    mid.addEventListener('change', update);
    return () => {
      wide.removeEventListener('change', update);
      mid.removeEventListener('change', update);
    };
  }, []);

  return bp;
}

function read() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  if (window.matchMedia(QUERY).matches) return 'desktop';
  if (window.matchMedia(MID_QUERY).matches) return 'laptop';
  return 'mobile';
}
