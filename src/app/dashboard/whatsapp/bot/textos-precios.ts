// ws1-t3 (2-oct-2026) — textos de los dos interruptores de precios del bot.
// Los pintan las DOS vistas («Configurar bot» de siempre, bot-client.tsx, y la
// del rediseño, whatsapp-rediseno/bot.tsx) para que no se separen. Viven aquí
// y no en los diccionarios, igual que team/textos-equipo.ts.

import { useLocale } from "@/i18n/i18n-provider";

const es = {
  procedimientosTitulo: "Dar precios de Procedimientos",
  procedimientosDesc:
    "El bot dice el precio de tus procedimientos activos de Administración → Procedimientos. Los que están en $0 no los menciona: lo que diga de ellos lo decides en las instrucciones. Apagado, dice que el costo se da en la valoración y ofrece agendarla.",
  ortodonciaTitulo: "Dar precios de Ortodoncia",
  ortodonciaDesc:
    "El bot dice el precio de tus técnicas activas de Ortodoncia → Configuración → «Técnicas y precios» y de los procedimientos de ortodoncia (Control, Colocación de aparatología…). Los que están en $0 no los menciona. Apagado, dice que el costo se da en la valoración y ofrece agendarla.",
  ortodonciaSinModulo: "Requiere el módulo de Ortodoncia.",
  sqlPendiente: "Todavía no está activo en tu clínica.",
};

const en: typeof es = {
  procedimientosTitulo: "Share Procedures prices",
  procedimientosDesc:
    "The bot quotes your active procedures from Administration → Procedures. Procedures at $0 are never mentioned: what it says about them is up to your instructions. When off, it says the cost is given at the assessment visit and offers to book it.",
  ortodonciaTitulo: "Share Orthodontics prices",
  ortodonciaDesc:
    "The bot quotes your active techniques from Orthodontics → Settings → “Techniques and prices” and your orthodontic procedures (Check-up, Appliance placement…). Items at $0 are never mentioned. When off, it says the cost is given at the assessment visit and offers to book it.",
  ortodonciaSinModulo: "Requires the Orthodontics module.",
  sqlPendiente: "Not active in your clinic yet.",
};

export type TextosPreciosBot = typeof es;

export const TEXTOS_PRECIOS_BOT = { es, en } as const;

export function useTextosPreciosBot(): TextosPreciosBot {
  return useLocale().startsWith("en") ? en : es;
}
