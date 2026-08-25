/**
 * ═══════════════════════════════════════════════════════════════════════
 * DaleControl BARBER — datos de marketing de la landing pública /barberias.
 *
 * Módulo PURO (sin prisma, sin "server-only"). Lo importan la página
 * (server component) y la prueba estática de src/lib/barber/__tests__.
 * NO lo importes desde una ruta Edge (la imagen OG): trae portal-core, que
 * usa el módulo `crypto` de Node.
 *
 * ── LA REGLA ──────────────────────────────────────────────────────────
 * Esto lo lee una barbería ANTES de pagar. Cada promesa de la página está
 * aquí como una "claim" con los archivos del panel donde se verificó
 * (`verifiedIn`). La prueba marketing.test.ts exige que esos archivos
 * existan: si alguien borra un módulo, la promesa deja de compilar la
 * prueba antes de que la landing mienta.
 *
 * ── CERO PRECIOS EN CÓDIGO ────────────────────────────────────────────
 * Los tres planes salen de `barber_plan_configs` (getBarberPlans, server).
 * Aquí solo se ARMA el view-model a partir de BarberResolvedPlan: precio,
 * primer mes, anual, límites y qué feature entra en qué plan. Ningún
 * número de plan vive en este archivo ni en los componentes ni en el
 * diccionario: cambiar un precio = editar una fila, sin deploy.
 *
 * ── EL COSTO DE WHATSAPP TAMPOCO SE ESCRIBE A MANO ────────────────────
 * Lo que Meta cobra por mensaje es BARBER_WA_PRICE_USD (whatsapp-core, la
 * misma constante que el panel enseña antes de mandar una campaña); el tipo
 * de cambio de referencia es el del bot (bot-core). La landing los COMPONE.
 * ═══════════════════════════════════════════════════════════════════════
 */
import {
  BARBER_FEATURES,
  barberPlanRank,
  formatBarberPrice,
  isBarberUnlimited,
  type BarberPlanId,
  type BarberResolvedPlan,
} from "@/lib/barber/plan-shared";
import { BARBER_WA_PRICE_USD } from "@/lib/barber/whatsapp-core";
import { BARBER_BOT_USD_MXN_FALLBACK } from "@/lib/barber/bot-core";
import { BARBER_LOYALTY_GOAL } from "@/lib/barber/portal-core";
import { BARBER_WEB_MANIFEST_LIST } from "@/components/barber/templates/manifest";

// ── Rutas ───────────────────────────────────────────────────────────────
export const BARBER_LANDING_PATH = "/barberias" as const;
export const BARBER_REGISTER_PATH = "/barber/registro" as const;
/** Login COMPARTIDO: getCurrentUser sabe mandar a un BarberUser a /barber. */
export const BARBER_LOGIN_PATH = "/login" as const;
export const BARBER_PRODUCT_NAME = "DaleControl Barber" as const;

/** Anclas de la página (nav + botones "ver precios"). */
export const BARBER_LANDING_ANCHORS = {
  features: "que-hace",
  whatsapp: "whatsapp",
  pricing: "precios",
  faq: "preguntas",
} as const;

// ── Promesas verificadas ────────────────────────────────────────────────

export interface BarberLandingClaim {
  /** Última parte de la llave del diccionario (…items.<key>). */
  key: string;
  /**
   * Feature de barber_plan_configs que la habilita. null = no depende del
   * plan (roles base, portal del cliente, soporte). La página deriva de la
   * TABLA desde qué plan entra cada promesa; aquí no se escribe un plan.
   */
  feature: string | null;
  /** Nombre del icono (el componente lo mapea a lucide). */
  icon: string;
  /** Archivos del panel donde se comprobó la promesa. La prueba exige que existan. */
  verifiedIn: string[];
}

export interface BarberLandingGroup {
  key: string;
  icon: string;
  items: BarberLandingClaim[];
}

/**
 * Lo que hace, agrupado por lo que le importa al dueño. El copy vive en
 * src/i18n/dictionaries/barber/landing.{es,en}.json bajo
 * features.groups.<grupo>.items.<key>.
 */
