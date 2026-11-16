"use client";

import { useRef, useState, type ReactNode } from "react";
import { Camera, X } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CheckoutContext } from "@/lib/barber/cash";
import type { CashMovementRow } from "@/lib/barber/cash-movements";
import {
  CASH_EXPENSE_CATEGORIES,
  CASH_MOVEMENT_METHODS,
  parseMovementAmount,
  type BarberPayoutKind,
  type CashMovementMethod,
  type CashMovementType,
} from "@/lib/barber/caja-movimientos-core";
import { comprimirFotoDeCorte, FotoDemasiadoGrande, FotoIlegible } from "@/components/barber/clients/photo-uploader";
import { BarberModal } from "./modal";
import { useBarberT } from "./use-barber-t";
import { fmtMoney, fmtTime } from "./money";

/** Etiqueta de una categoría guardada (clave conocida → diccionario; otra → tal cual). */
export function categoryLabel(t: (k: string) => string, category: string | null): string {
  if (!category) return t("mov.cat.none");
  return (CASH_EXPENSE_CATEGORIES as readonly string[]).includes(category) ? t(`mov.cat.${category}`) : category;
}

/** Título corto de un movimiento para la lista y los diálogos. */
export function movementTitle(t: (k: string, v?: Record<string, string | number>) => string, m: Pick<CashMovementRow, "type" | "category" | "payoutKind" | "barberName">): string {
  switch (m.type) {
    case "EXPENSE":
      return `${t("mov.type.EXPENSE")} · ${categoryLabel(t, m.category)}`;
    case "WITHDRAWAL":
      return t("mov.type.WITHDRAWAL");
    case "DEPOSIT":
      return t("mov.type.DEPOSIT");
    default:
      return `${t(`mov.payout.${m.payoutKind ?? "OTHER"}`)} · ${m.barberName ?? "—"}`;
  }
}

async function postJson<T>(url: string, body: unknown): Promise<{ data: T | null; error: string | null; code?: string; details?: unknown }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; details?: unknown };
    if (!res.ok) return { data: null, error: json.error ?? "Error", code: json.code, details: json.details };
    return { data: json, error: null };
  } catch {
    return { data: null, error: "network" };
  }
}

export interface MovementSaved {
  movement: CashMovementRow;
  outsideSession: boolean;
}

/** Tipos de pago que se registran como movimiento (comisión y sueldo van por Comisiones). */
const MOVEMENT_PAYOUT_KINDS: BarberPayoutKind[] = ["ADVANCE", "OTHER"];

/**
 * Ventana corta para registrar un gasto, sacar o meter efectivo, o pagarle a
 * un barbero. Solo el monto es obligatorio; categoría, nota y foto, no. El
 * servidor vuelve a validar todo y decide si cae en la caja abierta.
 */
