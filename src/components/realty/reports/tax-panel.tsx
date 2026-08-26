"use client";

// ═══════════════════════════════════════════════════════════════════════
// C · Resumen anual del arrendador.
//
// El SAT ya está mirando los montos de las rentas y el arrendador necesita
// llevarle algo a su contador que no sea una libreta. Esto es ESO: qué
// entró, qué se gastó, qué le retuvo la inmobiliaria y con qué fecha entró
// cada pago.
//
// 🔴 TRES COSAS QUE ESTA PANTALLA NO PUEDE DECIR, Y LO DICE ELLA MISMA:
//   1. No es una declaración. Es un resumen para el contador.
//   2. NO HAY CFDI. Este vertical no factura, no timbra y no emite
//      complementos de pago. Lo que hay son RECIBOS y así se llaman.
//   3. "Retenido" es la COMISIÓN DE ADMINISTRACIÓN de la inmobiliaria, no
//      un impuesto. Confundirlos sería decirle al arrendador que le
//      retuvimos ISR — y nadie le retuvo nada.
//
// i18n CONVENCIÓN B: sub-árbol ya recortado, prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import type { TFunction } from "@/i18n/t";
import { formatShortDate } from "@/lib/realty/rent-charges";
import type { TaxSummary } from "@/lib/realty/reports";
import { Card, EmptyState, Note } from "../rentals/ui";
import {
  BlockHead,
  ExportBar,
  Hint,
  MixedCurrencyNote,
  Money,
  MoneyLine,
  TableWrap,
} from "./reports-shared";

export interface TaxPanelProps {
  t: TFunction;
  report: TaxSummary;
  owners: Array<{ id: string; name: string; properties: number }>;
  years: number[];
  onNavigate: (params: Record<string, string | null>) => void;
}

