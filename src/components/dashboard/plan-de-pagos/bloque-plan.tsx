"use client";

// ═══════════════════════════════════════════════════════════════════════════
// EL BLOQUE DEL PLAN DE PAGOS (ws1-t2) — lo que se lee de un vistazo en una
// factura a plazos: «Cuota 7 de 24 · la siguiente vence el 3 mar, $2,000 ·
// pendiente $18,000 · al corriente» (o «2 cuotas vencidas»).
//
// Sirve para CUALQUIER tratamiento a plazos. No es de ninguna especialidad.
//
// ⛔ Aquí no hay dinero que mover ni nada que guardar: TODO se deriva, en cada
// pintado, de las condiciones anotadas y de lo cobrado (`Invoice.paid`, que es
// la suma de `payments`). La aritmética vive en `lib/invoices/plan-de-pagos.ts`.
//
// Un bloque, no una tabla: lo primero es «7 de 24» y la siguiente fecha. Las 24
// cuotas se DESPLIEGAN, no se imponen. Los estados se leen por FORMA (icono y
// palabra) y por color: una vencida salta a la vista aunque no distingas el rojo.
//
// Monta sus propios tokens (`CLASES_MENU`): se pinta igual en la ficha, en Caja
// y dentro de un modal, que es un portal a <body> y no hereda nada.
// ═══════════════════════════════════════════════════════════════════════════

import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Circle, CircleDashed } from "lucide-react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import {
  calendarioDeCuotas, cuadreDelPlan, esPlanAPlazos, estadoDelPlan,
  type CuotaConEstado, type EstadoCuota,
} from "@/lib/invoices/plan-de-pagos";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { todayLocalISO } from "@/lib/billing/paid-at";
import { fmtMXNdec } from "@/lib/format";
import { useLocale, useT } from "@/i18n/i18n-provider";
import type { TFunction } from "@/i18n/t";
import s from "./plan.module.css";

/** "2026-03-03" → "3 mar 2026". En UTC: una fecha sin hora no tiene huso. */
export function fechaDeCuota(fecha: string | null, locale: string): string | null {
  if (!fecha) return null;
  const [a, m, d] = fecha.split("-").map(Number);
  if (!a || !m || !d) return null;
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(a, m - 1, d)));
}

export function nombreDeCuota(q: { numero: number; esEnganche: boolean }, t: TFunction): string {
  return q.esEnganche ? t("planDePagos.enganche") : t("planDePagos.cuotaN", { n: q.numero });
}

const ICONO: Record<EstadoCuota, typeof Circle> = {
  pagada: CheckCircle2,
  porVencer: Circle,
  vencida: AlertTriangle,
};
const CLASE_ESTADO: Record<EstadoCuota, string> = {
  pagada: s.pagada,
  // Por vencer es el estado neutro: no lleva clase propia.
  porVencer: "",
  vencida: s.vencida,
};

