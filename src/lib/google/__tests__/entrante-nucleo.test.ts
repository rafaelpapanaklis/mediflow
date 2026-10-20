/**
 * Google Calendar → agenda (WS1-T9): la sincronización entera, con una base
 * en memoria y una Google falsa. Sin red y sin base de datos.
 *
 * `npm run test:google-entrante`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sincronizarEntrante, type PuertosEntrante, type VinculoLeido } from "../entrante-nucleo";
import type { EventoGoogle, UsuarioClinica } from "../entrante-core";

const AHORA = new Date("2026-10-20T15:00:00Z");
const CAL = "cal-clinica@group.calendar.google.com";

interface Bloque { id: string; doctorId: string | null; startsAt: Date; endsAt: Date; deletedAt: Date | null; kind: "GOOGLE" }
interface Vinc {
  blockId: string; calendarId: string; googleEventId: string; recurringEventId: string | null; title: string; allDay: boolean; alcance?: string | null;
  appointmentId: string | null; eventStartsAt: Date; eventEndsAt: Date; eventDeletedAt: Date | null;
  avisoTipo: string | null; avisoStartsAt?: Date | null;
}

/** Una Google falsa: un calendario con eventos y un historial de cambios para el syncToken. */
class GoogleFalsa {
  eventos = new Map<string, EventoGoogle>();
  version = 0;
  cambiosDesde = new Map<string, number>(); // id → versión del último cambio
  llamadas: Record<string, unknown>[] = [];
  tokenCaducado = false;
  fallo: unknown = null;
  porPagina = 250;

  poner(e: EventoGoogle) {
    this.version++;
    this.eventos.set(e.id as string, e);
    this.cambiosDesde.set(e.id as string, this.version);
  }
  borrar(id: string) {
    const e = this.eventos.get(id);
    if (!e) return;
    this.poner({ ...e, status: "cancelled" });
  }
  gets: string[] = [];
  cliente() {
    return {
      events: {
        get: async (p: { calendarId: string; eventId: string }) => {
          this.gets.push(p.eventId);
          const e = this.eventos.get(p.eventId);
          if (!e) throw { response: { status: 404 } };
          return { data: e };
        },
        list: async (p: Record<string, unknown>) => {
          this.llamadas.push(p);
          if (this.fallo) throw this.fallo;
          if (p.syncToken && this.tokenCaducado) {
            this.tokenCaducado = false;
            throw { response: { status: 410 } };
          }
          let items = [...this.eventos.values()];
          if (p.syncToken) {
            const desde = Number(String(p.syncToken).replace("v", ""));
            items = items.filter((e) => (this.cambiosDesde.get(e.id as string) ?? 0) > desde);
          }
          const inicio = Number(p.pageToken ?? 0);
          const pagina = items.slice(inicio, inicio + this.porPagina);
          const hay = inicio + this.porPagina < items.length;
          return {
            data: {
              items: pagina,
              nextPageToken: hay ? String(inicio + this.porPagina) : null,
              nextSyncToken: hay ? null : `v${this.version}`,
            },
          };
        },
        watch: async () => ({ data: {} }),
      },
      channels: { stop: async () => undefined },
    };
  }
}