export function TaxPanel({ t, report, owners, years, onNavigate }: TaxPanelProps) {
  const query = `?year=${report.year}${report.ownerId ? `&ownerId=${encodeURIComponent(report.ownerId)}` : ""}`;
  const empty = report.properties.length === 0 && report.payments.length === 0;

  return (
    <div className="rep-stack">
      <div className="rep-toolbar">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="rep-pick" style={{ flex: "0 0 130px" }}>
            <span>{t("fiscal.elegirAno")}</span>
            <select
              className="rnt-select"
              value={String(report.year)}
              onChange={(e) => onNavigate({ year: e.target.value })}
            >
              {years.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="rep-pick">
            <span>{t("cartera.elegirPropietario")}</span>
            <select
              className="rnt-select"
              value={report.ownerId ?? ""}
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
        </div>
        <ExportBar
          pdfHref={`/api/realty/reports/fiscal/pdf${query}`}
          csvHref={`/api/realty/reports/fiscal${query}&formato=csv`}
          pdfLabel={t("acciones.pdf")}
          csvLabel={t("acciones.hoja")}
        />
      </div>

      <BlockHead title={t("fiscal.title")} sub={t("fiscal.subtitle")} />

      {/* Los dos avisos van ARRIBA, no al pie: si alguien solo lee la
          primera pantalla, tiene que haber leído esto. */}
      <Note tone="info">{t("fiscal.aviso")}</Note>
      <Note tone="warning">{t("fiscal.sinCfdi")}</Note>

      {empty ? (
        <Card>
          <EmptyState
            title={t("fiscal.sinDatosTitulo", { ano: report.year })}
            body={t("fiscal.sinDatosCuerpo")}
          />
        </Card>
      ) : (
        <>
          {report.ownerName ? (
            <Hint>
              {report.ownerName}
              {report.ownerRfc ? ` · RFC ${report.ownerRfc}` : ""} · {report.from} → {report.to}
            </Hint>
          ) : null}

          <div className="rep-headline">
            <div className="rep-headline__cell">
              <div className="rep-headline__label">{t("fiscal.ingresosTotales")}</div>
              <div className="rep-headline__value">
                <MoneyLine money={report.totalIncome} block />
              </div>
            </div>
            <div className="rep-headline__cell">
              <div className="rep-headline__label">{t("fiscal.gastosTotales")}</div>
              <div className="rep-headline__value">
                <MoneyLine money={report.totalExpenses} block />
              </div>
              <Hint>
                {t("fiscal.deduciblesProbables")}:{" "}
                <MoneyLine money={report.totalLikelyDeductible} />
              </Hint>
            </div>
            <div className="rep-headline__cell">
              <div className="rep-headline__label">{t("fiscal.retenido")}</div>
              <div className="rep-headline__value">
                <MoneyLine money={report.totalRetained} block />
              </div>
              <Hint>
                {t("fiscal.netoTotal")}: <MoneyLine money={report.totalNet} />
              </Hint>
            </div>
          </div>

          <MixedCurrencyNote
            money={[report.totalIncome, report.totalExpenses, report.totalRetained]}
            text={t("moneda.mezcla")}
            extra={t("moneda.sinConversion")}
          />

          <Note tone="warning">{t("fiscal.retenidoNota")}</Note>
          {report.withoutCommissionPct > 0 ? (
            <Note tone="info">
              {t("fiscal.sinComisionPactada", { n: report.withoutCommissionPct })}
            </Note>
          ) : null}

          <Card flush>
            <div style={{ padding: "14px 16px 0" }}>
              <BlockHead
                title={t("fiscal.porInmueble")}
                note={t("fiscal.deduciblesNota")}
              />
            </div>
            <TableWrap>
              <table className="rnt-table">
                <thead>
                  <tr>
                    <th>{t("cartera.inmueble")}</th>
                    <th className="num">{t("cartera.ingresos")}</th>
                    <th className="num">{t("cartera.gastos")}</th>
                    <th className="num">{t("fiscal.deduciblesProbables")}</th>
                    <th className="num">{t("fiscal.retenido")}</th>
                    <th className="num">{t("fiscal.netoTotal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.properties.map((p) => (
                    <tr key={p.propertyId}>
                      <td>
                        <div className="rnt-strong">{p.title}</div>
                        <div className="rnt-muted">
                          {p.address ?? "—"}
                          {p.commissionPct !== null && p.commissionPct > 0
                            ? ` · ${p.commissionPct} %`
                            : ""}
                        </div>
                      </td>
                      <td className="num">
                        <MoneyLine money={p.income} zero={p.currency} />
                      </td>
                      <td className="num">
                        <MoneyLine money={p.expenses} zero={p.currency} />
                      </td>
                      <td className="num">
                        <MoneyLine money={p.likelyDeductible} zero={p.currency} />
                      </td>
                      <td className="num">
                        <MoneyLine money={p.retained} zero={p.currency} />
                      </td>
                      <td className="num">
                        <MoneyLine money={p.net} zero={p.currency} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>

          <Card flush>
            <div style={{ padding: "14px 16px 0" }}>
              <BlockHead title={t("fiscal.detallePagos")} />
            </div>
            {report.payments.length === 0 ? (
              <div style={{ padding: "0 16px 16px" }}>
                <EmptyState
                  title={t("fiscal.sinDatosTitulo", { ano: report.year })}
                  body={t("fiscal.sinDatosCuerpo")}
                />
              </div>
            ) : (
              <TableWrap>
                <table className="rnt-table">
                  <thead>
                    <tr>
                      <th>{t("fiscal.fecha")}</th>
                      <th>{t("cartera.inmueble")}</th>
                      <th>{t("fiscal.periodo")}</th>
                      <th>{t("fiscal.forma")}</th>
                      <th>{t("fiscal.referencia")}</th>
                      <th>{t("fiscal.recibo")}</th>
                      <th className="num">{t("fiscal.monto")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{formatShortDate(p.paidAt)}</td>
                        <td>{p.propertyTitle}</td>
                        <td className="rnt-muted">{p.periodMonth ?? "—"}</td>
                        <td className="rnt-muted">{p.method}</td>
                        <td className="rnt-muted">{p.reference ?? "—"}</td>
                        <td className="rnt-muted">
                          {p.receiptFolio || t("fiscal.sinRecibo")}
                        </td>
                        <td className="num">
                          <Money cents={p.cents} currency={p.currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          {report.orphanPayments > 0 ? (
            <Note tone="warning">{t("pagosHuerfanos", { n: report.orphanPayments })}</Note>
          ) : null}

          <Hint>{t("generado", { fecha: formatShortDate(report.generatedAt) })}</Hint>
        </>
      )}
    </div>
  );
}
