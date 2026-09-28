"use client";

import { useEffect, useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { fmtMXNdec } from "@/lib/format";
import { formatDate } from "@/lib/utils";

/**
 * "Casos de ortodoncia (migrados)" — ws1-t1. Caso YA ABIERTO en un sistema
 * anterior (Dentalink y equivalentes): de SOLO LECTURA, no genera acciones
 * (nada de "abrir caso", "cobrar" ni editar). NO es el caso clínico vivo del
 * módulo (ese exige un diagnóstico real, con examen clínico, que este
 * registro no tiene — ver MigratedOrthoCase en prisma/schema.prisma).
 * Se autoabastece de /api/patients/[id]/migrated-ortho-cases para no tocar
 * loadOrthoData ni el árbol de props de OrthodonticsClient, que varias
 * pantallas mantienen a la vez.
 *
 * Se oculta por completo si no hay nada migrado o si la petición falla: es
 * información histórica, no debe interrumpir la ficha si algo sale mal.
 */

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Activo",
  COMPLETED: "Terminado",
  ON_HOLD: "En pausa",
  DROPPED_OUT: "Abandonado",
  UNKNOWN: "Sin clasificar",
};

interface CasoMigrado {
  id: string;
  technique: string | null;
  treatingDoctorName: string | null;
  status: string;
  statusRaw: string | null;
  installedAt: string | null;
  estimatedDurationMonths: number | null;
  totalAmount: number | null;
  originInvoiceFolio: string | null;
  origin: string;
}

export function MigratedOrthoCasesCard({ patientId }: { patientId: string }) {
  const [casos, setCasos] = useState<CasoMigrado[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/patients/${patientId}/migrated-ortho-cases`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (vivo) setCasos(data?.cases ?? []); })
      .catch(() => { if (vivo) setCasos([]); });
    return () => { vivo = false; };
  }, [patientId]);

  if (!casos || casos.length === 0) return null;

  return (
    <CardNew noPad title="Casos de ortodoncia (migrados)">
      <div style={{ padding: "10px 20px 4px", fontSize: 12, color: "var(--text-3)" }}>
        Historia del sistema anterior. Falta el examen clínico para activarlo como caso vivo en el
        tablero de Ortodoncia — puedes abrir uno nuevo arriba con estos mismos datos como punto de partida.
      </div>
      <div style={{ padding: "4px 0" }}>
        {casos.map((c) => (
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
                {c.installedAt ? formatDate(c.installedAt) : "Sin fecha de colocación"}
              </div>
              <div style={{ color: "var(--text-3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {[
                  c.technique,
                  c.treatingDoctorName ? `Dr/a. ${c.treatingDoctorName}` : null,
                  c.estimatedDurationMonths ? `${c.estimatedDurationMonths} meses` : null,
                  c.statusRaw ?? STATUS_LABEL[c.status],
                ].filter(Boolean).join(" · ") || "Sin detalle"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              {c.totalAmount != null ? (
                <span className="mono" style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-1)", fontWeight: 600 }}>
                  {fmtMXNdec(c.totalAmount)}
                </span>
              ) : null}
              <BadgeNew tone="neutral">Migrado de {c.origin}</BadgeNew>
            </div>
          </div>
        ))}
      </div>
    </CardNew>
  );
}