function montar(opts: { enabled?: boolean; conectada?: boolean; calendario?: string; calendarioEnOtra?: boolean } = {}) {
  const cal = opts.calendario ?? CAL;
  const google = new GoogleFalsa();
  const bloques = new Map<string, Bloque>();
  const vinculos = new Map<string, Vinc>();
  const citas = new Map<string, { status: string; startsAt: Date; endsAt: Date; googleCalendarEventId: string | null }>();
  const estado = {
    enabled: opts.enabled ?? true,
    calendarId: null as string | null,
    syncToken: null as string | null,
    lastFullSyncAt: null as Date | null,
    lastSyncAt: null as Date | null,
    channelId: null, channelResourceId: null, channelExpiresAt: null, channelCalendarId: null,
    lease: null as Date | null,
    dirty: null as Date | null,
    error: null as string | null,
    equipoFirma: null as string | null,
  };
  const usuarios: UsuarioClinica[] = [
    { id: "doc-ana", email: "ana@clinica.mx", recibeCitas: true, rol: "DOCTOR", nombre: "Ana López" },
    { id: "rec-eva", email: "recepcion@clinica.mx", recibeCitas: false, rol: "RECEPTIONIST", nombre: "Eva Ruiz" },
  ];
  let n = 0;
  const consultas = { series: 0 };
  const leer = (v: Vinc): VinculoLeido => {
    const b = bloques.get(v.blockId)!;
    return {
      blockId: v.blockId, googleEventId: v.googleEventId, recurringEventId: v.recurringEventId,
      activo: b.deletedAt === null, doctorId: b.doctorId, alcance: (v.alcance ?? null) as VinculoLeido["alcance"], startsAt: b.startsAt, endsAt: b.endsAt,
      title: v.title, allDay: v.allDay, appointmentId: v.appointmentId,
      eventStartsAt: v.eventStartsAt, eventEndsAt: v.eventEndsAt, eventDeletedAt: v.eventDeletedAt, avisoTipo: v.avisoTipo,
    };
  };
  const p: PuertosEntrante & { _mientrasCorre?: () => Promise<void> } = {
    leerEstado: async () => ({ ...estado }),
    leerConexion: async () =>
      opts.conectada === false
        ? { enabled: false, accessToken: null, refreshToken: null, calendarId: cal, timezone: "America/Mexico_City" }
        : { enabled: true, accessToken: "at", refreshToken: "rt", calendarId: cal, timezone: "America/Mexico_City" },
    tomarTurno: async (_c, hasta) => {
      if (estado.lease && estado.lease > AHORA) return false;
      estado.lease = hasta;
      estado.dirty = null;
      return true;
    },
    soltarTurno: async () => {
      if (p._mientrasCorre) { const f = p._mientrasCorre; p._mientrasCorre = undefined; await f(); }
      estado.lease = null;
      return !!estado.dirty;
    },
    marcarSucio: async () => { estado.dirty = AHORA; },
    renovarTurno: async (_c, hasta) => { if (estado.lease) estado.lease = hasta; },
    guardarProgreso: async (_c, d) => {
      estado.calendarId = d.calendarId;
      estado.syncToken = d.syncToken;
      estado.lastSyncAt = d.ahora;
      if (d.completa) estado.lastFullSyncAt = d.ahora;
      if (d.equipoFirma) estado.equipoFirma = d.equipoFirma;
    },
    guardarError: async (_c, e) => { estado.error = e; },
    abrirCalendar: () => google.cliente(),
    guardarAccessToken: async () => undefined,
    leerUsuarios: async () => usuarios.map((u) => ({ ...u })),
    calendarioEnOtraClinica: async () => opts.calendarioEnOtra === true,
    leerVinculos: async (_c, cal, ids) => [...vinculos.values()].filter((v) => v.calendarId === cal && ids.includes(v.googleEventId)).map(leer),
    leerVinculosDeSeries: async (_c, cal, series) => {
      consultas.series++;
      return [...vinculos.values()].filter((v) => v.calendarId === cal && !!v.recurringEventId && series.includes(v.recurringEventId) && !v.appointmentId).map(leer);
    },
    eventosDeCitas: async (_c, ids) => new Set([...citas.values()].map((c) => c.googleCalendarEventId).filter((x): x is string => !!x && ids.includes(x))),
    crearBloqueo: async (_c, cal, eventId, d) => {
      if ([...vinculos.values()].some((v) => v.calendarId === cal && v.googleEventId === eventId)) return; // índice único
      const id = `b${++n}`;
      bloques.set(id, { id, doctorId: d.doctorId, startsAt: d.startsAt, endsAt: d.endsAt, deletedAt: null, kind: "GOOGLE" });
      vinculos.set(id, { blockId: id, calendarId: cal, googleEventId: eventId, recurringEventId: d.recurringEventId, title: d.title, allDay: d.allDay, alcance: d.alcance, appointmentId: null, eventStartsAt: d.startsAt, eventEndsAt: d.endsAt, eventDeletedAt: null, avisoTipo: null });
    },
    actualizarBloqueo: async (_c, id, d) => {
      Object.assign(bloques.get(id)!, { doctorId: d.doctorId, startsAt: d.startsAt, endsAt: d.endsAt, deletedAt: null });
      Object.assign(vinculos.get(id)!, { title: d.title, allDay: d.allDay, alcance: d.alcance, eventStartsAt: d.startsAt, eventEndsAt: d.endsAt, eventDeletedAt: null });
    },
    inactivarBloqueo: async (_c, id, ahora) => {
      const b = bloques.get(id)!;
      if (!b.deletedAt) b.deletedAt = ahora;
    },
    leerCita: async (_c, id) => {
      const c = citas.get(id);
      return c ? { status: c.status, startsAt: c.startsAt, endsAt: c.endsAt, googleEventId: c.googleCalendarEventId } : null;
    },
    actualizarVinculo: async (_c, id, cambios, antes) => {
      const v = vinculos.get(id)!;
      if (antes && (v.eventStartsAt.getTime() !== antes.eventStartsAt.getTime() || v.eventEndsAt.getTime() !== antes.eventEndsAt.getTime())) return false;
      Object.assign(v, cambios);
      return true;
    },
    retirarNoVistos: async (_c, vistos, desde, hasta, ahora) => {
      let k = 0;
      for (const v of vinculos.values()) {
        const b = bloques.get(v.blockId)!;
        if (!v.appointmentId && !b.deletedAt && b.endsAt > desde && b.startsAt < hasta && !vistos.has(v.googleEventId)) { b.deletedAt = ahora; k++; }
      }
      return k;
    },
    ahora: () => AHORA,
  };
  return { p, google, bloques, vinculos, citas, estado, consultas, usuarios };
}

