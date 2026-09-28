"use client";

import { useEffect, useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { fmtMXNdec } from "@/lib/format";
import { formatDate } from "@/lib/utils";

/**
 * "Plan de pagos a plazos (migrado)" — ws1-t6. El CALENDARIO de una deuda que
 * YA está contada (factura de saldo inicial o caso de ortodoncia migrado): de
 * SOLO LECTURA, no genera acciones (nada de "cobrar" ni editar). Se
 * autoabastece de /api/patients/[id]/migrated-installments para no tocar la
 * consulta SSR de la ficha (page.tsx) ni su árbol de props.
 *
 * Se oculta por completo si no hay nada que migrar o si la petición falla: es
 * información histórica, no debe interrumpir la ficha si algo sale mal.
 */

interface CuotaMigrada {
  id: string;
  installmentNumber: number;
  amount: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
  concept: string | null;
  planExternalId: string | null;
  origin: string;
}

const ESTADO: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  PAID: { label: "Pagada", tone: "success" },
  OVERDUE: { label: "Vencida", tone: "danger" },
  PENDING: { label: "Pendiente", tone: "warning" },
};

export function CuotasMigradasCard({ patientId }: { patientId: string }) {
  const [cuotas, setCuotas] = useState<CuotaMigrada[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/patients/${patientId}/migrated-installments`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (vivo) setCuotas(data?.installments ?? []); })
      .catch(() => { if (vivo) setCuotas([]); });
    return () => { vivo = false; };
  }, [patientId]);

  if (!cuotas || cuotas.length === 0) return null;

  const total = cuotas.reduce((a, c) => a + c.amount, 0);

  return (
    <CardNew noPad title="Plan de pagos a plazos (migrado)">
      <div style={{ padding: "4px 0" }}>
        {cuotas.map((c) => {
          const estado = ESTADO[c.status] ?? ESTADO.PENDING;
          return (
            <div
              key={c.id}
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
                <div className="mono" style={{ color: "var(--text-2)" }}>
                  Cuota {c.installmentNumber} · vence {formatDate(c.dueDate)}
                </div>
                <div style={{ color: "var(--text-3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[c.concept, c.planExternalId ? `Plan ${c.planExternalId}` : null].filter(Boolean).join(" · ") || "Sin detalle"}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <span className="mono" style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-1)", fontWeight: 600 }}>
                  {fmtMXNdec(c.amount)}
                </span>
                <BadgeNew tone={estado.tone}>{estado.label}</BadgeNew>
              </div>
            </div>
          );
        })}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "10px 20px",
            fontSize: 12,
            color: "var(--text-3)",
          }}
        >
          <span>Migrado de {cuotas[0].origin} · {cuotas.length} cuota{cuotas.length === 1 ? "" : "s"}</span>
          <span className="mono" style={{ fontWeight: 600 }}>Total: {fmtMXNdec(total)}</span>
        </div>
      </div>
    </CardNew>
  );
}
