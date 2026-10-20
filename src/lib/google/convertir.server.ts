/**
 * «CONVERTIR EN CITA» y el aviso de la cita convertida (WS1-T9).
 *
 * La cita se crea con la ruta NORMAL (`POST /api/appointments`: choques,
 * permisos, visibilidad, auditoría, WhatsApp, recordatorios por cron…). Esa
 * ruta solo hace dos cosas más cuando le llega `googleBloqueoId`:
 *
 *   1. `prepararConversionGoogle` — comprueba que el bloqueo es GOOGLE, de la
 *      clínica de la sesión, sigue activo y no está convertido; que la hora
 *      pedida es EXACTAMENTE la del bloqueo (la hora la manda el servidor, no
 *      el navegador: si el evento se movió con el panel abierto → 409), que no
 *      es de todo el día ni dura más de `CONVERTIR_MAX_HORAS`, y que el doctor
 *      es el del bloqueo cuando lo tiene. Y le dice a la ruta que ESE bloqueo
 *      no cuenta como «hora bloqueada» (es justo el hueco que se ocupa).
 *   2. Dentro de la MISMA transacción del alta: la cita nace con
 *      `googleCalendarEventId` = el evento de Google, y `marcarBloqueoConvertido`
 *      deja el bloqueo retirado y el vínculo con `convertedAt` + `appointmentId`.
 *      Si otro lo convirtió a la vez, lanza y el alta se deshace entera.
 *
 * Con el id del evento ya en la cita, la sincronización de salida de siempre
 * (`sincronizarCitaEnSegundoPlano`) hace `events.patch` sobre ESE evento: no
 * crea uno nuevo, no hay duplicado en Google. Y lo trata distinto que a uno
 * suyo (`vinculoParaSalida`, revisión t8 G4/G6 y segunda vuelta): no le pisa
 * el título, la descripción ni los invitados, no lo mueve mientras haya un
 * aviso sin decidir, y al cancelar la cita NO lo borra: le antepone
 * «Cancelada en DaleControl · » al título. Lo que no llegó a Google lo repone
 * el cron (`reintentarSalidaDeConvertidas`).
 */

import { prisma } from "@/lib/prisma";
import { puedeRecibirCitas } from "@/lib/agenda/roles-que-atienden";
import { idEventoDeCita } from "@/lib/google-calendar";
import { firmaSalidaConvertida, type SalidaConvertida } from "@/lib/agenda/google-sync-nucleo";
import { tablasGoogleListas, tablasGoogleListasOLanzar } from "./tablas.server";
import { avisoVigente, calendarioImportable, puedeVerTitulo, type AlcanceGoogle, type AvisoVigente } from "./entrante-core";

/** Un evento más largo que esto no se convierte en UNA cita (G5). */
export const CONVERTIR_MAX_HORAS = 12;

const idValido = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0;

/** Lo que la ruta necesita saber. Un solo tipo con campos anulables (strict:false no estrecha uniones). */
export interface ConversionPreparada {
  ok: boolean;
  bloqueoId: string | null;
  googleEventId: string | null;
  /** Para el 4xx cuando `ok` es false. */
  status: number;
  error: string | null;
}