const evento = (id: string, x: Partial<EventoGoogle> = {}): EventoGoogle => ({
  id,
  status: "confirmed",
  summary: `Evento ${id}`,
  start: { dateTime: "2026-10-21T10:00:00-06:00" },
  end: { dateTime: "2026-10-21T11:00:00-06:00" },
  updated: "2026-10-20T14:00:00Z",
  ...x,
});

const activos = (b: Map<string, Bloque>) => [...b.values()].filter((x) => !x.deletedAt);

test("bandera apagada o Google sin conectar → no toca nada ni llama a Google", async () => {
  const a = montar({ enabled: false });
  assert.deepEqual(await sincronizarEntrante(a.p, "c1"), { estado: "apagado" });
  const b = montar({ conectada: false });
  assert.deepEqual(await sincronizarEntrante(b.p, "c1"), { estado: "sin_conexion" });
  assert.equal(a.google.llamadas.length + b.google.llamadas.length, 0);
  assert.deepEqual(await sincronizarEntrante(a.p, ""), { estado: "apagado" });
});

test("primera vez: completa desde ayer; crea los bloqueos y NO los ecos de las citas de DaleControl", async () => {
  const a = montar();
  a.google.poner(evento("e1", { attendees: [{ email: "ana@clinica.mx" }] }));
  a.google.poner(evento("e2", { transparency: "transparent" }));
  a.google.poner(evento("dc" + "f".repeat(40), { extendedProperties: { private: { dalecontrolClinicId: "c1" } } }));
  a.google.poner(evento("e3", { extendedProperties: { private: { dalecontrolAppointmentId: "x" } } }));
  const r = await sincronizarEntrante(a.p, "c1");
  assert.equal(r.estado, "ok");
  assert.equal(a.google.llamadas[0].timeMin, "2026-10-19T15:00:00.000Z");
  assert.equal(a.google.llamadas[0].syncToken, undefined);
  assert.equal(a.google.llamadas[0].singleEvents, true);
  assert.equal(a.google.llamadas[0].showDeleted, true);
  assert.equal(activos(a.bloques).length, 1);
  assert.equal([...a.bloques.values()][0].doctorId, "doc-ana");
  assert.equal(a.estado.syncToken, `v${a.google.version}`);
  assert.equal(a.estado.calendarId, CAL);
});

test("idempotente: repetir no duplica; la segunda va con syncToken y sin cambios no escribe", async () => {
  const a = montar();
  a.google.poner(evento("e1"));
  await sincronizarEntrante(a.p, "c1");
  const r = await sincronizarEntrante(a.p, "c1");
  assert.equal(a.bloques.size, 1);
  assert.equal(a.google.llamadas[1].syncToken, "v1");
  assert.equal(a.google.llamadas[1].timeMin, undefined);
  assert.equal(r.estado === "ok" && r.creados + r.actualizados + r.retirados, 0);
});

test("incremental: el bloqueo SIGUE a su evento (se mueve) y al borrarlo se RETIRA, sin borrarse", async () => {
  const a = montar();
  a.google.poner(evento("e1"));
  await sincronizarEntrante(a.p, "c1");
  a.google.poner(evento("e1", { start: { dateTime: "2026-10-21T15:00:00-06:00" }, end: { dateTime: "2026-10-21T16:00:00-06:00" } }));
  await sincronizarEntrante(a.p, "c1");
  const b = [...a.bloques.values()][0];
  assert.equal(b.startsAt.toISOString(), "2026-10-21T21:00:00.000Z");
  a.google.borrar("e1");
  await sincronizarEntrante(a.p, "c1");
  assert.equal(a.bloques.size, 1, "no se borra la fila");
  assert.ok(b.deletedAt, "queda retirado");
  // Y si vuelve (alguien deshace el borrado), se reactiva.
  a.google.poner(evento("e1"));
  await sincronizarEntrante(a.p, "c1");
  assert.equal(b.deletedAt, null);
});

test("410 (syncToken caducado) → completa otra vez, sin fallar", async () => {
  const a = montar();
  a.google.poner(evento("e1"));
  await sincronizarEntrante(a.p, "c1");
  a.google.tokenCaducado = true;
  const r = await sincronizarEntrante(a.p, "c1");
  assert.equal(r.estado, "ok");
  assert.equal(r.estado === "ok" && r.completa, true);
  assert.equal(a.bloques.size, 1);
});

test("la completa retira los bloqueos cuyo evento ya no aparece (p. ej. tras cambiar de calendario)", async () => {
  const a = montar();
  a.google.poner(evento("e1"));
  a.google.poner(evento("e2"));
  await sincronizarEntrante(a.p, "c1");
  a.google.eventos.delete("e2"); // desaparece sin rastro (otro calendario)
  await sincronizarEntrante(a.p, "c1", { forzarCompleta: true });
  assert.equal(activos(a.bloques).length, 1);
  assert.equal(a.bloques.size, 2);
});

