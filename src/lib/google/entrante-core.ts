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
 *   · ¿De quién es el bloqueo? De la persona de la clínica cuyo correo
 *     aparece entre los invitados (`asignarEvento`). Si TODOS los invitados
 *     son de la clínica y ninguno recibe citas (recepción, un doctor dado de
 *     baja), el bloqueo queda a nombre de uno de ellos y no cierra a nadie
 *     más. Sin invitados, con un correo que no se sabe de quién es o con
 *     varios doctores: de toda la clínica, y el panel dice por qué (`alcance`).
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
import { ROLES_QUE_ATIENDEN } from "@/lib/agenda/roles-que-atienden";

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

export function tituloDeEvento(ev: EventoGoogle): string {
  const t = typeof ev.summary === "string" ? ev.summary.replace(/\s+/g, " ").trim() : "";
  return Array.from(t).slice(0, TITULO_MAX).join("");
}

/** Una persona de la clínica (cualquier rol, activa o no) con su correo. */
export interface UsuarioClinica {
  id: string;
  email: string | null;
  /**
   * Otros correos suyos: la cuenta de Google con la que conectó
   * (`users.googleCalendarEmail`, p. ej. el Gmail personal de la doctora).
   * Solo sirven para reconocer a quien RECIBE citas: el Gmail de la clínica
   * que conectó recepción no convierte un evento en «de recepción».
   */
  otrosCorreos?: (string | null)[];
  /** ¿Sale en la agenda y recibe citas? (`RECIBE_CITAS_WHERE`). */
  recibeCitas: boolean;
  /** El rol (desempate y cuentas viejas de un doctor). */
  rol?: string | null;
  /** Nombre y apellido (para reconocer una cuenta vieja de la misma persona). */
  nombre?: string | null;
  /** La cuenta está activa (`users.isActive`). Ausente = sí. */
  activo?: boolean;
}

/** Por qué un bloqueo es de toda la clínica. `null` = es de una persona. */
export type AlcanceGoogle = "sin_invitados" | "no_reconocido" | "varios";

const TITULOS_DE_NOMBRE = /^(dra|dr|doctora|doctor|lic|licda|mtra|mtro|c\.?d|cd)\.?\s+/;

