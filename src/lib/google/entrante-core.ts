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
 *     y un id `dc` + 40 hex (`idEventoDeCita`), o una cita de la clínica los
 *     tiene ligados (`googleCalendarEventId`). Sin esto cada cita se cerraría
 *     a sí misma su propio hueco: el eco. El título «🏥 … — …» o el pie
 *     «Agendado desde DaleControl» solos NO bastan: un evento duplicado a mano
 *     en Google los copia y debe cerrar la agenda (segunda vuelta t8, N-G6).
 *   · ¿A quién bloquea? (WS1-T3, decisiones de Rafael del 21-oct-2026:
 *     «NO quiero que se cierre toda la clínica nunca desde Google Calendar…
 *     para eso tenemos Bloquear horarios», y el agente de marketing que
 *     agenda para el Dr. X desde SU Google invitando al Dr. X y a la
 *     dirección del calendario de la clínica). `doctoresDelEvento`:
 *       1. Invita a personas de la clínica que reciben citas y no
 *          rechazaron → a CADA una (un bloqueo por doctor).
 *       2. Invita a alguien de la clínica que atiende pero ninguno queda
 *          (rechazó, o tiene «Aparece en la agenda» apagada) → a NADIE
 *          (revisión t8, H3: decisión A de Rafael del 26-oct-2026).
 *       3. No invita a ninguna persona de la clínica que atienda → al dueño
 *          de la cuenta conectada (`duenoDeLaCuenta`), si recibe citas.
 *       4. Tampoco hay dueño que atienda → a nadie; la agenda y
 *          Configuración lo dicen (`sinDueno`).
 *       5. NUNCA a toda la clínica.
 *     Pacientes, externos y la dirección del propio calendario no cuentan.
 *
 * 🔴 EL TÍTULO NO VA EN `reason`. El bot de WhatsApp le dice al paciente el
 * `reason` de un día cerrado (`bot-booking-service.ts`), y el título de un
 * evento («Cita con el abogado») no es de su incumbencia. `reason` es siempre
 * MOTIVO_GOOGLE y el título vive en `agenda_block_google.title`, que solo se
 * pinta a quien puede ver la agenda de ESE doctor (`puedeVerTitulo`). Y el bot
 * ni siquiera dice MOTIVO_GOOGLE: para el paciente es «Ese horario no está
 * disponible» (`MENSAJE_PACIENTE_GOOGLE`).
 * ═══════════════════════════════════════════════════════════════════════
 */

import { tzLocalToUtc } from "@/lib/agenda/time-utils";

/** El `reason` de todo bloqueo GOOGLE. Genérico a propósito (ver arriba). */
export const MOTIVO_GOOGLE = "Ocupado (Google)";
/** Lo que le dice el bot al paciente de un día cerrado por Google (nunca «Google»). */
export const MENSAJE_PACIENTE_GOOGLE = "Ese horario no está disponible";
/** Quién «creó» el bloqueo (`agenda_blocks.createdByName`). */
export const CREADOR_GOOGLE = "Google Calendar";
/**
 * ¿Quien mira puede ver el TÍTULO del evento? Con las reglas de visibilidad de
 * la agenda de hoy (`/api/agenda/range`): un DOCTOR ve solo su agenda; el
 * resto de roles con acceso a la agenda (recepción, dueño, admin) la ve
 * entera. Así un DOCTOR ve el título de los suyos, y en los de toda la clínica
 * (o de un compañero) solo «Ocupado (Google)».
 */
export function puedeVerTitulo(
  quien: { role: string; userId: string },
  bloqueo: { doctorId: string | null },
): boolean {
  if (quien.role !== "DOCTOR") return true;
  return bloqueo.doctorId !== null && bloqueo.doctorId === quien.userId;
}

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
  description?: string | null;
  start?: FechaGoogle | null;
  end?: FechaGoogle | null;
  transparency?: string | null;
  eventType?: string | null;
  recurringEventId?: string | null;
  updated?: string | null;
  attendees?: {
    email?: string | null;
    displayName?: string | null;
    responseStatus?: string | null;
    self?: boolean | null;
    resource?: boolean | null;
  }[] | null;
  extendedProperties?: { private?: Record<string, string> | null } | null;
}

