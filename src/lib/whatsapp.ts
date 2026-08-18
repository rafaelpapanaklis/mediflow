import { decryptField } from "@/lib/crypto/envelope";
import { parseWaError } from "@/lib/whatsapp/errors";
import type { WaTemplateConfig } from "@/lib/whatsapp/template-config";

/**
 * Normaliza a 52 + 10 dígitos (México). Exportada para poder probarla y para
 * que el resto del código no vuelva a escribir estas reglas a mano.
 */
export function normalizeMxWhatsAppPhone(to: string): string {
  let phone = to.replace(/[\s\-\(\)\+]/g, "");
  // Strip country code if present to get raw 10 digits
  if (phone.startsWith("521") && phone.length === 13) phone = phone.slice(3); // 521XXXXXXXXXX → 10 digits (old MX mobile format)
  else if (phone.startsWith("52") && phone.length === 12) phone = phone.slice(2); // 52XXXXXXXXXX → 10 digits
  // Now phone should be 10 digits, add country code
  if (phone.length === 10) phone = `52${phone}`;
  return phone;
}

/**
 * POST a la Graph API con el cuerpo ya armado. Concentra lo que compartían el
 * envío de texto y el de plantilla: descifrado del token, timeout, el reintento
 * único y la conversión del error de Meta en WhatsAppApiError.
 */
async function postToGraph(
  phoneNumberId: string,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<any> {
  // El token puede venir cifrado con envelope ("v1:...") o en claro (clínicas
  // conectadas antes del cifrado): decryptField devuelve el claro tal cual
  // (migración perezosa; se re-cifra al siguiente guardado en connect).
  const token = decryptField(accessToken) ?? accessToken;

  const doFetch = () =>
    fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      // Señal fresca por intento; sin timeout, un cuelgue de Meta congela el worker.
      signal: AbortSignal.timeout(15000),
    });

  let res = await doFetch();
  // Reintento único solo con respuesta 5xx/429. En timeout o error de red NO
  // se reintenta: el mensaje pudo haber salido (no-duplicar > no-perder).
  if (res.status >= 500 || res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    res = await doFetch();
  }

  if (!res.ok) {
    // Meta puede responder HTML (p. ej. 502 del gateway): no asumir JSON.
    const err = await res.json().catch(() => ({}));
    // WhatsAppApiError EXTIENDE Error y su `message` sigue siendo el texto de
    // Meta (con `(#código)` al frente): los callers que solo leen `e.message`
    // —la cola, el Inbox— no cambian. Los que necesitan decidir por código ya
    // pueden (apagar waConnected ante un 190, avisar del 131042).
    throw parseWaError(err, res.status);
  }
  return await res.json();
}

/**
 * Texto libre. SOLO llega si el paciente escribió en las últimas 24 h; fuera de
 * esa ventana Meta lo rechaza con 131047 (ver lib/whatsapp/send-mode.ts, que es
 * quien decide entre esto y una plantilla).
 *
 * Firma intacta: la usan ~15 sitios.
 */
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string
) {
  return postToGraph(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    to: normalizeMxWhatsAppPhone(to),
    type: "text",
    text: { body: message },
  });
}

/**
 * Plantilla aprobada — la única vía para iniciar conversación fuera de la
 * ventana de 24 h.
 *
 * `params` son los valores de {{1}}…{{n}} EN ORDEN: Meta los sustituye por
 * posición, no por nombre, así que un orden distinto al de la plantilla
 * aprobada entrega el mensaje con los datos cambiados de sitio (y un número
 * distinto lo rechaza con 132000).
 *
 * Ojo con el coste: Meta le cobra esta llamada a la WABA de la CLÍNICA.
 */
export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  template: WaTemplateConfig,
  params: string[],
) {
  return postToGraph(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    to: normalizeMxWhatsAppPhone(to),
    type: "template",
    template: {
      name: template.name,
      language: { code: template.lang },
      // Sin variables no se manda `components`: Meta rechaza un body vacío.
      ...(params.length > 0
        ? {
            components: [
              {
                type: "body",
                parameters: params.map((text) => ({ type: "text", text })),
              },
            ],
          }
        : {}),
    },
  });
}

/**
 * Sube un archivo (el comprobante o presupuesto en PDF) a la WABA de la clínica
 * y devuelve el media id que luego referencia sendWhatsAppDocument. Existe para
 * adjuntar el documento cuando la ventana de 24 h está abierta: el media id
 * vive ~30 días en los servidores de Meta y aquí se usa de inmediato tras la
 * subida. El coste de ese almacenamiento corre por cuenta de Meta, no nuestra.
 */
