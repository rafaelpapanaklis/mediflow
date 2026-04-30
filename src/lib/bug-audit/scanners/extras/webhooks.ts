/**
 * Scanner A — Webhooks de pago / mensajería.
 *
 * Verifica:
 *   A.1 Stripe valida `stripe-signature` con constructEvent.
 *   A.2 Otros webhooks (Postmark, Twilio/WhatsApp) validan HMAC/secret.
 *   A.3 Idempotencia: el handler revisa que el event_id no haya sido procesado.
 *
 * Severidades: CRITICAL para falta de validación de firma; HIGH para
 * idempotencia faltante.
 */

import path from "node:path";
import type { BugItem } from "../../types";
import { repoRoot, walk, readManyAbs, safeSnippet , makeItem } from "../../helpers";

export async function runWebhookScan(): Promise<BugItem[]> {  const items: BugItem[] = [];

  const webhooksRoot = path.join(repoRoot(), "src/app/api");
  const allRoutes = (await walk(webhooksRoot, [".ts"])).filter(p =>
    p.includes("webhook") || p.includes("/stripe/") || p.includes("/whatsapp/"),
  );
  const files = await readManyAbs(allRoutes);

  for (const f of files) {
    const isStripe = /\/stripe\//.test(f.rel) && /webhook/.test(f.rel);
    const isPostmark = /\/postmark\//.test(f.rel);
    const isTwilio = /\/twilio\//.test(f.rel);
    const isWhatsapp = /\/whatsapp\/webhook/.test(f.rel);

    // A.1 Stripe — busca constructEvent o equivalente.
    if (isStripe) {
      const validates =
        /stripe\.webhooks\.constructEvent\(/.test(f.content) ||
        /constructEventAsync\(/.test(f.content);
      if (!validates) {
        items.push(makeItem({
          category: "webhooks",
          severity: "critical",
          file: f.rel,
          line: 1,
          title: "Webhook Stripe sin validación de firma",
          description:
            "El handler no llama stripe.webhooks.constructEvent. Cualquiera con la URL del webhook puede falsificar pagos y forzar status PAID en facturas.",
          suggestion:
            "Importa Stripe SDK y valida el evento: const sig = req.headers.get('stripe-signature'); const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET).",
          code_snippet: safeSnippet(f.content.slice(0, 240)),
        }));
      }
    }

    // A.2 Postmark/Twilio/WhatsApp — validación de secret.
    if (isPostmark || isTwilio || isWhatsapp) {
      const validates =
        /process\.env\.\w*WEBHOOK_SECRET/.test(f.content) ||
        /x-twilio-signature/i.test(f.content) ||
        /verify_token|hub\.verify_token/.test(f.content) ||
        /createHmac/.test(f.content) ||
        /timingSafeEqual/.test(f.content);
      if (!validates) {
        items.push(makeItem({
          category: "webhooks",
          severity: "critical",
          file: f.rel,
          line: 1,
          title: `Webhook sin validación de secret (${isPostmark ? "Postmark" : isTwilio ? "Twilio" : "WhatsApp"})`,
          description:
            "El handler no valida ningún secret, HMAC ni verify_token. Cualquiera puede inyectar mensajes/eventos que disparan lógica interna.",
          suggestion:
            "Valida con HMAC contra el secret del provider antes de procesar (timingSafeEqual). En WhatsApp Cloud API, además compara hub.verify_token en el GET de verificación.",
          code_snippet: safeSnippet(f.content.slice(0, 240)),
        }));
      }
    }

    // A.3 Idempotencia — busca patrón de check de event_id ya procesado.
    if (isStripe || isWhatsapp) {
      const looksIdempotent =
        /processedEvents?|webhook_events?|event_id/i.test(f.content) &&
        (/findUnique|findFirst|exists/i.test(f.content) ||
          /\bON CONFLICT\b/i.test(f.content));
      if (!looksIdempotent) {
        items.push(makeItem({
          category: "webhooks",
          severity: "high",
          file: f.rel,
          line: 1,
          title: "Webhook sin idempotencia",
          description:
            "El handler no parece chequear si el event_id ya fue procesado. Si Stripe/WhatsApp reintenta (es lo normal), se duplican Payments/Invoices/messages.",
          suggestion:
            "Crea tabla webhook_events (id PRIMARY KEY = event.id) e inserta antes del side-effect; un INSERT con ON CONFLICT DO NOTHING que retorne 0 rows = duplicado, salir 200 sin reprocesar.",
          code_snippet: safeSnippet(f.content.slice(0, 240)),
        }));
      }
    }
  }

  return items;
}
