"use client";

import { useMemo, useState } from "react";
import type { Dictionary } from "@/i18n/t";
import type { CashSessionSummary, SaleRow } from "@/lib/barber/cash";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { closeExpectedView } from "./close-expected";
import { CloseExpectedBreakdown } from "./close-expected-breakdown";
import { BarberModal } from "./modal";
import { useBarberT } from "./use-barber-t";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { COUNTER_METHODS } from "@/lib/barber/method-change-core";
import { CASH_DENOMINATIONS, differenceKind, parseCashCount } from "@/lib/barber/caja-movimientos-core";
import { MessageCircle, Printer } from "lucide-react";
import { corteDiffCents, corteDiffLabel, corteWhatsappText, denominationLabel, waMeLink } from "./corte-core";
import { fmtDateTime, fmtMoney, fmtSigned, fmtTime, parseRequiredAmountText, toCents, fromCents, PAYMENT_METHOD_KEYS } from "./money";

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

export function OpenSessionModal({
  dict,
  suggested = null,
  onClose,
  onDone,
}: {
  dict: Dictionary;
  /** Fondo que se dejó en el último corte (caja completa): se propone, se puede cambiar. */
  suggested?: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useBarberT(dict);
  const [amountText, setAmountText] = useState(suggested !== null && suggested !== undefined ? suggested.toFixed(2) : "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = parseRequiredAmountText(amountText);
  // Revisión ws6-t8 (M3): abrir con otro fondo que el que se dejó se confirma
  // y queda anotado en el corte (lo escribe el servidor).
  const diffCents = suggested !== null && suggested !== undefined && amount !== null ? toCents(amount) - toCents(suggested) : 0;
  const [confirming, setConfirming] = useState(false);

  async function submit() {
    if (amount === null || busy) return;
    if (diffCents !== 0 && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await postJson("/api/barber/cash-sessions/open", { openingAmount: amount, notes: notes.trim() || null, confirmDifference: confirming });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "OPENING_DIFFERS") {
        setConfirming(true);
        setError(r.error);
        return;
      }
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
            {busy ? t("common.saving") : confirming && diffCents !== 0 ? t("session.openWithDiff") : t("session.openConfirm")}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("session.openBody")}</p>
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}
        <div className="field-new">
          <label className="field-new__label">{t("session.openingAmount")}</label>
          <input className="input-new bcaja-amount" inputMode="decimal" autoFocus value={amountText} onChange={(e) => { setAmountText(e.target.value); setConfirming(false); }} placeholder="0.00" data-fondo-abrir />
          {amountText.trim() === "" && <div className="bcaja-hint">{t("session.openingRequired")}</div>}
          {suggested !== null && suggested !== undefined && (
            <div className="bcaja-hint" data-fondo-sugerido>{t("session.openingSuggested", { amount: fmtMoney(suggested) })}</div>
          )}
          {amountText.trim() !== "" && amount === null && <div className="bcaja-hint" role="alert" style={{ color: "var(--danger)" }}>{t("session.amountInvalid")}</div>}
          {confirming && diffCents !== 0 && suggested !== null && amount !== null && (
            <div className={`bcaja-alert ${diffCents < 0 ? "bcaja-alert--danger" : "bcaja-alert--warning"}`} role="alert" style={{ marginTop: 8 }} data-fondo-distinto>
              {t(diffCents < 0 ? "session.openDiffShort" : "session.openDiffOver", {
                left: fmtMoney(suggested),
                amount: fmtMoney(amount),
                diff: fmtMoney(Math.abs(fromCents(diffCents))),
              })}
            </div>
          )}
        </div>
        <div className="field-new">
          <label className="field-new__label">{t("session.openNotes")}</label>
          <input className="input-new" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </div>
      </div>
    </BarberModal>
  );
}

/**
 * Cerrar caja (corte). Conteo OPCIONAL por billete y moneda que suma solo, o
 * el total escrito directo; el esperado desglosado (fondo + efectivo +
 * entradas − gastos − retiros − pagos − devoluciones) y la diferencia en
 * color: «Cuadra», «Sobran $X» o «Faltan $X». Nota y fondo para mañana,
 * opcionales. Al cerrar: imprimir (80/58 mm o carta) y mandar por WhatsApp.
 * Si otra pestaña cerró primero, se enseña ese corte (el servidor no cierra
 * dos veces: 409 SESSION_CLOSED con el id).
 */
