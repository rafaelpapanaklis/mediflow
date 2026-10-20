/**
 * GOOGLE CALENDAR → AGENDA — las decisiones puras (WS1-T9, grupo Salamanca).
 *
 * Sin Prisma, sin Next y sin googleapis: se prueba con `tsx --test`
 * (src/lib/google/__tests__/entrante-core.test.ts). Quien lee la base y llama a
 * Google es `entrante-nucleo.ts` (con puertos) y `entrante.server.ts`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * QUÉ CIERRA LA AGENDA
 *
 *   · Todo evento del calendario de la clínica en Google que esté «ocupado»
 *     (`transparency` ausente u `opaque`) y no cancelado se vuelve un bloqueo
 *     GOOGLE. Los «disponible» (`transparent`) NO bloquean.
 *   · Los eventos de todo el día (`start.date`) cierran el día entero en la
 *     zona de la clínica.
 *   · Los que creó DaleControl (las citas que ya se copian a Google) NO se
 *     reimportan: llevan la marca `extendedProperties.private.dalecontrolClinicId`
 *     y un id `dc` + 40 hex (`idEventoDeCita`). Sin esto cada cita se cerraría
 *     a sí misma su propio hueco: el eco.
 *   · ¿De quién es el bloqueo? Del doctor cuyo correo aparece entre los
 *     invitados del evento (uno y solo uno). Si no aparece ninguno, o varios,
 *     de toda la clínica: el calendario es de la sede.
 *
 * 🔴 EL TÍTULO NO VA EN `reason`. El bot de WhatsApp le dice al paciente el
 * `reason` de un día cerrado (`bot-booking-service.ts`), y el título de un
 * evento («Cita con el abogado») no es de su incumbencia. `reason` es siempre
 * MOTIVO_GOOGLE y el título vive en `agenda_block_google.title`, que solo se
 * pinta en la agenda del staff.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { tzLocalToUtc } from "@/lib/agenda/time-utils";

/** El `reason` de todo bloqueo GOOGLE. Genérico a propósito (ver arriba). */
export const MOTIVO_GOOGLE = "Ocupado (Google)";
/** Quién «creó» el bloqueo (`agenda_blocks.createdByName`). */
export const CREADOR_GOOGLE = "Google Calendar";
/** Lo que se pinta en la rejilla: «Ocupado (Google) · <título>». */
export function etiquetaRejilla(titulo: string): string {
  const t = (titulo ?? "").trim();
  return t ? `${MOTIVO_GOOGLE} · ${t}` : MOTIVO_GOOGLE;
}

/** Títulos de evento: hasta 300 (la columna). */
export const TITULO_MAX = 300;
/** Un bloqueo GOOGLE no dura más de esto (mismo tope que los de a mano, `BLOQUEO_MAX_DIAS`). */
export const DURACION_MAX_DIAS = 366;
/** Eventos que empiezan más allá de esto no se importan (repeticiones infinitas). */
export const HORIZONTE_DIAS = 400;
/** La sincronización completa mira desde ayer: lo pasado no cierra nada. */
export const VENTANA_PASADO_MS = 24 * 60 * 60 * 1000;
/** Cada cuánto se rehace la sincronización completa (para lo que entra al horizonte). */
export const COMPLETA_CADA_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * DECISIÓN PARA RAFAEL. Google crea los eventos de TODO EL DÍA como
 * «Disponible» (transparent) por defecto. Con `false` (lo aprobado: «los
 * disponibles NO bloquean») un «Congreso» de todo el día solo cierra la agenda
 * si alguien lo marca «Ocupado» en Google. Con `true`, todo evento de todo el
 * día cierra el día aunque esté como disponible.
 */
export const TODO_EL_DIA_DISPONIBLE_BLOQUEA = false;
/** Tipos de evento de Google que nunca ocupan (ubicación de trabajo, cumpleaños). */
const TIPOS_QUE_NO_OCUPAN = new Set(["workingLocation", "birthday"]);

const DIA_MS = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════
// 1 · EL EVENTO DE GOOGLE (solo lo que se usa)
// ═══════════════════════════════════════════════════════════════════════

export interface FechaGoogle {
  date?: string | null;
  dateTime?: string | null;
  timeZone?: string | null;
}

