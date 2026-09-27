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
  /** Línea pequeña bajo el valor (ajuste 15: «Reportes consolidados…» en Sedes cuando hay más de una). */
  note?: string;
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
  /** Cabecera de la lista comparable (la misma en los tres planes desde el ajuste 9). */
  addendum: string | null;
  /** Pacientes · Usuarios · Sedes · Almacenamiento · Tokens IA (todo de plan_configs). */
  capacity: CapacityRow[];
  /**
   * Lista de la tarjeta, en el MISMO orden en los tres planes (ajuste 10):
   * (1) ocho funciones base en ✓ (las más vendedoras, las mismas en las tres;
   * seis hasta el ajuste 12, que sumó soporte y onboarding);
   * (2) lo que cambia entre planes con ✓/✗ calculado (asistente clínico con
   * IA · IA en radiografías e inasistencias · analytics + TV; ajuste 13).
   * Desde el ajuste 15 las tres listas tienen las MISMAS 11 filas (lo de
   * sedes va como nota en la ficha «Sedes»): Básico 8 ✓ y 3 ✗; Profesional y
   * Clínica 11 ✓.
   */
  features: FeatureRow[];
  /**
   * Funciones base que van en los TRES planes («Incluido en todos los planes»).
   * Es la misma lista en las tres tarjetas: la sección la pinta una sola vez.
   * Se deriva de los flags de módulo de plan_configs (ver COMMON_CANDIDATES):
   * si un día un módulo se apaga en algún plan, deja de ser «común» solo.
   */
  includedInAll: string[];
  /**
   * Etiqueta del plan anterior (plan_configs.label) para el chip verde de la
   * tarjeta (ajuste 11): Básico «Todo lo esencial incluido»; los demás «Todo lo
   * de <anterior> + lo esencial». null en el primero.
   */
  previousPlanLabel: string | null;
}

const SIGNUP_PARAM: Record<PlanId, PlanCard['signupParam']> = {
  BASIC: 'basic',
  PRO: 'pro',
  CLINIC: 'clinic',
};

/**
 * Cabecera de la lista comparable, la misma en las tres tarjetas (ajuste 9):
 * lo base va aparte, en «Incluido en todos los planes».
 */
const COMPARE_HEADING = 'Qué incluye';

