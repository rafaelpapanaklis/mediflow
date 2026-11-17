/* ═══════════════════════════════════════════════════════════════════════
   «MI TARJETA» en la página web de la barbería — núcleo PURO (ws6-t2).

   El cliente llega a /b/<slug>/mi-tarjeta desde el menú de la página, escribe
   su teléfono y, si es cliente de ESA barbería, ve su tarjeta de estrellas
   ahí mismo (decisión de Rafael, 16-nov: «si se pone el número de teléfono
   que muestre ahí la tarjeta digital, no pasa nada»). No se manda nada por
   WhatsApp: no cuesta mensajes de Meta.

   Lo que se enseña es SOLO la tarjeta: nombre de pila, estrellas, bonos e
   historial de estrellas. Nada de teléfono completo, citas, pagos ni fotos.

   ⚠️ Este archivo lo importa un componente de NAVEGADOR
   (components/barber/stars/mi-tarjeta-form.tsx): sin imports de servidor.
   La capa con base es ./tarjeta-web.ts.
   ═══════════════════════════════════════════════════════════════════════ */

/** Ruta de «Mi tarjeta» (sin dominio). */
export function rutaMiTarjeta(slug: string): string {
  return `/b/${encodeURIComponent(slug)}/mi-tarjeta`;
}

/**
 * Freno por IP: cuántas consultas puede hacer un mismo origen. Es lo que
 * impide usar la pantalla para probar números en serie.
 */
export const TARJETA_IP_LIMIT = { limit: 12, windowSec: 600 } as const;

/**
 * Freno por NÚMERO (y barbería): un cliente de verdad abre su tarjeta unas
 * cuantas veces; alguien que vigila la de otro, muchas. Pasado el tope la
 * pantalla pide esperar.
 */
export const TARJETA_PHONE_LIMIT = { limit: 10, windowSec: 3600 } as const;
export const TARJETA_PHONE_DAY_LIMIT = { limit: 30, windowSec: 86_400 } as const;

/** Clave del freno por número. Solo dígitos: «55…» y «+52 55…» no son dos cubetas. */
export function claveFrenoTarjeta(barbershopId: string, phoneStored: string, ventana: "hora" | "dia" = "hora"): string {
  const base = `barber-tarjeta:${barbershopId}:${phoneStored.replace(/\D/g, "")}`;
  return ventana === "dia" ? `${base}:dia` : base;
}

/** Texto con el que el cliente le escribe a la barbería si su número no aparece. */
export function textoPedirTarjeta(locale: string | null | undefined): string {
  return locale === "en" ? "Hi, I'd like my star card." : "Hola, quiero mi tarjeta de estrellas.";
}

// ── El número recordado en ESTE navegador ───────────────────────────────
//
// Para no teclearlo cada vez. Vive en localStorage del teléfono del cliente
// (nunca en el servidor), por barbería, y se borra con «No soy yo».

export interface NumeroRecordado {
  /** País del selector («MX», «US»…). */
  iso: string;
  /** Lo que tecleó: solo dígitos. */
  phone: string;
}

export function claveNumeroRecordado(slug: string): string {
  return `dcb-mi-tarjeta:${slug}`;
}

export function serializarNumeroRecordado(n: NumeroRecordado): string {
  return JSON.stringify({ iso: n.iso, phone: n.phone });
}

/** Lee lo guardado. Null ante cualquier cosa rara: lo guardado puede venir tocado. */
export function leerNumeroRecordado(raw: string | null | undefined): NumeroRecordado | null {
  if (!raw || raw.length > 80) return null;
  try {
    const o = JSON.parse(raw) as { iso?: unknown; phone?: unknown };
    if (typeof o?.iso !== "string" || typeof o?.phone !== "string") return null;
    if (!/^[A-Z]{2}$/.test(o.iso) || !/^\d{6,15}$/.test(o.phone)) return null;
    return { iso: o.iso, phone: o.phone };
  } catch {
    return null;
  }
}
