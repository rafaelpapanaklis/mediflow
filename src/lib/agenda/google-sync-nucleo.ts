// Núcleo de la sincronización de citas con Google Calendar.
//
// UN punto común: cada ruta que crea, mueve, cancela, marca no-asistió o
// reactiva una cita llama a `sincronizarCita(clinicId, citaId)` y ya. La función
// mira cómo está la cita AHORA y deja a Google igual:
//
//   · cita activa, con evento        → lo pone al día (events.patch)
//   · cita activa, sin evento        → lo crea con id determinista (sin duplicar)
//   · cita cancelada / no asistió    → borra el evento y limpia el id
//
// Salvo una cita que VINO de un evento de Google («Convertir en cita», WS1-T9):
// ese evento es de la clínica y nunca se borra (ver `desdeGoogle`).
//
// Es idempotente: repetirla, reintentarla o llamarla desde dos rutas a la vez
// converge al mismo estado. Por eso también sirve para «Sincronizar citas
// futuras».
//
// Sin imports de Prisma ni de Next: la base, el cliente de Google y lo que t12
// decide (qué datos viajan, si la conexión está caída) entran como `Puertos`,
// para probarlo con una Google falsa.

import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import {
  borrarEvento,
  asegurarCalendarioDeClinica,
  estadoHttpDeError,
  idEventoDeCita,
  insertarEvento,
  parcharEvento,
  parcharTitulo,
  razonDeError,
  type ClienteCalendar,
  type ContenidoEvento,
} from "@/lib/google-calendar";

export const ESTADOS_CERRADOS = ["CANCELLED", "NO_SHOW"] as const;
export const esCitaCerrada = (status: string) => (ESTADOS_CERRADOS as readonly string[]).includes(status);

/** Tiempo máximo de UNA sincronización completa (varias llamadas a Google). */
export const LIMITE_SYNC_MS = 12_000;

export interface ClinicaGoogle {
  id: string;
  name: string;
  address: string | null;
  timezone: string;
  enabled: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  calendarId: string | null;
}

export interface CitaParaGoogle {
  id: string;
  type: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  googleEventId: string | null;
  patientName: string;
  doctorName: string | null;
  doctorEmail: string | null;
  patientEmail: string | null;
  /**
   * WS1-T9 · la cita vino de un evento de Google y sigue ligada a él (revisión
   * t8, G4/G6). Entonces:
   *   · nunca se le pisan la descripción, la ubicación ni los invitados;
   *   · con un aviso sin decidir («el evento cambió / se eliminó») solo se
   *     toca el título: ni la hora ni el estado, y no se recrea;
   *   · al cancelar NO se borra ni se avisa a sus invitados: el título pasa a
   *     «Cancelada en DaleControl · <título original>»;
   *   · al marcar «no asistió» se deja como está;
   *   · antes de copiarle la hora se mira cómo está en Google: si cambió (o se
   *     borró) y la entrada aún no lo vio, solo el título; la entrada pondrá
   *     el aviso en vez de que el parche lo deshaga sin que nadie decida.
   */
  desdeGoogle?: {
    tituloOriginal: string;
    avisoPendiente: boolean;
    /** La hora del evento la última vez que la entrada lo leyó, y si lo vio borrado. */
    eventoVisto?: { startsAt: Date; endsAt: Date; eliminado: boolean };
  } | null;
}

/** El prefijo del título de un evento de Google cuya cita se canceló en DaleControl. */
export const PREFIJO_CANCELADA = "Cancelada en DaleControl · ";

export function tituloCancelada(original: string): string {
  const t = (original ?? "").trim();
  if (!t) return PREFIJO_CANCELADA.replace(/ · $/, "");
  return t.startsWith(PREFIJO_CANCELADA) ? t : `${PREFIJO_CANCELADA}${t}`;
}

export interface EntradaContenido {
  type: string;
  patientName: string;
  doctorName: string | null;
  clinicName: string;
  clinicAddress: string | null;
  doctorEmail: string | null;
  patientEmail: string | null;
  invitarPaciente: boolean;
}

