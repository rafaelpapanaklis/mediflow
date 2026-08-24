"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Dictionary } from "@/i18n/t";
import type { MovementRow, ProductRow } from "@/lib/barber/inventory";
import type { BarberStockMovementType } from "@/lib/barber/types";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { BarberModal } from "@/components/barber/cash/modal";
import { useBarberT } from "@/components/barber/cash/use-barber-t";
import { fmtDateTime, parseAmountText } from "@/components/barber/cash/money";

// Forma única (sin unión discriminada): con strict:false TS no estrecha
// `ok: true | false`, así que el caller mira `error` directamente.
interface SendResult<T> {
  ok: boolean;
  data: T | null;
  error: string | null;
}

async function sendJson<T>(url: string, method: "POST" | "PATCH", body: unknown): Promise<SendResult<T>> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) return { ok: false, data: null, error: data.error ?? "Error" };
    return { ok: true, data, error: null };
  } catch {
    return { ok: false, data: null, error: "network" };
  }
}

export function ProductFormModal({ dict, product, onClose, onDone }: { dict: Dictionary; product: ProductRow | null; onClose: () => void; onDone: () => void }) {
  const t = useBarberT(dict);
  const editing = Boolean(product);
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [cost, setCost] = useState(product?.cost === null || product?.cost === undefined ? "" : String(product.cost));
  const [minStock, setMinStock] = useState(product?.minStock === null || product?.minStock === undefined ? "" : String(product.minStock));
  const [unit, setUnit] = useState(product?.unit ?? "");
  const [initialStock, setInitialStock] = useState("0");
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceOk = parseAmountText(price) !== null && price.trim() !== "";
  const costOk = cost.trim() === "" || parseAmountText(cost) !== null;
  const intOk = (v: string) => v.trim() === "" || /^\d+$/.test(v.trim());
  const canSave = name.trim().length > 0 && priceOk && costOk && intOk(minStock) && intOk(initialStock) && !busy;

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      name: name.trim(),
      sku: sku.trim() || null,
      price: parseAmountText(price),
      cost: cost.trim() === "" ? null : parseAmountText(cost),
      minStock: minStock.trim() === "" ? null : Number(minStock),
      unit: unit.trim() || null,
    };
    if (editing) body.isActive = isActive;
    else body.initialStock = Number(initialStock || "0");
    const r = editing
      ? await sendJson(`/api/barber/products/${product!.id}`, "PATCH", body)
      : await sendJson("/api/barber/products", "POST", body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error === "network" || !r.error ? t("common.error") : r.error);
      return;
    }
    toast.success(t("productos.saved"));
    onDone();
  }

  return (
    <BarberModal
      open
      title={editing ? t("productos.formEdit") : t("productos.formCreate")}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
          <button type="button" className="btn-new barber-btn-primary" onClick={submit} disabled={!canSave}>{busy ? t("common.saving") : t("common.save")}</button>
        </>
      }
    >
      <div className="bcaja-form">
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}
        <div className="field-new">
          <label className="field-new__label">{t("productos.fName")}</label>
          <input className="input-new" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
        <div className="bcaja-form__grid">
          <div className="field-new">
            <label className="field-new__label">{t("productos.fSku")}</label>
            <input className="input-new" value={sku} onChange={(e) => setSku(e.target.value)} maxLength={60} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("productos.fUnit")}</label>
            <input className="input-new" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("productos.fPrice")}</label>
            <input className="input-new" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("productos.fCost")}</label>
            <input className="input-new" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0.00" />
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("productos.fMin")}</label>
            <input className="input-new" inputMode="numeric" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          </div>
          {editing ? (
            <div className="field-new">
              <label className="field-new__label" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 22 }}>
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> {t("productos.fActive")}
              </label>
              <div className="bcaja-hint">{t("productos.stockHint")}</div>
            </div>
          ) : (
            <div className="field-new">
              <label className="field-new__label">{t("productos.fInitialStock")}</label>
              <input className="input-new" inputMode="numeric" value={initialStock} onChange={(e) => setInitialStock(e.target.value)} />
              <div className="bcaja-hint">{t("productos.fInitialStockHint")}</div>
            </div>
          )}
        </div>
      </div>
    </BarberModal>
  );
}

const MANUAL_TYPES: BarberStockMovementType[] = ["IN", "OUT", "ADJUST", "RETURN"];