export async function prepararConversionGoogle(
  clinicId: string,
  bloqueoId: unknown,
  quien?: { userId: string; role: string },
  /** Lo que pidió la pantalla: tiene que ser la hora del bloqueo y, si lo tiene, su doctor. */
  intento?: { startsAt: Date; endsAt: Date; doctorId: string | null | undefined },
): Promise<ConversionPreparada> {
  const no = (status: number, error: string): ConversionPreparada => ({ ok: false, bloqueoId: null, googleEventId: null, status, error });
  if (!idValido(clinicId)) return no(401, "unauthorized");
  if (!idValido(bloqueoId)) return no(400, "google_block_invalid");
  if (!(await tablasGoogleListas({ forzar: true }))) return no(409, "google_block_unavailable");
  const imp = await prisma.googleAgendaImport.findUnique({ where: { clinicId }, select: { enabled: true } });
  if (!imp?.enabled) return no(409, "google_block_unavailable");

  const [bloque, vinculo] = await Promise.all([
    prisma.agendaBlock.findFirst({
      where: { id: bloqueoId, clinicId },
      select: { id: true, kind: true, deletedAt: true, doctorId: true, startsAt: true, endsAt: true },
    }),
    prisma.agendaBlockGoogle.findFirst({
      where: { blockId: bloqueoId, clinicId },
      select: { googleEventId: true, appointmentId: true, allDay: true },
    }),
  ]);
  if (!bloque || bloque.kind !== "GOOGLE" || !vinculo) return no(404, "google_block_not_found");
  // Un DOCTOR solo ve (y convierte) los suyos y los de toda la clínica, como en `listarBloqueos`.
  if (quien?.role === "DOCTOR" && bloque.doctorId !== null && bloque.doctorId !== quien.userId) {
    return no(404, "google_block_not_found");
  }
  if (vinculo.appointmentId) return no(409, "google_block_already_converted");
  if (bloque.deletedAt) return no(409, "google_block_inactive");
  // Todo el día crearía una cita de 00:00 a 00:00 (G5).
  if (vinculo.allDay) return no(409, "google_block_all_day");
  if (bloque.endsAt.getTime() - bloque.startsAt.getTime() > CONVERTIR_MAX_HORAS * 3_600_000) {
    return no(409, "google_block_too_long");
  }
  if (intento) {
    // La hora del BLOQUEO, no la que traía la pantalla: si el evento se movió
    // en Google con el panel abierto, la cita no nace a la hora vieja (G5).
    if (intento.startsAt.getTime() !== bloque.startsAt.getTime() || intento.endsAt.getTime() !== bloque.endsAt.getTime()) {
      return no(409, "google_block_changed");
    }
    if (bloque.doctorId && intento.doctorId !== bloque.doctorId) {
      // El doctor del bloqueo manda… si atiende. Un bloqueo a nombre de
      // recepción o de un doctor sin agenda (G1) deja elegir.
      const dueno = await prisma.user.findFirst({
        where: { id: bloque.doctorId, clinicId },
        select: { role: true, isActive: true, agendaActive: true },
      });
      if (dueno && puedeRecibirCitas(dueno)) return no(409, "google_block_doctor");
    }
  }
  return { ok: true, bloqueoId: bloque.id, googleEventId: vinculo.googleEventId, status: 200, error: null };
}

export class ConversionYaHecha extends Error {
  constructor() {
    super("google_block_already_converted");
  }
}

/** El evento se movió o se quitó en Google entre la comprobación y el guardado (G8). */
export class BloqueoCambiado extends Error {
  constructor() {
    super("google_block_changed");
  }
}

/** Los errores de la conversión que la ruta convierte en 409 con su código. */
export const ERRORES_DE_CONVERSION = ["google_block_already_converted", "google_block_changed"] as const;

/** La rendija de transacción que hace falta (un `tx` de Prisma la cumple). */
export interface TxConversion {
  agendaBlockGoogle: { updateMany(args: any): Promise<{ count: number }> };
  agendaBlock: { updateMany(args: any): Promise<{ count: number }> };
}

/**
 * Dentro de la transacción del alta. Condicional: solo si nadie lo convirtió
 * antes; si no, lanza `ConversionYaHecha` y la transacción se deshace.
 */
export async function marcarBloqueoConvertido(
  tx: TxConversion,
  d: { clinicId: string; bloqueoId: string; appointmentId: string; userId: string; startsAt: Date; endsAt: Date; ahora?: Date },
): Promise<void> {
  const ahora = d.ahora ?? new Date();
  const r = await tx.agendaBlockGoogle.updateMany({
    where: { blockId: d.bloqueoId, clinicId: d.clinicId, appointmentId: null },
    data: {
      convertedAt: ahora,
      convertedById: d.userId,
      appointmentId: d.appointmentId,
      // Punto de partida del aviso: la hora que tendrá el evento tras el parche.
      eventStartsAt: d.startsAt,
      eventEndsAt: d.endsAt,
    },
  });
  if (r.count === 0) throw new ConversionYaHecha();
  // El bloqueo queda RETIRADO (no borrado): ahora ocupa la cita. Solo si
  // seguía activo y a la MISMA hora: si la sincronización lo retiró o lo movió
  // entre la comprobación y aquí, la cita no se crea (y no se dice «otro lo
  // convirtió», que no es lo que pasó).
  const b = await tx.agendaBlock.updateMany({
    where: { id: d.bloqueoId, clinicId: d.clinicId, kind: "GOOGLE", deletedAt: null, startsAt: d.startsAt, endsAt: d.endsAt },
    data: { deletedAt: ahora, deletedById: d.userId },
  });
  if (b.count === 0) throw new BloqueoCambiado();
}