export function MovementModal({
  dict,
  type,
  sessionOpen,
  barbers,
  onClose,
  onDone,
  extraPayout,
}: {
  dict: Dictionary;
  type: CashMovementType;
  /** Hay caja abierta (un gasto sin caja queda «fuera de caja»). */
  sessionOpen: boolean;
  barbers?: CheckoutContext["barbers"];
  onClose: () => void;
  onDone: (r: MovementSaved) => void;
  /**
   * Pago de comisión/sueldo (punto 5): si se elige uno de esos tipos, la
   * ventana le cede el control a este componente.
   */
  extraPayout?: {
    kinds: BarberPayoutKind[];
    render: (args: { kind: BarberPayoutKind; barberId: string | null; method: CashMovementMethod; onDone: () => void }) => ReactNode;
  };
}) {
  const t = useBarberT(dict);
  const [amountText, setAmountText] = useState("");
  const [method, setMethod] = useState<CashMovementMethod>("CASH");
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [barberId, setBarberId] = useState<string | null>(null);
  const [payoutKind, setPayoutKind] = useState<BarberPayoutKind>("ADVANCE");
  const [receipt, setReceipt] = useState<{ path: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const cashOnly = type === "WITHDRAWAL" || type === "DEPOSIT";
  const isPayout = type === "BARBER_PAYOUT";
  const withReceipt = type === "EXPENSE" || isPayout;
  const parsed = parseMovementAmount(amountText);
  const delegated = isPayout && extraPayout && extraPayout.kinds.includes(payoutKind);
  const canSubmit = parsed.ok && !busy && !uploading && (!isPayout || barberId !== null);

  async function pickPhoto(file: File | null | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const comp = await comprimirFotoDeCorte(file);
      const form = new FormData();
      form.append("file", comp.file, comp.file.name);
      const res = await fetch("/api/barber/cash-movements/receipt", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok || !json.path) {
        setError(json.error ?? t("common.error"));
        return;
      }
      setReceipt({ path: json.path, name: file.name });
    } catch (e) {
      setError(e instanceof FotoDemasiadoGrande ? t("mov.photoTooBig") : e instanceof FotoIlegible ? t("mov.photoBad") : t("common.error"));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit() {
    if (!canSubmit || !parsed.ok) return;
    setBusy(true);
    setError(null);
    const r = await postJson<MovementSaved>("/api/barber/cash-movements", {
      type,
      amount: (parsed.cents / 100).toFixed(2),
      method: cashOnly ? "CASH" : method,
      category: type === "EXPENSE" ? category : null,
      note: note.trim() || null,
      barberId: isPayout ? barberId : null,
      payoutKind: isPayout ? payoutKind : null,
      receiptPath: receipt?.path ?? null,
    });
    setBusy(false);
    if (!r.data) {
      setError(r.error === "network" ? t("common.error") : r.error);
      return;
    }
    onDone(r.data);
  }

  const amountHint =
    amountText.trim() === "" ? null : parsed.ok ? null : t(`mov.amountError.${parsed.error}`);

  return (
    <BarberModal
      open
      title={t(`mov.title.${type}`)}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        delegated ? undefined : (
          <>
            <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
            <button type="button" className="btn-new barber-btn-primary" onClick={submit} disabled={!canSubmit} data-mov-guardar>
              {busy ? t("common.saving") : parsed.ok ? t(`mov.confirm.${type}`, { amount: fmtMoney(parsed.cents / 100) }) : t(`mov.title.${type}`)}
            </button>
          </>
        )
      }
    >
      <div className="bcaja-form">
        <p className="bcaja-hint" style={{ margin: 0 }}>{t(`mov.body.${type}`)}</p>
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}

        {isPayout && barbers && (
          <div className="field-new">
            <label className="field-new__label">{t("mov.barber")}</label>
            {barbers.length === 0 ? (
              <p className="bcaja-hint" style={{ margin: 0 }}>{t("mov.noBarbers")}</p>
            ) : (
              <div className="bcaja-cats" role="radiogroup" aria-label={t("mov.barber")}>
                {barbers.map((b) => (
                  <button key={b.id} type="button" role="radio" aria-checked={barberId === b.id} className={`bcaja-cat ${barberId === b.id ? "bcaja-cat--on" : ""}`} onClick={() => setBarberId(b.id)}>
                    {b.nickname || b.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isPayout && (
          <div className="field-new">
            <label className="field-new__label">{t("mov.payoutKind")}</label>
            <div className="bcaja-seg" role="radiogroup" aria-label={t("mov.payoutKind")} style={{ gridTemplateColumns: `repeat(${MOVEMENT_PAYOUT_KINDS.length + (extraPayout?.kinds.length ?? 0)}, minmax(0, 1fr))` }}>
              {[...MOVEMENT_PAYOUT_KINDS.slice(0, 1), ...(extraPayout?.kinds ?? []), ...MOVEMENT_PAYOUT_KINDS.slice(1)].map((k) => (
                <button key={k} type="button" role="radio" aria-checked={payoutKind === k} className={`bcaja-seg__btn ${payoutKind === k ? "bcaja-seg__btn--on" : ""}`} onClick={() => setPayoutKind(k)}>
                  {t(`mov.payout.${k}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {delegated && extraPayout ? (
          extraPayout.render({ kind: payoutKind, barberId, method, onDone: onClose })
        ) : (
          <>
            <div className="field-new">
              <label className="field-new__label" htmlFor="bcaja-mov-amount">{t("mov.amount")}</label>
              <input
                id="bcaja-mov-amount"
                className="input-new bcaja-amount"
                inputMode="decimal"
                autoComplete="off"
                autoFocus
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
                placeholder="0.00"
                aria-invalid={amountHint ? true : undefined}
              />
              {amountHint && <div className="bcaja-hint" role="alert" style={{ color: "var(--danger)" }}>{amountHint}</div>}
            </div>

            {type === "EXPENSE" && (
              <div className="field-new">
                <label className="field-new__label">{t("mov.category")} <span className="bcaja-muted">({t("common.optional")})</span></label>
                <div className="bcaja-cats" role="radiogroup" aria-label={t("mov.category")}>
                  {CASH_EXPENSE_CATEGORIES.map((c) => (
                    <button key={c} type="button" role="radio" aria-checked={category === c} className={`bcaja-cat ${category === c ? "bcaja-cat--on" : ""}`} onClick={() => setCategory(category === c ? null : c)}>
                      {t(`mov.cat.${c}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!cashOnly && (
              <div className="field-new">
                <label className="field-new__label">{t("mov.methodLabel")}</label>
                <div className="bcaja-seg" role="radiogroup" aria-label={t("mov.methodLabel")} style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                  {CASH_MOVEMENT_METHODS.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={method === m} className={`bcaja-seg__btn ${method === m ? "bcaja-seg__btn--on" : ""}`} onClick={() => setMethod(m)}>
                      {t(`mov.method.${m}`)}
                    </button>
                  ))}
                </div>
                {method === "CASH" && !sessionOpen && <div className="bcaja-alert bcaja-alert--warning" style={{ marginTop: 8 }} data-aviso-fuera-de-caja>{t("mov.outsideWarning")}</div>}
                {method !== "CASH" && <div className="bcaja-hint">{t("mov.notDrawer")}</div>}
              </div>
            )}

            <div className="field-new">
              <label className="field-new__label" htmlFor="bcaja-mov-note">{t("mov.note")} <span className="bcaja-muted">({t("common.optional")})</span></label>
              <input id="bcaja-mov-note" className="input-new" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={t(`mov.notePlaceholder.${type}`)} />
            </div>

            {withReceipt && (
              <div className="field-new">
                <label className="field-new__label">{t("mov.receipt")} <span className="bcaja-muted">({t("common.optional")})</span></label>
                {receipt ? (
                  <div className="bcaja-receipt">
                    <span>{t("mov.receiptReady")}</span>
                    <button type="button" className="icon-btn-new" aria-label={t("mov.receiptRemove")} title={t("mov.receiptRemove")} onClick={() => setReceipt(null)}>
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <>
                    <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
                    <button type="button" className="btn-new btn-new--secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                      <Camera size={14} /> {uploading ? t("mov.receiptUploading") : t("mov.receiptAdd")}
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </BarberModal>
  );
}

/** Anular un movimiento: nunca se borra; queda tachado con quién y cuándo. Motivo opcional. */
export function VoidMovementModal({
  dict,
  movement,
  tz,
  onClose,
  onDone,
}: {
  dict: Dictionary;
  movement: CashMovementRow;
  tz: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useBarberT(dict);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await postJson(`/api/barber/cash-movements/${encodeURIComponent(movement.id)}/void`, { reason: reason.trim() || null });
    setBusy(false);
    if (!r.data) {
      setError(r.error === "network" ? t("common.error") : r.error);
      return;
    }
    onDone();
  }

  return (
    <BarberModal
      open
      title={t("mov.voidTitle")}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={busy}>{t("common.back")}</button>
          <button type="button" className="btn-new btn-new--danger" onClick={submit} disabled={busy} data-mov-anular>
            {busy ? t("common.saving") : t("mov.voidConfirm")}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        <div className="bcaja-totals">
          <div className="bcaja-totals__row">
            <span>{movementTitle(t, movement)} · {fmtTime(movement.createdAt, tz)}</span>
            <span>{fmtMoney(movement.amount)}</span>
          </div>
        </div>
        <div className="bcaja-alert bcaja-alert--warning">{t("mov.voidBody")}</div>
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}
        <div className="field-new">
          <label className="field-new__label" htmlFor="bcaja-void-reason">{t("common.reason")} <span className="bcaja-muted">({t("common.optional")})</span></label>
          <input id="bcaja-void-reason" className="input-new" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
        </div>
      </div>
    </BarberModal>
  );
}
