/**
 * IVA 16 % de los pagos NUEVOS de un plan (tarjeta, OXXO y SPEI) — núcleo PURO
 * (sin prisma ni Stripe: lo importa también el cliente).
 *
 * DECISIÓN (Rafael): el IVA lo suma NUESTRO código, no Stripe Tax. Tarjeta y OXXO
 * llevan una TASA DE IMPUESTO MANUAL de Stripe («IVA 16 %», exclusiva, MX) en la
 * línea del plan: Stripe calcula el IVA, lo desglosa en recibo y factura y rellena
 * `total_details.amount_tax` (así `amount_total − amount_tax` sigue dando el valor
 * SIN IVA, que es lo que usa la conversión de Google Ads). El id de la tasa sale
 * del env STRIPE_IVA_TAX_RATE_ID (Rafael la crea en el dashboard de Stripe; el
 * código NUNCA crea nada en Stripe). SPEI directo suma el mismo 16 % por su
 * cuenta (ver spei-directo-core).
 *
 * SOLO aplica a sesiones NUEVAS. Ninguna suscripción existente se toca: ni se
 * actualiza, ni se migra, ni se cancela; sus renovaciones siguen cobrando lo de hoy.
 *
 * EXCEPCIÓN (Ajuste 1b): las clínicas YA registradas que pagan a mano (OXXO/SPEI, sin
 * tarjeta) siguen SIN IVA en la renovación de su MISMO plan — ver `planConPagoManualSinIva`.
 * Cualquier otra cosa (tarjeta, otro plan, clínica nueva, cambio de plan) lleva IVA.
 */

/** IVA general en México. Es una tasa fiscal, no un precio de plan. */
export const IVA_TASA_PCT = 16;
export const IVA_TASA = IVA_TASA_PCT / 100;

/**
 * IVA de un subtotal en centavos: sobre el subtotal, redondeado al centavo
 * (mitad hacia arriba), como lo calcula Stripe con una tasa exclusiva. Aritmética
 * entera: sin errores de coma flotante.
 */
export function ivaDeSubtotalCents(subtotalCents: number): number {
  return Math.floor((Math.round(subtotalCents) * IVA_TASA_PCT + 50) / 100);
}

export type MetodoDePago = "card" | "spei" | "oxxo";

/**
 * FECHA DE CORTE de «clínica ya registrada»: las clínicas creadas ANTES de este
 * instante son las de antes del IVA. Es una constante del código (sin SQL, sin
 * columna nueva y no se puede «mover» desde ningún panel): el día en que Rafael
 * decidió cobrar IVA a las nuevas, 26-sep-2026 00:00 hora de México (06:00 UTC).
 * Si se despliega más tarde, las clínicas que se registraron entre esa fecha y el
 * despliegue cuentan como NUEVAS (se registraron ya con «+ IVA» en la web): es lo
 * correcto. Cambiarla es una línea (y un commit), nunca un dato.
 */
export const IVA_FECHA_CORTE = new Date("2026-09-26T06:00:00.000Z");

/** Lo que hace falta de una clínica para decidir si es «de las de antes». */
export interface ClinicaParaIva {
  createdAt?: Date | string | null;
  plan?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionId?: string | null;
  nextBillingDate?: Date | string | null;
}

/**
 * ¿Esta clínica renueva SIN IVA? Devuelve el plan que puede pagar sin IVA por OXXO o
 * SPEI (su plan actual) o `null` si no aplica ninguna excepción. Se exige TODO:
 *   1. registrada ANTES de IVA_FECHA_CORTE (`Clinic.createdAt`, que no cambia nunca), y
 *   2. YA HA PAGADO alguna vez: tiene una suscripción (Stripe o legacy) o un periodo
 *      activado (`nextBillingDate`) — la misma definición que «no es primera
 *      contratación» de la promo del primer mes. Una clínica registrada antes pero que
 *      nunca pagó está comprando por primera vez: paga con IVA.
 * La excepción es SOLO para pagos únicos (OXXO/SPEI) del MISMO plan que ya tiene
 * (ver `ivaAplica`): tarjeta, otro plan y cambios de plan llevan IVA.
 */
export function planConPagoManualSinIva(clinica: ClinicaParaIva | null | undefined): string | null {
  if (!clinica || !clinica.plan) return null;
  const creada = clinica.createdAt ? new Date(clinica.createdAt) : null;
  if (!creada || Number.isNaN(creada.getTime()) || creada.getTime() >= IVA_FECHA_CORTE.getTime()) return null;
  const yaPago = !!(clinica.stripeSubscriptionId || clinica.subscriptionId || clinica.nextBillingDate);
  return yaPago ? clinica.plan : null;
}