test("varias páginas: se leen todas antes de guardar el syncToken", async () => {
  const a = montar();
  a.google.porPagina = 2;
  for (let i = 0; i < 5; i++) a.google.poner(evento(`e${i}`));
  await sincronizarEntrante(a.p, "c1");
  assert.equal(a.bloques.size, 5);
  assert.equal(a.google.llamadas.length, 3);
  assert.equal(a.estado.syncToken, "v5");
});

test("otra sincronización en curso → no corre a la vez: marca «sucio»", async () => {
  const a = montar();
  a.estado.lease = new Date(AHORA.getTime() + 60_000);
  assert.deepEqual(await sincronizarEntrante(a.p, "c1"), { estado: "en_curso" });
  assert.ok(a.estado.dirty);
  assert.equal(a.google.llamadas.length, 0);
});

test("llega un aviso mientras corre → da otra vuelta y recoge el cambio", async () => {
  const a = montar();
  a.google.poner(evento("e1"));
  a.p._mientrasCorre = async () => {
    a.google.poner(evento("e2"));
    a.estado.dirty = AHORA;
  };
  const r = await sincronizarEntrante(a.p, "c1");
  assert.equal(r.estado === "ok" && r.vueltas, 2);
  assert.equal(a.bloques.size, 2);
  assert.equal(a.estado.lease, null, "el turno queda libre");
});

test("evento que ya es de una cita (googleCalendarEventId) → nunca bloquea", async () => {
  const a = montar();
  a.citas.set("cita1", { status: "SCHEDULED", startsAt: new Date(), endsAt: new Date(), googleCalendarEventId: "e1" });
  a.google.poner(evento("e1"));
  await sincronizarEntrante(a.p, "c1");
  assert.equal(a.bloques.size, 0);
});

test("cita convertida: Google mueve el evento → aviso en la cita; la cita NO se mueve; eliminarlo → aviso «eliminado», sin cancelar", async () => {
  const a = montar();
  a.google.poner(evento("e1"));
  await sincronizarEntrante(a.p, "c1");
  const v = [...a.vinculos.values()][0];
  // «Convertir en cita»: lo que hace la ruta de alta.
  const t10 = new Date("2026-10-21T16:00:00Z");
  const t11 = new Date("2026-10-21T17:00:00Z");
  a.citas.set("cita1", { status: "SCHEDULED", startsAt: t10, endsAt: t11, googleCalendarEventId: "e1" });
  Object.assign(v, { appointmentId: "cita1", eventStartsAt: t10, eventEndsAt: t11 });
  a.bloques.get(v.blockId)!.deletedAt = AHORA;
  // El parche de salida: Google pasa a ser «de DaleControl» con la misma hora.
  a.google.poner(evento("e1", { summary: "🏥 Limpieza — Ana G.", extendedProperties: { private: { dalecontrolClinicId: "c1", dalecontrolAppointmentId: "cita1" } } }));
  await sincronizarEntrante(a.p, "c1");
  assert.equal(v.avisoTipo, null, "nuestro propio parche no avisa");
  assert.equal(activos(a.bloques).length, 0, "el bloqueo convertido sigue retirado");

  a.google.poner(evento("e1", { start: { dateTime: "2026-10-21T12:00:00-06:00" }, end: { dateTime: "2026-10-21T13:00:00-06:00" } }));
  await sincronizarEntrante(a.p, "c1");
  assert.equal(v.avisoTipo, "movido");
  assert.equal(a.citas.get("cita1")!.startsAt, t10, "la cita no se mueve sola");
  assert.equal(activos(a.bloques).length, 0, "y no reaparece como bloqueo");

  a.google.borrar("e1");
  await sincronizarEntrante(a.p, "c1");
  assert.equal(v.avisoTipo, "eliminado");
  assert.equal(a.citas.get("cita1")!.status, "SCHEDULED", "la cita no se cancela sola");
});

test("la serie entera se borra (llega solo el evento padre) → se retiran sus repeticiones", async () => {
  const a = montar();
  a.google.poner(evento("serie_20261021", { recurringEventId: "serie" }));
  a.google.poner(evento("serie_20261028", { recurringEventId: "serie", start: { dateTime: "2026-10-28T10:00:00-06:00" }, end: { dateTime: "2026-10-28T11:00:00-06:00" } }));
  await sincronizarEntrante(a.p, "c1");
  assert.equal(activos(a.bloques).length, 2);
  a.google.poner({ id: "serie", status: "cancelled" });
  await sincronizarEntrante(a.p, "c1");
  assert.equal(activos(a.bloques).length, 0);
});

test("Google no deja LEER (permiso) → «fallo: permisos» guardado; no lanza y suelta el turno", async () => {
  const a = montar();
  a.google.fallo = { response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } } };
  const r = await sincronizarEntrante(a.p, "c1");
  assert.deepEqual(r, { estado: "fallo", motivo: "permisos" });
  assert.equal(a.estado.error, "permisos");
  assert.equal(a.estado.lease, null);
  // Al volver a funcionar, el error se limpia.
  a.google.fallo = null;
  await sincronizarEntrante(a.p, "c1");
  assert.equal(a.estado.error, null);
});

