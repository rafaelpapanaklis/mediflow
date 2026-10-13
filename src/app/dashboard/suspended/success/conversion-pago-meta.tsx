"use client";

// Purchase del píxel de Meta (WS1-T4) — el lado del NAVEGADOR.
//
// No pinta nada. La página (servidor) solo lo monta cuando ya confirmó con
// Stripe el PRIMER pago de esta clínica (la misma `conversion` de Google Ads).
// Arranca el píxel aquí —el layout no lo carga en el panel— y manda Purchase
// una vez, con eventID = id de la sesión de Stripe: el webhook manda el mismo
// evento por la API de Conversiones y Meta los junta. Va aparte del componente
// de Google para no tocar su comportamiento.

import { useEffect } from "react";
import type { ConversionPagoCompletado } from "./conversion-pago";
import { medirCompraMeta } from "@/lib/analytics/meta-pixel-eventos";
import { medirCompraTiktok } from "@/lib/analytics/tiktok-events";

export function ConversionPagoCompletadoMeta({
  transactionId,
  valueMxn,
  currency,
  plan,
  emailSha256,
}: ConversionPagoCompletado & { emailSha256?: string | null }) {
  const planId = plan?.id ?? null;
  useEffect(() => {
    medirCompraMeta({ transactionId, valueMxn, currency });
    // ws1-t5: Purchase de TikTok, mismo event_id; identify con el correo en SHA-256 (solo aquí y en el registro)
    medirCompraTiktok({ transactionId, valueMxn, currency, plan: planId, emailSha256 });
  }, [transactionId, valueMxn, currency, planId, emailSha256]);

  return null;
}
