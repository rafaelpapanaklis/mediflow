/**
 * GOOGLE CALENDAR → AGENDA — la sincronización entrante (WS1-T9).
 *
 * UN punto común para las tres puertas que la disparan: el aviso de Google
 * (`/api/google/avisos`), el cron de respaldo (`/api/cron/google-calendario`)
 * y la agenda al abrirse (`/api/google/agenda/sincronizar`). Todas llaman a
 * `sincronizarEntrante(p, clinicId)` y ya.
 *
 *   · Incremental con `syncToken` (solo lo que cambió desde la última vez).
 *   · Completa sin él, al cambiar de calendario, cada semana, o si Google
 *     contesta 410 (token caducado). La completa además retira los bloqueos
 *     cuyo evento ya no aparece.
 *   · Idempotente: un evento = un bloqueo (índice único), y solo se escribe lo
 *     que cambió. Repetirla, o correrla desde dos puertas a la vez, converge.
 *   · UN TURNO por clínica (`leaseUntil`): si llega un aviso mientras otra corre,
 *     se marca «sucio» y la que corre da otra vuelta al terminar.
 *
 * 🔴 NUNCA apaga la sincronización de salida (DaleControl → Google): un fallo
 * al LEER se anota en `lastError` y la pantalla lo dice; las citas siguen
 * copiándose a Google como siempre.
 *
 * Sin Prisma ni Next: la base y Google entran como `PuertosEntrante`, y las
 * pruebas pasan una Google falsa.
 */

import {
  clasificarErrorEntrante,
  decidirAvisoCita,
  decidirEvento,
  esEventoDeDaleControl,
  tocaCompleta,
  VENTANA_PASADO_MS,
  type BloqueoExistente,
  type CambiosVinculo,
  type CitaDelVinculo,
  type DatosBloqueo,
  type ErrorEntrante,
  type EventoGoogle,
} from "./entrante-core";

/** Lo mínimo del cliente de Calendar que usa la entrada (las pruebas lo imitan). */
export interface ClienteCalendarEntrante {
  events: {
    list(p: Record<string, unknown>): Promise<{
      data: { items?: EventoGoogle[] | null; nextPageToken?: string | null; nextSyncToken?: string | null };
    }>;
    watch(p: { calendarId: string; requestBody: Record<string, unknown> }): Promise<{
      data: { id?: string | null; resourceId?: string | null; expiration?: string | number | null };
    }>;
  };
  channels: {
    stop(p: { requestBody: { id: string; resourceId: string } }): Promise<unknown>;
  };
}

export interface EstadoEntrante {
  enabled: boolean;
  calendarId: string | null;
  syncToken: string | null;
  lastFullSyncAt: Date | null;
  lastSyncAt: Date | null;
  channelId: string | null;
  channelResourceId: string | null;
  channelExpiresAt: Date | null;
  /** El calendario al que apunta el canal de avisos. */
  channelCalendarId: string | null;
}

export interface ConexionGoogle {
  enabled: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  calendarId: string | null;
  timezone: string;
}

/** Un vínculo leído de la base (bloqueo GOOGLE ↔ evento). */
export interface VinculoLeido {
  blockId: string;
  googleEventId: string;
  recurringEventId: string | null;
  /** El bloqueo, tal como está. */
  activo: boolean;
  doctorId: string | null;
  startsAt: Date;
  endsAt: Date;
  title: string;
  allDay: boolean;
  /** Convertido en cita. */
  appointmentId: string | null;
  eventStartsAt: Date;
  eventEndsAt: Date;
  eventDeletedAt: Date | null;
  avisoTipo: string | null;
}

