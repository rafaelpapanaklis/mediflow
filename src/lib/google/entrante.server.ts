/**
 * GOOGLE CALENDAR → AGENDA contra la base y la Google real (WS1-T9).
 *
 * La lógica vive en `entrante-nucleo.ts` (sincronización) y `entrante-core.ts`
 * (decisiones). Aquí se conectan sus puertos a Prisma y a googleapis, y se
 * exponen lo que usan las rutas:
 *
 *   · banderaGoogleEncendida(clinicId)          — ¿la clínica tiene esto?
 *   · sincronizarCalendarioEntrante(clinicId)   — una pasada; nunca lanza
 *   · asegurarCanalDeAvisos(clinicId)           — crea/renueva el canal de Google
 *   · clinicasConGoogleEntrante()               — para el cron
 *   · retirarBloqueosDeGoogle(clinicId)         — bandera apagada, Google desconectado
 *                                                 o caído más de un día
 *   · clinicasSinBanderaConBloqueos()           — para que el cron las limpie
 *
 * 🔴 Regla (c): toda consulta lleva `clinicId`, y una función sin él corta
 * antes de consultar.
 */

import crypto from "crypto";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { getOAuthClient, TIMEOUT_GOOGLE_MS } from "@/lib/google-calendar";
import { puedeRecibirCitas } from "@/lib/agenda/roles-que-atienden";
import { leerAjustesGoogle, marcarGoogleCaido } from "@/lib/google-calendar-estado";
import { tablasGoogleListas } from "./tablas.server";
import {
  canalPorRenovar,
  CREADOR_GOOGLE,
  direccionDelAviso,
  MOTIVO_GOOGLE,
  TTL_CANAL_S,
  type DatosBloqueo,
} from "./entrante-core";
import {
  sincronizarEntrante,
  type ClienteCalendarEntrante,
  type PuertosEntrante,
  type ResultadoEntrante,
  type VinculoLeido,
} from "./entrante-nucleo";

export type { ResultadoEntrante } from "./entrante-nucleo";

const idValido = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

// ═══════════════════════════════════════════════════════════════════════
// LA BANDERA
// ═══════════════════════════════════════════════════════════════════════

