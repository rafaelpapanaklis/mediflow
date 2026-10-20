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
// ese evento es de la clínica, nunca se borra y conserva su título (ver
// `desdeGoogle` y `sincronizarConvertida`).
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
   * t8, G4/G6, y segunda vuelta). Ver `sincronizarConvertida`.
   */
  desdeGoogle?: {
    tituloOriginal: string;
    avisoPendiente: boolean;
    /**
     * La hora del evento la última vez que se LEYÓ (la entrada) o se ESCRIBIÓ
     * (esta salida), y si se vio borrado. Sin ella (bandera apagada,
     * calendario que la entrada no lee) manda DaleControl: nadie avisaría.
     */
    eventoVisto?: { startsAt: Date; endsAt: Date; eliminado: boolean };
    /**
     * Alguien pulsó «Mantener la cita» en el aviso «se eliminó» (y no hay uno
     * nuevo). SOLO entonces se restaura o se vuelve a crear el evento (N-G11).
     */
    mantenerEliminado?: boolean;
  } | null;
}

/** El prefijo del título de un evento de Google cuya cita se canceló en DaleControl. */
export const PREFIJO_CANCELADA = "Cancelada en DaleControl · ";

export function tituloCancelada(original: string): string {
  const t = (original ?? "").trim();
  if (!t) return PREFIJO_CANCELADA.replace(/ · $/, "");
  return t.startsWith(PREFIJO_CANCELADA) ? t : `${PREFIJO_CANCELADA}${t}`;
}

/** El título sin «Cancelada en DaleControl · » (al reactivar la cita). */
export function tituloSinCancelada(titulo: string): string {
  const original = titulo ?? "";
  // Sin el prefijo, tal cual (ni siquiera se recortan espacios: no se reescribe).
  const t0 = original.trim();
  if (!t0.startsWith(PREFIJO_CANCELADA) && t0 !== PREFIJO_CANCELADA.replace(/ · $/, "")) return original;
  let t = original.trim();
  while (t.startsWith(PREFIJO_CANCELADA)) t = t.slice(PREFIJO_CANCELADA.length).trim();
  return t === PREFIJO_CANCELADA.replace(/ · $/, "") ? "" : t;
}

/**
 * Lo que la salida de una cita convertida dejó en Google (estado y hora). El
 * cron compara esta firma con la cita: si no coincide, la copia no llegó (un
 * fallo de red o de base) y se reintenta (segunda vuelta t8, N-G12).
 */
export function firmaSalidaConvertida(c: { status: string; startsAt: Date; endsAt: Date }): string {
  return `${c.status}|${c.startsAt.toISOString()}|${c.endsAt.toISOString()}`;
}

/** Lo que se guarda en el vínculo tras una salida buena de una convertida. */
export interface SalidaConvertida {
  /** null = no firmar (la hora no se copió: el cron debe volver a pasar). */
  firma: string | null;
  /**
   * La hora que quedó en Google tras NUESTRO parche. `antes` = la que se leyó
   * del vínculo: solo se escribe si nadie (la entrada) la cambió mientras.
   */
  visto?: { startsAt: Date; endsAt: Date; antes: { startsAt: Date; endsAt: Date } | null };
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
  /** WS1-T9 · tras una salida buena de una cita convertida (ver `SalidaConvertida`). */
  marcarSalidaConvertida?(clinicId: string, appointmentId: string, googleEventId: string, d: SalidaConvertida): Promise<void>;
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

