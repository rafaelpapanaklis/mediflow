"use client";

/**
 * WS1-T5 (ajuste 3) — una fila de `HomeAdminAlert` en la tarjeta "Avisos" de
 * Hoy (rediseño). El rediseño de julio nunca montó esto: la API ya calculaba
 * los avisos (inventario bajo, por caducar, caducado, facturas vencidas…)
 * pero ninguna pantalla los pintaba (REPORTE-ws1-t2.md, punto 3c).
 */

import Link from "next/link";
import { AlertTriangle, AlertCircle, ChevronRight, Info, type LucideIcon } from "lucide-react";
import type { HomeAdminAlert } from "@/lib/home/types";

const ICONO: Record<HomeAdminAlert["tone"], LucideIcon> = {
  warning: AlertTriangle,
  danger:  AlertCircle,
  info:    Info,
};

const COLOR: Record<HomeAdminAlert["tone"], string> = {
  warning: "var(--warning-strong)",
  danger:  "var(--danger-strong)",
  info:    "var(--info-strong)",
};

const FONDO: Record<HomeAdminAlert["tone"], string> = {
  warning: "var(--warning-soft)",
  danger:  "var(--danger-soft)",
  info:    "var(--info-soft)",
};

export function FilaAviso({ alert }: { alert: HomeAdminAlert }) {
  const Icono = ICONO[alert.tone];

  const contenido = (
    <>
      <span style={{
        width: 28, height: 28, borderRadius: 8, background: FONDO[alert.tone],
        display: "grid", placeItems: "center", flexShrink: 0,
      }}>
        <Icono size={14} strokeWidth={1.75} style={{ color: COLOR[alert.tone] }} aria-hidden />
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>
        {alert.title}
      </span>
      {alert.href && <ChevronRight size={13} style={{ color: "var(--text-3)", flexShrink: 0 }} aria-hidden />}
    </>
  );

  const estiloFila: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 4px",
    textDecoration: "none", color: "inherit", borderBottom: "1px solid var(--border-soft)",
  };

  return alert.href
    ? <Link href={alert.href} style={estiloFila}>{contenido}</Link>
    : <div style={estiloFila}>{contenido}</div>;
}
