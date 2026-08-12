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
