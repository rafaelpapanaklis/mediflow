import type { CSSProperties } from "react";

/**
 * Piezas compartidas por las dos pantallas del alta de afiliado:
 * `affiliate-registro-form.tsx` (correo nuevo) y `affiliate-vincular-form.tsx`
 * (correo que ya existe en DaleControl). Vive aparte para que el catálogo de
 * métodos de pago y el traspaso del borrador no se dupliquen.
 */

export const PAYOUT_METHODS: { value: string; label: string; placeholder: string }[] = [
  { value: "", label: "Lo defino después", placeholder: "" },
  { value: "SPEI", label: "Transferencia SPEI", placeholder: "CLABE de 18 dígitos" },
  { value: "PAYPAL", label: "PayPal", placeholder: "Correo de tu cuenta PayPal" },
  { value: "OTHER", label: "Otro", placeholder: "Describe cómo quieres recibir tus pagos" },
];

export const selectStyle: CSSProperties = {
  height: 42,
  padding: "0 14px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid var(--ld-border)",
  color: "var(--ld-fg)",
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
};

export interface AffiliateSignupDraft {
  name: string;
  payoutMethod: string;
  payoutDetails: string;
}

/**
 * Borrador del registro para no perder lo ya escrito al saltar de
 * /afiliados/registro a /afiliados/vincular.
 *
 * sessionStorage y NO query params: `payoutDetails` puede traer una CLABE, y la
 * query string acaba en el historial del navegador y en los logs de acceso del
 * servidor. sessionStorage se queda en la pestaña y se borra al leerlo.
 */
const DRAFT_KEY = "dc_affiliate_signup_draft";

export function saveSignupDraft(draft: AffiliateSignupDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* modo privado / storage lleno → se pierde el borrador, no el flujo */
  }
}

/** Lee el borrador y lo borra (un solo uso). Devuelve null si no hay. */
export function consumeSignupDraft(): AffiliateSignupDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(DRAFT_KEY);
    const parsed = JSON.parse(raw);
    return {
      name: typeof parsed?.name === "string" ? parsed.name : "",
      payoutMethod: typeof parsed?.payoutMethod === "string" ? parsed.payoutMethod : "",
      payoutDetails: typeof parsed?.payoutDetails === "string" ? parsed.payoutDetails : "",
    };
  } catch {
    return null;
  }
}
