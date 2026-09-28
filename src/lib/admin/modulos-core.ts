/**
 * Módulos contratados por clínica, vistos desde /admin: QUÉ clínica tiene cada
 * módulo, CÓMO lo paga y CUÁNTO aporta al mes. Puro y sin dependencias (por eso
 * es `-core`, como mrr-core): se prueba sin base de datos con
 *
 *   npx tsx --test src/lib/admin/modulos-core.test.ts
 *
 * La carga desde Prisma vive en `./modulos.ts`.
 *
 * DE DÓNDE SALEN LOS IMPORTES: de `clinic_modules.price_paid_mxn`, que es lo
 * que la clínica pagó de verdad (el subtotal de Stripe, sin IVA), nunca del
 * precio de catálogo ni de un número escrito aquí. Una cortesía de admin se
 * guarda con 0 y vale 0.
 */

/** Cómo llegó el módulo a la clínica. */
export type OrigenModulo = "tarjeta" | "pago-unico" | "cortesia" | "paypal" | "otro";

/** En qué está hoy. */
export type EstadoModulo =
  | "activo"
  /** Tarjeta con la baja pedida: sigue activo hasta el fin del periodo y no se vuelve a cobrar. */
  | "baja-programada"
  /** Stripe no pudo cobrar y sigue reintentando: la clínica no tiene acceso. */
  | "cobro-fallido"
  /** Figura como activo pero su periodo ya terminó (pago único que no se renovó). */
  | "vencido"
  | "cancelado";

/** Lo que hace falta de una fila de `clinic_modules` (más el nombre del módulo). */
export interface FilaModulo {
  clinicId: string;
  moduleKey: string;
  moduleName: string;
  status: string;
  paymentMethod: string;
  billingCycle: string;
  pricePaidMxn: number;
  currentPeriodEnd: Date | string;
  /** Tiene `stripeSubscriptionId`: hay una suscripción que cobra sola. */
  tieneSuscripcionStripe: boolean;
  /** La baja al fin del periodo ya está pedida (según la bitácora). */
  bajaProgramada?: boolean;
}