/** Copy SIN cifras. Todo lo numérico se deriva de plan_configs más abajo. */
const CARD_COPY: Record<PlanId, { tagline: string; badge: string; badgeColor: string; recommended: boolean; addendum: string | null }> = {
  BASIC: {
    tagline: 'Para ordenar tu clínica desde el día uno',
    badge: 'Clínica nueva',
    // emerald-700, no teal-600: el blanco sobre #0d9488 se queda en 3.74:1.
    badgeColor: '#047857',
    recommended: false,
    addendum: COMPARE_HEADING,
  },
  PRO: {
    tagline: 'La favorita de las clínicas dentales',
    badge: '★ Más popular',
    badgeColor: '#2563eb',
    recommended: true,
    addendum: COMPARE_HEADING,
  },
  CLINIC: {
    tagline: 'Para clínicas con varios consultorios',
    badge: 'Clínica Grande',
    badgeColor: '#1e3a8a',
    recommended: false,
    addendum: COMPARE_HEADING,
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
 * Valor de la ficha «Sedes»: "1" · "Hasta 3" · "Ilimitadas" — a partir de
 * maxClinics de plan_configs (NULL = ilimitadas). Va sin la palabra «sedes»
 * porque la ficha ya la lleva de rótulo (como «Usuarios · 2»); «Hasta 4 sedes»
 * no cabía en una línea a 1440 y desalineaba las tres tarjetas.
 */
export function formatSedes(maxClinics: number | null): string {
  if (maxClinics == null) return 'Ilimitadas';
  if (maxClinics <= 1) return '1';
  return `Hasta ${maxClinics.toLocaleString('es-MX')}`;
}

/** true salvo que plan_configs.features[key] sea explícitamente false (misma regla que el sidebar). */
const hasModule = (p: ResolvedPlan, key: string) => p.moduleFeatures?.[key] !== false;

/**
 * FUNCIONES BASE — candidatas a «Incluido en todos los planes» (ajuste 9).
 *
 * Cada una lleva la condición REAL con la que el panel la habilita:
 *  - `always`: no tiene puerta de plan en el código (agenda, expediente,
 *    odontograma, presupuestos/cobros, portal, CBCT, 3D: solo exigen rol).
 *  - módulo: `plan_configs.features[key]` (lo que oculta el sidebar, ver
 *    get-active-clinic-modules.ts). Hoy whatsapp/inbox/landing/reports son
 *    true en los tres planes (seed y fallback), por eso salen como comunes.
 *  - Sabina: se monta en TODAS las pantallas del panel (dashboard/layout.tsx,
 *    SabinaLanzador sin moduleKey) y se paga con el Saldo IA de la clínica,
 *    NO con el cupo de tokens del plan (api/sabina/route.ts §6c). Por eso está
 *    en Básico aunque sus tokens sean «0 · Sin IA».
 *
 * Si una candidata NO se cumple en algún plan, no se pierde: baja a la lista
 * comparable de cada tarjeta con ✓/✗ (ver splitFeatures).
 */
const COMMON_CANDIDATES: {
  text: string;
  included: (p: ResolvedPlan) => boolean;
  /** Abre la lista de CADA tarjeta en ✓ (ajuste 10: filas positivas antes de las que cambian; 8 desde el ajuste 12). */
  lead?: boolean;
  /** Texto en la tarjeta cuando lleva cifra del plan (CFDI); en el bloque común va el genérico. */
  cardText?: (p: ResolvedPlan) => string;
}[] = [
  { text: 'Agenda + recordatorios por WhatsApp', included: (p) => hasModule(p, 'whatsapp'), lead: true },
  { text: 'Sabina, tu asistente del panel (con Saldo IA)', included: () => true, lead: true },
  { text: 'Expediente clínico + odontograma', included: () => true, lead: true },
  { text: 'Facturación CFDI (timbres incluidos según plan)', included: () => true, lead: true, cardText: (p) => cfdiBullet(p) },
  { text: 'Portal del paciente y recetas digitales', included: () => true, lead: true },
  { text: 'Página web de la clínica gratuita', included: (p) => hasModule(p, 'landing'), lead: true },
  // Ajuste 12 (Rafael): soporte y onboarding son de los TRES planes (antes, exclusivos de Clínica).
  { text: 'Soporte prioritario', included: () => true, lead: true },
  { text: 'Onboarding y migración dedicados', included: () => true, lead: true },
  { text: 'Presupuestos, cobros y factura automática', included: () => true },
  { text: 'Inbox de mensajes', included: (p) => hasModule(p, 'inbox') },
  { text: 'Reportes de la clínica', included: (p) => hasModule(p, 'reports') },
  // Ajuste 12b: CBCT y modelos 3D en UNA entrada (mismos hechos: nube, cortes y
  // mediciones, modelos, clínica virtual) para que el bloque común quede en 12 y
  // la rejilla cuadre en 3 y en 2 columnas. Sigue sin mezclarse con la IA.
  { text: 'CBCT y modelos 3D en el navegador · cortes, mediciones y clínica virtual', included: () => true },
];

/**
 * LO QUE CAMBIA — filas comparables, SIEMPRE las mismas y en el MISMO orden en
 * los tres planes, con ✓/✗ calculado desde el plan. Los números se COMPONEN
 * con plan_configs; ninguno se escribe a mano.
 *
 * IA (ajuste 13, Rafael: «la IA no solo analiza radiografías, que se vea TODO»).
 * Las OCHO funciones de IA que descuentan el cupo de tokens del plan, cada una
 * con su ruta (todas llaman a `addAiTokens` y se cortan con `cortarSiIaApagada`;
 * ver también FUNCIONES_IA en lib/ai-billing/interruptores.ts, `gasta: "cupo"`):
 *   chat              /api/ai                                 asistente clínico (diagnósticos diferenciales, dosis, notas SOAP, estudios, interacciones)
 *   dictation         /api/ai/transcribe                      dictado por voz → texto
 *   consult_assist    /api/consult/ai-assist                  análisis de la consulta (hallazgos, alertas, plan)
 *   contraindications /api/prescriptions/check-contraindications  revisión de recetas contra alergias y padecimientos
 *   xray_analysis     /api/xrays/[id]/analyze                 lectura de radiografías 2D
 *   no_show_prediction /api/analytics/no-shows/predict        predicción de inasistencias
 *   ai_insight        /api/analytics/ai-insight               explicación de reportes en palabras
 *   clinic_layout     /api/clinic-layout/optimize             acomodo de las citas del día entre sillones
 * (homeopathy → /api/homeopatia/suggest-remedies también gasta cupo, pero no es
 * dental y no se anuncia.) Sabina NO va aquí: se paga con Saldo IA (funciones base).
 * Texto FINAL aprobado por Rafael (dos filas, para no multiplicar ✗ en Básico):
 *   1. «Asistente clínico con IA: notas SOAP, dictado por voz y revisión de
 *      recetas» + cupo de tokens del plan (chat + dictation + contraindications).
 *   2. «IA en radiografías y predicción de inasistencias» (xray_analysis +
 *      no_show_prediction).
 * consult_assist, ai_insight y clinic_layout existen y también gastan cupo,
 * pero no se nombran en el texto aprobado. Con 0 tokens (Básico) los endpoints
 * responden «Límite mensual de IA alcanzado» → ✗; el módulo `ai-assistant`
 * (chat) además está apagado ahí.
 *
 * ⚠️ CBCT/3D vs. IA: la IA de imagen SOLO procesa radiografías 2D
 * (/api/xrays/[id]/analyze rechaza lo que no sea image/*). El visor CBCT es
 * cortes + mediciones, sin IA: va en las funciones base, no aquí.
 *  - Analytics y Pantallas TV: módulos `analytics` / `tv-modes`; hoy van
 *    juntos (ambos apagados en Básico), por eso son UNA fila. Si algún día
 *    divergieran en un plan, `analyticsRows` los separa en dos.
 */
const AI_CLINICAL_TEXT = 'Asistente clínico con IA: notas SOAP, dictado por voz y revisión de recetas';
const COMPARE_ROWS: { text: (p: ResolvedPlan) => string; included: (p: ResolvedPlan) => boolean }[] = [
  {
    text: (p) => (p.aiTokensDefault > 0 ? `${AI_CLINICAL_TEXT} · ${aiTokensPerMonth(p.aiTokensDefault)}` : AI_CLINICAL_TEXT),
    included: (p) => hasModule(p, 'ai-assistant') && p.aiTokensDefault > 0,
  },
  { text: () => 'IA en radiografías y predicción de inasistencias', included: (p) => p.aiTokensDefault > 0 },
];

function analyticsRows(p: ResolvedPlan): FeatureRow[] {
  const analytics = hasModule(p, 'analytics');
  const tv = hasModule(p, 'tv-modes');
  if (analytics === tv) return [{ text: 'Analytics y pantallas TV de sala de espera', included: analytics }];
  return [
    { text: 'Analytics de la clínica', included: analytics },
    { text: 'Pantallas TV de sala de espera', included: tv },
  ];
}

/**
 * «Reportes consolidados y comparación entre sedes» (ajuste 12, Rafael): solo
 * en planes con más de una sede, leído de plan_configs.maxClinics (NULL =
 * ilimitadas). Desde el ajuste 15 va como NOTA de la ficha «Sedes» y no como
 * fila propia: así las tres listas tienen las mismas filas y no queda aire
 * muerto sobre el botón en Básico y Profesional (las pistas del subgrid se
 * comparten). Rafael había dado las dos opciones («en su ficha de Sedes o como
 * ✓ propio»).
 */
const multiSede = (p: ResolvedPlan) => p.maxClinics == null || p.maxClinics > 1;
const SEDES_NOTE = 'Reportes consolidados y comparación entre sedes';

/**
 * Arma la lista de cada tarjeta (ver PlanCard.features) y la lista común.
 *  - Las candidatas que cumplen en TODOS los planes van a «Incluido en todos»;
 *    las marcadas `lead` abren además cada tarjeta en ✓.
 *  - Las que NO cumplen en algún plan no se pierden: van con ✓/✗ tras las
 *    filas comparables.
 */
function splitFeatures(plans: ResolvedPlan[]): { includedInAll: string[]; rowsFor: (p: ResolvedPlan) => FeatureRow[] } {
  const inAll = COMMON_CANDIDATES.filter((c) => plans.every((p) => c.included(p)));
  const lead = inAll.filter((c) => c.lead);
  const notInAll = COMMON_CANDIDATES.filter((c) => !inAll.includes(c));
  return {
    includedInAll: inAll.map((c) => c.text),
    rowsFor: (p) => [
      ...lead.map((c) => ({ text: c.cardText ? c.cardText(p) : c.text, included: true })),
      ...COMPARE_ROWS.map((r) => ({ text: r.text(p), included: r.included(p) })),
      ...analyticsRows(p),
      ...notInAll.map((c) => ({ text: c.cardText ? c.cardText(p) : c.text, included: c.included(p) })),
    ],
  };
}

export function buildPlanCards(plans: ResolvedPlan[]): PlanCard[] {
  const { includedInAll, rowsFor } = splitFeatures(plans);
  return plans.map((p, i) => {
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
        // Sedes (ajuste 9): maxClinics de plan_configs (NULL = ilimitadas). Con más de una, la nota de reportes entre sedes (ajuste 15).
        { text: 'Sedes', value: formatSedes(p.maxClinics), included: true, note: multiSede(p) ? SEDES_NOTE : undefined },
        { text: 'Almacenamiento', value: storage(p.storageBytes), included: true },
        { text: 'Tokens IA', value: formatAiTokens(p.aiTokensDefault), included: p.aiTokensDefault > 0 },
      ],
      features: rowsFor(p),
      includedInAll,
      previousPlanLabel: i > 0 ? plans[i - 1].label : null,
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