// ═══════════════════════════════════════════════════════════════════════
// LO QUE VE EL PANEL DEL BLOQUEO
// ═══════════════════════════════════════════════════════════════════════

export interface DetalleBloqueoGoogle {
  id: string;
  /** Vacío si quien mira no puede ver el título (`puedeVerTitulo`, G1). */
  titulo: string;
  tituloVisible: boolean;
  inicio: string;
  fin: string;
  diaCompleto: boolean;
  doctorId: string | null;
  doctorNombre: string | null;
  /** El doctor del bloqueo atiende: la cita es suya y no se elige otro. */
  doctorFijo: boolean;
  /** Por qué es de toda la clínica (null = de una persona). */
  alcance: AlcanceGoogle | null;
  activo: boolean;
  citaId: string | null;
}

/**
 * El detalle de un bloqueo GOOGLE para quien ve la agenda. Un DOCTOR solo ve
 * los suyos y los de toda la clínica (mismo criterio que `listarBloqueos`), y
 * el título solo de los suyos.
 */
export async function detalleBloqueoGoogle(
  ctx: { clinicId: string; userId: string; role: string },
  bloqueoId: string,
): Promise<DetalleBloqueoGoogle | null> {
  if (!idValido(ctx.clinicId) || !idValido(bloqueoId)) return null;
  if (!(await tablasGoogleListas())) return null;
  const [b, v] = await Promise.all([
    prisma.agendaBlock.findFirst({
      where: { id: bloqueoId, clinicId: ctx.clinicId, kind: "GOOGLE" },
      select: {
        id: true, doctorId: true, startsAt: true, endsAt: true, deletedAt: true,
        doctor: { select: { firstName: true, lastName: true, role: true, isActive: true, agendaActive: true } },
      },
    }),
    prisma.agendaBlockGoogle.findFirst({
      where: { blockId: bloqueoId, clinicId: ctx.clinicId },
      select: { title: true, allDay: true, appointmentId: true, alcance: true },
    }),
  ]);
  if (!b || !v) return null;
  if (ctx.role === "DOCTOR" && b.doctorId !== null && b.doctorId !== ctx.userId) return null;
  const tituloVisible = puedeVerTitulo(ctx, b);
  return {
    id: b.id,
    titulo: tituloVisible ? v.title : "",
    tituloVisible,
    inicio: b.startsAt.toISOString(),
    fin: b.endsAt.toISOString(),
    diaCompleto: v.allDay,
    doctorId: b.doctorId,
    doctorNombre: b.doctor ? `${b.doctor.firstName ?? ""} ${b.doctor.lastName ?? ""}`.trim() || null : null,
    doctorFijo: !!b.doctor && puedeRecibirCitas(b.doctor),
    alcance: (v.alcance ?? null) as AlcanceGoogle | null,
    activo: b.deletedAt === null,
    citaId: v.appointmentId ?? null,
  };
}

