"use client";

import { useEffect, useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { fmtMXNdec } from "@/lib/format";
import { formatDate } from "@/lib/utils";

/**
 * "Pagos anteriores (migrados)" — ws1-t6. Historial de pagos que YA
 * ocurrieron en el sistema anterior (Dentalink y equivalentes): de SOLO
 * LECTURA, no genera acciones (nada de "cobrar", "timbrar" ni editar). Se
 * autoabastece de /api/patients/[id]/migrated-payments para no tocar la
 * consulta SSR de la ficha (page.tsx) ni su árbol de props, que hoy
 * mantienen varias pantallas a la vez.
 *
 * Se oculta por completo si no hay nada que migrar (clínica sin historial
 * importado) o si la petición falla: es información histórica, no debe
 * interrumpir la ficha si algo sale mal.
 */

interface PagoMigrado {
  id: string;
  amount: number;
  method: string | null;
  concept: string | null;
  doctorName: string | null;
  paidAt: string;
  origin: string;
}

export function PagosMigradosCard({ patientId }: { patientId: string }) {
  const [pagos, setPagos] = useState<PagoMigrado[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/patients/${patientId}/migrated-payments`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (vivo) setPagos(data?.payments ?? []); })
      .catch(() => { if (vivo) setPagos([]); });
    return () => { vivo = false; };
  }, [patientId]);

  if (!pagos || pagos.length === 0) return null;

  return (
    <CardNew noPad title="Pagos anteriores (migrados)">
      <div style={{ padding: "4px 0" }}>
        {pagos.map((p) => (
          <div
            key={p.id}
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
              <div className="mono" style={{ color: "var(--text-2)" }}>{formatDate(p.paidAt)}</div>
              <div style={{ color: "var(--text-3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {[p.concept, p.method, p.doctorName ? `Dr/a. ${p.doctorName}` : null].filter(Boolean).join(" · ") || "Sin detalle"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <span className="mono" style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-1)", fontWeight: 600 }}>
                {fmtMXNdec(p.amount)}
              </span>
              <BadgeNew tone="neutral">Migrado de {p.origin}</BadgeNew>
            </div>
          </div>
        ))}
      </div>
    </CardNew>
  );
}
