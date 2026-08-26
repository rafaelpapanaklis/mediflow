"use client";

// ═══════════════════════════════════════════════════════════════════════
// E · Reportes de la operación.
//
// Cinco bloques, y cada uno confiesa de dónde sale su número. Esa nota de
// método no es adorno: son cifras con las que alguien va a decidir dónde
// gastar su dinero de publicidad y a quién llamarle la atención. Un número
// sin método es una opinión con formato de dato.
//
// Cada bloque se pinta SOLO si el usuario tiene su permiso: la página se
// abre con `properties.view` y un asesor raso llegaría legítimamente aquí.
// El permiso abre la puerta; cada bloque comprueba el suyo.
//
// i18n CONVENCIÓN B: sub-árbol ya recortado, prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import { useState } from "react";
import type { TFunction } from "@/i18n/t";
import { formatMinutes } from "@/lib/realty/commissions";
import {
  REALTY_AGING_UI,
  formatCents,
  formatShortDate,
  monthLabel,
} from "@/lib/realty/rent-charges";
import type { OperationsReport } from "@/lib/realty/reports";
import { Card, EmptyState, Kpi, Note, Pill } from "../rentals/ui";
import {
  BlockHead,
  ExportBar,
  Hint,
  MoneyLine,
  PeriodBar,
  TableWrap,
} from "./reports-shared";

export interface OperationsPanelProps {
  t: TFunction;
  report: OperationsReport;
  from: string;
  to: string;
  onNavigate: (params: Record<string, string | null>) => void;
}

