"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { ImagePlus, Package, Trash2 } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { MovementRow, ProductRow } from "@/lib/barber/inventory";
import type { ProductExtras } from "@/lib/barber/tienda";
import { PRODUCT_CATEGORY_MAX, PRODUCT_DESCRIPTION_MAX } from "@/lib/barber/tienda-core";
import { comprimirFotoDeCorte, FotoDemasiadoGrande } from "@/components/barber/clients/photo-uploader";
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

export function ProductFormModal({
  dict,
  product,
  tiendaReady = false,
  extras = null,
  categories = [],
  onClose,
  onDone,
}: {
  dict: Dictionary;
  product: ProductRow | null;
  /** sql/barber_tienda.sql pegado: foto, categoría, descripción y tienda. */
  tiendaReady?: boolean;
  extras?: ProductExtras | null;
  /** Categorías que ya usa la barbería (sugerencias). */
  categories?: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useBarberT(dict);
  const editing = Boolean(product);
  const [category, setCategory] = useState(extras?.category ?? "");
  const [description, setDescription] = useState(extras?.description ?? "");
  const [showOnWeb, setShowOnWeb] = useState(extras?.showOnWeb ?? false);
  const [onlineOrder, setOnlineOrder] = useState(extras?.onlineOrder ?? false);
  // Foto: la que ya tiene, una nueva elegida (aún sin subir) o «quitar».
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(extras?.photoUrl ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => {
    if (photoPreview && photoPreview.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  async function pickPhoto(files: FileList | null) {
    const raw = files?.[0];
    if (!raw) return;
    setPhotoBusy(true);
    setError(null);
    try {
      // Se reduce en el navegador (1600 px, WebP), como las fotos de clientes.
      const ready = await comprimirFotoDeCorte(raw);
      setPhotoFile(ready.file);
      setPhotoPreview(URL.createObjectURL(ready.file));
      setRemovePhoto(false);
    } catch (e) {
      setError(e instanceof FotoDemasiadoGrande ? t("productos.photoTooBig") : t("productos.photoUnreadable"));
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
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
  const canSave = name.trim().length > 0 && priceOk && costOk && intOk(minStock) && intOk(initialStock) && !busy && !photoBusy;

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
      ? await sendJson<ProductRow>(`/api/barber/products/${product!.id}`, "PATCH", body)
      : await sendJson<ProductRow>("/api/barber/products", "POST", body);
    if (!r.ok) {
      setBusy(false);
      setError(r.error === "network" || !r.error ? t("common.error") : r.error);
      return;
    }
    // Lo de la tienda va aparte (otra tabla de columnas y otra ruta). Si
    // falla, el producto YA quedó guardado: se avisa sin perderlo.
    const id = editing ? product!.id : r.data?.id;
    let warn: string | null = null;
    if (tiendaReady && id) {
      const ex = await sendJson(`/api/barber/products/${id}/tienda`, "PATCH", {
        category: category.trim() || null,
        description: description.trim() || null,
        showOnWeb,
        onlineOrder: showOnWeb && onlineOrder,
      });
      if (!ex.ok) warn = ex.error;
      if (photoFile) {
        const fd = new FormData();
        fd.append("file", photoFile);
        try {
          const up = await fetch(`/api/barber/products/${id}/photo`, { method: "POST", body: fd });
          if (!up.ok) warn = ((await up.json().catch(() => ({}))) as { error?: string }).error ?? t("productos.photoFailed");
        } catch {
          warn = t("productos.photoFailed");
        }
      } else if (removePhoto && extras?.photoUrl) {
        try {
          await fetch(`/api/barber/products/${id}/photo`, { method: "DELETE" });
        } catch {
          warn = t("productos.photoFailed");
        }
      }
    }
    setBusy(false);
    if (warn) toast.error(`${t("productos.savedWithWarning")} ${warn}`);
    else toast.success(t("productos.saved"));
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
        {tiendaReady ? (
          <>
            <div className="field-new">
              <span className="field-new__label">{t("productos.fPhoto")}</span>
              <div className="btienda-photo-field">
                <div className="btienda-photo-thumb">
                  {photoPreview && !removePhoto ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoPreview} alt="" />
                  ) : (
                    <Package size={22} aria-hidden="true" />
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    <button type="button" className="btn-new btn-new--secondary" onClick={() => fileRef.current?.click()} disabled={photoBusy || busy} data-accion="elegir-foto">
                      <ImagePlus size={14} /> {photoBusy ? t("productos.photoPreparing") : photoPreview && !removePhoto ? t("productos.photoChange") : t("productos.photoAdd")}
                    </button>
                    {photoPreview && !removePhoto ? (
                      <button type="button" className="btn-new btn-new--ghost" onClick={() => { setPhotoFile(null); setRemovePhoto(true); }} disabled={busy}>
                        <Trash2 size={14} /> {t("productos.photoRemove")}
                      </button>
                    ) : null}
                  </div>
                  <span className="bcaja-hint">{t("productos.photoHint")}</span>
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden onChange={(e) => void pickPhoto(e.target.files)} data-foto-producto />
                </div>
              </div>
            </div>
            <div className="bcaja-form__grid">
              <div className="field-new">
                <label className="field-new__label" htmlFor="prod-categoria">{t("productos.fCategory")}</label>
                <input id="prod-categoria" className="input-new" list="prod-categorias" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={PRODUCT_CATEGORY_MAX} placeholder={t("productos.fCategoryPlaceholder")} />
                <datalist id="prod-categorias">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="field-new" style={{ gridColumn: "1 / -1" }}>
                <label className="field-new__label" htmlFor="prod-descripcion">{t("productos.fDescription")}</label>
                <textarea id="prod-descripcion" className="input-new" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={PRODUCT_DESCRIPTION_MAX} placeholder={t("productos.fDescriptionPlaceholder")} style={{ resize: "vertical", minHeight: 60 }} />
                <div className="bcaja-hint" style={{ textAlign: "right" }}>{description.length}/{PRODUCT_DESCRIPTION_MAX}</div>
              </div>
            </div>
            <label className="btienda-switch">
              <input type="checkbox" checked={showOnWeb} onChange={(e) => setShowOnWeb(e.target.checked)} data-mostrar-en-web />
              <span>{t("productos.fShowOnWeb")}<small>{t("productos.fShowOnWebHint")}</small></span>
            </label>
            <label className={showOnWeb ? "btienda-switch" : "btienda-switch btienda-switch--off"}>
              <input type="checkbox" checked={showOnWeb && onlineOrder} disabled={!showOnWeb} onChange={(e) => setOnlineOrder(e.target.checked)} data-apartar-en-linea />
              <span>{t("productos.fOnlineOrder")}<small>{t("productos.fOnlineOrderHint")}</small></span>
            </label>
          </>
        ) : null}
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
            <div className="bcaja-hint">{type === "ADJUST" ? t("productos.movementAdjustHint") : t(type === "OUT" ? "productos.movementOutHint" : "productos.movementInHint")}</div>
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