export interface PuertosEntrante {
  leerEstado(clinicId: string): Promise<EstadoEntrante | null>;
  leerConexion(clinicId: string): Promise<ConexionGoogle | null>;
  /** Toma el turno de la clínica si está libre (y borra la marca de «sucio»). */
  tomarTurno(clinicId: string, hasta: Date): Promise<boolean>;
  /** Suelta el turno; devuelve si llegó un aviso mientras tanto («sucio»). */
  soltarTurno(clinicId: string): Promise<boolean>;
  /** Alarga el turno (una pasada larga no lo pierde a media página). */
  renovarTurno(clinicId: string, hasta: Date): Promise<void>;
  marcarSucio(clinicId: string): Promise<void>;
  guardarProgreso(
    clinicId: string,
    d: { calendarId: string; syncToken: string | null; completa: boolean; ahora: Date },
  ): Promise<void>;
  guardarError(clinicId: string, error: ErrorEntrante | null): Promise<void>;
  abrirCalendar(cred: { accessToken: string | null; refreshToken: string; alRenovarToken: (t: string) => void }): ClienteCalendarEntrante;
  guardarAccessToken(clinicId: string, refreshToken: string, accessToken: string): Promise<void>;
  leerDoctores(clinicId: string): Promise<{ id: string; email: string | null }[]>;
  /** Los vínculos de esos eventos en ESE calendario. */
  leerVinculos(clinicId: string, calendarId: string, eventIds: string[]): Promise<VinculoLeido[]>;
  /** Los vínculos SIN convertir y activos de una serie (cuando Google borra la serie entera). */
  leerVinculosDeSerie(clinicId: string, calendarId: string, recurringEventId: string): Promise<VinculoLeido[]>;
  /** Eventos que ya son de una cita (por `googleCalendarEventId`): nunca se bloquean. */
  eventosDeCitas(clinicId: string, eventIds: string[]): Promise<Set<string>>;
  crearBloqueo(clinicId: string, calendarId: string, googleEventId: string, d: DatosBloqueo): Promise<void>;
  actualizarBloqueo(clinicId: string, blockId: string, d: DatosBloqueo): Promise<void>;
  inactivarBloqueo(clinicId: string, blockId: string, ahora: Date): Promise<void>;
  leerCita(clinicId: string, appointmentId: string): Promise<CitaDelVinculo | null>;
  actualizarVinculo(clinicId: string, blockId: string, cambios: CambiosVinculo): Promise<void>;
  /** Retira los bloqueos SIN convertir y activos que no se vieron en la completa (y que no terminaron antes de `desde`). */
  retirarNoVistos(clinicId: string, vistos: Set<string>, desde: Date, ahora: Date): Promise<number>;
  ahora?(): Date;
  log?(...args: unknown[]): void;
}

export type ResultadoEntrante =
  | { estado: "apagado" | "sin_conexion" | "en_curso" }
  | { estado: "ok"; completa: boolean; creados: number; actualizados: number; retirados: number; avisos: number; vueltas: number }
  | { estado: "parcial"; motivo: "tiempo" }
  | { estado: "fallo"; motivo: ErrorEntrante };

export const PRESUPUESTO_ENTRANTE_MS = 40_000;
/** El turno caduca solo, por si una función muere a media pasada. */
export const TURNO_MS = 5 * 60_000;
const MAX_VUELTAS = 3;
const MAX_PAGINAS = 40;

class SinTiempo extends Error {}

function esTokenCaducado(err: unknown): boolean {
  const e = err as any;
  return Number(e?.response?.status ?? e?.status ?? e?.code) === 410;
}

interface Contadores {
  creados: number;
  actualizados: number;
  retirados: number;
  avisos: number;
}

/**
 * Sincroniza el calendario de la clínica hacia sus bloqueos. Nunca lanza.
 * `forzarCompleta` rehace todo desde ayer (lo usa el cron una vez por semana
 * sin pedirlo; se expone para pruebas y soporte).
 */
