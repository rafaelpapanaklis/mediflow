// ═══════════════════════════════════════════════════════════════════════
// INICIO — la parte PURA: formas, semáforo y qué tarjeta va en cada modo.
//
// Vive separado de inicio.ts (que importa prisma) a propósito, y por la
// misma razón que lead-ui.ts está en components/: cualquier componente que
// importara de un módulo con prisma se llevaría el cliente de Prisma al
// bundle del navegador. Aquí no hay una sola importación de servidor, así
// que esto lo puede leer tanto la consulta como la pantalla.
//
// 🔴 EL EJE DEL PRODUCTO ES EL MODO, NO EL PLAN. La misma pantalla enseña
// tres negocios distintos:
//   · AGENCY — una inmobiliaria con equipo: embudo, visitas, cartera,
//     ranking, exclusivas y (si administra rentas) cobranza.
//   · AGENT  — un asesor solo: lo mismo pero SUYO, sin equipo ni ranking.
//   · OWNER  — un rentista: NADA de embudo ni comisiones. Cuánto cobra,
//     quién le debe, qué contrato vence, qué se descompuso y qué está vacío.
// Un rentista no tiene "prospectos"; enseñarle un embudo vacío sería decirle
// que le falta usar algo que no es de su negocio.
// ═══════════════════════════════════════════════════════════════════════
import type { RealtyMode } from "@/lib/realty/types";

/* ═══════════════════════════════════════════════════════════════════════
 * 1 · EL SEMÁFORO DEL PRIMER CONTACTO
 * ═══════════════════════════════════════════════════════════════════════ */

export type RealtyInicioUrgencia = "VERDE" | "AMARILLO" | "ROJO";

/**
 * 🔴 ESTE RELOJ NO ES EL DE `contactHeat` (components/realty/leads/lead-ui.ts)
 * Y NO DEBE UNIFICARSE CON ÉL. Miden dos cosas distintas:
 *
 *   · contactHeat mide CUÁNTO LLEVA SIN CONTACTO un prospecto que ya está
 *     en el embudo. Ahí una hora es normal y sus bandas (1 h / 24 h) están
 *     bien: un prospecto en etapa de OFERTA no se enfría en diez minutos.
 *   · esto mide el TIEMPO HASTA LA PRIMERA RESPUESTA de un prospecto que
 *     nadie ha tocado. Es el único tramo donde los minutos deciden si la
 *     persona contesta o ya le compró a otro: pasados diez minutos la
 *     probabilidad de contactarla se desploma. Con las bandas de una hora,
 *     un prospecto que lleva 45 minutos sin respuesta saldría EN VERDE —
 *     que es exactamente la mentira que esta pantalla existe para no decir.
 *
 * Por eso el Inicio tiene sus propias bandas, y por eso están aquí escritas
 * una sola vez con el motivo al lado.
 */
export const INICIO_VERDE_MIN = 5;
export const INICIO_ROJO_MIN = 10;

export function urgenciaPrimerContacto(minutos: number): RealtyInicioUrgencia {
  const m = Number.isFinite(minutos) ? Math.max(0, minutos) : 0;
  if (m < INICIO_VERDE_MIN) return "VERDE";
  if (m < INICIO_ROJO_MIN) return "AMARILLO";
  return "ROJO";
}

/** Minutos enteros entre dos instantes; nunca negativo, nunca NaN. */
export function minutosDesde(desde: Date | string, ahoraMs: number): number {
  const ms = typeof desde === "string" ? Date.parse(desde) : desde.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((ahoraMs - ms) / 60_000));
}

/**
 * "3 min", "2 h", "5 d" — la unidad más grande que ya se alcanzó.
 * Sin i18n a propósito: son números con una letra, iguales en los dos
 * idiomas, y meterlos al diccionario solo agrega una llave que se puede
 * quedar sin traducir (que es cómo se rompen estas pantallas).
 */
export function duracionCorta(minutos: number): string {
  const m = Math.max(0, Math.floor(minutos));
  if (m < 60) return `${m} min`;
  if (m < 60 * 48) return `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / (60 * 24))} d`;
}

/* ═══════════════════════════════════════════════════════════════════════
 * 2 · LAS FORMAS QUE VIAJAN DEL SERVIDOR A LA PANTALLA
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * CONVENCIÓN, y hay que respetarla en las tres formas:
 *   · `null`  = esta persona NO puede ver esto (plan o permiso). La tarjeta
 *               no se pinta.
 *   ·  0 / [] = sí lo ve y está vacío. La tarjeta se pinta CON SU VACÍO
 *               ÚTIL, que dice qué hacer.
 * Confundirlos es lo que produce el "cero mudo": un 0 grande que no
 * distingue "no tienes permiso" de "todavía no empiezas".
 */

