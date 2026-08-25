// ═══════════════════════════════════════════════════════════════════════
// DaleControl BARBER — datos de las páginas de COMPARATIVA (/barberias/comparar).
//
// 🔴 ESTE ARCHIVO HABLA DE EMPRESAS REALES. Reglas que NO se negocian:
//
// 1. Cada dato de un competidor lleva `fuenteId` y sale de una fuente de
//    FUENTES, con su fecha (REVISADO_EL). Si un dato no tiene fuente, no va.
// 2. Los precios se transcriben tal como los publica cada empresa. No se
//    redondean, no se convierten de moneda, no se "estiman". Si algo se
//    calcula (un escenario con N barberos), el cálculo se enseña y se
//    marca el supuesto en `supuesto`.
// 3. Las quejas de usuarios JAMÁS se afirman como hecho. Viven en
//    `reportanUsuarios`, que la UI pinta siempre con la fórmula
//    "usuarios reportan en <fuente>", y nunca en `contras` ni en la tabla.
// 4. `fortalezas` es OBLIGATORIO y no puede ir vacío: una comparativa en la
//    que el otro no gana nada no se la cree nadie. Se prefiere una fortaleza
//    estructural y verificable ("tiene marketplace propio") sobre un adjetivo.
// 5. NINGÚN precio NUESTRO se escribe aquí. Los nuestros salen SIEMPRE de
//    barber_plan_configs vía getBarberPlans() y entran por parámetro
//    (`planes: BarberResolvedPlan[]`) a las funciones de abajo.
//
// El módulo es PURO y client-safe: no importa prisma ni "server-only".
// ═══════════════════════════════════════════════════════════════════════
import {
  formatBarberPrice,
  isBarberUnlimited,
  type BarberResolvedPlan,
} from "@/lib/barber/plan-shared";

// ── Fecha de revisión ───────────────────────────────────────────────────
// Cuándo se miraron los sitios de los competidores. Se pinta en TODAS las
// páginas. Al actualizar los datos, se mueve esta constante.
export const REVISADO_EL = "2026-08-23";
export const REVISADO_EL_TEXTO = "23 de agosto de 2026";

// ── Fuentes ─────────────────────────────────────────────────────────────
export interface Fuente {
  id: string;
  /** Cómo se nombra la fuente en la página. Sin adjetivos. */
  label: string;
  /** Sólo dominios oficiales de los que estamos seguros. Nunca rutas
   *  profundas inventadas: un enlace roto en una comparativa nos quita la
   *  razón. Se pintan con rel="nofollow noopener noreferrer". */
  url?: string;
}

export const FUENTES: Record<string, Fuente> = {
  booksyPrecios: {
    id: "booksyPrecios",
    label: "Precios publicados por Booksy para México",
    url: "https://booksy.com",
  },
  booksyBoost: {
    id: "booksyBoost",
    label: "Condiciones del programa Boost publicadas por Booksy",
    url: "https://booksy.com",
  },
  booksyResenas: {
    id: "booksyResenas",
    label: "Reseñas públicas de usuarios en Trustpilot y en el Better Business Bureau (BBB)",
  },
  freshaPrecios: {
    id: "freshaPrecios",
    label: "Precios publicados por Fresha",
    url: "https://www.fresha.com",
  },
  freshaResenas: {
    id: "freshaResenas",
    label: "Reseñas públicas de usuarios en Trustpilot",
  },
  agendaproPrecios: {
    id: "agendaproPrecios",
    label: "Precios publicados por AgendaPro para México",
    url: "https://agendapro.com",
  },
  squirePrecios: {
    id: "squirePrecios",
    label: "Precios publicados por Squire",
  },
  amyraPrecios: {
    id: "amyraPrecios",
    label: "Precios publicados por Amyra",
  },
  barberlabPrecios: {
    id: "barberlabPrecios",
    label: "Precios publicados por BarberLab",
  },
};

export function fuente(id: string): Fuente | null {
  return FUENTES[id] ?? null;
}

/** Fuentes únicas citadas por un competidor, en el orden en que aparecen.
 *  Alimenta el bloque "Fuentes" al pie de cada página: lo que no está aquí
 *  no debería estar en la página. */