export async function sincronizarEntrante(
  p: PuertosEntrante,
  clinicId: string,
  opts: { forzarCompleta?: boolean; presupuestoMs?: number } = {},
): Promise<ResultadoEntrante> {
  // Regla (c): sin clínica no se consulta nada.
  if (!clinicId) return { estado: "apagado" };
  const reloj = () => p.ahora?.() ?? new Date();
  const limite = Date.now() + (opts.presupuestoMs ?? PRESUPUESTO_ENTRANTE_MS);

  try {
    const estado0 = await p.leerEstado(clinicId);
    if (!estado0?.enabled) return { estado: "apagado" };
    const conexion = await p.leerConexion(clinicId);
    if (!conexion?.enabled || !conexion.refreshToken || !conexion.calendarId) return { estado: "sin_conexion" };

    if (!(await p.tomarTurno(clinicId, new Date(reloj().getTime() + TURNO_MS)))) {
      await p.marcarSucio(clinicId);
      return { estado: "en_curso" };
    }

    const total: Contadores = { creados: 0, actualizados: 0, retirados: 0, avisos: 0 };
    let completaHecha = false;
    let vueltas = 0;
    let forzar = opts.forzarCompleta === true;
    try {
      while (vueltas < MAX_VUELTAS) {
        vueltas++;
        const estado = vueltas === 1 ? estado0 : await p.leerEstado(clinicId);
        if (!estado?.enabled) break;
        const r = await pasada(p, clinicId, conexion, estado, forzar, limite, reloj, total);
        completaHecha = completaHecha || r.completa;
        forzar = false;
        const sucio = await p.soltarTurno(clinicId);
        // En la última vuelta (o sin tiempo) NO se retoma el turno: retomarlo
        // borraría la marca de «sucio» sin sincronizar. Se queda para el siguiente disparo.
        if (!sucio || Date.now() >= limite || vueltas >= MAX_VUELTAS) {
          await p.guardarError(clinicId, null);
          return { estado: "ok", completa: completaHecha, ...total, vueltas };
        }
        // Llegó un aviso mientras corría: otra vuelta, con el turno otra vez.
        if (!(await p.tomarTurno(clinicId, new Date(reloj().getTime() + TURNO_MS)))) {
          return { estado: "ok", completa: completaHecha, ...total, vueltas };
        }
      }
      await p.soltarTurno(clinicId);
      await p.guardarError(clinicId, null);
      return { estado: "ok", completa: completaHecha, ...total, vueltas };
    } catch (err) {
      await p.soltarTurno(clinicId).catch(() => false);
      if (err instanceof SinTiempo) {
        // Lo hecho queda hecho (idempotente); el siguiente disparo sigue.
        return { estado: "parcial", motivo: "tiempo" };
      }
      throw err;
    }
  } catch (err) {
    const motivo = clasificarErrorEntrante(err);
    p.log?.(`[google-entrante] clínica ${clinicId}: ${motivo}`, (err as any)?.message ?? err);
    try { await p.guardarError(clinicId, motivo); } catch { /* nunca lanza */ }
    return { estado: "fallo", motivo };
  }
}

async function pasada(
  p: PuertosEntrante,
  clinicId: string,
  conexion: ConexionGoogle,
  estado: EstadoEntrante,
  forzar: boolean,
  limite: number,
  reloj: () => Date,
  total: Contadores,
): Promise<{ completa: boolean }> {
  const calendarId = conexion.calendarId as string;
  const refreshToken = conexion.refreshToken as string;
  const pendientes: Promise<unknown>[] = [];
  const cal = p.abrirCalendar({
    accessToken: conexion.accessToken,
    refreshToken,
    alRenovarToken: (t) => {
      pendientes.push(p.guardarAccessToken(clinicId, refreshToken, t).catch(() => undefined));
    },
  });

  const ahora = reloj();
  let completa =
    forzar ||
    tocaCompleta({
      syncToken: estado.syncToken,
      calendarIdGuardado: estado.calendarId,
      calendarIdActual: calendarId,
      lastFullSyncAt: estado.lastFullSyncAt,
      ahora,
    });

  const doctores = await p.leerDoctores(clinicId);
  const zona = conexion.timezone || "America/Mexico_City";

  try {
    for (let intento = 0; intento < 2; intento++) {
      const desde = new Date(ahora.getTime() - VENTANA_PASADO_MS);
      const vistos = new Set<string>();
      let pageToken: string | undefined;
      let nextSyncToken: string | null = null;
      try {
        for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
          if (Date.now() >= limite) throw new SinTiempo();
          if (pagina > 0) await p.renovarTurno(clinicId, new Date(reloj().getTime() + TURNO_MS));
          const params: Record<string, unknown> = {
            calendarId,
            singleEvents: true,
            showDeleted: true,
            maxResults: 250,
          };
          if (completa) params.timeMin = desde.toISOString();
          else params.syncToken = estado.syncToken;
          if (pageToken) params.pageToken = pageToken;
          const r = await cal.events.list(params);
          const items = (r.data.items ?? []).filter((e): e is EventoGoogle => !!e && typeof e.id === "string" && !!e.id);
          for (const e of items) vistos.add(e.id as string);
          await procesarPagina(p, clinicId, calendarId, items, { zona, ahora: reloj(), doctores }, total);
          pageToken = r.data.nextPageToken ?? undefined;
          if (!pageToken) {
            nextSyncToken = r.data.nextSyncToken ?? null;
            break;
          }
        }
      } catch (err) {
        // 410: el syncToken caducó → completa desde cero, una vez.
        if (!completa && esTokenCaducado(err) && intento === 0) {
          completa = true;
          continue;
        }
        throw err;
      }
      if (pageToken) throw new SinTiempo(); // demasiadas páginas en una pasada: la siguiente sigue
      if (completa) total.retirados += await p.retirarNoVistos(clinicId, vistos, desde, reloj());
      await p.guardarProgreso(clinicId, { calendarId, syncToken: nextSyncToken, completa, ahora: reloj() });
      return { completa };
    }
    return { completa };
  } finally {
    await Promise.allSettled(pendientes);
  }
}

