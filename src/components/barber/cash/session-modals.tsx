"use client";

import { useMemo, useState } from "react";
import type { Dictionary } from "@/i18n/t";
import type { CashSessionSummary, SaleRow } from "@/lib/barber/cash";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { BarberModal } from "./modal";
import { useBarberT } from "./use-barber-t";
import { fmtMoney, fmtSigned, fmtTime, parseAmountText, toCents, fromCents, PAYMENT_METHOD_KEYS } from "./money";

// Forma única (sin unión discriminada): con strict:false TS no estrecha
// `ok: true | false`, así que el caller mira `error` directamente.
interface PostResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
  code?: string;
}

async function postJson<T>(url: string, body: unknown): Promise<PostResult<T>> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
    if (!res.ok) return { ok: false, data: null, error: data.error ?? "Error", code: data.code };
    return { ok: true, data, error: null };
  } catch {
    return { ok: false, data: null, error: "network" };
  }
}

export function OpenSessionModal({ dict, onClose, onDone }: { dict: Dictionary; onClose: () => void; onDone: () => void }) {
  const t = useBarberT(dict);
  const [amountText, setAmountText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseAmountText(amountText);

  async function submit() {
    if (amount === null || busy) return;
    setBusy(true);
    setError(null);
    const r = await postJson("/api/barber/cash-sessions/open", { openingAmount: amount, notes: notes.trim() || null });
    setBusy(false);
    if (!r.ok) {
      setError(r.error === "network" || !r.error ? t("common.error") : r.error);
      return;
    }
    onDone();
  }

  return (
    <BarberModal
      open
      title={t("session.openTitle")}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
          <button type="button" className="btn-new barber-btn-primary" onClick={submit} disabled={amount === null || busy}>
            {busy ? t("common.saving") : t("session.openConfirm")}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("session.openBody")}</p>
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}
        <div className="field-new">
          <label className="field-new__label">{t("session.openingAmount")}</label>
          <input className="input-new bcaja-amount" inputMode="decimal" autoFocus value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder="0.00" />
        </div>
        <div className="field-new">
          <label className="field-new__label">{t("session.openNotes")}</label>
          <input className="input-new" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </div>
      </div>
    </BarberModal>
  );
}