/** ¿La clínica tiene «Google Calendar → agenda» encendido? Sin SQL o sin fila: no. Nunca lanza. */
export async function banderaGoogleEncendida(clinicId: string): Promise<boolean> {
  if (!idValido(clinicId)) return false;
  if (!(await tablasGoogleListas())) return false;
  try {
    const f = await prisma.googleAgendaImport.findUnique({ where: { clinicId }, select: { enabled: true } });
    return f?.enabled === true;
  } catch (e) {
    console.error("[google-entrante] no se pudo leer la bandera:", (e as any)?.message ?? e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// EL CLIENTE DE GOOGLE
// ═══════════════════════════════════════════════════════════════════════

function abrirCalendarEntrante(cred: {
  accessToken: string | null;
  refreshToken: string;
  alRenovarToken?: (t: string) => void;
}): ClienteCalendarEntrante {
  const oauth = getOAuthClient({ timeoutMs: TIMEOUT_GOOGLE_MS });
  oauth.setCredentials({
    ...(cred.accessToken ? { access_token: cred.accessToken } : {}),
    refresh_token: cred.refreshToken,
  });
  if (cred.alRenovarToken) {
    const avisar = cred.alRenovarToken;
    oauth.on("tokens", (t) => { if (t.access_token) avisar(t.access_token); });
  }
  return google.calendar({ version: "v3", auth: oauth, timeout: TIMEOUT_GOOGLE_MS }) as unknown as ClienteCalendarEntrante;
}

async function guardarAccessToken(clinicId: string, refreshToken: string, accessToken: string) {
  // Solo si la clínica sigue con el MISMO refresh token (igual que la salida).
  await prisma.clinic.updateMany({
    where: { id: clinicId, googleRefreshToken: refreshToken },
    data: { googleCalendarToken: accessToken },
  });
}

async function leerConexion(clinicId: string) {
  const c = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      timezone: true,
      googleCalendarEnabled: true,
      googleCalendarToken: true,
      googleRefreshToken: true,
      googleClinicCalendarId: true,
    },
  });
  if (!c) return null;
  return {
    enabled: c.googleCalendarEnabled === true,
    accessToken: c.googleCalendarToken,
    refreshToken: c.googleRefreshToken,
    calendarId: c.googleClinicCalendarId,
    timezone: c.timezone,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LOS PUERTOS
// ═══════════════════════════════════════════════════════════════════════

const SELECT_VINCULO = {
  blockId: true,
  googleEventId: true,
  recurringEventId: true,
  title: true,
  allDay: true,
  alcance: true,
  appointmentId: true,
  eventStartsAt: true,
  eventEndsAt: true,
  eventDeletedAt: true,
  avisoTipo: true,
} as const;

/** Une los vínculos con sus bloqueos (dos lecturas, sin relación de Prisma). */
async function vinculosConBloqueo(clinicId: string, filas: any[]): Promise<VinculoLeido[]> {
  if (filas.length === 0) return [];
  const bloques = await prisma.agendaBlock.findMany({
    where: { clinicId, id: { in: filas.map((f) => f.blockId) } },
    select: { id: true, doctorId: true, startsAt: true, endsAt: true, deletedAt: true },
  });
  const porId = new Map(bloques.map((b) => [b.id, b]));
  const out: VinculoLeido[] = [];
  for (const f of filas) {
    const b = porId.get(f.blockId);
    if (!b) continue;
    out.push({
      blockId: f.blockId,
      googleEventId: f.googleEventId,
      recurringEventId: f.recurringEventId ?? null,
      activo: b.deletedAt === null,
      doctorId: b.doctorId,
      alcance: (f.alcance ?? null) as VinculoLeido["alcance"],
      startsAt: b.startsAt,
      endsAt: b.endsAt,
      title: f.title,
      allDay: f.allDay,
      appointmentId: f.appointmentId ?? null,
      eventStartsAt: f.eventStartsAt,
      eventEndsAt: f.eventEndsAt,
      eventDeletedAt: f.eventDeletedAt ?? null,
      avisoTipo: f.avisoTipo ?? null,
    });
  }
  return out;
}

const esUnicoRepetido = (e: unknown) => (e as { code?: string })?.code === "P2002";

const puertos: PuertosEntrante = {
  async leerEstado(clinicId) {
    if (!(await tablasGoogleListas())) return null;
    const f = await prisma.googleAgendaImport.findUnique({ where: { clinicId } });
    if (!f) return null;
    return {
      enabled: f.enabled,
      calendarId: f.calendarId,
      syncToken: f.syncToken,
      lastFullSyncAt: f.lastFullSyncAt,
      lastSyncAt: f.lastSyncAt,
      channelId: f.channelId,
      channelResourceId: f.channelResourceId,
      channelExpiresAt: f.channelExpiresAt,
      channelCalendarId: f.channelCalendarId,
    };
  },

  leerConexion,

  async tomarTurno(clinicId, hasta) {
    const ahora = new Date();
    const r = await prisma.googleAgendaImport.updateMany({
      where: { clinicId, OR: [{ leaseUntil: null }, { leaseUntil: { lt: ahora } }] },
      data: { leaseUntil: hasta, dirtyAt: null },
    });
    return r.count > 0;
  },

  async soltarTurno(clinicId) {
    // Una sola sentencia: soltar y leer «sucio» a la vez. En dos, un aviso que
    // llegara entre ambas se perdería hasta el cron.
    const filas = (await prisma.$queryRaw`
      UPDATE google_agenda_imports SET "leaseUntil" = NULL
       WHERE "clinicId" = ${clinicId}
      RETURNING "dirtyAt"`) as { dirtyAt: Date | null }[];
    return !!filas[0]?.dirtyAt;
  },

  async renovarTurno(clinicId, hasta) {
    await prisma.googleAgendaImport.updateMany({ where: { clinicId, leaseUntil: { not: null } }, data: { leaseUntil: hasta } });
  },

  async marcarSucio(clinicId) {
    await prisma.googleAgendaImport.updateMany({ where: { clinicId }, data: { dirtyAt: new Date() } });
  },

  async guardarProgreso(clinicId, d) {
    await prisma.googleAgendaImport.updateMany({
      where: { clinicId },
      data: {
        calendarId: d.calendarId,
        syncToken: d.syncToken,
        lastSyncAt: d.ahora,
        ...(d.completa ? { lastFullSyncAt: d.ahora } : {}),
      },
    });
  },

  async guardarError(clinicId, error) {
    await prisma.googleAgendaImport.updateMany({
      where: { clinicId },
      data: error ? { lastError: error, lastErrorAt: new Date() } : { lastError: null, lastErrorAt: null },
    });
  },

  abrirCalendar: (cred) => abrirCalendarEntrante(cred),
  guardarAccessToken,

  async leerUsuarios(clinicId) {
    // TODAS las personas de la clínica (también recepción, dados de baja y con
    // la agenda apagada): si el invitado es una de ellas, el bloqueo es suyo y
    // no cierra la clínica entera (revisión t8, G1).
    const us = await prisma.user.findMany({
      where: { clinicId },
      select: { id: true, email: true, role: true, isActive: true, agendaActive: true },
      take: 1000,
    });
    return us.map((u) => ({ id: u.id, email: u.email ?? null, recibeCitas: puedeRecibirCitas(u) }));
  },

  async calendarioEnOtraClinica(clinicId, calendarId) {
    const otras = await prisma.clinic.findMany({
      where: { googleClinicCalendarId: calendarId, id: { not: clinicId } },
      select: { id: true },
      take: 20,
    });
    if (otras.length === 0) return false;
    const conBandera = await prisma.googleAgendaImport.count({
      where: { clinicId: { in: otras.map((o) => o.id) }, enabled: true },
    });
    return conBandera > 0;
  },

  async leerVinculos(clinicId, calendarId, eventIds) {
    if (eventIds.length === 0) return [];
    const filas = await prisma.agendaBlockGoogle.findMany({
      where: { clinicId, calendarId, googleEventId: { in: eventIds } },
      select: SELECT_VINCULO,
    });
    return vinculosConBloqueo(clinicId, filas);
  },

  async leerVinculosDeSeries(clinicId, calendarId, recurringEventIds) {
    if (recurringEventIds.length === 0) return [];
    const filas = await prisma.agendaBlockGoogle.findMany({
      where: { clinicId, calendarId, recurringEventId: { in: recurringEventIds }, appointmentId: null },
      select: SELECT_VINCULO,
      take: 2000,
    });
    return vinculosConBloqueo(clinicId, filas);
  },

  async eventosDeCitas(clinicId, eventIds) {
    if (eventIds.length === 0) return new Set();
    const citas = await prisma.appointment.findMany({
      where: { clinicId, googleCalendarEventId: { in: eventIds } },
      select: { googleCalendarEventId: true },
    });
    return new Set(citas.map((c) => c.googleCalendarEventId).filter((x): x is string => !!x));
  },

  async crearBloqueo(clinicId, calendarId, googleEventId, d: DatosBloqueo) {
    try {
      await prisma.$transaction(async (tx) => {
        const b = await tx.agendaBlock.create({
          data: {
            clinicId,
            doctorId: d.doctorId,
            kind: "GOOGLE",
            reason: MOTIVO_GOOGLE,
            startsAt: d.startsAt,
            endsAt: d.endsAt,
            createdById: null,
            createdByName: CREADOR_GOOGLE,
          },
          select: { id: true },
        });
        await tx.agendaBlockGoogle.create({
          data: {
            blockId: b.id,
            clinicId,
            calendarId,
            googleEventId,
            recurringEventId: d.recurringEventId,
            title: d.title,
            allDay: d.allDay,
            alcance: d.alcance,
            googleUpdated: d.googleUpdated,
            eventStartsAt: d.startsAt,
            eventEndsAt: d.endsAt,
          },
        });
      });
    } catch (e) {
      // Otra pasada lo creó a la vez: el índice único lo frenó y la transacción
      // deshizo el bloqueo. Ya está; no es un fallo.
      if (!esUnicoRepetido(e)) throw e;
    }
  },

  async actualizarBloqueo(clinicId, blockId, d) {
    // Primero el vínculo, condicionado a «sin convertir»; el bloqueo solo se
    // toca si eso se cumplió. Si «Convertir en cita» ganó la carrera, el
    // bloqueo convertido NO se reactiva encima de la cita.
    await prisma.$transaction(async (tx) => {
      const v = await tx.agendaBlockGoogle.updateMany({
        where: { blockId, clinicId, appointmentId: null },
        data: {
          title: d.title,
          allDay: d.allDay,
          alcance: d.alcance,
          recurringEventId: d.recurringEventId,
          googleUpdated: d.googleUpdated,
          eventStartsAt: d.startsAt,
          eventEndsAt: d.endsAt,
          eventDeletedAt: null,
        },
      });
      if (v.count === 0) return;
      await tx.agendaBlock.updateMany({
        where: { id: blockId, clinicId, kind: "GOOGLE" },
        data: { doctorId: d.doctorId, startsAt: d.startsAt, endsAt: d.endsAt, deletedAt: null, deletedById: null },
      });
    });
  },

  async inactivarBloqueo(clinicId, blockId, ahora) {
    // NO se borra: se retira (deletedAt), como cualquier bloqueo retirado.
    // Mismo orden de filas que la conversión y `actualizarBloqueo` (primero el
    // vínculo, luego el bloqueo): en otro orden, dos transacciones a la vez
    // sobre el mismo bloqueo podían interbloquearse.
    await prisma.$transaction(async (tx) => {
      await tx.agendaBlockGoogle.updateMany({
        where: { blockId, clinicId, appointmentId: null, eventDeletedAt: null },
        data: { eventDeletedAt: ahora },
      });
      await tx.agendaBlock.updateMany({
        where: { id: blockId, clinicId, kind: "GOOGLE", deletedAt: null },
        data: { deletedAt: ahora, deletedById: null },
      });
    });
  },

  async leerCita(clinicId, appointmentId) {
    const c = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId },
      select: { status: true, startsAt: true, endsAt: true, googleCalendarEventId: true },
    });
    return c ? { status: c.status, startsAt: c.startsAt, endsAt: c.endsAt, googleEventId: c.googleCalendarEventId } : null;
  },

  async actualizarVinculo(clinicId, blockId, cambios) {
    await prisma.agendaBlockGoogle.updateMany({ where: { blockId, clinicId }, data: cambios });
  },

  async retirarNoVistos(clinicId, vistos, desde, ahora) {
    const activos = await prisma.agendaBlock.findMany({
      where: { clinicId, kind: "GOOGLE", deletedAt: null, endsAt: { gt: desde } },
      select: { id: true },
      take: 2000,
    });
    if (activos.length === 0) return 0;
    const vinculos = await prisma.agendaBlockGoogle.findMany({
      where: { clinicId, blockId: { in: activos.map((a) => a.id) }, appointmentId: null },
      select: { blockId: true, googleEventId: true },
    });
    const sobran = vinculos.filter((v) => !vistos.has(v.googleEventId)).map((v) => v.blockId);
    for (const id of sobran) await puertos.inactivarBloqueo(clinicId, id, ahora);
    return sobran.length;
  },

  log: (...args) => console.error(...args),
};