/** «Dra. María  Ruiz» → «maria ruiz» (sin acentos, sin título, espacios simples). */
export function normalizarNombre(s: string | null | undefined): string {
  let t = (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(TITULOS_DE_NOMBRE, "");
  return t.replace(/\./g, " ").replace(/\s+/g, " ").trim();
}

const esRolQueAtiende = (rol: string | null | undefined) => (ROLES_QUE_ATIENDEN as readonly string[]).includes(rol ?? "");

/**
 * Con el correo repetido (una cuenta de baja y la nueva): manda quien recibe
 * citas; luego un DOCTOR (segunda vuelta t8, N-G5); a igualdad, el id menor
 * (que no dependa del orden de la consulta).
 */
function gana(u: UsuarioClinica, previo: UsuarioClinica | undefined): boolean {
  if (!previo) return true;
  if (u.recibeCitas !== previo.recibeCitas) return u.recibeCitas;
  const d = (x: UsuarioClinica) => x.rol === "DOCTOR";
  if (d(u) !== d(previo)) return d(u);
  return u.id < previo.id;
}

/**
 * De quién es el bloqueo (revisión t8, G1, y segunda vuelta, N-G2). Se buscan
 * los invitados entre TODAS las personas de la clínica:
 *
 *   · Un solo doctor que recibe citas → suyo. También si llega por su otro
 *     correo (el Gmail con el que conectó Google), por una cuenta vieja suya
 *     (dada de baja, con su mismo nombre). El nombre que Google muestra de
 *     un correo que no es de nadie NO cuenta (N3-G4). Los invitados de fuera
 *     (un laboratorio, un proveedor) no le quitan el evento.
 *   · Varios doctores que reciben citas → toda la clínica («varios»).
 *   · Ningún doctor que reciba citas y TODOS los invitados son de la clínica
 *     (recepción, un doctor con la agenda apagada) → a nombre de uno de
 *     ellos: no cierra la agenda de nadie más. Una cuenta DADA DE BAJA de
 *     alguien que atendía, si su nombre no es de nadie de hoy, cuenta como
 *     «no se sabe de quién es» (puede ser la cuenta vieja de la doctora).
 *   · Ningún doctor que reciba citas y un correo que no se sabe de quién es
 *     (el Gmail personal de la doctora junto a recepción) → toda la clínica
 *     («no_reconocido»). Nunca «no cierra a nadie» sin saber de quién es.
 *   · Los que rechazaron la invitación cuentan solo si los que no la
 *     rechazaron no dicen nada: un «Quirófano» al que la Dra. dijo que no
 *     sigue siendo de ella, no de toda la clínica.
 *   · Sin invitados → toda la clínica («sin_invitados»).
 *
 * El propio calendario (`self`) y las salas (`resource`) no son invitados.
 */
export function asignarEvento(
  ev: EventoGoogle,
  usuarios: readonly UsuarioClinica[],
): { doctorId: string | null; alcance: AlcanceGoogle | null } {
  const invitados = (ev.attendees ?? []).filter(
    (a) => a && !a.self && !a.resource && typeof a.email === "string" && a.email.trim(),
  );
  if (invitados.length === 0) return { doctorId: null, alcance: "sin_invitados" };

  const porCorreo = new Map<string, UsuarioClinica>();
  const poner = (correo: string | null | undefined, u: UsuarioClinica) => {
    const c = correo?.trim().toLowerCase();
    if (c && gana(u, porCorreo.get(c))) porCorreo.set(c, u);
  };
  for (const u of usuarios) poner(u.email, u);
  // Otros correos: solo de quien atiende, y solo si son de UNA persona (un
  // Gmail compartido no dice de quién es). El correo principal de otra
  // persona manda sobre el «otro correo» de alguien.
  const duenosDeOtro = new Map<string, Set<string>>();
  for (const u of usuarios) {
    if (!u.recibeCitas) continue;
    for (const c of u.otrosCorreos ?? []) {
      const k = c?.trim().toLowerCase();
      if (k) duenosDeOtro.set(k, (duenosDeOtro.get(k) ?? new Set()).add(u.id));
    }
  }
  for (const [k, ids] of duenosDeOtro) {
    if (ids.size !== 1 || porCorreo.has(k)) continue;
    const u = usuarios.find((x) => x.id === [...ids][0]);
    if (u) porCorreo.set(k, u);
  }

  // Los que reciben citas, por nombre (solo si el nombre es de UNA persona).
  // Solo para reconocer una cuenta VIEJA de la clínica (su correo es de aquí),
  // nunca el nombre visible de un invitado (N3-G4).
  const atiendePorNombre = new Map<string, UsuarioClinica | null>();
  for (const u of usuarios) {
    if (!u.recibeCitas) continue;
    const n = normalizarNombre(u.nombre);
    if (!n || !n.includes(" ")) continue;
    atiendePorNombre.set(n, atiendePorNombre.has(n) ? null : u);
  }
  const porNombre = (nombre: string | null | undefined) => {
    const n = normalizarNombre(nombre);
    return (n && atiendePorNombre.get(n)) || null;
  };

  const evaluar = (soloQueAceptan: boolean) => {
    const atienden = new Map<string, UsuarioClinica>();
    const otros = new Map<string, UsuarioClinica>();
    let desconocidos = 0;
    for (const a of invitados) {
      if (soloQueAceptan === (a.responseStatus === "declined")) continue;
      let u: UsuarioClinica | null = porCorreo.get((a.email as string).trim().toLowerCase()) ?? null;
      // Una cuenta vieja (o con la agenda apagada) de quien hoy atiende con otra cuenta.
      if (u && !u.recibeCitas && esRolQueAtiende(u.rol)) {
        const actual = porNombre(u.nombre);
        // Una cuenta DADA DE BAJA de alguien que atendía y cuyo nombre no es de
        // nadie de hoy: puede ser la cuenta vieja de la doctora con otro nombre
        // («María Ruiz» → «María Ruiz Gómez»). No se sabe de quién es.
        u = actual ?? (u.activo === false ? null : u);
      }
      // Un correo que no es de nadie NO se empareja por el nombre que muestra
      // Google: un paciente que se llame igual que la doctora le quitaría el
      // bloqueo al doctor de verdad (tercera vuelta, N3-G4). Solo el correo.
      if (!u) desconocidos++;
      else (u.recibeCitas ? atienden : otros).set(u.id, u);
    }
    return { atienden: [...atienden.values()], otros: [...otros.values()], desconocidos };
  };

  // Un desconocido en un grupo anterior (los que NO rechazaron) también
  // cuenta: «recepción rechazó + el Gmail de la Dra. sin responder» no es de
  // recepción.
  let huboDesconocidos = false;
  for (const g of [evaluar(true), evaluar(false)]) {
    if (g.atienden.length > 1) return { doctorId: null, alcance: "varios" };
    if (g.atienden.length === 1) {
      return huboDesconocidos ? { doctorId: null, alcance: "no_reconocido" } : { doctorId: g.atienden[0].id, alcance: null };
    }
    if (g.otros.length > 0) {
      // Alguien de la clínica, nadie que atienda. Si además hay un correo que
      // no se sabe de quién es, podría ser el del doctor: toda la clínica.
      if (g.desconocidos > 0 || huboDesconocidos) return { doctorId: null, alcance: "no_reconocido" };
      const [primero] = [...g.otros].sort((a, b) => (a.id < b.id ? -1 : 1));
      return { doctorId: primero.id, alcance: null };
    }
    huboDesconocidos = huboDesconocidos || g.desconocidos > 0;
    // Nadie de la clínica en este grupo: se mira el siguiente.
  }
  return { doctorId: null, alcance: "no_reconocido" };
}

/**
 * La «huella» del equipo tal como la ve `asignarEvento`. Si cambia (entra una
 * doctora, alguien enciende «Aparece en la agenda», cambia un correo), la
 * siguiente pasada es COMPLETA y reasigna los eventos que ya estaban; antes
 * seguían con el dueño viejo hasta una semana (segunda vuelta t8, N-G5).
 *
 * Lleva también la versión de la REGLA de `asignarEvento`: al cambiarla
 * (N3-G4: el nombre visible ya no asigna), cada clínica hace una completa y
 * los bloqueos que ya estaban mal asignados se corrigen en la primera pasada.
 */
export const REGLA_ASIGNACION = "3";

export function firmaEquipo(usuarios: readonly UsuarioClinica[]): string {
  const filas = usuarios
    .map((u) =>
      [
        u.id,
        (u.email ?? "").trim().toLowerCase(),
        (u.otrosCorreos ?? []).map((c) => (c ?? "").trim().toLowerCase()).filter(Boolean).sort().join(","),
        u.recibeCitas ? "1" : "0",
        u.activo === false ? "0" : "1",
        u.rol ?? "",
        normalizarNombre(u.nombre),
      ].join("|"),
    )
    .sort();
  // cyrb53: corto, estable y sin `crypto` (este archivo también corre en pruebas puras).
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const texto = [`regla ${REGLA_ASIGNACION}`, ...filas].join("\n");
  for (let i = 0; i < texto.length; i++) {
    const ch = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${filas.length}-${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

/** Compatibilidad: solo el doctor (las pruebas viejas y quien no necesita el porqué). */
export function doctorDelEvento(ev: EventoGoogle, usuarios: readonly UsuarioClinica[]): string | null {
  return asignarEvento(ev, usuarios).doctorId;
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
    usuarios: readonly UsuarioClinica[];
  },
): DecisionEvento {
  const { existente } = ctx;
  const retirar = (): DecisionEvento =>
    existente && existente.activo ? { accion: "inactivar", blockId: existente.blockId } : { accion: "nada" };

  if (esEventoDeDaleControl(ev)) return retirar();
  if (!eventoOcupa(ev)) return retirar();
  const rango = rangoDeEvento(ev, ctx.zona);
  if (!rango) return retirar();

  const quien = asignarEvento(ev, ctx.usuarios);
  const datos: DatosBloqueo = {
    doctorId: quien.doctorId,
    alcance: quien.alcance,
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