/**
 * ¿Lo creó DaleControl? (una cita que ya se copia a Google). Solo por lo que
 * un evento hecho a mano NO puede copiar: el id determinista o la marca
 * privada. Además, quien llama mira si una cita lo tiene ligado
 * (`eventosDeCitas`). El título «🏥 … — …» y el pie «Agendado desde
 * DaleControl» ya no cuentan solos: «Duplicar» en Google los copia, y ese
 * duplicado (p. ej. para apartar la siguiente sesión) sí debe cerrar la
 * agenda (segunda vuelta t8, N-G6).
 */
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

/**
 * El prefijo que la salida le pone al título de un evento de Google cuya cita
 * (convertida) se canceló en DaleControl (`tituloCancelada`). Vive aquí, puro,
 * para que el bloqueo que vuelve tras cancelar enseñe el título de verdad.
 */
export const PREFIJO_CANCELADA = "Cancelada en DaleControl · ";

export function tituloDeEvento(ev: EventoGoogle): string {
  let t = typeof ev.summary === "string" ? ev.summary.replace(/\s+/g, " ").trim() : "";
  while (t.startsWith(PREFIJO_CANCELADA)) t = t.slice(PREFIJO_CANCELADA.length).trim();
  return Array.from(t).slice(0, TITULO_MAX).join("");
}

/** Una persona de la clínica (cualquier rol, activa o no) con sus correos. */
export interface UsuarioClinica {
  id: string;
  /** Su correo de acceso (`users.email`). */
  email: string | null;
  /** La cuenta de Google con la que conectó (`users.googleCalendarEmail`). */
  correoGoogle?: string | null;
  /** ¿Sale en la agenda y recibe citas? (`puedeRecibirCitas`). */
  recibeCitas: boolean;
  /**
   * ¿Atiende? Rol que atiende y cuenta activa, SIN mirar «Aparece en la
   * agenda» (`ATIENDE_WHERE`). Ausente = `recibeCitas`.
   */
  atiende?: boolean;
}

/**
 * Por qué un bloqueo VIEJO era de toda la clínica (la regla de antes, por
 * invitados). Desde la regla 4 ningún evento cierra toda la clínica: solo
 * quedan en filas viejas, y la primera pasada las reasigna o las retira.
 */
export type AlcanceGoogle = "sin_invitados" | "no_reconocido" | "varios";

const correo = (s: string | null | undefined) => s?.trim().toLowerCase() || null;

/**
 * ¿De quién es la cuenta de Google conectada a la clínica?
 * (`clinics.googleCalendarEmail`; WS1-T3, decisión de Rafael del 21-oct-2026)
 *
 * De la persona de la clínica que RECIBE citas (`puedeRecibirCitas`: un
 * superadmin con «Aparece en la agenda» también) cuyo correo es esa cuenta:
 * primero por su correo de acceso (`users.email`) y, si nadie entra con
 * ella, por la cuenta de Google que conectó (`users.googleCalendarEmail`).
 * Tiene que ser UNA sola persona: si son varias no se sabe de quién es.
 *
 * `null` = cuenta GENERAL (recepción, un Gmail de la clínica, alguien que no
 * atiende): los eventos de Google no bloquean a nadie, y la agenda y
 * Configuración lo dicen (`sinDueno`).
 */
export function duenoDeLaCuenta(
  cuenta: string | null | undefined,
  usuarios: readonly UsuarioClinica[],
): string | null {
  const c = correo(cuenta);
  if (!c) return null;
  const atienden = usuarios.filter((u) => u.recibeCitas);
  const porAcceso = atienden.filter((u) => correo(u.email) === c);
  if (porAcceso.length > 0) return porAcceso.length === 1 ? porAcceso[0].id : null;
  const porGoogle = atienden.filter((u) => correo(u.correoGoogle) === c);
  return porGoogle.length === 1 ? porGoogle[0].id : null;
}

/**
 * A quién bloquea UN evento del calendario de la clínica (ver la cabecera):
 * las personas de la clínica que reciben citas invitadas y que no
 * rechazaron, cada una. Si invita a alguien de la clínica que atiende pero
 * ninguno queda (rechazó o tiene la agenda apagada), a nadie: el evento era
 * para esa persona, no para el dueño (H3, decisión A). Solo si no invita a
 * nadie de la clínica que atienda, el dueño de la cuenta conectada; si
 * tampoco, nadie (lista vacía). Nunca `null` = toda la clínica.
 *
 * Se reconoce a cada invitado por su correo de acceso o por el Google que
 * conectó. La dirección del propio calendario (el `…@group.calendar.google.com`
 * que el agente invita para que el evento entre aquí), el calendario mismo
 * (`self`) y las salas (`resource`) no son personas. Un nombre visible nunca
 * basta: solo el correo. Ordenados por id (estable entre pasadas).
 */
