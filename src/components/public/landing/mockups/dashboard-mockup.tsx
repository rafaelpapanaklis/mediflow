"use client";

import { useEffect, useState } from "react";
import { Logo } from "../primitives/logo";

/** Mini dashboard mockup (agenda + sidebar). Usado en hero de homepage. */
export function DashboardMockup({ scale = 1, animate = true }: { scale?: number; animate?: boolean }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!animate) return;
    const id = setInterval(() => setTick(t => t + 1), 2600);
    return () => clearInterval(id);
  }, [animate]);

  const hours = ["9:00", "10:00", "11:00", "12:00", "13:00", "14:00"];
  const days  = ["L", "M", "X", "J", "V"];
  const events: Array<{ day: number; hour: number; dur: number; label: string; type: "consult" | "dental" | "nutri" }> = [
    { day: 0, hour: 0, dur: 1,   label: "Consulta · M. Ramírez", type: "consult" },
    { day: 1, hour: 2, dur: 1.5, label: "Limpieza · J. López",   type: "dental"  },
    { day: 2, hour: 1, dur: 1,   label: "Control · A. Pérez",    type: "consult" },
    { day: 3, hour: 3, dur: 2,   label: "Endodoncia · C. Silva", type: "dental"  },
    { day: 4, hour: 0, dur: 1,   label: "Revisión",              type: "consult" },
    { day: 2, hour: 4, dur: 1,   label: "Nutrición · E. Díaz",   type: "nutri"   },
  ];
  const eventColor: Record<string, string> = {
    consult: "124,58,237",
    dental:  "52,211,153",
    nutri:   "251,191,36",
  };

  const navItems: Array<[string, boolean, string]> = [
    ["Agenda",       true,  "📅"],
    ["Pacientes",    false, "👥"],
    ["Expedientes",  false, "📋"],
    ["Facturación",  false, "🧾"],
    ["Inventario",   false, "📦"],
    ["Radiografías", false, "🩻"],
    ["Reportes",     false, "📊"],
  ];

  const stats: Array<[string, string, string, string]> = [
    ["Citas hoy",         "24",     "+3",   "#7c3aed"],
    ["Pacientes activos", "1,248",  "+12",  "#34d399"],
    ["Ingresos mes",      "$184K",  "+18%", "#fbbf24"],
    ["Ocupación",         "87%",    "+4%",  "#38bdf8"],
  ];

  return (
    <div style={{
      transform: `scale(${scale})`,
      transformOrigin: "top left",
      width: 960,
      height: 560,
      background: "var(--ld-app-bg, #0c0c12)",
      display: "grid",
      gridTemplateColumns: "200px 1fr",
      fontSize: 12,
      color: "var(--ld-fg, #f5f5f7)",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* Sidebar */}
      <div style={{
        borderRight: "1px solid var(--ld-app-border, rgba(255,255,255,0.06))",
        padding: "18px 12px",
        background: "var(--ld-app-sidebar, #0a0a10)",
        position: "relative",
      }}>
        <div style={{ padding: "6px 8px", marginBottom: 18 }}>
          <Logo size={16} color="var(--ld-brand, #7c3aed)" />
        </div>
        {navItems.map(([label, active, icon]) => (
          <div key={label} style={{
            padding: "7px 10px",
            borderRadius: 6,
            marginBottom: 2,
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: active ? "var(--ld-app-active, rgba(124,58,237,0.15))" : "transparent",
            color:      active ? "var(--ld-fg, #f5f5f7)"                       : "var(--ld-fg-muted, rgba(245,245,247,0.65))",
            fontSize: 11.5,
            fontWeight: active ? 500 : 400,
          }}>
            <span style={{ fontSize: 10, opacity: 0.7 }}>{icon}</span>
            {label}
          </div>
        ))}
        <div style={{
          position: "absolute",
          bottom: 14,
          left: 14,
          right: 14,
          padding: 10,
          borderRadius: 8,
          border: "1px solid var(--ld-app-border, rgba(255,255,255,0.06))",
          background: "var(--ld-app-sidebar, #0a0a10)",
        }}>
          <div style={{ fontSize: 10, color: "var(--ld-fg-muted, rgba(245,245,247,0.65))", marginBottom: 4 }}>Plan PRO</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 22, height: 22, borderRadius: 22, background: "linear-gradient(135deg, #a78bfa, #7c3aed)" }} />
            <div>
              <div style={{ fontSize: 11, fontWeight: 500 }}>Dra. Morales</div>
              <div style={{ fontSize: 10, color: "var(--ld-fg-muted, rgba(245,245,247,0.65))" }}>Clínica Vida</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ padding: "18px 22px", position: "relative", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ fontFamily: "var(--font-sora, 'Sora', sans-serif)", fontWeight: 600, fontSize: 18, letterSpacing: "-0.01em" }}>Agenda</div>
            <div style={{ color: "var(--ld-fg-muted)", fontSize: 11, marginTop: 2 }}>Semana del 20 — 24 abril, 2026</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--ld-app-border)", fontSize: 11, color: "var(--ld-fg-muted)" }}>Hoy</div>
            <div style={{ padding: "5px 10px", borderRadius: 6, background: "var(--ld-brand)", color: "#fff", fontSize: 11, fontWeight: 500 }}>+ Nueva cita</div>
          </div>
        </div>

        {/* Stat cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
          {stats.map(([l, v, d, c]) => (
            <div key={l} style={{
              padding: 10,
              borderRadius: 8,
              border: "1px solid var(--ld-app-border)",
              background: "var(--ld-app-card)",
            }}>
              <div style={{ fontSize: 10, color: "var(--ld-fg-muted)" }}>{l}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
                <div style={{ fontFamily: "var(--font-sora, 'Sora', sans-serif)", fontWeight: 600, fontSize: 20 }}>{v}</div>
                <div style={{ fontSize: 10, color: c, fontWeight: 500 }}>{d}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "40px repeat(5, 1fr)",
          border: "1px solid var(--ld-app-border)",
          borderRadius: 10,
          background: "var(--ld-app-card)",
          overflow: "hidden",
        }}>
          <div />
          {days.map(d => (
            <div key={d} style={{
              padding: "8px 10px",
              fontSize: 10,
              color: "var(--ld-fg-muted)",
              borderBottom: "1px solid var(--ld-app-border)",
              borderLeft:   "1px solid var(--ld-app-border)",
              fontWeight: 500,
            }}>{d}</div>
          ))}
          {hours.map((h, hi) => (
            <div key={h} style={{ display: "contents" }}>
              <div style={{
                fontSize: 9,
                color: "var(--ld-fg-muted)",
                padding: "6px 4px 0",
                borderBottom: hi < hours.length - 1 ? "1px solid var(--ld-app-border)" : "none",
                textAlign: "right",
              }}>{h}</div>
              {days.map((_, di) => {
                const ev = events.find(e => e.day === di && e.hour === hi);
                const idx = events.findIndex(e => e.day === di && e.hour === hi);
                const isHover = idx >= 0 && tick % 6 === idx;
                return (
                  <div key={di} style={{
                    height: 44,
                    position: "relative",
                    borderLeft:   "1px solid var(--ld-app-border)",
                    borderBottom: hi < hours.length - 1 ? "1px solid var(--ld-app-border)" : "none",
                  }}>
                    {ev && (
                      <div style={{
                        position: "absolute",
                        inset: "3px 4px",
                        height: ev.dur * 44 - 6,
                        borderRadius: 5,
                        background: `rgba(${eventColor[ev.type]},0.16)`,
                        border:     `1px solid rgba(${eventColor[ev.type]},0.4)`,
                        padding: "4px 6px",
                        fontSize: 9.5,
                        color: "var(--ld-fg)",
                        fontWeight: 500,
                        overflow: "hidden",
                        transform: isHover ? "scale(1.02)" : "scale(1)",
                        transition: "transform 0.3s",
                        boxShadow: isHover ? `0 8px 24px rgba(${eventColor[ev.type]},0.4)` : "none",
                      }}>{ev.label}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
