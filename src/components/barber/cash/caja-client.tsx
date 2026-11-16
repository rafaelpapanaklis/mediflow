"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Banknote,
  Coins,
  HandCoins,
  Lock,
  MinusCircle,
  PlusCircle,
  Receipt,
  ShoppingBag,
  Unlock,
  Wallet,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CashState, CheckoutContext, PendingAppointment, SaleRow } from "@/lib/barber/cash";
import type { CashMovementRow } from "@/lib/barber/cash-movements";
import { isLinkedCommissionMovement, type CashMovementType } from "@/lib/barber/caja-movimientos-core";
import { sumMoneyBy } from "@/lib/barber/money";
import { CardNew } from "@/components/ui/design-system/card-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { useBarberT } from "./use-barber-t";
import { fmtDateTime, fmtMoney, fmtSigned, fmtTime, PAYMENT_METHOD_KEYS } from "./money";
import { TicketModal } from "./ticket-modal";
import type { SaleDraftList, SaleDraftRow } from "@/lib/barber/sale-drafts";
import { SaleDraftsList } from "@/components/barber/clients/sale-drafts-list";
import { ClientChargeBridge } from "@/components/barber/clients/client-charge-bridge";
import { CancelSaleModal, ChangeMethodModal, CloseSessionModal, OpenSessionModal } from "./session-modals";
import { CortesTab } from "./cortes-tab";
import { GastosTab } from "./gastos-tab";
import { categoryLabel, MovementModal, VoidMovementModal } from "./movement-modals";
import { DayList } from "./day-list";
import { PayCommissionPanel } from "./pay-commission-panel";
import { dayKeyInTz, isStaleSession } from "./caja-dia-core";

type ModalState =
  | { kind: "none" }
  | { kind: "ticket"; appointment: PendingAppointment | null }
  | { kind: "open" }
  | { kind: "close" }
  | { kind: "cancel"; sale: SaleRow }
  | { kind: "method"; sale: SaleRow }
  | { kind: "movement"; type: CashMovementType }
  | { kind: "void"; movement: CashMovementRow };

/** "13 nov" en la zona de la barbería. */
function fmtShortDate(iso: string, tz: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", weekday: "short", timeZone: tz });
  } catch {
    return iso.slice(0, 10);
  }
}

export interface CajaPermissions {
  /** cash.manage: abrir, cobrar, cerrar. */
  manage: boolean;
  /** cash.expenses: registrar gastos y entradas. */
  expenses: boolean;
  /** cash.withdraw: sacar efectivo y pagar a barberos. */
  withdraw: boolean;
  /** Puede «Marcar pagado» comisión/sueldo (commissions.manage, no rol Barbero, plan con comisiones). */
  payCommissions: boolean;
}