export function MovementModal({ dict, product, onClose, onDone }: { dict: Dictionary; product: ProductRow; onClose: () => void; onDone: () => void }) {
  const t = useBarberT(dict);
  const [type, setType] = useState<BarberStockMovementType>("IN");
  const [qtyText, setQtyText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = /^\d+$/.test(qtyText.trim()) ? Number(qtyText.trim()) : null;
  let delta: number | null = null;
  if (n !== null) {
    if (type === "ADJUST") delta = n - product.stock;
    else if (type === "OUT") delta = -n;
    else delta = n;
  }
  const resulting = delta === null ? null : product.stock + delta;
  const negative = resulting !== null && resulting < 0;
  const zeroDelta = delta === 0;
  const canSave = delta !== null && !negative && !zeroDelta && reason.trim().length > 0 && !busy;

  async function submit() {
    if (!canSave || delta === null) return;
    setBusy(true);
    setError(null);
    // El server pone el signo por tipo; para ADJUST manda el delta con signo.
    const qty = type === "ADJUST" ? delta : Math.abs(delta);
    const r = await sendJson(`/api/barber/products/${product.id}/movements`, "POST", { type, qty, reason: reason.trim() });
    setBusy(false);
    if (!r.ok) {
      setError(r.error === "network" || !r.error ? t("common.error") : r.error);
      return;
    }
    toast.success(t("productos.movementSaved"));
    onDone();
  }

  return (
    <BarberModal
      open
      title={t("productos.movementTitle")}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
          <button type="button" className="btn-new barber-btn-primary" onClick={submit} disabled={!canSave}>{busy ? t("common.saving") : t("productos.movementConfirm")}</button>
        </>
      }
    >
      <div className="bcaja-form">
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}
        <div className="bcaja-totals">
          <div className="bcaja-totals__row"><span>{t("productos.movementProduct")}</span><span><strong>{product.name}</strong></span></div>
          <div className="bcaja-totals__row"><span>{t("productos.currentStock", { count: product.stock })}</span><span>{resulting !== null ? t("productos.resultingStock", { count: resulting }) : ""}</span></div>
        </div>
        <div className="bcaja-form__grid">
          <div className="field-new">
            <label className="field-new__label">{t("productos.movementType")}</label>
            <select className="input-new" value={type} onChange={(e) => setType(e.target.value as BarberStockMovementType)}>
              {MANUAL_TYPES.map((k) => <option key={k} value={k}>{t(`productos.type${k}`)}</option>)}
            </select>
          </div>
          <div className="field-new">
            <label className="field-new__label">{type === "ADJUST" ? t("productos.movementNewStock") : t("productos.movementQty")}</label>
            <input className="input-new" inputMode="numeric" autoFocus value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
            <div className="bcaja-hint">{type === "ADJUST" ? t("productos.movementAdjustHint") : t("productos.signConvention")}</div>
          </div>
        </div>
        {negative && <div className="bcaja-alert bcaja-alert--danger">{t("productos.negativeStock")}</div>}
        <div className="field-new">
          <label className="field-new__label">{t("productos.movementReason")}</label>
          <input className="input-new" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("productos.movementReasonPlaceholder")} maxLength={300} />
        </div>
      </div>
    </BarberModal>
  );
}

export function HistoryModal({ dict, product, onClose }: { dict: Dictionary; product: ProductRow; onClose: () => void }) {
  const t = useBarberT(dict);
  const [rows, setRows] = useState<MovementRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/barber/products/${product.id}/movements?limit=100`)
      .then((r) => r.json())
      .then((d: { movements?: MovementRow[] }) => alive && setRows(d.movements ?? []))
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [product.id]);

  return (
    <BarberModal open wide title={t("productos.historyTitle", { name: product.name })} onClose={onClose} closeLabel={t("common.close")}>
      {rows === null ? (
        <span className="bcaja-hint">{t("common.loading")}</span>
      ) : rows.length === 0 ? (
        <span className="bcaja-hint">{t("productos.historyEmpty")}</span>
      ) : (
        <div className="bcaja-table-wrap">
          <table className="table-new">
            <thead>
              <tr>
                <th>{t("productos.hDate")}</th>
                <th>{t("productos.hType")}</th>
                <th className="bcaja-num">{t("productos.hQty")}</th>
                <th>{t("productos.hReason")}</th>
                <th>{t("productos.hUser")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{fmtDateTime(m.createdAt)}</td>
                  <td><BadgeNew tone={m.qty > 0 ? "success" : "warning"}>{t(`productos.type${m.type}`)}</BadgeNew></td>
                  <td className="bcaja-num"><strong>{m.qty > 0 ? `+${m.qty}` : m.qty}</strong></td>
                  <td style={{ whiteSpace: "normal" }}>{m.reason ?? "—"}</td>
                  <td>{m.userName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="bcaja-hint" style={{ marginTop: 10 }}>{t("productos.signConvention")}</div>
    </BarberModal>
  );
}