// ═══════════════════════════════════════════════════════════════════════
// LO QUE USAN LAS RUTAS
// ═══════════════════════════════════════════════════════════════════════

/** Una pasada de sincronización entrante. Nunca lanza. */
export async function sincronizarCalendarioEntrante(
  clinicId: string,
  opts: { forzarCompleta?: boolean; presupuestoMs?: number } = {},
): Promise<ResultadoEntrante> {
  if (!idValido(clinicId)) return { estado: "apagado" };
  try {
    if (!(await tablasGoogleListas())) return { estado: "apagado" };
    const tokenAlEmpezar = (await leerConexion(clinicId))?.refreshToken ?? null;
    const r = await sincronizarEntrante(puertos, clinicId, opts);
    // Google rechazó el token al LEER: la conexión está caída igual que si
    // fallara al copiar una cita. Se marca (apaga la salida, conserva el token,
    // la clínica ve «Reconectar») y, pasado un día, el cron retira los bloqueos
    // (revisión t8, G3). «permisos» NO: ahí la copia de citas sigue sirviendo.
    // Solo si la conexión sigue siendo LA MISMA: si alguien reconectó mientras
    // tanto, el rechazo era del token viejo y no se apaga la conexión nueva.
    if (r.estado === "fallo" && r.motivo === "autorizacion" && tokenAlEmpezar) {
      const ahora = await leerConexion(clinicId);
      if (ahora?.refreshToken === tokenAlEmpezar) {
        await marcarGoogleCaido(clinicId, "Google rechazó la conexión al leer el calendario");
      }
    }
    return r;
  } catch (err) {
    console.error("[google-entrante] falló la sincronización:", (err as any)?.message ?? err);
    return { estado: "fallo", motivo: "google" };
  }
}