export function fuentesDeCompetidor(c: Competidor): Fuente[] {
  const ids = [
    ...EJES.map((e) => c.ejes[e.id].fuenteId),
    ...c.reportanUsuarios.map((r) => r.fuenteId),
  ];
  return dedupFuentes(ids);
}

/** Fuentes únicas del índice: las de los tres competidores con página más
 *  las del panorama. */
export function fuentesDelIndice(): Fuente[] {
  const ids = [
    ...COMPETIDORES.flatMap((c) => EJES.map((e) => c.ejes[e.id].fuenteId)),
    ...PANORAMA.map((p) => p.fuenteId),
  ];
  return dedupFuentes(ids);
}

function dedupFuentes(ids: string[]): Fuente[] {
  const vistos = new Set<string>();
  const out: Fuente[] = [];
  for (const id of ids) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    const f = fuente(id);
    if (f) out.push(f);
  }
  return out;
}

// ── Tipos ───────────────────────────────────────────────────────────────

/** Un dato verificado sobre un competidor. `fuenteId` es obligatorio. */
export interface Dato {
  texto: string;
  fuenteId: string;
  /** Aclaración de comparabilidad (moneda distinta, + IVA, por persona…). */
  nota?: string;
}

/** Lo que reportan usuarios. NO es un hecho: la UI lo enmarca como reporte. */
export interface Reporte {
  texto: string;
  fuenteId: string;
}

export type EjeId = "precio" | "cobro" | "whatsapp" | "comision" | "mexico";

export interface Eje {
  id: EjeId;
  label: string;
}

/** Los cinco ejes de la tabla, en orden. */
export const EJES: Eje[] = [
  { id: "precio", label: "Precio de la suscripción" },
  { id: "cobro", label: "Cómo se cobra" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "comision", label: "Comisión por cliente" },
  { id: "mexico", label: "Presencia en México" },
];

export interface Competidor {
  slug: string;
  nombre: string;
  /** Una línea para el índice y el <title>. Neutra. */
  resumen: string;
  /** De dónde es la empresa. Dato de contexto, no un juicio. */
  origen: string;
  /** Los cinco ejes. Cada uno con su fuente. */
  ejes: Record<EjeId, Dato>;
  /**
   * En qué es mejor. OBLIGATORIO y no vacío (ver regla 4 de la cabecera).
   * Se escriben como hechos estructurales, no como adjetivos.
   */
  fortalezas: string[];
  /**
   * Fortalezas que dependen de NUESTROS precios y por eso no se pueden
   * escribir a mano: se calculan con los planes vivos de la tabla.
   * Devuelve [] cuando el cálculo no aplica.
   */
  fortalezasCalculadas?: (planes: BarberResolvedPlan[]) => string[];
  /** Dónde estamos mejor nosotros. Cada punto tiene que ser comprobable. */
  ventajas: string[];
  /** Quejas de usuarios. Nunca se afirman como hecho. Puede ir vacío. */
  reportanUsuarios: Reporte[];
  /**
   * Costo mensual de la SUSCRIPCIÓN para N barberos, en MXN.
   * `null` cuando no se puede calcular sin inventar.
   * No incluye comisiones del marketplace: ésas dependen de cuántos
   * clientes lleguen por ahí y se explican aparte.
   */
  costoMensual: (barberos: number) => { monto: number | null; nota?: string };
  /** El supuesto del cálculo de arriba, en una línea. Se pinta al pie. */
  supuesto: string;
  /** ¿Sus precios se publican + IVA? Cambia la comparabilidad. */
  masIva: boolean;
}

// ── Competidores con página propia ──────────────────────────────────────

