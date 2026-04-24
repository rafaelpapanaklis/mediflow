"use client";
import { useEffect, useState } from "react";

export interface SidebarCounts {
  messagesUnread: number;
  clinicalDrafts: number;
  xraysUnanalyzed: number;
}

const ZERO: SidebarCounts = {
  messagesUnread: 0,
  clinicalDrafts: 0,
  xraysUnanalyzed: 0,
};

const REVALIDATE_MS = 60_000;

/**
 * Hook que lee contadores agregados del sidebar.
 * - Fetch inicial al montar.
 * - Revalida cada 60s.
 * - Revalida al recuperar foco de ventana.
 * - Degradación limpia: si falla, counts = {0,0,0}.
 */
export function useSidebarCounts(): SidebarCounts {
  const [counts, setCounts] = useState<SidebarCounts>(ZERO);

  useEffect(() => {
    let cancelled = false;
    let ac: AbortController | null = null;

    const fetchCounts = () => {
      ac?.abort();
      ac = new AbortController();
      fetch("/api/dashboard/sidebar-counts", {
        signal: ac.signal,
        credentials: "include",
        headers: { Accept: "application/json" },
      })
        .then((r) => (r.ok ? r.json() : ZERO))
        .then((data: Partial<SidebarCounts>) => {
          if (cancelled) return;
          setCounts({
            messagesUnread: Number(data.messagesUnread ?? 0) | 0,
            clinicalDrafts: Number(data.clinicalDrafts ?? 0) | 0,
            xraysUnanalyzed: Number(data.xraysUnanalyzed ?? 0) | 0,
          });
        })
        .catch((err) => {
          if (cancelled || err?.name === "AbortError") return;
          setCounts(ZERO);
        });
    };

    fetchCounts();
    const intervalId = window.setInterval(fetchCounts, REVALIDATE_MS);
    const onFocus = () => fetchCounts();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      ac?.abort();
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return counts;
}
