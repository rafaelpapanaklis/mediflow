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
 * `src/app/dashboard/contratar/ortodoncia/page.tsx` (la página) y
 * `src/components/dashboard/sidebar-nav.ts` (a dónde lleva el candado).
 */

/**
 * La página donde se contrata el módulo.
 *
 * ⚠ Vive FUERA de /dashboard/orthodontics a propósito, y no debe entrar ahí.
 * El guardia del módulo está en el layout de esa ruta, y en Next un layout NO
 * se vuelve a ejecutar al navegar entre páginas que cuelgan de él. Si esta
 * página colgara de ese layout, una clínica sin módulo lo dejaría montado y
 * desde aquí podría saltar al Tablero sin que el guardia corriera (pasó, y se
 * comprobó en vivo el 28-sep-2026). Fuera, el layout del módulo no se monta
 * nunca para quien no lo tiene.
 */
export const RUTA_CONTRATAR_ORTODONCIA = "/dashboard/contratar/ortodoncia";

/** A dónde entra quien SÍ tiene el módulo. */
export const RUTA_MODULO_ORTODONCIA = "/dashboard/orthodontics";

/* ── 1. Los dos guardias ─────────────────────────────────────────────── */

export interface QuienLlega {
  /** `clinic.category === "DENTAL"`. */
  esDental: boolean;
  /** Permiso UI `specialties.orthodontics`. */
  tienePermiso: boolean;
  /** `hasActiveOrthodonticsModule(clinicId)`: fila `ClinicModule` real y vigente. */
  moduloActivo: boolean;
}

export type Decision<T extends string> = { tipo: T } | { tipo: "redirigir"; a: string };

/**
 * El guardia de /dashboard/orthodontics/** (su layout). En orden:
 *  1. Clínica no dental, o persona sin el permiso → a /dashboard, como siempre.
 *     Va ANTES que el módulo: a quien no puede ver Ortodoncia tampoco se le
 *     enseña cuánto cuesta.
 *  2. Sin módulo → a la página de contratar (antes: a /dashboard, sin explicar).
 *  3. Con módulo → el módulo, como hoy.
 */
export function decidirEntradaAlModulo(e: QuienLlega): Decision<"modulo"> {
  if (!e.esDental || !e.tienePermiso) return { tipo: "redirigir", a: "/dashboard" };
  if (!e.moduloActivo) return { tipo: "redirigir", a: RUTA_CONTRATAR_ORTODONCIA };
  return { tipo: "modulo" };
}

/**
 * El guardia de la página de contratar (la propia página; una página SÍ se
 * ejecuta en cada visita). Mismas dos primeras reglas. Con el módulo ya
 * activo no hay nada que vender: al módulo. La única excepción es la vuelta
 * de pagar (`?compra=ok`), donde la página avisa y entra con carga completa.
 */
export function decidirEntradaAContratar(e: QuienLlega & { compra: EstadoCompra }): Decision<"contratar"> {
  if (!e.esDental || !e.tienePermiso) return { tipo: "redirigir", a: "/dashboard" };
  if (e.moduloActivo && e.compra !== "ok") return { tipo: "redirigir", a: RUTA_MODULO_ORTODONCIA };
  return { tipo: "contratar" };
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

/* ── 7. Cada sede se contrata aparte (ws1-t2, ronda 5) ────────────────── */

/** Una sede HERMANA del mismo dueño, con si ya tiene el módulo. Sin ningún dato de paciente. */
export interface SedeHermana {
  clinicId: string;
  nombre: string;
  /** `hasActiveOrthodonticsModule` de ESA sede. */
  activo: boolean;
}

/**
 * De las sedes propias del dueño (`getOwnedBranches`, en `contratar-sedes.ts`
 * — el I/O vive fuera de este archivo puro): quita la ACTUAL (su estado ya lo
 * enseña la tarjeta de precio) y las que no son dentales (Ortodoncia es un
 * módulo dental; una barbería del mismo dueño no tiene nada que contratar
 * aquí), y les pega si ya tienen el módulo activo.
 */
export function combinarSedesHermanas(
  propias: Array<{ clinicId: string; clinicName: string }>,
  clinicIdActual: string,
  categoriaPorId: Map<string, string | null | undefined>,
  activas: Set<string>,
): SedeHermana[] {
  return propias
    .filter((s) => s.clinicId !== clinicIdActual && categoriaPorId.get(s.clinicId) === "DENTAL")
    .map((s) => ({ clinicId: s.clinicId, nombre: s.clinicName, activo: activas.has(s.clinicId) }));
}
