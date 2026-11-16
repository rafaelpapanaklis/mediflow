/* ═══════════════════════════════════════════════════════════════════════
   «MI TARJETA» en la página web de la barbería — núcleo PURO (ws6-t2).

   El cliente llega a /b/<slug>/mi-tarjeta desde el menú de la página y
   escribe su teléfono. La tarjeta NUNCA se enseña ahí: cualquiera podría
   teclear el número de otro. Lo que pasa depende de la barbería:

     · con WhatsApp conectado y la plantilla aprobada → se le manda SU enlace
       personal a ESE número y la pantalla dice siempre lo mismo, exista o no
       el cliente (no sirve de directorio de clientes);
     · sin eso → «pídele tu tarjeta a la barbería», con WhatsApp / llamar.

   Sin prisma ni next/*: se prueba sin base (…/__tests__/tarjeta-web.test.ts).
   La capa con base y WhatsApp es ./tarjeta-web.ts.
   ═══════════════════════════════════════════════════════════════════════ */

/** Ruta de «Mi tarjeta» (sin dominio). */
export function rutaMiTarjeta(slug: string): string {
  return `/b/${encodeURIComponent(slug)}/mi-tarjeta`;
}

/**
 * Por dónde le llega la tarjeta al cliente.
 *   whatsapp = se le manda su enlace a su número;
 *   barberia = se la pide a la barbería (sin WhatsApp o sin plantilla aprobada).
 */
export type CanalTarjeta = "whatsapp" | "barberia";

/** Freno por IP: cuántas veces puede pedirla un mismo origen. */
export const TARJETA_IP_LIMIT = { limit: 8, windowSec: 600 } as const;

/**
 * Freno por NÚMERO (y barbería): cada envío es un WhatsApp que paga la
 * barbería y que le llega a una persona. Tres por hora alcanzan para «no me
 * llegó, lo pido otra vez» y no dejan usar la página para molestar a nadie.
 */
export const TARJETA_PHONE_LIMIT = { limit: 3, windowSec: 3600 } as const;

/**
 * Y el tope del DÍA para el mismo número: sin él, alguien insistente (con
 * otras redes y resolviendo el captcha) podría hacerle llegar tres mensajes
 * cada hora a una persona. Cinco al día es de sobra para un uso de verdad.
 */
export const TARJETA_PHONE_DAY_LIMIT = { limit: 5, windowSec: 86_400 } as const;

/** Clave del freno por número. Solo dígitos: «55…» y «+52 55…» no son dos cubetas. */
export function claveFrenoTarjeta(barbershopId: string, phoneStored: string, ventana: "hora" | "dia" = "hora"): string {
  const base = `barber-tarjeta:${barbershopId}:${phoneStored.replace(/\D/g, "")}`;
  return ventana === "dia" ? `${base}:dia` : base;
}

/** Dominio público con el que se arma el enlace que viaja por WhatsApp. */
export const TARJETA_SITE_URL_DEFAULT = "https://www.dalecontrol.com";

/**
 * El dominio del enlace sale SIEMPRE de la configuración del servidor, nunca
 * de la petición: con el `Host` de la petición, quien la manda podría hacer
 * que a otra persona le llegue un enlace a un dominio suyo con el token real.
 */
export function sitioDeTarjeta(env: Record<string, string | undefined>): string {
  const raw = (env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(raw) ? raw : TARJETA_SITE_URL_DEFAULT;
}

/** Texto con el que el cliente le escribe a la barbería para pedirla. */
export function textoPedirTarjeta(locale: string | null | undefined): string {
  return locale === "en" ? "Hi, I'd like my star card." : "Hola, quiero mi tarjeta de estrellas.";
}
