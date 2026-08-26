"use client";

// ═══════════════════════════════════════════════════════════════════════
// B · Cartera del propietario   y   D · Rentabilidad por inmueble.
//
// Son la MISMA cuenta presentada distinto, así que comparten componente y
// consulta: si fueran dos pantallas independientes, un día darían números
// distintos para lo mismo y nadie sabría cuál creer.
//   · variant "cartera"      → los tres números que el dueño de 10 casas
//     nunca ha visto, y la comparación entre sus propiedades.
//   · variant "rentabilidad" → la tabla, para la inmobiliaria: qué inmueble
//     se está comiendo el tiempo del equipo.
//
// 🔴 EL VALOR ES EL PRECIO DE LISTA. Este sistema no hace avalúos: no hay
// campo de valuación en ningún lado. Decirle "tu patrimonio vale X" cuando
// X es lo que alguien tecleó hace dos años sería venderle humo, así que la
// pantalla lo dice donde se lee, no en una nota al pie.
//
// i18n CONVENCIÓN B: sub-árbol ya recortado, prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import { useState } from "react";
import type { TFunction } from "@/i18n/t";
import { formatCents } from "@/lib/realty/rent-charges";
import {
  formatPctOrDash,
  yieldBlockedText,
  type MoneyByCurrency,
} from "@/lib/realty/owner-report";
import type { PortfolioReport } from "@/lib/realty/reports";
import { Card, EmptyState, Note, Pill } from "../rentals/ui";
import {
  BlockHead,
  ExportBar,
  Hint,
  MixedCurrencyNote,
  MoneyLine,
  PeriodBar,
  TableWrap,
  YieldCell,
} from "./reports-shared";

export interface PortfolioPanelProps {
  t: TFunction;
  variant: "cartera" | "rentabilidad";
  report: PortfolioReport;
  owners: Array<{ id: string; name: string; properties: number }>;
  ownerId: string | null;
  from: string;
  to: string;
  onNavigate: (params: Record<string, string | null>) => void;
}