/** Marca «sucio» y sincroniza (lo que hace el aviso de Google). Nunca lanza. */
export async function avisoDeGoogleRecibido(clinicId: string): Promise<void> {
  await sincronizarCalendarioEntrante(clinicId);
}

/** Clínicas con la bandera encendida (para el cron). Sin SQL: ninguna. */
export async function clinicasConGoogleEntrante(): Promise<string[]> {
  if (!(await tablasGoogleListas())) return [];
  const filas = await prisma.googleAgendaImport.findMany({
    where: { enabled: true },
    select: { clinicId: true },
    take: 500,
  });
  return filas.map((f) => f.clinicId);
}

/**
 * Clínicas con bloqueos de Google ACTIVOS y sin la bandera encendida (para el
 * cron). Se parte de los bloqueos, no de las filas apagadas: así también entra
 * una clínica cuya fila alguien BORRÓ en vez de apagar (revisión t8, G3).
 */
export async function clinicasSinBanderaConBloqueos(): Promise<string[]> {
  if (!(await tablasGoogleListas())) return [];
  const conBloqueos = await prisma.agendaBlock.groupBy({
    by: ["clinicId"],
    where: { kind: "GOOGLE", deletedAt: null },
    take: 500,
    orderBy: { clinicId: "asc" },
  });
  if (conBloqueos.length === 0) return [];
  const encendidas = await prisma.googleAgendaImport.findMany({
    where: { enabled: true, clinicId: { in: conBloqueos.map((c) => c.clinicId) } },
    select: { clinicId: true },
  });
  const si = new Set(encendidas.map((e) => e.clinicId));
  return conBloqueos.map((c) => c.clinicId).filter((id) => !si.has(id));
}

