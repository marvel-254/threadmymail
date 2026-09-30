import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Unread counts for the rail.
 *
 * One request, not one per nav item. Six parallel calls on every view change
 * is six round trips to a Durable Object that is trying to hibernate, and the
 * numbers disagree with each other while they are in flight.
 */
export function useCounts(activeView) {
  const [counts, setCounts] = useState({});

  useEffect(() => {
    let alive = true;
    api.emails({ unread: true, limit: 1 })
      .then((res) => {
        if (!alive) return;
        const list = Array.isArray(res) ? res : res?.items || [];
        const total = res?.total ?? list.length;
        setCounts((p) => ({ ...p, inbox: total }));
      })
      .catch(() => {
        // NEEDS_CONNECTION is the normal state before Google is linked, not an
        // error worth showing a red badge for.
      });
    return () => {
      alive = false;
    };
  }, [activeView]);

  return counts;
}
