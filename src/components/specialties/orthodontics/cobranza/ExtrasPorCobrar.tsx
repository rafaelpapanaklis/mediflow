"use client";
// Ortodoncia — procedimientos de las hojas de control con costo aparte que
// quedaron SIN cobrar (el doctor firmó sin permiso de cobro, o nadie pulsó
// «Cobrar»). Se ve en la ficha del caso (`treatmentPlanId`) y en Cobranza
// (toda la clínica); quien tiene permiso de cobro los cobra con el mismo botón
// de la hoja. Sin nada pendiente no pinta nada.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import Link from "next/link";
import {
  cobrarProcedimientoDeHoja,
  listarExtrasPorCobrar,
  type ExtraPorCobrar,
} from "@/app/actions/orthodontics/procedimientosDeHoja";
import { isFailure } from "@/app/actions/orthodontics/result";

const dinero = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

export function ExtrasPorCobrar({ treatmentPlanId, conPaciente = false }: { treatmentPlanId?: string; conPaciente?: boolean }) {
  const [extras, setExtras] = useState<ExtraPorCobrar[]>([]);
  const [puedeCobrar, setPuedeCobrar] = useState(false);
  const [cobrando, setCobrando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await listarExtrasPorCobrar({ treatmentPlanId });
      if (!isFailure(r)) {
        setExtras(r.data.extras);
        setPuedeCobrar(r.data.puedeCobrar);
      }
    } catch {
      /* sin lista: no se pinta nada */
    }
  }, [treatmentPlanId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (extras.length === 0) return null;

  async function cobrar(x: ExtraPorCobrar) {
    const clave = `${x.cardId}:${x.procedureId}`;
    if (cobrando) return;
    setCobrando(clave);
    try {
      const r = await cobrarProcedimientoDeHoja({ cardId: x.cardId, procedureId: x.procedureId });
      if (isFailure(r)) {
        toast.error(r.error);
        return;
      }
      toast.success(`Factura ${r.data.invoiceNumber ?? ""} creada para «${x.name}».`);
      await cargar();
    } finally {
      setCobrando(null);
    }
  }

  return (
    <section
      aria-label="Procedimientos por cobrar"
      style={{
        margin: "0 0 14px",
        padding: "12px 14px",
        border: "1px solid var(--pr-borde)",
        borderRadius: "var(--pr-radio-s)",
        background: "var(--pr-tarjeta-2)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--pr-texto)", marginBottom: 2 }}>
        Procedimientos por cobrar · {extras.length}
      </div>
      <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--pr-texto-3)" }}>
        Se registraron en una hoja de control firmada y todavía no tienen factura.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {extras.map((x) => (
          <li key={`${x.cardId}:${x.procedureId}`} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13 }}>
            <span style={{ minWidth: 0, flex: "1 1 220px", color: "var(--pr-texto)" }}>
              {conPaciente ? (
                <Link href={`/dashboard/patients/${x.patientId}?tab=ortodoncia`} style={{ fontWeight: 600, textDecoration: "underline" }}>
                  {x.patientName}
                </Link>
              ) : null}
              {conPaciente ? " · " : ""}
              <strong>{x.name}</strong>
              {x.quantity > 1 ? ` ×${x.quantity}` : ""}
              <span style={{ color: "var(--pr-texto-3)" }}> · {x.cardNumber ? `hoja ${x.cardNumber} · ` : ""}{fecha(x.visitDate)}</span>
            </span>
            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{dinero.format(x.total)}</span>
            {puedeCobrar ? (
              <button
                type="button"
                disabled={cobrando !== null}
                onClick={() => void cobrar(x)}
                style={{
                  padding: "5px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: "var(--pr-radio-s)",
                  border: "1px solid var(--pr-activo)",
                  background: "var(--pr-activo-suave)",
                  color: "var(--pr-activo)",
                  cursor: cobrando ? "default" : "pointer",
                }}
              >
                {cobrando === `${x.cardId}:${x.procedureId}` ? "Cobrando…" : "Cobrar"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