const BOOKSY: Competidor = {
  slug: "booksy",
  nombre: "Booksy",
  resumen:
    "Agenda con marketplace propio. Cobra por empleado y una comisión sobre la primera visita de los clientes que llegan por su app.",
  origen: "Opera en México",
  ejes: {
    precio: {
      texto: "$429 MXN al mes",
      fuenteId: "booksyPrecios",
      nota: "Es el precio base. Cada empleado adicional suma aparte.",
    },
    cobro: {
      texto: "Por empleado: $429 MXN de base y $100 MXN por cada empleado adicional",
      fuenteId: "booksyPrecios",
    },
    whatsapp: {
      texto: "No lo publican como incluido en el precio del plan",
      fuenteId: "booksyPrecios",
      nota: "No verificamos qué mensajería incluye ni con qué límite. Pregúntaselos.",
    },
    comision: {
      texto:
        "30% de la primera visita de un cliente que llegue por su marketplace, con el programa Boost",
      fuenteId: "booksyBoost",
      nota: "Con mínimo de 10 USD y tope de 100 USD por cliente — el mínimo y el tope están en dólares, no en pesos.",
    },
    mexico: {
      texto: "Sí, opera en México y publica precios en pesos",
      fuenteId: "booksyPrecios",
    },
  },
  fortalezas: [
    "Tiene un marketplace propio, con app para el cliente final, donde la gente busca barbería sin conocerte antes. Eso es descubrimiento: clientes nuevos que no llegan por tu Instagram ni por tu puerta. DaleControl no tiene marketplace y no hace eso.",
    "Si tu problema es que te faltan clientes, y no que te sobre software, un marketplace ataca exactamente eso y una agenda no. Ésa es la razón honesta para quedarte con ellos aunque pagues la comisión.",
  ],
  ventajas: [
    "Nuestro precio es por plan, no por empleado: sumar barberos al equipo no sube la mensualidad mientras quepas en el plan.",
    "No cobramos comisión por cliente. Ni por el primero, ni por el que vuelve, ni por el que llegó por tu propio Instagram.",
    "Los recordatorios por WhatsApp van incluidos en el precio del plan, con un número de mensajes que ves antes de contratar.",
  ],
  reportanUsuarios: [
    {
      texto:
        "que Boost les cobró comisión por clientes que el negocio ya tenía desde antes",
      fuenteId: "booksyResenas",
    },
    {
      texto: "dificultad para darse de baja del servicio",
      fuenteId: "booksyResenas",
    },
    {
      texto:
        "que al irse, el enlace de Booksy se queda anclado en el perfil de Google del negocio",
      fuenteId: "booksyResenas",
    },
  ],
  costoMensual: (barberos) => {
    const n = Math.max(1, Math.floor(barberos));
    return { monto: 429 + (n - 1) * 100 };
  },
  supuesto:
    "Tomamos que el precio base cubre a una persona y que cada barbero extra suma $100 MXN, que es como Booksy publica el cargo por empleado adicional.",
  masIva: false,
};

const FRESHA: Competidor = {
  slug: "fresha",
  nombre: "Fresha",
  resumen:
    "Agenda con marketplace y pagos. Cobra por miembro del equipo y una comisión sobre el primer servicio de cada cliente nuevo que llega por su marketplace.",
  origen: "Opera en México",
  ejes: {
    precio: {
      texto: "MX$239.95 al mes el plan de una persona; MX$159.95 por miembro en equipo",
      fuenteId: "freshaPrecios",
      nota: "En equipo el precio es por cada miembro, así que la mensualidad crece con el tamaño del equipo.",
    },
    cobro: {
      texto: "Por miembro del equipo",
      fuenteId: "freshaPrecios",
      nota: "Eliminaron su plan gratuito en 2025.",
    },
    whatsapp: {
      texto: "20 mensajes de WhatsApp al mes incluidos; a partir de ahí se pagan aparte",
      fuenteId: "freshaPrecios",
    },
    comision: {
      texto: "20% del primer servicio de cada cliente nuevo que llegue por su marketplace",
      fuenteId: "freshaPrecios",
    },
    mexico: {
      texto: "Sí, opera en México y publica precios en pesos",
      fuenteId: "freshaPrecios",
    },
  },
  fortalezas: [
    "También tiene marketplace propio: gente que no te conoce puede encontrarte ahí y reservar. DaleControl no hace eso.",
    "Cobrar por miembro corta en los dos sentidos: si tu equipo encoge, su mensualidad encoge contigo. Un plan es un plan, y con nosotros pagas el escalón completo aunque un mes trabajes con media silla ocupada.",
    "Cobrar y procesar pagos es parte central de su producto, no un añadido: si lo que buscas es sobre todo un punto de venta, ahí tienen recorrido.",
  ],
  ventajas: [
    "Nuestro precio es por plan: el segundo, el tercero y el cuarto barbero no suman a la mensualidad mientras quepas en el plan.",
    "No cobramos comisión por cliente nuevo. Cero, venga de donde venga.",
    "El WhatsApp incluido no son 20 mensajes: el número que incluye tu plan lo ves en la página de precios antes de pagar.",
  ],
  reportanUsuarios: [
    {
      texto:
        "que les atribuyeron comisiones de marketplace por clientes que no llegaron por ahí",
      fuenteId: "freshaResenas",
    },
    {
      texto: "pagos retenidos",
      fuenteId: "freshaResenas",
    },
  ],
  costoMensual: (barberos) => {
    const n = Math.max(1, Math.floor(barberos));
    if (n === 1) return { monto: 239.95 };
    return { monto: n * 159.95 };
  },
  supuesto:
    "Tomamos el plan de una persona para un barbero solo, y el precio por miembro multiplicado por el tamaño del equipo a partir de dos, que es como Fresha publica el cobro en equipo.",
  masIva: false,
};

