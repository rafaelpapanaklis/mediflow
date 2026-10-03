// ═══════════════════════════════════════════════════════════════════════════
// Webhook de Facturapi: verificación de la firma (ws1-t3, F-03).
//
// Igual que el SDK oficial (facturapi-node, src/tools/webhooks.ts,
// `validateSignature`): HMAC-SHA256 del CUERPO CRUDO con el secreto del
// webhook, en hexadecimal, en el encabezado `Facturapi-Signature`. Se compara en
// tiempo constante.
//
// Cada webhook de Facturapi pertenece a UNA organización y trae su propio
// secreto, así que se aceptan varios: FACTURAPI_WEBHOOK_SECRET puede llevar
// varios separados por coma (uno por organización / clínica que lo dé de alta).
//
// Además, la ruta NUNCA confía en el estado que trae el evento: solo toma el
// id del CFDI y vuelve a preguntarle a Facturapi con la llave de la clínica.
// La firma impide que cualquiera nos haga consultar a Facturapi a su antojo.
// ═══════════════════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from "crypto";

export const EVENTOS_FACTURAPI_QUE_SINCRONIZAN = [
  "invoice.cancellation_status_updated",
  "invoice.status_updated",
] as const;

export function secretosDeWebhook(env: string | undefined = process.env.FACTURAPI_WEBHOOK_SECRET): string[] {
  return String(env ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function firmaValida(cuerpo: string, firma: string | null | undefined, secretos: string[]): boolean {
  const f = String(firma ?? "").trim();
  if (!f || !/^[0-9a-fA-F]+$/.test(f) || f.length % 2 !== 0) return false;
  const recibida = Buffer.from(f, "hex");
  for (const s of secretos) {
    const esperada = createHmac("sha256", s).update(cuerpo).digest();
    if (esperada.length === recibida.length && timingSafeEqual(esperada, recibida)) return true;
  }
  return false;
}

/** El id de Facturapi del CFDI que trae el evento, si es un evento que nos importa. */
export function idDelEvento(evento: unknown): string | null {
  const e = evento as any;
  if (!e || !EVENTOS_FACTURAPI_QUE_SINCRONIZAN.includes(e.type)) return null;
  const id = e?.data?.object?.id;
  return typeof id === "string" && id.length > 0 && id.length < 100 ? id : null;
}
