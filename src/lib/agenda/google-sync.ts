// Sincronización de citas con Google Calendar (DaleControl → Google).
//
// La lógica vive en `google-sync-nucleo.ts` (sin base ni Next, con Google
// inyectado para probarla). Aquí se conectan sus puertos a Prisma y al cliente
// real de Google, y se exponen las tres cosas que usan las rutas:
//
//   · sincronizarCitaConGoogle(clinicId, citaId)       — una cita, espera el resultado
//   · sincronizarCitaEnSegundoPlano(clinicId, citaId)  — lo que llaman las rutas:
//       espera a Google solo unos instantes y nunca lanza
//   · sincronizarCitasFuturasAGoogle(clinicId)         — el botón de Integraciones
//
// 🔴 Una cita se guarda SIEMPRE: nada de aquí lanza ni tumba la ruta que llama.

import { prisma } from "@/lib/prisma";
import { crearClienteCalendar } from "@/lib/google-calendar";
import { armarContenidoEventoGoogle } from "@/lib/google-calendar-contenido";
import { esErrorDeAutorizacionGoogle, leerAjustesGoogle, marcarGoogleCaido } from "@/lib/google-calendar-estado";
import { sinApartadoVencido } from "@/lib/agenda/apartado";
import {
  ESTADOS_CERRADOS,
  sincronizarCita,
  sincronizarFuturas,
  type OpcionesSync,
  type PuertosEnBloque,
  type ResultadoEnBloque,
  type ResultadoSync,
} from "@/lib/agenda/google-sync-nucleo";

export type { ResultadoEnBloque, ResultadoSync } from "@/lib/agenda/google-sync-nucleo";

/** Cuánto espera una ruta a Google antes de contestar al usuario (el resto sigue solo). */
export const ESPERA_EN_RUTA_MS = 1_500;

const puertos: PuertosEnBloque = {
  async leerClinica(clinicId) {
    const c = await prisma.clinic.findUnique({
      where: { id: clinicId },
      select: {
        id: true, name: true, address: true, timezone: true,
        googleCalendarEnabled: true, googleCalendarToken: true,
        googleRefreshToken: true, googleClinicCalendarId: true,
      },
    });
    if (!c) return null;
    return {
      id: c.id, name: c.name, address: c.address, timezone: c.timezone,
      enabled: c.googleCalendarEnabled === true,
      accessToken: c.googleCalendarToken, refreshToken: c.googleRefreshToken,
      calendarId: c.googleClinicCalendarId,
    };
  },

  async leerAjustes(clinicId) {
    const a = await leerAjustesGoogle(clinicId);
    return { invitarPaciente: a.invitarPaciente, caidoDesde: a.caidoDesde };
  },

  async guardarAccessToken(clinicId, refreshToken, accessToken) {
    // Solo si la clínica sigue con el MISMO refresh token: si otro admin
    // reconectó con otra cuenta mientras tanto, este token ya no es suyo.
    await prisma.clinic.updateMany({
      where: { id: clinicId, googleRefreshToken: refreshToken },
      data: { googleCalendarToken: accessToken },
    });
  },

  async fijarCalendarioId(clinicId, calendarId, esperado) {
    // Condicional: solo si sigue como se leyó. Si otra petición ya fijó otro, se devuelve el suyo.
    const r = await prisma.clinic.updateMany({
      where: { id: clinicId, googleClinicCalendarId: esperado },
      data: { googleClinicCalendarId: calendarId },
    });
    if (r.count > 0) return calendarId;
    const c = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { googleClinicCalendarId: true } });
    return c?.googleClinicCalendarId ?? calendarId;
  },

  async leerCita(clinicId, appointmentId) {
    const a = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId },
      select: {
        id: true, type: true, status: true, startsAt: true, endsAt: true, googleCalendarEventId: true,
        patient: { select: { firstName: true, lastName: true, email: true } },
        doctor: { select: { firstName: true, lastName: true, email: true } },
      },
    });
    if (!a) return null;
    return {
      id: a.id, type: a.type, status: a.status, startsAt: a.startsAt, endsAt: a.endsAt,
      googleEventId: a.googleCalendarEventId,
      patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
      doctorName: a.doctor ? `${a.doctor.firstName} ${a.doctor.lastName}`.trim() : null,
      doctorEmail: a.doctor?.email ?? null,
      patientEmail: a.patient.email ?? null,
    };
  },

  async guardarEventoId(clinicId, appointmentId, eventId) {
    await prisma.appointment.updateMany({
      where: { id: appointmentId, clinicId },
      data: { googleCalendarEventId: eventId },
    });
  },

  abrirCalendar: (cred) =>
    crearClienteCalendar({
      accessToken: cred.accessToken,
      refreshToken: cred.refreshToken,
      alRenovarToken: cred.alRenovarToken,
    }),
  armarContenido: armarContenidoEventoGoogle,
  esErrorDeAutorizacion: esErrorDeAutorizacionGoogle,
  marcarCaido: (clinicId, motivo) => marcarGoogleCaido(clinicId, motivo),
  log: (...args) => console.error(...args),

  async listarFuturasSinEvento(clinicId, desde, tope) {
    const filas = await prisma.appointment.findMany({
      where: dondeFuturasSinEvento(clinicId, desde),
      orderBy: { startsAt: "asc" },
      take: tope,
      select: { id: true },
    });
    return filas.map((f) => f.id);
  },
  contarFuturasSinEvento: (clinicId, desde) =>
    prisma.appointment.count({ where: dondeFuturasSinEvento(clinicId, desde) }),
  contarFuturasConEvento: (clinicId, desde) =>
    prisma.appointment.count({
      where: { ...dondeFuturasActivas(clinicId, desde), googleCalendarEventId: { not: null } },
    }),
};

