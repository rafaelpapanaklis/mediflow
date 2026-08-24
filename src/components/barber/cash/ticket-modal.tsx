"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Banknote, CheckCircle2, CreditCard, Landmark, Minus, Plus, Printer, Trash2, type LucideIcon } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import type { CheckoutContext, ClientLookup, PendingAppointment, SaleRow } from "@/lib/barber/cash";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { BarberModal } from "./modal";
import { useBarberT } from "./use-barber-t";
import { fmtMoney, fmtTime, fromCents, parseAmountText, toCents, PAYMENT_METHOD_KEYS } from "./money";

interface Line {
  key: string;
  kind: "service" | "product";
  id: string;
  name: string;
  qty: number;
  /** Precio unitario en pesos (del catálogo o congelado de la cita). */
  unitPrice: number;
  frozen: boolean;
  stock: number | null;
}

let lineSeq = 0;
const nextKey = () => `l${++lineSeq}`;

const METHODS: Array<{ value: BarberPaymentMethod; Icon: LucideIcon }> = [
  { value: "CASH", Icon: Banknote },
  { value: "CARD", Icon: CreditCard },
  { value: "SPEI", Icon: Landmark },
];

const TIP_FIXED = [20, 50, 100];
const TIP_PCT = [10, 15];

type TipMode = { kind: "none" } | { kind: "fixed"; amount: number } | { kind: "pct"; pct: number } | { kind: "custom" };

