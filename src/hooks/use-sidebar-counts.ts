"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isAbortError } from "@/lib/fetch-safe";
import { useSondeo } from "@/hooks/use-sondeo";
import { conFresco, escucharCambioArmazon } from "@/lib/armazon/refrescar";

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
 * - Fetch inicial al montar y cada 60 s SOLO con la pestaña visible; al
 *   volver a ella, solo si lo último tiene más de 30 s (ver useSondeo).
 * - Cuando Mensajes cambia el estado de un hilo (leer, archivar, posponer,
 *   marcar no leído), recarga YA y con `?fresco=1`, así la insignia no se
 *   queda con el número de antes (ver @/lib/armazon/refrescar).
 * - Degradación limpia: si falla, counts = {0,0,0}.
 */
export function useSidebarCounts(): SidebarCounts {
  const [counts, setCounts] = useState<SidebarCounts>(ZERO);
  const ac = useRef<AbortController | null>(null);

  const fetchCounts = useCallback(async () => {
    ac.current?.abort();
    const ctrl = new AbortController();
    ac.current = ctrl;
    try {
      const r = await fetch(conFresco("/api/dashboard/sidebar-counts", "contadores"), {
        signal: ctrl.signal,
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const data: Partial<SidebarCounts> = r.ok ? await r.json() : ZERO;
      if (ctrl.signal.aborted) return;
      setCounts({
        messagesUnread: Number(data.messagesUnread ?? 0) | 0,
        clinicalDrafts: Number(data.clinicalDrafts ?? 0) | 0,
        xraysUnanalyzed: Number(data.xraysUnanalyzed ?? 0) | 0,
        inboxUnread: Number(data.inboxUnread ?? 0) | 0,
      });
    } catch (err) {
      if (ctrl.signal.aborted || isAbortError(err)) return;
      setCounts(ZERO);
    }
  }, []);

  const refrescar = useSondeo(fetchCounts, REVALIDATE_MS);

  useEffect(() => escucharCambioArmazon("contadores", refrescar), [refrescar]);
  useEffect(() => () => ac.current?.abort(), []);

  return counts;
}