export interface EventoGoogle {
  id?: string | null;
  status?: string | null;
  summary?: string | null;
  start?: FechaGoogle | null;
  end?: FechaGoogle | null;
  transparency?: string | null;
  eventType?: string | null;
  recurringEventId?: string | null;
  updated?: string | null;
  attendees?: { email?: string | null; responseStatus?: string | null }[] | null;
  extendedProperties?: { private?: Record<string, string> | null } | null;
}

/** ¿Lo creó DaleControl? (una cita que ya se copia a Google). */
export function esEventoDeDaleControl(ev: EventoGoogle): boolean {
  const priv = ev.extendedProperties?.private ?? null;
  if (priv && (priv.dalecontrolClinicId || priv.dalecontrolAppointmentId)) return true;
  // Los eventos de cita llevan id determinista: «dc» + 40 hex (`idEventoDeCita`).
  return typeof ev.id === "string" && /^dc[0-9a-f]{40}$/.test(ev.id);
}

/** ¿El evento está, y está ocupado? Lo que decide si cierra la agenda. */
export function eventoOcupa(ev: EventoGoogle): boolean {
  if (ev.status === "cancelled") return false;
  if (ev.transparency === "transparent") {
    const todoElDia = !!ev.start?.date && !ev.start?.dateTime;
    if (!(TODO_EL_DIA_DISPONIBLE_BLOQUEA && todoElDia)) return false;
  }
  if (ev.eventType && TIPOS_QUE_NO_OCUPAN.has(ev.eventType)) return false;
  return true;
}

