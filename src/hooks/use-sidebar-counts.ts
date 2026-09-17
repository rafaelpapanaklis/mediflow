"use client";
import { useEffect, useState } from "react";
import { isAbortError } from "@/lib/fetch-safe";

export interface SidebarCounts {
  messagesUnread: number;
  clinicalDrafts: number;
  xraysUnanalyzed: number;
  inboxUnread: number;
}

const ZERO: SidebarCounts = {
  messagesUnread: 0,
  clinicalDrafts: 0,
  xraysUnanalyzed: 0,
  inboxUnread: 0,
};

const REVALIDATE_MS = 60_000;

/**
 * Hook que lee contadores agregados del sidebar.
 * - Fetch inicial al montar.
 * - Revalida cada 60s, PERO solo mientras la pestaña está visible (mismo
 *   patrón que InsightsPopover/NotificationsPopover/WaitingRoomAlert): una
 *   pestaña de fondo no tiene por qué seguir preguntando cada minuto (ver
 *   ~/gerentes/salidas/MAPA-conexiones.md §6.1).
 * - Revalida al recuperar foco de ventana.
 * - Degradación limpia: si falla, counts = {0,0,0}.
 */
export function useSidebarCounts(): SidebarCounts {
  const [counts, setCounts] = useState<SidebarCounts>(ZERO);

  useEffect(() => {
    let cancelled = false;
    let ac: AbortController | null = null;
    let intervalId: number | null = null;

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
            inboxUnread: Number(data.inboxUnread ?? 0) | 0,
          });
        })
        .catch((err) => {
          if (cancelled || isAbortError(err)) return;
          setCounts(ZERO);
        });
    };

    const start = () => {
      if (intervalId === null) intervalId = window.setInterval(fetchCounts, REVALIDATE_MS);
    };
    const stop = () => {
      if (intervalId !== null) { window.clearInterval(intervalId); intervalId = null; }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { fetchCounts(); start(); }
      else stop();
    };
    const onFocus = () => fetchCounts();

    fetchCounts();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      ac?.abort();
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return counts;
}
