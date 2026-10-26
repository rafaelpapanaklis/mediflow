"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Wallet } from "lucide-react";
import toast from "react-hot-toast";
import { fmtMXNdec } from "@/lib/format";
import { useT } from "@/i18n/i18n-provider";
import { mensajeDeError } from "@/lib/errores/mensaje-de-error";
import { MAX_MOTIVO_CIERRE } from "@/lib/treatments/cerrar-plan";
import type { PlanConCuenta } from "@/lib/treatments/sin-doble-cobro";
import s from "./expediente.module.css";

/**
 * «Cuenta del plan» en la tarjeta de cada plan (ws1-t12 · fase 2): total, abonado (anticipo
 * incluido), saldo y lo que aún no está en ninguna nota, con el folio de su nota de cobro. Lee
 * GET /api/treatments/cuentas (una llamada por paciente, no una por plan). Sin `billing.view` la
 * ficha no la pide y aquí no se pinta nada: es dinero.
 *
 * Desde el 26-oct (decisión de Rafael) la deuda es lo HECHO menos lo PAGADO: cuatro cifras —Plan
 * aceptado · Hecho · Pagado · Debe (o Saldo a favor)— y aparte «Por hacer». Y «Cerrar plan» (plan
 * abandonado): la nota se queda en lo hecho, con confirmación y motivo (POST …/cerrar).
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

/** Las cifras nuevas, o las de siempre si la respuesta no las trae (servidor de antes). */
export function cifrasDeLaCuenta(c: PlanConCuenta) {
  const aceptado = c.aceptado ?? c.facturado;
  const hecho = c.hecho ?? c.facturado;
  const debe = c.debe ?? c.saldo;
  return {
    aceptado,
    hecho,
    pagado: c.pagado,
    debe,
    saldoAFavor: c.saldoAFavor ?? 0,
    porHacer: c.porHacer ?? 0,
    vencido: c.vencido ?? 0,
  };
}