function esDiaISO(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/**
 * El rango del evento en INSTANTES. Todo el día → de las 00:00 del primer día
 * a las 00:00 del día siguiente al último, en la zona de la CLÍNICA (Google
 * manda `end.date` exclusivo, igual que nuestros bloqueos). Null si no se
 * puede leer o no dura nada.
 */
export function rangoDeEvento(
  ev: EventoGoogle,
  zonaClinica: string,
): { startsAt: Date; endsAt: Date; allDay: boolean } | null {
  const s = ev.start ?? null;
  const e = ev.end ?? null;
  if (!s || !e) return null;
  let startsAt: Date;
  let endsAt: Date;
  let allDay = false;
  if (esDiaISO(s.date) && !s.dateTime) {
    allDay = true;
    startsAt = tzLocalToUtc(s.date, 0, 0, zonaClinica);
    const fin = esDiaISO(e.date) ? e.date : null;
    endsAt = fin ? tzLocalToUtc(fin, 0, 0, zonaClinica) : new Date(startsAt.getTime() + DIA_MS);
  } else {
    if (typeof s.dateTime !== "string" || typeof e.dateTime !== "string") return null;
    startsAt = new Date(s.dateTime);
    endsAt = new Date(e.dateTime);
  }
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  if (endsAt.getTime() <= startsAt.getTime()) return null;
  const tope = startsAt.getTime() + DURACION_MAX_DIAS * DIA_MS;
  if (endsAt.getTime() > tope) endsAt = new Date(tope);
  return { startsAt, endsAt, allDay };
}

export function tituloDeEvento(ev: EventoGoogle): string {
  const t = typeof ev.summary === "string" ? ev.summary.replace(/\s+/g, " ").trim() : "";
  return Array.from(t).slice(0, TITULO_MAX).join("");
}

/**
 * El doctor del bloqueo: el ÚNICO doctor de la clínica invitado al evento
 * (por correo, sin distinguir mayúsculas). Ninguno o varios → null = toda la
 * clínica. Un invitado que rechazó la invitación no cuenta.
 */
export function doctorDelEvento(
  ev: EventoGoogle,
  doctores: readonly { id: string; email: string | null }[],
): string | null {
  const correos = new Set(
    (ev.attendees ?? [])
      .filter((a) => a && a.responseStatus !== "declined")
      .map((a) => (typeof a.email === "string" ? a.email.trim().toLowerCase() : ""))
      .filter(Boolean),
  );
  if (correos.size === 0) return null;
  const encontrados = new Set<string>();
  for (const d of doctores) {
    const c = d.email?.trim().toLowerCase();
    if (c && correos.has(c)) encontrados.add(d.id);
  }
  return encontrados.size === 1 ? [...encontrados][0] : null;
}

export function fechaGoogle(s: string | null | undefined): Date | null {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · QUÉ HACER CON UN EVENTO QUE NO ES UNA CITA CONVERTIDA
// ═══════════════════════════════════════════════════════════════════════

/** Lo que ya hay en la base para ese evento (un bloqueo SIN convertir). */
export interface BloqueoExistente {
  blockId: string;
  activo: boolean;
  doctorId: string | null;
  startsAt: Date;
  endsAt: Date;
  title: string;
  allDay: boolean;
}

export interface DatosBloqueo {
  doctorId: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  title: string;
  recurringEventId: string | null;
  googleUpdated: Date | null;
}

export type DecisionEvento =
  | { accion: "nada" }
  | { accion: "crear"; datos: DatosBloqueo }
  /** Mueve/renombra el bloqueo y, si estaba retirado porque el evento se borró, lo reactiva. */
  | { accion: "actualizar"; blockId: string; datos: DatosBloqueo }
  /** El evento se borró, se canceló o pasó a «disponible»: el bloqueo se retira (no se borra). */
  | { accion: "inactivar"; blockId: string };

const mismoInstante = (a: Date, b: Date) => a.getTime() === b.getTime();

/**
 * La decisión para UN evento del calendario de la clínica.
 *
 *   · De DaleControl (eco) → si por lo que sea había un bloqueo, se retira; si no, nada.
 *   · No ocupa (cancelado / disponible / sin fecha legible) → se retira el que hubiera.
 *   · Ocupa y no hay bloqueo → se crea, salvo que ya terminó o queda fuera del horizonte.
 *   · Ocupa y hay bloqueo → se pone al día solo si algo cambió (idempotente).
 */
export function decidirEvento(
  ev: EventoGoogle,
  ctx: {
    zona: string;
    ahora: Date;
    existente: BloqueoExistente | null;
    doctores: readonly { id: string; email: string | null }[];
  },
): DecisionEvento {
  const { existente } = ctx;
  const retirar = (): DecisionEvento =>
    existente && existente.activo ? { accion: "inactivar", blockId: existente.blockId } : { accion: "nada" };

  if (esEventoDeDaleControl(ev)) return retirar();
  if (!eventoOcupa(ev)) return retirar();
  const rango = rangoDeEvento(ev, ctx.zona);
  if (!rango) return retirar();

  const datos: DatosBloqueo = {
    doctorId: doctorDelEvento(ev, ctx.doctores),
    startsAt: rango.startsAt,
    endsAt: rango.endsAt,
    allDay: rango.allDay,
    title: tituloDeEvento(ev),
    recurringEventId: typeof ev.recurringEventId === "string" && ev.recurringEventId ? ev.recurringEventId : null,
    googleUpdated: fechaGoogle(ev.updated),
  };

  if (!existente) {
    // Lo que ya pasó no cierra nada, y lo de dentro de más de un año tampoco
    // (las series sin fin de Google se repiten para siempre).
    if (rango.endsAt.getTime() <= ctx.ahora.getTime()) return { accion: "nada" };
    if (rango.startsAt.getTime() > ctx.ahora.getTime() + HORIZONTE_DIAS * DIA_MS) return { accion: "nada" };
    return { accion: "crear", datos };
  }

  const igual =
    existente.activo &&
    existente.doctorId === datos.doctorId &&
    mismoInstante(existente.startsAt, datos.startsAt) &&
    mismoInstante(existente.endsAt, datos.endsAt) &&
    existente.title === datos.title &&
    existente.allDay === datos.allDay;
  return igual ? { accion: "nada" } : { accion: "actualizar", blockId: existente.blockId, datos };
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · EL EVENTO DE UNA CITA CONVERTIDA: AVISAR, NUNCA MOVER NI CANCELAR
// ═══════════════════════════════════════════════════════════════════════

export type TipoAviso = "movido" | "eliminado";

/** Lo guardado del vínculo de una cita convertida. */
export interface VinculoCita {
  eventStartsAt: Date;
  eventEndsAt: Date;
  eventDeletedAt: Date | null;
  avisoTipo: string | null;
}

export interface CitaDelVinculo {
  status: string;
  startsAt: Date;
  endsAt: Date;
}

/** Estados en los que la cita ya no ocupa: no se avisa de nada. */
const CITA_CERRADA = new Set(["CANCELLED", "NO_SHOW", "COMPLETED"]);
export const citaSigueViva = (c: CitaDelVinculo | null): c is CitaDelVinculo => !!c && !CITA_CERRADA.has(c.status);

/** Los cambios que hay que guardar en el vínculo (vacío = nada). */
export interface CambiosVinculo {
  eventStartsAt?: Date;
  eventEndsAt?: Date;
  eventDeletedAt?: Date | null;
  googleUpdated?: Date | null;
  avisoTipo?: TipoAviso | null;
  avisoStartsAt?: Date | null;
  avisoEndsAt?: Date | null;
  avisoDesde?: Date | null;
  avisoDescartadoAt?: Date | null;
}

const SIN_AVISO: CambiosVinculo = {
  avisoTipo: null,
  avisoStartsAt: null,
  avisoEndsAt: null,
  avisoDesde: null,
  avisoDescartadoAt: null,
};

/**
 * Qué cambia en el vínculo de una cita convertida cuando su evento cambia.
 *
 * 🔴 EL AVISO SALE SOLO SI LA HORA DE GOOGLE CAMBIÓ RESPECTO A LA ÚLTIMA VISTA,
 * no por compararla con la cita. Si no:
 *   · al mover la cita en DaleControl, entre que se guarda y que el parche
 *     llega a Google, la cita y el evento difieren unos instantes → aviso falso;
 *   · si el parche a Google falla (Google caído), difieren para siempre → aviso falso.
 * Con «cambió desde la última vez», nuestro propio parche llega a Google con la
 * hora de la cita (= ninguna diferencia → nada que avisar) y un parche que no
 * llegó no cambia nada en Google (→ nada que avisar).
 */
export function decidirAvisoCita(
  ev: EventoGoogle,
  vinculo: VinculoCita,
  cita: CitaDelVinculo | null,
  ctx: { zona: string; ahora: Date },
): CambiosVinculo {
  const updated = fechaGoogle(ev.updated);
  const eliminado = ev.status === "cancelled";

  if (eliminado) {
    if (vinculo.eventDeletedAt) return {};
    const cambios: CambiosVinculo = { eventDeletedAt: ctx.ahora, googleUpdated: updated };
    if (citaSigueViva(cita)) {
      return {
        ...cambios,
        avisoTipo: "eliminado",
        avisoStartsAt: null,
        avisoEndsAt: null,
        avisoDesde: ctx.ahora,
        avisoDescartadoAt: null,
      };
    }
    return cambios;
  }

  const rango = rangoDeEvento(ev, ctx.zona);
  if (!rango) return {};
  const cambios: CambiosVinculo = {};
  // El evento volvió (alguien deshizo el borrado, o «Mantener la cita» lo resucitó).
  if (vinculo.eventDeletedAt) {
    cambios.eventDeletedAt = null;
    if (vinculo.avisoTipo === "eliminado") Object.assign(cambios, SIN_AVISO);
  }

  const cambioHora =
    !mismoInstante(rango.startsAt, vinculo.eventStartsAt) || !mismoInstante(rango.endsAt, vinculo.eventEndsAt);
  if (!cambioHora) return cambios;

  Object.assign(cambios, { eventStartsAt: rango.startsAt, eventEndsAt: rango.endsAt, googleUpdated: updated });
  const coincideConCita =
    !!cita && mismoInstante(rango.startsAt, cita.startsAt) && mismoInstante(rango.endsAt, cita.endsAt);
  if (coincideConCita || !citaSigueViva(cita)) {
    // Google quedó igual que la cita (nuestro propio parche, o ya se movió): sin aviso.
    if (vinculo.avisoTipo === "movido" || coincideConCita) Object.assign(cambios, SIN_AVISO);
    return cambios;
  }
  return {
    ...cambios,
    avisoTipo: "movido",
    avisoStartsAt: rango.startsAt,
    avisoEndsAt: rango.endsAt,
    avisoDesde: ctx.ahora,
    avisoDescartadoAt: null,
  };
}

/** El aviso de una cita tal como lo guarda el vínculo. */
export interface AvisoGuardado {
  avisoTipo: string | null;
  avisoStartsAt: Date | null;
  avisoEndsAt: Date | null;
  avisoDescartadoAt: Date | null;
}

export type AvisoVigente =
  | { tipo: "movido"; inicio: Date; fin: Date }
  | { tipo: "eliminado" };

/**
 * ¿Se enseña el aviso AHORA? No si se descartó, si la cita ya está cerrada, o
 * —en «movido»— si la cita ya está a la hora nueva (alguien la movió).
 */
export function avisoVigente(v: AvisoGuardado, cita: CitaDelVinculo | null): AvisoVigente | null {
  if (!v.avisoTipo || v.avisoDescartadoAt) return null;
  if (!citaSigueViva(cita)) return null;
  if (v.avisoTipo === "eliminado") return { tipo: "eliminado" };
  if (v.avisoTipo === "movido" && v.avisoStartsAt && v.avisoEndsAt) {
    if (mismoInstante(v.avisoStartsAt, cita.startsAt) && mismoInstante(v.avisoEndsAt, cita.endsAt)) return null;
    return { tipo: "movido", inicio: v.avisoStartsAt, fin: v.avisoEndsAt };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA SINCRONIZACIÓN Y EL CANAL
// ═══════════════════════════════════════════════════════════════════════

/** ¿Toca sincronización completa (sin syncToken, calendario nuevo o ya pasó una semana)? */
export function tocaCompleta(e: {
  syncToken: string | null;
  calendarIdGuardado: string | null;
  calendarIdActual: string;
  lastFullSyncAt: Date | null;
  ahora: Date;
}): boolean {
  if (!e.syncToken) return true;
  if (e.calendarIdGuardado !== e.calendarIdActual) return true;
  if (!e.lastFullSyncAt) return true;
  return e.ahora.getTime() - e.lastFullSyncAt.getTime() >= COMPLETA_CADA_MS;
}

/** Duración que se le pide a Google para un canal (7 días, el máximo habitual). */
export const TTL_CANAL_S = 7 * 24 * 60 * 60;
/** Se renueva cuando le quedan menos de 2 días: el cron corre cada pocos minutos, sobra margen. */
export const RENOVAR_CANAL_ANTES_MS = 2 * 24 * 60 * 60 * 1000;

export function canalPorRenovar(
  c: { channelId: string | null; channelExpiresAt: Date | null; calendarIdCanal: string | null },
  calendarIdActual: string,
  ahora: Date,
): boolean {
  if (!c.channelId || !c.channelExpiresAt) return true;
  if (c.calendarIdCanal !== calendarIdActual) return true;
  return c.channelExpiresAt.getTime() - ahora.getTime() < RENOVAR_CANAL_ANTES_MS;
}

/**
 * La dirección pública del aviso. Google exige HTTPS con certificado válido:
 * sin `NEXT_PUBLIC_APP_URL` https no hay canal y queda el cron de respaldo.
 */
export function direccionDelAviso(appUrl: string | null | undefined): string | null {
  if (!appUrl) return null;
  try {
    const u = new URL("/api/google/avisos", appUrl);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Comparación de secretos en tiempo constante (sin `crypto`, para el navegador de pruebas y el borde). */
export function mismoSecreto(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Errores de la sincronización entrante, por clase. Nunca apagan la de salida. */
export type ErrorEntrante = "permisos" | "autorizacion" | "calendario" | "google";

/**
 * «permisos» es el que pide volver a conectar Google con más alcance (punto 7):
 * el token no deja LEER ese calendario.
 */
export function clasificarErrorEntrante(err: unknown): ErrorEntrante {
  const e = err as any;
  const status = Number(e?.response?.status ?? e?.status ?? e?.code);
  const datos = e?.response?.data ?? e?.data;
  const razon = String(datos?.error?.errors?.[0]?.reason ?? e?.errors?.[0]?.reason ?? "");
  const oauth = typeof datos?.error === "string" ? datos.error : "";
  const texto = String(e?.message ?? "");
  if (/insufficientPermissions|insufficientScopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(razon + " " + texto)) return "permisos";
  if (status === 401 || /invalid_grant|invalid_client|unauthorized_client/.test(oauth + " " + texto)) return "autorizacion";
  if (status === 404 || status === 410) return "calendario";
  if (status === 403 && /forbidden|notFound/.test(razon)) return "calendario";
  return "google";
}
