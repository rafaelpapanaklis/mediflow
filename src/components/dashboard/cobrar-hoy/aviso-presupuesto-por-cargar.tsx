"use client";

// «Cobrar hoy» (ws1-t5, F10 de la auditoría del dinero): si el paciente tiene
// un presupuesto ACEPTADO con conceptos todavía sin cargar, lo dice antes de
// cobrar. Nada impedía cobrar el mismo tratamiento por el catálogo aquí Y
// después por el presupuesto: se cargaba dos veces. No bloquea (puede ser otro
// tratamiento); se calla si no hay nada pendiente o si la lectura falla.

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale } from "@/i18n/i18n-provider";
import { fmtMXNdec } from "@/lib/format";
import { presupuestosPorCargar, type PresupuestoPorCargar } from "@/lib/quotes/por-cargar";

export function AvisoPresupuestoPorCargar({ patientId }: { patientId: string }) {
  const en = useLocale().toLowerCase().startsWith("en");
  const [pendientes, setPendientes] = useState<PresupuestoPorCargar[]>([]);

  useEffect(() => {
    if (!patientId) return;
    let vivo = true;
    fetch(`/api/quotes?patientId=${encodeURIComponent(patientId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => { if (vivo) setPendientes(presupuestosPorCargar(d)); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [patientId]);

  if (pendientes.length === 0) return null;
  return (
    <div
      role="status"
      data-aviso-presupuesto-por-cargar
      style={{ display: "flex", gap: 8, alignItems: "flex-start", background: "var(--warning-soft)", border: "1px solid var(--warning-border-strong)", borderRadius: "var(--radius)", padding: "8px 10px", fontSize: 13, color: "var(--text-1)" }}
    >
      <AlertTriangle size={15} aria-hidden style={{ color: "var(--warning)", flexShrink: 0, marginTop: 2 }} />
      <span>
        {pendientes.map((p) => (
          <span key={p.id} style={{ display: "block" }}>
            {en
              ? `Accepted estimate ${p.folio} still has ${fmtMXNdec(p.porCargar)} not charged${p.conceptos.length ? ` (${p.conceptos.join(", ")})` : ""}.`
              : `El presupuesto ${p.folio} aceptado tiene ${fmtMXNdec(p.porCargar)} sin cargar${p.conceptos.length ? ` (${p.conceptos.join(", ")})` : ""}.`}
          </span>
        ))}
        <span style={{ display: "block", color: "var(--text-2)" }}>
          {en
            ? "If you are charging one of those treatments, charge it from the estimate so it isn't charged twice."
            : "Si vas a cobrar uno de esos tratamientos, cárgalo desde el presupuesto para no cobrarlo dos veces."}
        </span>
      </span>
    </div>
  );
}