export function CloseSessionModal({
  dict,
  summary,
  tz,
  openDrafts = 0,
  pendingAppointments = 0,
  shopName = "",
  categoryLabel = (c: string) => c,
  canTakeOut = false,
  onClose,
  onDone,
}: {
  /**
   * Puede llevarse efectivo al cerrar (cash.withdraw; revisión ws6-t8, M3).
   * Sin ella, todo lo contado se queda de fondo (el servidor también lo hace).
   */
  canTakeOut?: boolean;
  dict: Dictionary;
  summary: CashSessionSummary;
  tz: string;
  /**
   * Notas «Por cobrar» abiertas de la sede. Solo se AVISA (número y enlace):
   * no entran a este corte ni cambian su cuenta.
   */
  openDrafts?: number;
  /** Citas TERMINADAS sin ticket (lógica L2): cerrar sin cobrarlas descuadra el efectivo. Solo se avisa. */
  pendingAppointments?: number;
  /** Nombre de la barbería (encabezado del texto de WhatsApp). */
  shopName?: string;
  /** Nombre de una categoría de gasto (texto de WhatsApp). */
  categoryLabel?: (c: string) => string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useBarberT(dict);
  const [mode, setMode] = useState<"total" | "count">("total");
  const [countedText, setCountedText] = useState("");
  const [count, setCount] = useState<Record<string, string>>({});
  const [leftText, setLeftText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<CashSessionSummary | null>(null);
  const [byOther, setByOther] = useState(false);

  const parsedCount = useMemo(() => parseCashCount(count), [count]);
  const countCents = parsedCount ? parsedCount.cents : null;
  const typed = parseRequiredAmountText(countedText);
  const counted = mode === "count" ? (countCents === null || Object.keys(parsedCount?.count ?? {}).length === 0 ? null : fromCents(countCents)) : typed;
  const expectedCents = toCents(summary.expectedCash);
  const diffCents = counted === null ? null : toCents(counted) - expectedCents;
  const left = leftText.trim() === "" ? null : parseRequiredAmountText(leftText);
  const leftInvalid = canTakeOut && leftText.trim() !== "" && (left === null || (counted !== null && toCents(left) > toCents(counted)));
  const live = useMemo(() => summary.sales.filter((s) => !s.cancelled), [summary.sales]);
  const ready = summary.movementsReady === true;

  async function showClosed(sessionId: string) {
    try {
      const res = await fetch(`/api/barber/cash-sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setByOther(true);
      setClosed((await res.json()) as CashSessionSummary);
    } catch {
      setError(t("corte.closedElsewhere"));
    }
  }

  async function submit() {
    if (counted === null || busy || leftInvalid) return;
    setBusy(true);
    setError(null);
    const r = await postJson<CashSessionSummary>("/api/barber/cash-sessions/close", {
      sessionId: summary.session.id,
      countedAmount: counted,
      countedBreakdown: mode === "count" ? parsedCount?.count ?? null : null,
      leftForNext: ready && canTakeOut && left !== null ? left : null,
      notes: notes.trim() || null,
    });
    setBusy(false);
    if (!r.ok || !r.data) {
      if (r.code === "SESSION_CLOSED") {
        await showClosed(summary.session.id);
        return;
      }
      setError(r.error === "network" || !r.error ? t("common.error") : r.error);
      return;
    }
    setClosed(r.data);
  }

  if (closed) {
    const diff = corteDiffCents(closed) ?? 0;
    const kind = differenceKind(diff);
    const text = corteWhatsappText(closed, { shopName, tz, t, categoryLabel });
    return (
      <BarberModal
        open
        wide
        title={t("session.closedTitle")}
        onClose={onDone}
        closeLabel={t("common.close")}
        footer={
          <>
            <a className="btn-new btn-new--secondary" href={waMeLink(text)} target="_blank" rel="noopener noreferrer" data-corte-whatsapp>
              <MessageCircle size={14} /> {t("corte.whatsapp")}
            </a>
            <a className="btn-new btn-new--secondary" href={`/barber/caja/corte/${encodeURIComponent(closed.session.id)}?imprimir=1`} data-corte-imprimir>
              <Printer size={14} /> {t("corte.print")}
            </a>
            <button type="button" className="btn-new barber-btn-primary" onClick={onDone}>{t("common.close")}</button>
          </>
        }
      >
        <div className="bcaja-form" data-corte-hecho>
          {byOther && (
            <div className="bcaja-alert bcaja-alert--info" role="status" data-corte-ya-hecho>
              {t("corte.alreadyClosed", { name: closed.session.closedByName ?? "—", time: fmtDateTime(closed.session.closedAt, tz) })}
            </div>
          )}
          <div className={`bcaja-alert ${kind === "ok" ? "bcaja-alert--success" : kind === "over" ? "bcaja-alert--info" : "bcaja-alert--danger"}`}>
            {t("session.closedBody", {
              expected: fmtMoney(closed.session.expectedAmount ?? 0),
              counted: fmtMoney(closed.session.countedAmount ?? 0),
              difference: fmtSigned(fromCents(diff)),
            })}{" "}
            <strong className={`bcaja-diff bcaja-diff--${kind}`}>{corteDiffLabel(t, diff)}</strong>
          </div>
          <CloseExpectedBreakdown view={closeExpectedView(closed)} t={t} />
          {closed.session.leftForNext !== null && closed.session.leftForNext !== undefined && (
            <p className="bcaja-hint" style={{ margin: 0 }} data-fondo-dejado>
              {t("corte.leftSummary", {
                left: fmtMoney(closed.session.leftForNext),
                take: fmtMoney(fromCents(toCents(closed.session.countedAmount ?? 0) - toCents(closed.session.leftForNext))),
              })}
            </p>
          )}
        </div>
      </BarberModal>
    );
  }

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
          <button type="button" className="btn-new barber-btn-primary" onClick={submit} disabled={counted === null || busy || leftInvalid} data-confirmar-corte>
            {busy ? t("common.saving") : t("session.closeConfirm")}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("session.closeBody")}</p>
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}
        {pendingAppointments > 0 && (
          <div className="bcaja-alert bcaja-alert--warning" data-aviso-citas-por-cobrar>
            <strong>{t("session.apptsPending", { count: pendingAppointments })}</strong>{" "}
            {t("session.apptsPendingHint")}{" "}
            <a href="#citas-por-cobrar" onClick={onClose} style={{ fontWeight: 600, color: "inherit", textDecoration: "underline" }}>
              {t("session.apptsPendingLink")}
            </a>
          </div>
        )}
        {openDrafts > 0 && (
          <div className="bcaja-alert bcaja-alert--info" data-aviso-por-cobrar>
            <strong>{t("session.draftsPending", { count: openDrafts })}</strong>{" "}
            {t("session.draftsPendingHint")}{" "}
            <a href="#por-cobrar" onClick={onClose} style={{ fontWeight: 600, color: "inherit", textDecoration: "underline" }}>
              {t("session.draftsPendingLink")}
            </a>
          </div>
        )}

        <CloseExpectedBreakdown view={closeExpectedView(summary)} t={t} />

        <div className="field-new">
          <label className="field-new__label">{t("corte.howCount")}</label>
          <div className="bcaja-seg" role="radiogroup" aria-label={t("corte.howCount")} style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
            {(["total", "count"] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={`bcaja-seg__btn ${mode === m ? "bcaja-seg__btn--on" : ""}`} onClick={() => setMode(m)} data-modo-conteo={m}>
                {t(m === "total" ? "corte.modeTotal" : "corte.modeCount")}
              </button>
            ))}
          </div>
        </div>

        {mode === "count" && (
          <div className="bcaja-denoms" data-conteo>
            {CASH_DENOMINATIONS.map((d) => (
              <label key={d.key} className="bcaja-denom">
                <span>{denominationLabel(t, d.key)}</span>
                <input
                  className="input-new"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={t("corte.pieces", { denom: denominationLabel(t, d.key) })}
                  value={count[d.key] ?? ""}
                  onChange={(e) => setCount((c) => ({ ...c, [d.key]: e.target.value.replace(/[^\d]/g, "") }))}
                  placeholder="0"
                />
              </label>
            ))}
          </div>
        )}

        <div className="bcaja-form__grid">
          <div className="field-new">
            <label className="field-new__label">{t("session.countedAmount")}</label>
            {mode === "total" ? (
              <>
                <input className="input-new bcaja-amount" inputMode="decimal" autoFocus value={countedText} onChange={(e) => setCountedText(e.target.value)} placeholder="0.00" data-contado />
                {countedText.trim() === "" && <div className="bcaja-hint">{t("session.countedRequired")}</div>}
                {countedText.trim() !== "" && typed === null && <div className="bcaja-hint" role="alert" style={{ color: "var(--danger)" }}>{t("session.amountInvalid")}</div>}
              </>
            ) : (
              <div className="input-new bcaja-amount" aria-live="polite" data-contado-suma>{counted === null ? "—" : fmtMoney(counted)}</div>
            )}
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("session.difference")}</label>
            <div className="input-new bcaja-amount" style={{ display: "flex", alignItems: "center", gap: 8 }} data-diferencia>
              {diffCents === null ? "—" : (
                <>
                  <span>{fmtSigned(fromCents(diffCents))}</span>
                  <BadgeNew tone={diffCents === 0 ? "success" : diffCents > 0 ? "info" : "danger"}>
                    {corteDiffLabel(t, diffCents)}
                  </BadgeNew>
                </>
              )}
            </div>
          </div>
        </div>

        {ready && !canTakeOut && (
          <div className="bcaja-hint" data-fondo-todo>{t("corte.leftAll")}</div>
        )}
        {ready && canTakeOut && (
          <div className="field-new">
            <label className="field-new__label" htmlFor="bcaja-left">{t("corte.leftQuestion")} <span className="bcaja-muted">({t("common.optional")})</span></label>
            <input id="bcaja-left" className="input-new bcaja-amount" inputMode="decimal" value={leftText} onChange={(e) => setLeftText(e.target.value)} placeholder="0.00" data-fondo-manana />
            {leftInvalid ? (
              <div className="bcaja-hint" role="alert" style={{ color: "var(--danger)" }}>{left === null ? t("session.amountInvalid") : t("corte.leftTooBig")}</div>
            ) : left !== null && counted !== null ? (
              <div className="bcaja-hint">{t("corte.leftTake", { amount: fmtMoney(fromCents(toCents(counted) - toCents(left))) })}</div>
            ) : (
              <div className="bcaja-hint">{t("corte.leftHint")}</div>
            )}
          </div>
        )}

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
          <label className="field-new__label">{t("session.closeNotes")} <span className="bcaja-muted">({t("common.optional")})</span></label>
          <input className="input-new" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </div>
        <div className="bcaja-alert bcaja-alert--warning">{t("session.closeWarning")}</div>
      </div>
    </BarberModal>
  );
}

/** Lo que usan los dos diálogos de un ticket: Caja pasa su SaleRow y la ficha del cliente (Pagos) la suya. */
export type SaleForModal = Pick<SaleRow, "id" | "itemsSummary" | "total" | "paymentMethod" | "kind">;

export function CancelSaleModal({ dict, sale, onClose, onDone }: { dict: Dictionary; sale: SaleForModal; onClose: () => void; onDone: () => void }) {
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
        <div className="bcaja-alert bcaja-alert--warning">
          {sale.kind === "membership"
            ? t("caja.cancelMembershipBody")
            : sale.kind === "deposit"
              ? t("caja.cancelDepositBody")
              : sale.kind === "refund"
                ? t("caja.cancelRefundBody")
                : t("caja.cancelTicketBody")}
        </div>
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}
        <div className="field-new">
          <label className="field-new__label">{t("common.reason")}</label>
          <input className="input-new" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("caja.cancelReasonPlaceholder")} maxLength={300} />
        </div>
      </div>
    </BarberModal>
  );
}

/**
 * «Cambiar método de pago» de un ticket ya cobrado (lógica L2, ronda 2): se
 * marcó Efectivo y era Tarjeta. Solo con el turno abierto (Caja solo enseña
 * este botón en los tickets del turno vivo); el servidor lo vuelve a revisar
 * y deja la bitácora. El corte por método se recalcula solo.
 */
export function ChangeMethodModal({ dict, sale, onClose, onDone }: { dict: Dictionary; sale: SaleForModal; onClose: () => void; onDone: (method: BarberPaymentMethod) => void }) {
  const t = useBarberT(dict);
  const [method, setMethod] = useState<BarberPaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!method || busy) return;
    setBusy(true);
    setError(null);
    const r = await postJson(`/api/barber/sales/${sale.id}/payment-method`, { paymentMethod: method });
    setBusy(false);
    if (!r.ok) {
      setError(r.error === "network" || !r.error ? t("common.error") : r.error);
      return;
    }
    onDone(method);
  }

  return (
    <BarberModal
      open
      title={t("caja.changeMethodTitle")}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={busy}>{t("common.back")}</button>
          <button type="button" className="btn-new barber-btn-primary" onClick={submit} disabled={!method || busy}>
            {busy ? t("common.saving") : method ? t("caja.changeMethodConfirm", { method: t(PAYMENT_METHOD_KEYS[method]) }) : t("caja.changeMethod")}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        <div className="bcaja-totals">
          <div className="bcaja-totals__row"><span>{sale.itemsSummary}</span><span>{fmtMoney(sale.total)}</span></div>
          <div className="bcaja-totals__row"><span>{t("caja.changeMethodNow")}</span><span>{t(PAYMENT_METHOD_KEYS[sale.paymentMethod])}</span></div>
        </div>
        <div className="field-new">
          <label className="field-new__label">{t("caja.changeMethodTo")}</label>
          <div className="bcaja-seg" role="radiogroup" aria-label={t("caja.changeMethodTo")}>
            {COUNTER_METHODS.filter((m) => m !== sale.paymentMethod).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={method === m} className={`bcaja-seg__btn ${method === m ? "bcaja-seg__btn--on" : ""}`} onClick={() => setMethod(m)}>
                {t(PAYMENT_METHOD_KEYS[m])}
              </button>
            ))}
          </div>
        </div>
        <p className="bcaja-hint" style={{ margin: 0 }}>{t("caja.changeMethodBody")}</p>
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}
      </div>
    </BarberModal>
  );
}
