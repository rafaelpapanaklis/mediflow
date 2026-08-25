"use client";

// ═══════════════════════════════════════════════════════════════════════
// Registrar un pago de renta. Admite ABONO PARCIAL a propósito: en la vida
// real el inquilino abona seis mil de doce mil y el dueño necesita que el
// sistema lo acepte y le diga cuánto falta, no que le exija el monto exacto.
//
// El "quedaría pendiente" se recalcula mientras se teclea: es la cifra que
// el dueño le va a decir por teléfono, y tiene que verla ANTES de guardar.
//
// 🔴 Lo que se emite es un RECIBO con folio. Ni factura, ni CFDI, ni SAT.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from "react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import { centsToNumber, formatMoney, toCents } from "@/lib/realty/rent-charges";
import type { RealtyCurrency, RealtyPaymentMethod } from "@/lib/realty/types";
import { Field, Modal, Note } from "./ui";

export interface PaymentTarget {
  chargeId: string;
  leaseId: string;
  propertyTitle: string;
  tenantName: string;
  periodLabel: string;
  amount: number;
  paid: number;
  balance: number;
  currency: RealtyCurrency;
}

const METHODS: RealtyPaymentMethod[] = ["EFECTIVO", "SPEI", "TARJETA", "OTRO"];

export function PaymentForm({
  dict,
  target,
  todayISO,
  onClose,
  onSaved,
}: {
  dict: Dictionary;
  target: PaymentTarget | null;
  todayISO: string;
  onClose: () => void;
  onSaved: (result: { folio: string; url: string | null; balance: number }) => void;
}) {
  const t = makeRealtyT(dict);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<RealtyPaymentMethod>("EFECTIVO");
  const [paidAt, setPaidAt] = useState(todayISO);
  const [reference, setReference] = useState("");
  const [emitReceipt, setEmitReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    // Se propone el saldo completo, que es lo que pasa nueve de cada diez
    // veces, pero queda editable para el abono parcial.
    setAmount(target.balance > 0 ? target.balance.toFixed(2) : "");
    setMethod("EFECTIVO");
    setPaidAt(todayISO);
    setReference("");
    setEmitReceipt(true);
    setError(null);
  }, [target, todayISO]);

  const remaining = useMemo(() => {
    if (!target) return 0;
    const balanceCents = toCents(target.balance);
    const payCents = toCents(amount);
    return centsToNumber(Math.max(0, balanceCents - payCents));
  }, [target, amount]);

  const partial = target ? toCents(amount) > 0 && toCents(amount) < toCents(target.balance) : false;

  async function submit() {
    if (!target || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/realty/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chargeId: target.chargeId,
          amount,
          method,
          paidAt,
          reference: reference.trim() || null,
          emitReceipt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? t("common.genericError"));
        setBusy(false);
        return;
      }
      onSaved({
        folio: String(data?.receiptFolio ?? ""),
        url: (data?.receiptUrl as string | null) ?? null,
        balance: Number(data?.balance ?? 0),
      });
    } catch {
      setError(t("common.genericError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      closeLabel={t("common.close")}
      title={t("payment.title")}
      sub={
        target
          ? t("payment.sub", { property: target.propertyTitle, tenant: target.tenantName })
          : undefined
      }
      footer={
        <>
          <button type="button" className="rnt-btn" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="rnt-btn rnt-btn--primary"
            onClick={submit}
            disabled={busy || toCents(amount) <= 0}
          >
            {busy ? t("common.saving") : t("payment.submit")}
          </button>
        </>
      }
    >
      {error ? <Note tone="danger">{error}</Note> : null}

      {target ? (
        <div className="rnt-grid rnt-grid--auto">
          <div>
            <div className="rnt-field__label">{t("payment.charge")}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {formatMoney(target.amount, target.currency)}
            </div>
            <div className="rnt-field__hint">{target.periodLabel}</div>
          </div>
          <div>
            <div className="rnt-field__label">{t("payment.already")}</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {formatMoney(target.paid, target.currency)}
            </div>
          </div>
          <div>
            <div className="rnt-field__label">{t("charges.table.balance")}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--danger)" }}>
              {formatMoney(target.balance, target.currency)}
            </div>
          </div>
        </div>
      ) : null}

      <Field label={t("payment.amount")} hint={t("payment.amountHint")}>
        <input
          className="rnt-input"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          autoFocus
        />
      </Field>

      {target && target.balance > 0 ? (
        <div className="rnt-toolbar">
          <button
            type="button"
            className="rnt-btn rnt-btn--sm"
            onClick={() => setAmount(target.balance.toFixed(2))}
          >
            {t("payment.full")} · {formatMoney(target.balance, target.currency)}
          </button>
        </div>
      ) : null}

      {target && partial ? (
        <Note tone="warning">
          {t("payment.willRemain")}: <strong>{formatMoney(remaining, target.currency)}</strong>
        </Note>
      ) : null}

      <div className="rnt-grid">
        <Field label={t("payment.method")}>
          <select
            className="rnt-select"
            value={method}
            onChange={(e) => setMethod(e.target.value as RealtyPaymentMethod)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`payment.method_.${m}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("payment.paidAt")}>
          <input
            className="rnt-input"
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </Field>
      </div>

      <Field label={t("payment.reference")} hint={t("payment.referenceHint")}>
        <input
          className="rnt-input"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </Field>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={emitReceipt}
          onChange={(e) => setEmitReceipt(e.target.checked)}
        />
        <span>{t("payment.emitReceipt")}</span>
      </label>
      <div className="rnt-field__hint">{t("receipt.notInvoice")}</div>
    </Modal>
  );
}
