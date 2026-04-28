"use client";

import { useEffect, useState } from "react";
import { Clock, User } from "lucide-react";

interface QueueItem {
  appointmentId: string;
  patient: string;
  initials: string;
  type: string;
  doctor: string;
  status: string;
  waitedMin: number | null;
  startsAt: string;
}

interface ApiResponse {
  now: string;
  inProgress: QueueItem[];
  upNext: QueueItem[];
  waiting: QueueItem[];
}

interface Props {
  clinicId: string;
  clinicName: string;
  clinicLogo: string | null;
  config: Record<string, unknown>;
}

/**
 * TvOperationalView — pantalla de sala de espera con turnos en tiempo real.
 * Pollea /api/tv/[slug]/operational cada 15s para datos frescos.
 * Reusa clinicId desde props (derivado del TV display row, no del user).
 */
export function TvOperationalView({ clinicName, clinicLogo, clinicId }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        // El endpoint usa el publicSlug del path para resolver clinicId
        // server-side, no confía en el query param. clinicId se pasa
        // solo para hint del cliente (no es secret pero defensivo).
        const slug = window.location.pathname.split("/").pop() ?? "";
        const res = await fetch(`/api/tv/${slug}/operational`, { cache: "no-store" });
        if (!res.ok) return;
        const j = await res.json();
        if (!cancelled) setData(j as ApiResponse);
      } catch {/* silent */}
    };
    fetchData();
    const id = setInterval(fetchData, 15_000);
    const clockId = setInterval(() => setNow(new Date()), 1000);
    return () => { cancelled = true; clearInterval(id); clearInterval(clockId); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #0F1A2E 0%, #1a2f4f 100%)",
        color: "#fff",
        fontFamily: "var(--font-sora, 'Sora', sans-serif)",
        padding: "32px 40px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {clinicLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={clinicLogo} alt={clinicName} style={{ height: 56, borderRadius: 12 }} />
          )}
          <div>
            <h1 style={{ fontSize: 36, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>{clinicName}</h1>
            <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", marginTop: 4 }}>
              Turnos en tiempo real
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 56, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.04em", lineHeight: 1 }}>
            {now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", textTransform: "capitalize", marginTop: 6 }}>
            {now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
          </div>
        </div>
      </header>

      {data ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, flex: 1 }}>
          <Column title="EN CONSULTA" tone="success" items={data.inProgress} accent="🩺" />
          <Column title="EN SILLÓN" tone="info" items={data.upNext} accent="✨" />
          <Column title="EN SALA" tone="warning" items={data.waiting} accent="⏳" showWait />
        </div>
      ) : (
        <div style={{ flex: 1, display: "grid", placeItems: "center", color: "rgba(255,255,255,0.5)" }}>
          Cargando turnos…
        </div>
      )}
    </div>
  );
}

function Column({ title, items, tone, accent, showWait }: {
  title: string;
  items: QueueItem[];
  tone: "success" | "info" | "warning";
  accent: string;
  showWait?: boolean;
}) {
  const colors = {
    success: { bg: "rgba(16, 185, 129, 0.10)", border: "rgba(16, 185, 129, 0.30)", fg: "#10b981" },
    info:    { bg: "rgba(124, 58, 237, 0.12)", border: "rgba(124, 58, 237, 0.30)", fg: "#a78bfa" },
    warning: { bg: "rgba(217, 119, 6, 0.12)",  border: "rgba(217, 119, 6, 0.30)",  fg: "#f59e0b" },
  }[tone];

  return (
    <div style={{
      background: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 14,
      padding: 20,
      display: "flex",
      flexDirection: "column",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ fontSize: 14, fontWeight: 700, color: colors.fg, letterSpacing: "0.08em", margin: 0 }}>
          {accent} {title}
        </h2>
        <span style={{ fontSize: 24, fontWeight: 700, color: colors.fg, fontVariantNumeric: "tabular-nums" }}>
          {items.length}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, overflowY: "auto" }}>
        {items.length === 0 ? (
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, textAlign: "center", padding: 20 }}>
            Sin pacientes
          </div>
        ) : (
          items.slice(0, 8).map((item) => (
            <div
              key={item.appointmentId}
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.10)",
                borderRadius: 10,
                padding: "12px 14px",
                display: "flex",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: colors.fg + "22", color: colors.fg,
                display: "grid", placeItems: "center",
                fontSize: 14, fontWeight: 700,
                flexShrink: 0,
              }}>
                {item.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {item.patient}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>
                  {item.type} · {item.doctor}
                </div>
              </div>
              {showWait && item.waitedMin != null && (
                <div style={{
                  fontSize: 18, fontWeight: 700, color: item.waitedMin > 20 ? "#dc2626" : colors.fg,
                  fontFamily: "var(--font-jetbrains-mono, monospace)",
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {item.waitedMin}m
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