export const BARBER_LANDING_GROUPS: BarberLandingGroup[] = [
  {
    key: "llenar",
    icon: "calendar-check",
    items: [
      {
        key: "reserva",
        feature: "publicBooking",
        icon: "smartphone",
        verifiedIn: [
          "src/components/barber/booking/booking-flow.tsx",
          "src/app/b/[slug]/reservar/page.tsx",
          "src/lib/barber/booking.ts",
        ],
      },
      {
        key: "fila",
        feature: "walkinQueue",
        icon: "qr-code",
        verifiedIn: [
          "src/components/barber/walkin/walkin-qr.tsx",
          "src/app/barber/fila/[slug]/page.tsx",
          "src/app/api/barber/walkins/[id]/notify/route.ts",
        ],
      },
      {
        key: "recordatorios",
        feature: "whatsappReminders",
        icon: "message-circle",
        verifiedIn: ["src/lib/barber/whatsapp.ts", "src/lib/barber/whatsapp-core.ts"],
      },
      {
        key: "bot",
        feature: "whatsappBot",
        icon: "bot",
        verifiedIn: ["src/lib/barber/bot.ts", "src/lib/barber/bot-core.ts"],
      },
      {
        key: "web",
        feature: "miniWebEditor",
        icon: "globe",
        verifiedIn: [
          "src/components/barber/templates/manifest.ts",
          "src/components/barber/landing/editor.tsx",
          "src/app/b/[slug]/page.tsx",
        ],
      },
      {
        key: "campanas",
        feature: "whatsappInbox",
        icon: "megaphone",
        verifiedIn: [
          "src/lib/barber/campaigns.ts",
          "src/components/barber/campanas/campanas-screen.tsx",
        ],
      },
    ],
  },
  {
    key: "cobrar",
    icon: "wallet",
    items: [
      {
        key: "caja",
        feature: "cash",
        icon: "wallet",
        verifiedIn: ["src/lib/barber/cash.ts", "src/components/barber/cash/session-modals.tsx"],
      },
      {
        key: "ticket",
        feature: "tips",
        icon: "receipt",
        verifiedIn: [
          "src/components/barber/cash/ticket-modal.tsx",
          "src/components/barber/cash/ticket-print.tsx",
        ],
      },
      {
        key: "membresias",
        feature: "memberships",
        icon: "crown",
        verifiedIn: [
          "src/lib/barber/memberships.ts",
          "src/components/barber/memberships/sell-membership-modal.tsx",
        ],
      },
      {
        key: "anticipos",
        feature: "deposits",
        icon: "shield-check",
        verifiedIn: [
          "src/lib/barber/payments-core.ts",
          "src/app/api/barber/deposits/actions/route.ts",
          "src/components/barber/memberships/deposits-tab.tsx",
        ],
      },
      {
        key: "productos",
        feature: "products",
        icon: "package",
        verifiedIn: [
          "src/lib/barber/inventory.ts",
          "src/components/barber/products/productos-client.tsx",
        ],
      },
    ],
  },
  {
    key: "barbero",
    icon: "scissors",
    items: [
      {
        key: "comisiones",
        feature: "commissions",
        icon: "percent",
        verifiedIn: ["src/lib/barber/commissions.ts", "src/lib/barber/types.ts"],
      },
      {
        key: "nomina",
        feature: "commissions",
        icon: "printer",
        verifiedIn: [
          "src/app/api/barber/commissions/pay/route.ts",
          "src/components/barber/commissions/receipt-print.tsx",
        ],
      },
      {
        key: "agenda",
        feature: "agenda",
        icon: "calendar-days",
        verifiedIn: [
          "src/components/barber/agenda/agenda-client.tsx",
          "src/components/barber/agenda/week-board.tsx",
          "src/components/barber/agenda/schedule-manager.tsx",
        ],
      },
      {
        key: "roles",
        feature: null,
        icon: "users",
        verifiedIn: [
          "src/lib/barber/permissions.ts",
          "src/components/barber/team/permission-matrix.tsx",
        ],
      },
    ],
  },
  {
    key: "volver",
    icon: "heart",
    items: [
      {
        key: "ficha",
        feature: "clients",
        icon: "user-round",
        verifiedIn: [
          "src/components/barber/clients/visit-timeline.tsx",
          "src/components/barber/clients/photo-uploader.tsx",
          "src/components/barber/clients/preferences-panel.tsx",
        ],
      },
      {
        key: "lealtad",
        feature: "loyalty",
        icon: "gift",
        verifiedIn: ["src/lib/barber/loyalty.ts", "src/components/barber/clients/loyalty-card.tsx"],
      },
      {
        key: "portal",
        feature: null,
        icon: "key-round",
        verifiedIn: [
          "src/components/barber/portal/portal-login.tsx",
          "src/components/barber/portal/portal-client.tsx",
          "src/lib/barber/portal-core.ts",
        ],
      },
      {
        key: "inbox",
        feature: "whatsappInbox",
        icon: "inbox",
        verifiedIn: ["src/components/barber/whatsapp/inbox-panel.tsx", "src/lib/barber/whatsapp.ts"],
      },
    ],
  },
  {
    key: "crecer",
    icon: "trending-up",
    items: [
      {
        key: "sucursales",
        feature: "multiBranch",
        icon: "store",
        verifiedIn: [
          "src/lib/barber/branches.ts",
          "src/components/barber/branches/branches-client.tsx",
        ],
      },
      {
        key: "reportes",
        feature: "analytics",
        icon: "chart",
        verifiedIn: [
          "src/lib/barber/stats.ts",
          "src/components/barber/dashboard/reportes-view.tsx",
          "src/components/barber/dashboard/heatmap.tsx",
        ],
      },
      {
        key: "socios",
        feature: "affiliates",
        icon: "handshake",
        verifiedIn: [
          "src/lib/barber/affiliates.ts",
          "src/components/barber/afiliados/afiliados-screen.tsx",
        ],
      },
      {
        key: "soporte",
        feature: null,
        icon: "life-buoy",
        verifiedIn: ["src/lib/barber/support.ts", "src/components/barber/support/support-client.tsx"],
      },
    ],
  },
];

