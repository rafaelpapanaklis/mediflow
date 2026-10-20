/**
 * AGENDA FLEXIBLE (WS1-T5 · grupo Salamanca) — la parte PURA.
 *
 * Tres cosas que solo ven las clínicas con la bandera `agenda-flexible`
 * encendida (fila en `clinic_feature_flags`; sin fila = apagada):
 *
 *  1. SOBREAGENDAR. El equipo puede poner dos citas a la misma hora del mismo
 *     doctor o sillón, con un aviso antes de guardar. El servidor solo lo
 *     acepta con `sobreagendar: true` en la petición; la cita se guarda con
 *     `overrideReason` = `MARCA_SOBREAGENDADA` (el escape que ya saca una cita
 *     del índice de exclusión `appt_doctor_no_overlap`) y queda en la bitácora.
 *     El bot, la reserva web y Sabina NUNCA sobreagendan.
 *  2. COLOR POR PROCEDIMIENTO (ver `color-procedimiento.ts`).
 *  3. HORA DE COMIDA (ver `horario-doctor/core.ts` §3b).
 *
 * Client-safe: sin prisma, sin "server-only". Lo que toca la base vive en
 * `agenda-flexible.server.ts`.
 */
import type { Prisma } from "@prisma/client";

/** La bandera por clínica. Sin fila (o con `enabled = false`) = apagada. */
export const FLAG_AGENDA_FLEXIBLE = "agenda-flexible";

/**
 * El ajuste «Colorear las citas por: Procedimiento». Va en la misma tabla de
 * interruptores (una fila por clínica y función) para no añadir una columna a
 * `clinics`, que se lee sin `select` en el login. Sin fila = «Doctor», como
 * siempre. Solo cuenta si `FLAG_AGENDA_FLEXIBLE` está encendida.
 */
export const FLAG_COLOR_POR_PROCEDIMIENTO = "agenda-color-procedimiento";

/** Las filas que una sede nueva hereda de su principal (ver `branches/copia-sede-core.ts`). */
export const BANDERAS_AGENDA_FLEXIBLE = [FLAG_AGENDA_FLEXIBLE, FLAG_COLOR_POR_PROCEDIMIENTO] as const;

export type ModoColorCitas = "doctor" | "procedimiento";

/** Lo que la agenda necesita saber de la bandera. Todo apagado = la agenda de siempre. */
export interface AjustesAgendaFlexible {
  encendida: boolean;
  modoColor: ModoColorCitas;
}

export const AGENDA_FLEXIBLE_APAGADA: AjustesAgendaFlexible = { encendida: false, modoColor: "doctor" };

/** Las dos filas → los ajustes. Con la bandera apagada el color es siempre «Doctor». */
export function ajustesDesdeFilas(
  filas: readonly { flag: string; enabled: boolean }[] | null | undefined,
): AjustesAgendaFlexible {
  const encendida = (filas ?? []).some((f) => f.flag === FLAG_AGENDA_FLEXIBLE && f.enabled === true);
  if (!encendida) return AGENDA_FLEXIBLE_APAGADA;
  const porProcedimiento = (filas ?? []).some(
    (f) => f.flag === FLAG_COLOR_POR_PROCEDIMIENTO && f.enabled === true,
  );
  return { encendida: true, modoColor: porProcedimiento ? "procedimiento" : "doctor" };
}

// ═══════════════════════════════════════════════════════════════════════
// SOBREAGENDAR
// ═══════════════════════════════════════════════════════════════════════

/**
 * El `overrideReason` de una cita sobreagendada. 🔴 LO ESCRIBE EL SERVIDOR,
 * nunca el navegador: la pantalla manda `sobreagendar: true` y nada más.
 * Empieza por un prefijo fijo para que las puertas sin nadie mirando (bot,
 * web) puedan contarla como ocupada aunque la constraint ya no la vea.
 */
export const MARCA_SOBREAGENDADA = "Sobreagendada por el equipo";

export function esSobreagendada(overrideReason: string | null | undefined): boolean {
  return typeof overrideReason === "string" && overrideReason.startsWith(MARCA_SOBREAGENDADA);
}

/**
 * ¿La cita OCUPA su hueco? Para los `where` de Prisma de las puertas que no
 * pueden sobreagendar.
 *
 * La constraint (y por eso esas consultas) ignora las citas con
 * `overrideReason`. Una sobreagendada también la ignora: si la cita original
 * se cancela, la sobreagendada queda sola en ese hueco y el bot o la web lo
 * darían por libre. Con esto la cuentan como ocupada; la de un administrador
 * que forzó con su propio motivo sigue como antes.
 */
