"use client";
// «Casos de ortodoncia (migrados)» en la pestaña Ortodoncia de la ficha NUEVA (expediente-rediseno).
// Es la misma información de solo lectura que `MigratedOrthoCasesCard` (pantalla vieja), con el diseño del
// expediente: mismas tarjetas y mismos tokens (--pr-*) que el resto de la pestaña. Historia del sistema anterior:
// no genera acciones (nada de abrir caso, cobrar ni editar).
// Se autoabastece de /api/patients/[id]/migrated-ortho-cases y se oculta si no hay nada o si la petición falla.
import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { fmtMXNdec } from "@/lib/format";
import { formatDate } from "@/lib/utils";
import { RAIZ_ORTO } from "./raiz";
import orto from "./orto.module.css";

const ESTADO: Record<string, string> = {
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
  origin: string;
}

/** `conLienzo`: la pestaña completa la monta sola; la vista sin caso ya vive dentro de su lienzo. */
export function CasosMigrados({ patientId, conLienzo = false }: { patientId: string; conLienzo?: boolean }) {
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

  const tarjeta = (
    <section className={orto.tarjeta} aria-labelledby="orto-migrados-titulo" data-casos-migrados>
      <div className={orto.tarjetaCabeza}>
        <span className={`${orto.tarjetaIcono} ${orto.tarjetaIconoNeutro}`} aria-hidden>
          <History size={15} strokeWidth={1.75} />
        </span>
        <div className={orto.tarjetaTextos}>
          <h2 id="orto-migrados-titulo" className={orto.tarjetaTitulo}>Casos de ortodoncia (migrados)</h2>
          <div className={orto.tarjetaSub}>Historia del sistema anterior, solo lectura. Para llevarlo al tablero hace falta abrir un caso con su examen clínico.</div>
        </div>
      </div>
      <div className={orto.tarjetaCuerpo} style={{ padding: 0 }}>
        {casos.map((c, i) => {
          const detalle = [
            c.technique,
            c.treatingDoctorName ? `Dr/a. ${c.treatingDoctorName}` : null,
            c.estimatedDurationMonths ? `${c.estimatedDurationMonths} meses` : null,
            c.statusRaw ?? ESTADO[c.status],
          ].filter(Boolean).join(" · ") || "Sin detalle";
          return (
            <div
              key={c.id}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap",
                padding: "12px 18px", borderTop: i === 0 ? "none" : "1px solid var(--pr-borde-suave)",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--pr-texto)" }}>
                  {c.installedAt ? formatDate(c.installedAt) : "Sin fecha de colocación"}
                </div>
                <div style={{ fontSize: 12, color: "var(--pr-texto-3)", overflowWrap: "anywhere" }}>{detalle}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {c.totalAmount != null ? (
                  <span style={{ fontSize: 13, fontWeight: 650, color: "var(--pr-texto)", fontVariantNumeric: "tabular-nums" }}>
                    {fmtMXNdec(c.totalAmount)}
                  </span>
                ) : null}
                <span style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--pr-borde)", background: "var(--pr-tarjeta-2)", color: "var(--pr-texto-2)", whiteSpace: "nowrap" }}>
                  Migrado de {c.origin}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  return conLienzo ? <div className={`${RAIZ_ORTO} ${orto.lienzo}`}>{tarjeta}</div> : tarjeta;
}
