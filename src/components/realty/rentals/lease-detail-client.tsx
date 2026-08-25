"use client";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/rentas/[id] — un contrato completo.
//
// Cinco pestañas y ninguna más: datos, cobros, aumento, depósito e
// inventario. Todo lo que alguien necesita de un contrato cabe ahí, y lo
// que se hace todos los días (registrar un pago) está a un clic desde la
// tabla de cobros, sin entrar a nada.
//
// i18n CONVENCIÓN B: sub-árbol ya recortado, prefijo VACÍO.
// ═══════════════════════════════════════════════════════════════════════

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  Download,
  FileText,
  Pencil,
  Play,
  RefreshCw,
  Receipt,
  Square,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  formatLongDate,
  formatMoney,
  formatShortDate,
  monthKey,
  todayInTimezone,
} from "@/lib/realty/rent-charges";
import type {
  RealtyChargeStatus,
  RealtyCurrency,
  RealtyDepositStatus,
  RealtyIncreaseRule,
  RealtyLeasePartyRole,
  RealtyLeaseStatus,
  RealtyScreeningStatus,
} from "@/lib/realty/types";
import { Card, EmptyState, Field, Kpi, Modal, Note, Pill, Tabs, type Tone } from "./ui";
import { LeaseForm, type ContactOption, type PropertyOption } from "./lease-form";
import { PaymentForm, type PaymentTarget } from "./payment-form";
import { IncreasePanel } from "./increase-panel";
import { InventoryPanel } from "./inventory-panel";
import "./rentals.css";

export interface DetailCharge {
  id: string;
  periodMonth: string;
  periodLabel: string;
  dueAt: string;
  amount: number;
  paid: number;
  balance: number;
  status: RealtyChargeStatus;
  daysLate: number;
}

export interface DetailPayment {
  id: string;
  chargeId: string | null;
  amount: number;
  method: string;
  paidAt: string;
  reference: string | null;
  receiptFolio: string;
  receiptUrl: string | null;
}

export interface DetailParty {
  id: string;
  role: RealtyLeasePartyRole;
  contactName: string;
  contactPhone: string | null;
  contactEmail: string | null;
  screeningStatus: RealtyScreeningStatus | null;
}

export interface DetailDeposit {
  id: string;
  amount: number;
  status: RealtyDepositStatus;
  resolvedAt: string | null;
  note: string | null;
}

export interface LeaseDetailData {
  id: string;
  propertyId: string;
  propertyTitle: string;
  propertyCity: string | null;
  tenantName: string;
  startsAt: string;
  endsAt: string;
  rentAmount: number;
  currency: RealtyCurrency;
  paymentDay: number;
  depositAmount: number;
  increaseRule: RealtyIncreaseRule;
  increasePct: number | null;
  status: RealtyLeaseStatus;
  signedDocUrl: string | null;
  notes: string | null;
  daysToEnd: number;
  balance: number;
  overdueCount: number;
  chargeCount: number;
  cdmx: boolean;
  parties: DetailParty[];
  charges: DetailCharge[];
  payments: DetailPayment[];
  deposits: DetailDeposit[];
}

type TabKey = "data" | "charges" | "increase" | "deposit" | "inventory";

const CHARGE_TONE: Record<RealtyChargeStatus, Tone> = {
  PENDIENTE: "info",
  PARCIAL: "warning",
  PAGADO: "success",
  VENCIDO: "danger",
};

const LEASE_TONE: Record<RealtyLeaseStatus, Tone> = {
  BORRADOR: "neutral",
  ACTIVO: "success",
  VENCIDO: "warning",
  TERMINADO: "neutral",
};

const DEPOSIT_TONE: Record<RealtyDepositStatus, Tone> = {
  RETENIDO: "brand",
  DEVUELTO: "success",
  APLICADO: "warning",
};

