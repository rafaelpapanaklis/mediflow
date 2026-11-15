"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Banknote, CheckCircle2, Copy, CreditCard, Landmark, Minus, Plus, Printer, Star, Trash2, type LucideIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { Dictionary } from "@/i18n/t";
import type { CheckoutContext, ClientLookup, PendingAppointment, SaleRow } from "@/lib/barber/cash";
import type { BonusPublic, SaleStarsOutcome, StarBonus, StarsView } from "@/lib/barber/stars-core";
import type { SaleDraftRow } from "@/lib/barber/sale-drafts";
import { StarsCard, bonusWhatText, starsT } from "@/components/barber/stars/stars-card";
import type { BarberPaymentMethod } from "@/lib/barber/types";
import { loyaltyRedeemText } from "./loyalty-redeem-text";
import { BarberModal } from "./modal";
import { useBarberT } from "./use-barber-t";
import { fmtMoney, fmtTime, fromCents, parseAmountText, ticketDiscountCents, toCents, PAYMENT_METHOD_KEYS, type TicketDiscountMode } from "./money";
import { formatBarberPhone } from "@/lib/barber/phone-format";

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

/** Las líneas de una nota «Por cobrar» con los precios de HOY del catálogo. */
function draftLines(draft: SaleDraftRow, checkout: CheckoutContext): Line[] {
  const out: Line[] = [];
  for (const l of draft.lines) {
    if (l.kind === "service") {
      const svc = checkout.services.find((x) => x.id === l.id);
      if (svc) out.push({ key: nextKey(), kind: "service", id: svc.id, name: svc.name, qty: l.qty, unitPrice: svc.price, frozen: false, stock: null });
    } else {
      const p = checkout.products.find((x) => x.id === l.id);
      if (p && p.stock > 0) out.push({ key: nextKey(), kind: "product", id: p.id, name: p.name, qty: Math.min(l.qty, p.stock), unitPrice: p.price, frozen: false, stock: p.stock });
    }
  }
  return out;
}

const METHODS: Array<{ value: BarberPaymentMethod; Icon: LucideIcon }> = [
  { value: "CASH", Icon: Banknote },
  { value: "CARD", Icon: CreditCard },
  { value: "SPEI", Icon: Landmark },
];

const TIP_FIXED = [20, 50, 100];
const TIP_PCT = [10, 15];

/** Lo que devuelve POST /api/barber/sales: el ticket + el resumen de estrellas. */
type ChargedSale = SaleRow & { stars?: SaleStarsOutcome | null };

/** El catálogo de Caja → lo que pinta la tarjeta (sin importar nada del servidor). */
function toPublic(b: StarBonus): BonusPublic {
  return {
    id: b.id,
    name: b.name,
    cost: b.cost,
    what: {
      kind: b.kind,
      serviceName: b.kind === "service" ? b.serviceName : null,
      amount: b.kind === "amount" ? b.amount : null,
      percent: b.kind === "percent" ? b.percent : null,
      text: b.kind === "other" ? b.description : null,
    },
  };
}

type TipMode = { kind: "none" } | { kind: "fixed"; amount: number } | { kind: "pct"; pct: number } | { kind: "custom" };

