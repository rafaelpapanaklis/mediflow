"use client";

import React, { useState } from "react";
import {
  GenericAgenda,
  GenericPacientes,
  GenericFacturacion,
  GenericReportes,
} from "./generic-views";

// Shared visual utilities (exported so specialty-mock files can reuse them)
export const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div
    style={{
      fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      fontWeight: 600,
      fontSize: 15,
      letterSpacing: "-0.01em",
      color: "var(--fg)",
    }}
  >
    {children}
  </div>
);

export const Tag: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = "#a78bfa",
}) => (
  <span
    style={{
      display: "inline-flex",
      padding: "2px 8px",
      borderRadius: 100,
      fontSize: 10,
      color,
      background: color + "18",
      border: `1px solid ${color}33`,
      fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
    }}
  >
    {children}
  </span>
);

export const Row: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({
  children,
  style = {},
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, ...style }}>{children}</div>
);

export const Dot: React.FC<{ c?: string }> = ({ c = "#a78bfa" }) => (
  <div
    style={{
      width: 8,
      height: 8,
      borderRadius: 8,
      background: c,
      boxShadow: `0 0 8px ${c}80`,
    }}
  />
);

const PreviewBadge = () => (
  <div
    style={{
      position: "absolute",
      top: 10,
      right: 10,
      zIndex: 5,
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 9px",
      borderRadius: 100,
      background: "rgba(124,58,237,0.18)",
      border: "1px solid rgba(124,58,237,0.4)",
      fontSize: 10,
      color: "#c4b5fd",
      fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
      letterSpacing: "0.05em",
      backdropFilter: "blur(8px)",
    }}
  >
    <span
      style={{
        width: 5,
        height: 5,
        borderRadius: 5,
        background: "#a78bfa",
        boxShadow: "0 0 8px #a78bfa",
      }}
    />
    VISTA PREVIA
  </div>
);

const MiniLogo: React.FC<{ color: string }> = ({ color }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "var(--font-sora, 'Sora', sans-serif)",
      fontWeight: 700,
      fontSize: 13,
      letterSpacing: "-0.02em",
      color: "var(--fg)",
    }}
  >
    <span
      style={{
        width: 14,
        height: 14,
        borderRadius: 4,
        background: color,
        display: "inline-block",
        boxShadow: `0 0 10px ${color}55`,
      }}
    />
    MediFlow
  </div>
);

export interface MockShellProps {
  title: string;
  accent: string;
  children: React.ReactNode;
  sidebarActive?: string;
}

export const MockShell: React.FC<MockShellProps> = ({
  title,
  accent,
  children,
  sidebarActive = "Expedientes",
}) => {
  const [active, setActive] = useState(sidebarActive);
  const tabs = ["Agenda", "Pacientes", "Expedientes", "Facturación", "Reportes"];

  return (
    <div
      style={{
        width: 960,
        height: 560,
        background: "var(--app-bg)",
        display: "grid",
        gridTemplateColumns: "180px 1fr",
        fontSize: 12,
        color: "var(--fg)",
        fontFamily: "system-ui, sans-serif",
        position: "relative",
      }}
    >
      <PreviewBadge />
      <div
        style={{
          borderRight: "1px solid var(--app-border)",
          padding: "16px 10px",
          background: "var(--app-sidebar)",
        }}
      >
        <div style={{ padding: "4px 8px", marginBottom: 16 }}>
          <MiniLogo color={accent} />
        </div>
        {tabs.map((l) => (
          <div
            key={l}
            onClick={() => setActive(l)}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              marginBottom: 2,
              fontSize: 11.5,
              background: l === active ? accent + "22" : "transparent",
              color: l === active ? "var(--fg)" : "var(--fg-muted)",
              fontWeight: l === active ? 500 : 400,
              cursor: "pointer",
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (l !== active) e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            }}
            onMouseLeave={(e) => {
              if (l !== active) e.currentTarget.style.background = "transparent";
            }}
          >
            {l}
          </div>
        ))}
        <div
          style={{
            marginTop: 18,
            padding: "8px 10px",
            fontSize: 9.5,
            color: "var(--fg-muted)",
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
          }}
        >
          + 12 módulos más
        </div>
        {["Inventario", "Portal paciente", "Mensajes", "Integraciones"].map((l) => (
          <div
            key={l}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              marginBottom: 2,
              fontSize: 11,
              color: "rgba(245,245,247,0.35)",
              cursor: "not-allowed",
            }}
          >
            {l}
          </div>
        ))}
      </div>
      <div style={{ padding: "18px 22px", position: "relative", overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                fontWeight: 600,
                fontSize: 17,
                letterSpacing: "-0.01em",
              }}
            >
              {active === "Expedientes" ? title : active}
            </div>
            <div style={{ color: "var(--fg-muted)", fontSize: 11, marginTop: 2 }}>
              {active === "Expedientes"
                ? "Paciente · Ana Ramírez · 34 años"
                : active === "Agenda"
                ? "Semana · 22 – 26 abr"
                : active === "Pacientes"
                ? "1,284 pacientes activos"
                : active === "Facturación"
                ? "Abril 2026 · SAT sincronizado"
                : "Abril 2026 · vs. mes anterior"}
            </div>
          </div>
          <div
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              background: accent,
              color: "white",
              fontSize: 11,
              fontWeight: 500,
            }}
          >
            {active === "Facturación"
              ? "Timbrar"
              : active === "Pacientes"
              ? "+ Nuevo"
              : "Guardar"}
          </div>
        </div>
        {active === "Expedientes" && children}
        {active === "Agenda" && <GenericAgenda accent={accent} />}
        {active === "Pacientes" && <GenericPacientes accent={accent} />}
        {active === "Facturación" && <GenericFacturacion accent={accent} />}
        {active === "Reportes" && <GenericReportes accent={accent} />}
      </div>
    </div>
  );
};
