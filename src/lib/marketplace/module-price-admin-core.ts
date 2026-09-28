/**
 * Editar el precio de un módulo desde /admin/settings → Planes (ws1-t5,
 * fila 22 del mapa de conexiones). Antes el precio vivía en la tabla `modules`
 * y solo se cambiaba pegando SQL.
 *
 * Puro: qué módulos se pueden editar y si un precio es válido. La lectura y el
 * guardado viven en `./module-price-admin.ts`.
 *
 *   npx tsx --test src/lib/marketplace/module-price-admin-core.test.ts
 *
 * A QUIÉN LE CAMBIA EL PRECIO: a quien contrate a partir de ahora. El importe
 * se fija en Stripe al comprar, así que quien ya paga el módulo conserva el
 * suyo hasta que cancele y vuelva a contratar.
 */

/**
 * Los módulos que HOY se pueden contratar solos (tienen página de contratar).
 * Marketplace está en pausa: el resto del catálogo no se vende y no se ofrece
 * aquí para no poner precio a algo que nadie puede comprar.
 */
export const MODULOS_EN_VENTA: readonly string[] = ["orthodontics"];

export function moduloEnVenta(moduleKey: string): boolean {
  return MODULOS_EN_VENTA.includes(moduleKey);
}

/** Tope de cordura: un dedo de más no puede publicar un precio de seis cifras. */
export const PRECIO_MODULO_MAXIMO_MXN = 50_000;

export interface PrecioModulo {
  priceMxnMonthly: number;
  /** `null` = el módulo no se ofrece con pago anual. */
  priceMxnAnnual: number | null;
}

export type PrecioValidado =
  | { ok: true; precio: PrecioModulo }
  | { ok: false; error: string };

function entero(valor: unknown): number | null {
  if (typeof valor === "string" && valor.trim() === "") return null;
  if (typeof valor !== "number" && typeof valor !== "string") return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

/**
 * Pesos ENTEROS (las columnas son INTEGER y Stripe cobra ese número × 100).
 * El mensual es obligatorio. El anual se puede dejar vacío (no se ofrece) y
 * nunca cuesta más que doce meses: sería un «descuento» al revés.
 */
export function validarPrecioModulo(body: unknown): PrecioValidado {
  if (!body || typeof body !== "object") return { ok: false, error: "Datos inválidos" };
  const crudo = body as Record<string, unknown>;

  const mensual = entero(crudo.priceMxnMonthly);
  if (mensual === null) return { ok: false, error: "El precio mensual va en pesos enteros, sin centavos." };
  if (mensual < 1) return { ok: false, error: "El precio mensual tiene que ser de al menos $1." };
  if (mensual > PRECIO_MODULO_MAXIMO_MXN) {
    return { ok: false, error: `El precio mensual no puede pasar de $${PRECIO_MODULO_MAXIMO_MXN.toLocaleString("es-MX")}.` };
  }

  const sinAnual = crudo.priceMxnAnnual === null || crudo.priceMxnAnnual === undefined ||
    (typeof crudo.priceMxnAnnual === "string" && crudo.priceMxnAnnual.trim() === "");
  if (sinAnual) return { ok: true, precio: { priceMxnMonthly: mensual, priceMxnAnnual: null } };

  const anual = entero(crudo.priceMxnAnnual);
  if (anual === null) return { ok: false, error: "El precio anual va en pesos enteros, sin centavos." };
  if (anual < 1) return { ok: false, error: "El precio anual tiene que ser de al menos $1; déjalo vacío para no ofrecer pago anual." };
  if (anual > mensual * 12) {
    return { ok: false, error: `El anual ($${anual.toLocaleString("es-MX")}) no puede costar más que doce meses ($${(mensual * 12).toLocaleString("es-MX")}).` };
  }
  return { ok: true, precio: { priceMxnMonthly: mensual, priceMxnAnnual: anual } };
}

/** «15 %» de ahorro del anual frente a doce meses; `null` si no hay anual o no ahorra. */
export function descuentoAnualPct(precio: PrecioModulo): number | null {
  if (precio.priceMxnAnnual === null || !(precio.priceMxnMonthly > 0)) return null;
  const doce = precio.priceMxnMonthly * 12;
  const pct = Math.round(((doce - precio.priceMxnAnnual) / doce) * 100);
  return pct > 0 ? pct : null;
}
