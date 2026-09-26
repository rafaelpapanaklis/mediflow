/**
 * SPEI por TRANSFERENCIA DIRECTA — núcleo PURO (sin prisma, sin server-only).
 *
 * La clínica transfiere a la cuenta de la plataforma (datos en /admin/settings
 * → «Datos banco») y un admin confirma el pago desde /admin/payments. Aquí solo
 * viven las reglas que no dependen de la base: cuánto se transfiere, cómo se
 * valida una CLABE, cómo se arma la referencia y hasta cuándo llega el periodo.
 * La parte con base de datos está en `spei-directo.ts`.
 *
 * IMPORTE — es el MISMO que cobraría Stripe por ese plan y periodo:
 *   subtotal = (anual ? priceMxnAnnual : priceMxn) × 100 centavos
 * que es exactamente el `unitAmount` de /api/billing/checkout (lo vigila
 * `spei-directo.test.ts` leyendo esa ruta). Los precios salen de `plan_configs`
 * (getResolvedPlan); aquí no hay ninguno escrito.
 *
 * IVA — precio + 16 % (decisión de Rafael: los tres métodos cobran el mes + IVA; la
 * única excepción es el mismo plan de una clínica creada antes del corte).
 * Se calcula sobre el subtotal y se redondea al centavo, igual que Stripe con una tasa
 * exclusiva (ver iva-cobro.ts): el importe que se muestra es el que se guarda.
 */

import { desgloseConIva, desgloseSinIva } from "./iva-cobro";

export type PeriodoPago = "monthly" | "annual";

export { IVA_TASA } from "./iva-cobro";

/** Lo único que se necesita de un plan resuelto para calcular el importe. */
export interface PrecioDePlan {
  priceMxn: number;
  priceMxnAnnual: number;
}

export interface ImporteSpei {
  /** Precio del plan para el periodo, en centavos (= unitAmount del checkout). */
  subtotalCents: number;
  /** IVA 16 % sobre el subtotal, redondeado al centavo. */
  ivaCents: number;
  /** Lo que la clínica transfiere: subtotal + IVA. */
  totalCents: number;
}

/** Precio del plan para el periodo, en centavos: la misma cuenta del checkout. */
export function subtotalCentavos(plan: PrecioDePlan, billing: PeriodoPago): number {
  return Math.round((billing === "annual" ? plan.priceMxnAnnual : plan.priceMxn) * 100);
}

/**
 * `conIva` es true SIEMPRE, salvo la renovación del mismo plan de una clínica de las de
 * antes (ver exencionDeIva en iva-cobro.ts): ahí el importe es el precio tal cual.
 */
export function importeSpei(args: { plan: PrecioDePlan; billing: PeriodoPago; conIva?: boolean }): ImporteSpei {
  const subtotal = subtotalCentavos(args.plan, args.billing);
  return args.conIva === false ? desgloseSinIva(subtotal) : desgloseConIva(subtotal);
}

