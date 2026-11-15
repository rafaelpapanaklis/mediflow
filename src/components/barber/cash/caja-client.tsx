"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Banknote,
  CreditCard,
  Landmark,
  Lock,
  PlusCircle,
  Printer,
  Receipt,
  Unlock,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CashSessionRow, CashState, CheckoutContext, PendingAppointment, SaleRow } from "@/lib/barber/cash";
import { sumMoneyBy } from "@/lib/barber/money";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { useBarberT } from "./use-barber-t";
import { fmtMoney, fmtSigned, fmtTime, fmtDateTime, PAYMENT_METHOD_KEYS } from "./money";
import { TicketModal } from "./ticket-modal";
import type { SaleDraftList, SaleDraftRow } from "@/lib/barber/sale-drafts";
import { SaleDraftsList } from "@/components/barber/clients/sale-drafts-list";
import { ClientChargeBridge } from "@/components/barber/clients/client-charge-bridge";
import { CancelSaleModal, CloseSessionModal, OpenSessionModal } from "./session-modals";
import { SessionDetailModal } from "./session-detail";

type ModalState =
  | { kind: "none" }
  | { kind: "ticket"; appointment: PendingAppointment | null }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "cancel"; sale: SaleRow }
  | { kind: "history"; row: CashSessionRow };

const METHOD_ICON: Record<BarberPaymentMethod, LucideIcon> = {
  CASH: Banknote,
  CARD: CreditCard,
  SPEI: Landmark,
  STRIPE: CreditCard,
};

