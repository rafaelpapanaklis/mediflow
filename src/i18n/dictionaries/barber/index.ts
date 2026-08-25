// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — árbol de diccionarios PROPIO del vertical.
//
// REGLA (Ola 0): NO se toca src/i18n/dictionaries/{es,en}.json — esos son
// del panel dental. Cada terminal de la Ola 1 crea SU par de archivos
// (<area>.es.json / <area>.en.json) en ESTA carpeta y agrega UNA línea por
// objeto (ES / EN) abajo. Así 8 terminales en paralelo no chocan en un
// mismo JSON gigante.
//
// Todas las llaves viven bajo el namespace `barber.*`:
//   t("barber.shell.nav.agenda") → "Agenda"
//   t("barber.agenda.emptyDay")  → (lo crea la terminal de agenda)
//
// El motor es el mismo makeT de src/i18n/t (puro, sirve en server y client).
// ═══════════════════════════════════════════════════════════════════════
import { makeT } from "@/i18n/t";
import type { Dictionary } from "@/i18n/t";

import shellEs from "./shell.es.json";
import shellEn from "./shell.en.json";
import reservaEs from "./reserva.es.json";
import reservaEn from "./reserva.en.json";
import clientesEs from "./clientes.es.json";
import clientesEn from "./clientes.en.json";
import webEs from "./web.es.json";
import webEn from "./web.en.json";
import adminEs from "./admin.es.json";
import adminEn from "./admin.en.json";
// ── Ola 1: importa aquí tu área (una línea por idioma) ──
import agendaEs from "./agenda.es.json";
import agendaEn from "./agenda.en.json";
import cajaEs from "./caja.es.json"; // caja + comisiones + productos (T6 dinero)
import cajaEn from "./caja.en.json";
import suscripcionEs from "./suscripcion.es.json";
import suscripcionEn from "./suscripcion.en.json";
import membresiasEs from "./membresias.es.json"; // membresías + anticipos
import membresiasEn from "./membresias.en.json";
import whatsappEs from "./whatsapp.es.json"; // conexión + inbox + plantillas
import whatsappEn from "./whatsapp.en.json";
import campanasEs from "./campanas.es.json"; // campanas de retencion
import campanasEn from "./campanas.en.json";
import botEs from "./bot.es.json"; // bot que agenda por WhatsApp
import botEn from "./bot.en.json";

const ES: Dictionary = {
  barber: {
    shell: shellEs as unknown as Dictionary,
    agenda: agendaEs as unknown as Dictionary,
    caja: cajaEs as unknown as Dictionary,
    reserva: reservaEs as unknown as Dictionary,
    suscripcion: suscripcionEs as unknown as Dictionary,
    membresias: membresiasEs as unknown as Dictionary,
    clientes: clientesEs as unknown as Dictionary,
    web: webEs as unknown as Dictionary,
    admin: adminEs as unknown as Dictionary,
    whatsapp: whatsappEs as unknown as Dictionary,
    campanas: campanasEs as unknown as Dictionary,
    bot: botEs as unknown as Dictionary,
  },
};

const EN: Dictionary = {
  barber: {
    shell: shellEn as unknown as Dictionary,
    agenda: agendaEn as unknown as Dictionary,
    caja: cajaEn as unknown as Dictionary,
    reserva: reservaEn as unknown as Dictionary,
    suscripcion: suscripcionEn as unknown as Dictionary,
    membresias: membresiasEn as unknown as Dictionary,
    clientes: clientesEn as unknown as Dictionary,
    web: webEn as unknown as Dictionary,
    admin: adminEn as unknown as Dictionary,
    whatsapp: whatsappEn as unknown as Dictionary,
    campanas: campanasEn as unknown as Dictionary,
    bot: botEn as unknown as Dictionary,
  },
};

export const BARBER_SUPPORTED_LOCALES = ["es", "en"] as const;
export type BarberLocale = (typeof BARBER_SUPPORTED_LOCALES)[number];
export const BARBER_DEFAULT_LOCALE: BarberLocale = "es";

export function resolveBarberLocale(value: unknown): BarberLocale {
  return value === "en" ? "en" : "es";
}

/** Diccionario completo del vertical para el locale dado (default es). */
export function getBarberDict(locale?: string | null): Dictionary {
  return resolveBarberLocale(locale) === "en" ? EN : ES;
}

/** t() del vertical: getBarberT(barbershop.locale)("barber.shell.nav.caja"). */
export function getBarberT(locale?: string | null) {
  return makeT(getBarberDict(locale));
}