export function BloquePlan({
  condiciones, total, pagado,
}: {
  condiciones: CondicionesPago | null | undefined;
  /** `Invoice.total`. */
  total: number;
  /** `Invoice.paid`: lo cobrado de verdad, reembolsos ya descontados. */
  pagado: number;
}) {
  const t = useT();
  const locale = useLocale();
  const hoy = todayLocalISO();
  const plan = useMemo(() => {
    const cuotas = calendarioDeCuotas(condiciones, total);
    return {
      estado: estadoDelPlan(cuotas, [{ importe: pagado }], hoy),
      cuadre: cuadreDelPlan(condiciones, total),
    };
  }, [condiciones, total, pagado, hoy]);

  // Sin condiciones a plazos (o sin la tabla, que es lo mismo visto desde aquí)
  // el bloque NO aparece. Nada más cambia.
  if (!esPlanAPlazos(condiciones) || plan.estado.cuotas.length === 0) return null;

  const { estado, cuadre } = plan;
  const actual = estado.cuotaActual;
  const saldado = actual === null;

  return (
    <section
      className={`${CLASES_MENU} ${s.bloque} ${estado.vencidas > 0 ? s.bloqueVencido : ""}`}
      aria-label={t("planDePagos.titulo")}
      // Vive dentro de una ficha que se abre al tocarla: desplegar las cuotas
      // no es abrir la factura.
      onClick={(e) => e.stopPropagation()}
    >
      <div className={s.cabeza}>
        <div className={s.avance}>
          <span className={s.rotulo}>{t("planDePagos.titulo")}</span>
          {saldado ? (
            <span className={s.grande}>{t("planDePagos.saldado")}</span>
          ) : actual.esEnganche ? (
            <span className={s.grande}>{t("planDePagos.vaPorEnganche")}</span>
          ) : (
            <span className={s.grande}>
              {t("planDePagos.vaPor", { n: actual.numero })}{" "}
              <span className={s.grandeDe}>{t("planDePagos.deN", { total: estado.totalCuotas })}</span>
            </span>
          )}
        </div>

        {/* Forma + palabra + color: nunca solo color. */}
        {estado.vencidas > 0 ? (
          <span className={`${s.sello} ${s.selloVencido}`} role="status">
            <AlertTriangle size={14} strokeWidth={2.4} aria-hidden />
            {t("planDePagos.vencidas", { count: estado.vencidas })}
            {" · "}{fmtMXNdec(estado.importeVencido)}
          </span>
        ) : !saldado && !estado.conFechas ? (
          // Sin fechas nada vence: no se presume de «al corriente» sin saberlo.
          <span className={`${s.sello} ${s.selloNeutro}`} role="status">
            <CircleDashed size={14} strokeWidth={2.4} aria-hidden />
            {t("planDePagos.sinFechas")}
          </span>
        ) : (
          <span className={`${s.sello} ${s.selloAlCorriente}`} role="status">
            <CheckCircle2 size={14} strokeWidth={2.4} aria-hidden />
            {saldado ? t("planDePagos.pagadoEntero") : t("planDePagos.alCorriente")}
          </span>
        )}
      </div>

      {/* Una marca por cuota: de un vistazo, cuánto camino lleva. */}
      <div className={s.tira} aria-hidden>
        {estado.cuotas.map((q) => (
          <span key={claveDe(q)} className={`${s.marca} ${CLASE_ESTADO[q.estado]} ${q.abonado > 0 && q.falta > 0 ? s.marcaParcial : ""}`} />
        ))}
      </div>

      <dl className={s.datos}>
        {estado.siguiente && (
          <div className={s.dato}>
            <dt>{t("planDePagos.siguiente")}</dt>
            <dd>
              {fechaDeCuota(estado.siguiente.vencimiento, locale) ?? t("planDePagos.sinFecha")}
              {" · "}<strong>{fmtMXNdec(estado.siguiente.falta)}</strong>
            </dd>
          </div>
        )}
        <div className={s.dato}>
          <dt>{t("planDePagos.pagado")}</dt>
          <dd>{fmtMXNdec(estado.pagado)}</dd>
        </div>
        <div className={s.dato}>
          <dt>{t("planDePagos.pendiente")}</dt>
          <dd><strong>{fmtMXNdec(estado.pendiente)}</strong></dd>
        </div>
      </dl>

      {/* El total cambió después de acordar: se DICE, no se ajusta solo. */}
      {!cuadre.cuadra && (
        <p className={s.descuadre} role="alert">
          <AlertTriangle size={14} strokeWidth={2.4} aria-hidden />
          <span>
            <strong>{t("planDePagos.descuadreTitulo")}</strong>{" "}
            {t(`planDePagos.descuadre.${cuadre.motivo}`, {
              enganche: fmtMXNdec(condiciones.enganche),
              total: fmtMXNdec(cuadre.total),
              acordadas: condiciones.numPagos,
              quedan: estado.totalCuotas,
            })}
          </span>
        </p>
      )}

      <details className={s.detalle}>
        <summary className={s.detalleResumen}>
          {t("planDePagos.verCuotas", { count: estado.cuotas.length })}
        </summary>
        <ol className={s.cuotas}>
          {estado.cuotas.map((q) => <Fila key={claveDe(q)} q={q} t={t} locale={locale} />)}
        </ol>
        <p className={s.nota}>{t("planDePagos.notaCascada")}</p>
      </details>
    </section>
  );
}

function claveDe(q: CuotaConEstado): string {
  return `${q.esEnganche ? "e" : "c"}-${q.numero}`;
}

function Fila({ q, t, locale }: { q: CuotaConEstado; t: TFunction; locale: string }) {
  const parcial = q.abonado > 0 && q.falta > 0;
  // Parcial y aún sin vencer: un círculo a medias, distinto del vacío.
  const Icono = parcial && q.estado === "porVencer" ? CircleDashed : ICONO[q.estado];
  return (
    <li className={`${s.cuota} ${CLASE_ESTADO[q.estado]}`}>
      <Icono className={s.cuotaIcono} size={15} strokeWidth={2.2} aria-hidden />
      <span className={s.cuotaNombre}>{nombreDeCuota(q, t)}</span>
      <span className={s.cuotaFecha}>{fechaDeCuota(q.vencimiento, locale) ?? t("planDePagos.sinFecha")}</span>
      <span className={s.cuotaImporte}>{fmtMXNdec(q.importe)}</span>
      <span className={s.cuotaEstado}>
        {t(`planDePagos.estado.${q.estado}`)}
        {parcial && <span className={s.cuotaParcial}>{" · "}{t("planDePagos.falta", { importe: fmtMXNdec(q.falta) })}</span>}
      </span>
    </li>
  );
}