function dondeFuturasActivas(clinicId: string, desde: Date) {
  return {
    clinicId,
    startsAt: { gte: desde },
    status: { notIn: [...ESTADOS_CERRADOS] },
    // Una cita apartada cuyo anticipo venció ya no ocupa hueco: no va al calendario.
    AND: [sinApartadoVencido(desde)],
  };
}
const dondeFuturasSinEvento = (clinicId: string, desde: Date) => ({
  ...dondeFuturasActivas(clinicId, desde),
  googleCalendarEventId: null,
});

/**
 * Deja a Google igual que la cita (la crea, la mueve o la borra según cómo esté
 * AHORA). Nunca lanza. Devuelve qué pasó, para quien quiera mostrarlo.
 */
export async function sincronizarCitaConGoogle(
  clinicId: string,
  appointmentId: string,
  opts?: OpcionesSync,
): Promise<ResultadoSync> {
  try {
    if (!clinicId) return { estado: "omitido", motivo: "no_conectada" }; // regla (c): sin clínica no se consulta
    return await sincronizarCita(puertos, clinicId, appointmentId, opts);
  } catch (err) {
    console.error("Google Calendar sync failed:", err);
    return { estado: "fallo", motivo: "interno" };
  }
}

/** Mantiene viva la función de Vercel hasta que termine `tarea`, aunque ya haya contestado. */
function mantenerVivo(tarea: Promise<unknown>): void {
  try {
    // Lo mismo que hace `waitUntil` de @vercel/functions, sin la dependencia.
    const ctx = (globalThis as any)[Symbol.for("@vercel/request-context")]?.get?.();
    ctx?.waitUntil?.(tarea);
  } catch { /* fuera de Vercel no hay contexto: el proceso sigue vivo solo */ }
}

/**
 * Lo que llaman las rutas tras guardar una cita (alta, cambio de hora,
 * cancelación, no-asistió, reactivación…). NO alarga la respuesta: espera a
 * Google como mucho `esperarMs` (lo normal son unos cientos de milisegundos,
 * así la insignia de «sincronizada» ya sale) y el resto sigue en segundo plano.
 * Nunca lanza.
 */
export async function sincronizarCitaEnSegundoPlano(
  clinicId: string,
  appointmentId: string,
  opts: { esperarMs?: number } = {},
): Promise<void> {
  const tarea = sincronizarCitaConGoogle(clinicId, appointmentId).then(() => undefined);
  mantenerVivo(tarea);
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      tarea,
      new Promise<void>((res) => { t = setTimeout(res, opts.esperarMs ?? ESPERA_EN_RUTA_MS); }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * «Sincronizar citas futuras»: sube las citas futuras que no tienen evento.
 * Idempotente (ver `sincronizarFuturas`). Nunca lanza.
 */
export async function sincronizarCitasFuturasAGoogle(clinicId: string): Promise<ResultadoEnBloque> {
  if (!clinicId) return { creadas: 0, omitidas: 0, fallidas: 0, restantes: 0, motivo: "no_conectada" };
  try {
    return await sincronizarFuturas(puertos, clinicId);
  } catch (err) {
    console.error("Google Calendar: sincronizar citas futuras falló:", err);
    return { creadas: 0, omitidas: 0, fallidas: 0, restantes: 0, motivo: "error" };
  }
}