export function LeaseDetailClient({
  dict,
  lease,
  properties,
  contacts,
  timezone,
  storageUsedBytes,
  storageQuotaMb,
  canEdit,
  canCollect,
}: {
  dict: Dictionary;
  lease: LeaseDetailData;
  properties: PropertyOption[];
  contacts: ContactOption[];
  timezone: string;
  storageUsedBytes: number;
  storageQuotaMb: number;
  canEdit: boolean;
  canCollect: boolean;
}) {
  const t = makeRealtyT(dict);
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>("data");
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<PaymentTarget | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositStatus, setDepositStatus] = useState<RealtyDepositStatus>("DEVUELTO");
  const [depositNote, setDepositNote] = useState("");

  const today = useMemo(() => todayInTimezone(timezone), [timezone]);
  const todayISO = today.toISOString().slice(0, 10);
  const currentMonth = monthKey(today);

  async function action(body: Record<string, unknown>, okMessage: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/realty/leases/${lease.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(String(data?.error ?? t("common.genericError")));
        return;
      }
      toast.success(okMessage.replace("{count}", String(data?.charges ?? data?.created ?? 0)));
      router.refresh();
    } catch {
      toast.error(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function removeLease() {
    if (busy) return;
    if (!window.confirm(t("leases.actions.deleteConfirm"))) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/realty/leases/${lease.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(String(data?.error ?? t("common.genericError")));
        return;
      }
      toast.success(t("leases.toast.deleted"));
      router.push("/inmobiliaria/rentas");
    } catch {
      toast.error(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  async function resolveDeposit() {
    const deposit = lease.deposits[0];
    if (!deposit || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/realty/leases/${lease.id}/deposit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ depositId: deposit.id, status: depositStatus, note: depositNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(String(data?.error ?? t("common.genericError")));
        return;
      }
      toast.success(t("deposit.toast.resolved"));
      setDepositOpen(false);
      router.refresh();
    } catch {
      toast.error(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  const endLabel =
    lease.daysToEnd === 0
      ? t("leases.detail.endsToday")
      : lease.daysToEnd < 0
        ? t("leases.detail.endedAgo", { count: Math.abs(lease.daysToEnd) })
        : t("leases.detail.daysToEnd", { count: lease.daysToEnd });

  const deposit = lease.deposits[0] ?? null;

  return (
    <div className="rnt">
      <header className="rnt-head">
        <div className="rnt-head__row">
          <div style={{ minWidth: 0 }}>
            <Link
              href="/inmobiliaria/rentas"
              className="rnt-btn rnt-btn--sm rnt-btn--ghost"
              style={{ paddingLeft: 0, marginBottom: 6 }}
            >
              <ArrowLeft size={14} />
              {t("leases.detail.backToList")}
            </Link>
            <h1 className="rnt-head__title">{lease.propertyTitle}</h1>
            <p className="rnt-head__sub">
              {lease.tenantName}
              {lease.propertyCity ? ` · ${lease.propertyCity}` : ""} · {endLabel}
            </p>
          </div>
          <div className="rnt-head__actions">
            <Pill tone={LEASE_TONE[lease.status]} dot>
              {t(`leases.status.${lease.status}`)}
            </Pill>
            {lease.cdmx ? <Pill tone="brand">CDMX</Pill> : null}
            {canEdit ? (
              <>
                <button
                  type="button"
                  className="rnt-btn rnt-btn--sm"
                  onClick={() => setEditOpen(true)}
                  disabled={busy}
                >
                  <Pencil size={13} />
                  {t("common.edit")}
                </button>
                {lease.status === "BORRADOR" ? (
                  <button
                    type="button"
                    className="rnt-btn rnt-btn--sm rnt-btn--primary"
                    onClick={() => action({ action: "activar" }, t("leases.toast.activated"))}
                    disabled={busy}
                  >
                    <Play size={13} />
                    {t("leases.actions.activate")}
                  </button>
                ) : null}
                {lease.status === "ACTIVO" || lease.status === "VENCIDO" ? (
                  <button
                    type="button"
                    className="rnt-btn rnt-btn--sm"
                    onClick={() => {
                      if (window.confirm(t("leases.actions.terminateConfirm"))) {
                        void action({ action: "terminar" }, t("leases.toast.terminated"));
                      }
                    }}
                    disabled={busy}
                  >
                    <Square size={13} />
                    {t("leases.actions.terminate")}
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className="rnt-kpis">
        <Kpi
          label={t("leases.detail.rent")}
          value={formatMoney(lease.rentAmount, lease.currency)}
          hint={`${t("leases.detail.paymentDay")} ${lease.paymentDay}`}
        />
        <Kpi
          label={t("charges.table.balance")}
          value={formatMoney(lease.balance, lease.currency)}
          hint={t("leases.kpi.balanceHint")}
          tone={lease.balance > 0 ? "danger" : "good"}
        />
        <Kpi
          label={t("leases.detail.deposit")}
          value={formatMoney(lease.depositAmount, lease.currency)}
          hint={deposit ? t(`deposit.state.${deposit.status}`) : t("deposit.empty")}
        />
        <Kpi
          label={t("leases.detail.term")}
          value={`${formatShortDate(lease.startsAt)} — ${formatShortDate(lease.endsAt)}`}
          hint={endLabel}
        />
      </div>

      <Tabs<TabKey>
        label={t("leases.title")}
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "data", label: t("leases.tabs.data") },
          { key: "charges", label: t("leases.tabs.charges"), count: lease.charges.length },
          { key: "increase", label: t("leases.tabs.increase") },
          { key: "deposit", label: t("leases.tabs.deposit") },
          { key: "inventory", label: t("leases.tabs.inventory") },
        ]}
      />

      {tab === "data" ? (
        <>
          <Card title={t("leases.detail.parties")}>
            {lease.parties.length === 0 ? (
              <Note tone="warning">{t("leases.detail.noParties")}</Note>
            ) : (
              <div className="rnt-grid">
                {lease.parties.map((p) => (
                  <div key={p.id} className="rnt-inv-side">
                    <div className="rnt-inv-side__label">{t(`leases.role.${p.role}`)}</div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{p.contactName}</div>
                    {p.contactPhone ? (
                      <div className="rnt-field__hint">{p.contactPhone}</div>
                    ) : null}
                    {p.contactEmail ? (
                      <div className="rnt-field__hint">{p.contactEmail}</div>
                    ) : null}
                    <div style={{ marginTop: 6 }}>
                      <Pill tone={p.screeningStatus === "APROBADO" ? "success" : p.screeningStatus === "RECHAZADO" ? "danger" : "neutral"}>
                        {p.screeningStatus
                          ? t(`leases.screening.${p.screeningStatus}`)
                          : t("leases.screening.none")}
                      </Pill>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card
            title={t("leases.actions.statement")}
            sub={t("statement.notInvoice")}
            action={
              canCollect ? (
                <div className="rnt-toolbar">
                  <a
                    className="rnt-btn rnt-btn--sm"
                    href={`/api/realty/leases/${lease.id}/estado-cuenta?formato=csv`}
                  >
                    <Download size={13} />
                    {t("leases.actions.statementCsv")}
                  </a>
                  <a
                    className="rnt-btn rnt-btn--sm"
                    href={`/api/realty/leases/${lease.propertyId}/estado-cuenta?propiedad=1&formato=csv&moneda=${lease.currency}`}
                  >
                    <Download size={13} />
                    {t("statement.byProperty")}
                  </a>
                </div>
              ) : null
            }
          >
            <div className="rnt-grid rnt-grid--auto">
              <div>
                <div className="rnt-field__label">{t("leases.detail.increase")}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {t(`leases.increaseRule.${lease.increaseRule}`)}
                  {lease.increaseRule === "FIJO" && lease.increasePct !== null
                    ? ` · ${lease.increasePct} %`
                    : ""}
                </div>
              </div>
              <div>
                <div className="rnt-field__label">{t("leases.form.signedDocUrl")}</div>
                {lease.signedDocUrl ? (
                  <a
                    href={lease.signedDocUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ fontSize: 13, color: "var(--brand)", fontWeight: 600 }}
                  >
                    <FileText size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                    {t("leases.form.signedDocUrl")}
                  </a>
                ) : (
                  <div style={{ fontSize: 13, color: "var(--text-4)" }}>{t("common.none")}</div>
                )}
              </div>
            </div>
            {lease.notes ? (
              <div style={{ marginTop: 14 }}>
                <div className="rnt-field__label">{t("leases.detail.notes")}</div>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: "var(--text-2)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {lease.notes}
                </p>
              </div>
            ) : null}
            {canEdit && lease.status === "BORRADOR" ? (
              <div className="rnt-toolbar" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  className="rnt-btn rnt-btn--sm rnt-btn--danger"
                  onClick={removeLease}
                  disabled={busy}
                >
                  {t("leases.actions.delete")}
                </button>
              </div>
            ) : null}
          </Card>
        </>
      ) : null}

      {tab === "charges" ? (
        <Card
          title={t("leases.detail.charges")}
          sub={t("leases.actions.regenerateHint")}
          flush
          action={
            canEdit ? (
              <button
                type="button"
                className="rnt-btn rnt-btn--sm"
                onClick={() => action({ action: "cargos" }, t("leases.toast.charges"))}
                disabled={busy}
              >
                <RefreshCw size={13} />
                {t("leases.actions.regenerate")}
              </button>
            ) : null
          }
        >
          {lease.charges.length === 0 ? (
            <EmptyState title={t("leases.detail.noCharges")} body={t("leases.actions.activateHint")} />
          ) : (
            <div className="rnt-tablewrap">
              <table className="rnt-table">
                <thead>
                  <tr>
                    <th>{t("charges.table.period")}</th>
                    <th className="rnt-hide-xs">{t("charges.table.dueAt")}</th>
                    <th className="num">{t("charges.table.amount")}</th>
                    <th className="num rnt-hide-sm">{t("charges.table.paid")}</th>
                    <th className="num">{t("charges.table.balance")}</th>
                    <th>{t("charges.table.status")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lease.charges.map((c) => (
                    <tr key={c.id}>
                      <td className="rnt-strong">{c.periodLabel}</td>
                      <td className="rnt-hide-xs">
                        <div>{formatShortDate(c.dueAt)}</div>
                        {c.balance > 0 && c.daysLate > 0 ? (
                          <div className="rnt-muted">
                            {t("charges.lateDays", { count: c.daysLate })}
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{formatMoney(c.amount, lease.currency)}</td>
                      <td className="num rnt-hide-sm">{formatMoney(c.paid, lease.currency)}</td>
                      <td className="num rnt-strong" style={{ color: c.balance > 0 ? "var(--danger)" : "var(--text-3)" }}>
                        {formatMoney(c.balance, lease.currency)}
                      </td>
                      <td>
                        <Pill tone={CHARGE_TONE[c.status]} dot>
                          {t(`charges.status.${c.status}`)}
                        </Pill>
                      </td>
                      <td className="num">
                        {canCollect && c.balance > 0 ? (
                          <button
                            type="button"
                            className="rnt-btn rnt-btn--sm rnt-btn--primary"
                            onClick={() =>
                              setPayTarget({
                                chargeId: c.id,
                                leaseId: lease.id,
                                propertyTitle: lease.propertyTitle,
                                tenantName: lease.tenantName,
                                periodLabel: c.periodLabel,
                                amount: c.amount,
                                paid: c.paid,
                                balance: c.balance,
                                currency: lease.currency,
                              })
                            }
                          >
                            {t("charges.pay")}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "charges" && lease.payments.length > 0 ? (
        <Card title={t("leases.detail.payments")} sub={t("receipt.notInvoice")} flush>
          <div className="rnt-tablewrap">
            <table className="rnt-table">
              <thead>
                <tr>
                  <th>{t("payment.paidAt")}</th>
                  <th className="num">{t("charges.table.amount")}</th>
                  <th className="rnt-hide-xs">{t("payment.method")}</th>
                  <th className="rnt-hide-sm">{t("payment.reference")}</th>
                  <th>{t("receipt.label")}</th>
                </tr>
              </thead>
              <tbody>
                {lease.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatLongDate(p.paidAt)}</td>
                    <td className="num rnt-strong">{formatMoney(p.amount, lease.currency)}</td>
                    <td className="rnt-hide-xs">{t(`payment.method_.${p.method}`)}</td>
                    <td className="rnt-hide-sm rnt-muted">{p.reference ?? "—"}</td>
                    <td>
                      {p.receiptUrl ? (
                        <a
                          className="rnt-btn rnt-btn--sm"
                          href={p.receiptUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Receipt size={13} />
                          {p.receiptFolio}
                        </a>
                      ) : (
                        <span className="rnt-muted">{t("receipt.none")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === "increase" ? (
        <IncreasePanel
          dict={dict}
          leaseId={lease.id}
          currentMonth={currentMonth}
          onApplied={() => router.refresh()}
        />
      ) : null}

      {tab === "deposit" ? (
        <Card
          title={t("deposit.title")}
          sub={t("deposit.subtitle")}
          action={
            canEdit && deposit && deposit.status === "RETENIDO" ? (
              <button
                type="button"
                className="rnt-btn rnt-btn--sm rnt-btn--primary"
                onClick={() => setDepositOpen(true)}
              >
                {t("deposit.resolve")}
              </button>
            ) : null
          }
        >
          {!deposit ? (
            <EmptyState title={t("deposit.empty")} body={t("leases.actions.activateHint")} />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="rnt-grid rnt-grid--auto">
                <div>
                  <div className="rnt-field__label">{t("deposit.amount")}</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {formatMoney(deposit.amount, lease.currency)}
                  </div>
                </div>
                <div>
                  <div className="rnt-field__label">{t("deposit.status")}</div>
                  <div style={{ marginTop: 3 }}>
                    <Pill tone={DEPOSIT_TONE[deposit.status]} dot>
                      {t(`deposit.state.${deposit.status}`)}
                    </Pill>
                  </div>
                </div>
                {deposit.resolvedAt ? (
                  <div>
                    <div className="rnt-field__label">{t("deposit.resolvedAt")}</div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                      {formatLongDate(deposit.resolvedAt)}
                    </div>
                  </div>
                ) : null}
              </div>
              {deposit.note ? (
                <div>
                  <div className="rnt-field__label">{t("deposit.note")}</div>
                  <p style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--text-2)" }}>
                    {deposit.note}
                  </p>
                </div>
              ) : null}
              <Note tone="brand">{t("deposit.compareHint")}</Note>
            </div>
          )}
        </Card>
      ) : null}

      {tab === "inventory" ? (
        <InventoryPanel
          dict={dict}
          leaseId={lease.id}
          storageUsedBytes={storageUsedBytes}
          storageQuotaMb={storageQuotaMb}
          canEdit={canEdit}
        />
      ) : null}

      {canCollect ? (
        <PaymentForm
          dict={dict}
          target={payTarget}
          todayISO={todayISO}
          onClose={() => setPayTarget(null)}
          onSaved={(res) => {
            setPayTarget(null);
            toast.success(
              res.folio
                ? t("payment.toast.savedWithReceipt", { folio: res.folio })
                : t("payment.toast.saved"),
            );
            router.refresh();
          }}
        />
      ) : null}

      {canEdit ? (
        <LeaseForm
          dict={dict}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          properties={properties}
          contacts={contacts}
          defaultMonth={currentMonth}
          initial={{
            id: lease.id,
            propertyId: lease.propertyId,
            startsAt: lease.startsAt.slice(0, 10),
            endsAt: lease.endsAt.slice(0, 10),
            rentAmount: String(lease.rentAmount),
            currency: lease.currency,
            paymentDay: String(lease.paymentDay),
            depositAmount: String(lease.depositAmount),
            increaseRule: lease.increaseRule,
            increasePct: lease.increasePct === null ? "" : String(lease.increasePct),
            signedDocUrl: lease.signedDocUrl ?? "",
            notes: lease.notes ?? "",
            tenantId: "",
            tenantName: "",
            tenantPhone: "",
            tenantEmail: "",
            guarantorId: "",
            guarantorName: "",
            guarantorPhone: "",
            guarantorRole: "AVAL",
          }}
          onSaved={() => {
            toast.success(t("leases.toast.updated"));
            setEditOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      <Modal
        open={depositOpen}
        onClose={() => setDepositOpen(false)}
        closeLabel={t("common.close")}
        title={t("deposit.resolve")}
        sub={t("deposit.subtitle")}
        footer={
          <>
            <button type="button" className="rnt-btn" onClick={() => setDepositOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="rnt-btn rnt-btn--primary"
              onClick={resolveDeposit}
              disabled={busy || depositNote.trim() === ""}
            >
              {busy ? t("common.saving") : t("common.save")}
            </button>
          </>
        }
      >
        <Note tone="brand">{t("deposit.compareHint")}</Note>
        <Field label={t("deposit.status")}>
          <select
            className="rnt-select"
            value={depositStatus}
            onChange={(e) => setDepositStatus(e.target.value as RealtyDepositStatus)}
          >
            <option value="DEVUELTO">{t("deposit.state.DEVUELTO")}</option>
            <option value="APLICADO">{t("deposit.state.APLICADO")}</option>
            <option value="RETENIDO">{t("deposit.state.RETENIDO")}</option>
          </select>
        </Field>
        <Field label={t("deposit.note")} hint={t("deposit.noteHint")}>
          <textarea
            className="rnt-textarea"
            value={depositNote}
            onChange={(e) => setDepositNote(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}