/** Los títulos de varios bloqueos GOOGLE (para pintar la rejilla). Nunca lanza. */
export async function titulosDeBloqueosGoogle(clinicId: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!idValido(clinicId) || ids.length === 0) return out;
  try {
    if (!(await tablasGoogleListas())) return out;
    const filas = await prisma.agendaBlockGoogle.findMany({
      where: { clinicId, blockId: { in: ids } },
      select: { blockId: true, title: true },
    });
    for (const f of filas) out.set(f.blockId, f.title);
  } catch (e) {
    console.error("[google-entrante] no se pudieron leer los títulos:", (e as any)?.message ?? e);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// EL AVISO DE LA CITA CONVERTIDA
// ═══════════════════════════════════════════════════════════════════════

export interface AvisoCitaDTO {
  tipo: "movido" | "eliminado";
  /** Solo en «movido»: la hora nueva del evento en Google (ISO). */
  inicio: string | null;
  fin: string | null;
}

/** El aviso vigente de la cita, o null. Nunca lanza. */
export async function avisoDeCitaGoogle(clinicId: string, appointmentId: string): Promise<AvisoCitaDTO | null> {
  if (!idValido(clinicId) || !idValido(appointmentId)) return null;
  try {
    if (!(await tablasGoogleListas())) return null;
    const v = await prisma.agendaBlockGoogle.findFirst({
      where: { clinicId, appointmentId },
      select: { googleEventId: true, avisoTipo: true, avisoStartsAt: true, avisoEndsAt: true, avisoDescartadoAt: true },
    });
    if (!v?.avisoTipo) return null;
    const cita = await prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId },
      select: { status: true, startsAt: true, endsAt: true, googleCalendarEventId: true },
    });
    // La cita ya no va ligada a ESE evento (se canceló, se reactivó y tiene
    // uno nuevo): lo que le pase al viejo no es asunto suyo (G7).
    if (!cita || cita.googleCalendarEventId !== v.googleEventId) return null;
    const a: AvisoVigente | null = avisoVigente(v, cita);
    if (!a) return null;
    return a.tipo === "movido"
      ? { tipo: "movido", inicio: a.inicio.toISOString(), fin: a.fin.toISOString() }
      : { tipo: "eliminado", inicio: null, fin: null };
  } catch (e) {
    console.error("[google-entrante] no se pudo leer el aviso:", (e as any)?.message ?? e);
    return null;
  }
}

/** Lo que la salida necesita de una cita que vino de Google (ver `CitaParaGoogle.desdeGoogle`). */
export interface VinculoSalida {
  tituloOriginal: string;
  avisoPendiente: boolean;
  /**
   * La hora del evento en Google la última vez que se leyó o escribió, y si se
   * vio borrado. Ausente si la entrada no corre para esta clínica (N-G9).
   */
  eventoVisto?: { startsAt: Date; endsAt: Date; eliminado: boolean };
  /** «Mantener la cita» tras «se eliminó» (y no hay un aviso nuevo). */
  mantenerEliminado?: boolean;
}

/**
 * Lo que la sincronización de SALIDA (DaleControl → Google) necesita saber de
 * una cita que vino de un evento de Google. `null` = una cita normal (o ya no
 * ligada a ese evento): se sincroniza como siempre.
 *
 * 🔴 Equivocarse aquí BORRA el evento de la clínica y avisa a sus invitados.
 * Por eso: un evento con el id propio de la cita es nuestro y no se consulta
 * nada (las citas normales no pagan ni dependen de esta lectura); y para los
 * demás la sonda de tablas no usa un «no» guardado ni se traga un fallo de
 * base: si no puede saberlo, LANZA y la sincronización se reintenta.
 */