export function ocupaElHueco(): Prisma.AppointmentWhereInput {
  return {
    OR: [{ overrideReason: null }, { overrideReason: { startsWith: MARCA_SOBREAGENDADA } }],
  };
}

/** Con qué choca lo que se intenta guardar. */
export type TipoChoque = "doctor" | "sillon" | "comida";

/** El cuerpo del 409 que se puede sobreagendar (además de los campos de siempre). */
export interface CuerpoSobreagendable {
  error: "appointment_overlap" | "lunch_overlap";
  /** `true` = quien pidió puede confirmar y reenviar con `sobreagendar: true`. */
  sobreagendable: true;
  /** Con `lunch_overlap` (o si además pisa la comida): la comida del doctor ese día. */
  comida?: { lunchStart: string; lunchEnd: string } | null;
}

/**
 * La decisión del servidor ante un hueco ocupado (choque con otra cita o con
 * la comida del doctor):
 *  · `libre`        — no hay nada encima: se guarda como siempre.
 *  · `rechazar`     — hay algo y no se puede o no se pidió: 409 de siempre
 *                     (con `sobreagendable: true` si se pudiera confirmar).
 *  · `sobreagendar` — hay algo, la bandera está encendida y la petición lo
 *                     confirmó: se guarda y se deja rastro.
 */
export type DecisionSobreagenda = "libre" | "rechazar" | "sobreagendar";

export function decidirSobreagenda(args: {
  encendida: boolean;
  /** `body.sobreagendar === true`. */
  confirmado: boolean;
  hayChoque: boolean;
  pisaComida: boolean;
}): DecisionSobreagenda {
  if (!args.hayChoque && !args.pisaComida) return "libre";
  if (!args.encendida || !args.confirmado) return "rechazar";
  return "sobreagendar";
}

/**
 * 🔴 LA CONFIRMACIÓN VALE PARA LO QUE SE ENSEÑÓ, NO ES UN PERMISO EN BLANCO.
 *
 * La pantalla manda, junto a `sobreagendar: true`, el id de la cita que le
 * enseñó a la persona (`sobreagendarCita`; `null` si solo le enseñó la
 * comida). Si el servidor encuentra OTRA cita encima —una que la pantalla no
 * tenía cargada, o una que entró entre la pregunta y el guardado—, la
 * confirmación no vale para ella y se vuelve a preguntar con la que hay.
 */
export function confirmacionValida(args: {
  sobreagendar: unknown;
  sobreagendarCita: unknown;
  choqueId: string | null;
}): boolean {
  if (args.sobreagendar !== true) return false;
  if (!args.choqueId) return true;
  return args.sobreagendarCita === args.choqueId;
}

/** El tipo de choque que se le explica a la persona: primero la cita, luego la comida. */
export function tipoDeChoque(args: {
  conflicto?: { doctorId: string; resourceId: string | null } | null;
  intento: { doctorId?: string | null; resourceId?: string | null };
  pisaComida?: boolean;
}): TipoChoque {
  const c = args.conflicto;
  if (c) {
    const mismoDoctor = !!args.intento.doctorId && args.intento.doctorId === c.doctorId;
    if (!mismoDoctor && !!args.intento.resourceId && args.intento.resourceId === c.resourceId) return "sillon";
    return "doctor";
  }
  return args.pisaComida ? "comida" : "doctor";
}