export function CajaClient({
  dict,
  state,
  checkout,
  canManage,
  perms,
  starsDict,
  locale = "es",
  drafts = null,
  cobrosDict,
  shopName = "",
}: {
  dict: Dictionary;
  state: CashState;
  checkout: CheckoutContext;
  canManage: boolean;
  /** Llaves de la caja completa; sin ellas, solo cash.manage (como antes). */
  perms?: Partial<CajaPermissions>;
  /** Sub-árbol barber.estrellas (bono en el cobro y «+1 estrella» al terminar). */
  starsDict?: Dictionary;
  locale?: string;
  /** Notas «Por cobrar» abiertas de la sede (null = sin permiso o sin SQL). */
  drafts?: SaleDraftList | null;
  /** Sub-árbol barber.cobros (textos de las notas «Por cobrar»). */
  cobrosDict?: Dictionary;
  /** Nombre de la sede (encabezado del corte por WhatsApp). */
  shopName?: string;
}) {
  const t = useBarberT(dict);
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [tab, setTab] = useState<"hoy" | "cortes" | "gastos">("hoy");
  const [chargeDraft, setChargeDraft] = useState<SaleDraftRow | null>(null);
  const closeModal = useCallback(() => setModal({ kind: "none" }), []);
  // El refresco del servidor tarda 1-4 s: mientras tanto se dice «Actualizando…» (QA E, ronda 4).
  const [refreshing, startRefresh] = useTransition();
  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router]);

  const open = state.open;
  const tz = state.timezone;
  const ready = state.movementsReady === true;
  const can: CajaPermissions = {
    manage: canManage,
    expenses: ready && perms?.expenses === true,
    withdraw: ready && perms?.withdraw === true,
    payCommissions: ready && perms?.withdraw === true && perms?.payCommissions === true,
  };
  const now = new Date();
  const todayKey = dayKeyInTz(now.toISOString(), tz);
  const stale = open ? isStaleSession(open.session.openedAt, now, tz) : false;
  const resumen = open?.resumen ?? null;
  const currentPeriod = todayKey.slice(0, 7);
  const tabs: Array<"hoy" | "cortes" | "gastos"> = ready ? ["hoy", "cortes", "gastos"] : ["hoy", "cortes"];
  // Un pago marcado en Comisiones se anula deshaciendo ese pago: pide además poder marcar pagado.
  const canVoid = (m: CashMovementRow) =>
    (m.type === "EXPENSE" || m.type === "DEPOSIT" ? can.expenses : can.withdraw) && (!isLinkedCommissionMovement(m) || can.payCommissions);

  const moveButtons: Array<{ type: CashMovementType; icon: typeof Banknote; show: boolean; needsOpen: boolean }> = [
    { type: "EXPENSE", icon: ShoppingBag, show: can.expenses, needsOpen: false },
    { type: "WITHDRAWAL", icon: MinusCircle, show: can.withdraw, needsOpen: true },
    { type: "DEPOSIT", icon: Coins, show: can.expenses, needsOpen: true },
    { type: "BARBER_PAYOUT", icon: HandCoins, show: can.withdraw, needsOpen: false },
  ];

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
            <button type="button" className="btn-new barber-btn-primary" onClick={() => setModal({ kind: "open" })} data-abrir-caja>
              <Unlock size={15} /> {t("status.open")}
            </button>
          )}
          {canManage && open && (
            <button type="button" className="btn-new btn-new--secondary" onClick={() => setModal({ kind: "close" })} data-cerrar-caja>
              <Lock size={15} /> {t("status.close")}
            </button>
          )}
        </div>
      </div>

      {/* Estado de la caja */}
      <div className="bcaja-session" data-estado-caja={open ? (stale ? "vieja" : "abierta") : "cerrada"}>
        <span className={`bcaja-session__dot ${open ? "" : "bcaja-session__dot--off"}`} />
        {open ? (
          <>
            <span className="bcaja-session__main">
              {stale
                ? t("status.openSinceDate", { date: fmtDateTime(open.session.openedAt, tz) })
                : t("status.openSince", { time: fmtTime(open.session.openedAt, tz) })}
            </span>
            <span className="bcaja-session__meta">{t("status.openedBy", { name: open.session.openedByName })}</span>
            <span className="bcaja-session__meta">{t("status.float", { amount: fmtMoney(open.session.openingAmount) })}</span>
          </>
        ) : (
          <>
            <span className="bcaja-session__main">{t("status.closed")}</span>
            <span className="bcaja-session__meta">{canManage ? t("caja.noSessionBody") : t("caja.noCashManage")}</span>
          </>
        )}
        {!canManage && open && <span className="bcaja-session__meta">{t("caja.noCashManage")}</span>}
      </div>

      {open && stale && (
        <div className="bcaja-alert bcaja-alert--warning bcaja-stale" role="alert" data-caja-de-otro-dia>
          <AlertTriangle size={16} aria-hidden="true" />
          <span>
            <strong>{t("status.staleTitle", { date: fmtShortDate(open.session.openedAt, tz) })}</strong> {t("status.staleBody")}
          </span>
          {canManage && (
            <button type="button" className="btn-new btn-new--sm barber-btn-primary" onClick={() => setModal({ kind: "close" })}>
              {t("status.staleClose")}
            </button>
          )}
        </div>
      )}

      {/* Pestañas: Hoy · Cortes · Gastos */}
      <div className="bcaja-tabs" role="tablist" aria-label={t("caja.title")}>
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" id={`bcaja-tab-${k}`} aria-controls={`bcaja-panel-${k}`} aria-selected={tab === k} className="bcaja-tab" onClick={() => setTab(k)} data-tab={k}>
            {t(`tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === "cortes" && (
        <div role="tabpanel" id="bcaja-panel-cortes" aria-labelledby="bcaja-tab-cortes">
          <CortesTab dict={dict} tz={tz} locale={locale} currentPeriod={currentPeriod} />
        </div>
      )}
      {tab === "gastos" && ready && (
        <div role="tabpanel" id="bcaja-panel-gastos" aria-labelledby="bcaja-tab-gastos">
          <GastosTab dict={dict} tz={tz} locale={locale} currentPeriod={currentPeriod} canAdd={can.expenses} openSessionId={open?.session.id ?? null} onChanged={refresh} />
        </div>
      )}

      {tab === "hoy" && (
        <div role="tabpanel" id="bcaja-panel-hoy" aria-labelledby="bcaja-tab-hoy" style={{ display: "flex", flexDirection: "column", gap: "inherit" }}>
      {/* Botones del día */}
      {(canManage && open) || moveButtons.some((b) => b.show) ? (
        <div className="bcaja-actions" role="group" aria-label={t("status.actions")}>
          {canManage && open && (
            <button type="button" className="btn-new barber-btn-primary bcaja-action" onClick={() => setModal({ kind: "ticket", appointment: null })} data-accion="cobrar">
              <PlusCircle size={16} /> {t("status.charge")}
            </button>
          )}
          {moveButtons
            .filter((b) => b.show)
            .map((b) => {
              const Icon = b.icon;
              const disabled = b.needsOpen && !open;
              return (
                <button
                  key={b.type}
                  type="button"
                  className="btn-new btn-new--secondary bcaja-action"
                  disabled={disabled}
                  title={disabled ? t("status.needsOpen") : undefined}
                  onClick={() => setModal({ kind: "movement", type: b.type })}
                  data-accion={b.type}
                >
                  <Icon size={16} /> {t(`mov.title.${b.type}`)}
                </button>
              );
            })}
        </div>
      ) : null}

      {/* Tarjetas del día */}
      {open && resumen && (
        <div className="bcaja-kpis bcaja-kpis--5 bd-band" data-tarjetas-dia>
          <KpiCard label={t("cards.expected")} value={fmtMoney(open.expectedCash)} icon={Banknote} hero hint={t("cards.expectedHint")} />
          <KpiCard
            label={t("cards.income")}
            value={fmtMoney(resumen.income.total)}
            icon={Receipt}
            hint={[
              // Revisión ws6-t8 (M5): incluye propinas; Inicio/Reportes llaman «Ingresos» a lo cobrado SIN propinas.
              t("cards.incomeTips", { tips: fmtMoney(resumen.tips.total) }),
              `${t("common.cash")} ${fmtMoney(resumen.income.byMethod.CASH.total)}`,
              `${t("common.card")} ${fmtMoney(resumen.income.byMethod.CARD.total)}`,
              `${t("common.spei")} ${fmtMoney(resumen.income.byMethod.SPEI.total)}`,
              ...(resumen.income.byMethod.ONLINE.count > 0 ? [`${t("cards.online")} ${fmtMoney(resumen.income.byMethod.ONLINE.total)}`] : []),
            ].join(" · ")}
          />
          {ready && (
            <KpiCard
              label={t("cards.expenses")}
              value={fmtMoney(resumen.expenses.total)}
              icon={ShoppingBag}
              hint={resumen.payouts.total > 0 ? t("cards.expensesHintPayouts", { cash: fmtMoney(resumen.expenses.cash), payouts: fmtMoney(resumen.payouts.total) }) : t("cards.expensesHint", { cash: fmtMoney(resumen.expenses.cash) })}
            />
          )}
          {ready && (
            <KpiCard
              label={t("cards.moves")}
              value={fmtMoney(resumen.withdrawals.total)}
              icon={Wallet}
              hint={t("cards.movesHint", { in: fmtSigned(resumen.deposits.total), out: resumen.withdrawals.count, inCount: resumen.deposits.count })}
            />
          )}
          <KpiCard
            label={t("caja.tipsTotal")}
            value={fmtMoney(resumen.tips.total)}
            hint={resumen.tips.cash > 0 ? `${t("caja.cashTips")}: ${fmtMoney(resumen.tips.cash)}` : undefined}
          />
        </div>
      )}

      {/* Citas por cobrar | Lista del día */}
      {/* Una columna: la lista del día es lo principal y necesita todo el ancho. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <CardNew id="citas-por-cobrar" title={t("caja.pendingTitle")} sub={open ? undefined : t("caja.needsSession")}>
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
                        {dayKeyInTz(a.startAt, tz) !== todayKey ? (
                          <div className="bcaja-appt__meta" style={{ color: "var(--warning, var(--text-1))", fontWeight: 600 }}>
                            {t("caja.pendingOlder", { date: fmtShortDate(a.startAt, tz) })}
                          </div>
                        ) : null}
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

        <CardNew title={t("day.title")} noPad>
          {!open ? (
            <p className="bcaja-hint" style={{ margin: 0, padding: 18 }}>{t("caja.ticketsEmpty")}</p>
          ) : (
            <DayList
              dict={dict}
              sales={open.sales}
              movements={open.movements ?? []}
              tz={tz}
              canManage={canManage}
              canVoid={canVoid}
              onChangeMethod={(s) => setModal({ kind: "method", sale: s })}
              onCancelSale={(s) => setModal({ kind: "cancel", sale: s })}
              onVoidMovement={(m) => setModal({ kind: "void", movement: m })}
            />
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
        </div>
      )}

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
          suggested={state.suggestedOpening ?? null}
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
          pendingAppointments={checkout.pendingAppointments.length}
          shopName={shopName}
          categoryLabel={(c) => categoryLabel(t, c)}
          canTakeOut={can.withdraw}
          onClose={closeModal}
          onDone={() => {
            closeModal();
            refresh();
          }}
        />
      )}
      {modal.kind === "method" && (
        <ChangeMethodModal
          dict={dict}
          sale={modal.sale}
          onClose={closeModal}
          onDone={(m) => {
            toast.success(t("caja.changeMethodDone", { method: t(PAYMENT_METHOD_KEYS[m]) }));
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
      {modal.kind === "movement" && (
        <MovementModal
          dict={dict}
          type={modal.type}
          sessionOpen={Boolean(open)}
          barbers={checkout.barbers}
          extraPayout={
            can.payCommissions
              ? {
                  kinds: ["COMMISSION", "SALARY"],
                  render: ({ barberId }) => (
                    <PayCommissionPanel
                      dict={dict}
                      barberId={barberId}
                      periodKey={currentPeriod}
                      locale={locale}
                      sessionOpen={Boolean(open)}
                      onCancel={closeModal}
                      onPaid={(amount) => {
                        toast.success(t("payc.done", { amount: fmtMoney(amount) }));
                        closeModal();
                        refresh();
                      }}
                    />
                  ),
                }
              : undefined
          }
          onClose={closeModal}
          onDone={(r) => {
            if (r.outsideSession) toast(t("mov.savedOutside"), { icon: "ℹ️" });
            else toast.success(t(`mov.saved.${modal.type}`));
            closeModal();
            refresh();
          }}
        />
      )}
      {modal.kind === "void" && (
        <VoidMovementModal
          dict={dict}
          movement={modal.movement}
          tz={tz}
          onClose={closeModal}
          onDone={() => {
            toast.success(t("mov.voided"));
            closeModal();
            refresh();
          }}
        />
      )}
    </div>
  );
}