export async function vinculoParaSalida(
  clinicId: string,
  cita: { id: string; status: string; startsAt: Date; endsAt: Date },
  googleEventId: string | null,
): Promise<VinculoSalida | null> {
  if (!idValido(clinicId) || !idValido(cita?.id) || !idValido(googleEventId)) return null;
  if (googleEventId === idEventoDeCita(clinicId, cita.id)) return null;
  if (!(await tablasGoogleListasOLanzar())) return null;
  const v = await prisma.agendaBlockGoogle.findFirst({
    where: { clinicId, appointmentId: cita.id, googleEventId },
    select: {
      blockId: true, title: true, eventStartsAt: true, eventEndsAt: true, eventDeletedAt: true,
      avisoTipo: true, avisoStartsAt: true, avisoEndsAt: true, avisoDescartadoAt: true,
    },
  });
  if (!v) return null;
  // ¿La entrada sigue leyendo este calendario? Si se apagó la bandera o el
  // calendario ya no es uno que lea (G14), nadie pondría un aviso: la «última
  // vista» se quedaría vieja y cada cambio de la cita solo tocaría el título,
  // para siempre y sin aviso (N-G9). Entonces manda DaleControl: ni aviso ni
  // última vista. Cancelar sigue siendo «solo el título».
  const [imp, clinica] = await Promise.all([
    prisma.googleAgendaImport.findUnique({ where: { clinicId }, select: { enabled: true } }),
    prisma.clinic.findUnique({ where: { id: clinicId }, select: { googleClinicCalendarId: true } }),
  ]);
  if (!imp?.enabled || !calendarioImportable(clinica?.googleClinicCalendarId)) {
    return { tituloOriginal: v.title, avisoPendiente: false };
  }
  let avisoPendiente = !!v.avisoTipo && !v.avisoDescartadoAt;
  // «Mover la cita» (o alguien la movió) a la hora del aviso: el aviso ya se
  // resolvió. Se limpia aquí: si no, se quedaba pegado y, al mover la cita otra
  // vez días después, volvía a salir y a frenar la copia de la hora (revisión t8).
  if (
    avisoPendiente &&
    v.avisoTipo === "movido" &&
    v.avisoStartsAt?.getTime() === cita.startsAt.getTime() &&
    v.avisoEndsAt?.getTime() === cita.endsAt.getTime()
  ) {
    // Solo ESE aviso (sus horas): uno «movido» nuevo que la entrada acabe de
    // guardar a otra hora no se borra sin que nadie lo vea (N-G10).
    await prisma.agendaBlockGoogle.updateMany({
      where: { blockId: v.blockId, clinicId, avisoTipo: "movido", avisoStartsAt: v.avisoStartsAt, avisoEndsAt: v.avisoEndsAt },
      data: { avisoTipo: null, avisoStartsAt: null, avisoEndsAt: null, avisoDesde: null, avisoDescartadoAt: null },
    });
    avisoPendiente = false;
  }
  return {
    tituloOriginal: v.title,
    avisoPendiente,
    eventoVisto: { startsAt: v.eventStartsAt, endsAt: v.eventEndsAt, eliminado: !!v.eventDeletedAt },
    mantenerEliminado: v.avisoTipo === "eliminado" && !!v.avisoDescartadoAt,
  };
}

/**
 * «Mantener la cita»: el aviso se descarta y la cita se vuelve a copiar a
 * Google con SU hora (el evento movido vuelve a la hora de la cita; el
 * eliminado se restaura). DaleControl manda. Devuelve si había aviso.
 */
export async function descartarAvisoDeCitaGoogle(clinicId: string, appointmentId: string): Promise<boolean> {
  if (!idValido(clinicId) || !idValido(appointmentId)) return false;
  if (!(await tablasGoogleListas())) return false;
  const r = await prisma.agendaBlockGoogle.updateMany({
    where: { clinicId, appointmentId, avisoTipo: { not: null }, avisoDescartadoAt: null },
    // Sin firma: si la copia que sigue falla, el cron la repite (N-G12).
    data: { avisoDescartadoAt: new Date(), salidaFirma: null },
  });
  return r.count > 0;
}

/**
 * Tras una salida buena de una cita convertida (lo llama la salida, ver
 * `SalidaConvertida`): la firma de lo que quedó en Google y, si se copió la
 * hora, esa hora como «la última vista». Esta última, solo si el vínculo
 * sigue con la que se leyó: si la entrada vio otra cosa mientras, gana ella.
 */
export async function guardarSalidaConvertida(
  clinicId: string,
  appointmentId: string,
  googleEventId: string,
  d: SalidaConvertida,
): Promise<void> {
  if (!idValido(clinicId) || !idValido(appointmentId) || !idValido(googleEventId)) return;
  const donde = { clinicId, appointmentId, googleEventId };
  if (d.visto) {
    await prisma.agendaBlockGoogle.updateMany({
      where: { ...donde, ...(d.visto.antes ? { eventStartsAt: d.visto.antes.startsAt, eventEndsAt: d.visto.antes.endsAt } : {}) },
      data: { eventStartsAt: d.visto.startsAt, eventEndsAt: d.visto.endsAt, eventDeletedAt: null },
    });
  }
  if (d.firma) await prisma.agendaBlockGoogle.updateMany({ where: donde, data: { salidaFirma: d.firma } });
}

