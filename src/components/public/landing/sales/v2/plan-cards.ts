/**
 * Tarjetas de precios de la landing — TODAS las cifras salen de la base de datos.
 *
 * REGLA DURA DEL PROYECTO: en la landing no se escribe a mano ningún precio,
 * cupo ni límite de plan. `buildPlanCards()` recibe lo que devuelve
 * `getResolvedPlans()` (tabla `plan_configs`, con caché + fallback al seed de
 * `plan-shared.ts`) y arma el view-model completo: importe mensual, equivalente
 * mensual del anual, ahorro, % de descuento, promo del primer mes, cupos
 * (pacientes/usuarios/storage/tokens) y el bullet de CFDI.
 *
 * Lo ÚNICO que vive aquí escrito es copy de marketing sin números:
 * el eslogan de cada plan y los bullets que no dependen de un límite.
 *
 * Módulo PURO (sin prisma, sin "server-only"): lo importa el server component
 * de la página y también el client component que pinta las tarjetas.
 */

import type { PlanId } from '@/lib/billing/plans';
import {
  FIRST_MONTH_PROMO_MXN,
  cfdiBullet,
  formatBytes,
  type ResolvedPlan,
} from '@/lib/plan-shared';
import { fmtMXN } from './landing-data';

export interface CapacityRow {
  text: string;
  value: string;
  /** false → fila con ✗ gris (ej. "Tokens IA · 0 · Sin IA" en Básico). */
  included: boolean;
}

export interface FeatureRow {
  text: string;
  included: boolean;
}

export interface PlanCard {
  id: PlanId;
  /** Valor de ?plan= que acepta el signup (ver signup-form.tsx). */
  signupParam: 'basic' | 'pro' | 'clinic';
  name: string;
  tagline: string;
  badge: string;
  badgeColor: string;
  /** Badge centrado + borde azul (tarjeta destacada). */
  recommended: boolean;
  /** MXN/mes del plan mensual. */
  monthly: number;
  /** MXN/mes equivalente al pagar anual. */
  yearlyPerMonth: number;
  /** MXN/año. */
  yearly: number;
  /** Ahorro anual en MXN vs. pagar mes a mes. */
  yearlySavings: number;
  /** Descuento del plan anual, redondeado (%). */
  yearlyDiscountPct: number;
  /** Precio TOTAL del primer mes (promo). */
  firstMonth: number;
  addendum: string | null;
  capacity: CapacityRow[];
  features: FeatureRow[];
}

const SIGNUP_PARAM: Record<PlanId, PlanCard['signupParam']> = {
  BASIC: 'basic',
  PRO: 'pro',
  CLINIC: 'clinic',
};

/** Copy SIN cifras. Todo lo numérico se deriva de plan_configs más abajo. */
const CARD_COPY: Record<PlanId, { tagline: string; badge: string; badgeColor: string; recommended: boolean; addendum: string | null }> = {
  BASIC: {
    tagline: 'Para ordenar tu clínica desde el día uno',
    badge: 'Clínica nueva',
    // emerald-700, no teal-600: el blanco sobre #0d9488 se queda en 3.74:1.
    badgeColor: '#047857',
    recommended: false,
    addendum: null,
  },
  PRO: {
    tagline: 'La favorita de las clínicas dentales',
    badge: '★ Más popular',
    badgeColor: '#2563eb',
    recommended: true,
    addendum: 'Todo lo de Básico, y además:',
  },
  CLINIC: {
    tagline: 'Para clínicas con varios consultorios',
    badge: 'Clínica Grande',
    badgeColor: '#1e3a8a',
    recommended: false,
    addendum: 'Todo lo de Profesional, y además:',
  },
};

/** "0 · Sin IA" · "200 mil" · "1 millón" — a partir del cupo real de tokens. */
export function formatAiTokens(tokens: number): string {
  if (tokens <= 0) return '0 · Sin IA';
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    const n = Number.isInteger(millions) ? String(millions) : millions.toFixed(1);
    return `${n} ${millions === 1 ? 'millón' : 'millones'}`;
  }
  if (tokens >= 1000) return `${Math.round(tokens / 1000).toLocaleString('es-MX')} mil`;
  return tokens.toLocaleString('es-MX');
}

/** "200 mil tokens/mes" para los bullets de IA. */
function aiTokensPerMonth(tokens: number): string {
  return `${formatAiTokens(tokens)} tokens/mes`;
}

const unlimited = (n: number | null) => (n == null ? 'Ilimitados' : n.toLocaleString('es-MX'));

/** `formatBytes` devuelve "5.0 GB"; en la tarjeta el ".0" sobra ("5 GB"). */
function storage(bytes: number): string {
  return formatBytes(bytes).replace(/\.0(?= )/, '');
}

