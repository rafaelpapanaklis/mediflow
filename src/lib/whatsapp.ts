import { decryptField } from "@/lib/crypto/envelope";

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  message: string
) {
  // El token puede venir cifrado con envelope ("v1:...") o en claro (clínicas
  // conectadas antes del cifrado): decryptField devuelve el claro tal cual
  // (migración perezosa; se re-cifra al siguiente guardado en connect).
  const token = decryptField(accessToken) ?? accessToken;
  // Normalize Mexican phone: always output 52 + 10 digits = 12 digits
  let phone = to.replace(/[\s\-\(\)\+]/g, "");
  // Strip country code if present to get raw 10 digits
  if (phone.startsWith("521") && phone.length === 13) phone = phone.slice(3); // 521XXXXXXXXXX → 10 digits (old MX mobile format)
  else if (phone.startsWith("52") && phone.length === 12) phone = phone.slice(2); // 52XXXXXXXXXX → 10 digits
  // Now phone should be 10 digits, add country code
  if (phone.length === 10) phone = `52${phone}`;
  const formattedPhone = phone;

  const doFetch = () =>
    fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "text",
        text: { body: message },
      }),
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
    throw new Error(err?.error?.message ?? `Error al enviar mensaje (HTTP ${res.status})`);
  }
  return await res.json();
}