/** Tras cuánto tiempo con la conexión caída se retiran los bloqueos de Google. */
export const CAIDA_RETIRA_MS = 24 * 60 * 60 * 1000;

/**
 * La bandera se apagó, o la clínica desconectó Google a propósito: sus
 * bloqueos de Google ya no los mantiene nadie al día y cerrarían horas que
 * quizá ya no están ocupadas. Se RETIRAN (deletedAt), no se borran. Las citas
 * convertidas no se tocan. Devuelve cuántos.
 */
export async function retirarBloqueosDeGoogle(clinicId: string): Promise<number> {
  if (!idValido(clinicId)) return 0;
  if (!(await tablasGoogleListas())) return 0;
  const ahora = new Date();
  const r = await prisma.agendaBlock.updateMany({
    where: { clinicId, kind: "GOOGLE", deletedAt: null },
    data: { deletedAt: ahora, deletedById: null },
  });
  // Sin syncToken: al volver a encender o a conectar, la siguiente pasada es
  // COMPLETA y reactiva lo que siga ocupado en Google. Con el token, una
  // incremental solo vería lo que cambió y lo demás quedaría abierto días.
  await prisma.googleAgendaImport.updateMany({ where: { clinicId }, data: { syncToken: null } });
  return r.count;
}

// ═══════════════════════════════════════════════════════════════════════
// EL CANAL DE AVISOS (events.watch)
// ═══════════════════════════════════════════════════════════════════════