/**
 * Bullets de cada plan. Los que llevan número (CFDI, tokens IA) se COMPONEN con
 * los valores reales del plan; ninguno se escribe a mano.
 *
 * ⚠️ CBCT/3D vs. IA: la IA de imagen SOLO procesa radiografías 2D
 * (/api/xrays/[id]/analyze rechaza lo que no sea image/*). El visor CBCT es
 * cortes + mediciones, sin IA. No volver a fusionar esos dos bullets.
 * El visor 3D y "Mi Clínica Visual" NO tienen gate de plan hoy (solo exigen rol
 * ADMIN), por eso salen incluidos también en Básico.
 */
function featuresFor(id: PlanId, p: ResolvedPlan): FeatureRow[] {
  const cfdi = cfdiBullet(p);
  if (id === 'BASIC') {
    return [
      { text: 'Agenda + recordatorios por WhatsApp', included: true },
      { text: 'Expediente clínico + odontograma', included: true },
      { text: cfdi, included: true },
      { text: 'Presupuestos, cobros y factura automática', included: true },
      { text: 'Portal del paciente y recetas digitales', included: true },
      { text: 'CBCT 3D en la nube · visor con cortes y mediciones', included: true },
      { text: 'Análisis de radiografías 2D con IA', included: false },
      { text: 'Modelos 3D y clínica virtual', included: true },
      { text: 'Varias sucursales', included: false },
    ];
  }
  if (id === 'PRO') {
    return [
      { text: 'CBCT 3D en la nube · visor con cortes y mediciones', included: true },
      { text: 'Análisis de radiografías 2D con IA', included: true },
      { text: `Asistente clínico con IA · ${aiTokensPerMonth(p.aiTokensDefault)}`, included: true },
      { text: cfdi, included: true },
      { text: 'Modelos 3D dentales y clínica virtual 3D', included: true },
      { text: 'Analytics, reportes y TV de sala de espera', included: true },
      { text: 'Varias sucursales en una cuenta', included: false },
      { text: 'Roles avanzados y soporte prioritario', included: false },
    ];
  }
  return [
    { text: 'Varias sucursales en una cuenta', included: true },
    { text: 'Roles y permisos avanzados', included: true },
    { text: cfdi, included: true },
    { text: `IA ampliada · ${aiTokensPerMonth(p.aiTokensDefault)}`, included: true },
    { text: 'Soporte prioritario', included: true },
    { text: 'Onboarding y migración dedicados', included: true },
  ];
}

export function buildPlanCards(plans: ResolvedPlan[]): PlanCard[] {
  return plans.map((p) => {
    const copy = CARD_COPY[p.id];
    const yearlyFull = p.priceMxnMonthly * 12;
    return {
      id: p.id,
      signupParam: SIGNUP_PARAM[p.id],
      name: p.label,
      tagline: copy.tagline,
      badge: copy.badge,
      badgeColor: copy.badgeColor,
      recommended: copy.recommended,
      monthly: p.priceMxnMonthly,
      yearly: p.priceMxnAnnual,
      yearlyPerMonth: Math.round(p.priceMxnAnnual / 12),
      yearlySavings: Math.max(0, yearlyFull - p.priceMxnAnnual),
      yearlyDiscountPct: yearlyFull > 0 ? Math.round((1 - p.priceMxnAnnual / yearlyFull) * 100) : 0,
      firstMonth: FIRST_MONTH_PROMO_MXN[p.id],
      addendum: copy.addendum,
      capacity: [
        { text: 'Pacientes', value: unlimited(p.maxPatients), included: true },
        { text: 'Usuarios', value: unlimited(p.maxUsers), included: true },
        { text: 'Almacenamiento', value: storage(p.storageBytes), included: true },
        { text: 'Tokens IA', value: formatAiTokens(p.aiTokensDefault), included: p.aiTokensDefault > 0 },
      ],
      features: featuresFor(p.id, p),
    };
  });
}

/** El precio más barato de primer mes ("tu primer mes desde $19"). */
export function cheapestFirstMonth(cards: PlanCard[]): number {
  return cards.reduce((min, c) => Math.min(min, c.firstMonth), Infinity);
}

/** Formateado, listo para el copy ("desde $19"). */
export function cheapestFirstMonthLabel(cards: PlanCard[]): string {
  return fmtMXN(cheapestFirstMonth(cards));
}

/**
 * Descuento anual que se anuncia en el toggle. Se toma el del plan destacado
 * (todos comparten el mismo 35% en el seed); si algún día divergen, manda el
 * recomendado, que es el que la mayoría contrata.
 */
export function headlineYearlyDiscount(cards: PlanCard[]): number {
  const featured = cards.find((c) => c.recommended) ?? cards[0];
  return featured ? featured.yearlyDiscountPct : 0;
}