export function CajaClient({
  dict,
  state,
  checkout,
  canManage,
  starsDict,
  locale = "es",
  drafts = null,
  cobrosDict,
}: {
  dict: Dictionary;
  state: CashState;
  checkout: CheckoutContext;
  canManage: boolean;
  /** Sub-árbol barber.estrellas (bono en el cobro y «+1 estrella» al terminar). */
  starsDict?: Dictionary;
  locale?: string;
  /** Notas «Por cobrar» abiertas de la sede (null = sin permiso o sin SQL). */
  drafts?: SaleDraftList | null;
  /** Sub-árbol barber.cobros (textos de las notas «Por cobrar»). */
  cobrosDict?: Dictionary;
}) {
  const t = useBarberT(dict);
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [chargeDraft, setChargeDraft] = useState<SaleDraftRow | null>(null);
  const closeModal = useCallback(() => setModal({ kind: "none" }), []);
  // El refresco del servidor tarda 1-4 s: mientras tanto se dice «Actualizando…» (QA E, ronda 4).
  const [refreshing, startRefresh] = useTransition();
  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  const open = state.open;
  const tz = state.timezone;
  const methodLabel = (m: BarberPaymentMethod) => t(PAYMENT_METHOD_KEYS[m]);

  return (
    <div className="bcaja-page bcaja-page--caja bd-page">
      {/* Encabezado */}
      <div className="bcaja-head">
        <div>
          <h1 className="bcaja-head__title">{t("caja.title")}</h1>
          <p className="bcaja-head__sub">{refreshing ? <span role="status" aria-live="polite">{t("common.updating")}</span> : t("caja.subtitle")}</p>
        </div>
        <div className="bcaja-head__actions">
          {canManage && !open && (
            <button type="button" className="btn-new barber-btn-primary" onClick={() => setModal({ kind: "open" })}>
              <Unlock size={15} /> {t("caja.openSession")}
            </button>
          )}
          {canManage && open && (
            <>
              <button type="button" className="btn-new btn-new--secondary" onClick={() => setModal({ kind: "close" })}>
                <Lock size={15} /> {t("caja.closeSession")}
              </button>
              <button type="button" className="btn-new barber-btn-primary" onClick={() => setModal({ kind: "ticket", appointment: null })}>
                <PlusCircle size={15} /> {t("caja.newTicket")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Estado del turno */}
      <div className="bcaja-session">
        <span className={`bcaja-session__dot ${open ? "" : "bcaja-session__dot--off"}`} />
        {open ? (
          <>
            <span className="bcaja-session__main">
              {t("caja.sessionOpenSince", { time: fmtDateTime(open.session.openedAt, tz) })}
            </span>
            <span className="bcaja-session__meta">{t("caja.openedBy", { name: open.session.openedByName })}</span>
            <span className="bcaja-session__meta">
              {t("caja.openingAmount")}: <strong>{fmtMoney(open.session.openingAmount)}</strong>
            </span>
          </>
        ) : (
          <>
            <span className="bcaja-session__main">{t("caja.noSessionTitle")}</span>
            <span className="bcaja-session__meta">{canManage ? t("caja.noSessionBody") : t("caja.noCashManage")}</span>
          </>
        )}
        {!canManage && open && <span className="bcaja-session__meta">{t("caja.noCashManage")}</span>}
      </div>

      {/* KPIs del turno */}
      {open && (
        <div className="bcaja-kpis bd-band">
          <KpiCard label={t("caja.expectedCash")} value={fmtMoney(open.expectedCash)} icon={Banknote} hero hint={t("caja.expectedCashHint")} />
          <KpiCard label={t("caja.ticketsCount")} value={String(open.session.ticketCount)} icon={Receipt} />
          <KpiCard label={t("caja.salesTotal")} value={fmtMoney(open.session.salesTotal)} />
          <KpiCard label={t("caja.tipsTotal")} value={fmtMoney(open.session.tipsTotal)} hint={open.cashTips > 0 ? `${t("caja.cashTips")}: ${fmtMoney(open.cashTips)}` : undefined} />
        </div>
      )}

      {open && (
        <div className="bcaja-low" aria-label={t("caja.byMethod")}>
          {(["CASH", "CARD", "SPEI"] as BarberPaymentMethod[]).map((m) => {
            const Icon = METHOD_ICON[m];
            const b = open.byMethod[m];
            return (
              <span key={m} className="bcaja-low__item" style={{ background: "var(--bg-elev)", color: "var(--text-2)", borderColor: "var(--border-soft)" }}>
                <Icon size={13} /> {methodLabel(m)}: <strong style={{ color: "var(--text-1)" }}>{fmtMoney(b.total)}</strong>
                <span className="bcaja-muted">({b.count})</span>
              </span>
            );
          })}
        </div>
      )}

      {/* Citas por cobrar | Tickets del turno */}
      <div className="bcaja-cols">
        <CardNew title={t("caja.pendingTitle")} sub={open ? undefined : t("caja.needsSession")}>
          {checkout.pendingAppointments.length === 0 ? (
            <p className="bcaja-hint" style={{ margin: 0 }}>{t("caja.pendingEmpty")}</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {checkout.pendingAppointments.map((a) => {
                const total = sumMoneyBy(a.services, (x) => x.priceAtBooking);
                return (
                  <div key={a.id} className="bcaja-appt">
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <span className="bcaja-appt__time">{fmtTime(a.startAt, tz)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div className="bcaja-appt__name">{a.clientName ?? t("caja.walkIn")}</div>
                        <div className="bcaja-appt__meta">
                          {a.services.map((s) => s.name).join(", ")}
                          {a.barberName ? ` · ${a.barberName}` : ""}
                          {a.deposit ? ` · ${t("caja.pendingDeposit", { amount: fmtMoney(a.deposit.amount) })}` : ""}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                      <span className="bcaja-appt__price">{fmtMoney(total)}</span>
                      {canManage && (
                        <button
                          type="button"
                          className="btn-new btn-new--sm barber-btn-primary"
                          disabled={!open}
                          onClick={() => setModal({ kind: "ticket", appointment: a })}
                        >
                          {t("caja.charge")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardNew>

        <CardNew title={t("caja.ticketsTitle")} noPad>
          {!open || open.sales.length === 0 ? (
            <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("caja.ticketsEmpty")}</p>
          ) : (
            <div className="bcaja-table-wrap">
              {/* En celular cada ticket es una ficha (bcaja-tickets en money.css). */}
              <table className="table-new bcaja-tickets">
                <thead>
                  <tr>
                    <th>{t("caja.colTime")}</th>
                    <th>{t("caja.colClient")}</th>
                    <th>{t("caja.colBarber")}</th>
                    <th>{t("caja.colItems")}</th>
                    <th>{t("caja.colMethod")}</th>
                    <th className="bcaja-num">{t("caja.colTip")}</th>
                    <th className="bcaja-num">{t("caja.colTotal")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {open.sales.map((s) => (
                    <tr key={s.id} className={s.cancelled ? "bcaja-strike" : undefined}>
                      <td data-label={t("caja.colTime")}>{fmtTime(s.createdAt, tz)}</td>
                      <td data-label={t("caja.colClient")}>{s.clientName ?? <span className="bcaja-muted">{t("common.none")}</span>}</td>
                      <td data-label={t("caja.colBarber")}>{s.barberName ?? <span className="bcaja-muted">{t("common.none")}</span>}</td>
                      <td data-label={t("caja.colItems")} style={{ whiteSpace: "normal", maxWidth: 260 }}>
                        {s.cancelled ? <BadgeNew tone="neutral">{t("common.cancelled")}</BadgeNew> : s.itemsSummary}
                      </td>
                      <td data-label={t("caja.colMethod")}>{methodLabel(s.paymentMethod)}</td>
                      <td className="bcaja-num" data-label={t("caja.colTip")}>{fmtMoney(s.tip)}</td>
                      <td className="bcaja-num" data-label={t("caja.colTotal")}><strong>{fmtMoney(s.total)}</strong></td>
                      <td>
                        <span className="bcaja-row-actions">
                          <Link href={`/barber/caja/ticket/${s.id}`} className="icon-btn-new" title={t("caja.view")} aria-label={t("caja.view")}>
                            <Printer size={13} />
                          </Link>
                          {canManage && !s.cancelled && (
                            <button type="button" className="icon-btn-new" title={t("caja.cancelTicket")} aria-label={t("caja.cancelTicket")} onClick={() => setModal({ kind: "cancel", sale: s })}>
                              <XCircle size={13} />
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardNew>
      </div>

      {/* Notas «Por cobrar» de la sede: no son ingreso hasta que se cobran. */}
      {drafts?.ready && drafts.drafts.length > 0 && cobrosDict ? (
        <div id="por-cobrar" className="card" style={{ padding: 0, overflow: "hidden", scrollMarginTop: 16 }}>
          <SaleDraftsList
            drafts={drafts.drafts}
            dict={cobrosDict}
            locale={locale}
            timezone={tz}
            showClient
            canManage={canManage}
            onCharge={(d) => setChargeDraft(d)}
            onDiscarded={refresh}
          />
        </div>
      ) : null}

      {/* Historial de turnos */}
      <CardNew title={t("caja.historyTitle")} noPad>
        {state.history.length === 0 ? (
          <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("caja.historyEmpty")}</p>
        ) : (
          <div className="bcaja-table-wrap">
            {/* En celular cada turno es una ficha (bcaja-hist en money.css):
                cada celda lleva su etiqueta en data-label. */}
            <table className="table-new bcaja-hist">
              <thead>
                <tr>
                  <th>{t("caja.colOpened")}</th>
                  <th>{t("caja.colClosed")}</th>
                  <th>{t("caja.colWho")}</th>
                  <th className="bcaja-num">{t("caja.colTickets")}</th>
                  <th className="bcaja-num">{t("caja.colOpening")}</th>
                  <th className="bcaja-num">{t("caja.colExpected")}</th>
                  <th className="bcaja-num">{t("caja.colCounted")}</th>
                  <th className="bcaja-num">{t("caja.colDifference")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.history.map((h) => (
                  <tr key={h.id}>
                    <td data-label={t("caja.colOpened")}>{fmtDateTime(h.openedAt, tz)}</td>
                    <td data-label={t("caja.colClosed")}>{fmtDateTime(h.closedAt, tz)}</td>
                    <td data-label={t("caja.colWho")}>{h.openedByName}{h.closedByName && h.closedByName !== h.openedByName ? ` / ${h.closedByName}` : ""}</td>
                    <td className="bcaja-num" data-label={t("caja.colTickets")}>{h.ticketCount}{h.cancelledCount > 0 ? <span className="bcaja-muted"> (+{h.cancelledCount})</span> : null}</td>
                    <td className="bcaja-num" data-label={t("caja.colOpening")}>{fmtMoney(h.openingAmount)}</td>
                    <td className="bcaja-num" data-label={t("caja.colExpected")}>{fmtMoney(h.expectedAmount)}</td>
                    <td className="bcaja-num" data-label={t("caja.colCounted")}>{fmtMoney(h.countedAmount)}</td>
                    <td className="bcaja-num" data-label={t("caja.colDifference")}>
                      {h.difference === null ? "—" : (
                        <BadgeNew tone={h.difference === 0 ? "success" : h.difference > 0 ? "info" : "danger"}>{fmtSigned(h.difference)}</BadgeNew>
                      )}
                    </td>
                    <td>
                      <span className="bcaja-row-actions">
                        <button type="button" className="icon-btn-new" title={t("caja.historyView")} aria-label={t("caja.historyView")} onClick={() => setModal({ kind: "history", row: h })}>
                          <Receipt size={13} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>

      {/* Modales (fuera de los contenedores) */}
      {chargeDraft?.clientId && cobrosDict ? (
        <ClientChargeBridge
          clientId={chargeDraft.clientId}
          clientName={chargeDraft.clientName ?? ""}
          cajaDict={dict}
          starsDict={starsDict}
          cobrosDict={cobrosDict}
          locale={locale}
          timezone={tz}
          canOpenSession={canManage}
          draft={chargeDraft}
          onDraftSaved={refresh}
          onClose={() => {
            setChargeDraft(null);
            refresh();
          }}
          onCharged={() => refresh()}
        />
      ) : null}
      {modal.kind === "ticket" && (
        <TicketModal
          dict={dict}
          starsDict={starsDict}
          locale={locale}
          checkout={checkout}
          appointment={modal.appointment}
          tz={tz}
          onClose={closeModal}
          onCharged={() => {
            refresh();
          }}
        />
      )}
      {modal.kind === "open" && (
        <OpenSessionModal
          dict={dict}
          onClose={closeModal}
          onDone={() => {
            toast.success(t("session.openConfirm"));
            closeModal();
            refresh();
          }}
        />
      )}
      {modal.kind === "close" && open && (
        <CloseSessionModal
          dict={dict}
          summary={open}
          tz={tz}
          openDrafts={drafts?.ready ? drafts.openCount : 0}
          onClose={closeModal}
          onDone={() => {
            closeModal();
            refresh();
          }}
        />
      )}
      {modal.kind === "history" && (
        <SessionDetailModal dict={dict} row={modal.row} tz={tz} onClose={closeModal} />
      )}
      {modal.kind === "cancel" && (
        <CancelSaleModal
          dict={dict}
          sale={modal.sale}
          onClose={closeModal}
          onDone={() => {
            toast.success(t("common.cancelled"));
            closeModal();
            refresh();
          }}
        />
      )}
    </div>
  );
}
