// ws1-t3 (2-oct-2026) — textos de los dos interruptores de precios del bot.
// Los pintan las DOS vistas («Configurar bot» de siempre, bot-client.tsx, y la
// del rediseño, whatsapp-rediseno/bot.tsx) para que no se separen. Viven aquí
// y no en los diccionarios, igual que team/textos-equipo.ts.

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  procedimientosTitulo: "Dar precios de Procedimientos",
  procedimientosDesc:
    "El bot dice el precio de tus procedimientos activos de Administración → Procedimientos (también los de ortodoncia que tengas ahí, como el Control). Los que están en $0 no los menciona, y si tus instrucciones dicen que no dé el precio de algo, obedece. Apagado, dice que el costo se da en la valoración y ofrece agendarla.",
  ortodonciaTitulo: "Dar precios de Ortodoncia",
  ortodonciaDesc:
    "El bot dice el precio de tus técnicas activas de Ortodoncia → Configuración → «Técnicas y precios». Las que están en $0 no las menciona, y si tus instrucciones dicen que no dé el precio de algo, obedece. Apagado, dice que el costo se da en la valoración y ofrece agendarla.",
  ortodonciaSinModulo: "Requiere el módulo de Ortodoncia.",
  sqlPendiente: "Todavía no está activo en tu clínica.",
};

const en: typeof es = {
  procedimientosTitulo: "Share Procedures prices",
  procedimientosDesc:
    "The bot quotes your active procedures from Administration → Procedures (including any orthodontic ones you keep there, such as the Check-up). Items at $0 are never mentioned, and if your instructions say not to quote something, it obeys. When off, it says the cost is given at the assessment visit and offers to book it.",
  ortodonciaTitulo: "Share Orthodontics prices",
  ortodonciaDesc:
    "The bot quotes your active techniques from Orthodontics → Settings → “Techniques and prices”. Items at $0 are never mentioned, and if your instructions say not to quote something, it obeys. When off, it says the cost is given at the assessment visit and offers to book it.",
  ortodonciaSinModulo: "Requires the Orthodontics module.",
  sqlPendiente: "Not active in your clinic yet.",
};

export type TextosPreciosBot = typeof es;

export const TEXTOS_PRECIOS_BOT = { es, en } as const;

export function useTextosPreciosBot(): TextosPreciosBot {
  return useLocale().startsWith("en") ? en : es;
}