export function OperationsPanel({ t, report, from, to, onNavigate }: OperationsPanelProps) {
  const [dFrom, setDFrom] = useState(from);
  const [dTo, setDTo] = useState(to);
  const query = `?from=${report.from}&to=${report.to}`;

  const nothing =
    !report.funnel && !report.delinquency && !report.commissions && report.portals.length === 0;

  return (
    <div className="rep-stack">
      <div className="rep-toolbar">
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
        <ExportBar
          pdfHref={`/api/realty/reports/operacion/pdf${query}`}
          csvHref={`/api/realty/reports/operacion${query}&formato=csv`}
          pdfLabel={t("acciones.pdf")}
          csvLabel={t("acciones.hoja")}
        />
      </div>

      <BlockHead title={t("operacion.title")} sub={t("operacion.subtitle")} />

      {nothing ? (
        <Card>
          <EmptyState
            title={t("acceso.sinPermisoTitulo")}
            body={t("acceso.sinPermisoBloque")}
          />
        </Card>
      ) : null}

      {/* ── Embudo ── */}
      {report.funnel ? (
        <Card>
          <BlockHead title={t("operacion.embudo")} note={t("operacion.embudoNota")} />
          {report.funnel.total === 0 ? (
            <EmptyState
              title={t("operacion.sinDatosTitulo")}
              body={t("operacion.sinDatosCuerpo")}
            />
          ) : (
            <>
              <div className="rep-funnel">
                {report.funnel.steps.map((s) => {
                  const top = report.funnel?.steps[0]?.count ?? 0;
                  const pct = top > 0 ? Math.max(0, (s.count / top) * 100) : 0;
                  return (
                    <div className="rep-funnel__row" key={s.stage}>
                      <div className="rep-funnel__label">{s.label}</div>
                      <div className="rep-funnel__bar">
                        <div className="rep-funnel__fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="rep-funnel__num">
                        {s.count}
                        {s.fromPreviousPct !== null ? (
                          <span className="rnt-muted"> · {s.fromPreviousPct}%</span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rep-kpis" style={{ marginTop: 16 }}>
                <Kpi label={t("operacion.leads")} value={String(report.funnel.total)} />
                <Kpi
                  label={t("operacion.visitasReales")}
                  value={String(report.funnel.visitsHappened)}
                  hint={`${report.funnel.visitsScheduled} ${t("propietario.kpiAgendadas").toLowerCase()}`}
                />
                <Kpi label={t("operacion.cierres")} value={String(report.funnel.closedDeals)} />
                <Kpi
                  label={t("operacion.perdidos")}
                  value={String(report.funnel.lost)}
                  tone={report.funnel.lost > 0 ? "danger" : undefined}
                />
              </div>
              <Hint>{t("operacion.visitasRealesNota")}</Hint>

              {report.funnel.lostReasons.length > 0 ? (
                <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {report.funnel.lostReasons.map((r) => (
                    <Pill key={r.reason} tone="neutral">
                      {r.label}: {r.count}
                    </Pill>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {/* ── Qué portal cierra ── */}
      {report.portals.length > 0 ? (
        <Card flush>
          <div style={{ padding: "14px 16px 0" }}>
            <BlockHead
              title={t("operacion.portales")}
              sub={t("operacion.portalesNota")}
              note={t("operacion.portalesMetodo")}
            />
          </div>
          <TableWrap>
            <table className="rnt-table">
              <thead>
                <tr>
                  <th>{t("propietario.portal")}</th>
                  <th className="num">{t("operacion.leads")}</th>
                  <th className="num">{t("operacion.contestados")}</th>
                  <th className="num">{t("operacion.visitaron")}</th>
                  <th className="num">{t("operacion.ofertaron")}</th>
                  <th className="num">{t("operacion.cerraron")}</th>
                  <th className="num">{t("operacion.tasaCierre")}</th>
                  <th className="num">{t("operacion.respuestaMediana")}</th>
                </tr>
              </thead>
              <tbody>
                {report.portals.map((p) => (
                  <tr key={p.portal}>
                    <td className="rnt-strong">{p.label}</td>
                    <td className="num">{p.leads}</td>
                    <td className="num">{p.answered}</td>
                    <td className="num">{p.visits}</td>
                    <td className="num">{p.offers}</td>
                    <td className="num">{p.closed}</td>
                    <td className="num">{p.closeRatePct} %</td>
                    <td className="num rnt-muted">
                      {formatMinutes(p.medianResponseMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}

      {/* ── Tiempo de primera respuesta ── */}
      {report.agents.length > 0 ? (
        <Card flush>
          <div style={{ padding: "14px 16px 0" }}>
            <BlockHead
              title={t("operacion.asesores")}
              sub={t("operacion.asesoresNota")}
              note={t("operacion.asesoresMetodo")}
            />
          </div>
          <TableWrap>
            <table className="rnt-table">
              <thead>
                <tr>
                  <th>{t("operacion.asesor")}</th>
                  <th className="num">{t("operacion.leads")}</th>
                  <th className="num">{t("operacion.promedio")}</th>
                  <th className="num">{t("operacion.mediana")}</th>
                  <th className="num">{t("operacion.sinContestar")}</th>
                  <th className="num">{t("operacion.conversion")}</th>
                </tr>
              </thead>
              <tbody>
                {report.agents.map((a) => (
                  <tr key={a.realtyUserId}>
                    <td className="rnt-strong">
                      {a.name}
                      {a.active ? null : (
                        <>
                          {" "}
                          <Pill tone="neutral">—</Pill>
                        </>
                      )}
                    </td>
                    <td className="num">{a.leads}</td>
                    <td className="num">{formatMinutes(a.avgResponseMinutes)}</td>
                    <td className="num">{formatMinutes(a.medianResponseMinutes)}</td>
                    <td className="num">{a.unanswered}</td>
                    <td className="num">{a.conversionPct} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      ) : null}

      {/* ── Morosidad ── */}
      {report.delinquency ? (
        <Card>
          <BlockHead
            title={t("operacion.morosidad")}
            note={t("operacion.morosidadNota")}
            right={<MoneyLine money={report.delinquency.overdue} />}
          />
          <div className="rep-kpis">
            <Kpi
              label={t("operacion.vencido")}
              value={String(report.delinquency.overdueCount)}
              tone={report.delinquency.overdueCount > 0 ? "danger" : undefined}
            />
            {report.delinquency.buckets.map((b) => (
              <Kpi
                key={b.key}
                label={REALTY_AGING_UI[b.key].short}
                value={String(b.count)}
                hint={
                  b.balance.MXN !== 0 || b.balance.USD !== 0
                    ? [
                        b.balance.MXN !== 0 ? formatCents(b.balance.MXN, "MXN") : null,
                        b.balance.USD !== 0 ? formatCents(b.balance.USD, "USD") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined
                }
                tone={b.key === "D30_MAS" && b.count > 0 ? "danger" : undefined}
              />
            ))}
          </div>

          {report.delinquency.rows.length > 0 ? (
            <TableWrap>
              <table className="rnt-table" style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th>{t("cartera.inmueble")}</th>
                    <th>{t("operacion.inquilino")}</th>
                    <th>{t("fiscal.periodo")}</th>
                    <th className="num">{t("operacion.diasTarde")}</th>
                    <th>{t("operacion.antiguedad")}</th>
                    <th className="num">{t("operacion.saldo")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.delinquency.rows.slice(0, 60).map((r) => (
                    <tr key={r.chargeId}>
                      <td className="rnt-strong">{r.propertyTitle}</td>
                      <td>{r.tenantName}</td>
                      <td className="rnt-muted">{monthLabel(r.periodMonth)}</td>
                      <td className="num">{r.daysLate}</td>
                      <td>
                        <Pill tone={REALTY_AGING_UI[r.aging].tone} dot>
                          {REALTY_AGING_UI[r.aging].short}
                        </Pill>
                      </td>
                      <td className="num">{formatCents(r.balanceCents, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : null}

          {report.delinquency.projection.length > 0 ? (
            <>
              <div style={{ marginTop: 18 }}>
                <BlockHead
                  title={t("operacion.proyeccion")}
                  note={t("operacion.proyeccionNota")}
                />
              </div>
              <TableWrap>
                <table className="rnt-table">
                  <thead>
                    <tr>
                      <th>{t("fiscal.periodo")}</th>
                      <th className="num">{t("operacion.cargos")}</th>
                      <th className="num">{t("operacion.esperado")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.delinquency.projection.map((p) => (
                      <tr key={p.periodMonth}>
                        <td>{monthLabel(p.periodMonth)}</td>
                        <td className="num">{p.charges}</td>
                        <td className="num">
                          <MoneyLine money={p.expected} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>
          ) : null}
        </Card>
      ) : null}

      {/* ── Comisiones ── */}
      {report.commissions ? (
        <Card>
          <BlockHead
            title={t("operacion.comisiones")}
            note={t("operacion.comisionesNota")}
          />
          <div className="rep-kpis">
            <Kpi
              label={t("operacion.operaciones")}
              value={String(report.commissions.closedDeals)}
            />
            <Kpi
              label={t("operacion.volumen")}
              value={moneyText(report.commissions.closedVolume)}
            />
            <Kpi
              label={t("operacion.comisionCasa")}
              value={moneyText(report.commissions.houseCommission)}
            />
            <Kpi
              label={t("operacion.salioDeCaja")}
              value={moneyText(report.commissions.paidInPeriod)}
            />
          </div>

          {report.commissions.mixedCurrency ? (
            <Note tone="warning">{t("operacion.comisionesMezcla")}</Note>
          ) : null}

          {report.commissions.receipt.lines.length === 0 ? (
            <EmptyState
              title={t("operacion.sinDatosTitulo")}
              body={t("operacion.sinDatosCuerpo")}
            />
          ) : (
            <TableWrap>
              <table className="rnt-table" style={{ marginTop: 14 }}>
                <thead>
                  <tr>
                    <th>{t("operacion.beneficiario")}</th>
                    <th className="num">{t("operacion.operaciones")}</th>
                    <th className="num">{t("operacion.devengado")}</th>
                    <th className="num">{t("operacion.pagado")}</th>
                    <th className="num">{t("operacion.pendiente")}</th>
                    <th className="num">{t("operacion.enProceso")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.commissions.receipt.lines.map((l) => (
                    <tr key={l.beneficiaryId}>
                      <td className="rnt-strong">{l.beneficiary}</td>
                      <td className="num">{l.operations}</td>
                      <td className="num">{l.earned.toFixed(2)}</td>
                      <td className="num">{l.paid.toFixed(2)}</td>
                      <td className="num">{l.pending.toFixed(2)}</td>
                      <td className="num rnt-muted">{l.inProgress.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      ) : null}

      <Hint>{t("generado", { fecha: formatShortDate(report.generatedAt) })}</Hint>
    </div>
  );
}

/** Un total por moneda como texto plano, para meterlo dentro de un <Kpi>. */
function moneyText(money: { MXN: number; USD: number }): string {
  const parts: string[] = [];
  if (money.MXN !== 0) parts.push(formatCents(money.MXN, "MXN"));
  if (money.USD !== 0) parts.push(formatCents(money.USD, "USD"));
  if (parts.length === 0) return formatCents(0, "MXN");
  return parts.join(" · ");
}