export interface Puertos {
  leerClinica(clinicId: string): Promise<ClinicaGoogle | null>;
  leerAjustes(clinicId: string): Promise<{ invitarPaciente: boolean; caidoDesde: Date | null }>;
  /** Guarda el access token renovado, SOLO si la clínica sigue con ese refresh token. */
  guardarAccessToken(clinicId: string, refreshToken: string, accessToken: string): Promise<void>;
  /**
   * Fija el calendario de la clínica SOLO si sigue como `esperado` (null = aún
   * sin calendario; un id = el que se acaba de descubrir roto). Devuelve el id
   * que quedó guardado: el nuestro, o el de quien llegó antes (otra petición a
   * la vez), para que todas usen el mismo y no se creen calendarios de más.
   */
  fijarCalendarioId(clinicId: string, calendarId: string, esperado: string | null): Promise<string>;
  leerCita(clinicId: string, appointmentId: string): Promise<CitaParaGoogle | null>;
  guardarEventoId(clinicId: string, appointmentId: string, eventId: string | null): Promise<void>;
  abrirCalendar(cred: { accessToken: string | null; refreshToken: string; alRenovarToken: (t: string) => void }): ClienteCalendar;
  armarContenido(d: EntradaContenido): ContenidoEvento;
  esErrorDeAutorizacion(err: unknown): boolean;
  marcarCaido(clinicId: string, motivo: string): Promise<void>;
  log?(...args: unknown[]): void;
  /** El reloj (las pruebas lo fijan). */
  ahora?(): Date;
}

export type MotivoOmitida = "no_conectada" | "conexion_caida" | "cita_no_existe" | "sin_calendario" | "cita_pasada";

export type ResultadoSync =
  | { estado: "creado" | "actualizado" | "borrado" | "sin_cambios" }
  | { estado: "omitido"; motivo: MotivoOmitida }
  | { estado: "fallo"; motivo: string };

export interface OpcionesSync {
  /** Que Google mande correo a los invitados (invitación / cancelación). Por defecto sí. */
  avisarInvitados?: boolean;
  limiteMs?: number;
}

