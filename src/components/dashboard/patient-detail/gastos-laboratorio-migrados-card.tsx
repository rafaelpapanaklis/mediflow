"use client";

import { useEffect, useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { fmtMXNdec } from "@/lib/format";
import { formatDate } from "@/lib/utils";

/**
 * "Gastos de laboratorio (migrados)" — ws1-t2. Historial de acciones de
 * laboratorio que YA se pagaron en el sistema anterior (Dentalink y
 * equivalentes): de SOLO LECTURA, no genera acciones (nada de "cobrar",
 * "timbrar" ni editar). El panel no tiene un módulo de costos de laboratorio
 * (LabOrder/LabPartner son flujo clínico de órdenes, sin campo de costo).
 * Se autoabastece de /api/patients/[id]/migrated-lab-expenses para no tocar
 * la consulta SSR de la ficha (page.tsx) ni su árbol de props, que hoy
 * mantienen varias pantallas a la vez.
 *
 * Se oculta por completo si no hay nada que migrar (clínica sin historial
 * importado) o si la petición falla: es información histórica, no debe
 * interrumpir la ficha si algo sale mal.
 */

interface GastoLaboratorioMigrado {
  id: string;
  labName: string | null;
  action: string;
  cost: number;
  patientPrice: number | null;
  doctorName: string | null;
  incurredAt: string;
  origin: string;
}

export function GastosLaboratorioMigradosCard({ patientId }: { patientId: string }) {
  const [gastos, setGastos] = useState<GastoLaboratorioMigrado[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/patients/${patientId}/migrated-lab-expenses`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (vivo) setGastos(data?.expenses ?? []); })
      .catch(() => { if (vivo) setGastos([]); });
    return () => { vivo = false; };
  }, [patientId]);

  if (!gastos || gastos.length === 0) return null;

  return (
    <CardNew noPad title="Gastos de laboratorio (migrados)">
      <div style={{ padding: "4px 0" }}>
        {gastos.map((g) => (
          <div
            key={g.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "10px 20px",
              borderBottom: "1px solid var(--border-soft, hsl(var(--border)))",
              fontSize: 13,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div className="mono" style={{ color: "var(--text-2)" }}>{formatDate(g.incurredAt)}</div>
              <div style={{ color: "var(--text-3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {[g.action, g.labName, g.doctorName ? `Dr/a. ${g.doctorName}` : null].filter(Boolean).join(" · ") || "Sin detalle"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span className="mono" style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-1)", fontWeight: 600 }}>
                {fmtMXNdec(g.cost)}
              </span>
              <BadgeNew tone="neutral">Migrado de {g.origin}</BadgeNew>
            </div>
          </div>
        ))}
      </div>
    </CardNew>
  );
}