/** La banda de WhatsApp: qué sale por el número de la barbería. */
export const BARBER_LANDING_WA_POINTS: BarberLandingClaim[] = [
  {
    key: "recordatorio",
    feature: "whatsappReminders",
    icon: "bell",
    verifiedIn: ["src/lib/barber/whatsapp-core.ts", "src/lib/barber/whatsapp.ts"],
  },
  {
    key: "confirmacion",
    feature: "publicBooking",
    icon: "check",
    verifiedIn: ["src/lib/barber/booking.ts", "src/lib/barber/whatsapp-core.ts"],
  },
  {
    key: "turno",
    feature: "walkinQueue",
    icon: "timer",
    verifiedIn: ["src/app/api/barber/walkins/[id]/notify/route.ts", "src/lib/barber/agenda.ts"],
  },
  {
    key: "inbox",
    feature: "whatsappInbox",
    icon: "inbox",
    verifiedIn: ["src/components/barber/whatsapp/inbox-panel.tsx"],
  },
  {
    key: "campanas",
    feature: "whatsappInbox",
    icon: "megaphone",
    verifiedIn: ["src/lib/barber/campaigns.ts"],
  },
  {
    key: "bot",
    feature: "whatsappBot",
    icon: "bot",
    verifiedIn: ["src/lib/barber/bot.ts"],
  },
];

/** Las cuatro escenas del "problema" (copy en problem.items.<key>). */
export const BARBER_LANDING_PROBLEMS: ReadonlyArray<{ key: string; icon: string }> = [
  { key: "libreta", icon: "notebook-pen" },
  { key: "whatsapp", icon: "message-circle" },
  { key: "cuentas", icon: "calculator" },
  { key: "silla", icon: "armchair" },
];

/** Orden de las preguntas frecuentes (copy en faq.items.<key>). */
export const BARBER_LANDING_FAQ_KEYS: readonly string[] = [
  "commission",
  "whatsapp",
  "cancel",
  "solo",
  "owner",
  "app",
  "messages",
];