/** Corta la espera a `ms`; el trabajo que quede en vuelo sigue solo y no lanza. */
async function conLimite<T>(trabajo: Promise<T>, ms: number): Promise<T | "tiempo"> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const plazo = new Promise<"tiempo">((res) => { t = setTimeout(() => res("tiempo"), ms); });
  trabajo.catch(() => undefined);
  try {
    return await Promise.race([trabajo, plazo]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * Sync apagado: `marcarGoogleCaido` lo apaga CONSERVANDO el refresh token; una
 * desconexión a propósito lo borra. Con token guardado = conexión caída.
 */
function motivoDeNoConectada(clinica: ClinicaGoogle | null): "no_conectada" | "conexion_caida" {
  return clinica && !clinica.enabled && clinica.refreshToken ? "conexion_caida" : "no_conectada";
}

/** Búsquedas/creaciones de calendario en vuelo, por clínica (y calendario que se reemplaza). */
const creandoCalendario = new Map<string, Promise<string>>();

class ErrorDeSync extends Error {
  constructor(public motivo: string, causa?: unknown) {
    super(motivo);
    this.cause = causa;
  }
}

export async function sincronizarCita(
  p: Puertos,
  clinicId: string,
  appointmentId: string,
  opts: OpcionesSync = {},
): Promise<ResultadoSync> {
  if (!clinicId || !appointmentId) return { estado: "omitido", motivo: "cita_no_existe" };
  const avisarInvitados = opts.avisarInvitados ?? true;
  const pendientes: Promise<unknown>[] = [];

  const hacer = async (): Promise<ResultadoSync> => {
    const clinica = await p.leerClinica(clinicId);
    if (!clinica?.enabled || !clinica.refreshToken) return { estado: "omitido", motivo: motivoDeNoConectada(clinica) };
    const refreshToken = clinica.refreshToken;

    const ajustes = await p.leerAjustes(clinicId);
    // Conexión marcada como caída: no se martilla a Google con un permiso que
    // ya no vale. Al reconectar se limpia y «Sincronizar citas futuras» repone.
    if (ajustes.caidoDesde) return { estado: "omitido", motivo: "conexion_caida" };

    const cita = await p.leerCita(clinicId, appointmentId);
    if (!cita) return { estado: "omitido", motivo: "cita_no_existe" };

    const cal = p.abrirCalendar({
      accessToken: clinica.accessToken,
      refreshToken,
      alRenovarToken: (t) => {
        pendientes.push(p.guardarAccessToken(clinicId, refreshToken, t).catch((e) => p.log?.("Google Calendar: no se pudo guardar el token renovado", e)));
      },
    });

    let calendarId = clinica.calendarId;
    const asegurarCalendario = async (forzar = false): Promise<string> => {
      if (calendarId && !forzar) return calendarId;
      const esperado = calendarId;
      try {
        // Varias sincronizaciones a la vez de la misma clínica (citas seguidas,
        // el botón en bloque) comparten UNA sola creación.
        // (Aquí nunca hay id guardado que verificar: o no había, o acaba de fallar.)
        const clave = `${clinicId}|${esperado ?? ""}`;
        let enCurso = creandoCalendario.get(clave);
        if (!enCurso) {
          enCurso = (async () => {
            const r = await asegurarCalendarioDeClinica(cal, { clinicId, clinicName: clinica.name, timezone: clinica.timezone });
            const fijado = await p.fijarCalendarioId(clinicId, r.id, esperado);
            // Otra petición (otra instancia) se nos adelantó con otro calendario: usamos el suyo
            // y el que acabamos de crear sobra.
            if (fijado !== r.id && r.creado) {
              try { await cal.calendars.delete({ calendarId: r.id }); } catch (e) { p.log?.("Google Calendar: no se pudo quitar un calendario duplicado", e); }
            }
            return fijado;
          })().finally(() => creandoCalendario.delete(clave));
          creandoCalendario.set(clave, enCurso);
        }
        calendarId = await enCurso;
        return calendarId;
      } catch (err) {
        throw new ErrorDeSync("calendario", err);
      }
    };

    // ── Cita que vino de Google y se cerró: el evento se queda ──────────────
    if (esCitaCerrada(cita.status) && cita.desdeGoogle && cita.googleEventId) {
      if (!calendarId || cita.status !== "CANCELLED") return { estado: "sin_cambios" };
      const r = await parcharTitulo(cal, {
        calendarId,
        eventId: cita.googleEventId,
        summary: tituloCancelada(cita.desdeGoogle.tituloOriginal),
      });
      return { estado: r === "ok" ? "actualizado" : "sin_cambios" };
    }

    // ── Cita cerrada: fuera del calendario ───────────────────────────────────
    if (esCitaCerrada(cita.status)) {
      // Sin calendario propio nunca se creó nada ahí. Con él, y aunque la cita
      // no tenga id guardado, se intenta por el id determinista: un alta en
      // segundo plano pudo crear el evento justo antes de cancelar.
      if (!calendarId) {
        if (cita.googleEventId) await p.guardarEventoId(clinicId, appointmentId, null);
        return { estado: "omitido", motivo: "sin_calendario" };
      }
      const eventId = cita.googleEventId ?? idEventoDeCita(clinicId, appointmentId);
      const r = await borrarEvento(cal, { calendarId, eventId }, { avisarInvitados });
      if (cita.googleEventId) await p.guardarEventoId(clinicId, appointmentId, null);
      return { estado: r === "borrado" ? "borrado" : "sin_cambios" };
    }

    // ── Cita activa: el evento tiene que existir y estar al día ─────────────
    const contenido = p.armarContenido({
      type: cita.type,
      patientName: cita.patientName,
      doctorName: cita.doctorName,
      clinicName: clinica.name,
      clinicAddress: clinica.address,
      doctorEmail: cita.doctorEmail,
      patientEmail: cita.patientEmail,
      invitarPaciente: ajustes.invitarPaciente,
    });
    const datos = (cid: string, eventId: string) => ({
      calendarId: cid,
      eventId,
      contenido,
      startsAt: cita.startsAt,
      endsAt: cita.endsAt,
      timeZone: clinica.timezone || "America/Mexico_City",
      clinicId,
      appointmentId,
    });

    if (cita.googleEventId && cita.desdeGoogle?.avisoPendiente) {
      // Hay un «¿Mover / Cancelar la cita?» sin decidir: si aquí se parchara la
      // hora, el evento volvería a la de la cita y el aviso desaparecería sin
      // que nadie decidiera (G4). Solo el título; tampoco se recrea.
      const cid = await asegurarCalendario();
      const r = await parcharTitulo(cal, { calendarId: cid, eventId: cita.googleEventId, summary: contenido.summary });
      return { estado: r === "ok" ? "actualizado" : "sin_cambios" };
    }

    if (cita.googleEventId && cita.desdeGoogle?.eventoVisto && cal.events.get) {
      const cid = await asegurarCalendario();
      if (await cambioQueLaEntradaNoVio(cal, cid, cita.googleEventId, cita.desdeGoogle.eventoVisto, cita, clinica.timezone || "America/Mexico_City")) {
        const r = await parcharTitulo(cal, { calendarId: cid, eventId: cita.googleEventId, summary: contenido.summary });
        return { estado: r === "ok" ? "actualizado" : "sin_cambios" };
      }
    }

    if (cita.googleEventId) {
      const cid = await asegurarCalendario();
      const r = await parcharEvento(cal, datos(cid, cita.googleEventId), { conservarDescripcion: !!cita.desdeGoogle });
      if (r === "ok") return { estado: "actualizado" };
      // Google ya no tiene ese evento (o ese calendario): se vuelve a crear, con id determinista.
    }

    // Una cita que ya terminó y nunca estuvo en Google no se sube: sería un evento en el pasado y,
    // si hay invitados, un correo de invitación a una cita que ya pasó (p. ej. al editar una visita vieja).
    if (cita.endsAt.getTime() < (p.ahora?.() ?? new Date()).getTime()) return { estado: "omitido", motivo: "cita_pasada" };

    const eventId = idEventoDeCita(clinicId, appointmentId);
    let cid = await asegurarCalendario();
    try {
      await insertarEvento(cal, datos(cid, eventId), { avisarInvitados });
    } catch (err) {
      // 404 al insertar = el calendario guardado ya no existe en Google: se crea uno nuevo y se repite una vez.
      // (Un 403 de permisos NO entra aquí: es un calendario fuera del alcance del permiso; cae en
      // clasificarYMarcar → «permisos» y la clínica ve «Reconectar».)
      if (estadoHttpDeError(err) !== 404) throw err;
      cid = await asegurarCalendario(true);
      await insertarEvento(cal, datos(cid, eventId), { avisarInvitados });
    }
    await p.guardarEventoId(clinicId, appointmentId, eventId);
    return { estado: "creado" };
  };

  try {
    const r = await conLimite(hacer(), opts.limiteMs ?? LIMITE_SYNC_MS);
    if (r === "tiempo") return { estado: "fallo", motivo: "tiempo" };
    return r;
  } catch (err) {
    const causa = err instanceof ErrorDeSync ? err.cause : err;
    const motivo = await clasificarYMarcar(p, clinicId, err instanceof ErrorDeSync ? err.motivo : "google", causa);
    p.log?.(`Google Calendar: no se pudo sincronizar la cita ${appointmentId} (${motivo}):`, causa);
    return { estado: "fallo", motivo };
  } finally {
    await Promise.allSettled(pendientes);
  }
}

/**
 * WS1-T9 · ¿El evento de la clínica cambió en Google (hora, o borrado) DESPUÉS
 * de la última lectura, y no está ya a la hora de la cita? Entonces copiarle la
 * hora lo devolvería atrás sin aviso (revisión t8). Un evento que Google ya no
 * tiene (404/410) no cuenta aquí: lo resuelve el parche de siempre.
 */
async function cambioQueLaEntradaNoVio(
  cal: ClienteCalendar,
  calendarId: string,
  eventId: string,
  visto: { startsAt: Date; endsAt: Date; eliminado: boolean },
  cita: { startsAt: Date; endsAt: Date },
  zona: string,
): Promise<boolean> {
  let ev: Record<string, any>;
  try {
    ev = (await cal.events.get!({ calendarId, eventId })).data ?? {};
  } catch (err) {
    const s = estadoHttpDeError(err);
    if (s === 404 || s === 410) return false;
    throw err;
  }
  if (ev.status === "cancelled") return !visto.eliminado;
  // Con hora, el instante; de todo el día, la medianoche de la clínica (igual
  // que lo guarda la entrada): así un evento pasado a «todo el día» y luego
  // «Mantenido» sí vuelve a la hora de la cita.
  const instante = (f: any): Date | null =>
    typeof f?.dateTime === "string"
      ? new Date(f.dateTime)
      : typeof f?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.date)
        ? tzLocalToUtc(f.date, 0, 0, zona)
        : null;
  const ini = instante(ev.start);
  const fin = instante(ev.end);
  if (!ini || !fin || Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime())) return true;
  const igual = (a: Date, b: Date, c: Date, d: Date) => a.getTime() === c.getTime() && b.getTime() === d.getTime();
  if (igual(ini, fin, cita.startsAt, cita.endsAt)) return false;
  return !igual(ini, fin, visto.startsAt, visto.endsAt);
}