const AGENDAPRO: Competidor = {
  slug: "agendapro",
  nombre: "AgendaPro",
  resumen:
    "Agenda con escalones de precio por número de profesionales. No publica comisión por cliente, pero el WhatsApp se vende por paquetes aparte.",
  origen: "Opera en México",
  ejes: {
    precio: {
      texto: "$299, $550, $1,500 y $4,500 MXN al mes",
      fuenteId: "agendaproPrecios",
      nota: "Todos sus precios se publican + IVA. $299 es para 1 profesional y $550 para hasta 20.",
    },
    cobro: {
      texto: "Por escalones según el número de profesionales",
      fuenteId: "agendaproPrecios",
      nota: "+ IVA en los cuatro escalones.",
    },
    whatsapp: {
      texto: "Se vende por paquetes aparte, desde $100 MXN por 50 mensajes",
      fuenteId: "agendaproPrecios",
      nota: "No está incluido en la mensualidad.",
    },
    comision: {
      texto: "No publican comisión por cliente",
      fuenteId: "agendaproPrecios",
    },
    mexico: {
      texto: "Sí, opera en México y publica precios en pesos",
      fuenteId: "agendaproPrecios",
    },
  },
  fortalezas: [
    "No cobra comisión por cliente. En eso están del mismo lado que nosotros y en contra de los marketplaces.",
    "Su escalera de precios llega hasta $4,500 MXN al mes, así que está pensada también para operaciones bastante más grandes que una barbería de barrio.",
  ],
  fortalezasCalculadas: (planes) => {
    const top = planTope(planes);
    if (!top) return [];
    // Su escalón de hasta 20 profesionales, YA con IVA, contra nuestro plan
    // más caro. Si les sale más barato, se dice. El número nuestro sale de
    // la tabla, nunca escrito a mano.
    const suyoConIva = 550 * 1.16;
    if (suyoConIva < top.priceMonthly) {
      return [
        `Con un equipo grande su precio por persona es difícil de igualar: su escalón de hasta 20 profesionales cuesta $550 MXN + IVA, que son unos ${formatBarberPrice(
          Math.round(suyoConIva),
        )} ya con IVA — por debajo de nuestro plan ${top.name}, de ${formatBarberPrice(
          top.priceMonthly,
        )}. Si tienes cerca de 20 barberos y no te importa pagar el WhatsApp aparte, AgendaPro te sale más barato de suscripción.`,
      ];
    }
    return [];
  },
  ventajas: [
    "El WhatsApp va incluido en el plan. Con ellos, 50 mensajes cuestan $100 MXN aparte cada vez que se te acaban.",
    "Nuestros precios se publican tal cual se cobran; los suyos van + IVA, así que el cargo real es un 16% mayor que el número de su página.",
    "Estamos hechos para barbería y nada más: fila virtual, comisiones de barbero, propinas y corte de caja vienen de fábrica, sin configurar nada.",
  ],
  reportanUsuarios: [],
  costoMensual: (barberos) => {
    const n = Math.max(1, Math.floor(barberos));
    if (n <= 1) return { monto: 299, nota: "+ IVA" };
    if (n <= 20) return { monto: 550, nota: "+ IVA" };
    return { monto: 1500, nota: "+ IVA" };
  },
  supuesto:
    "Usamos sus escalones publicados: $299 para 1 profesional, $550 hasta 20 y $1,500 por encima de eso. Los tres van + IVA, así que el cargo real es mayor.",
  masIva: true,
};