/**
 * Palabras del producto dental que JAMÁS aparecen en la landing barber
 * (contrato de la Ola 0: cliente / barbero / barbería / visita). La prueba
 * recorre los archivos de la landing y los diccionarios con esta lista.
 */
export const BARBER_LANDING_FORBIDDEN_WORDS: readonly string[] = [
  "paciente",
  "doctor",
  "Dr.",
  "clínica",
  "consulta",
  "expediente",
];

/** Cuántas plantillas trae "Mi web" — de la fuente, no escrito a mano. */
export const BARBER_WEB_TEMPLATE_COUNT = BARBER_WEB_MANIFEST_LIST.length;

/**
 * Citas al mes del ejemplo de costo de WhatsApp. Es el mismo ejemplo que
 * usa la cabecera de whatsapp-core ("una barbería con 300 citas al mes").
 */
export const BARBER_LANDING_EXAMPLE_VISITS = 300;

/** Visitas para el corte gratis (el portal del cliente enseña este mismo número). */
export const BARBER_LANDING_LOYALTY_GOAL = BARBER_LOYALTY_GOAL;

// ── Planes → tarjetas ───────────────────────────────────────────────────

export interface BarberPlanCardVM {
  id: BarberPlanId;
  name: string;
  /** Tarjeta destacada (el plan de en medio cuando hay tres). */
  recommended: boolean;
  monthly: number;
  monthlyLabel: string;
  /** Solo si la tabla trae priceYearly > 0. */
  yearly: number | null;
  yearlyLabel: string | null;
  yearlyPerMonthLabel: string | null;
  /** Solo si la tabla trae firstMonthPrice y es menor al mensual. */
  firstMonth: number | null;
  firstMonthLabel: string | null;
  maxBarbers: number;
  maxBranches: number;
  messageQuota: number;
  /** Features habilitadas, en el orden del catálogo BARBER_FEATURES. */
  featureKeys: string[];
  /** Las que este plan agrega respecto al anterior (el primero: todas). */
  addedFeatureKeys: string[];
  previousPlanName: string | null;
}

/** Planes activos, ordenados como la tabla (sortOrder) y, a empate, por rango. */
export function activeBarberPlans(plans: BarberResolvedPlan[]): BarberResolvedPlan[] {
  return plans
    .filter((p) => p.isActive)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || barberPlanRank(a.id) - barberPlanRank(b.id));
}

export function buildBarberPlanCards(plans: BarberResolvedPlan[]): BarberPlanCardVM[] {
  const active = activeBarberPlans(plans);
  const recommendedId: BarberPlanId | null = active.length >= 3 ? active[1].id : null;
  let previous: BarberResolvedPlan | null = null;

  return active.map((p) => {
    const featureKeys = BARBER_FEATURES.map((f) => f.key).filter((k) => p.features[k] === true);
    const prev = previous;
    const addedFeatureKeys = prev
      ? featureKeys.filter((k) => prev.features[k] !== true)
      : featureKeys;

    const yearly = p.priceYearly !== null && p.priceYearly > 0 ? p.priceYearly : null;
    const firstMonth =
      p.firstMonthPrice !== null && p.firstMonthPrice >= 0 && p.firstMonthPrice < p.priceMonthly
        ? p.firstMonthPrice
        : null;

    const card: BarberPlanCardVM = {
      id: p.id,
      name: p.name,
      recommended: p.id === recommendedId,
      monthly: p.priceMonthly,
      monthlyLabel: formatBarberPrice(p.priceMonthly),
      yearly,
      yearlyLabel: yearly === null ? null : formatBarberPrice(yearly),
      yearlyPerMonthLabel: yearly === null ? null : formatBarberPrice(Math.round(yearly / 12)),
      firstMonth,
      firstMonthLabel: firstMonth === null ? null : formatBarberPrice(firstMonth),
      maxBarbers: p.maxBarbers,
      maxBranches: p.maxBranches,
      messageQuota: p.messageQuota,
      featureKeys,
      addedFeatureKeys,
      previousPlanName: prev ? prev.name : null,
    };
    previous = p;
    return card;
  });
}