/**
 * Qué clase de fallo fue y, si es de los que no se arreglan reintentando
 * (permiso revocado, API apagada, calendario imposible de crear), marca la
 * conexión como caída para que la clínica lo vea. Los transitorios (red,
 * tiempo, 5xx, cuota) no marcan nada.
 */
async function clasificarYMarcar(p: Puertos, clinicId: string, motivoBase: string, err: unknown): Promise<string> {
  const razon = razonDeError(err);
  const http = estadoHttpDeError(err);
  let marca: string | null = null;
  // «permisos» va antes que «autorizacion»: un 403 insufficientPermissions también es un fallo de
  // autorización, pero aquí se sabe más —al token le falta alcance (p. ej. un calendario que el
  // permiso estrecho `calendar.app.created` no cubre)— y la pantalla lo dice mejor.
  if (razon === "insufficientPermissions") marca = "permisos";
  else if (p.esErrorDeAutorizacion(err)) marca = "autorizacion";
  else if (razon === "accessNotConfigured") marca = "api_no_habilitada";
  else if (motivoBase === "calendario" && http !== null && http >= 400 && http < 500 && http !== 429) marca = "calendario";
  if (marca) {
    try { await p.marcarCaido(clinicId, marca); } catch { /* marcarCaido no debe lanzar; por si acaso */ }
    return marca;
  }
  return motivoBase;
}