export interface RealtyInicioProspectoFila {
  id: string;
  nombre: string;
  minutos: number;
  urgencia: RealtyInicioUrgencia;
  asesor: string | null;
}

export interface RealtyInicioProspectos {
  /** Sin primera respuesta y todavía vivos. */
  total: number;
  /** true = se llegó al tope de lectura; el total real es mayor. */
  truncado: boolean;
  verde: number;
  amarillo: number;
  rojo: number;
  /** Los más viejos primero: son los que hay que atender YA. */
  primeros: RealtyInicioProspectoFila[];
  /** ¿La cuenta tiene AL MENOS un prospecto, aunque esté atendido? */
  hayAlguno: boolean;
}

export interface RealtyInicioVisitaFila {
  id: string;
  hora: string;
  inmueble: string;
  donde: string | null;
  asesor: string | null;
  confirmada: boolean;
}

export interface RealtyInicioVisitas {
  total: number;
  /** true = el total se topó en el límite de lectura; hay más. */
  truncado: boolean;
  porConfirmar: number;
  proximas: RealtyInicioVisitaFila[];
}

export interface RealtyInicioInmuebles {
  total: number;
  publicados: number;
  /** Publicados SIN una sola foto: se ven en la web y no venden nada. */
  sinFotos: number;
}

export interface RealtyInicioRankingFila {
  userId: string;
  nombre: string;
  operaciones: number;
  comisionCents: number;
}

export interface RealtyInicioExclusivaFila {
  id: string;
  inmueble: string;
  dias: number;
}

export interface RealtyInicioCobranza {
  periodoLabel: string;
  moneda: string;
  /** Lo que falta por cobrar del periodo (cargado − pagado). */
  porCobrarCents: number;
  cargadoCents: number;
  /** Solo lo VENCIDO con saldo. */
  vencidoCents: number;
  vencidos: number;
}

export interface RealtyInicioDeudorFila {
  id: string;
  quien: string;
  inmueble: string;
  desde: string;
  diasTarde: number;
  saldoCents: number;
  moneda: string;
}

export interface RealtyInicioContratoFila {
  id: string;
  inmueble: string;
  dias: number;
}

export interface RealtyInicioMantenimientoFila {
  id: string;
  inmueble: string;
  dias: number;
  enProceso: boolean;
}

export interface RealtyInicioComisiones {
  periodoLabel: string;
  cobradoCents: number;
  porCobrarCents: number;
  operaciones: number;
}

/** Lo que la pantalla recibe. Un solo objeto, con el modo como discriminante. */
export interface RealtyInicioData {
  modo: RealtyMode;
  /** Nombre de pila para el saludo. Vacío si no lo hay. */
  nombre: string;
  /** true = la cuenta está estrenada: nada de nada. Cambia toda la pantalla. */
  recienLlegado: boolean;

  // ── Comercializar (AGENCY / AGENT). null = esta cuenta no comercializa. ──
  prospectos: RealtyInicioProspectos | null;
  visitas: RealtyInicioVisitas | null;
  tareasVencidas: number | null;
  ranking: RealtyInicioRankingFila[] | null;
  exclusivas: RealtyInicioExclusivaFila[] | null;
  exclusivasTruncado: boolean;
  comisiones: RealtyInicioComisiones | null;

  // ── Cartera (los tres modos). ──
  inmuebles: RealtyInicioInmuebles | null;

  // ── Administrar (sobre todo OWNER). ──
  cobranza: RealtyInicioCobranza | null;
  deudores: RealtyInicioDeudorFila[] | null;
  contratos: RealtyInicioContratoFila[] | null;
  contratosTruncado: boolean;
  mantenimientos: RealtyInicioMantenimientoFila[] | null;
  mantenimientosTruncado: boolean;
  vacias: number | null;

  /**
   * Lo que esta persona puede HACER, para la lista de arranque de una
   * cuenta nueva. Un paso que lleva a una pantalla cerrada no es un paso.
   */
  puede: {
    inmuebleNuevo: boolean;
    web: boolean;
    equipo: boolean;
    rentas: boolean;
  };
}

/* ═══════════════════════════════════════════════════════════════════════
 * 3 · QUÉ TARJETA VE QUIÉN
 * ═══════════════════════════════════════════════════════════════════════ */