function ms(d: Date | string): number {
  const t = (d instanceof Date ? d : new Date(d)).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function origenModulo(fila: Pick<FilaModulo, "paymentMethod">): OrigenModulo {
  switch (fila.paymentMethod) {
    case "admin":  return "cortesia";
    case "card":
    case "stripe": return "tarjeta";
    case "spei":
    case "oxxo":   return "pago-unico";
    case "paypal": return "paypal";
    default:       return "otro";
  }
}

export const ETIQUETA_ORIGEN: Record<OrigenModulo, string> = {
  "tarjeta":    "Tarjeta (Stripe)",
  "pago-unico": "SPEI/OXXO · pago único",
  "cortesia":   "Cortesía de admin",
  "paypal":     "PayPal",
  "otro":       "Origen desconocido",
};

export const ETIQUETA_ESTADO_MODULO: Record<EstadoModulo, string> = {
  "activo":          "Activo",
  "baja-programada": "Baja programada",
  "cobro-fallido":   "Cobro fallido",
  "vencido":         "Vencido",
  "cancelado":       "Apagado",
};

export function estadoModulo(
  fila: Pick<FilaModulo, "status" | "currentPeriodEnd" | "bajaProgramada" | "paymentMethod" | "tieneSuscripcionStripe">,
  ahora: Date,
): EstadoModulo {
  if (fila.status === "paused") return "cobro-fallido";
  if (fila.status !== "active") return "cancelado";
  if (ms(fila.currentPeriodEnd) <= ahora.getTime()) return "vencido";
  if (fila.bajaProgramada && fila.tieneSuscripcionStripe && origenModulo(fila) === "tarjeta") return "baja-programada";
  return "activo";
}

/** ¿La clínica puede usar el módulo ahora mismo? Mismo criterio que `hasActiveAccess`. */
export function moduloVigente(fila: Pick<FilaModulo, "status" | "currentPeriodEnd">, ahora: Date): boolean {
  return fila.status === "active" && ms(fila.currentPeriodEnd) > ahora.getTime();
}

/** Lo pagado por el periodo, llevado a un mes: el anual se reparte entre 12. */
export function importeMensual(pagado: number, ciclo: string): number {
  const mensual = ciclo === "annual" ? pagado / 12 : pagado;
  return Math.round(mensual * 100) / 100;
}

/**
 * Cuánto aporta al mes. Solo cuenta un módulo vigente y pagado: una cortesía
 * vale 0, un cobro fallido no suma (igual que una clínica `past_due` no suma al
 * MRR de planes) y un pago anual se reparte entre 12.
 */
export function aporteMensualModulo(fila: FilaModulo, ahora: Date): number {
  if (!moduloVigente(fila, ahora)) return 0;
  if (origenModulo(fila) === "cortesia") return 0;
  const pagado = Number(fila.pricePaidMxn ?? 0);
  if (!(pagado > 0)) return 0;
  return importeMensual(pagado, fila.billingCycle);
}

// ── MRR de módulos ─────────────────────────────────────────────────────────

export interface LineaMrrModulo {
  moduleKey: string;
  moduleName: string;
  /** Clínicas que lo tienen vigente, paguen o no. */
  clinicas: number;
  /** De esas, las que pagan. */
  pagando: number;
  /** De esas, las que lo tienen de cortesía. */
  cortesia: number;
  total: number;
}

export interface MrrModulos {
  total: number;
  /** Clínicas distintas que pagan al menos un módulo. */
  clinicasPagando: number;
  porModulo: LineaMrrModulo[];
}

export const MRR_MODULOS_VACIO: MrrModulos = { total: 0, clinicasPagando: 0, porModulo: [] };

/**
 * EL cálculo del MRR de módulos. `clinicasQueCuentan` es el mismo universo del
 * MRR de planes (clínicas no archivadas): un módulo de una clínica archivada no
 * suma. Si no se pasa, cuentan todas las filas.
 */
export function computeMrrModulos(
  filas: FilaModulo[],
  ahora: Date,
  clinicasQueCuentan?: ReadonlySet<string>,
): MrrModulos {
  const lineas = new Map<string, LineaMrrModulo>();
  const pagadoras = new Set<string>();
  let total = 0;

  for (const fila of filas) {
    if (clinicasQueCuentan && !clinicasQueCuentan.has(fila.clinicId)) continue;
    if (!moduloVigente(fila, ahora)) continue;
    let linea = lineas.get(fila.moduleKey);
    if (!linea) {
      linea = { moduleKey: fila.moduleKey, moduleName: fila.moduleName, clinicas: 0, pagando: 0, cortesia: 0, total: 0 };
      lineas.set(fila.moduleKey, linea);
    }
    const aporte = aporteMensualModulo(fila, ahora);
    linea.clinicas += 1;
    if (aporte > 0) {
      linea.pagando += 1;
      linea.total = Math.round((linea.total + aporte) * 100) / 100;
      total = Math.round((total + aporte) * 100) / 100;
      pagadoras.add(fila.clinicId);
    } else if (origenModulo(fila) === "cortesia") {
      linea.cortesia += 1;
    }
  }

  return {
    total,
    clinicasPagando: pagadoras.size,
    porModulo: Array.from(lineas.values()).sort(
      (a, b) => b.total - a.total || a.moduleName.localeCompare(b.moduleName, "es"),
    ),
  };
}

/** «2 Ortodoncia (1 de cortesía)» — la línea que explica el MRR de módulos. */
export function resumenMrrModulos(mrr: MrrModulos): string {
  if (!mrr.porModulo.length) return "Ninguna clínica con módulos";
  return mrr.porModulo
    .map((l) => `${l.clinicas} ${l.moduleName}${l.cortesia > 0 ? ` (${l.cortesia} de cortesía)` : ""}`)
    .join(" · ");
}

// ── Lo que se enseña de cada módulo de una clínica ─────────────────────────

export interface ModuloDeClinica {
  moduleKey: string;
  moduleName: string;
  estado: EstadoModulo;
  origen: OrigenModulo;
  /** Lo que pagó por el periodo (mensual o anual), sin IVA. 0 en una cortesía. */
  pagado: number;
  ciclo: "monthly" | "annual";
  /** Lo que aporta al mes (el anual, entre 12). 0 si no paga o no está vigente. */
  aporteMensual: number;
  /** Fin del periodo vigente. `null` en una cortesía (no vence). */
  hasta: string | null;
}

/** Los módulos que una clínica tiene o tuvo, los vigentes primero. */
export function modulosDeClinica(filas: FilaModulo[], ahora: Date): ModuloDeClinica[] {
  const orden: Record<EstadoModulo, number> = {
    "activo": 0, "baja-programada": 1, "cobro-fallido": 2, "vencido": 3, "cancelado": 4,
  };
  return filas
    .map((fila): ModuloDeClinica => {
      const origen = origenModulo(fila);
      return {
        moduleKey: fila.moduleKey,
        moduleName: fila.moduleName,
        estado: estadoModulo(fila, ahora),
        origen,
        pagado: origen === "cortesia" ? 0 : Number(fila.pricePaidMxn ?? 0),
        ciclo: fila.billingCycle === "annual" ? "annual" : "monthly",
        aporteMensual: aporteMensualModulo(fila, ahora),
        hasta: origen === "cortesia" ? null : new Date(ms(fila.currentPeriodEnd)).toISOString(),
      };
    })
    .sort((a, b) => orden[a.estado] - orden[b.estado] || a.moduleName.localeCompare(b.moduleName, "es"));
}

/** Los que cuentan para «esta clínica tiene módulos»: todo menos lo apagado y lo vencido. */
export function modulosEnUso(modulos: ModuloDeClinica[]): ModuloDeClinica[] {
  return modulos.filter((m) => m.estado !== "cancelado" && m.estado !== "vencido");
}

// ── Apagar desde /admin ────────────────────────────────────────────────────

/**
 * Qué pasa al apagar un módulo desde /admin (decisión del 28-sep-2026):
 *  · de cortesía → se apaga en el momento;
 *  · pagado con tarjeta → NO se apaga: se pide a Stripe la baja al fin del
 *    periodo ya pagado. La clínica lo conserva hasta esa fecha y no se le
 *    vuelve a cobrar; la baja real la marca el webhook cuando Stripe cierra;
 *  · tarjeta con el cobro fallido → se cancela la suscripción ya (Stripe deja
 *    de reintentar) y se apaga;
 *  · pago único (SPEI/OXXO) → se apaga en el momento, y la clínica pierde el
 *    tiempo que ya pagó: por eso pide confirmación aparte.
 */
export type PlanDeApagado =
  | { tipo: "nada"; motivo: "ya-apagado" }
  | { tipo: "inmediato"; motivo: "cortesia" | "pago-unico" | "sin-suscripcion"; pierdeHasta: string | null }
  | { tipo: "fin-de-periodo"; hasta: string; yaProgramada: boolean }
  | { tipo: "cancelar-en-stripe-ya" };

export function planDeApagado(
  fila: Pick<FilaModulo, "status" | "paymentMethod" | "currentPeriodEnd" | "tieneSuscripcionStripe" | "bajaProgramada">,
  ahora: Date,
): PlanDeApagado {
  if (fila.status !== "active" && fila.status !== "paused") return { tipo: "nada", motivo: "ya-apagado" };
  const origen = origenModulo(fila);
  const conSuscripcion = fila.tieneSuscripcionStripe && origen !== "cortesia";

  if (fila.status === "paused") {
    return conSuscripcion
      ? { tipo: "cancelar-en-stripe-ya" }
      : { tipo: "inmediato", motivo: "sin-suscripcion", pierdeHasta: null };
  }

  const vigente = ms(fila.currentPeriodEnd) > ahora.getTime();
  const hasta = new Date(ms(fila.currentPeriodEnd)).toISOString();
  if (conSuscripcion) {
    // Con el periodo ya vencido no queda nada que conservar: se cancela ya.
    if (!vigente) return { tipo: "cancelar-en-stripe-ya" };
    return { tipo: "fin-de-periodo", hasta, yaProgramada: fila.bajaProgramada === true };
  }
  if (origen === "cortesia") return { tipo: "inmediato", motivo: "cortesia", pierdeHasta: null };
  if (origen === "pago-unico") return { tipo: "inmediato", motivo: "pago-unico", pierdeHasta: vigente ? hasta : null };
  return { tipo: "inmediato", motivo: "sin-suscripcion", pierdeHasta: vigente ? hasta : null };
}

/**
 * Qué pasa al ENCENDER un módulo desde /admin:
 *  · sin fila, apagado o vencido → cortesía de admin;
 *  · tarjeta con la baja programada → se deshace la baja en Stripe (sigue
 *    pagando como antes). Darle una cortesía encima dejaría a Stripe cobrando
 *    un módulo que la base da por regalado;
 *  · tarjeta con el cobro fallido → no se puede: primero hay que cancelar esa
 *    suscripción (si no, Stripe sigue reintentando por debajo de la cortesía);
 *  · ya activo → nada.
 */
export type PlanDeEncendido =
  | { tipo: "cortesia" }
  | { tipo: "deshacer-baja" }
  | { tipo: "bloqueado"; motivo: "cobro-fallido-con-suscripcion" }
  | { tipo: "nada"; motivo: "ya-activo" };

export function planDeEncendido(
  fila: Pick<FilaModulo, "status" | "paymentMethod" | "currentPeriodEnd" | "tieneSuscripcionStripe" | "bajaProgramada"> | null,
  ahora: Date,
): PlanDeEncendido {
  if (!fila) return { tipo: "cortesia" };
  const conSuscripcion = fila.tieneSuscripcionStripe && origenModulo(fila) !== "cortesia";
  if (fila.status === "paused" && conSuscripcion) return { tipo: "bloqueado", motivo: "cobro-fallido-con-suscripcion" };
  if (fila.status === "active" && ms(fila.currentPeriodEnd) > ahora.getTime()) {
    if (conSuscripcion && fila.bajaProgramada) return { tipo: "deshacer-baja" };
    return { tipo: "nada", motivo: "ya-activo" };
  }
  return { tipo: "cortesia" };
}

// ── La baja programada, leída de la bitácora ───────────────────────────────

/** Acciones que dejan en la bitácora la ruta de la clínica y la de /admin. */
export const ACCION_BAJA_PROGRAMADA = "cancel_at_period_end";
export const ACCION_BAJA_DESHECHA = "resume";

export interface FilaBitacoraSuscripcion {
  /** `entityId` de la fila: el id de la suscripción de Stripe. */
  entityId: string;
  createdAt: Date | string;
  changes: unknown;
}

function accionDe(changes: unknown): string | null {
  if (!changes || typeof changes !== "object") return null;
  const fuente = (changes as Record<string, unknown>)._source;
  if (!fuente || typeof fuente !== "object") return null;
  const after = (fuente as Record<string, unknown>).after;
  if (!after || typeof after !== "object") return null;
  const accion = (after as Record<string, unknown>).action;
  return typeof accion === "string" ? accion : null;
}

/**
 * Las suscripciones con la baja al fin del periodo PEDIDA y no deshecha. No hay
 * columna para eso en `clinic_modules`, así que se lee de la bitácora: manda la
 * última fila de cada suscripción que sea un pedido de baja o un deshacer.
 *
 * Es lo que DaleControl pidió; si alguien cambió la suscripción directamente en
 * el panel de Stripe, aquí no se ve.
 */
export function suscripcionesConBajaProgramada(filas: FilaBitacoraSuscripcion[]): Set<string> {
  const ultima = new Map<string, { at: number; accion: string }>();
  for (const f of filas) {
    const accion = accionDe(f.changes);
    if (accion !== ACCION_BAJA_PROGRAMADA && accion !== ACCION_BAJA_DESHECHA) continue;
    const at = ms(f.createdAt);
    const previa = ultima.get(f.entityId);
    if (!previa || at >= previa.at) ultima.set(f.entityId, { at, accion });
  }
  const out = new Set<string>();
  ultima.forEach((v, id) => {
    if (v.accion === ACCION_BAJA_PROGRAMADA) out.add(id);
  });
  return out;
}