/** 68900 → "689.00" (para copiar al portapapeles: sin símbolo ni separador). */
export function centavosADecimal(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 68900 → "$689.00" (para mostrar). */
export function centavosAMxn(cents: number): string {
  return "$" + (cents / 100).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── CLABE ────────────────────────────────────────────────────────────────

export function normalizarClabe(v: string): string {
  return String(v ?? "").replace(/[\s-]/g, "");
}

/** CLABE de 18 dígitos con dígito verificador correcto (pesos 3-7-1). */
export function clabeValida(v: string): boolean {
  const c = normalizarClabe(v);
  if (!/^\d{18}$/.test(c)) return false;
  const pesos = [3, 7, 1];
  let suma = 0;
  for (let i = 0; i < 17; i++) suma += ((Number(c[i]) * pesos[i % 3]) % 10);
  return (10 - (suma % 10)) % 10 === Number(c[17]);
}

/** Grupos de 3 dígitos (6 grupos) para leerla y dictarla sin equivocarse. */
export function clabeAgrupada(v: string): string {
  return normalizarClabe(v).replace(/(\d{3})(?=\d)/g, "$1 ");
}

// ── Cuenta de la plataforma ──────────────────────────────────────────────

export interface CuentaBancaria {
  banco: string;
  beneficiario: string;
  clabe: string;
}

const LARGO_MAX_TEXTO = 120;

/** Normaliza lo escrito en /admin. Devuelve el error en español o la cuenta limpia. */
export function validarCuentaBancaria(
  raw: Partial<Record<keyof CuentaBancaria, unknown>>,
): { ok: true; cuenta: CuentaBancaria } | { ok: false; error: string } {
  const banco = String(raw.banco ?? "").trim();
  const beneficiario = String(raw.beneficiario ?? "").trim();
  const clabe = normalizarClabe(String(raw.clabe ?? ""));
  if (!banco) return { ok: false, error: "Escribe el nombre del banco." };
  if (!beneficiario) return { ok: false, error: "Escribe el nombre del beneficiario." };
  if (banco.length > LARGO_MAX_TEXTO || beneficiario.length > LARGO_MAX_TEXTO) {
    return { ok: false, error: `Banco y beneficiario admiten hasta ${LARGO_MAX_TEXTO} caracteres.` };
  }
  if (!/^\d{18}$/.test(clabe)) return { ok: false, error: "La CLABE tiene 18 dígitos." };
  if (!clabeValida(clabe)) return { ok: false, error: "La CLABE no es válida: revisa los dígitos (falla el dígito verificador)." };
  return { ok: true, cuenta: { banco, beneficiario, clabe } };
}

/**
 * ¿Los datos guardados son utilizables? SPEI solo se ofrece si sí: nunca se
 * muestran datos vacíos ni una CLABE que no pasa el dígito verificador.
 */
export function cuentaUsable(c: Partial<CuentaBancaria> | null | undefined): c is CuentaBancaria {
  return !!c && !!c.banco?.trim() && !!c.beneficiario?.trim() && clabeValida(c.clabe ?? "");
}

// ── Referencia ───────────────────────────────────────────────────────────

/** Sin 0/O/1/I: se dicta y se copia sin confusiones. */
export const ALFABETO_REFERENCIA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const LARGO_REFERENCIA = 6;

/**
 * El folio de la clínica: «DC» + 6 caracteres del alfabeto. Solo letras y
 * dígitos (los bancos rechazan guiones y símbolos en el concepto del SPEI).
 * Lo deriva `referenciaDeClinica` (spei-directo.ts) del id de la clínica: es
 * ESTABLE, así que se puede enseñar antes de que exista ninguna solicitud y no
 * cambia entre pagos. No es un secreto ni identifica por sí solo un pago: el
 * admin confirma mirando también clínica e importe.
 */
export function referenciaValida(v: string): boolean {
  return new RegExp(`^DC[${ALFABETO_REFERENCIA}]{${LARGO_REFERENCIA}}$`).test(v);
}

// ── Periodo ──────────────────────────────────────────────────────────────

/** Suma n meses recortando el día (31 ene + 1 mes → 28/29 feb). Espejo del webhook. */
export function sumarMeses(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0);
  return d;
}

/** Suma n años (29 feb → 28 feb). Espejo del webhook. */
export function sumarAnios(date: Date, n: number): Date {
  const d = new Date(date.getTime());
  const m = d.getMonth();
  d.setFullYear(d.getFullYear() + n);
  if (d.getMonth() !== m) d.setDate(0);
  return d;
}

/**
 * Periodo que compra un pago confirmado, igual que la activación de un SPEI/OXXO
 * de Stripe (`activatePlatformSubscription`): se extiende DESDE EL FINAL del
 * periodo vigente —el máximo entre hoy, nextBillingDate y trialEndsAt—, así
 * pagar por adelantado suma los días que le quedaban en vez de perderlos.
 */
export function periodoPagado(
  ahora: Date,
  clinica: { nextBillingDate?: Date | string | null; trialEndsAt?: Date | string | null } | null | undefined,
  billing: PeriodoPago,
): { desde: Date; hasta: Date } {
  let desde = ahora;
  for (const f of [clinica?.nextBillingDate, clinica?.trialEndsAt]) {
    if (!f) continue;
    const d = new Date(f);
    if (!Number.isNaN(d.getTime()) && d > desde) desde = d;
  }
  return { desde, hasta: billing === "annual" ? sumarAnios(desde, 1) : sumarMeses(desde, 1) };
}

// ── Estados ──────────────────────────────────────────────────────────────

export const ESTADOS_SPEI = ["pending", "confirmed", "rejected"] as const;
export type EstadoSpei = (typeof ESTADOS_SPEI)[number];