export async function uploadWhatsAppMedia(
  phoneNumberId: string,
  accessToken: string,
  file: { buffer: Buffer; filename: string; mimeType?: string },
): Promise<string> {
  // Mismo descifrado perezoso que postToGraph: cifrado ("v1:...") o en claro.
  const token = decryptField(accessToken) ?? accessToken;

  const doFetch = () => {
    // FormData/Blob nativos de Node 18 (undici); cuerpo y señal frescos por
    // intento. Uint8Array de por medio como en facturapi/whisper: es el patrón
    // del repo que ya compila con un Buffer.
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append(
      "file",
      new Blob([new Uint8Array(file.buffer)], { type: file.mimeType ?? "application/pdf" }),
      file.filename,
    );
    return fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/media`, {
      method: "POST",
      // SOLO Authorization: el Content-Type del multipart (con su boundary)
      // lo arma fetch a partir del FormData; ponerlo a mano lo rompe.
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      // Más holgado que los 15 s de mensajes: aquí se sube un PDF entero.
      signal: AbortSignal.timeout(30000),
    });
  };

  let res = await doFetch();
  // Reintento único solo con 5xx/429, igual que postToGraph. En timeout o
  // error de red NO se reintenta.
  if (res.status >= 500 || res.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    res = await doFetch();
  }

  // Meta puede responder HTML (p. ej. 502 del gateway): no asumir JSON.
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw parseWaError(json, res.status);
  // La respuesta buena es `{ id }`: un 200 sin id también es fallo para el caller.
  if (!json.id) throw parseWaError(json, res.status);
  return String(json.id);
}

/**
 * Documento ya subido (por media id). Como cualquier mensaje libre, SOLO llega
 * dentro de la ventana de 24 h; fuera de ella Meta lo rechaza con 131047 (por
 * eso send-and-log solo lo usa en modo texto).
 */
export async function sendWhatsAppDocument(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  doc: { mediaId: string; filename: string; caption?: string },
) {
  return postToGraph(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    to: normalizeMxWhatsAppPhone(to),
    type: "document",
    document: {
      id: doc.mediaId,
      filename: doc.filename,
      // Sin caption, el campo ni se manda.
      ...(doc.caption ? { caption: doc.caption } : {}),
    },
  });
}

/**
 * Metadatos de un archivo que el PACIENTE mandó por WhatsApp (foto, nota de
 * voz, PDF, video…). Meta no entrega el binario en el webhook: manda un media
 * id y hay que venir aquí a pedir la URL de descarga, que además solo abre con
 * el token en la cabecera — por eso el panel lo sirve a través de un proxy
 * (api/whatsapp/media) y no con un enlace directo en un `<img src>`.
 *
 * Devuelve null cuando el archivo YA NO EXISTE en Meta: lo borran a los ~30
 * días, así que un adjunto viejo no es un error, es que caducó — y la UI tiene
 * que decirlo, no pintar un ícono roto. Meta lo reporta de dos formas: un 404
 * a secas, o el clásico HTTP 400 con código 100 / subcódigo 33 ("Object with
 * ID … does not exist") de la Graph API; las dos se tratan como "caducó".
 * Cualquier otro fallo (token revocado, 5xx) sí lanza WhatsAppApiError.
 */
export async function getWhatsAppMediaMeta(
  accessToken: string,
  mediaId: string,
): Promise<{ url: string; mimeType: string; fileSize: number } | null> {
  // Mismo descifrado perezoso que postToGraph: cifrado ("v1:...") o en claro.
  const token = decryptField(accessToken) ?? accessToken;
  const res = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) return null;
  // Meta puede responder HTML (p. ej. 502 del gateway): no asumir JSON.
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = parseWaError(json, res.status);
    if (err.code === 100 && err.subcode === 33) return null;
    throw err;
  }
  if (typeof json?.url !== "string" || json.url.length === 0) return null;
  return {
    url: json.url,
    mimeType: typeof json.mime_type === "string" ? json.mime_type : "application/octet-stream",
    fileSize: Number(json.file_size) || 0,
  };
}

/**
 * Marca como LEÍDO un mensaje del paciente: es lo que le pinta las palomitas
 * azules en su WhatsApp. Sin esto, la clínica abre la conversación en el
 * panel y el paciente sigue viendo su mensaje "sin leer" durante horas, y
 * vuelve a escribir para preguntar si lo recibieron.
 *
 * Va por el mismo endpoint de mensajes que un envío (por eso reusa
 * postToGraph): Meta lo modela como un "status" que se publica sobre el wamid.
 * Best-effort desde el caller: una palomita nunca puede romper el abrir el hilo.
 */
export async function markWhatsAppMessageRead(
  phoneNumberId: string,
  accessToken: string,
  wamid: string,
) {
  return postToGraph(phoneNumberId, accessToken, {
    messaging_product: "whatsapp",
    status: "read",
    message_id: wamid,
  });
}
