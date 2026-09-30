"use client";
// Ortodoncia — procedimientos de las hojas de control con costo aparte que
// quedaron SIN cobrar (el doctor firmó sin permiso de cobro, o nadie pulsó
// «Cobrar»). Se ve en la ficha del caso (`treatmentPlanId`) y en Cobranza
// (toda la clínica); quien tiene permiso de cobro los cobra con el mismo botón
// de la hoja. Sin nada pendiente no pinta nada.

import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CobrarEnFactura } from "@/components/dashboard/billing/cobrar-en-factura";
import {
  cobrarProcedimientoDeHoja,
  listarExtrasPorCobrar,
  type ExtraPorCobrar,
} from "@/app/actions/orthodontics/procedimientosDeHoja";
import { isFailure } from "@/app/actions/orthodontics/result";

const dinero = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short" });

export function ExtrasPorCobrar({
  treatmentPlanId,
  conPaciente = false,
  onCambio,
}: {
  treatmentPlanId?: string;
  conPaciente?: boolean;
  /** Se creó o se cobró una factura: quien la monta recarga lo suyo (p. ej. el saldo de la ficha). */
  onCambio?: () => void;
}) {
  const [extras, setExtras] = useState<ExtraPorCobrar[]>([]);
  const [puedeCobrar, setPuedeCobrar] = useState(false);
  const [cobrando, setCobrando] = useState<string | null>(null);
  // ws1-t4 (revisión final, fallo 3): «Cobrar» ya no solo crea la factura — abre su
  // ventana completa de cobro, como los demás «Cobrar». El botón dice qué pasa mientras.
  const [ventana, setVentana] = useState<{ invoiceId: string; total: number; rediseno: boolean; clinicTaxMode: string | null } | null>(null);
  const router = useRouter();

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

  const ventanaDeCobro = ventana ? (
    <CobrarEnFactura
      invoiceId={ventana.invoiceId}
      montoSugerido={ventana.total > 0 ? ventana.total : undefined}
      rediseno={ventana.rediseno}
      clinicTaxMode={ventana.clinicTaxMode}
      onLista={() => setCobrando(null)}
      onClose={() => {
        setVentana(null);
        setCobrando(null);
      }}
      onRefrescar={() => {
        void cargar();
        onCambio?.();
        // En Cobranza los importes de las filas los pinta el servidor.
        if (conPaciente) router.refresh();
      }}
    />
  ) : null;

  // La fila desaparece al crearse la factura, pero la ventana de cobro sigue abierta.
  if (extras.length === 0) return ventanaDeCobro;

  async function cobrar(x: ExtraPorCobrar) {
    const clave = `${x.cardId}:${x.procedureId}`;
    if (cobrando) return;
    setCobrando(clave);
    try {
      const r = await cobrarProcedimientoDeHoja({ cardId: x.cardId, procedureId: x.procedureId });
      if (isFailure(r)) {
        toast.error(r.error);
        setCobrando(null);
        return;
      }
      toast.success(`Factura ${r.data.invoiceNumber ?? ""} creada para «${x.name}».`);
      setVentana({ invoiceId: r.data.invoiceId, total: r.data.total, rediseno: r.data.rediseno, clinicTaxMode: r.data.clinicTaxMode });
      void cargar();
    } catch {
      toast.error("No se pudo cobrar el procedimiento. Inténtalo de nuevo.");
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
                aria-busy={cobrando === `${x.cardId}:${x.procedureId}` || undefined}
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
                {cobrando === `${x.cardId}:${x.procedureId}` ? (ventana ? "Abriendo el cobro…" : "Creando la factura…") : "Cobrar"}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {ventanaDeCobro}
    </section>
  );
}
