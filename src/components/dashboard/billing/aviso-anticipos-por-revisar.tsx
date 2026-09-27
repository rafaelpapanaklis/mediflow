"use client";

// Aviso a recepción (ws1-t3 fase 1): anticipos del panel que quedaron
// marcados para revisar — pago tardío con el hueco ya perdido (fue a saldo a
// favor), factura cancelada o ya saldada, segundo pago del mismo anticipo…
// Nunca manda nada al paciente: es SOLO para el equipo. Se queda en silencio
// (sin pintar nada) si no hay ninguno o si la ruta todavía no existe.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

interface Item {
  depositId: string;
  paciente: string;
  monto: number;
  motivo: string;
  creado: string;
}

const fmt = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export function AvisoAnticiposPorRevisar() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/anticipos/por-revisar")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (vivo) setItems(Array.isArray(d?.items) ? d.items : []);
      })
      .catch(() => {
        if (vivo) setItems([]);
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: "12px 16px",
        marginBottom: 16,
        borderRadius: 10,
        border: "1px solid var(--warning-strong, #b45309)",
        background: "var(--warning-bg, #fffbeb)",
      }}
      role="alert"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, color: "var(--warning-strong, #b45309)" }}>
        <AlertTriangle size={18} strokeWidth={2} />
        {items.length === 1 ? "1 anticipo por revisar" : `${items.length} anticipos por revisar`}
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {items.slice(0, 5).map((it) => (
          <li key={it.depositId} style={{ fontSize: 13, color: "var(--text-2, #444)" }}>
            <strong>{it.paciente}</strong> — {fmt.format(it.monto)}: {it.motivo}
          </li>
        ))}
      </ul>
      {items.length > 5 && (
        <div style={{ fontSize: 12, color: "var(--text-3, #777)" }}>y {items.length - 5} más…</div>
      )}
    </div>
  );
}