export function TicketModal({
  dict,
  starsDict,
  locale = "es",
  checkout,
  appointment,
  initialClient = null,
  draft = null,
  onDraftSaved,
  tz,
  onClose,
  onCharged,
}: {
  dict: Dictionary;
  /** Sub-árbol barber.estrellas. */
  starsDict?: Dictionary;
  locale?: string;
  checkout: CheckoutContext;
  appointment: PendingAppointment | null;
  /** Cliente ya puesto (el «Nuevo cobro» de su ficha). */
  initialClient?: ClientLookup | null;
  /** Nota «Por cobrar» que se abre para editarla o cobrarla. */
  draft?: SaleDraftRow | null;
  /** Se guardó como «Por cobrar» (el modal se cierra). */
  onDraftSaved?: () => void;
  tz: string;
  onClose: () => void;
  onCharged: (sale: SaleRow) => void;
}) {
  const t = useBarberT(dict);
  const st = useMemo(() => starsT(starsDict ?? {}), [starsDict]);
  const [bonusId, setBonusId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [barberId, setBarberId] = useState<string>(
    appointment?.barberId ?? draft?.barberId ?? (checkout.barbers.length === 1 ? checkout.barbers[0].id : ""),
  );
  const [client, setClient] = useState<ClientLookup | null>(appointment?.client ?? initialClient);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ClientLookup[]>([]);
  const [lines, setLines] = useState<Line[]>(() =>
    draft && !appointment
      ? draftLines(draft, checkout)
      : [
          ...(appointment?.services ?? []).map((s): Line => ({
            key: nextKey(),
            kind: "service",
            id: s.serviceId,
            name: s.name,
            qty: 1,
            unitPrice: s.priceAtBooking,
            frozen: true,
            stock: null,
          })),
          // Productos agregados desde la cita (cita «B»): el ticket ya los trae.
          ...(appointment?.draft?.items ?? []).flatMap((i): Line[] => {
            const p = checkout.products.find((x) => x.id === i.productId);
            if (!p || p.stock <= 0) return [];
            return [{ key: nextKey(), kind: "product", id: p.id, name: p.name, qty: Math.min(i.qty, p.stock), unitPrice: p.price, frozen: false, stock: p.stock }];
          }),
        ],
  );
  const [addServiceId, setAddServiceId] = useState("");
  const [addProductId, setAddProductId] = useState("");
  const [discountText, setDiscountText] = useState(draft?.payload.discountPct ?? draft?.payload.discount ?? "");
  // Descuento en pesos o en %: el SERVIDOR hace la cuenta (createSale, discountPct); aquí solo se ve y se valida.
  const [discountMode, setDiscountMode] = useState<TicketDiscountMode>(draft?.payload.discountPct ? "pct" : "amount");
  // «10%» escrito con el selector en $: el selector pasa solo a % y el texto se queda sin el signo, así se manda
  // discountPct y el % lo convierte el servidor (unión pase 8, opción (a) del gerente: un solo cálculo).
  function onDiscountText(value: string) {
    if (/%\s*$/.test(value)) {
      setDiscountMode("pct");
      setDiscountText(value.replace(/\s*%\s*$/, ""));
      return;
    }
    setDiscountText(value);
  }
  const [tipMode, setTipMode] = useState<TipMode>({ kind: "none" });
  const [tipText, setTipText] = useState("");
  const [method, setMethod] = useState<BarberPaymentMethod>("CASH");
  const [notes, setNotes] = useState(draft?.payload.notes ?? "");
  const [savingDraft, setSavingDraft] = useState(false);
  const [loyaltyKey, setLoyaltyKey] = useState<string | null>(null);
  const [membershipKey, setMembershipKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChargedSale | null>(null);

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
  // Bonos que este cliente YA puede canjear (lo decidió el servidor al buscarlo).
  const readyBonuses = useMemo(
    () => (client ? checkout.bonuses.filter((b) => (client.availableBonusIds ?? []).includes(b.id)) : []),
    [client, checkout.bonuses],
  );
  const bonus = readyBonuses.find((b) => b.id === bonusId) ?? null;
  // Un bono de servicio fijo solo va contra ESE servicio; el de siempre, contra cualquiera.
  const bonusLines = bonus?.kind === "service"
    ? serviceLines.filter((l) => l.key !== membershipKey && (!bonus.serviceId || l.id === bonus.serviceId))
    : [];
  const bonusNeedsService = Boolean(bonus?.kind === "service" && bonusLines.length === 0);
  const loyaltyAvailable = readyBonuses.length > 0 && lines.length > 0;
  const membershipAvailable = Boolean(client?.activeMembership) && serviceLines.length > 0;
  // Qué queda gratis con un bono de servicio (el texto de siempre de la caja).
  const loyaltyText = loyaltyRedeemText(t, {
    stamps: bonus?.cost ?? checkout.loyaltyTarget,
    reward: bonus?.name ?? checkout.loyaltyReward,
    serviceName: bonus?.kind === "service" && loyaltyKey ? lines.find((l) => l.key === loyaltyKey)?.name : null,
  });

  // Si desaparece el cliente o la línea, el canje se apaga solo.
  useEffect(() => {
    if (bonusId && !readyBonuses.some((b) => b.id === bonusId)) setBonusId(null);
    if (loyaltyKey && (!bonus || bonus.kind !== "service" || !bonusLines.some((l) => l.key === loyaltyKey))) {
      setLoyaltyKey(bonus?.kind === "service" ? bonusLines[0]?.key ?? null : null);
    } else if (!loyaltyKey && bonus?.kind === "service" && bonusLines.length > 0) {
      setLoyaltyKey(bonusLines[0].key);
    }
    if (membershipKey && (!membershipAvailable || !lines.some((l) => l.key === membershipKey && l.kind === "service" && l.qty === 1))) setMembershipKey(null);
  }, [lines, loyaltyAvailable, membershipAvailable, loyaltyKey, membershipKey, bonusId, bonus, bonusLines, readyBonuses]);

  // Anticipo PAGADO de la cita (lo manda el servidor en `appointment.deposit`).
  // Aquí solo se PINTA: quien lo descuenta de verdad es createSale, dentro
  // de la transacción del cobro y con la misma cuenta (después del descuento
  // y sin dejar el ticket en negativo).
  const depositPaidCents = appointment?.deposit ? toCents(appointment.deposit.amount) : 0;

  const totals = useMemo(() => {
    const gross = lines.reduce((s, l) => {
      const covered = l.key === loyaltyKey || l.key === membershipKey;
      return s + (covered ? 0 : toCents(l.unitPrice) * l.qty);
    }, 0);
    // Bono de descuento: misma cuenta que el servidor (antes del descuento normal).
    let bonusOff = 0;
    if (bonus?.kind === "amount") bonusOff = Math.min(toCents(bonus.amount ?? 0), gross);
    else if (bonus?.kind === "percent") bonusOff = Math.round((gross * (bonus.percent ?? 0)) / 100);
    const grossAfterBonus = gross - bonusOff;
    const disc = ticketDiscountCents(grossAfterBonus, discountText, discountMode);
    const discount = disc.cents;
    // Lo que vale el servicio ya con descuento: base de la propina en %.
    const due = grossAfterBonus - discount;
    const deposit = Math.min(depositPaidCents, due);
    const subtotal = due - deposit;
    let tip = 0;
    if (tipMode.kind === "fixed") tip = toCents(tipMode.amount);
    else if (tipMode.kind === "pct") tip = Math.round((due * tipMode.pct) / 100);
    else if (tipMode.kind === "custom") {
      const p = parseAmountText(tipText);
      tip = p === null ? 0 : toCents(p);
    }
    return { gross, bonusOff, discount, deposit, depositRest: depositPaidCents - deposit, subtotal, tip, total: subtotal + tip, discountInvalid: disc.invalid, discountReason: disc.reason, discountCapped: disc.capped };
  }, [lines, loyaltyKey, membershipKey, discountText, discountMode, tipMode, tipText, depositPaidCents, bonus]);

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
  const canSubmit = lines.length > 0 && !submitting && !totals.discountInvalid && !tipNeedsBarber && !bonusNeedsService;

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
        // En % viaja el porcentaje: el servidor lo convierte con su redondeo.
        discount: discountMode === "amount" ? fromCents(totals.discount) : null,
        discountPct: discountMode === "pct" && totals.discount > 0 ? discountText.trim() : null,
        tip: fromCents(totals.tip),
        paymentMethod: method,
        redeemBonusId: bonus ? bonus.id : null,
        redeemLoyaltyItemIndex: bonus?.kind === "service" && loyaltyKey ? lines.findIndex((l) => l.key === loyaltyKey) : null,
        membershipItemIndex: membershipKey ? lines.findIndex((l) => l.key === membershipKey) : null,
        // La nota «Por cobrar» que este ticket salda (se marca en la misma transacción).
        draftId: draft?.id ?? appointment?.draft?.id ?? null,
        notes: notes.trim() || null,
      };
      const res = await fetch("/api/barber/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as ChargedSale & { error?: string; code?: string };
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

  // «Guardar sin cobrar»: la nota guarda QUÉ se cobrará, no importes. No
  // toca el corte, ingresos, comisiones ni estrellas (eso lo hace el cobro).
  const canSaveDraft = checkout.draftsReady === true && Boolean(client) && !appointment && Boolean(onDraftSaved);
  async function saveDraft() {
    if (!client || lines.length === 0 || totals.discountInvalid || savingDraft) return;
    setSavingDraft(true);
    setError(null);
    try {
      const res = await fetch("/api/barber/sales/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft?.id ?? null,
          clientId: client.id,
          payload: {
            items: lines.map((l) => ({ kind: l.kind, id: l.id, qty: l.qty })),
            barberId: barberId || null,
            discount: discountMode === "amount" && totals.discount > 0 ? fromCents(totals.discount).toFixed(2) : null,
            discountPct: discountMode === "pct" && totals.discount > 0 ? discountText.trim() : null,
            notes: notes.trim() || null,
          },
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? t("common.error"));
        return;
      }
      onDraftSaved?.();
      onClose();
    } catch {
      setError(t("common.error"));
    } finally {
      setSavingDraft(false);
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
    setBonusId(null);
    setLinkCopied(false);
    setMembershipKey(null);
    setError(null);
  }

  const title = appointment ? t("ticket.fromAppointment", { time: fmtTime(appointment.startAt, tz) }) : t("ticket.title");

  if (result) {
    const out = result.stars ?? null;
    const cardUrl = out && typeof window !== "undefined" ? `${window.location.origin}${out.cardPath}` : null;
    // La tarjeta dibujada con lo que dijo el servidor (sin otra llamada).
    const miniView: StarsView | null = out
      ? {
          enabled: true,
          firstName: out.firstName,
          stars: out.stars,
          slots: out.next ? out.next.cost : Math.max(out.stars, 1),
          next: out.next
            ? {
                bonus: checkout.bonuses.map(toPublic).find((b) => b.name === out.next!.name && b.cost === out.next!.cost) ?? {
                  id: "next", name: out.next.name, cost: out.next.cost,
                  what: { kind: "other", serviceName: null, amount: null, percent: null, text: null },
                },
                remaining: out.next.remaining,
              }
            : null,
          available: [],
          catalog: checkout.bonuses.map(toPublic),
          history: [],
          usedCount: 0,
        }
      : null;
    return (
      <BarberModal open title={t("ticket.success")} onClose={onClose} closeLabel={t("common.close")}>
        <div className="bcaja-success">
          <div className="bcaja-success__icon"><CheckCircle2 size={28} /></div>
          <div className="bcaja-success__amount">{fmtMoney(result.total)}</div>
          <div className="bcaja-hint">{t("ticket.successBody", { amount: fmtMoney(result.total), method: t(PAYMENT_METHOD_KEYS[result.paymentMethod]) })}</div>
          {out && miniView ? (
            <div data-estrellas-cobro style={{ width: "100%", maxWidth: 420, margin: "10px auto 0", textAlign: "left", display: "grid", gap: 8 }}>
              <div className="bcaja-alert bcaja-alert--info" role="status" style={{ fontWeight: 700 }}>
                {out.gained > 0
                  ? out.next
                    ? st("caja.gained", { name: out.firstName, count: out.stars, total: out.next.cost })
                    : st("caja.gainedNoGoal", { name: out.firstName, count: out.stars })
                  : st("caja.noStar")}
                {out.reached.length > 0 ? <div style={{ marginTop: 4 }}>{st("caja.reached", { bonus: out.reached.join(", ") })}</div> : null}
                {out.used ? (
                  <div style={{ marginTop: 4, fontWeight: 500 }}>{st("caja.used", { bonus: out.used.name, count: out.used.stars, left: out.stars })}</div>
                ) : null}
              </div>
              <StarsCard view={miniView} t={st} audience="staff" locale={locale} />
              {cardUrl ? (
                <div style={{ display: "grid", justifyItems: "center", gap: 6, marginTop: 4 }}>
                  <div className="bcaja-hint" style={{ fontWeight: 600 }}>{st("caja.showCard")}</div>
                  <div style={{ borderRadius: 12, overflow: "hidden", lineHeight: 0 }}>
                    <QRCodeSVG value={cardUrl} size={148} level="M" marginSize={2} />
                  </div>
                  <button
                    type="button"
                    className="btn-new btn-new--secondary btn-new--sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(cardUrl);
                        setLinkCopied(true);
                      } catch {
                        /* sin portapapeles: el QR sigue en pantalla */
                      }
                    }}
                  >
                    <Copy size={13} /> {linkCopied ? st("staff.copied") : st("staff.copy")}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
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
          {canSaveDraft && (
            <button
              type="button"
              className="btn-new btn-new--secondary"
              onClick={saveDraft}
              disabled={savingDraft || submitting || lines.length === 0 || totals.discountInvalid}
              data-accion="guardar-sin-cobrar"
            >
              {savingDraft ? t("ticket.savingDraft") : t("ticket.saveDraft")}
            </button>
          )}
          <button type="button" className="btn-new barber-btn-primary" onClick={submit} disabled={!canSubmit}>
            {submitting ? t("ticket.charging") : t("ticket.confirm", { amount: fmtMoney(fromCents(totals.total)) })}
          </button>
        </>
      }
    >
      <div className="bcaja-form">
        {error && <div className="bcaja-alert bcaja-alert--danger" role="alert">{error}</div>}

        {depositPaidCents > 0 && (
          <div className="bcaja-alert bcaja-alert--info">
            {t("ticket.depositNotice", { amount: fmtMoney(fromCents(depositPaidCents)) })}
          </div>
        )}

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
                    {formatBarberPhone(client.phone)}
                    {/* Sellos y premio: los de ESTA barbería (umbral, premio y encendido). */}
                    {checkout.loyaltyEnabled ? ` · ${st("caja.starsShort", { count: client.loyaltyCount })}` : ""}
                    {readyBonuses.length > 0 ? ` · ${t("ticket.loyaltyEligible", { reward: readyBonuses.map((b) => b.name).join(", ") })}` : ""}
                    {client.activeMembership
                      ? ` · ${t("ticket.membershipActive", { name: client.activeMembership.name })} (${client.activeMembership.cutsLeft === null ? t("ticket.membershipUnlimited") : t("ticket.membershipCutsLeft", { count: client.activeMembership.cutsLeft })})`
                      : ""}
                    {/* Próximo periodo ya pagado (D1): sus cortes se usan cuando empiece. */}
                    {client.nextMembershipPeriod
                      ? ` · ${t("ticket.membershipNext", { date: new Date(client.nextMembershipPeriod.startAt).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "America/Mexico_City" }) })}`
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
                        <div className="bcaja-client__meta">{formatBarberPhone(c.phone)}{checkout.loyaltyEnabled ? ` · ${st("caja.starsShort", { count: c.loyaltyCount })}` : ""}</div>
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
            {checkout.features.products && checkout.products.length === 0 ? (
              <div className="bcaja-hint">{t("ticket.noProductsYet")}</div>
            ) : checkout.features.products ? (
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
              <div className="field-new" data-bono>
                <label className="field-new__label" htmlFor="ticket-bono" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Star size={13} /> {st("caja.applyBonus")}
                </label>
                <select
                  id="ticket-bono"
                  className="input-new"
                  value={bonusId ?? ""}
                  onChange={(e) => {
                    setBonusId(e.target.value || null);
                    setLoyaltyKey(null);
                  }}
                >
                  <option value="">{st("caja.bonusNone")}</option>
                  {readyBonuses.map((b) => (
                    <option key={b.id} value={b.id}>{st("caja.bonusOption", { bonus: b.name, count: b.cost })}</option>
                  ))}
                </select>
                {bonus ? (
                  <div className="bcaja-hint" style={{ marginTop: 4 }}>{bonusWhatText(st, toPublic(bonus).what, locale)}</div>
                ) : null}
                {bonus?.kind === "service" && bonusLines.length > 1 && loyaltyKey ? (
                  <select className="input-new" style={{ marginTop: 6 }} value={loyaltyKey} onChange={(e) => setLoyaltyKey(e.target.value)} aria-label={st("caja.applyTo")}>
                    {bonusLines.map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}
                  </select>
                ) : null}
                {bonusNeedsService ? (
                  <div className="bcaja-alert bcaja-alert--info" style={{ marginTop: 6 }}>{st("caja.needsService", { service: bonus?.serviceName ?? "" })}</div>
                ) : null}
                {bonus?.kind === "service" && loyaltyText.effect ? <div className="bcaja-hint" style={{ marginTop: 4 }}>{loyaltyText.effect}</div> : null}
                {bonus?.kind === "other" && bonus.description ? (
                  <div className="bcaja-hint" style={{ marginTop: 4 }}>{st("caja.bonusGift", { text: bonus.description })}</div>
                ) : null}
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
            <label className="field-new__label" htmlFor="ticket-discount">{t("ticket.discount")}</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <div className="bcaja-chips" role="radiogroup" aria-label={t("ticket.discountMode")}>
                <button type="button" role="radio" aria-checked={discountMode === "amount"} className={`bcaja-chip ${discountMode === "amount" ? "bcaja-chip--on" : ""}`} onClick={() => setDiscountMode("amount")}>$</button>
                <button type="button" role="radio" aria-checked={discountMode === "pct"} className={`bcaja-chip ${discountMode === "pct" ? "bcaja-chip--on" : ""}`} onClick={() => setDiscountMode("pct")}>%</button>
              </div>
              <input id="ticket-discount" className="input-new" inputMode="decimal" value={discountText} onChange={(e) => onDiscountText(e.target.value)} placeholder={discountMode === "pct" ? "0" : "0.00"} aria-invalid={totals.discountInvalid || undefined} style={{ flex: 1, minWidth: 0 }} />
            </div>
            {totals.discountInvalid ? (
              <div className="bcaja-hint" role="alert" style={{ color: "var(--danger)" }}>
                {t(totals.discountReason === "percent" ? "ticket.discountPercentMax" : "ticket.discountInvalid")}
              </div>
            ) : totals.discountCapped ? (
              <div className="bcaja-hint" role="status">{t("ticket.discountCapped")}</div>
            ) : (
              <div className="bcaja-hint">
                {discountMode === "pct" && totals.discount > 0
                  ? t("ticket.discountPctApplied", { amount: fmtMoney(fromCents(totals.discount)) })
                  : t("ticket.discountHint")}
              </div>
            )}
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
          {totals.bonusOff > 0 && bonus && (
            <div className="bcaja-totals__row"><span>{st("caja.bonusDiscount", { bonus: bonus.name })}</span><span>−{fmtMoney(fromCents(totals.bonusOff))}</span></div>
          )}
          {totals.discount > 0 && (
            <div className="bcaja-totals__row"><span>{t("common.discount")}</span><span>−{fmtMoney(fromCents(totals.discount))}</span></div>
          )}
          {totals.deposit > 0 && (
            <div className="bcaja-totals__row"><span>{t("ticket.depositApplied")}</span><span>−{fmtMoney(fromCents(totals.deposit))}</span></div>
          )}
          {depositPaidCents > 0 && totals.depositRest > 0 && (
            <div className="bcaja-hint">{t("ticket.depositRest", { amount: fmtMoney(fromCents(totals.depositRest)) })}</div>
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