/** ¿Este pago lleva IVA? No lleva solo si es OXXO/SPEI del plan exento de una clínica de las de antes. */
export function ivaAplica(args: { metodo: MetodoDePago; plan: string; planExento: string | null | undefined }): boolean {
  if (args.metodo === "card") return true;
  return !(args.planExento && args.plan === args.planExento);
}

export interface DesgloseIva {
  subtotalCents: number;
  ivaCents: number;
  totalCents: number;
}

export function desgloseConIva(subtotalCents: number): DesgloseIva {
  const s = Math.round(subtotalCents);
  const ivaCents = ivaDeSubtotalCents(s);
  return { subtotalCents: s, ivaCents, totalCents: s + ivaCents };
}

/** Desglose de un cobro que NO lleva IVA (renovación manual de una clínica de las de antes). */
export function desgloseSinIva(subtotalCents: number): DesgloseIva {
  const s = Math.round(subtotalCents);
  return { subtotalCents: s, ivaCents: 0, totalCents: s };
}

/** Forma de un id de tasa de Stripe: txr_ + alfanumérico. Evita pegar en Vercel un id de otro tipo. */
export function esIdDeTasa(v: string | undefined | null): v is string {
  return typeof v === "string" && /^txr_[A-Za-z0-9]{8,}$/.test(v.trim());
}

export const CODIGO_IVA_NO_CONFIGURADO = "IVA_NO_CONFIGURADO";
export const MENSAJE_IVA_NO_CONFIGURADO =
  "El cobro con tarjeta y OXXO no está disponible por ahora (falta configurar el IVA). Paga por transferencia SPEI o escríbenos a soporte.";

/**
 * Qué IVA lleva una sesión nueva de cobro por plan:
 *  · `STRIPE_AUTOMATIC_TAX === "true"` → Stripe Tax (`automatic_tax`); NO se añade la tasa manual
 *    (Stripe rechaza las dos a la vez y el IVA se sumaría doble).
 *  · si no, la tasa manual `STRIPE_IVA_TAX_RATE_ID` en la línea del plan (`tax_rates`);
 *  · sin ninguna de las dos → `ok: false`: NO se cobra sin IVA en silencio (el llamador responde 503).
 */
export type IvaParaCobro =
  | { ok: true; modo: "automatico" | "tasa" | "exento"; sesion: { automatic_tax?: { enabled: true }; customer_update?: { address: "auto" } }; linea: { tax_rates?: string[] } }
  | { ok: false; codigo: typeof CODIGO_IVA_NO_CONFIGURADO; error: string };

export function ivaParaCobro(env: Record<string, string | undefined>): IvaParaCobro {
  if (env.STRIPE_AUTOMATIC_TAX === "true") {
    // Stripe Tax necesita la dirección del cliente para calcular el impuesto.
    return { ok: true, modo: "automatico", sesion: { automatic_tax: { enabled: true }, customer_update: { address: "auto" } }, linea: {} };
  }
  const id = env.STRIPE_IVA_TAX_RATE_ID?.trim();
  if (esIdDeTasa(id)) return { ok: true, modo: "tasa", sesion: {}, linea: { tax_rates: [id] } };
  return { ok: false, codigo: CODIGO_IVA_NO_CONFIGURADO, error: MENSAJE_IVA_NO_CONFIGURADO };
}

/**
 * IVA de un pago concreto de una clínica concreta: `ivaParaCobro`, salvo que sea la
 * renovación por OXXO/SPEI del mismo plan de una clínica de las de antes — entonces
 * `modo: "exento"`, sin tasa y SIN exigir el env (esas clínicas no dependen de él).
 * La decisión se toma en el servidor con los datos de la clínica de la sesión; el
 * cliente solo la refleja en pantalla.
 */
export function ivaParaPagoDeClinica(
  env: Record<string, string | undefined>,
  args: { metodo: MetodoDePago; plan: string; clinica: ClinicaParaIva | null | undefined },
): IvaParaCobro {
  if (!ivaAplica({ metodo: args.metodo, plan: args.plan, planExento: planConPagoManualSinIva(args.clinica) })) {
    return { ok: true, modo: "exento", sesion: {}, linea: {} };
  }
  return ivaParaCobro(env);
}
