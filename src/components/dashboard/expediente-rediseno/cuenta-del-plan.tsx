"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { fmtMXNdec } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";
import type { PlanConCuenta } from "@/lib/treatments/sin-doble-cobro";
import s from "./expediente.module.css";

/**
 * «Cuenta del plan» en la tarjeta de cada plan (ws1-t12 · fase 2): total, abonado (anticipo
 * incluido), saldo y lo que aún no está en ninguna nota, con el folio de su nota de cobro. Lee
 * GET /api/treatments/cuentas (una llamada por paciente, no una por plan). Sin `billing.view` la
 * ficha no la pide y aquí no se pinta nada: es dinero.
 */

export type CuentasDelPaciente = Map<string, PlanConCuenta>;

/** `clave` cambia cuando la ficha recibe planes nuevos (refresco, plan recién creado): se relee. */
export function useCuentasDelPaciente(patientId: string, activo: boolean, clave: unknown): { cuentas: CuentasDelPaciente | null; cargando: boolean } {
  const [cuentas, setCuentas] = useState<CuentasDelPaciente | null>(null);
  const [cargando, setCargando] = useState(false);
  useEffect(() => {
    if (!activo || !patientId) {
      setCuentas(null);
      return;
    }
    let vivo = true;
    setCargando(true);
    fetch(`/api/treatments/cuentas?patientId=${encodeURIComponent(patientId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { planes?: PlanConCuenta[] } | null) => {
        if (!vivo) return;
        setCuentas(d && Array.isArray(d.planes) ? new Map(d.planes.map((p) => [p.planId, p] as const)) : null);
      })
      .catch(() => { if (vivo) setCuentas(null); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [patientId, activo, clave]);
  return { cuentas, cargando };
}

/** ¿Hay algo que enseñar? Un plan de texto sin dinero ligado no lleva tarjeta. */
export function cuentaConAlgo(c: PlanConCuenta | undefined | null): c is PlanConCuenta {
  return !!c && (c.conFilas || c.notas.length > 0) && (c.total > 0 || c.facturado > 0);
}

export function CuentaDelPlan({ cuenta, cargando, onCobrar }: { cuenta: PlanConCuenta | null | undefined; cargando?: boolean; onCobrar?: () => void }) {
  const t = useT();
  if (!cuenta) {
    return cargando ? <div className={s.cuentaPlanEsqueleto} aria-hidden data-cuenta-plan-cargando /> : null;
  }
  if (!cuentaConAlgo(cuenta)) return null;
  const notas = cuenta.notas.map((n) => n.invoiceNumber).filter(Boolean);
  return (
    <div className={s.cuentaPlan} data-cuenta-plan onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className={s.cuentaPlanCabeza}>
        <span className={s.cuentaPlanTitulo}>
          <Wallet size={13} strokeWidth={1.75} aria-hidden /> {t("planTratamiento.cobro.cuentaTitulo")}
        </span>
        {notas.length > 0 && (
          <span className={s.cuentaPlanNota}>
            {t(notas.length === 1 ? "planTratamiento.cobro.notaUna" : "planTratamiento.cobro.notaVarias", { folios: notas.join(", ") })}
          </span>
        )}
      </div>
      <dl className={s.cuentaPlanCifras}>
        <div>
          <dt>{t("planTratamiento.cobro.total")}</dt>
          <dd>{fmtMXNdec(cuenta.total)}</dd>
        </div>
        <div>
          <dt>{t("planTratamiento.cobro.abonado")}</dt>
          <dd className={s.cuentaPlanExito}>{fmtMXNdec(cuenta.pagado)}</dd>
        </div>
        <div>
          <dt>{t("planTratamiento.cobro.saldo")}</dt>
          <dd className={cuenta.saldo > 0 ? s.cuentaPlanPeligro : s.cuentaPlanExito}>{fmtMXNdec(cuenta.saldo)}</dd>
        </div>
        {cuenta.porFacturar > 0.005 && (
          <div>
            <dt>{t("planTratamiento.cobro.porFacturar")}</dt>
            <dd>{fmtMXNdec(cuenta.porFacturar)}</dd>
          </div>
        )}
      </dl>
      {!cuenta.soloDelPlan && <p className={s.cuentaPlanAyuda}>{t("planTratamiento.cobro.mezclado")}</p>}
      {onCobrar && cuenta.conFilas && (cuenta.saldo > 0.005 || (cuenta.porFacturar > 0.005 && cuenta.notas.length === 0 && cuenta.estado !== "ABANDONED")) && (
        <button type="button" className={`${s.boton} ${s.botonChico}`} onClick={(e) => { e.stopPropagation(); onCobrar(); }} data-cuenta-plan-cobrar>
          {t("planTratamiento.cobro.abonar")}
        </button>
      )}
    </div>
  );
}
