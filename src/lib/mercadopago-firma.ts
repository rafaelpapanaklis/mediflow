// ─────────────────────────────────────────────────────────────────────────────
// Firma `x-signature` del webhook de Mercado Pago (B8, auditoría 30-sep-2026).
//
// Dos fallos que cerraba mal:
//  1. Sin `MERCADOPAGO_WEBHOOK_SECRET` NO se validaba nada (abierto): quien
//     adivinara un `ref` podía disparar la re-consulta de pagos a voluntad. Ahora
//     sin secreto el webhook RECHAZA (503: es una mala configuración, y MP
//     reintenta, así que no se pierde ningún pago cuando se configure).
//  2. La firma cubre el `data.id` de la QUERY, pero el pago que se procesaba salía
//     del BODY: una notificación legítima podía reutilizarse con otro id en el
//     cuerpo. Ahora el id que se procesa es el FIRMADO, y si el cuerpo trae
//     `data.id` tiene que ser ese mismo.
//
// ⚠ El `id` de la RAÍZ del cuerpo NO es el pago: es el «ID de la notificación»
// (doc oficial, Notificaciones → Webhooks: `id` = notificación, `data.id` =
// recurso). El ejemplo de la doc y el simulador de MP ponen el mismo número en
// los dos y engañan; compararlo dio 401 a todo pago real (ws1-t12, 1-oct-2026).
// Aquí ni se recibe.
//
// Manifest (doc oficial y `WebhookSignatureValidator` de sdk-nodejs):
//   `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
// `data.id` es el de la query; las partes que no vienen se omiten. La doc pide
// el `data.id` alfanumérico en minúsculas y el SDK lo firma tal cual llega: se
// aceptan las dos formas (para un pago, numérico, son la misma).
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "crypto";

export type ResultadoFirmaMp =
  | { ok: true; paymentId: string }
  | { ok: false; motivo: "sin_secreto" | "firma_ausente" | "firma_invalida" | "sin_data_id" | "id_no_coincide" };

function texto(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
}

export function verificarFirmaMp(a: {
  secret: string | undefined | null;
  /** Cabecera `x-signature`, tal cual. */
  signature: string | null | undefined;
  requestId: string | null | undefined;
  /** `data.id` de la query: el que firma MP. */
  dataIdQuery: string | null | undefined;
  /** `data.id` del cuerpo (NUNCA el `id` de la raíz, que es la notificación). */
  dataIdBody?: unknown;
}): ResultadoFirmaMp {
  if (!a.secret) return { ok: false, motivo: "sin_secreto" };

  const parts: Record<string, string> = {};
  for (const piece of (a.signature ?? "").split(",")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts[piece.slice(0, eq).trim().toLowerCase()] = piece.slice(eq + 1).trim();
  }
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return { ok: false, motivo: "firma_ausente" };

  const enQuery = texto(a.dataIdQuery);
  const enBody = texto(a.dataIdBody);
  if (enQuery && enBody && enQuery.toLowerCase() !== enBody.toLowerCase()) {
    return { ok: false, motivo: "id_no_coincide" };
  }
  // La query manda; el cuerpo solo si la query no lo trae (la firma lo liga igual).
  const dataId = enQuery || enBody;
  if (!dataId) return { ok: false, motivo: "sin_data_id" };

  const requestId = texto(a.requestId);
  const got = Buffer.from(v1, "hex");
  const candidatos = dataId === dataId.toLowerCase() ? [dataId] : [dataId, dataId.toLowerCase()];
  const valida = candidatos.some((id) => {
    let manifest = `id:${id};`;
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${ts};`;
    const want = Buffer.from(createHmac("sha256", a.secret as string).update(manifest).digest("hex"), "hex");
    return got.length === want.length && timingSafeEqual(got, want);
  });
  if (!valida) return { ok: false, motivo: "firma_invalida" };

  return { ok: true, paymentId: dataId };
}