test("sin tiempo a media pasada → «parcial», sin guardar un syncToken a medias", async () => {
  const a = montar();
  a.google.porPagina = 1;
  for (let i = 0; i < 3; i++) a.google.poner(evento(`e${i}`));
  const r = await sincronizarEntrante(a.p, "c1", { presupuestoMs: -1 });
  assert.deepEqual(r, { estado: "parcial", motivo: "tiempo" });
  assert.equal(a.estado.syncToken, null);
  assert.equal(a.estado.lease, null);
  // Queda anotado el intento: la agenda respeta el freno de 60 s (G15).
  assert.equal(a.estado.error, "parcial");
});

/* ═══ Revisión t8 ════════════════════════════════════════════════════ */

test("G14: el calendario guardado es el PERSONAL (primary o un correo) → no se lee nada y la agenda lo dice", async () => {
  for (const cal of ["primary", "dra.ruiz@gmail.com"]) {
    const a = montar({ calendario: cal });
    a.google.poner(evento("e1"));
    assert.deepEqual(await sincronizarEntrante(a.p, "c1"), { estado: "fallo", motivo: "calendario_personal" });
    assert.equal(a.estado.error, "calendario_personal");
    assert.equal(a.google.llamadas.length, 0);
    assert.equal(a.bloques.size, 0);
  }
});

test("G14: otra clínica con la bandera usa el MISMO calendario → no se lee (una sede cerraría a la otra)", async () => {
  const a = montar({ calendarioEnOtra: true });
  a.google.poner(evento("e1"));
  assert.deepEqual(await sincronizarEntrante(a.p, "c1"), { estado: "fallo", motivo: "calendario_compartido" });
  assert.equal(a.bloques.size, 0);
});

test("G1: el porqué de «toda la clínica» se guarda; un invitado de recepción deja el bloqueo a su nombre", async () => {
  const a = montar();
  a.google.poner(evento("e1", { attendees: [{ email: "dra.ruiz@gmail.com" }] }));
  a.google.poner(evento("e2", { attendees: [{ email: "recepcion@clinica.mx" }] }));
  await sincronizarEntrante(a.p, "c1");
  const porEvento = new Map([...a.vinculos.values()].map((v) => [v.googleEventId, v]));
  assert.equal(porEvento.get("e1")!.alcance, "no_reconocido");
  assert.equal(a.bloques.get(porEvento.get("e1")!.blockId)!.doctorId, null);
  assert.equal(porEvento.get("e2")!.alcance, null);
  assert.equal(a.bloques.get(porEvento.get("e2")!.blockId)!.doctorId, "rec-eva");
});

test("G15: los borrados de citas de DaleControl no disparan consultas de series; los padres de serie, UNA por página", async () => {
  const a = montar();
  a.google.poner(evento("serie_1", { recurringEventId: "serie" }));
  await sincronizarEntrante(a.p, "c1");
  for (let i = 0; i < 5; i++) a.google.poner({ id: "dc" + String(i).repeat(40), status: "cancelled" });
  a.google.poner({ id: "otro", status: "cancelled" });
  a.google.poner({ id: "serie", status: "cancelled" });
  await sincronizarEntrante(a.p, "c1");
  assert.equal(a.consultas.series, 1, "una lectura para toda la página");
  assert.equal(activos(a.bloques).length, 0, "y la serie se retiró igual");
});

test("G7: la cita convertida ya va ligada a OTRO evento → lo que le pase al viejo no le avisa", async () => {
  const a = montar();
  a.google.poner(evento("e1"));
  await sincronizarEntrante(a.p, "c1");
  const v = [...a.vinculos.values()][0];
  const t10 = new Date("2026-10-21T16:00:00Z");
  const t11 = new Date("2026-10-21T17:00:00Z");
  // Se canceló y se reactivó con un evento nuevo de DaleControl.
  a.citas.set("cita1", { status: "SCHEDULED", startsAt: t10, endsAt: t11, googleCalendarEventId: "dc" + "e".repeat(40) });
  Object.assign(v, { appointmentId: "cita1", eventStartsAt: t10, eventEndsAt: t11 });
  a.google.borrar("e1");
  await sincronizarEntrante(a.p, "c1");
  assert.equal(v.avisoTipo, null);
  assert.ok(v.eventDeletedAt, "el vínculo sí anota que el evento viejo se borró");
});

/* ═══ Segunda vuelta de la revisión t8 ════════════════════════════════════ */

test("N-G2: recepción + el Gmail personal de la doctora → cierra TODA la clínica (nunca «a nadie»)", async () => {
  const a = montar();
  a.google.poner(evento("q1", { summary: "Quirófano", attendees: [{ email: "recepcion@clinica.mx" }, { email: "ana.lopez.83@gmail.com" }] }));
  await sincronizarEntrante(a.p, "c1");
  const [b] = activos(a.bloques);
  assert.equal(b.doctorId, null, "de toda la clínica: cierra también a la doctora");
  assert.equal([...a.vinculos.values()][0].alcance, "no_reconocido");
});

