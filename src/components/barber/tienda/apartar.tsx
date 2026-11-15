"use client";

// ═══════════════════════════════════════════════════════════════════════
// APARTAR UN PRODUCTO (página pública del producto, ws6-t1).
//
// Cantidad (nunca más de lo que queda), nombre y WhatsApp (con «mi cuenta»
// se llenan solos), captcha como la reserva y campo trampa. Al apartar, va a
// la página del folio. «Pagar ahora en línea» solo aparece si la ruta de
// ws6-t5 contesta que esta barbería cobra con Mercado Pago (un 404 = no hay):
// aparta igual y luego pide el link de pago; si falla, el pedido sigue
// apartado y se paga en la barbería.
// ═══════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dictionary } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
import { mxTenDigits } from "@/lib/phone-mx";
import { BARBER_CAPTCHA_ACTIONS } from "@/lib/barber/captcha-core";
import { TIENDA_HOLD_HOURS, TIENDA_MAX_QTY_PER_LINE } from "@/lib/barber/tienda-core";
import { BarberCaptcha, type BarberCaptchaHandle } from "@/components/barber/captcha/barber-captcha";

function money(n: number): string {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function ApartarForm({
  dict,
  slug,
  productId,
  price,
  available,
  locale,
  captchaSiteKey,
  prefill,
}: {
  /** Sub-árbol barber.tienda. */
  dict: Dictionary;
  slug: string;
  productId: string;
  price: number;
  available: number;
  locale: string;
  captchaSiteKey: string | null;
  /** Datos de «mi cuenta» si el cliente ya entró. */
  prefill: { name: string; phone: string } | null;
}) {
  const t = useMemo(() => makeBarberT(dict), [dict]);
  const max = Math.max(0, Math.min(available, TIENDA_MAX_QTY_PER_LINE));
  const [qty, setQty] = useState(1);
  const [name, setName] = useState(prefill?.name ?? "");
  const [phone, setPhone] = useState(prefill?.phone ?? "");
  const [website, setWebsite] = useState("");
  const [sending, setSending] = useState<null | "store" | "online">(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const captcha = useRef<BarberCaptchaHandle>(null);

  // ¿Esta barbería cobra en línea? (ruta de ws6-t5; 404 o error = no).
  useEffect(() => {
    let alive = true;
    fetch(`/api/barber/mercadopago/status?slug=${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as { connected?: boolean }) : null))
      .then((d) => {
        if (alive && d?.connected === true) setOnline(true);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slug]);

  const phoneOk = mxTenDigits(phone) !== null;
  const nameOk = name.trim().length >= 2;

  async function submit(payOnline: boolean) {
    if (sending) return;
    setError(null);
    if (!nameOk) return setError(t("reserve.badName"));
    if (!phoneOk) return setError(t("reserve.badPhone"));
    setSending(payOnline ? "online" : "store");
    let sentToken = false;
    try {
      const check = await captcha.current?.getToken();
      const captchaToken = check?.ok ? check.token : null;
      sentToken = !!captchaToken;
      const res = await fetch(`/api/barber/public/tienda/${encodeURIComponent(slug)}/pedidos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines: [{ productId, qty }], name, phone, payOnline, captchaToken, website }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; id?: string; folioUrl?: string; available?: number };
      if (!res.ok || !data.folioUrl || !data.id) {
        setError(data.error ?? t("reserve.error"));
        if (typeof data.available === "number") setQty((q) => Math.max(1, Math.min(q, data.available as number)));
        setSending(null);
        if (sentToken) captcha.current?.reset();
        return;
      }
      if (payOnline) {
        try {
          const r = await fetch(`/api/barber/public/orders/${encodeURIComponent(data.id)}/mercadopago`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ returnPath: data.folioUrl }),
          });
          const pay = (await r.json().catch(() => ({}))) as { initPoint?: string };
          if (r.ok && pay.initPoint) {
            window.location.assign(pay.initPoint);
            return;
          }
        } catch {
          /* cae al folio: el pedido ya quedó apartado */
        }
        window.location.assign(`${data.folioUrl}?pago=fallo`);
        return;
      }
      window.location.assign(data.folioUrl);
    } catch {
      setError(t("reserve.error"));
      setSending(null);
      if (sentToken) captcha.current?.reset();
    }
  }

  return (
    <form
      className="dcb-card"
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
      data-apartar
    >
      <h2 className="dcb-title" style={{ margin: 0, fontSize: 18 }}>{t("reserve.title")}</h2>
      <div className="dcb-field">
        <span className="dcb-label" id="dct-qty-l">{t("reserve.qty")}</span>
        <div className="dct-qty" role="group" aria-labelledby="dct-qty-l">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label={t("reserve.less")}>−</button>
          <output aria-live="polite" data-cantidad>{qty}</output>
          <button type="button" onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max} aria-label={t("reserve.more")}>+</button>
        </div>
      </div>
      <label className="dcb-field">
        <span className="dcb-label">{t("reserve.name")}</span>
        <input className="dcb-input" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required data-nombre />
      </label>
      <label className="dcb-field">
        <span className="dcb-label">{t("reserve.phone")}</span>
        <input className="dcb-input" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} required data-telefono />
        <span className="dcb-help">{prefill ? t("reserve.fromAccount") : t("reserve.phoneHint")}</span>
      </label>
      {/* Campo trampa: invisible para una persona. */}
      <label className="dcb-honey" aria-hidden="true">
        Website
        <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </label>
      <BarberCaptcha
        ref={captcha}
        siteKey={captchaSiteKey}
        action={BARBER_CAPTCHA_ACTIONS.shopOrder}
        locale={locale}
        labels={{ error: t("captcha.error"), retry: t("captcha.reintentar") }}
      />
      <div className="dct-total">
        <span>{t("reserve.total")}</span>
        <strong data-total>{money(price * qty)}</strong>
      </div>
      {error ? <div className="dcb-alert dcb-alert--error" role="alert">{error}</div> : null}
      <button type="submit" className="dcb-btn dcb-btn--primary" disabled={sending !== null} data-accion="apartar">
        {sending === "store" ? t("reserve.sending") : t("reserve.submit")}
      </button>
      {online ? (
        <button type="button" className="dcb-btn dcb-btn--ghost" onClick={() => void submit(true)} disabled={sending !== null} data-accion="pagar-en-linea">
          {sending === "online" ? t("reserve.redirecting") : t("reserve.payOnline")}
        </button>
      ) : null}
      <p className="dcb-help" style={{ margin: 0 }}>{t("reserve.note", { hours: TIENDA_HOLD_HOURS })}</p>
    </form>
  );
}
