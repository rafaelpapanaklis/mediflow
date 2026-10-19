import { ACTIVE_SUBSCRIPTION_STATUSES, PAYMENT_FAILED_STATUSES } from "@/lib/plan-status";
import { fechaHoraPanel } from "@/lib/formato-fecha-panel";

/**
 * COBRO RECHAZADO DEL PLAN — reglas puras (ws1-t1, 19-oct-2026).
 *
 * Decisión de Rafael: cuando el banco rechaza la renovación del plan, la clínica conserva el acceso
 * 24 HORAS contadas desde el PRIMER rechazo de ese cobro. Pasadas, `isPlanExpired` la deja en la
 * pantalla de pago hasta que pague. Nada se borra: solo se cierra la puerta.
 *
 * Caso real (BEVADENT, 19-oct-2026): Stripe abrió el periodo nuevo (`subscription.updated` active →
 * trialEndsAt = 19-nov) un instante ANTES de que BBVA rechazara el cobro, y el rechazo solo marcaba
 * `past_due`: la clínica quedaba con 30 días de acceso sin haber pagado.
 *
 * Todo lo de aquí es puro (sin base ni Stripe) para fijarlo con tests; el webhook solo lo aplica.
 */

/** Horas de gracia desde el primer cobro rechazado. UNA constante: si Rafael la cambia, se cambia aquí. */
export const GRACIA_COBRO_RECHAZADO_HORAS = 24;

const HORA_MS = 3_600_000;
const DIA_MS = 86_400_000;