async function procesarPagina(
  p: PuertosEntrante,
  clinicId: string,
  calendarId: string,
  eventos: EventoGoogle[],
  ctx: { zona: string; ahora: Date; doctores: { id: string; email: string | null }[] },
  total: Contadores,
): Promise<void> {
  if (eventos.length === 0) return;
  const ids = eventos.map((e) => e.id as string);
  // Dos lecturas por página (no por evento): el pooler agradece.
  const vinculos = new Map((await p.leerVinculos(clinicId, calendarId, ids)).map((v) => [v.googleEventId, v]));
  const deCitas = await p.eventosDeCitas(clinicId, ids);

  for (const ev of eventos) {
    const id = ev.id as string;
    const v = vinculos.get(id) ?? null;

    // ── Una cita convertida: se AVISA, la cita nunca se mueve ni se cancela sola.
    if (v?.appointmentId) {
      const cita = await p.leerCita(clinicId, v.appointmentId);
      const cambios = decidirAvisoCita(ev, v, cita, ctx);
      if (Object.keys(cambios).length > 0) {
        await p.actualizarVinculo(clinicId, v.blockId, cambios);
        if (cambios.avisoTipo) total.avisos++;
      }
      continue;
    }

    // ── La serie entera se borró: Google puede mandar solo el evento «padre».
    if (ev.status === "cancelled" && !ev.recurringEventId && !v) {
      for (const hijo of await p.leerVinculosDeSerie(clinicId, calendarId, id)) {
        if (hijo.activo && !hijo.appointmentId) {
          await p.inactivarBloqueo(clinicId, hijo.blockId, ctx.ahora);
          total.retirados++;
        }
      }
      continue;
    }

    // ── El eco: un evento que es de una cita (marca, id determinista o ya ligado a una).
    const existente: BloqueoExistente | null = v
      ? { blockId: v.blockId, activo: v.activo, doctorId: v.doctorId, startsAt: v.startsAt, endsAt: v.endsAt, title: v.title, allDay: v.allDay }
      : null;
    const esDeCita = deCitas.has(id) || esEventoDeDaleControl(ev);
    const decision = esDeCita
      ? existente?.activo
        ? { accion: "inactivar" as const, blockId: existente.blockId }
        : { accion: "nada" as const }
      : decidirEvento(ev, { ...ctx, existente });

    switch (decision.accion) {
      case "crear":
        await p.crearBloqueo(clinicId, calendarId, id, decision.datos);
        total.creados++;
        break;
      case "actualizar":
        await p.actualizarBloqueo(clinicId, decision.blockId, decision.datos);
        total.actualizados++;
        break;
      case "inactivar":
        await p.inactivarBloqueo(clinicId, decision.blockId, ctx.ahora);
        total.retirados++;
        break;
      default:
        break;
    }
  }
}
