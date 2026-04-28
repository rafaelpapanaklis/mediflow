"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

/**
 * WaitingRoomAlert — pill que el dashboard layout/topbar puede renderizar
 * para roles RECEPTIONIST/ADMIN. Pollea /api/analytics/waiting-room cada
 * 60s con visibility pause y muestra "X pacientes esperan >Y min" si
 * detecta long waits activos.
 *
 * Multi-tenant: el endpoint usa getCurrentUser().clinicId, así que el
 * cliente solo recibe data de su propia clínica.
 *
 * Renderizado condicional: si longWaits.length === 0, devuelve null.
 */
export function WaitingRoomAlert() {
  const [count, setCount] = useState(0);
  const [threshold, setThreshold] = useState(20);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchAlerts = async () => {
      try {
        const res = await fetch("/api/analytics/waiting-room", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setCount(Array.isArray(data.longWaits) ? data.longWaits.length : 0);
        setThreshold(data.threshold ?? 20);
      } catch {/* silent */}
    };

    const start = () => {
      if (interval !== null) return;
      interval = setInterval(fetchAlerts, 60_000);
    };
    const stop = () => {
      if (interval !== null) { clearInterval(interval); interval = null; }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") { fetchAlerts(); start(); }
      else stop();
    };

    fetchAlerts();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  if (count === 0) return null;

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
      title={`${count} paciente${count === 1 ? "" : "s"} esperando más de ${threshold} min — click para ver detalle`}
    >
      <AlertTriangle size={13} aria-hidden />
      {count} esperando &gt;{threshold}m
      <style>{`
        @keyframes wrPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.20); }
          50%      { box-shadow: 0 0 0 6px rgba(220, 38, 38, 0); }
        }
      `}</style>
    </Link>
  );
}