export type ResultadoCanal = "vigente" | "creado" | "renovado" | "sin_direccion" | "sin_conexion" | "apagado" | "fallo";

/**
 * Deja un canal de avisos de Google vivo para el calendario de la clínica.
 * Lo crea si no hay, o si le quedan menos de 2 días, o si cambió el calendario:
 * primero el nuevo y LUEGO se para el viejo (así no hay hueco sin avisos).
 * Solo lo llama el cron. Nunca lanza.
 */
export async function asegurarCanalDeAvisos(clinicId: string, ahora = new Date()): Promise<ResultadoCanal> {
  if (!idValido(clinicId)) return "apagado";
  try {
    const estado = await puertos.leerEstado(clinicId);
    if (!estado?.enabled) return "apagado";
    const conexion = await leerConexion(clinicId);
    if (!conexion?.enabled || !conexion.refreshToken || !conexion.calendarId) return "sin_conexion";
    const calendarId = conexion.calendarId;
    // El calendario del CANAL (no el del syncToken): si el de la clínica cambia, se renueva.
    const calendarIdCanal = estado.channelCalendarId;
    if (!canalPorRenovar({ channelId: estado.channelId, channelExpiresAt: estado.channelExpiresAt, calendarIdCanal }, calendarId, ahora)) {
      return "vigente";
    }
    const direccion = direccionDelAviso(process.env.NEXT_PUBLIC_APP_URL);
    if (!direccion) return "sin_direccion";

    const refreshToken = conexion.refreshToken;
    const cal = abrirCalendarEntrante({
      accessToken: conexion.accessToken,
      refreshToken,
      alRenovarToken: (t) => { void guardarAccessToken(clinicId, refreshToken, t).catch(() => undefined); },
    });
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(24).toString("hex");
    const r = await cal.events.watch({
      calendarId,
      requestBody: { id, type: "web_hook", address: direccion, token, params: { ttl: String(TTL_CANAL_S) } },
    });
    const exp = Number(r.data.expiration);
    const expiresAt = Number.isFinite(exp) && exp > 0 ? new Date(exp) : new Date(ahora.getTime() + TTL_CANAL_S * 1000);
    await prisma.googleAgendaImport.updateMany({
      where: { clinicId },
      data: { channelId: id, channelResourceId: r.data.resourceId ?? null, channelToken: token, channelExpiresAt: expiresAt, channelCalendarId: calendarId },
    });
    if (estado.channelId && estado.channelResourceId) {
      try {
        await cal.channels.stop({ requestBody: { id: estado.channelId, resourceId: estado.channelResourceId } });
      } catch { /* el viejo caduca solo; sus avisos ya no casan con ninguna fila */ }
    }
    await prisma.googleAgendaImport.updateMany({
      where: { clinicId, channelError: { not: null } },
      data: { channelError: null, channelErrorAt: null },
    });
    return estado.channelId ? "renovado" : "creado";
  } catch (err) {
    console.error("[google-entrante] no se pudo crear/renovar el canal:", (err as any)?.message ?? err);
    // Que quede en la fila, no solo en el log (revisión t8, G15). Sin el
    // canal la agenda sigue al día por el cron; esto es para soporte.
    try {
      await prisma.googleAgendaImport.updateMany({
        where: { clinicId },
        data: { channelError: String((err as any)?.message ?? err).slice(0, 200), channelErrorAt: new Date() },
      });
    } catch { /* nunca lanza */ }
    return "fallo";
  }
}