export function CloseSessionModal({
  dict,
  summary,
  tz,
  onClose,
  onDone,
}: {
  dict: Dictionary;
  summary: CashSessionSummary;
  tz: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useBarberT(dict);
  const [countedText, setCountedText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<CashSessionSummary | null>(null);

  const counted = parseAmountText(countedText);
  const expectedCents = toCents(summary.expectedCash);
  const diffCents = counted === null ? null : toCents(counted) - expectedCents;
  const live = useMemo(() => summary.sales.filter((s) => !s.cancelled), [summary.sales]);

  async function submit() {
    if (counted === null || busy) return;
    setBusy(true);
    setError(null);
    const r = await postJson<CashSessionSummary>("/api/barber/cash-sessions/close", { countedAmount: counted, notes: notes.trim() || null });
    setBusy(false);
    if (!r.ok || !r.data) {
      setError(r.error === "network" || !r.error ? t("common.error") : r.error);
      return;
    }
    setClosed(r.data);
  }

  if (closed) {
    const d = closed.session.difference ?? 0;
    return (
      <BarberModal open title={t("session.closedTitle")} onClose={onDone} closeLabel={t("common.close")} footer={<button type="button" className="btn-new barber-btn-primary" onClick={onDone}>{t("common.close")}</button>}>
        <div className={`bcaja-alert ${d === 0 ? "bcaja-alert--success" : d > 0 ? "bcaja-alert--info" : "bcaja-alert--danger"}`}>
          {t("session.closedBody", {
            expected: fmtMoney(closed.session.expectedAmount ?? 0),
            counted: fmtMoney(closed.session.countedAmount ?? 0),
            difference: fmtSigned(d),
          })}
        </div>
      </BarberModal>
    );
  }

  const methods: BarberPaymentMethod[] = ["CASH", "CARD", "SPEI"];

  return (
    <BarberModal
      open
      wide
      title={t("session.closeTitle")}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
          <button type="button" className="btn-new barber-btn-primary" onClick={submit} disabled={counted === null || busy}>
            {busy ? t("common.saving") : t("session.closeConfirm")}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("session.closeBody")}</p>
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}

        <div className="bcaja-totals">
          <div className="bcaja-totals__row"><span>{t("caja.openingAmount")}</span><span>{fmtMoney(summary.session.openingAmount)}</span></div>
          {methods.map((m) => (
            <div key={m} className="bcaja-totals__row">
              <span>{t(PAYMENT_METHOD_KEYS[m])} <span className="bcaja-muted">({summary.byMethod[m].count})</span></span>
              <span>{fmtMoney(summary.byMethod[m].total)}</span>
            </div>
          ))}
          <div className="bcaja-totals__row"><span>{t("caja.cashTips")}</span><span>{fmtMoney(summary.cashTips)}</span></div>
          <div className="bcaja-totals__row bcaja-totals__row--big"><span>{t("session.expected")}</span><span>{fmtMoney(summary.expectedCash)}</span></div>
        </div>

        <div className="bcaja-form__grid">
          <div className="field-new">
            <label className="field-new__label">{t("session.countedAmount")}</label>
            <input className="input-new bcaja-amount" inputMode="decimal" autoFocus value={countedText} onChange={(e) => setCountedText(e.target.value)} placeholder="0.00" />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("session.difference")}</label>
            <div className="input-new bcaja-amount" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {diffCents === null ? "—" : (
                <>
                  <span>{fmtSigned(fromCents(diffCents))}</span>
                  <BadgeNew tone={diffCents === 0 ? "success" : diffCents > 0 ? "info" : "danger"}>
                    {diffCents === 0 ? t("session.differenceOk") : diffCents > 0 ? t("session.differenceOver") : t("session.differenceShort")}
                  </BadgeNew>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="field-new">
          <label className="field-new__label">{t("session.breakdown")} · {t("session.ticketsInSession", { count: live.length })}</label>
          <div className="bcaja-table-wrap" style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--border-soft)", borderRadius: 10 }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>{t("caja.colTime")}</th>
                  <th>{t("caja.colItems")}</th>
                  <th>{t("caja.colMethod")}</th>
                  <th className="bcaja-num">{t("caja.colTip")}</th>
                  <th className="bcaja-num">{t("caja.colTotal")}</th>
                </tr>
              </thead>
              <tbody>
                {summary.sales.map((s) => (
                  <tr key={s.id} className={s.cancelled ? "bcaja-strike" : undefined}>
                    <td>{fmtTime(s.createdAt, tz)}</td>
                    <td style={{ whiteSpace: "normal" }}>{s.cancelled ? t("common.cancelled") : s.itemsSummary}</td>
                    <td>{t(PAYMENT_METHOD_KEYS[s.paymentMethod])}</td>
                    <td className="bcaja-num">{fmtMoney(s.tip)}</td>
                    <td className="bcaja-num">{fmtMoney(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="field-new">
          <label className="field-new__label">{t("session.closeNotes")}</label>
          <input className="input-new" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </div>
        <div className="bcaja-alert bcaja-alert--warning">{t("session.closeWarning")}</div>
      </div>
    </BarberModal>
  );
}

export function CancelSaleModal({ dict, sale, onClose, onDone }: { dict: Dictionary; sale: SaleRow; onClose: () => void; onDone: () => void }) {
  const t = useBarberT(dict);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await postJson(`/api/barber/sales/${sale.id}/cancel`, { reason: reason.trim() });
    setBusy(false);
    if (!r.ok) {
      setError(r.error === "network" || !r.error ? t("common.error") : r.error);
      return;
    }
    onDone();
  }

  return (
    <BarberModal
      open
      title={t("caja.cancelTicketTitle")}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={busy}>{t("common.back")}</button>
          <button type="button" className="btn-new btn-new--danger" onClick={submit} disabled={!reason.trim() || busy}>
            {busy ? t("common.saving") : t("caja.cancelConfirm")}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        <div className="bcaja-totals">
          <div className="bcaja-totals__row"><span>{sale.itemsSummary}</span><span>{fmtMoney(sale.total)}</span></div>
        </div>
        <div className="bcaja-alert bcaja-alert--warning">{t("caja.cancelTicketBody")}</div>
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}
        <div className="field-new">
          <label className="field-new__label">{t("common.reason")}</label>
          <input className="input-new" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("caja.cancelReasonPlaceholder")} maxLength={300} />
        </div>
      </div>
    </BarberModal>
  );
}