test("N-G2: si ese Gmail es el que la doctora conectó a Google (users.googleCalendarEmail) → cierra SU agenda", async () => {
  const a = montar();
  a.usuarios[0].otrosCorreos = ["ana.lopez.83@gmail.com"];
  a.google.poner(evento("q1", { summary: "Quirófano", attendees: [{ email: "recepcion@clinica.mx" }, { email: "Ana.Lopez.83@gmail.com" }] }));
  await sincronizarEntrante(a.p, "c1");
  assert.equal(activos(a.bloques)[0].doctorId, "doc-ana");
});

test("N-G5: cambia el equipo → la siguiente pasada es COMPLETA y el evento que ya estaba cambia de dueño", async () => {
  const a = montar();
  a.google.poner(evento("e1", { attendees: [{ email: "nueva@clinica.mx" }] }));
  await sincronizarEntrante(a.p, "c1");
  assert.equal(activos(a.bloques)[0].doctorId, null, "nadie de la clínica todavía: toda la clínica");
  // Sin cambios en el equipo, la siguiente es incremental (no relee nada).
  await sincronizarEntrante(a.p, "c1");
  assert.equal(a.google.llamadas[1].syncToken, "v1");
  // Entra la doctora con ese correo: el evento no cambió en Google, pero ya es suyo.
  a.usuarios.push({ id: "doc-nueva", email: "nueva@clinica.mx", recibeCitas: true, rol: "DOCTOR", nombre: "Sara Gil" });
  const r = await sincronizarEntrante(a.p, "c1");
  assert.equal(r.estado === "ok" && r.completa, true);
  assert.equal(a.google.llamadas[2].syncToken, undefined);
  assert.equal(activos(a.bloques)[0].doctorId, "doc-nueva");
  // Y la que sigue vuelve a ser incremental.
  await sincronizarEntrante(a.p, "c1");
  assert.ok(a.google.llamadas[3].syncToken);
});

test("N-G6: un evento hecho a mano con el título y el pie de una cita (duplicado en Google) SÍ cierra la agenda; ligado a una cita, no", async () => {
  const a = montar();
  const copia = { summary: "🏥 Limpieza — Ana G.", description: "Paciente: Ana G.\nAgendado desde DaleControl" };
  a.google.poner(evento("dup", { ...copia, attendees: [{ email: "ana@clinica.mx" }] }));
  a.google.poner(evento("viejo", copia));
  a.citas.set("cita-1", { status: "SCHEDULED", startsAt: new Date("2026-10-21T16:00:00Z"), endsAt: new Date("2026-10-21T17:00:00Z"), googleCalendarEventId: "viejo" });
  await sincronizarEntrante(a.p, "c1");
  const porEvento = new Map([...a.vinculos.values()].map((v) => [v.googleEventId, v]));
  assert.ok(porEvento.has("dup"), "el duplicado cierra la agenda");
  assert.equal(a.bloques.get(porEvento.get("dup")!.blockId)!.doctorId, "doc-ana");
  assert.equal(porEvento.has("viejo"), false, "el evento de una cita es eco");
});

test("N-G8: la completa pide hasta el horizonte (timeMax) y solo retira lo que cae dentro; la incremental no lleva fechas", async () => {
  const a = montar();
  a.google.poner(evento("e1"));
  await sincronizarEntrante(a.p, "c1");
  const [primera] = a.google.llamadas;
  assert.equal(primera.timeMin, new Date(AHORA.getTime() - 24 * 3600_000).toISOString());
  assert.equal(primera.timeMax, new Date(AHORA.getTime() + 400 * 24 * 3600_000).toISOString());
  // Un bloqueo más allá del horizonte (no lo pudo traer esta lista) no se retira por «no visto».
  a.bloques.set("lejos", { id: "lejos", doctorId: null, startsAt: new Date("2028-01-01T00:00:00Z"), endsAt: new Date("2028-01-02T00:00:00Z"), deletedAt: null, kind: "GOOGLE" });
  a.vinculos.set("lejos", { blockId: "lejos", calendarId: CAL, googleEventId: "lejos", recurringEventId: null, title: "x", allDay: true, appointmentId: null, eventStartsAt: new Date("2028-01-01T00:00:00Z"), eventEndsAt: new Date("2028-01-02T00:00:00Z"), eventDeletedAt: null, avisoTipo: null });
  await sincronizarEntrante(a.p, "c1", { forzarCompleta: true });
  assert.equal(a.bloques.get("lejos")!.deletedAt, null);
  await sincronizarEntrante(a.p, "c1");
  const ultima = a.google.llamadas[a.google.llamadas.length - 1];
  assert.equal(ultima.timeMin, undefined);
  assert.equal(ultima.timeMax, undefined);
});

