"use client";

// ═══════════════════════════════════════════════════════════════════════
// A · Reporte de actividad al propietario.
//
// Es lo ÚNICO de este sistema que ve un cliente del cliente: el dueño que
// dio la exclusiva y quiere saber qué se ha hecho con su casa. Por eso
// empieza por la lectura en texto claro y no por una tabla — el propietario
// no quiere doce columnas, quiere que alguien le diga qué está pasando.
//
// 🔴 LO QUE ESTA PANTALLA NO DICE, Y ES A PROPÓSITO: cuántas VECES se vio
// el anuncio. Ningún portal nos devuelve su contador y la web no lleva uno.
// Se dice cuánta gente ESCRIBIÓ desde cada portal, con ese nombre, y se
// explica la diferencia. Inventarle vistas al propietario sería mentirle
// con un número redondo.
//
// i18n CONVENCIÓN B: sub-árbol ya recortado, prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { MessageCircle, Link2 } from "lucide-react";
import type { TFunction } from "@/i18n/t";
import { formatCents, formatShortDate } from "@/lib/realty/rent-charges";
import { formatMinutes } from "@/lib/realty/commissions";
import { formatPctOrDash } from "@/lib/realty/owner-report";
import type { OwnerActivityReport } from "@/lib/realty/owner-report";
import { Card, EmptyState, Kpi, Note, Pill } from "../rentals/ui";
import {
  BlockHead,
  ExportBar,
  Hint,
  Money,
  PeriodBar,
  TableWrap,
} from "./reports-shared";

export interface OwnerPanelProps {
  t: TFunction;
  report: OwnerActivityReport | null;
  properties: Array<{ id: string; title: string }>;
  selectedId: string | null;
  from: string;
  to: string;
  /** El propietario tiene teléfono capturado y el plan trae WhatsApp. */
  canWhatsapp: boolean;
  onNavigate: (params: Record<string, string | null>) => void;
}