/**
 * El aviso de Google: ¿de qué clínica es? Solo si el canal es el VIGENTE de una
 * clínica, el token coincide (tiempo constante) y el recurso también. Si no, null.
 */
export async function clinicaDelAviso(h: {
  channelId: string | null;
  token: string | null;
  resourceId: string | null;
}): Promise<string | null> {
  if (!idValido(h.channelId) || !idValido(h.token)) return null;
  if (!(await tablasGoogleListas())) return null;
  const f = await prisma.googleAgendaImport.findUnique({
    where: { channelId: h.channelId },
    select: { clinicId: true, enabled: true, channelToken: true, channelResourceId: true },
  });
  if (!f?.enabled || !f.channelToken) return null;
  const a = Buffer.from(f.channelToken);
  const b = Buffer.from(h.token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (f.channelResourceId && h.resourceId && f.channelResourceId !== h.resourceId) return null;
  return f.clinicId;
}

/** El estado para la pantalla (aviso de «vuelve a conectar»). Nunca lanza. */
export async function estadoEntranteParaPantalla(clinicId: string): Promise<{
  encendida: boolean;
  conectada: boolean;
  error: string | null;
  ultimaSync: string | null;
  /** Último intento, bien o mal: frena que abrir la agenda martille a Google si falla. */
  ultimoIntento: string | null;
}> {
  const vacio = { encendida: false, conectada: false, error: null, ultimaSync: null, ultimoIntento: null };
  if (!idValido(clinicId)) return vacio;
  try {
    if (!(await tablasGoogleListas())) return vacio;
    const f = await prisma.googleAgendaImport.findUnique({
      where: { clinicId },
      select: { enabled: true, lastError: true, lastErrorAt: true, lastSyncAt: true },
    });
    if (!f?.enabled) return vacio;
    const c = await leerConexion(clinicId);
    const intentos = [f.lastSyncAt, f.lastErrorAt].filter((d): d is Date => !!d).map((d) => d.getTime());
    // Conexión CAÍDA (Google la rechazó; se guarda el token): ni se leen los
    // eventos ni se copian las citas. La pantalla lo dice tal cual (G3).
    const caida = !!c && !c.enabled && !!c.refreshToken;
    return {
      encendida: true,
      conectada: !!(c?.enabled && c.refreshToken),
      error: caida ? "conexion_caida" : f.lastError ?? null,
      ultimaSync: f.lastSyncAt ? f.lastSyncAt.toISOString() : null,
      ultimoIntento: intentos.length ? new Date(Math.max(...intentos)).toISOString() : null,
    };
  } catch {
    return vacio;
  }
}

/**
 * ¿Los bloqueos de Google de la clínica ya no los mantiene nadie al día?
 *   · Google se DESCONECTÓ a propósito (sin refresh token), o
 *   · la conexión está CAÍDA (Google la rechazó; el token se guarda) desde
 *     hace más de `CAIDA_RETIRA_MS`. Antes se esperaba a que reconectaran, y
 *     un evento borrado en Google seguía cerrando esa hora días o semanas
 *     sin que nadie pudiera retirarlo (revisión t8, G3). Al reconectar, la
 *     primera pasada es completa y vuelve a cerrar lo que siga ocupado.
 * Una caída sin fecha (sin la tabla de estado) no cuenta: no se sabe desde cuándo.
 */
export async function conexionDeGoogleRetirada(clinicId: string, ahora = new Date()): Promise<boolean> {
  if (!idValido(clinicId)) return false;
  const c = await leerConexion(clinicId);
  if (!c) return false;
  if (!c.refreshToken) return true;
  if (c.enabled) return false;
  const { caidoDesde } = await leerAjustesGoogle(clinicId);
  return !!caidoDesde && ahora.getTime() - caidoDesde.getTime() >= CAIDA_RETIRA_MS;
}