export type RealtyInicioTarjetaKey =
  | "prospectos"
  | "visitas"
  | "tareas"
  | "inmuebles"
  | "ranking"
  | "exclusivas"
  | "comisiones"
  | "cobranza"
  | "deudores"
  | "contratos"
  | "mantenimientos"
  | "vacias";

/**
 * La tarjeta y la pantalla a la que lleva.
 *
 * 🔴 `navKey` NO es decorativo: es la llave del item de REALTY_NAV_ITEMS
 * que gobierna esa pantalla, y con ella el Inicio hereda el MISMO AND de
 * tres filtros (modo → feature del plan → permiso del rol) que el sidebar.
 * Sin eso, la tarjeta llevaría a una pantalla que la persona no puede
 * abrir: un clic hasta un redirect. Nadie vuelve a decidir esto con un if.
 */
export interface RealtyInicioTarjetaDef {
  key: RealtyInicioTarjetaKey;
  navKey: string;
  href: string;
  /** Modos en los que la tarjeta tiene sentido de negocio. */
  modos: RealtyMode[];
}

const COMERCIALIZAN: RealtyMode[] = ["AGENCY", "AGENT"];
const TODOS: RealtyMode[] = ["AGENCY", "AGENT", "OWNER"];

export const REALTY_INICIO_TARJETAS: RealtyInicioTarjetaDef[] = [
  { key: "prospectos", navKey: "prospectos", href: "/inmobiliaria/prospectos", modos: COMERCIALIZAN },
  { key: "visitas", navKey: "visitas", href: "/inmobiliaria/visitas", modos: COMERCIALIZAN },
  // Las tareas viven DENTRO del embudo, así que heredan su reja: quien no
  // ve prospectos tampoco tiene pendientes que atender ahí.
  { key: "tareas", navKey: "prospectos", href: "/inmobiliaria/prospectos", modos: COMERCIALIZAN },
  { key: "inmuebles", navKey: "inmuebles", href: "/inmobiliaria/inmuebles", modos: TODOS },
  // Ranking: SOLO AGENCY. Un asesor independiente no tiene contra quién
  // compararse, y enseñarle una tabla de una fila es ruido.
  { key: "ranking", navKey: "comisiones", href: "/inmobiliaria/comisiones", modos: ["AGENCY"] },
  { key: "exclusivas", navKey: "propietarios", href: "/inmobiliaria/propietarios", modos: COMERCIALIZAN },
  // Comisiones propias: la tarjeta del asesor solo. En AGENCY el equivalente
  // es el ranking, que ya sale arriba.
  { key: "comisiones", navKey: "comisiones", href: "/inmobiliaria/comisiones", modos: ["AGENT"] },
  { key: "cobranza", navKey: "cobranza", href: "/inmobiliaria/cobranza", modos: TODOS },
  { key: "deudores", navKey: "cobranza", href: "/inmobiliaria/cobranza", modos: TODOS },
  { key: "contratos", navKey: "rentas", href: "/inmobiliaria/rentas", modos: TODOS },
  { key: "mantenimientos", navKey: "cobranza", href: "/inmobiliaria/cobranza", modos: TODOS },
  { key: "vacias", navKey: "inmuebles", href: "/inmobiliaria/inmuebles", modos: ["OWNER"] },
];

export function tarjetaInicio(key: RealtyInicioTarjetaKey): RealtyInicioTarjetaDef {
  const def = REALTY_INICIO_TARJETAS.find((c) => c.key === key);
  if (!def) throw new Error(`Tarjeta de Inicio desconocida: ${key}`);
  return def;
}

/** ¿Esta tarjeta tiene sentido en este modo de cuenta? */
export function tarjetaAdmiteModo(key: RealtyInicioTarjetaKey, modo: RealtyMode): boolean {
  return tarjetaInicio(key).modos.includes(modo);
}

/** Las llaves de tarjeta de un modo, en el orden en que se pintan. */
export function tarjetasDeModo(modo: RealtyMode): RealtyInicioTarjetaKey[] {
  return REALTY_INICIO_TARJETAS.filter((c) => c.modos.includes(modo)).map((c) => c.key);
}

/* ═══════════════════════════════════════════════════════════════════════
 * 4 · DINERO
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Centavos → pesos, para una tarjeta. Sin centavos: en el Inicio nadie
 * concilia, y "$128,400" se lee de un vistazo donde "$128,400.00" no.
 */
export function pesosDeCentavos(cents: number, moneda = "MXN"): string {
  const n = Number.isFinite(cents) ? Math.round(cents) / 100 : 0;
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: moneda,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString("es-MX")}`;
  }
}