export function CuentaDelPlan({ cuenta, cargando, onCobrar, puedeCerrar }: {
  cuenta: PlanConCuenta | null | undefined;
  cargando?: boolean;
  onCobrar?: () => void;
  /** Quien edita planes ve «Cerrar plan» (el servidor exige además `billing.edit`). */
  puedeCerrar?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [cerrando, setCerrando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  if (!cuenta) {
    return cargando ? <div className={s.cuentaPlanEsqueleto} aria-hidden data-cuenta-plan-cargando /> : null;
  }
  if (!cuentaConAlgo(cuenta)) return null;
  const notas = cuenta.notas.map((n) => n.invoiceNumber).filter(Boolean);
  const c = cifrasDeLaCuenta(cuenta);
  const conCierre = !!puedeCerrar && cuenta.conFilas && (c.porHacer > 0.005 || (cuenta.estado !== "ABANDONED" && cuenta.estado !== "COMPLETED"));
  const motivoListo = motivo.replace(/\s+/g, " ").trim().length >= 3;

  async function cerrar() {
    if (!motivoListo || enviando || !cuenta) return;
    setEnviando(true);
    try {
      const res = await fetch(`/api/treatments/${encodeURIComponent(cuenta.planId)}/cerrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo }),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(mensajeDeError(cuerpo, t, { estado: res.status, porDefecto: t("planTratamiento.cobro.cerrarError") }));
        return;
      }
      const aFavor = Number(cuerpo?.saldoAFavor) || 0;
      toast.success(aFavor > 0
        ? t("planTratamiento.cobro.cerrarListoAFavor", { plan: cuenta.nombre, monto: fmtMXNdec(aFavor) })
        : t("planTratamiento.cobro.cerrarListo", { plan: cuenta.nombre }));
      setCerrando(false);
      setMotivo("");
      router.refresh();
    } catch (e) {
      toast.error(mensajeDeError(e, t, { porDefecto: t("planTratamiento.cobro.cerrarError") }));
    } finally {
      setEnviando(false);
    }
  }

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
        <div data-cifra="aceptado">
          <dt>{t("planTratamiento.cobro.aceptado")}</dt>
          <dd>{fmtMXNdec(c.aceptado)}</dd>
        </div>
        <div data-cifra="hecho">
          <dt>{t("planTratamiento.cobro.hecho")}</dt>
          <dd>{fmtMXNdec(c.hecho)}</dd>
        </div>
        <div data-cifra="pagado">
          <dt>{t("planTratamiento.cobro.pagado")}</dt>
          <dd className={s.cuentaPlanExito}>{fmtMXNdec(c.pagado)}</dd>
        </div>
        {c.saldoAFavor > 0.005 && c.debe <= 0.005 ? (
          <div data-cifra="saldo-a-favor">
            <dt>{t("planTratamiento.cobro.saldoAFavor")}</dt>
            <dd className={s.cuentaPlanExito}>{fmtMXNdec(c.saldoAFavor)}</dd>
          </div>
        ) : (
          <div data-cifra="debe">
            <dt>{t("planTratamiento.cobro.debe")}</dt>
            <dd className={c.debe > 0.005 ? s.cuentaPlanPeligro : s.cuentaPlanExito}>{fmtMXNdec(c.debe)}</dd>
          </div>
        )}
        {c.porHacer > 0.005 && (
          <div data-cifra="por-hacer">
            <dt>{t("planTratamiento.cobro.porHacer")}</dt>
            <dd>{fmtMXNdec(c.porHacer)}</dd>
          </div>
        )}
        {cuenta.porFacturar > 0.005 && (
          <div>
            <dt>{t("planTratamiento.cobro.porFacturar")}</dt>
            <dd>{fmtMXNdec(cuenta.porFacturar)}</dd>
          </div>
        )}
      </dl>
      {c.vencido > 0.005 && (
        <p className={`${s.cuentaPlanAyuda} ${s.cuentaPlanAvisoPeligro}`} data-cuenta-plan-vencido>
          {t("planTratamiento.cobro.vencidoDe", { monto: fmtMXNdec(c.vencido) })}
        </p>
      )}
      {c.debe > 0.005 && c.saldoAFavor > 0.005 && (
        <p className={s.cuentaPlanAyuda}>{t("planTratamiento.cobro.tambienAFavor", { monto: fmtMXNdec(c.saldoAFavor) })}</p>
      )}
      {c.porHacer > 0.005 && <p className={s.cuentaPlanAyuda}>{t("planTratamiento.cobro.porHacerAyuda")}</p>}
      {!cuenta.soloDelPlan && <p className={s.cuentaPlanAyuda}>{t("planTratamiento.cobro.mezclado")}</p>}
      {!cerrando && (onCobrar || conCierre) && (
        <div className={s.cuentaPlanAcciones}>
          {onCobrar && cuenta.conFilas && (cuenta.saldo > 0.005 || (cuenta.porFacturar > 0.005 && cuenta.notas.length === 0 && cuenta.estado !== "ABANDONED")) && (
            <button type="button" className={`${s.boton} ${s.botonChico}`} onClick={(e) => { e.stopPropagation(); onCobrar(); }} data-cuenta-plan-cobrar>
              {t("planTratamiento.cobro.abonar")}
            </button>
          )}
          {conCierre && (
            <button type="button" className={`${s.boton} ${s.botonChico} ${s.botonPeligroSuave}`} onClick={(e) => { e.stopPropagation(); setCerrando(true); }} data-cuenta-plan-cerrar>
              {t("planTratamiento.cobro.cerrar")}
            </button>
          )}
        </div>
      )}
      {cerrando && (
        <div className={s.cuentaPlanCierre} role="group" aria-labelledby={`cerrar-${cuenta.planId}`} data-cuenta-plan-cierre>
          <p className={s.cuentaPlanCierreTitulo} id={`cerrar-${cuenta.planId}`}>{t("planTratamiento.cobro.cerrarTitulo", { plan: cuenta.nombre })}</p>
          <ul className={s.cuentaPlanCierreLista}>
            <li>{c.porHacer > 0.005
              ? t("planTratamiento.cobro.cerrarQuita", { monto: fmtMXNdec(c.porHacer), hecho: fmtMXNdec(c.hecho) })
              : t("planTratamiento.cobro.cerrarNadaQueQuitar")}</li>
            {(() => {
              // Lo pagado que pasaría de lo hecho, como queda tras quitar lo no hecho.
              const aFavor = Math.max(0, Math.round((c.pagado - c.hecho) * 100) / 100);
              return aFavor > 0.005
                ? <li>{t("planTratamiento.cobro.cerrarAFavor", { monto: fmtMXNdec(aFavor) })}</li>
                : c.debe > 0.005 ? <li>{t("planTratamiento.cobro.cerrarSigueDebiendo", { monto: fmtMXNdec(c.debe) })}</li> : null;
            })()}
            <li>{t("planTratamiento.cobro.cerrarAbandonado")}</li>
          </ul>
          <label className={s.cuentaPlanCierreCampo}>
            <span>{t("planTratamiento.cobro.cerrarMotivo")}</span>
            <textarea
              value={motivo}
              maxLength={MAX_MOTIVO_CIERRE}
              rows={2}
              placeholder={t("planTratamiento.cobro.cerrarMotivoPh")}
              onChange={(e) => setMotivo(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              data-cuenta-plan-motivo
            />
          </label>
          <div className={s.cuentaPlanAcciones}>
            <button type="button" className={`${s.boton} ${s.botonChico}`} onClick={() => { setCerrando(false); setMotivo(""); }} disabled={enviando}>
              {t("planTratamiento.cobro.cerrarVolver")}
            </button>
            <button type="button" className={`${s.boton} ${s.botonChico} ${s.botonPeligro}`} onClick={cerrar} disabled={!motivoListo || enviando} data-cuenta-plan-confirmar>
              {enviando ? t("planTratamiento.cobro.cerrando") : t("planTratamiento.cobro.cerrarConfirmar")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
