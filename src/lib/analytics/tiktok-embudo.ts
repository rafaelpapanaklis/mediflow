// Destinos del embudo (ws1-t5): engancha a `registrarPaso` (embudo.ts, ws1-t9) lo
// que sale por píxel en cada paso público. Se llama UNA vez desde <TiktokPixel />.
//
//   landing_vista → TikTok ViewContent
//   clic_empezar  → TikTok ClickButton (content_name = origen, content_id = plan)
//   whatsapp_clic → TikTok ClickButton (content_name = origen) + Lead de Meta y
//                   conversión «Clic en WhatsApp» de Ads (medirClicWhatsapp)
//
// registro_ok y pago_ok NO pasan por aquí: llevan su event_id y su identify en
// signup-form.tsx y conversion-pago-meta.tsx.
//
// Hallazgo: en 57ecdd42 NADIE registraba destinos (`agregarDestinoPaso` solo se
// definía), así que `medirClicWhatsapp` (Lead de Meta + Ads) era código muerto.
// Al registrar este destino quedan encendidos; el Lead de Meta se queda porque
// el píxel de Meta ya lo tenía previsto (el «Lead NO se usa» es solo de TikTok).

import { agregarDestinoPaso, type DestinoPaso } from "./embudo";
import { eventIdLeadWhatsapp, type OrigenLeadWhatsapp, ORIGENES_LEAD_WHATSAPP } from "./meta-pixel-eventos";
import { medirClicWhatsapp } from "./whatsapp-clic";
import { trackTiktokClickButton, trackTiktokViewContent } from "./tiktok-events";

export const destinoTiktokYWhatsapp: DestinoPaso = (paso, datos) => {
  if (paso === "landing_vista") {
    trackTiktokViewContent(`vc.${Date.now().toString(36)}`);
    return;
  }
  const origen = datos.origen;
  if (paso === "clic_empezar") {
    trackTiktokClickButton(origen ?? "boton", `ce.${origen ?? "boton"}.${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`, datos.plan ?? null);
    return;
  }
  if (paso === "whatsapp_clic") {
    const o = origen && (ORIGENES_LEAD_WHATSAPP as readonly string[]).includes(origen) ? (origen as OrigenLeadWhatsapp) : null;
    if (o) medirClicWhatsapp(o);
    trackTiktokClickButton(origen ?? "whatsapp", eventIdLeadWhatsapp(origen ?? "whatsapp"), datos.plan ?? null);
  }
};

let quitar: (() => void) | null = null;

/** Idempotente: una sola vez por carga de página. */
export function registrarDestinosEmbudo(): void {
  if (quitar) return;
  quitar = agregarDestinoPaso(destinoTiktokYWhatsapp);
}

/** Solo para pruebas. */
export function _quitarDestinosEmbudo(): void {
  quitar?.();
  quitar = null;
}