  const hacer = async (repetida = false): Promise<ResultadoSync> => {
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

    // ── Cita que vino de Google: el evento es de la clínica ─────────────────
    if (cita.desdeGoogle && cita.googleEventId) {
      const r = await sincronizarConvertida(p, {
        cal, clinicId, appointmentId, cita, calendarId, zona: clinica.timezone || "America/Mexico_City",
      });
      // Mientras se copiaba, la cita cambió otra vez (dos cambios casi a la
      // vez): una vuelta más con lo de ahora, para no dejar Google en la hora
      // intermedia ni sacar un aviso falso (segunda vuelta, N-G1).
      if (r === "repetir") return repetida ? { estado: "actualizado" } : hacer(true);
      if (r !== "recrear") return r;
      // Google ya no tiene el evento y «Mantener la cita» pidió que vuelva: uno
      // NUEVO con el id de la cita, sin avisar a nadie (N-G11). Sigue abajo.
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
    // Una convertida solo llega aquí para volver a CREAR su evento tras
    // «Mantener»: uno nuevo, sin invitados (nadie recibe invitación ahora ni
    // cancelación después; N-G11).
    const contenidoFinal = cita.desdeGoogle ? { ...contenido, attendees: [] } : contenido;
    const datos = (cid: string, eventId: string) => ({
      calendarId: cid,
      eventId,
      contenido: contenidoFinal,
      startsAt: cita.startsAt,
      endsAt: cita.endsAt,
      timeZone: clinica.timezone || "America/Mexico_City",
      clinicId,
      appointmentId,
    });

    if (cita.googleEventId && !cita.desdeGoogle) {
      const cid = await asegurarCalendario();
      const r = await parcharEvento(cal, datos(cid, cita.googleEventId));
      if (r === "ok") return { estado: "actualizado" };
      // Google ya no tiene ese evento (o ese calendario): se vuelve a crear, con id determinista.
    }

    // Una cita que ya terminó y nunca estuvo en Google no se sube: sería un evento en el pasado y,
    // si hay invitados, un correo de invitación a una cita que ya pasó (p. ej. al editar una visita vieja).
    if (cita.endsAt.getTime() < (p.ahora?.() ?? new Date()).getTime()) return { estado: "omitido", motivo: "cita_pasada" };

    const eventId = idEventoDeCita(clinicId, appointmentId);
    // Una convertida que se vuelve a crear no manda invitaciones (N-G11).
    const invitar = avisarInvitados && !cita.desdeGoogle;
    let cid = await asegurarCalendario();
    try {
      await insertarEvento(cal, datos(cid, eventId), { avisarInvitados: invitar });
    } catch (err) {
      // 404 al insertar = el calendario guardado ya no existe en Google: se crea uno nuevo y se repite una vez.
      // (Un 403 de permisos NO entra aquí: es un calendario fuera del alcance del permiso; cae en
      // clasificarYMarcar → «permisos» y la clínica ve «Reconectar».)
      if (estadoHttpDeError(err) !== 404) throw err;
      cid = await asegurarCalendario(true);
      await insertarEvento(cal, datos(cid, eventId), { avisarInvitados: invitar });
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
 * WS1-T9 · la salida de una cita que vino de un evento de Google («Convertir
 * en cita»). El evento es de la CLÍNICA, con sus invitados (a veces de fuera:
 * un laboratorio, un proveedor). Por eso (revisión t8 G4/G6 y segunda vuelta):
 *
 *   · Nunca se le cambian la descripción, la ubicación, los invitados ni el
 *     TÍTULO: no se pone «🏥 Procedimiento — paciente», que verían los de
 *     fuera (decisión del gerente, privacidad del paciente). Solo la hora.
 *   · Al cancelar la cita NO se borra ni se avisa a nadie: el título pasa a
 *     «Cancelada en DaleControl · <su título>». Al reactivarla, se le quita.
 *     «No asistió» no lo toca.
 *   · Con un aviso sin decidir («el evento cambió / se eliminó») ni la hora
 *     ni el estado, y no se recrea.
 *   · Antes de copiarle la hora se lee en Google: si cambió (o se borró) y la
 *     entrada aún no lo vio, no se toca; la entrada pondrá el aviso.
 *   · Tras copiarle la hora se GUARDA esa hora como «la última vista» (N-G1):
 *     si no, mover la cita dos veces seguidas dejaba el evento en la hora
 *     intermedia y sacaba un aviso falso («el evento cambió a…»).
 *   · Si Google ya no lo tiene (404) no se crea otro, salvo que «Mantener la
 *     cita» lo haya pedido tras «se eliminó»; y entonces sin invitaciones (N-G11).
 *
 * Devuelve el resultado, o "recrear" para que el llamador cree el evento nuevo.
 */
async function sincronizarConvertida(
  p: Puertos,
  x: {
    cal: ClienteCalendar;
    clinicId: string;
    appointmentId: string;
    cita: CitaParaGoogle;
    calendarId: string | null;
    zona: string;
  },
): Promise<ResultadoSync | "recrear" | "repetir"> {
  const { cal, clinicId, appointmentId, cita, calendarId, zona } = x;
  const dg = cita.desdeGoogle!;
  const eventId = cita.googleEventId!;
  const visto = dg.eventoVisto ?? null;
  /**
   * Anota la salida. `firmar: false` cuando la hora NO se copió porque falta
   * que alguien decida (aviso pendiente) o que la entrada vea un cambio de
   * Google: entonces el cron debe volver a pasar (N-G12, segunda vuelta).
   */
  const hecho = async (
    r: ResultadoSync,
    horaEnGoogle?: { startsAt: Date; endsAt: Date },
    o: { firmar?: boolean; aCiegas?: boolean } = {},
  ): Promise<ResultadoSync> => {
    const firmar = o.firmar !== false;
    if (!p.marcarSalidaConvertida || (!firmar && !horaEnGoogle)) return r;
    try {
      await p.marcarSalidaConvertida(clinicId, appointmentId, eventId, {
        firma: firmar ? firmaSalidaConvertida(cita) : null,
        ...(horaEnGoogle
          ? { visto: { ...horaEnGoogle, antes: visto && !o.aCiegas ? { startsAt: visto.startsAt, endsAt: visto.endsAt } : null } }
          : {}),
      });
    } catch (e) {
      // Google ya quedó bien; sin la marca, el cron lo repasa (idempotente).
      p.log?.("Google Calendar: no se pudo anotar la salida de la cita convertida", e);
    }
    return r;
  };
  // El evento vive en el calendario de la clínica: sin él no hay nada que tocar.
  if (!calendarId) return hecho({ estado: "sin_cambios" });

  try {
    const leido = await leerEvento(cal, calendarId, eventId);
    const ev = leido.estado === "existe" ? leido.ev : null;
    const tituloEnGoogle = ev ? (typeof ev.summary === "string" ? ev.summary : "") : dg.tituloOriginal;
    const borradoEnGoogle = ev?.status === "cancelled";
    const ponerTitulo = async (summary: string, o: { firmar?: boolean } = {}): Promise<ResultadoSync> => {
      if (ev && (ev.summary ?? "") === summary) return hecho({ estado: "sin_cambios" }, undefined, o);
      const r = await parcharTitulo(cal, { calendarId, eventId, summary });
      return hecho({ estado: r === "ok" ? "actualizado" : "sin_cambios" }, undefined, o);
    };

    // ── Cerrada: cancelar solo marca el título; «no asistió» no toca nada.
    if (esCitaCerrada(cita.status)) {
      if (cita.status !== "CANCELLED" || leido.estado === "no_existe" || borradoEnGoogle) return hecho({ estado: "sin_cambios" });
      return ponerTitulo(tituloCancelada(tituloEnGoogle));
    }

    const titulo = tituloSinCancelada(tituloEnGoogle);
    // ── Aviso sin decidir: ni hora ni estado; solo quitar «Cancelada…» si lo tenía.
    if (dg.avisoPendiente) {
      if (leido.estado === "no_existe" || borradoEnGoogle) return hecho({ estado: "sin_cambios" }, undefined, { firmar: false });
      return ponerTitulo(titulo, { firmar: false });
    }

    // ── Google ya no lo tiene, o lo tiene borrado: se queda así, salvo que
    // «Mantener la cita» lo haya pedido después de que la entrada lo viera
    // borrado. Reactivar una cita cuyo evento borraron NO lo resucita.
    const mantener = !!dg.mantenerEliminado && !!visto?.eliminado;
    if (leido.estado === "no_existe" || borradoEnGoogle) {
      if (mantener) {
        if (leido.estado === "no_existe") return "recrear";
      } else {
        // Si la entrada aún no lo vio borrado, pondrá el aviso: el cron vuelve a pasar.
        return hecho({ estado: "sin_cambios" }, undefined, { firmar: !(visto && !visto.eliminado) });
      }
    }

    // Lo movieron en Google y la entrada aún no lo vio: no se deshace.
    if (ev && visto && !borradoEnGoogle && difiereDeLoVisto(ev, visto, cita, zona)) return ponerTitulo(titulo, { firmar: false });

    const horaCita = { startsAt: cita.startsAt, endsAt: cita.endsAt };
    // Ya está como debe (activo, a la hora de la cita, con su título).
    if (ev && !borradoEnGoogle && mismaHora(ev, cita, zona) && (ev.summary ?? "") === titulo) {
      return hecho({ estado: "sin_cambios" }, horaCita);
    }

    const r = await parcharEvento(
      cal,
      {
        calendarId,
        eventId,
        // El contenido no viaja (`conservarContenido`): solo la hora y el estado.
        contenido: { summary: titulo, description: "", attendees: [] },
        startsAt: cita.startsAt,
        endsAt: cita.endsAt,
        timeZone: zona,
        clinicId,
        appointmentId,
      },
      // «Confirmado» solo al restaurar uno borrado: un evento «tentativo» se queda así.
      { conservarContenido: true, titulo: ev && (ev.summary ?? "") === titulo ? null : titulo, restaurar: borradoEnGoogle || !ev },
    );
    if (r === "ok") {
      // ¿La cita se movió OTRA vez mientras se copiaba? Entonces esta copia
      // puede haber llegado a Google después de la más nueva: se anota lo que
      // ESTA escribió (sin firma) y se da otra vuelta, que lee Google y decide.
      const ahora = await p.leerCita(clinicId, appointmentId);
      if (ahora && (ahora.startsAt.getTime() !== cita.startsAt.getTime() || ahora.endsAt.getTime() !== cita.endsAt.getTime())) {
        await hecho({ estado: "actualizado" }, horaCita, { firmar: false, aCiegas: true });
        return "repetir";
      }
      return hecho({ estado: "actualizado" }, horaCita);
    }
    // Lo quitaron entre la lectura y el parche: lo mismo que un 404.
    return mantener ? "recrear" : hecho({ estado: "sin_cambios" }, undefined, { firmar: false });
  } catch (err) {
    // Un 4xx que no se arregla reintentando (p. ej. 403 «solo el organizador
    // puede cambiarlo»): se anota la firma para que el cron NO lo repita cada
    // 5 minutos; el fallo se devuelve igual. 401 (conexión), 404/410 y 429 no.
    // Los 403 de cuota o de permisos NO: pasan solos, o al reconectar.
    const s = estadoHttpDeError(err);
    const razon = razonDeError(err) ?? "";
    const pasajero = /rateLimit|RateLimit|quota|Quota|dailyLimit|insufficientPermissions|accessNotConfigured|backendError/.test(razon);
    if ((s === 400 || s === 403 || s === 409 || s === 412) && !pasajero) await hecho({ estado: "sin_cambios" });
    throw err;
  }
}

type EventoLeido = { estado: "existe"; ev: Record<string, any> } | { estado: "no_existe" } | { estado: "sin_lectura" };

/** Lee el evento tal como está en Google. 404/410 = ya no existe. */
async function leerEvento(cal: ClienteCalendar, calendarId: string, eventId: string): Promise<EventoLeido> {
  if (!cal.events.get) return { estado: "sin_lectura" };
  try {
    return { estado: "existe", ev: (await cal.events.get({ calendarId, eventId })).data ?? {} };
  } catch (err) {
    const s = estadoHttpDeError(err);
    if (s === 404 || s === 410) return { estado: "no_existe" };
    throw err;
  }
}

/**
 * La hora del evento en INSTANTES. De todo el día, la medianoche de la clínica
 * (igual que lo guarda la entrada): así un evento pasado a «todo el día» y
 * luego «Mantenido» sí vuelve a la hora de la cita.
 */
function horaDeEvento(ev: Record<string, any>, zona: string): { ini: Date; fin: Date } | null {
  const instante = (f: any): Date | null =>
    typeof f?.dateTime === "string"
      ? new Date(f.dateTime)
      : typeof f?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.date)
        ? tzLocalToUtc(f.date, 0, 0, zona)
        : null;
  const ini = instante(ev.start);
  const fin = instante(ev.end);
  if (!ini || !fin || Number.isNaN(ini.getTime()) || Number.isNaN(fin.getTime())) return null;
  return { ini, fin };
}

function mismaHora(ev: Record<string, any>, c: { startsAt: Date; endsAt: Date }, zona: string): boolean {
  if (typeof ev.start?.dateTime !== "string") return false; // todo el día nunca es «la hora de la cita»
  const h = horaDeEvento(ev, zona);
  return !!h && h.ini.getTime() === c.startsAt.getTime() && h.fin.getTime() === c.endsAt.getTime();
}

/**
 * ¿El evento (vivo) cambió de hora en Google DESPUÉS de la última vista, y no
 * está ya a la hora de la cita? Entonces copiarle la hora lo devolvería atrás
 * sin aviso (revisión t8).
 */
function difiereDeLoVisto(
  ev: Record<string, any>,
  visto: { startsAt: Date; endsAt: Date },
  cita: { startsAt: Date; endsAt: Date },
  zona: string,
): boolean {
  const h = horaDeEvento(ev, zona);
  // Sin fecha legible la entrada tampoco avisaría: manda DaleControl (si no,
  // el cron lo leería cada 5 minutos sin llegar a nada).
  if (!h) return false;
  const igual = (a: Date, b: Date, c: Date, d: Date) => a.getTime() === c.getTime() && b.getTime() === d.getTime();
  if (igual(h.ini, h.fin, cita.startsAt, cita.endsAt)) return false;
  return !igual(h.ini, h.fin, visto.startsAt, visto.endsAt);
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