test("N-G1: si la salida anota otra hora entre que la entrada lee el vínculo y lo guarda, la lectura vieja no saca un aviso falso", async () => {
  const a = montar();
  const id = "conv";
  a.google.poner(evento(id, { start: { dateTime: "2026-10-21T11:00:00-06:00" }, end: { dateTime: "2026-10-21T12:00:00-06:00" } }));
  a.bloques.set("bc", { id: "bc", doctorId: "doc-ana", startsAt: new Date("2026-10-21T16:00:00Z"), endsAt: new Date("2026-10-21T17:00:00Z"), deletedAt: new Date(), kind: "GOOGLE" });
  a.vinculos.set("bc", { blockId: "bc", calendarId: CAL, googleEventId: id, recurringEventId: null, title: "x", allDay: false, appointmentId: "cita-c", eventStartsAt: new Date("2026-10-21T16:00:00Z"), eventEndsAt: new Date("2026-10-21T17:00:00Z"), eventDeletedAt: null, avisoTipo: null });
  // La cita ya va a las 12:00 (segundo cambio) y la salida lo dejó en Google y lo anotó…
  a.citas.set("cita-c", { status: "SCHEDULED", startsAt: new Date("2026-10-21T18:00:00Z"), endsAt: new Date("2026-10-21T19:00:00Z"), googleCalendarEventId: id });
  const leerCita = a.p.leerCita;
  a.p.leerCita = async (...args) => {
    // …justo después de que la entrada leyó el vínculo (10:00) y el evento (11:00, viejo).
    // En Google ya está la copia (12:00): la entrada la relee al perder la carrera (N3-G5).
    if (a.google.eventos.get(id)?.start?.dateTime !== "2026-10-21T12:00:00-06:00") {
      a.google.eventos.set(id, evento(id, { start: { dateTime: "2026-10-21T12:00:00-06:00" }, end: { dateTime: "2026-10-21T13:00:00-06:00" } }));
    }
    Object.assign(a.vinculos.get("bc")!, { eventStartsAt: new Date("2026-10-21T18:00:00Z"), eventEndsAt: new Date("2026-10-21T19:00:00Z") });
    return leerCita(...args);
  };
  await sincronizarEntrante(a.p, "c1");
  assert.equal(a.vinculos.get("bc")!.avisoTipo, null, "sin «movido a 11:00» falso");
  assert.equal(a.vinculos.get("bc")!.eventStartsAt.toISOString(), "2026-10-21T18:00:00.000Z");
});

/* ═══ Tercera vuelta (t8) ══════════════════════════════════════════════════ */

/** Una convertida a las 10:00 cuya cita se movió a las 12:00 en DaleControl. */
function convertidaMovida() {
  const a = montar();
  const id = "conv";
  const h = (hh: number) => new Date(`2026-10-21T${String(hh + 6).padStart(2, "0")}:00:00Z`); // hora de México → UTC
  a.bloques.set("bc", { id: "bc", doctorId: "doc-ana", startsAt: h(10), endsAt: h(11), deletedAt: new Date(), kind: "GOOGLE" });
  a.vinculos.set("bc", { blockId: "bc", calendarId: CAL, googleEventId: id, recurringEventId: null, title: "x", allDay: false, appointmentId: "cita-c", eventStartsAt: h(10), eventEndsAt: h(11), eventDeletedAt: null, avisoTipo: null });
  a.citas.set("cita-c", { status: "SCHEDULED", startsAt: h(12), endsAt: h(13), googleCalendarEventId: id });
  /** La salida copia la cita (12:00) a Google y lo anota en el vínculo, justo después de que la entrada leyó el vínculo. */
  const salidaEntreMedias = () => {
    const leerCita = a.p.leerCita;
    let una = false;
    a.p.leerCita = async (...args) => {
      if (!una) {
        una = true;
        Object.assign(a.vinculos.get("bc")!, { eventStartsAt: h(12), eventEndsAt: h(13) });
      }
      return leerCita(...args);
    };
  };
  return { a, id, h, salidaEntreMedias };
}

test("N3-G5: la salida anota su hora entre la lectura y la escritura, y en Google el evento YA está en otra hora (la movieron allí) → se relee y se avisa «movido», no se pierde", async () => {
  const { a, id, h, salidaEntreMedias } = convertidaMovida();
  // Lo que hay en Google ahora: alguien lo movió a las 14:00 después de la copia.
  a.google.poner(evento(id, { start: { dateTime: "2026-10-21T14:00:00-06:00" }, end: { dateTime: "2026-10-21T15:00:00-06:00" } }));
  salidaEntreMedias();
  await sincronizarEntrante(a.p, "c1");
  const v = a.vinculos.get("bc")!;
  assert.equal(v.avisoTipo, "movido", "antes: la escritura condicionada no casaba y el cambio se descartaba hasta la completa");
  assert.equal(v.avisoStartsAt?.toISOString(), h(14).toISOString());
  assert.deepEqual(a.google.gets, [id], "el evento se vuelve a leer en Google, una vez");
  assert.equal(a.citas.get("cita-c")!.startsAt.toISOString(), h(12).toISOString(), "la cita no se mueve sola");
});