/** Cuántas convertidas se reintentan por clínica en una pasada del cron. */
export const REINTENTOS_POR_PASADA = 20;

/**
 * Las citas convertidas cuya última copia a Google no llegó (la firma guardada
 * no es la de la cita: un fallo de red, de Google o de base al cancelarla o
 * moverla). Antes nada las reintentaba: el evento se quedaba sin «Cancelada en
 * DaleControl» hasta el siguiente cambio de la cita (N-G12). Solo las que
 * siguen ligadas a su evento y no terminaron hace más de un día.
 */
export async function convertidasPorReintentar(clinicId: string, ahora = new Date()): Promise<string[]> {
  if (!idValido(clinicId)) return [];
  if (!(await tablasGoogleListas())) return [];
  const vinculos = await prisma.agendaBlockGoogle.findMany({
    where: { clinicId, appointmentId: { not: null } },
    select: { appointmentId: true, googleEventId: true, salidaFirma: true, avisoTipo: true, avisoDescartadoAt: true },
    orderBy: { convertedAt: "desc" },
    take: 500,
  });
  if (vinculos.length === 0) return [];
  const citas = await prisma.appointment.findMany({
    where: {
      clinicId,
      id: { in: vinculos.map((v) => v.appointmentId as string) },
      endsAt: { gt: new Date(ahora.getTime() - 24 * 60 * 60 * 1000) },
    },
    select: { id: true, status: true, startsAt: true, endsAt: true, googleCalendarEventId: true },
  });
  const porId = new Map(citas.map((c) => [c.id, c]));
  const out: string[] = [];
  for (const v of vinculos) {
    const c = porId.get(v.appointmentId as string);
    if (!c || c.googleCalendarEventId !== v.googleEventId) continue;
    if (v.salidaFirma === firmaSalidaConvertida(c)) continue;
    // Con un aviso sin decidir la hora no se copia a propósito: no se reintenta
    // (salvo que la cita ya esté cancelada: entonces el aviso no se enseña y
    // el «Cancelada en DaleControl» sí tiene que llegar).
    if (v.avisoTipo && !v.avisoDescartadoAt && !["CANCELLED", "NO_SHOW", "COMPLETED"].includes(c.status)) continue;
    out.push(c.id);
    if (out.length >= REINTENTOS_POR_PASADA) break;
  }
  return out;
}

/**
 * Clínicas con citas convertidas (para que el cron también repase las que ya
 * NO tienen la bandera: una cancelación cuya copia falló se repone igual).
 */
export async function clinicasConConvertidas(): Promise<string[]> {
  if (!(await tablasGoogleListas())) return [];
  const filas = await prisma.agendaBlockGoogle.groupBy({
    by: ["clinicId"],
    where: { appointmentId: { not: null } },
    take: 500,
    orderBy: { clinicId: "asc" },
  });
  return filas.map((f) => f.clinicId);
}

/** El cron: vuelve a copiar a Google las convertidas pendientes. Devuelve cuántas intentó. Nunca lanza. */
export async function reintentarSalidaDeConvertidas(
  clinicId: string,
  sincronizar: (clinicId: string, appointmentId: string) => Promise<unknown>,
  /** Hasta cuándo (ms) puede seguir: el presupuesto del cron. */
  limite = Number.POSITIVE_INFINITY,
): Promise<number> {
  try {
    const ids = await convertidasPorReintentar(clinicId);
    let n = 0;
    for (const id of ids) {
      if (Date.now() >= limite) break;
      await sincronizar(clinicId, id);
      n++;
    }
    return n;
  } catch (e) {
    console.error("[google-entrante] no se pudieron reintentar las convertidas:", (e as any)?.message ?? e);
    return 0;
  }
}
