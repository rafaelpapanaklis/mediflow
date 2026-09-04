"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { eduMoney } from "@/lib/edu/dinero-core";
import { eduFechaLarga, type EduPlanRow } from "@/lib/edu/pagos-core";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";
import {
  EDU_INSTALLMENT_STATUS_LABELS,
  EDU_PAYMENT_METHOD_LABELS,
  EDU_PAYMENT_PLAN_STATUS_LABELS,
} from "@/lib/edu/types";

/**
 * EL RECIBO DEL PLAN — un documento, no un tablero. Se imprime con
 * `window.print()` como el tablero de dirección: el chrome del panel se
 * apaga en @media print (edu-theme.css) y queda la hoja.
 *
 * 🔴 TODO LO QUE PINTA VIENE DERIVADO DEL SERVIDOR. El estado de cada
 * mensualidad se calculó contra el hoy del INSTITUTO al leer la página, y
 * por eso el papel dice "al día de su impresión": el mismo plan impreso
 * mañana puede traer una VENCIDA más, y las dos hojas dicen la verdad de
 * su fecha.
 *
 * ⚠️ Las fechas de INSTANTES (cuándo se pagó, cuándo se armó) llegan YA
 * formateadas por el servidor en la zona del instituto: formatearlas aquí
 * pintaría la zona del navegador y rompería la hidratación.
 */
export interface EduPlanReciboProps {
  plan: EduPlanRow;
  institutionName: string;
  /** El hoy del instituto con el que se derivaron los estados. */
  todayISO: string;
  /** "15 de septiembre de 2026, 13:40" — formateado por el servidor. */
  creadoLabel: string;
  /** Por mensualidad PAGADA: "12 de octubre de 2026" (zona del instituto). */
  paidLabels: Record<string, string>;
}

export function EduPlanRecibo({
  plan,
  institutionName,
  todayISO,
  creadoLabel,
  paidLabels,
}: EduPlanReciboProps) {
  const primera = plan.installments[0] ?? null;
  const primeraDistinta = primera !== null && primera.amountCents !== plan.installmentCents;

  return (
    <>
      <div className="edu-actions edu-pagos-noprint">
        <Link href="/instituto/caja/planes" className="edu-btn edu-btn--ghost edu-btn--sm">
          <ArrowLeft size={15} />
          Pagos a meses
        </Link>
        <Link
          href={`/instituto/pacientes/${plan.patientId}/pagos`}
          className="edu-btn edu-btn--ghost edu-btn--sm"
        >
          Ver al paciente
        </Link>
        <button
          type="button"
          className="edu-btn edu-btn--primary edu-btn--sm"
          onClick={() => window.print()}
        >
          <Printer size={15} />
          Imprimir
        </button>
      </div>

      <div className="edu-planrecibo">
        <div className="edu-planrecibo__head">
          <div>
            <p className="edu-planrecibo__escuela">{institutionName}</p>
            <p className="edu-planrecibo__doc">
              Plan de pagos del cobro {plan.chargeFolio} · impreso el {eduFechaLarga(todayISO)}
            </p>
          </div>
          {plan.status !== "ACTIVO" && (
            <span className="edu-planrecibo__sello">
              {EDU_PAYMENT_PLAN_STATUS_LABELS[plan.status]}
            </span>
          )}
        </div>

        {plan.status === "CANCELADO" && (
          <p className="edu-note">
            Este plan se canceló{plan.cancelledByName ? ` (${plan.cancelledByName})` : ""}
            {plan.cancelReason ? `: ${plan.cancelReason}` : "."} Lo pagado consta abajo; las
            mensualidades sin pagar dejaron de deberse como mensualidades y el saldo del cobro se
            cobra normal.
          </p>
        )}

        <div className="edu-kv edu-kv--2">
          <div>
            <span className="edu-kv__k">Paciente</span>
            <span className="edu-kv__v">
              <EduPersonaLink kind="paciente" id={plan.patientId}>
                {plan.patientName}
              </EduPersonaLink>{" "}
              · {plan.patientFolio}
            </span>
          </div>
          <div>
            <span className="edu-kv__k">Plan armado</span>
            <span className="edu-kv__v">
              {creadoLabel} · {plan.createdByName}
            </span>
          </div>
        </div>

        <table className="edu-planrecibo__tabla">
          <tbody>
            <tr>
              <td>Total del cobro {plan.chargeFolio}</td>
              <td className="edu-planrecibo__num">{eduMoney(plan.chargeTotalCents)}</td>
            </tr>
            <tr>
              <td>Pagado al armar el plan (enganche y abonos previos)</td>
              <td className="edu-planrecibo__num">
                {plan.downPaymentCents > 0 ? eduMoney(plan.downPaymentCents) : "—"}
              </td>
            </tr>
            <tr>
              <td>
                Diferido en {plan.months} mensualidades, día de corte {plan.dueDay}
                {primeraDistinta
                  ? ` — ${plan.months - 1} de ${eduMoney(plan.installmentCents)} y la primera de ${eduMoney(
                      primera.amountCents,
                    )} (carga los centavos del reparto)`
                  : ` de ${eduMoney(plan.installmentCents)}`}
              </td>
              <td className="edu-planrecibo__num">{eduMoney(plan.planCents)}</td>
            </tr>
          </tbody>
        </table>

        <table className="edu-planrecibo__tabla">
          <thead>
            <tr>
              <th>N.º</th>
              <th>Vence</th>
              <th className="edu-planrecibo__num">Monto</th>
              <th>Estado</th>
              <th>Pago</th>
            </tr>
          </thead>
          <tbody>
            {plan.installments.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.number} de {plan.months}
                </td>
                <td>{eduFechaLarga(i.dueDateISO)}</td>
                <td className="edu-planrecibo__num">{eduMoney(i.amountCents)}</td>
                <td>
                  {plan.status === "ACTIVO" || i.status === "PAGADA"
                    ? EDU_INSTALLMENT_STATUS_LABELS[i.status]
                    : "—"}
                </td>
                <td>
                  {i.status === "PAGADA"
                    ? [
                        paidLabels[i.id] ?? null,
                        i.method ? EDU_PAYMENT_METHOD_LABELS[i.method] : null,
                        i.receivedByName ? `recibió ${i.receivedByName}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                Pagadas {plan.paidCount} de {plan.months}
                {plan.status === "ACTIVO" && plan.overdueCount > 0
                  ? ` · ${plan.overdueCount} ${plan.overdueCount === 1 ? "vencida" : "vencidas"} (${eduMoney(
                      plan.overdueCents,
                    )})`
                  : ""}
              </td>
              <td className="edu-planrecibo__num">
                {plan.status === "ACTIVO" ? eduMoney(plan.pendingCents) : "—"}
              </td>
              <td colSpan={2}>{plan.status === "ACTIVO" ? "por pagar" : ""}</td>
            </tr>
          </tfoot>
        </table>

        <p className="edu-note">
          Los estados están calculados al día de su impresión. Cada mensualidad pagada consta como
          un pago del cobro {plan.chargeFolio}, con su método y su turno de caja: este calendario
          no suma dinero por su cuenta.
        </p>

        <div className="edu-planrecibo__firmas">
          <div className="edu-planrecibo__firma">Paciente · {plan.patientName}</div>
          <div className="edu-planrecibo__firma">Caja · {institutionName}</div>
        </div>
      </div>
    </>
  );
}