function aFecha(valor: Date | string | null | undefined): Date | null {
  if (valor === null || valor === undefined) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Hasta cuándo dura la gracia de un cobro que se rechazó en `rechazoEn`. */
export function finDeGracia(rechazoEn: Date): Date {
  return new Date(rechazoEn.getTime() + GRACIA_COBRO_RECHAZADO_HORAS * HORA_MS);
}

/**
 * El «acceso hasta» (`trialEndsAt`) que deja un `invoice.payment_failed` de la suscripción del PLAN.
 * Devuelve `undefined` cuando NO hay que tocar la fecha.
 *
 *  · Clínica al corriente (active / trialing / paid) → es el PRIMER rechazo del ciclo: el acceso baja a
 *    rechazo + 24 h. Se fija esa hora aunque la fecha actual sea anterior (el aviso del rechazo puede
 *    llegar antes que el `subscription.updated` que abre el periodo nuevo): la gracia es de 24 h desde
 *    el rechazo, no «lo que quedara».
 *  · Ya en past_due / unpaid → es un REINTENTO (o el mismo evento repetido): el acceso es el MENOR entre
 *    el actual y rechazo + 24 h. Un reintento nunca lo alarga ni lo reinicia; repetir el evento no cambia nada.
 *  · Cualquier otro estado (pending_payment, incomplete, cancelled…) → no se concede acceso que no tenía.
 */
export function accesoTrasCobroRechazado(args: {
  estadoActual: string | null | undefined;
  accesoActual: Date | string | null | undefined;
  rechazoEn: Date;
}): Date | undefined {
  const limite = finDeGracia(args.rechazoEn);
  const actual = aFecha(args.accesoActual);
  const estado = args.estadoActual ?? null;

  if (estado !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(estado)) return limite;

  if (estado !== null && PAYMENT_FAILED_STATUSES.has(estado)) {
    if (!actual) return limite;
    return actual.getTime() <= limite.getTime() ? undefined : limite;
  }
  return undefined;
}

/**
 * ¿Qué fechas escribe un `customer.subscription.created|updated` del PLAN? La fuente es el estado VIVO
 * de la suscripción en Stripe (`vivo`), no el del evento: el orden de entrega no está garantizado y un
 * `updated` «active» que llega DESPUÉS del `payment_failed` del mismo ciclo no debe regalar el periodo.
 *
 *  · Estado efectivo active/trialing → trialEndsAt = fin del periodo (renovación pagada o recuperada).
 *  · past_due / unpaid / canceled / incomplete → solo nextBillingDate (informativa); el acceso no se mueve.
 */
export function estadoEfectivoDeSuscripcion(args: {
  evento: string | null | undefined;
  vivo: string | null | undefined;
}): string | null {
  return args.vivo || args.evento || null;
}

/**
 * Si el estado vivo NO se pudo leer y se estaría por conceder un periodo a una clínica que está
 * cobro-rechazado, no se adivina: el webhook responde 5xx y Stripe reintenta el evento.
 */
export function debeReintentarPorEstadoVivo(args: {
  estadoActual: string | null | undefined;
  eventoStatus: string | null | undefined;
  vivo: string | null | undefined;
}): boolean {
  if (args.vivo) return false;
  const actual = args.estadoActual ?? null;
  const evento = args.eventoStatus ?? null;
  const clinicaRechazada = actual !== null && PAYMENT_FAILED_STATUSES.has(actual);
  const eventoConcede = evento === "active" || evento === "trialing";
  return clinicaRechazada && eventoConcede;
}

/**
 * Un `customer.subscription.updated` que ya trae la suscripción en `past_due` mientras la clínica sigue
 * al corriente en la base significa que su `invoice.payment_failed` aún no se procesó (orden de entrega
 * no garantizado). El que baja a past_due y fija la gracia de 24 h es SOLO ese: si lo hiciera el
 * `updated`, la clínica quedaría en past_due con el «acceso hasta» viejo y sin gracia.
 */
export function esperaAlRechazoDeFactura(args: {
  estadoActual: string | null | undefined;
  estadoNuevo: string | null | undefined;
}): boolean {
  const actual = args.estadoActual ?? null;
  return args.estadoNuevo === "past_due" && actual !== null && ACTIVE_SUBSCRIPTION_STATUSES.has(actual);
}

/**
 * Desde cuándo cuenta un periodo NUEVO que se acaba de pagar (reactivación o renovación anticipada).
 *
 * Es el máximo entre hoy, el fin de acceso y el próximo cobro… salvo cuando la clínica está en cobro
 * rechazado o cancelada: ahí `nextBillingDate` es el periodo que Stripe abrió y NO se pagó (BEVADENT:
 * 19-nov), y contarlo regalaba un mes más al reactivar. Solo cuenta lo que de verdad tenía pagado.
 */
export function inicioDeNuevoPeriodo(args: {
  ahora: Date;
  estadoAntes: string | null | undefined;
  trialEndsAt: Date | string | null | undefined;
  nextBillingDate: Date | string | null | undefined;
}): Date {
  const estado = args.estadoAntes ?? null;
  const proximoCobroSinPagar =
    estado !== null && (PAYMENT_FAILED_STATUSES.has(estado) || estado === "cancelled" || estado === "canceled");
  let base = args.ahora;
  const candidatas = proximoCobroSinPagar ? [args.trialEndsAt] : [args.nextBillingDate, args.trialEndsAt];
  for (const f of candidatas) {
    const d = aFecha(f);
    if (d && d.getTime() > base.getTime()) base = d;
  }
  return base;
}

/**
 * ¿Una clínica que pagó a mano (SPEI confirmado o activación del admin) queda cubierta frente a la factura
 * vieja de Stripe que sigue fallando? Sí si hay un pago manual registrado POSTERIOR a la creación de esa factura
 * (`subscription_invoices` pagada que no es de Stripe), o si su periodo pagado ya pasa del fin del periodo que
 * esa factura cubre (la activación del admin no deja fila, pero sí mueve las fechas más allá). Con un renovación
 * normal de tarjeta el acceso es IGUAL al fin del periodo facturado, nunca mayor: no cuenta como cubierta.
 * En ese caso el rechazo solo va a la bitácora: ni se recorta a 24 h ni se manda correo.
 */
export function pagoManualCubreLaFactura(args: {
  /** ¿Hay un pago manual (no Stripe) pagado después de crearse la factura que falla? */
  hayPagoManualPosterior: boolean;
  /** Fin del periodo que cubre la factura que falla; null si no se sabe. */
  finPeriodoFacturado: Date | null;
  accesoActual: Date | string | null | undefined;
  proximoCobro: Date | string | null | undefined;
}): boolean {
  if (args.hayPagoManualPosterior) return true;
  const fin = args.finPeriodoFacturado;
  if (!fin) return false;
  const limite = fin.getTime() + DIA_MS;
  return [args.accesoActual, args.proximoCobro].some((f) => {
    const d = aFecha(f);
    return !!d && d.getTime() > limite;
  });
}

/** ¿La factura es de la suscripción del PLAN de la clínica? Si alguna de las dos no se conoce, no se discute. */
export function esDeLaSuscripcionDelPlan(facturaSub: string | null | undefined, clinicaSub: string | null | undefined): boolean {
  if (!facturaSub || !clinicaSub) return true;
  return facturaSub === clinicaSub;
}

/**
 * Por qué un `invoice.payment_failed` del plan NO debe suspender (null = suspende). Solo suspende la factura
 * del plan que sigue ABIERTA en Stripe: pagada, anulada (void) o incobrable no; y tampoco si un pago manual
 * ya cubre a la clínica o si la factura es de otra suscripción.
 */
export function motivoParaNoSuspender(args: {
  esDelPlan: boolean;
  estadoVivoFactura: string | null;
  cubiertaPorPagoManual: boolean;
}): "otra_suscripcion" | "factura_no_abierta" | "pago_manual" | null {
  if (!args.esDelPlan) return "otra_suscripcion";
  if (args.estadoVivoFactura !== "open") return "factura_no_abierta";
  if (args.cubiertaPorPagoManual) return "pago_manual";
  return null;
}

/**
 * ¿La clínica ya era de las que pagan (al corriente o con un cobro rechazado antes)? Solo a esas se les manda el
 * aviso de «suspendida» cuando el rechazo llega con la gracia vencida; una cuenta nueva cuyo primer pago falló
 * no estuvo «suspendida por falta de pago».
 */
export function eraClinicaPagadora(estadoAntes: string | null | undefined): boolean {
  const e = estadoAntes ?? null;
  return e !== null && (ACTIVE_SUBSCRIPTION_STATUSES.has(e) || PAYMENT_FAILED_STATUSES.has(e));
}

/** Quién ve el botón de pagar en el aviso: dueño o administrador (misma regla que el cambio de plan). */
export type AvisoPagoRechazado =
  | { visible: false }
  | { visible: true; accesoHasta: Date; puedePagar: boolean };

/**
 * El aviso rojo del panel durante la gracia: past_due/unpaid CON acceso todavía vigente. Pasada la
 * gracia la clínica ya no ve el panel (la lleva a /dashboard/suspended), así que no hay aviso que pintar.
 */
export function avisoDePagoRechazado(args: {
  subscriptionStatus: string | null | undefined;
  trialEndsAt: Date | string | null | undefined;
  rol: string | null | undefined;
  ahora: Date;
}): AvisoPagoRechazado {
  const estado = args.subscriptionStatus ?? null;
  if (estado === null || !PAYMENT_FAILED_STATUSES.has(estado)) return { visible: false };
  const acceso = aFecha(args.trialEndsAt);
  if (!acceso || acceso.getTime() <= args.ahora.getTime()) return { visible: false };
  return { visible: true, accesoHasta: acceso, puedePagar: args.rol === "ADMIN" || args.rol === "SUPER_ADMIN" };
}

/**
 * La hora de suspensión, en el MISMO formato del panel (el de Caja: `fechaHoraPanel`, «6 oct 2026, 11:49 p.m.»)
 * y en la zona de la clínica. Con a.m./p.m. siempre: medianoche se lee «20 oct 2026, 12:00 a.m.» y mediodía
 * «20 oct 2026, 12:00 p.m.». Sin zona válida cae a Ciudad de México.
 */
export function fechaHoraDeLaClinica(fecha: Date, zona: string | null | undefined, locale: "es" | "en" = "es"): string {
  for (const tz of [zona, "America/Mexico_City"]) {
    if (!tz) continue;
    try {
      new Intl.DateTimeFormat("es-MX", { timeZone: tz });
    } catch {
      continue; // zona inválida: se intenta la siguiente
    }
    return fechaHoraPanel(fecha, tz, locale);
  }
  return fecha.toISOString();
}