export function PortfolioPanel({
  t,
  variant,
  report,
  owners,
  ownerId,
  from,
  to,
  onNavigate,
}: PortfolioPanelProps) {
  const [dFrom, setDFrom] = useState(from);
  const [dTo, setDTo] = useState(to);

  const isCartera = variant === "cartera";
  const base = isCartera ? "cartera" : "rentabilidad";
  const query = `?from=${report.from}&to=${report.to}${ownerId ? `&ownerId=${encodeURIComponent(ownerId)}` : ""}`;

  return (
    <div className="rep-stack">
      <div className="rep-toolbar">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {isCartera ? (
            <label className="rep-pick">
              <span>{t("cartera.elegirPropietario")}</span>
              <select
                className="rnt-select"
                value={ownerId ?? ""}
                onChange={(e) => onNavigate({ ownerId: e.target.value || null })}
              >
                <option value="">{t("cartera.todos")}</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.properties})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <PeriodBar
            from={dFrom}
            to={dTo}
            onFrom={setDFrom}
            onTo={setDTo}
            onApply={() => onNavigate({ from: dFrom, to: dTo })}
            labels={{
              desde: t("periodo.desde"),
              hasta: t("periodo.hasta"),
              aplicar: t("periodo.aplicar"),
            }}
          />
        </div>
        <ExportBar
          pdfHref={`/api/realty/reports/cartera/pdf${query}`}
          csvHref={`/api/realty/reports/cartera${query}&formato=csv`}
          pdfLabel={t("acciones.pdf")}
          csvLabel={t("acciones.hoja")}
        />
      </div>

      <BlockHead
        title={t(`${base}.title`)}
        sub={t(`${base}.subtitle`)}
        note={isCartera ? undefined : t("rentabilidad.explica")}
      />

      {report.rows.length === 0 ? (
        <Card>
          <EmptyState
            title={t("cartera.sinFilasTitulo")}
            body={t("cartera.sinFilasCuerpo")}
          />
        </Card>
      ) : (
        <>
          {isCartera ? (
            <>
              <div className="rep-headline">
                <div className="rep-headline__cell">
                  <div className="rep-headline__label">{t("cartera.valeHoy")}</div>
                  <div className="rep-headline__value">
                    <MoneyLine money={report.totalValue} block />
                  </div>
                  <Hint>{t("cartera.valorNota")}</Hint>
                </div>
                <div className="rep-headline__cell">
                  <div className="rep-headline__label">{t("cartera.renta")}</div>
                  <div className="rep-headline__value">
                    <MoneyLine money={report.totalMonthlyRent} block />
                  </div>
                </div>
                <div className="rep-headline__cell">
                  <div className="rep-headline__label">{t("cartera.rendimiento")}</div>
                  <div className="rep-headline__value">
                    {report.yieldByCurrency.length === 0 ? (
                      "—"
                    ) : (
                      <span className="rep-money-stack rep-money-stack--block">
                        {report.yieldByCurrency.map((y) => (
                          <span key={y.currency} className="rep-money">
                            {formatPctOrDash(y.netPct)}
                            {report.yieldByCurrency.length > 1 ? (
                              <em className="rep-money__cur">{y.currency}</em>
                            ) : null}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <MixedCurrencyNote
                money={[report.totalValue, report.totalIncome, report.totalExpenses]}
                text={t("moneda.mezcla")}
                extra={t("moneda.sinConversion")}
              />

              {report.best && report.worst ? (
                <Note tone="brand">
                  <strong>{t("cartera.mejor")}:</strong> {report.best.title} (
                  {formatPctOrDash(report.best.yield.netPct)}) · <strong>{t("cartera.peor")}:</strong>{" "}
                  {report.worst.title} ({formatPctOrDash(report.worst.yield.netPct)})
                </Note>
              ) : report.rows.length > 1 ? (
                <Note tone="info">{t("cartera.sinComparar")}</Note>
              ) : null}
            </>
          ) : (
            <MixedCurrencyNote
              money={[report.totalIncome, report.totalExpenses]}
              text={t("moneda.mezcla")}
              extra={t("moneda.delContrato")}
            />
          )}

          <Card flush>
            <TableWrap>
              <table className="rnt-table">
                <thead>
                  <tr>
                    <th>{t("cartera.inmueble")}</th>
                    {isCartera ? <th className="num">{t("cartera.valor")}</th> : null}
                    {isCartera ? <th className="num">{t("cartera.rentaMensual")}</th> : null}
                    <th className="num">{t("cartera.ingresos")}</th>
                    <th className="num">{t("cartera.gastos")}</th>
                    <th className="num">{t("cartera.neto")}</th>
                    <th className="num">{t("cartera.vacia")}</th>
                    <th className="num">{t("cartera.rendimientoCol")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.propertyId}>
                      <td>
                        <div className="rnt-strong">{r.title}</div>
                        <div className="rnt-muted">
                          {r.ownerName ?? "—"}
                          {r.hasActiveLease ? null : (
                            <>
                              {" · "}
                              <Pill tone="neutral">{t("cartera.vacia")}</Pill>
                            </>
                          )}
                        </div>
                      </td>
                      {isCartera ? (
                        <td className="num">{formatCents(r.valueCents, r.currency)}</td>
                      ) : null}
                      {isCartera ? (
                        <td className="num">
                          {formatCents(r.monthlyRentCents, r.monthlyRentCurrency)}
                        </td>
                      ) : null}
                      <td className="num">
                        <MoneyLine money={r.income} zero={r.currency} />
                      </td>
                      <td className="num">
                        <MoneyLine money={r.expenses} zero={r.currency} />
                      </td>
                      <td className="num">
                        <MoneyLine money={r.net} zero={r.currency} />
                      </td>
                      <td className="num">{r.monthsVacant}</td>
                      <td className="num">
                        <YieldCell
                          value={r.yield}
                          blockedText={yieldBlockedText(r.yield.blocked)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="rnt-strong">{t("cartera.neto")}</td>
                    {isCartera ? (
                      <td className="num">
                        <MoneyLine money={report.totalValue} />
                      </td>
                    ) : null}
                    {isCartera ? (
                      <td className="num">
                        <MoneyLine money={report.totalMonthlyRent} />
                      </td>
                    ) : null}
                    <td className="num">
                      <MoneyLine money={report.totalIncome} />
                    </td>
                    <td className="num">
                      <MoneyLine money={report.totalExpenses} />
                    </td>
                    <td className="num">
                      <MoneyLine money={report.totalNet} />
                    </td>
                    <td className="num">—</td>
                    <td className="num">—</td>
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          </Card>

          <MaintenanceAside t={t} rows={report.rows} />

          {report.orphanPayments > 0 ? (
            <Note tone="warning">
              {t("pagosHuerfanos", { n: report.orphanPayments })}
            </Note>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * El costo de mantenimiento, aparte y bien etiquetado.
 *
 * 🔴 NO se resta del neto. Cuando la inmobiliaria paga una reparación la
 * captura como gasto (el propio flujo de resolver un mantenimiento con
 * costo ofrece crearlo), así que restar además el `cost` le cobraría al
 * propietario dos veces la misma plomería. Se enseña porque es información
 * útil —cuánto ha costado mantener el inmueble— pero fuera de la cuenta.
 */
function MaintenanceAside({
  t,
  rows,
}: {
  t: TFunction;
  rows: Array<{ maintenanceCost: MoneyByCurrency }>;
}) {
  const total: MoneyByCurrency = { MXN: 0, USD: 0 };
  for (const r of rows) {
    total.MXN += r.maintenanceCost.MXN;
    total.USD += r.maintenanceCost.USD;
  }
  if (total.MXN === 0 && total.USD === 0) return null;

  return (
    <Card>
      <BlockHead
        title={t("cartera.mantenimiento")}
        note={t("cartera.mantenimientoNota")}
        right={<MoneyLine money={total} />}
      />
    </Card>
  );
}
