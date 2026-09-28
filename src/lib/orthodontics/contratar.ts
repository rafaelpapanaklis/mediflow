/**
 * Contratar Ortodoncia (ws1-t3, 28-sep-2026) — las decisiones, sin base de
 * datos, sin Next y sin React, para poder probarlas solas.
 *
 * Decisión de Rafael: «que salga con candado y al darle click que salga el
 * precio mensual o anual con botón para cambiar. Y también TODO lo que
 * contiene, tal vez en categorías».
 *
 *  - En el menú, «Ortodoncia» sale SIEMPRE en clínicas dentales. Sin el
 *    módulo activo va con candado y lleva a la página de contratar.
 *  - El guardia de /dashboard/orthodontics/** manda a quien no tiene el
 *    módulo a esa página (antes lo mandaba a /dashboard, sin explicación).
 *  - Los precios se LEEN de la tabla `modules`; aquí solo se comparan.
 *
 * Quién usa esto: `src/app/dashboard/layout.tsx` (menú),
 * `src/app/dashboard/orthodontics/layout.tsx` (guardia),
 * `src/app/dashboard/orthodontics/contratar/page.tsx` (la página) y
 * `src/components/dashboard/sidebar-nav.ts` (a dónde lleva el candado).
 */

/** La página donde se contrata el módulo. Vive dentro de la ruta del módulo. */
export const RUTA_CONTRATAR_ORTODONCIA = "/dashboard/orthodontics/contratar";

/** A dónde entra quien SÍ tiene el módulo. */
export const RUTA_MODULO_ORTODONCIA = "/dashboard/orthodontics";