export function TicketModal({
  dict,
  checkout,
  appointment,
  tz,
  onClose,
  onCharged,
}: {
  dict: Dictionary;
  checkout: CheckoutContext;
  appointment: PendingAppointment | null;
  tz: string;
  onClose: () => void;
  onCharged: (sale: SaleRow) => void;
}) {
  const t = useBarberT(dict);
  const [barberId, setBarberId] = useState<string>(
    appointment?.barberId ?? (checkout.barbers.length === 1 ? checkout.barbers[0].id : ""),
  );
  const [client, setClient] = useState<ClientLookup | null>(appointment?.client ?? null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ClientLookup[]>([]);
  const [lines, setLines] = useState<Line[]>(() =>
    (appointment?.services ?? []).map((s) => ({
      key: nextKey(),
      kind: "service",
      id: s.serviceId,
      name: s.name,
      qty: 1,
      unitPrice: s.priceAtBooking,
      frozen: true,
      stock: null,
    })),
  );
  const [addServiceId, setAddServiceId] = useState("");
  const [addProductId, setAddProductId] = useState("");
  const [discountText, setDiscountText] = useState("");
  const [tipMode, setTipMode] = useState<TipMode>({ kind: "none" });
  const [tipText, setTipText] = useState("");
  const [method, setMethod] = useState<BarberPaymentMethod>("CASH");
  const [notes, setNotes] = useState("");
  const [loyaltyKey, setLoyaltyKey] = useState<string | null>(null);
  const [membershipKey, setMembershipKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SaleRow | null>(null);

  // Búsqueda de clientes (debounce corto).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/barber/sales/clients?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { clients: ClientLookup[] };
        setSuggestions(data.clients);
      } catch {
        /* silencioso: es solo autocompletar */
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const serviceLines = lines.filter((l) => l.kind === "service" && l.qty === 1);
  const loyaltyAvailable = Boolean(client?.loyaltyEligible) && serviceLines.length > 0;
  const membershipAvailable = Boolean(client?.activeMembership) && serviceLines.length > 0;

  // Si desaparece el cliente o la línea, el canje se apaga solo.
  useEffect(() => {
    if (loyaltyKey && (!loyaltyAvailable || !lines.some((l) => l.key === loyaltyKey && l.kind === "service" && l.qty === 1))) setLoyaltyKey(null);
    if (membershipKey && (!membershipAvailable || !lines.some((l) => l.key === membershipKey && l.kind === "service" && l.qty === 1))) setMembershipKey(null);
  }, [lines, loyaltyAvailable, membershipAvailable, loyaltyKey, membershipKey]);

  const totals = useMemo(() => {
    const gross = lines.reduce((s, l) => {
      const covered = l.key === loyaltyKey || l.key === membershipKey;
      return s + (covered ? 0 : toCents(l.unitPrice) * l.qty);
    }, 0);
    const discountParsed = parseAmountText(discountText);
    const discount = Math.min(discountParsed === null ? 0 : toCents(discountParsed), gross);
    const subtotal = gross - discount;
    let tip = 0;
    if (tipMode.kind === "fixed") tip = toCents(tipMode.amount);
    else if (tipMode.kind === "pct") tip = Math.round((subtotal * tipMode.pct) / 100);
    else if (tipMode.kind === "custom") {
      const p = parseAmountText(tipText);
      tip = p === null ? 0 : toCents(p);
    }
    return { gross, discount, subtotal, tip, total: subtotal + tip, discountInvalid: discountParsed === null };
  }, [lines, loyaltyKey, membershipKey, discountText, tipMode, tipText]);

  function addService() {
    const s = checkout.services.find((x) => x.id === addServiceId);
    if (!s) return;
    setLines((prev) => [...prev, { key: nextKey(), kind: "service", id: s.id, name: s.name, qty: 1, unitPrice: s.price, frozen: false, stock: null }]);
    setAddServiceId("");
  }
  function addProduct() {
    const p = checkout.products.find((x) => x.id === addProductId);
    if (!p || p.stock <= 0) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.kind === "product" && l.id === p.id);
      if (existing) {
        return prev.map((l) => (l.key === existing.key ? { ...l, qty: Math.min(l.qty + 1, p.stock) } : l));
      }
      return [...prev, { key: nextKey(), kind: "product", id: p.id, name: p.name, qty: 1, unitPrice: p.price, frozen: false, stock: p.stock }];
    });
    setAddProductId("");
  }
  function changeQty(key: string, delta: number) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.key !== key) return l;
        const max = l.stock ?? 99;
        return { ...l, qty: Math.max(1, Math.min(max, l.qty + delta)) };
      }),
    );
  }
  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  const tipNeedsBarber = totals.tip > 0 && !barberId;
  const canSubmit = lines.length > 0 && !submitting && !totals.discountInvalid && !tipNeedsBarber;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        appointmentId: appointment?.id ?? null,
        clientId: client?.id ?? null,
        barberId: barberId || null,
        items: lines.map((l) => ({ kind: l.kind, id: l.id, qty: l.qty })),
        discount: fromCents(totals.discount),
        tip: fromCents(totals.tip),
        paymentMethod: method,
        redeemLoyaltyItemIndex: loyaltyKey ? lines.findIndex((l) => l.key === loyaltyKey) : null,
        membershipItemIndex: membershipKey ? lines.findIndex((l) => l.key === membershipKey) : null,
        notes: notes.trim() || null,
      };
      const res = await fetch("/api/barber/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as SaleRow & { error?: string; code?: string };
      if (!res.ok) {
        if (data.code === "NO_OPEN_SESSION") setError(t("ticket.errorNoSession"));
        else if (data.code === "OUT_OF_STOCK") setError(`${t("ticket.errorStock")} ${data.error ?? ""}`.trim());
        else setError(data.error ?? t("common.error"));
        return;
      }
      setResult(data);
      onCharged(data);
    } catch {
      setError(t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }

  function resetForAnother() {
    setResult(null);
    setLines([]);
    setClient(null);
    setQuery("");
    setDiscountText("");
    setTipMode({ kind: "none" });
    setTipText("");
    setNotes("");
    setLoyaltyKey(null);
    setMembershipKey(null);
    setError(null);
  }

  const title = appointment ? t("ticket.fromAppointment", { time: fmtTime(appointment.startAt, tz) }) : t("ticket.title");

  if (result) {
    return (
      <BarberModal open title={t("ticket.success")} onClose={onClose} closeLabel={t("common.close")}>
        <div className="bcaja-success">
          <div className="bcaja-success__icon"><CheckCircle2 size={28} /></div>
          <div className="bcaja-success__amount">{fmtMoney(result.total)}</div>
          <div className="bcaja-hint">{t("ticket.successBody", { amount: fmtMoney(result.total), method: t(PAYMENT_METHOD_KEYS[result.paymentMethod]) })}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 8 }}>
            <Link href={`/barber/caja/ticket/${result.id}`} className="btn-new btn-new--secondary" target="_blank">
              <Printer size={14} /> {t("ticket.printTicket")}
            </Link>
            {!appointment && (
              <button type="button" className="btn-new btn-new--secondary" onClick={resetForAnother}>
                {t("ticket.newTicket")}
              </button>
            )}
            <button type="button" className="btn-new barber-btn-primary" onClick={onClose}>{t("ticket.done")}</button>
          </div>
        </div>
      </BarberModal>
    );
  }

  return (
    <BarberModal
      open
      wide
      title={title}
      onClose={onClose}
      closeLabel={t("common.close")}
      footer={
        <>
          <button type="button" className="btn-new btn-new--ghost" onClick={onClose} disabled={submitting}>{t("common.cancel")}</button>
          <button type="button" className="btn-new barber-btn-primary" onClick={submit} disabled={!canSubmit}>
            {submitting ? t("ticket.charging") : t("ticket.confirm", { amount: fmtMoney(fromCents(totals.total)) })}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}

        <div className="bcaja-form__grid">
          {/* Barbero */}
          <div className="field-new">
            <label className="field-new__label">{t("ticket.barber")}</label>
            <select className="input-new" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
              <option value="">{t("ticket.barberNone")}</option>
              {checkout.barbers.map((b) => (
                <option key={b.id} value={b.id}>{b.nickname || b.name}</option>
              ))}
            </select>
          </div>

          {/* Cliente */}
          <div className="field-new">
            <label className="field-new__label">{t("ticket.client")}</label>
            {client ? (
              <div className="bcaja-client">
                <div style={{ minWidth: 0 }}>
                  <div className="bcaja-client__name">{client.name}</div>
                  <div className="bcaja-client__meta">
                    {client.phone} · {t("ticket.loyaltyStamps", { count: client.loyaltyCount, target: checkout.loyaltyTarget })}
                    {client.loyaltyEligible ? ` · ${t("ticket.loyaltyEligible")}` : ""}
                    {client.activeMembership
                      ? ` · ${t("ticket.membershipActive", { name: client.activeMembership.name })} (${client.activeMembership.cutsLeft === null ? t("ticket.membershipUnlimited") : t("ticket.membershipCutsLeft", { count: client.activeMembership.cutsLeft })})`
                      : ""}
                  </div>
                </div>
                <button type="button" className="btn-new btn-new--ghost btn-new--sm" onClick={() => setClient(null)}>{t("ticket.clientClear")}</button>
              </div>
            ) : appointment?.clientName && !appointment.clientId ? (
              <div className="bcaja-client"><div className="bcaja-client__name">{appointment.clientName}</div></div>
            ) : (
              <div style={{ position: "relative" }}>
                <input className="input-new" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("ticket.clientSearch")} autoComplete="off" />
                {suggestions.length > 0 && (
                  <div className="bcaja-suggest">
                    {suggestions.map((c) => (
                      <button key={c.id} type="button" className="bcaja-suggest__item" onClick={() => { setClient(c); setQuery(""); setSuggestions([]); }}>
                        <div className="bcaja-client__name">{c.name}</div>
                        <div className="bcaja-client__meta">{c.phone} · {t("ticket.loyaltyStamps", { count: c.loyaltyCount, target: checkout.loyaltyTarget })}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Líneas */}
        <div className="field-new">
          <label className="field-new__label">{t("ticket.lines")}</label>
          {lines.length === 0 ? (
            <div className="bcaja-hint">{t("ticket.empty")}</div>
          ) : (
            <div className="bcaja-lines">
              {lines.map((l) => {
                const covered = l.key === loyaltyKey || l.key === membershipKey;
                return (
                  <div key={l.key} className="bcaja-line">
                    <div style={{ minWidth: 0 }}>
                      <div className="bcaja-line__name">{l.name}</div>
                      <div className="bcaja-line__hint">
                        {covered ? t("ticket.free") : fmtMoney(l.unitPrice)}
                        {l.frozen ? ` · ${t("ticket.frozenPrice")}` : ""}
                        {l.stock !== null ? ` · ${t("ticket.stockLeft", { count: l.stock })}` : ""}
                      </div>
                    </div>
                    <div className="bcaja-qty">
                      <button type="button" className="bcaja-qty__btn" onClick={() => changeQty(l.key, -1)} disabled={l.qty <= 1} aria-label="−"><Minus size={12} /></button>
                      <span className="bcaja-qty__n">{l.qty}</span>
                      <button type="button" className="bcaja-qty__btn" onClick={() => changeQty(l.key, 1)} disabled={l.stock !== null && l.qty >= l.stock} aria-label="+"><Plus size={12} /></button>
                    </div>
                    <span className="bcaja-line__price">{fmtMoney(covered ? 0 : l.unitPrice * l.qty)}</span>
                    <button type="button" className="icon-btn-new" onClick={() => removeLine(l.key)} aria-label={t("ticket.remove")} title={t("ticket.remove")}><Trash2 size={13} /></button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bcaja-form__grid">
          <div className="field-new">
            <label className="field-new__label">{t("ticket.addService")}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select className="input-new" value={addServiceId} onChange={(e) => setAddServiceId(e.target.value)}>
                <option value="">—</option>
                {checkout.services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} · {fmtMoney(s.price)}</option>
                ))}
              </select>
              <button type="button" className="btn-new btn-new--secondary" onClick={addService} disabled={!addServiceId}><Plus size={14} /></button>
            </div>
          </div>
          <div className="field-new">
            <label className="field-new__label">{t("ticket.addProduct")}</label>
            {checkout.features.products ? (
              <div style={{ display: "flex", gap: 6 }}>
                <select className="input-new" value={addProductId} onChange={(e) => setAddProductId(e.target.value)}>
                  <option value="">—</option>
                  {checkout.products.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.stock <= 0}>
                      {p.name} · {fmtMoney(p.price)} · {p.stock <= 0 ? t("ticket.outOfStock") : t("ticket.stockLeft", { count: p.stock })}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-new btn-new--secondary" onClick={addProduct} disabled={!addProductId}><Plus size={14} /></button>
              </div>
            ) : (
              <div className="bcaja-hint">{t("ticket.noProductsInPlan")}</div>
            )}
          </div>
        </div>

        {/* Canjes */}
        {(loyaltyAvailable || membershipAvailable) && (
          <div className="bcaja-form__grid">
            {loyaltyAvailable && (
              <div className="field-new">
                <label className="field-new__label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={loyaltyKey !== null} onChange={(e) => setLoyaltyKey(e.target.checked ? (serviceLines.find((l) => l.key !== membershipKey)?.key ?? null) : null)} />
                  {t("ticket.loyaltyRedeem")}
                </label>
                {loyaltyKey && (
                  <select className="input-new" value={loyaltyKey} onChange={(e) => setLoyaltyKey(e.target.value)} aria-label={t("ticket.loyaltyApplyTo")}>
                    {serviceLines.filter((l) => l.key !== membershipKey).map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
                  </select>
                )}
              </div>
            )}
            {membershipAvailable && (
              <div className="field-new">
                <label className="field-new__label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={membershipKey !== null} onChange={(e) => setMembershipKey(e.target.checked ? (serviceLines.find((l) => l.key !== loyaltyKey)?.key ?? null) : null)} />
                  {t("ticket.membershipUse")}
                </label>
                {membershipKey && (
                  <select className="input-new" value={membershipKey} onChange={(e) => setMembershipKey(e.target.value)} aria-label={t("ticket.membershipApplyTo")}>
                    {serviceLines.filter((l) => l.key !== loyaltyKey).map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
                  </select>
                )}
              </div>
            )}
          </div>
        )}

        <div className="bcaja-form__grid">
          {/* Descuento */}
          <div className="field-new">
            <label className="field-new__label">{t("ticket.discount")}</label>
            <input className="input-new" inputMode="decimal" value={discountText} onChange={(e) => setDiscountText(e.target.value)} placeholder="0.00" />
            <div className="bcaja-hint">{t("ticket.discountHint")}</div>
          </div>

          {/* Propina */}
          {checkout.features.tips && (
            <div className="field-new">
              <label className="field-new__label">{t("ticket.tip")}</label>
              <div className="bcaja-chips">
                <button type="button" className={`bcaja-chip ${tipMode.kind === "none" ? "bcaja-chip--on" : ""}`} onClick={() => setTipMode({ kind: "none" })}>{t("ticket.tipNone")}</button>
                {TIP_FIXED.map((a) => (
                  <button key={a} type="button" className={`bcaja-chip ${tipMode.kind === "fixed" && tipMode.amount === a ? "bcaja-chip--on" : ""}`} onClick={() => setTipMode({ kind: "fixed", amount: a })}>{fmtMoney(a)}</button>
                ))}
                {TIP_PCT.map((p) => (
                  <button key={p} type="button" className={`bcaja-chip ${tipMode.kind === "pct" && tipMode.pct === p ? "bcaja-chip--on" : ""}`} onClick={() => setTipMode({ kind: "pct", pct: p })}>{p}%</button>
                ))}
                <button type="button" className={`bcaja-chip ${tipMode.kind === "custom" ? "bcaja-chip--on" : ""}`} onClick={() => setTipMode({ kind: "custom" })}>{t("ticket.tipCustom")}</button>
              </div>
              {tipMode.kind === "custom" && (
                <input className="input-new" inputMode="decimal" value={tipText} onChange={(e) => setTipText(e.target.value)} placeholder="0.00" style={{ marginTop: 6 }} />
              )}
              <div className="bcaja-hint">{tipNeedsBarber ? t("ticket.tipNeedsBarber") : t("ticket.tipHint")}</div>
            </div>
          )}
        </div>

        {/* Método */}
        <div className="field-new">
          <label className="field-new__label">{t("ticket.paymentMethod")}</label>
          <div className="bcaja-seg" role="radiogroup">
            {METHODS.map(({ value, Icon }) => (
              <button key={value} type="button" role="radio" aria-checked={method === value} className={`bcaja-seg__btn ${method === value ? "bcaja-seg__btn--on" : ""}`} onClick={() => setMethod(value)}>
                <Icon size={15} /> {t(PAYMENT_METHOD_KEYS[value])}
              </button>
            ))}
          </div>
        </div>

        <div className="field-new">
          <label className="field-new__label">{t("ticket.notes")}</label>
          <input className="input-new" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </div>

        {/* Totales */}
        <div className="bcaja-totals">
          {totals.discount > 0 && (
            <div className="bcaja-totals__row"><span>{t("common.discount")}</span><span>−{fmtMoney(fromCents(totals.discount))}</span></div>
          )}
          <div className="bcaja-totals__row"><span>{t("ticket.subtotal")}</span><span>{fmtMoney(fromCents(totals.subtotal))}</span></div>
          {totals.tip > 0 && (
            <div className="bcaja-totals__row"><span>{t("common.tip")}</span><span>{fmtMoney(fromCents(totals.tip))}</span></div>
          )}
          <div className="bcaja-totals__row bcaja-totals__row--big"><span>{t("ticket.total")}</span><span>{fmtMoney(fromCents(totals.total))}</span></div>
        </div>
      </div>
    </BarberModal>
  );
}