export function doctoresDelEvento(
  ev: EventoGoogle,
  usuarios: readonly UsuarioClinica[],
  ctx: { dueno: string | null; calendarId?: string | null },
): string[] {
  const cal = correo(ctx.calendarId);
  const atienden = usuarios.filter((u) => u.atiende ?? u.recibeCitas);
  const ids = new Set<string>();
  let invitaAlguien = false;
  for (const a of ev.attendees ?? []) {
    if (!a || a.self || a.resource) continue;
    const c = correo(a.email);
    if (!c || c === cal) continue;
    for (const u of atienden) {
      if (correo(u.email) !== c && correo(u.correoGoogle) !== c) continue;
      invitaAlguien = true;
      if (u.recibeCitas && a.responseStatus !== "declined") ids.add(u.id);
    }
  }
  if (invitaAlguien) return [...ids].sort();
  return ctx.dueno && usuarios.some((u) => u.id === ctx.dueno && u.recibeCitas) ? [ctx.dueno] : [];
}

/**
 * La clave del vínculo de cada doctor con el evento (`agenda_block_google.calendarId`).
 * El índice único es (clínica, calendario, evento): un evento, un vínculo. Con
 * un bloqueo por doctor, el PRIMER doctor usa el calendario tal cual (los
 * bloqueos que ya existían siguen siendo el mismo) y cada uno de los demás
 * `<calendario>#<doctorId>`. El `googleEventId` es SIEMPRE el del evento real:
 * «Convertir en cita» y la salida no cambian. Sin SQL ni columnas nuevas.
 */
export const SEPARADOR_DOCTOR = "#";
export const claveDeDoctor = (calendarId: string, doctorId: string) => `${calendarId}${SEPARADOR_DOCTOR}${doctorId}`;
/**
 * El calendario de una clave de vínculo (le quita el `#<doctorId>`). El `#`
 * del doctor va DESPUÉS del dominio: un calendario puede llevar `#` en su
 * nombre (`es.mexican#holiday@…`).
 */
export function calendarioDeLaClave(clave: string): string {
  const i = clave.indexOf(SEPARADOR_DOCTOR, Math.max(0, clave.indexOf("@")));
  return i < 0 ? clave : clave.slice(0, i);
}
/**
 * La clave a la que se APARTA el vínculo de una cita convertida que luego se
 * canceló (revisión t8 de la v3, m1): `<calendario>#cancelada:<citaId>`. Sigue
 * ligado a SU cita (la salida le pone «Cancelada…» al título; si la reactivan,
 * vuelve a ser la cita del evento) y deja libre la clave del doctor para que
 * el bloqueo vuelva y se pueda convertir otra vez. No se borra nada.
 */
export const MARCA_CANCELADA = "cancelada:";
export const claveCancelada = (calendarId: string, appointmentId: string) =>
  `${calendarioDeLaClave(calendarId)}${SEPARADOR_DOCTOR}${MARCA_CANCELADA}${appointmentId}`;
export function esClaveCancelada(clave: string): boolean {
  const cal = calendarioDeLaClave(clave);
  return clave.startsWith(cal + SEPARADOR_DOCTOR + MARCA_CANCELADA);
}
/** ¿Esa clave de vínculo es de ese calendario (la principal o la de un doctor)? */
export function esClaveDelCalendario(clave: string, calendarId: string): boolean {
  return clave === calendarId || clave.startsWith(calendarId + SEPARADOR_DOCTOR);
}

/**
 * La «huella» del equipo tal como la ve `duenoDeLaCuenta`. Si cambia (alguien
 * enciende «Aparece en la agenda», cambia un correo, se reconecta con otra
 * cuenta), la siguiente pasada es COMPLETA y reasigna los eventos que ya
 * estaban; antes seguían con el dueño viejo hasta una semana (N-G5).
 *
 * Lleva también la versión de la REGLA: al cambiarla cada clínica hace una
 * completa y los bloqueos que ya estaban se corrigen en la primera pasada.
 * Regla 4 (WS1-T3): nunca toda la clínica; regla 5: un bloqueo por cada
 * doctor invitado, o el dueño de la cuenta (`doctoresDelEvento`); regla 6
 * (H3): si el invitado de la clínica rechazó, nadie (ya no el dueño). Los que
 * quedaban se reasignan o se retiran (deletedAt, sin borrar).
 */
export const REGLA_ASIGNACION = "6";

