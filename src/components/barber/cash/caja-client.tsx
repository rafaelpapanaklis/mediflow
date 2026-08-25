"use client";

import { useCallback, useState } from "react";
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
import type { CashState, CheckoutContext, PendingAppointment, SaleRow } from "@/lib/barber/cash";
import { sumMoneyBy } from "@/lib/barber/money";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { useBarberT } from "./use-barber-t";
import { fmtMoney, fmtSigned, fmtTime, fmtDateTime, PAYMENT_METHOD_KEYS } from "./money";
import { TicketModal } from "./ticket-modal";
import { CancelSaleModal, CloseSessionModal, OpenSessionModal } from "./session-modals";

type ModalState =
  | { kind: "none" }
  | { kind: "ticket"; appointment: PendingAppointment | null }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "cancel"; sale: SaleRow };

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
}: {
  dict: Dictionary;
  state: CashState;
  checkout: CheckoutContext;
  canManage: boolean;
}) {
  const t = useBarberT(dict);
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const closeModal = useCallback(() => setModal({ kind: "none" }), []);
  const refresh = useCallback(() => router.refresh(), [router]);

  const open = state.open;
  const tz = state.timezone;
  const methodLabel = (m: BarberPaymentMethod) => t(PAYMENT_METHOD_KEYS[m]);

  return (
    <div className="bcaja-page">
      {/* Encabezado */}
      <div className="bcaja-head">
        <div>
          <h1 className="bcaja-head__title">{t("caja.title")}</h1>
          <p className="bcaja-head__sub">{t("caja.subtitle")}</p>
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
        <div className="bcaja-kpis">
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
              <table className="table-new">
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
                      <td>{fmtTime(s.createdAt, tz)}</td>
                      <td>{s.clientName ?? <span className="bcaja-muted">{t("common.none")}</span>}</td>
                      <td>{s.barberName ?? <span className="bcaja-muted">{t("common.none")}</span>}</td>
                      <td style={{ whiteSpace: "normal", maxWidth: 260 }}>
                        {s.cancelled ? <BadgeNew tone="neutral">{t("common.cancelled")}</BadgeNew> : s.itemsSummary}
                      </td>
                      <td>{methodLabel(s.paymentMethod)}</td>
                      <td className="bcaja-num">{fmtMoney(s.tip)}</td>
                      <td className="bcaja-num"><strong>{fmtMoney(s.total)}</strong></td>
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

      {/* Historial de turnos */}
      <CardNew title={t("caja.historyTitle")} noPad>
        {state.history.length === 0 ? (
          <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("caja.historyEmpty")}</p>
        ) : (
          <div className="bcaja-table-wrap">
            <table className="table-new">
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
                </tr>
              </thead>
              <tbody>
                {state.history.map((h) => (
                  <tr key={h.id}>
                    <td>{fmtDateTime(h.openedAt, tz)}</td>
                    <td>{fmtDateTime(h.closedAt, tz)}</td>
                    <td>{h.openedByName}{h.closedByName && h.closedByName !== h.openedByName ? ` / ${h.closedByName}` : ""}</td>
                    <td className="bcaja-num">{h.ticketCount}{h.cancelledCount > 0 ? <span className="bcaja-muted"> (+{h.cancelledCount})</span> : null}</td>
                    <td className="bcaja-num">{fmtMoney(h.openingAmount)}</td>
                    <td className="bcaja-num">{fmtMoney(h.expectedAmount)}</td>
                    <td className="bcaja-num">{fmtMoney(h.countedAmount)}</td>
                    <td className="bcaja-num">
                      {h.difference === null ? "—" : (
                        <BadgeNew tone={h.difference === 0 ? "success" : h.difference > 0 ? "info" : "danger"}>{fmtSigned(h.difference)}</BadgeNew>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardNew>

      {/* Modales (fuera de los contenedores) */}
      {modal.kind === "ticket" && (
        <TicketModal
          dict={dict}
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
          onClose={closeModal}
          onDone={() => {
            closeModal();
            refresh();
          }}
        />
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