// ── En bloque: «Sincronizar citas futuras» ───────────────────────────────────

export interface PuertosEnBloque extends Puertos {
  /** Ids de citas futuras, activas y SIN evento, por fecha (las más próximas primero). */
  listarFuturasSinEvento(clinicId: string, desde: Date, tope: number): Promise<string[]>;
  contarFuturasConEvento(clinicId: string, desde: Date): Promise<number>;
  contarFuturasSinEvento(clinicId: string, desde: Date): Promise<number>;
}

export interface ResultadoEnBloque {
  creadas: number;
  /** Futuras que ya tenían su evento: no se tocaron. */
  omitidas: number;
  fallidas: number;
  /** Sin evento que aún no se intentaron (se agotó el tiempo o el tope): pulsar de nuevo. */
  restantes: number;
  motivo?: "no_conectada" | "conexion_caida" | "error";
}

export const PRESUPUESTO_EN_BLOQUE_MS = 45_000;
const TOPE_POR_PASADA = 400;
const CONCURRENCIA = 4;

/**
 * Sube a Google las citas futuras que no tienen evento (las creadas antes de
 * conectar, o mientras la conexión estuvo caída). Idempotente: lo que ya tiene
 * evento no se toca y un evento que existiera sin id guardado se reconoce por
 * su id determinista. No manda correos de invitación (sendUpdates none): si no,
 * la clínica dispararía cientos de invitaciones a pacientes de golpe.
 */
export async function sincronizarFuturas(
  p: PuertosEnBloque,
  clinicId: string,
  opts: { ahora?: Date; presupuestoMs?: number } = {},
): Promise<ResultadoEnBloque> {
  const vacio = (motivo?: ResultadoEnBloque["motivo"]): ResultadoEnBloque => ({ creadas: 0, omitidas: 0, fallidas: 0, restantes: 0, ...(motivo ? { motivo } : {}) });
  const clinica = await p.leerClinica(clinicId);
  if (!clinica?.enabled || !clinica.refreshToken) return vacio(motivoDeNoConectada(clinica));
  if ((await p.leerAjustes(clinicId)).caidoDesde) return vacio("conexion_caida");

  const desde = opts.ahora ?? new Date();
  const limite = Date.now() + (opts.presupuestoMs ?? PRESUPUESTO_EN_BLOQUE_MS);
  const ids = await p.listarFuturasSinEvento(clinicId, desde, TOPE_POR_PASADA);

  const r = vacio();
  // Las que ya tenían evento se cuentan ANTES: son las que no se tocaron.
  r.omitidas = await p.contarFuturasConEvento(clinicId, desde);
  let i = 0;
  let cortada = false;
  const obrero = async () => {
    while (i < ids.length) {
      if (Date.now() >= limite) { cortada = true; return; }
      const id = ids[i++];
      const res = await sincronizarCita(p, clinicId, id, { avisarInvitados: false });
      if (res.estado === "creado" || res.estado === "actualizado") r.creadas++;
      else if (res.estado === "fallo") r.fallidas++;
      // Si la conexión se cayó a media pasada, las demás saldrían igual: se corta.
      if (res.estado === "fallo" && ["autorizacion", "permisos", "api_no_habilitada", "calendario"].includes(res.motivo)) {
        i = ids.length;
        cortada = true;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, ids.length) }, obrero));

  const sinEvento = await p.contarFuturasSinEvento(clinicId, desde);
  // Las que fallaron siguen sin evento: no son «restantes», son `fallidas`.
  r.restantes = Math.max(0, sinEvento - r.fallidas);
  if (!cortada && ids.length < TOPE_POR_PASADA) r.restantes = 0;
  return r;
}