export function OwnerReportPanel({
  t,
  report,
  properties,
  selectedId,
  from,
  to,
  canWhatsapp,
  onNavigate,
}: OwnerPanelProps) {
  const router = useRouter();
  const [dFrom, setDFrom] = useState(from);
  const [dTo, setDTo] = useState(to);
  const [sending, setSending] = useState(false);

  const query = report
    ? `?propertyId=${encodeURIComponent(report.propertyId)}&from=${report.from}&to=${report.to}`
    : "";

  async function enviarWhatsapp() {
    if (!report) return;
    setSending(true);
    try {
      const res = await fetch("/api/realty/reports/propietario/enviar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: report.propertyId, from: report.from, to: report.to }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        reason?: string;
      };
      if (!res.ok || !data.ok) {
        // La razón importa: "no se pudo" a secas deja al asesor sin saber si
        // reintentar o copiar la liga a mano.
        const key =
          data.reason === "window"
            ? "propietario.waSinVentana"
            : data.reason === "phone"
              ? "propietario.waSinTelefono"
              : data.reason === "plan"
                ? "propietario.waSinPlan"
                : null;
        throw new Error(key ? t(key) : data.error || t("propietario.waSinVentana"));
      }
      toast.success(t("propietario.waListo"));
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("propietario.waSinVentana"));
    } finally {
      setSending(false);
    }
  }

  async function copiarLiga() {
    if (!report) return;
    try {
      const res = await fetch(
        `/api/realty/reports/propietario/liga${query}`,
      );
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "");
      await navigator.clipboard.writeText(data.url);
      toast.success(t("acciones.ligaCopiada"));
    } catch {
      toast.error(t("acciones.copiarLiga"));
    }
  }

  return (
    <div className="rep-stack">
      <div className="rep-toolbar">
        <label className="rep-pick">
          <span>{t("propietario.elegirInmueble")}</span>
          <select
            className="rnt-select"
            value={selectedId ?? ""}
            onChange={(e) => onNavigate({ propertyId: e.target.value || null })}
          >
            <option value="">{t("propietario.sinInmueble")}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
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

      {!selectedId ? (
        <Card>
          <EmptyState
            title={t("propietario.title")}
            body={t("propietario.sinInmueble")}
          />
        </Card>
      ) : !report ? (
        <Card>
          <EmptyState title={t("propietario.title")} body={t("propietario.noEncontrado")} />
        </Card>
      ) : (
        <>
          <div className="rep-toolbar">
            <div style={{ minWidth: 0 }}>
              <h2 className="rep-blockhead__title">{report.propertyTitle}</h2>
              <Hint>
                {report.address ? `${report.address} · ` : ""}
                {t("propietario.precioLista")}:{" "}
                {formatCents(report.askingPriceCents, report.currency)}
                {report.ownerName ? ` · ${report.ownerName}` : ""}
              </Hint>
            </div>
            <ExportBar
              pdfHref={`/api/realty/reports/propietario/pdf${query}`}
              csvHref={`/api/realty/reports/propietario${query}&formato=csv`}
              pdfLabel={t("acciones.pdf")}
              csvLabel={t("acciones.hoja")}
            >
              <button type="button" className="rnt-btn rnt-btn--sm" onClick={copiarLiga}>
                <Link2 size={13} />
                {t("acciones.copiarLiga")}
              </button>
              {canWhatsapp ? (
                <button
                  type="button"
                  className="rnt-btn rnt-btn--sm rnt-btn--primary"
                  onClick={enviarWhatsapp}
                  disabled={sending}
                >
                  <MessageCircle size={13} />
                  {sending ? t("acciones.enviando") : t("acciones.whatsapp")}
                </button>
              ) : null}
            </ExportBar>
          </div>

          {/* ── La lectura. Va PRIMERO: es lo que el propietario lee. ── */}
          <div
            className={
              report.recommendation.tone === "PRECIO" ||
              report.recommendation.tone === "SIN_ANUNCIO"
                ? "rep-advice rep-advice--warning"
                : "rep-advice"
            }
          >
            <div className="rep-advice__head">{report.recommendation.headline}</div>
            <p className="rep-advice__body">{report.recommendation.body}</p>
            {report.recommendation.actions.length > 0 ? (
              <ul className="rep-advice__actions">
                {report.recommendation.actions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* ── Dónde está anunciado y qué trajo cada lado ── */}
          <Card>
            <BlockHead
              title={t("propietario.anuncio")}
              note={t("propietario.sinVistas")}
            />
            {report.portals.length === 0 ? (
              <EmptyState
                title={t("propietario.noPublicado")}
                body={t("propietario.sinVistas")}
              />
            ) : (
              <TableWrap>
                <table className="rnt-table">
                  <thead>
                    <tr>
                      <th>{t("propietario.portal")}</th>
                      <th>{t("propietario.estado")}</th>
                      <th>{t("propietario.ultimaSync")}</th>
                      <th className="num">{t("propietario.contactos")}</th>
                      <th className="num">{t("propietario.visitasCol")}</th>
                      <th className="num">{t("propietario.ofertasCol")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.portals.map((p) => (
                      <tr key={p.portal}>
                        <td className="rnt-strong">{p.label}</td>
                        <td>
                          <Pill tone={p.published ? "success" : "neutral"} dot>
                            {p.published
                              ? t("propietario.publicado")
                              : t("propietario.noPublicado")}
                          </Pill>
                        </td>
                        <td className="rnt-muted">
                          {p.lastPushedAt ? formatShortDate(p.lastPushedAt) : "—"}
                        </td>
                        <td className="num">{p.leads}</td>
                        <td className="num">{p.visits}</td>
                        <td className="num">{p.offers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>

          {/* ── El interés ── */}
          <Card title={t("propietario.interes")}>
            <div className="rep-kpis">
              <Kpi label={t("propietario.kpiLeads")} value={String(report.leads)} />
              <Kpi label={t("propietario.kpiLlamadas")} value={String(report.calls)} />
              <Kpi label={t("propietario.kpiMensajes")} value={String(report.messages)} />
              <Kpi
                label={t("propietario.kpiRespuesta")}
                value={formatMinutes(report.response.medianMinutes)}
              />
              <Kpi
                label={t("propietario.kpiSinContestar")}
                value={String(report.response.unanswered)}
                tone={report.response.unanswered > 0 ? "danger" : undefined}
              />
            </div>
          </Card>

          {/* ── Las visitas y qué opinaron ── */}
          <Card title={t("propietario.visitas")}>
            <div className="rep-kpis" style={{ marginBottom: 14 }}>
              <Kpi
                label={t("propietario.kpiVisitas")}
                value={String(report.visitsHappened)}
              />
              <Kpi
                label={t("propietario.kpiAgendadas")}
                value={String(report.visitsScheduled)}
              />
              <Kpi
                label={t("propietario.kpiCanceladas")}
                value={String(report.visitsCancelled)}
              />
              <Kpi label={t("propietario.kpiNoAsistio")} value={String(report.visitsNoShow)} />
              <Kpi
                label={t("propietario.hablaronDelPrecio")}
                value={String(report.priceObjections)}
                tone={report.priceObjections > 0 ? "danger" : undefined}
              />
            </div>

            {report.visits.length === 0 ? (
              <EmptyState
                title={t("propietario.sinVisitasTitulo")}
                body={t("propietario.sinVisitasCuerpo")}
              />
            ) : (
              <>
                {report.feedbackCount === 0 ? (
                  <Note tone="info">{t("propietario.sinFeedbackCuerpo")}</Note>
                ) : null}
                <TableWrap>
                  <table className="rnt-table">
                    <thead>
                      <tr>
                        <th>{t("propietario.cuando")}</th>
                        <th>{t("propietario.quien")}</th>
                        <th>{t("propietario.asesor")}</th>
                        <th>{t("propietario.opinion")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.visits.map((v) => (
                        <tr key={v.id}>
                          <td>{formatShortDate(v.scheduledAt)}</td>
                          <td>{v.visitorName ?? "—"}</td>
                          <td className="rnt-muted">{v.agentName ?? "—"}</td>
                          <td>
                            {v.feedback ? (
                              <span className="rep-quote">
                                {v.feedback}
                                {v.priceObjection ? (
                                  <>
                                    {" "}
                                    <Pill tone="warning">
                                      {t("propietario.hablaronDelPrecio")}
                                    </Pill>
                                  </>
                                ) : null}
                              </span>
                            ) : (
                              <span className="rep-quote rep-quote--empty">
                                {t("propietario.sinOpinion")}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              </>
            )}
          </Card>

          {/* ── Ofertas ── */}
          <Card title={t("propietario.ofertas")}>
            {report.closedDeal ? (
              <Note tone="brand">
                {t("propietario.cerrada")} ·{" "}
                {report.closedDeal.amountCents !== null && report.closedDeal.currency ? (
                  <Money
                    cents={report.closedDeal.amountCents}
                    currency={report.closedDeal.currency}
                  />
                ) : null}
              </Note>
            ) : null}
            {report.offers.length === 0 && !report.closedDeal ? (
              <EmptyState
                title={t("propietario.sinOfertasTitulo")}
                body={t("propietario.sinOfertasCuerpo")}
              />
            ) : report.offers.length > 0 ? (
              <TableWrap>
                <table className="rnt-table">
                  <thead>
                    <tr>
                      <th>{t("propietario.quien")}</th>
                      <th>{t("propietario.cuando")}</th>
                      <th>{t("propietario.estado")}</th>
                      <th className="num">{t("fiscal.monto")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.offers.map((o) => (
                      <tr key={`${o.kind}-${o.id}`}>
                        <td className="rnt-strong">{o.who}</td>
                        <td>{o.when ? formatShortDate(o.when) : "—"}</td>
                        <td>{o.status}</td>
                        <td className="num">
                          {o.amountCents !== null && o.currency ? (
                            <Money cents={o.amountCents} currency={o.currency} />
                          ) : (
                            <span className="rnt-muted">
                              {t("propietario.montoNoRegistrado")}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : null}
          </Card>

          {/* ── La zona ── */}
          {report.zone ? (
            <Card>
              <BlockHead title={t("propietario.zona")} note={t("propietario.zonaMetodo")} />
              <div className="rep-kpis">
                <Kpi
                  label={t("propietario.zonaOperaciones")}
                  value={String(report.zone.closedCount)}
                />
                <Kpi
                  label={t("propietario.zonaMediana")}
                  value={formatCents(report.zone.medianClosedCents, report.zone.currency)}
                />
                <Kpi
                  label={t("propietario.zonaDiferencia")}
                  value={
                    report.zone.deltaPct === null
                      ? "—"
                      : `${report.zone.deltaPct > 0 ? "+" : ""}${formatPctOrDash(report.zone.deltaPct)}`
                  }
                  tone={
                    report.zone.deltaPct !== null && report.zone.deltaPct > 10
                      ? "danger"
                      : undefined
                  }
                />
              </div>
            </Card>
          ) : null}

          <Hint>
            {t("generado", { fecha: formatShortDate(report.generatedAt) })}
          </Hint>
        </>
      )}
    </div>
  );
}
