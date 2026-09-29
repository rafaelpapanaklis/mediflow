"use client";

import { useEffect, useState } from "react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { formatDate } from "@/lib/utils";
import { etiquetaDeVisita, notaSinResultado } from "@/lib/import/dentalink/citas";

/**
 * "Citas anteriores (migradas)" — ws1-t12. Historial de citas YA pasadas
 * del sistema anterior (atendida/no asistió/cancelada/reagendada/sin registro
 * de asistencia — ws1-t10): de SOLO LECTURA,
 * no genera acciones (nada de agendar, reagendar ni recordatorios). Se
 * autoabastece de /api/patients/[id]/migrated-visits — mismo criterio que
 * PagosMigradosCard, para no tocar la consulta SSR de la ficha.
 *
 * Se oculta por completo si no hay nada que migrar o si la petición falla.
 */

const ESTADO_TONE: Record<string, "success" | "warning" | "neutral"> = {
  COMPLETED: "success",
  NO_SHOW: "warning",
  CANCELLED: "neutral",
  PENDING: "neutral",
};

interface VisitaMigrada {
  id: string;
  startsAt: string;
  status: "COMPLETED" | "NO_SHOW" | "CANCELLED" | "PENDING";
  type: string | null;
  notes: string | null;
  doctorName: string | null;
  origin: string;
}

export function CitasMigradasCard({ patientId }: { patientId: string }) {
  const [visitas, setVisitas] = useState<VisitaMigrada[] | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/patients/${patientId}/migrated-visits`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (vivo) setVisitas(data?.visits ?? []); })
      .catch(() => { if (vivo) setVisitas([]); });
    return () => { vivo = false; };
  }, [patientId]);

  if (!visitas || visitas.length === 0) return null;

  return (
    <CardNew noPad title="Citas anteriores (migradas)">
      <div style={{ padding: "4px 0" }}>
        {visitas.map((v) => (
          <div
            key={v.id}
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
              <div className="mono" style={{ color: "var(--text-2)" }}>{formatDate(v.startsAt)}</div>
              <div style={{ color: "var(--text-3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {[v.type, v.doctorName ? `Dr/a. ${v.doctorName}` : null].filter(Boolean).join(" · ") || "Sin detalle"}
              </div>
              {notaSinResultado(v.notes) ? (
                <div
                  title={notaSinResultado(v.notes)}
                  style={{ color: "var(--text-3)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {notaSinResultado(v.notes).replace(/\n/g, " · ")}
                </div>
              ) : null}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <BadgeNew tone={ESTADO_TONE[v.status] ?? "neutral"}>{etiquetaDeVisita(v.status, v.notes)}</BadgeNew>
              <BadgeNew tone="neutral">Migrado de {v.origin}</BadgeNew>
            </div>
          </div>
        ))}
      </div>
    </CardNew>
  );
}
