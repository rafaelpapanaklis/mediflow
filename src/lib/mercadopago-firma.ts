// ─────────────────────────────────────────────────────────────────────────────
// Firma `x-signature` del webhook de Mercado Pago (B8, auditoría 30-sep-2026).
//
// Dos fallos que cerraba mal:
//  1. Sin `MERCADOPAGO_WEBHOOK_SECRET` NO se validaba nada (abierto): quien
//     adivinara un `ref` podía disparar la re-consulta de pagos a voluntad. Ahora
//     sin secreto el webhook RECHAZA (503: es una mala configuración, y MP
//     reintenta, así que no se pierde ningún pago cuando se configure).
//  2. La firma cubre el `data.id` de la QUERY, pero el pago que se procesaba salía
//     del BODY (`data.id` / `id`): una notificación legítima podía reutilizarse con
//     otro id en el cuerpo. Ahora el id que se procesa es el FIRMADO (el de la
//     query), y cualquier id del body tiene que ser ese mismo; sin `data.id` en la
//     query la firma no liga ningún pago y se rechaza.
//
// Manifest de MP: `id:<data.id en minúsculas>;request-id:<x-request-id>;ts:<ts>;`
// (las partes que no vienen se omiten).
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "crypto";

export type ResultadoFirmaMp =
  | { ok: true; paymentId: string }
  | { ok: false; motivo: "sin_secreto" | "firma_ausente" | "firma_invalida" | "sin_data_id" | "id_no_coincide" };

export function verificarFirmaMp(a: {
  secret: string | undefined | null;
  /** Cabecera `x-signature`, tal cual. */
  signature: string | null | undefined;
  requestId: string | null | undefined;
  /** `data.id` de la query: lo único que la firma cubre. */
  dataIdQuery: string | null | undefined;
  /** Ids que trae el cuerpo (`data.id`, `id`): no firmados, solo se contrastan. */
  idsDelBody?: Array<string | number | null | undefined>;
}): ResultadoFirmaMp {
  if (!a.secret) return { ok: false, motivo: "sin_secreto" };

  const parts: Record<string, string> = {};
  for (const piece of (a.signature ?? "").split(",")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
  }
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1) return { ok: false, motivo: "firma_ausente" };

  const dataId = a.dataIdQuery?.trim() || "";
  if (!dataId) return { ok: false, motivo: "sin_data_id" };

  let manifest = `id:${dataId.toLowerCase()};`;
  if (a.requestId) manifest += `request-id:${a.requestId};`;
  manifest += `ts:${ts};`;

  const expected = createHmac("sha256", a.secret).update(manifest).digest("hex");
  const got = Buffer.from(v1, "hex");
  const want = Buffer.from(expected, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return { ok: false, motivo: "firma_invalida" };
  }

  for (const id of a.idsDelBody ?? []) {
    if (id == null || id === "") continue;
    if (String(id).toLowerCase() !== dataId.toLowerCase()) return { ok: false, motivo: "id_no_coincide" };
  }
  return { ok: true, paymentId: dataId };
}