export function firmaEquipo(usuarios: readonly UsuarioClinica[], cuenta?: string | null): string {
  const filas = usuarios
    .map((u) => [u.id, correo(u.email) ?? "", correo(u.correoGoogle) ?? "", u.recibeCitas ? "1" : "0", (u.atiende ?? u.recibeCitas) ? "1" : "0"].join("|"))
    .sort();
  // cyrb53: corto, estable y sin `crypto` (este archivo también corre en pruebas puras).
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const texto = [`regla ${REGLA_ASIGNACION}`, `cuenta ${correo(cuenta) ?? ""}`, ...filas].join("\n");
  for (let i = 0; i < texto.length; i++) {
    const ch = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${filas.length}-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * ¿Ese calendario se puede leer como «el de la clínica»? Solo los secundarios
 * que crea DaleControl (`…@group.calendar.google.com`). Un `primary` o un
 * correo es el calendario PERSONAL de quien conectó (conexiones viejas): cada
 * evento personal cerraría la clínica (revisión t8, G14).
 */
export function calendarioImportable(calendarId: string | null | undefined): boolean {
  return typeof calendarId === "string" && /^[^@\s]+@group\.calendar\.google\.com$/i.test(calendarId.trim());
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
  /** La clave del vínculo (`claveDeDoctor`); ausente = la principal. */
  clave?: string;
  activo: boolean;
  doctorId: string | null;
  alcance?: AlcanceGoogle | null;
  startsAt: Date;
  endsAt: Date;
  title: string;
  allDay: boolean;
}

export interface DatosBloqueo {
  doctorId: string | null;
  /** Por qué es de toda la clínica (`null` = de una persona). */
  alcance: AlcanceGoogle | null;
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
 *   · Sin doctor (`doctoresDelEvento` no dio nadie para este vínculo) → se
 *     retira el que hubiera (los de toda la clínica de antes, sin borrarse).
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
    /** El doctor de ESTE bloqueo (`doctoresDelEvento`); null = no le toca a nadie. */
    doctorId: string | null;
  },
): DecisionEvento {
  const { existente } = ctx;
  const retirar = (): DecisionEvento =>
    existente && existente.activo ? { accion: "inactivar", blockId: existente.blockId } : { accion: "nada" };

  if (!ctx.doctorId) return retirar();
  if (esEventoDeDaleControl(ev)) return retirar();
  if (!eventoOcupa(ev)) return retirar();
  const rango = rangoDeEvento(ev, ctx.zona);
  if (!rango) return retirar();

  const datos: DatosBloqueo = {
    doctorId: ctx.doctorId,
    alcance: null,
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
    (existente.alcance ?? null) === datos.alcance &&
    mismoInstante(existente.startsAt, datos.startsAt) &&
    mismoInstante(existente.endsAt, datos.endsAt) &&
    existente.title === datos.title &&
    existente.allDay === datos.allDay;
  return igual ? { accion: "nada" } : { accion: "actualizar", blockId: existente.blockId, datos };
}

/** Lo que hay que hacer con UN vínculo del evento (`clave` para crearlo). */
export type DecisionVinculo = { clave: string; decision: DecisionEvento };

/**
 * Las decisiones de UN evento con un bloqueo por doctor (regla 5). Cada
 * doctor CONSERVA el vínculo que ya era suyo (el activo antes que uno
 * retirado): añadir o quitar invitados nunca cambia de columna el bloqueo de
 * otro, y «Convertir en cita» abierto sobre él sigue valiendo (H4). Al que no
 * tiene ninguno le toca la clave principal si nadie la usa, o la de toda la
 * clínica de antes (sin doctor: se le REASIGNA, el mismo bloqueo); si no,
 * `<calendario>#<doctorId>`. Lo que sobra (un doctor que ya no está
 * invitado, o todos si ya no le toca a nadie) se RETIRA, no se borra. Los
 * vínculos de citas convertidas no entran aquí (los atiende el aviso).
 */
export function decidirEventoPorDoctor(
  ev: EventoGoogle,
  ctx: { zona: string; ahora: Date; calendarId: string; doctores: readonly string[]; existentes: readonly BloqueoExistente[] },
): DecisionVinculo[] {
  const claveDe = (e: BloqueoExistente) => e.clave ?? ctx.calendarId;
  const quiero = new Map<string, string>();
  const sinVinculo: string[] = [];
  for (const d of ctx.doctores) {
    const suyos = ctx.existentes.filter((e) => e.doctorId === d && !quiero.has(claveDe(e)));
    // El activo primero; entre iguales, la principal (es la que ya existía).
    const suyo = suyos.find((e) => e.activo && claveDe(e) === ctx.calendarId) ?? suyos.find((e) => e.activo)
      ?? suyos.find((e) => claveDe(e) === ctx.calendarId) ?? suyos[0];
    if (suyo) quiero.set(claveDe(suyo), d);
    else sinVinculo.push(d);
  }
  for (const d of sinVinculo) {
    const principal = ctx.existentes.find((e) => claveDe(e) === ctx.calendarId);
    const libre = !quiero.has(ctx.calendarId) && (!principal || principal.doctorId === null);
    quiero.set(libre ? ctx.calendarId : claveDeDoctor(ctx.calendarId, d), d);
  }
  const out: DecisionVinculo[] = [];
  const vistas = new Set<string>();
  for (const e of ctx.existentes) {
    const clave = e.clave ?? ctx.calendarId;
    vistas.add(clave);
    const doctorId = quiero.get(clave) ?? null;
    out.push({ clave, decision: decidirEvento(ev, { zona: ctx.zona, ahora: ctx.ahora, existente: e, doctorId }) });
  }
  for (const [clave, doctorId] of quiero) {
    if (vistas.has(clave)) continue;
    out.push({ clave, decision: decidirEvento(ev, { zona: ctx.zona, ahora: ctx.ahora, existente: null, doctorId }) });
  }
  return out;
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
  /** El evento al que va ligada ahora (`appointments.googleCalendarEventId`). */
  googleEventId?: string | null;
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
  const volvio = !!vinculo.eventDeletedAt;
  if (volvio) {
    cambios.eventDeletedAt = null;
    if (vinculo.avisoTipo === "eliminado") Object.assign(cambios, SIN_AVISO);
  }

  const cambioHora =
    !mismoInstante(rango.startsAt, vinculo.eventStartsAt) || !mismoInstante(rango.endsAt, vinculo.eventEndsAt);
  // Volvió a su hora de antes, pero la cita se movió mientras estaba borrado:
  // no son iguales y nadie lo diría (segunda vuelta t8). Se avisa «movido».
  const distintoDeLaCita = !!cita && (!mismoInstante(rango.startsAt, cita.startsAt) || !mismoInstante(rango.endsAt, cita.endsAt));
  if (!cambioHora && volvio && citaSigueViva(cita) && distintoDeLaCita) {
    return {
      ...cambios,
      avisoTipo: "movido",
      avisoStartsAt: rango.startsAt,
      avisoEndsAt: rango.endsAt,
      avisoDesde: ctx.ahora,
      avisoDescartadoAt: null,
    };
  }
  if (!cambioHora) {
    // Un «movido» que ya quedó resuelto (la cita está a la hora del evento) no
    // se queda pegado aunque la hora de Google no cambie (revisión t8).
    const resuelto =
      vinculo.avisoTipo === "movido" && !!cita &&
      mismoInstante(rango.startsAt, cita.startsAt) && mismoInstante(rango.endsAt, cita.endsAt);
    return resuelto ? { ...cambios, ...SIN_AVISO } : cambios;
  }

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

/** Tras cuánto tiempo sin una sincronización entrante buena se retiran los bloqueos de Google. */
export const SIN_MANTENER_RETIRA_MS = 24 * 60 * 60 * 1000;
/** Lo más que «parcial» aguanta sin una pasada completa buena. */
export const PARCIAL_TOPE_MS = 72 * 60 * 60 * 1000;

/**
 * ¿Los bloqueos de Google de la clínica ya no los mantiene nadie al día?
 * (revisión t8, G3; segunda vuelta, N-G3).
 *
 *   · Google se DESCONECTÓ a propósito (sin refresh token) → sí, ya.
 *   · La última pasada BUENA fue hace más de `SIN_MANTENER_RETIRA_MS` → sí,
 *     sea cual sea la causa: conexión caída, permisos, calendario personal o
 *     compartido, un 403 o Google fallando. Antes solo contaba la caída, y
 *     su fecha salía de una tabla de otro SQL (`clinic_google_status`): sin
 *     pegarlo, o por otra causa, un evento borrado en Google seguía cerrando
 *     esa hora para siempre. Ahora solo se mira `google_agenda_imports`.
 *   · «parcial» (se acabó el tiempo a media pasada) indulta SOLO con la
 *     conexión activa y una pasada buena hace menos de `PARCIAL_TOPE_MS`: con
 *     la conexión caída nadie vuelve a escribir el error y «parcial» se
 *     quedaría para siempre; y una completa que nunca cabe tampoco avanza
 *     (cada una empieza en la página 0).
 *
 * Sin ninguna pasada buena todavía, cuenta desde que se encendió la bandera.
 * Al volver a sincronizar bien, la primera pasada es completa y vuelve a
 * cerrar lo que siga ocupado.
 */
export function bloqueosSinMantener(
  e: {
    conToken: boolean;
    /** La salida está encendida (no caída): `clinics.googleCalendarEnabled`. */
    conexionActiva?: boolean;
    ultimaBuena: Date | null;
    encendidaDesde: Date | null;
    ultimoError: string | null;
    /**
     * Ya se retiraron (sin syncToken ni última completa) y la completa está
     * reponiendo: un «parcial» ahí es Google contestando, no se retira otra
     * vez. Si no, cada 5 min se deshacía lo repuesto y la completa volvía a
     * la página 0 para siempre (tercera vuelta, revisor).
     */
    reponiendo?: boolean;
  },
  ahora: Date,
): boolean {
  if (!e.conToken) return true;
  const base = e.ultimaBuena ?? e.encendidaDesde;
  if (!base) return false;
  const sinBuena = ahora.getTime() - base.getTime();
  const parcialConConexion = e.ultimoError === "parcial" && e.conexionActiva !== false;
  if (parcialConConexion && (e.reponiendo || sinBuena < PARCIAL_TOPE_MS)) return false;
  return sinBuena >= SIN_MANTENER_RETIRA_MS;
}

/** Por qué los eventos de Google dejaron de cerrar la agenda (cada causa dice qué hacer). */
export type CausaRetiro = "desconectada" | "conexion" | "permisos" | "calendario" | "parcial" | "google" | "reponiendo";

/**
 * El aviso del panel (tercera vuelta, N3-G2): los bloqueos de Google SE
 * RETIRARON y todavía no se han repuesto. Sale de los hechos, no del reloj:
 *
 *   · `retiradoDesde`: el primer bloqueo de Google que el cron retiró desde
 *     la última pasada buena (su `deletedAt`: la fecha REAL del retiro).
 *   · `sinToken`: la fila sin syncToken ni última completa, como la deja
 *     el retiro; la primera completa que termina lo vuelve a llenar y el
 *     aviso se va (antes de eso, lo retirado sigue abierto).
 *
 * La causa es la de AHORA: si Google vuelve a contestar, «reponiendo»;
 * si sigue sin poderse, el porqué (desconectada, conexión, permisos,
 * calendario, parcial o un error de Google), cada una con su «qué hacer».
 */
export function avisoDeRetiro(
  e: Parameters<typeof bloqueosSinMantener>[0] & {
    sinToken: boolean;
    retiradoDesde: Date | null;
    /** La conexión tiene un calendario elegido. */
    conCalendario?: boolean;
  },
  ahora: Date,
): { desde: Date; causa: CausaRetiro } | null {
  if (!e.retiradoDesde || !e.sinToken) return null;
  const sigue = bloqueosSinMantener({ ...e, reponiendo: false }, ahora);
  const causa: CausaRetiro = !e.conToken
    ? "desconectada"
    : e.conexionActiva === false || e.ultimoError === "autorizacion" || e.ultimoError === "conexion_caida"
      ? "conexion"
      : e.ultimoError === "permisos"
        ? "permisos"
        : e.conCalendario === false ||
            e.ultimoError === "calendario" || e.ultimoError === "calendario_personal" || e.ultimoError === "calendario_compartido"
          ? "calendario"
          : !sigue
            ? "reponiendo"
            : e.ultimoError === "parcial"
              ? "parcial"
              : "google";
  return { desde: e.retiradoDesde, causa };
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

/**
 * Errores de la sincronización entrante, por clase. Nunca apagan la de salida.
 *   · conexion_caida        — Google rechazó la conexión (también deja de copiar citas).
 *   · calendario_personal   — el calendario guardado no es uno de la clínica (G14).
 *   · calendario_compartido — otra clínica con la bandera usa el mismo calendario (G14).
 *   · parcial               — se acabó el tiempo a media pasada (no es un fallo; frena reintentos).
 */
export type ErrorEntrante =
  | "permisos"
  | "autorizacion"
  | "calendario"
  | "google"
  | "conexion_caida"
  | "calendario_personal"
  | "calendario_compartido"
  | "parcial";

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