export const COMPETIDORES: Competidor[] = [BOOKSY, FRESHA, AGENDAPRO];

export function getCompetidor(slug: string): Competidor | null {
  return COMPETIDORES.find((c) => c.slug === slug) ?? null;
}

export const COMPETIDOR_SLUGS: string[] = COMPETIDORES.map((c) => c.slug);

// ── Competidores del panorama (sólo en el índice, sin página propia) ────
// Van aquí porque alguien que compara merece ver el mapa completo, aunque
// no tengamos una página para cada uno. Mismos requisitos de fuente.

export interface CompetidorBreve {
  nombre: string;
  precio: string;
  origen: string;
  nota: string;
  fuenteId: string;
}

export const PANORAMA: CompetidorBreve[] = [
  {
    nombre: "Squire",
    precio: "De 30 a 250 USD al mes",
    origen: "Estados Unidos",
    nota: "No opera en México, así que hoy no es una alternativa real aquí. Sus precios están en dólares, no en pesos.",
    fuenteId: "squirePrecios",
  },
  {
    nombre: "Amyra",
    precio: "$2,499 y $4,499 MXN al mes",
    origen: "México",
    nota: "Producto mexicano. Es el escalón de precio más alto de esta lista.",
    fuenteId: "amyraPrecios",
  },
  {
    nombre: "BarberLab",
    precio: "$349, $649 y $999 MXN al mes",
    origen: "México",
    nota: "Producto mexicano enfocado en barbería. Sus recordatorios son sólo por correo, no por WhatsApp.",
    fuenteId: "barberlabPrecios",
  },
];

// ═══════════════════════════════════════════════════════════════════════
// NUESTRO LADO DE LA TABLA — todo se deriva de barber_plan_configs.
// Ni un número escrito a mano de este lado.
// ═══════════════════════════════════════════════════════════════════════

/** Planes activos, en orden. Si la tabla los tuviera todos inactivos, se
 *  usan todos: mejor enseñar precios que enseñar una tabla vacía. */
export function planesVisibles(planes: BarberResolvedPlan[]): BarberResolvedPlan[] {
  const activos = planes.filter((p) => p.isActive);
  return activos.length > 0 ? activos : planes;
}

function planEntrada(planes: BarberResolvedPlan[]): BarberResolvedPlan | null {
  const vis = planesVisibles(planes);
  if (vis.length === 0) return null;
  return vis.reduce((min, p) => (p.priceMonthly < min.priceMonthly ? p : min), vis[0]);
}

function planTope(planes: BarberResolvedPlan[]): BarberResolvedPlan | null {
  const vis = planesVisibles(planes);
  if (vis.length === 0) return null;
  return vis.reduce((max, p) => (p.priceMonthly > max.priceMonthly ? p : max), vis[0]);
}

/** El plan más barato que cubre a N barberos. null si ninguno alcanza. */
export function planParaBarberos(
  planes: BarberResolvedPlan[],
  barberos: number,
): BarberResolvedPlan | null {
  const n = Math.max(1, Math.floor(barberos));
  const caben = planesVisibles(planes)
    .filter((p) => isBarberUnlimited(p.maxBarbers) || p.maxBarbers >= n)
    .sort((a, b) => a.priceMonthly - b.priceMonthly);
  return caben[0] ?? null;
}

/** "$X a $Y al mes" — el rango VIVO de la tabla. Sin números a mano: si el
 *  admin mueve un precio en barber_plan_configs, aquí cambia solo. */
export function rangoPrecios(planes: BarberResolvedPlan[]): string {
  const min = planEntrada(planes);
  const max = planTope(planes);
  if (!min || !max) return "";
  if (min.priceMonthly === max.priceMonthly) return `${formatBarberPrice(min.priceMonthly)} al mes`;
  return `${formatBarberPrice(min.priceMonthly)} a ${formatBarberPrice(max.priceMonthly)} al mes`;
}