/** ¿La ruta es la página de contratar (o algo que cuelga de ella)? */
export function esRutaContratar(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const limpia = pathname.split(/[?#]/)[0].replace(/\/+$/, "");
  return limpia === RUTA_CONTRATAR_ORTODONCIA || limpia.startsWith(`${RUTA_CONTRATAR_ORTODONCIA}/`);
}

/* ── 1. El guardia de /dashboard/orthodontics/** ─────────────────────── */

export interface EntradaAlModulo {
  /** `clinic.category === "DENTAL"`. */
  esDental: boolean;
  /** Permiso UI `specialties.orthodontics`. */
  tienePermiso: boolean;
  /** `hasActiveOrthodonticsModule(clinicId)`: fila `ClinicModule` real y vigente. */
  moduloActivo: boolean;
  /** La ruta pedida (cabecera `x-pathname`). Vacía si no se pudo saber. */
  pathname: string | null | undefined;
}

export type DecisionEntrada =
  /** Se pinta el módulo, con su submenú. */
  | { tipo: "modulo" }
  /** Se pinta la página de contratar, sin submenú (no hay módulo que recorrer). */
  | { tipo: "contratar" }
  | { tipo: "redirigir"; a: string };

/**
 * Qué hace el layout del módulo con quien llega. En orden:
 *  1. Clínica no dental, o persona sin el permiso → a /dashboard, como siempre.
 *     Va ANTES que el módulo: a quien no puede ver Ortodoncia tampoco se le
 *     enseña cuánto cuesta.
 *  2. La página de contratar se pinta tenga o no el módulo (ella decide qué
 *     enseñar); nunca se redirige a sí misma.
 *  3. Sin módulo → a contratar. Si no se sabe qué ruta se pidió, a /dashboard:
 *     redirigir a contratar sin saber dónde estamos podría dar vueltas.
 */
export function decidirEntradaAlModulo(e: EntradaAlModulo): DecisionEntrada {
  if (!e.esDental || !e.tienePermiso) return { tipo: "redirigir", a: "/dashboard" };
  if (esRutaContratar(e.pathname)) return { tipo: "contratar" };
  if (e.moduloActivo) return { tipo: "modulo" };
  if (!e.pathname) return { tipo: "redirigir", a: "/dashboard" };
  return { tipo: "redirigir", a: RUTA_CONTRATAR_ORTODONCIA };
}

/* ── 2. El candado del menú ──────────────────────────────────────────── */

/**
 * Las llaves de módulo que el menú pinta CON CANDADO. Hoy solo Ortodoncia:
 * clínica dental, con plan vigente y sin el módulo activo. Una clínica
 * suspendida no ve candados: su menú es el reducido (Facturación + Soporte).
 */
export function modulosConCandado(e: {
  esDental: boolean;
  planVencido: boolean;
  ortodonciaActiva: boolean;
  llaveOrtodoncia: string;
}): string[] {
  if (!e.esDental || e.planVencido || e.ortodonciaActiva) return [];
  return [e.llaveOrtodoncia];
}

/* ── 3. Quién puede contratar ────────────────────────────────────────── */

/**
 * La misma regla que la pestaña «Suscripción» de Configuración
 * (`settings-client.tsx`): dueño o administrador. Los demás ven el precio y
 * lo que incluye, pero no el botón.
 */
export function puedeContratarModulos(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/* ── 4. El precio, leído de la base ──────────────────────────────────── */

export type CicloCobro = "monthly" | "annual";

export interface PreciosDelModulo {
  /** `modules.price_mxn_monthly`. */
  mensualMxn: number;
  /** `modules.price_mxn_annual`, o null si esa columna todavía no existe o va vacía. */
  anualMxn: number | null;
}

export interface ResumenDePrecios {
  /** Ciclos que se pueden ofrecer. Vacío = no hay nada que vender todavía. */
  ciclos: CicloCobro[];
  mensualMxn: number | null;
  anualMxn: number | null;
  /** Lo que se deja de pagar al año eligiendo anual, en pesos. 0 si no hay ahorro. */
  ahorroAnualMxn: number;
  /** El mismo ahorro, en por ciento entero. */
  ahorroPct: number;
  /** El anual repartido en doce meses, al peso. Solo para comparar, no se cobra así. */
  anualPorMesMxn: number | null;
}

/**
 * Compara los dos precios. NO inventa ninguno: si falta el anual, el ciclo
 * anual no se ofrece; si falta el mensual, tampoco. El ahorro sale de restar
 * los dos números de la base, no de un porcentaje escrito aquí.
 */
export function resumirPrecios(p: PreciosDelModulo | null): ResumenDePrecios {
  const mensual = p && Number.isFinite(p.mensualMxn) && p.mensualMxn > 0 ? p.mensualMxn : null;
  const anual = p && p.anualMxn != null && Number.isFinite(p.anualMxn) && p.anualMxn > 0 ? p.anualMxn : null;
  const ciclos: CicloCobro[] = [];
  if (mensual !== null) ciclos.push("monthly");
  if (anual !== null) ciclos.push("annual");

  let ahorroAnualMxn = 0;
  let ahorroPct = 0;
  if (mensual !== null && anual !== null) {
    const doceMeses = mensual * 12;
    if (anual < doceMeses) {
      ahorroAnualMxn = doceMeses - anual;
      ahorroPct = Math.round((ahorroAnualMxn / doceMeses) * 100);
    }
  }
  return {
    ciclos,
    mensualMxn: mensual,
    anualMxn: anual,
    ahorroAnualMxn,
    ahorroPct,
    anualPorMesMxn: anual !== null ? Math.round(anual / 12) : null,
  };
}

/** El ciclo con el que abre la página: el que pidió la URL si se puede, si no el primero disponible. */
export function cicloInicial(pedido: string | null | undefined, ciclos: readonly CicloCobro[]): CicloCobro | null {
  if (ciclos.length === 0) return null;
  const limpio = pedido === "anual" || pedido === "annual" ? "annual" : pedido === "mensual" || pedido === "monthly" ? "monthly" : null;
  if (limpio && ciclos.includes(limpio)) return limpio;
  return ciclos[0];
}

/** Pesos mexicanos sin centavos: «$1,316». */
export function pesos(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

/* ── 5. La vuelta de Stripe ──────────────────────────────────────────── */

export type EstadoCompra = "ok" | "pendiente" | "cancelada" | null;

/** Lo que dice `?compra=` al volver del checkout. Cualquier otra cosa se ignora. */
export function leerEstadoCompra(valor: string | string[] | null | undefined): EstadoCompra {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return v === "ok" || v === "pendiente" || v === "cancelada" ? v : null;
}

/* ── 6. Vista previa «sin módulo» (solo fuera de producción) ─────────── */

/**
 * La clínica de prueba TIENE el módulo, así que el candado y la página de
 * contratar no se podían ver en dev.108. Esta cookie hace que ESE navegador
 * vea la clínica como si no lo tuviera.
 *
 * Dos candados, a propósito:
 *  - Solo puede QUITAR el módulo a la vista, nunca darlo: `moduloActivoReal`
 *    en false se queda en false pase lo que pase.
 *  - En producción se ignora: `NODE_ENV === "production"` devuelve siempre
 *    lo real.
 * No toca la base ni el acceso de nadie más, y el checkout sigue mirando la
 * base de verdad (a esta clínica le contesta «ya tiene este módulo activo»).
 */
export const COOKIE_VISTA_PREVIA_SIN_MODULO = "dc-vista-previa-sin-ortodoncia";

export function vistaPreviaSinModulo(e: { nodeEnv: string | undefined; cookie: string | null | undefined }): boolean {
  if (e.nodeEnv === "production") return false;
  return e.cookie === "1";
}

export function moduloActivoALaVista(moduloActivoReal: boolean, vistaPrevia: boolean): boolean {
  return moduloActivoReal && !vistaPrevia;
}