/** El 409 que dice «se puede sobreagendar»: `sobreagendable` y la forma de siempre. */
export function esRechazoSobreagendable(body: unknown): body is CuerpoSobreagendable & {
  conflictingAppointment?: {
    id: string;
    patientName?: string | null;
    doctorId: string;
    resourceId: string | null;
    startsAt: string;
    endsAt: string;
    otras?: number;
  };
} {
  const b = body as { error?: unknown; sobreagendable?: unknown } | null;
  return (
    !!b &&
    b.sobreagendable === true &&
    (b.error === "appointment_overlap" || b.error === "lunch_overlap")
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EL AVISO «¿SEGURO?» (lo pintan la ventana de Nueva cita, la de Editar y la
// confirmación de Mover; el texto vive en es.json/en.json)
// ═══════════════════════════════════════════════════════════════════════

/** Lo que dice el aviso. Los datos ya formateados en la zona de la clínica. */
export interface AvisoSobreagenda {
  tipo: TipoChoque;
  /** La cita que se enseña (viaja de vuelta como `sobreagendarCita`). `null` = solo la comida. */
  citaId: string | null;
  /** Con `doctor`/`sillon`: el paciente de la otra cita. */
  paciente: string | null;
  /** Con `doctor`/`sillon`: «10:00–10:30» de la otra cita. */
  hora: string | null;
  /** Con `comida` (o si ADEMÁS de la cita cae en la comida): «14:00» y «15:00». */
  comidaDesde: string | null;
  comidaHasta: string | null;
  /** Cuántas citas MÁS hay encima además de la que se nombra. */
  otras: number;
}

/** «10:00–10:30» en la zona de la clínica (sin depender del navegador). */
function rangoEnZona(desdeIso: string, hastaIso: string | null | undefined, timeZone: string): string {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("es-MX", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(
      new Date(iso),
    );
  return hastaIso ? `${fmt(desdeIso)}–${fmt(hastaIso)}` : fmt(desdeIso);
}

/** El aviso a partir del 409 del servidor (`sobreagendable: true`). `null` si no lo es. */
export function avisoDesdeRechazo(
  body: unknown,
  intento: { doctorId?: string | null; resourceId?: string | null },
  timeZone: string,
): AvisoSobreagenda | null {
  if (!esRechazoSobreagendable(body)) return null;
  const c = body.conflictingAppointment && body.conflictingAppointment.id !== "unknown"
    ? body.conflictingAppointment
    : null;
  const comida = body.comida ?? null;
  return {
    tipo: tipoDeChoque({ conflicto: c, intento, pisaComida: !!comida }),
    citaId: c?.id ?? null,
    paciente: c ? c.patientName?.trim() || null : null,
    hora: c ? rangoEnZona(c.startsAt, c.endsAt, timeZone) : null,
    comidaDesde: comida?.lunchStart ?? null,
    comidaHasta: comida?.lunchEnd ?? null,
    otras: c && typeof c.otras === "number" && c.otras > 0 ? c.otras : 0,
  };
}

/**
 * El aviso a partir de lo que la pantalla YA tiene cargado (la otra cita del
 * arrastre, la comida del horario): para preguntar antes de mandar nada.
 * `null` = nada encima.
 */
export function avisoDesdeAgenda(args: {
  choque: { id: string; patientName: string | null; startsAt: string; endsAt: string | null; doctorId: string | null; resourceId: string | null } | null;
  comida: { lunchStart?: string | null; lunchEnd?: string | null } | null;
  intento: { doctorId?: string | null; resourceId?: string | null };
  timeZone: string;
  /** Cuántas citas más pisan el hueco, además de `choque`. */
  otras?: number;
}): AvisoSobreagenda | null {
  const { choque, comida } = args;
  if (!choque && !comida) return null;
  return {
    tipo: tipoDeChoque({
      conflicto: choque ? { doctorId: choque.doctorId ?? "", resourceId: choque.resourceId } : null,
      intento: args.intento,
      pisaComida: !!comida,
    }),
    citaId: choque?.id ?? null,
    paciente: choque?.patientName?.trim() || null,
    hora: choque ? rangoEnZona(choque.startsAt, choque.endsAt, args.timeZone) : null,
    comidaDesde: comida?.lunchStart ?? null,
    comidaHasta: comida?.lunchEnd ?? null,
    otras: choque && args.otras && args.otras > 0 ? args.otras : 0,
  };
}

/** Una frase del aviso: la llave de es.json/en.json y sus variables. */
export interface FraseDelAviso {
  clave: string;
  vars: Record<string, string>;
}

/**
 * El texto del aviso: la frase principal (la del encargo, al pie de la letra)
 * y, si hace falta, lo que ADEMÁS hay que saber antes de decir «Sí»: más citas
 * encima de la que se nombra, o que también cae en la comida del doctor.
 */
export function textoDelAviso(aviso: AvisoSobreagenda): FraseDelAviso & { extras: FraseDelAviso[] } {
  if (aviso.tipo === "comida") {
    return {
      clave: "agenda.flexible.sobreagendar.cuerpoComida",
      vars: { desde: aviso.comidaDesde ?? "", hasta: aviso.comidaHasta ?? "" },
      extras: [],
    };
  }
  const extras: FraseDelAviso[] = [];
  if (aviso.otras > 0) extras.push({ clave: "agenda.flexible.sobreagendar.otras", vars: { n: String(aviso.otras) } });
  if (aviso.comidaDesde && aviso.comidaHasta) {
    extras.push({
      clave: "agenda.flexible.sobreagendar.tambienComida",
      vars: { desde: aviso.comidaDesde, hasta: aviso.comidaHasta },
    });
  }
  return {
    clave: aviso.tipo === "sillon" ? "agenda.flexible.sobreagendar.cuerpoSillon" : "agenda.flexible.sobreagendar.cuerpoDoctor",
    vars: { paciente: aviso.paciente ?? "—", hora: aviso.hora ?? "" },
    extras,
  };
}