/** Cómo cobramos, dicho con los límites vivos de la tabla. */
export function textoCobro(planes: BarberResolvedPlan[]): string {
  const vis = planesVisibles(planes);
  const ilimitado = vis.find((p) => isBarberUnlimited(p.maxBarbers));
  const topeFinito = vis
    .filter((p) => !isBarberUnlimited(p.maxBarbers))
    .reduce<number>((m, p) => Math.max(m, p.maxBarbers), 0);
  if (ilimitado) {
    return `Por plan, no por barbero. Hasta ${topeFinito} barberos en los planes intermedios y sin límite en ${ilimitado.name}.`;
  }
  if (topeFinito > 0) return `Por plan, no por barbero. Hasta ${topeFinito} barberos.`;
  return "Por plan, no por barbero.";
}

/** El WhatsApp incluido, dicho con las cuotas vivas de la tabla. */
export function textoWhatsapp(planes: BarberResolvedPlan[]): string {
  const vis = planesVisibles(planes);
  if (vis.length === 0) return "";
  const ilimitado = vis.find((p) => isBarberUnlimited(p.messageQuota));
  const finitas = vis.filter((p) => !isBarberUnlimited(p.messageQuota)).map((p) => p.messageQuota);
  const min = finitas.length > 0 ? Math.min(...finitas) : null;
  const max = finitas.length > 0 ? Math.max(...finitas) : null;
  if (ilimitado && min !== null) {
    return `De ${min} mensajes al mes incluidos en el plan de entrada, sin límite en ${ilimitado.name}. Van en el precio, no se venden por paquete.`;
  }
  if (ilimitado) return `Mensajes sin límite en ${ilimitado.name}, incluidos en el precio.`;
  if (min !== null && max !== null && min !== max) {
    return `De ${min} a ${max} mensajes al mes incluidos según el plan. Van en el precio, no se venden por paquete.`;
  }
  if (min !== null) return `${min} mensajes al mes incluidos en el precio.`;
  return "";
}

/** Nuestra fila de la tabla para cada eje. Sólo `comision` y `mexico` son
 *  texto fijo, y son hechos de nuestro propio producto, no precios. */
export function nuestroEje(eje: EjeId, planes: BarberResolvedPlan[]): string {
  switch (eje) {
    case "precio":
      return rangoPrecios(planes);
    case "cobro":
      return textoCobro(planes);
    case "whatsapp":
      return textoWhatsapp(planes);
    case "comision":
      return "Ninguna. No cobramos comisión por cliente.";
    case "mexico":
      return "Hecho en México, precios en pesos y soporte en español.";
    default:
      return "";
  }
}

// ── Escenarios: el cálculo a la vista ───────────────────────────────────

export interface Escenario {
  barberos: number;
  /** Lo que costaría su suscripción, ya formateado. */
  ellos: string;
  /** "+ IVA" u otra aclaración de su lado. */
  ellosNota?: string;
  /** Lo que costaría la nuestra, ya formateado. */
  nosotros: string;
  /** El plan nuestro que cubre a ese equipo. */
  nosotrosPlan: string;
}

/** Tamaños de equipo del cuadro comparativo. Uno solo, chico y mediano. */
export const ESCENARIOS_BARBEROS = [1, 3, 8];

/**
 * Cuánto cuesta al mes cada suscripción para N barberos.
 *
 * ⚠️ SÓLO SUSCRIPCIÓN. Las comisiones de marketplace no entran aquí porque
 * dependen de cuántos clientes lleguen por ahí; la UI lo dice al pie.
 */
export function escenarios(
  competidor: Competidor,
  planes: BarberResolvedPlan[],
): Escenario[] {
  return ESCENARIOS_BARBEROS.map((n) => {
    const suyo = competidor.costoMensual(n);
    const nuestro = planParaBarberos(planes, n);
    return {
      barberos: n,
      ellos: suyo.monto === null ? "No lo publican" : formatBarberPrice(suyo.monto),
      ellosNota: suyo.nota,
      nosotros: nuestro ? formatBarberPrice(nuestro.priceMonthly) : "Escríbenos",
      nosotrosPlan: nuestro ? nuestro.name : "A la medida",
    };
  });
}