test("N3-G5: …y si lo que hay en Google es la copia de la salida (la página traía el evento de ANTES) → sin aviso falso (N-G1 sigue)", async () => {
  const { a, id, h, salidaEntreMedias } = convertidaMovida();
  // La página trae el evento a las 11:00 (de antes de la copia)…
  a.google.poner(evento(id, { start: { dateTime: "2026-10-21T11:00:00-06:00" }, end: { dateTime: "2026-10-21T12:00:00-06:00" } }));
  salidaEntreMedias();
  // …pero en Google ya está la copia de la salida, a las 12:00.
  const get = a.google.cliente().events.get;
  const abrir = a.p.abrirCalendar;
  a.p.abrirCalendar = (cred) => {
    const c = abrir(cred);
    return { ...c, events: { ...c.events, get: async (p: { calendarId: string; eventId: string }) => {
      await get(p);
      return { data: evento(id, { start: { dateTime: "2026-10-21T12:00:00-06:00" }, end: { dateTime: "2026-10-21T13:00:00-06:00" } }) };
    } } };
  };
  await sincronizarEntrante(a.p, "c1");
  const v = a.vinculos.get("bc")!;
  assert.equal(v.avisoTipo, null, "sin «movido a 11:00» falso");
  assert.equal(v.eventStartsAt.toISOString(), h(12).toISOString());
  assert.equal(a.google.gets.length, 1);
});

test("N3-G5: borrado del todo en Google (404 al releer) → aviso «eliminado»; la cita sigue", async () => {
  const { a, id, salidaEntreMedias } = convertidaMovida();
  a.google.poner(evento(id, { start: { dateTime: "2026-10-21T14:00:00-06:00" }, end: { dateTime: "2026-10-21T15:00:00-06:00" } }));
  salidaEntreMedias();
  const abrir = a.p.abrirCalendar;
  a.p.abrirCalendar = (cred) => {
    const c = abrir(cred);
    return { ...c, events: { ...c.events, get: async () => { throw { response: { status: 404 } }; } } };
  };
  await sincronizarEntrante(a.p, "c1");
  assert.equal(a.vinculos.get("bc")!.avisoTipo, "eliminado");
  assert.equal(a.citas.get("cita-c")!.status, "SCHEDULED");
});

test("N3-G5: Google no deja releer (500) → no se inventa nada, pero NO se guarda el token: la siguiente pasada es completa y avisa", async () => {
  const { a, id, h, salidaEntreMedias } = convertidaMovida();
  a.google.poner(evento(id, { start: { dateTime: "2026-10-21T14:00:00-06:00" }, end: { dateTime: "2026-10-21T15:00:00-06:00" } }));
  salidaEntreMedias();
  const abrir = a.p.abrirCalendar;
  a.p.abrirCalendar = (cred) => {
    const c = abrir(cred);
    return { ...c, events: { ...c.events, get: async () => { throw { response: { status: 500 } }; } } };
  };
  const r = await sincronizarEntrante(a.p, "c1");
  assert.equal(r.estado, "ok");
  assert.equal(a.vinculos.get("bc")!.avisoTipo, null);
  assert.equal(a.estado.syncToken, null, "antes: se guardaba el token y el «movido» no volvía hasta la completa semanal");
  // Google ya responde; la siguiente pasada es completa y ve el evento a las 14:00.
  a.p.abrirCalendar = abrir;
  await sincronizarEntrante(a.p, "c1");
  assert.ok(a.google.llamadas.at(-1)!.timeMin, "completa");
  assert.equal(a.vinculos.get("bc")!.avisoTipo, "movido");
  assert.equal(a.vinculos.get("bc")!.avisoStartsAt?.toISOString(), h(14).toISOString());
});

test("N3-G4: tras desplegar, la firma guardada con la regla anterior ya no coincide → una completa que REASIGNA lo mal asignado por nombre", async () => {
  const a = montar();
  // Un bloqueo que la regla vieja dio al Dr. por el nombre visible de un paciente.
  a.google.poner(evento("e1", { attendees: [{ email: "recepcion@clinica.mx" }, { email: "paciente@gmail.com", displayName: "Ana López" }] }));
  await sincronizarEntrante(a.p, "c1");
  const b = [...a.bloques.values()][0];
  b.doctorId = "doc-ana"; // como lo dejó la regla vieja
  // La fila, como la dejó el código anterior: su firma (calculada con él) para este mismo equipo.
  Object.assign(a.estado, { equipoFirma: "2-f75b1e45d3a05695", lastFullSyncAt: AHORA });
  const antes = a.google.llamadas.length;
  await sincronizarEntrante(a.p, "c1");
  assert.ok(a.google.llamadas[antes].timeMin, "completa, aunque Google no cambió nada");
  assert.equal(b.doctorId, null, "toda la clínica (no_reconocido), no la agenda de la Dra.");
  assert.notEqual(a.estado.equipoFirma, "2-f75b1e45d3a05695");
});