/** El plan activo más barato (para "desde $X al mes"). */
export function cheapestBarberPlan(plans: BarberResolvedPlan[]): BarberResolvedPlan | null {
  const active = activeBarberPlans(plans);
  if (active.length === 0) return null;
  return active.reduce((min, p) => (p.priceMonthly < min.priceMonthly ? p : min), active[0]);
}

/** El "desde $X" ya formateado, listo para interpolar; cadena vacía si no hay planes. */
export function barberFromPriceLabel(plans: BarberResolvedPlan[]): string {
  const cheapest = cheapestBarberPlan(plans);
  return cheapest ? formatBarberPrice(cheapest.priceMonthly) : "";
}

/**
 * Desde qué plan entra una feature, según la TABLA. Devuelve null cuando la
 * feature no depende del plan, cuando ningún plan la trae, o cuando ya la
 * trae el plan más barato (= "todos los planes", no hace falta etiqueta).
 */
export function barberPlanRequiredFor(
  plans: BarberResolvedPlan[],
  feature: string | null,
): BarberResolvedPlan | null {
  if (!feature) return null;
  const active = activeBarberPlans(plans);
  const first = active.find((p) => p.features[feature] === true) ?? null;
  if (!first) return null;
  if (active.length > 0 && active[0].id === first.id) return null;
  return first;
}

/** ¿La feature viene en TODOS los planes activos? */
export function barberFeatureInEveryPlan(plans: BarberResolvedPlan[], feature: string): boolean {
  const active = activeBarberPlans(plans);
  return active.length > 0 && active.every((p) => p.features[feature] === true);
}

// ── El costo real de WhatsApp (lo de Meta, no lo nuestro) ───────────────

export interface BarberReminderCostEstimate {
  visits: number;
  /** USD por mensaje de utilidad entregado (BARBER_WA_PRICE_USD.UTILITY). */
  perMessageUsd: number;
  /** USD del mes para `visits` recordatorios. */
  usd: number;
  /** Pesos aproximados, redondeados hacia arriba. */
  mxn: number;
  usdMxn: number;
}

/**
 * Cuánto le cobra Meta a la cuenta de la barbería por `visits` recordatorios
 * al mes. Mismo precio unitario que el panel enseña antes de mandar una
 * campaña; el tipo de cambio es el de referencia del bot (se puede pasar el
 * de la env BARBER_BOT_USD_MXN si quien llama lo tiene).
 */
export function estimateBarberReminderCost(
  visits: number,
  usdMxn: number = BARBER_BOT_USD_MXN_FALLBACK,
): BarberReminderCostEstimate {
  const perMessageUsd = BARBER_WA_PRICE_USD.UTILITY;
  const rate = usdMxn > 0 ? usdMxn : BARBER_BOT_USD_MXN_FALLBACK;
  const usd = Math.round(visits * perMessageUsd * 100) / 100;
  return { visits, perMessageUsd, usd, mxn: Math.ceil(usd * rate), usdMxn: rate };
}

/** "0.008" → "0.008"; "2.4" → "2.40". Sin locale: es un importe en USD. */
export function formatUsd(n: number): string {
  const decimals = Math.abs(n) < 0.1 ? 3 : 2;
  return n.toFixed(decimals);
}

/** Cuota de mensajes de un plan para el diccionario: -1 = sin tope. */
export function isBarberQuotaUnlimited(n: number): boolean {
  return isBarberUnlimited(n);
}

// ── JSON-LD ─────────────────────────────────────────────────────────────

/** Backslash + "u003c": el JSON dentro de <script> no puede llevar "<" crudo. */
const LT_ESCAPED = String.fromCharCode(92) + "u003c";

/**
 * JSON-LD seguro para dangerouslySetInnerHTML: JSON.stringify escapa las
 * comillas pero NO la barra de "</script>", así que un texto con esa
 * secuencia se saldría de la etiqueta. Se escapa cada "<".
 */
export function serializeBarberJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, LT_ESCAPED);
}
