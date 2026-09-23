"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { useSondeo } from "@/hooks/use-sondeo";
import type { AparienciaTopbar } from "@/components/dashboard/topbar-rediseno/apariencia";
import c from "@/components/dashboard/topbar-rediseno/piezas-topbar.module.css";

/**
 * WaitingRoomAlert — pill que el dashboard layout/topbar puede renderizar
 * para roles RECEPTIONIST/ADMIN. Pregunta a /api/analytics/waiting-room
 * con `?solo=alerta` —un conteo, no el reporte de 30 días con mapa de calor
 * que pedía antes para quedarse con `longWaits.length`— cada 60 s, solo
 * con la pestaña visible (useSondeo), y muestra "X pacientes esperan >Y min"
 * si hay esperas largas. Se queda en 60 s a propósito: cuando recepción pasa
 * al paciente al sillón, la pastilla tiene que irse tan rápido como hoy.
 *
 * Multi-tenant: el endpoint usa getCurrentUser().clinicId, así que el
 * cliente solo recibe data de su propia clínica.
 *
 * Renderizado condicional: si longWaits.length === 0, devuelve null.
 *
 * `apariencia`: la ropa (topbar-rediseno/apariencia.ts). Sin ella —la barra
 * de siempre— la pastilla es EXACTAMENTE la de antes; con "nueva" —la barra
 * del menú de dos niveles— se pinta con las clases del rediseño.
 */
export function WaitingRoomAlert({ apariencia }: { apariencia?: AparienciaTopbar }) {
  const t = useT();
  const [count, setCount] = useState(0);
  const [threshold, setThreshold] = useState(20);

  const cancelado = useRef(false);
  useEffect(() => {
    cancelado.current = false;
    return () => { cancelado.current = true; };
  }, []);
  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/waiting-room?solo=alerta", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (cancelado.current) return;
      // `longWaits` por si responde una instancia de antes del cambio
      // (durante un despliegue): sin esto la pastilla se quedaba en 0.
      setCount(
        Number(data.longWaitsCount ?? (Array.isArray(data.longWaits) ? data.longWaits.length : 0)) || 0,
      );
      setThreshold(data.threshold ?? 20);
    } catch {/* silent */}
  }, []);
  useSondeo(fetchAlerts, 60_000);

  if (count === 0) return null;

  if (apariencia === "nueva") {
    return (
      <Link
        href="/dashboard/analytics/waiting-room"
        className={c.alerta}
        title={t("shell.waitingRoomAlert.tooltip", { count, threshold })}
      >
        <AlertTriangle size={13} aria-hidden />
        {t("shell.waitingRoomAlert.pill", { count, threshold })}
      </Link>
    );
  }

  return (
    <Link
      href="/dashboard/analytics/waiting-room"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 11px",
        background: "rgba(220, 38, 38, 0.12)",
        border: "1px solid rgba(220, 38, 38, 0.30)",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        color: "#dc2626",
        textDecoration: "none",
        animation: "wrPulse 1.6s ease-in-out infinite",
      }}
      title={t("shell.waitingRoomAlert.tooltip", { count, threshold })}
    >
      <AlertTriangle size={13} aria-hidden />
      {t("shell.waitingRoomAlert.pill", { count, threshold })}
      <style>{`
        @keyframes wrPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.20); }
          50%      { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0); }
        }
      `}</style>
    </Link>
  );
}
