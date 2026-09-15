/**
 * SABINA AGENDA DE VERDAD — las tres ramas juntas, de punta a punta.
 *
 *   npm run test:sabina-actua
 *
 * ws1-t1 (confirmación), ws1-t2 (agenda) y ws1-t3 (pacientes) se construyeron a
 * la vez y cada una se probó con dobles de las otras dos. Esta prueba es la que
 * ninguna podía hacer: el camino entero con las piezas DE VERDAD de las tres.
 *
 *   «agéndame a María García…» → POST /api/sabina (motor + catálogo real)
 *      → Sabina pregunta cuál María → «la del folio P0002» → tarjeta guardada
 *      → «sí» en el chat no hace nada
 *      → POST /api/sabina/propuestas/:id/confirmar (el botón)
 *      → POST /api/appointments (el handler real) → la cita existe
 *
 * Corre de verdad: los tres route handlers de Sabina, el motor, `SABINA_TOOLS` y
 * `ACCIONES_SABINA` sin sustituir, los adaptadores (acciones-agenda.ts,
 * acciones-pacientes.ts), las herramientas y resolvedores de agenda y pacientes,
 * `guardarPropuesta`/`confirmarPropuesta`, la llave, y los handlers de
 * `POST /api/appointments`, `PATCH|DELETE /api/appointments/:id` y
 * `POST /api/patients` con sus reglas, permisos y visibilidad.
 *
 * Se sustituye: la API de Anthropic (guion), la sesión, el monedero, el freno de
 * ráfagas, el historial, la bitácora, Google y la revalidación. `@/lib/prisma` es
 * un doble: lee de la siembra de agenda (la misma de ws1-t2), guarda las
 * propuestas en un `audit_logs` de memoria y APUNTA cada escritura, que es lo
 * que se mide.
 */
import "../engine-sin-server-only"; // PRIMERO
import { before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";

import { crearBaseDePropuestas } from "../engine-propuestas-doble";
import { ENTIDAD_PROPUESTA, EVENTO, FRASE } from "../engine-propuestas-core";
import { idsQueCasan } from "../tools/__tests__/busqueda-falsa";
import {
  CL_A,
  DIA,
  DOMINGO,
  TZ_A,
  U_ADMIN,
  U_DOC1,
  U_DOC2,
  U_RECEP,
  baseAgenda,
  en,
  type BaseAgenda,
} from "../tools/__tests__/agenda-siembra";

/* ═══════════════════════════════════════════════════════════════════════
   EL MUNDO
   ═══════════════════════════════════════════════════════════════════════ */

interface Escritura {
  op: string;
  args: any;
}

const m = {
  agenda: null as unknown as BaseAgenda,
  propuestas: crearBaseDePropuestas(() => Date.now()),
  escrituras: [] as Escritura[],
  bitacora: [] as any[],
  recordatorios: [] as string[],
  visibilidad: [] as any[],
  sesion: null as any,
  guion: [] as any[],
  alModelo: [] as any[],
};

function sesionDe(userId: string, role: string, permissionsOverride: string[] = []) {
  return {
    userId,
    clinicId: CL_A,
    role,
    permissionsOverride,
    clinic: { id: CL_A, timezone: TZ_A, category: "DENTAL" },
    isSuperAdmin: role === "SUPER_ADMIN",
    isAdmin: role === "ADMIN" || role === "SUPER_ADMIN",
    isDoctor: role === "DOCTOR",
    isReceptionist: role === "RECEPTIONIST",
  };
}

beforeEach(() => {
  m.agenda = baseAgenda();
  m.propuestas = crearBaseDePropuestas(() => Date.now());
  m.escrituras = [];
  m.bitacora = [];
  m.recordatorios = [];
  m.visibilidad = [];
  m.sesion = sesionDe(U_RECEP, "RECEPTIONIST");
  m.guion = [];
  m.alModelo = [];
});

/* ── el doble de prisma ─────────────────────────────────────────────────── */

function conInclude(fila: any) {
  if (!fila) return fila;
  const p = m.agenda.filas.patients.find((x: any) => x.id === fila.patientId);
  const d = m.agenda.filas.users.find((x: any) => x.id === fila.doctorId);
  return {
    ...fila,
    patient: p && { id: p.id, firstName: p.firstName, lastName: p.lastName, status: p.status, email: p.email, visibleUserIds: p.visibleUserIds },
    doctor: d && { id: d.id, firstName: d.firstName, lastName: d.lastName, email: null },
  };
}

function escribir(modelo: string, op: string, args: any): any {
  m.escrituras.push({ op: `${modelo}.${op}`, args });
  if (modelo === "appointment" && op === "create") {
    const fila = { id: `a-nueva-${m.escrituras.length}`, googleCalendarEventId: null, cancelledAt: null, cancelReason: null, ...args.data };
    m.agenda.filas.appointments.push(fila);
    return conInclude(fila);
  }
  if (modelo === "appointment" && op === "update") {
    const fila = m.agenda.filas.appointments.find((a: any) => a.id === args.where.id);
    if (!fila) throw new Error(`update de una cita que no existe: ${args.where.id}`);
    Object.assign(fila, args.data);
    return conInclude(fila);
  }
  if (modelo === "patient" && op === "create") {
    const fila = { id: `p-nuevo-${m.escrituras.length}`, createdAt: new Date(), deletedAt: null, status: "ACTIVE", ...args.data };
    m.agenda.filas.patients.push(fila);
    return fila;
  }
  throw new Error(`escritura no prevista en el doble: ${modelo}.${op}`);
}

const LECTURAS = new Set(["findMany", "findFirst", "count", "groupBy", "aggregate"]);

function delegado(modelo: string) {
  return new Proxy(
    {},
    {
      get(_t, op: string) {
        if (op === "create" || op === "update") return async (args: any) => escribir(modelo, op, args);
        if (op === "findUnique") {
          return async (args: any) => conInclude(await m.agenda[modelo].findFirst({ where: args.where }));
        }
        if (modelo === "appointment" && op === "findFirst") {
          return async (args: any) => {
            const { include, ...resto } = args ?? {};
            const fila = await m.agenda.appointment.findFirst({ where: resto.where });
            return include ? conInclude(fila) : fila;
          };
        }
        if (LECTURAS.has(op)) return (...a: unknown[]) => m.agenda[modelo][op](...a);
        return async (args: any) => escribir(modelo, op, args);
      },
    },
  );
}

const prismaDoble: any = new Proxy(
  {},
  {
    get(_t, k: string) {
      if (k === "auditLog") return m.propuestas.db.auditLog;
      // Sin fila en sabina_user_permissions: Sabina con todo lo del usuario, lo de
      // siempre. El recorte del Super Admin se prueba en `test:sabina-permisos-equipo`.
      if (k === "sabinaUserPermission") return { findFirst: async () => null };
      if (k === "$executeRaw") return m.propuestas.db.$executeRaw;
      if (k === "$transaction") {
        return (fn: (tx: any) => Promise<unknown>) =>
          m.propuestas.db.$transaction((tx) => fn(new Proxy(tx as any, { get: (t, c: string) => (c in t ? t[c] : prismaDoble[c]) })));
      }
      if (k === "$queryRaw") {
        return async (q: any) => {
          if (q?.__busqueda) return idsQueCasan(m.agenda.filas.patients, q.__busqueda).map((id) => ({ id }));
          throw new Error("SQL no previsto en el doble");
        };
      }
      if (k === "then") return undefined;
      return delegado(k);
    },
  },
);

/* ── la sesión que ven los handlers de agenda ───────────────────────────── */

function sesionDeAgenda() {
  const s = m.sesion;
  const clinica = m.agenda.filas.clinics.find((c: any) => c.id === CL_A);
  const schedules = m.agenda.filas.clinicSchedules.map((h: any) => ({
    dayOfWeek: h.dayOfWeek, enabled: h.enabled, openTime: h.openTime, closeTime: h.closeTime,
  }));
  return {
    user: { id: s.userId, role: s.role, clinicId: CL_A, displayName: s.userId, permissionsOverride: s.permissionsOverride },
    clinic: {
      id: CL_A, name: "Clínica QA", category: "DENTAL", timezone: TZ_A,
      defaultSlotMinutes: clinica.defaultSlotMinutes, agendaDayStart: clinica.agendaDayStart, agendaDayEnd: clinica.agendaDayEnd,
      waConnected: false, trialEndsAt: null, subscriptionStatus: "active", schedules,
    },
    timeConfig: { timezone: TZ_A, slotMinutes: clinica.defaultSlotMinutes, dayStart: clinica.agendaDayStart, dayEnd: clinica.agendaDayEnd },
  };
}

/* ── rutas ──────────────────────────────────────────────────────────────── */

let preguntar: (texto: string, conversacionId?: string) => Promise<any>;
let confirmar: (id: string, cuerpo?: string) => Promise<{ status: number; json: any }>;
let catalogo: typeof import("../engine-catalog");

before(async () => {
  process.env.ANTHROPIC_API_KEY = "sk-prueba-no-es-real";
  globalThis.fetch = (async (url: unknown, init?: { body?: string }) => {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages", "nadie más que el motor usa fetch");
    m.alModelo.push(JSON.parse(String(init?.body ?? "{}")));
    const siguiente = m.guion.shift();
    assert.ok(siguiente, "el modelo se llamó más veces que el guion");
    return new Response(JSON.stringify(siguiente), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  mock.module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
  mock.module("@/lib/auth/two-factor-identity", {
    namedExports: { personaTieneDosFactores: async () => false, dosFactoresDeLaPersona: async () => false },
  });
  mock.module("@/lib/patients/patient-search", {
    namedExports: {
      buildPatientSearchSql: (args: unknown) => ({ __busqueda: args }),
      findPatientIdsBySearch: async (args: any) =>
        args.clinicIds.length === 0 || args.tokens.length === 0
          ? null
          : idsQueCasan(m.agenda.filas.patients, { ...args, limit: args.limit ?? 5000 }),
    },
  });

  const authReal = await import("@/lib/auth-context");
  mock.module("@/lib/auth-context", { namedExports: { ...authReal, getAuthContext: async () => m.sesion } });
  // El módulo real arrastra `@/lib/auth` (React `cache`, fuera de Next no existe).
  // `requireRole` es la misma regla, de tres líneas: si el rol no está, 403.
  const { NextResponse } = await import("next/server");
  mock.module("@/lib/agenda/api-helpers", {
    namedExports: {
      loadClinicSession: async () => sesionDeAgenda(),
      requireRole: (s: any, permitidos: string[]) =>
        permitidos.includes(s.user.role) ? null : NextResponse.json({ error: "forbidden" }, { status: 403 }),
    },
  });
  const visibilidadReal = await import("@/lib/patient-visibility");
  mock.module("@/lib/patient-visibility", {
    namedExports: {
      ...visibilidadReal,
      ensureUserCanSeePatient: async (_tx: unknown, patientId: string, doctorId: string) => {
        m.visibilidad.push({ patientId, doctorId });
      },
    },
  });
  const auditReal = await import("@/lib/audit");
  mock.module("@/lib/audit", {
    namedExports: {
      ...auditReal,
      logMutation: async (o: any) => {
        m.bitacora.push({ entityType: o.entityType, entityId: o.entityId, action: o.action, userId: o.userId });
      },
    },
  });

  mock.module("@/lib/failban", { namedExports: { persistentRateLimit: async () => null } });
  mock.module("@/lib/ai-billing/wallet", {
    namedExports: { canSpend: async () => true, chargeUsage: async () => ({ billedCents: 1, balanceAfterCents: 1, eventId: "ev" }) },
  });
  mock.module("@/lib/ai-assistant/conversations", { namedExports: { isAiHistoryStorageMissing: () => false } });
  mock.module("@/lib/sabina/engine-historial", {
    namedExports: {
      leerConversacionSabina: async (_s: unknown, id: string) =>
        id === "conv_1" ? { conversation: { id, title: "agenda", updatedAt: 1 }, messages: [] } : null,
      crearConversacionSabina: async () => "conv_1",
      anexarTurnosSabina: async () => true,
      listarConversacionesSabina: async () => [],
    },
  });
  mock.module("@/lib/agenda/server", {
    namedExports: {
      appointmentToDTO: (a: any) => ({ id: a.id, status: a.status, startsAt: a.startsAt }),
      fetchActiveDoctors: async () => [],
      fetchAppointmentsForDay: async () => [],
      fetchPendingValidation: async () => [],
      fetchResources: async () => [],
      fetchWaitlistCount: async () => 0,
    },
  });
  mock.module("@/lib/agenda/resource-schedule.server", { namedExports: { loadResourceSchedule: async () => [] } });
  mock.module("@/lib/cache/revalidate", {
    namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
  });
  mock.module("@/lib/agenda/google-sync", {
    namedExports: {
      syncCreateToGoogleCalendar: async () => undefined,
      syncUpdateToGoogleCalendar: async () => undefined,
      syncDeleteFromGoogleCalendar: async () => undefined,
    },
  });
  mock.module("@/lib/reminders/reschedule.server", {
    namedExports: {
      applyReminderReschedule: async (_tx: unknown, a: any) => {
        m.recordatorios.push(`reprogramar ${a?.appointmentId ?? ""}`);
      },
      cancelPendingRemindersForAppointment: async (_tx: unknown, a: any) => {
        m.recordatorios.push(`cancelar ${a?.appointmentId ?? ""}`);
      },
    },
  });
  mock.module("@/lib/patient-quota", { namedExports: { getPatientQuota: async () => ({ canCreate: true, max: 500, used: 10 }) } });
  mock.module("@/lib/branches", { namedExports: { getPatientVisibility: async () => ({ clinicIds: [CL_A] }) } });
  mock.module("@/lib/whatsapp/inbox-log", { namedExports: { linkOrphanThreadsToPatient: async () => undefined } });
  mock.module("@/lib/patients/next-patient-number", {
    namedExports: {
      nextPatientNumber: async () => `P0${900 + m.escrituras.length}`,
      withPatientNumberRetry: async (fn: () => Promise<unknown>) => fn(),
      PatientNumberExhaustedError: class extends Error {},
      isPatientNumberConflict: () => false,
    },
  });

  const { NextRequest } = await import("next/server");
  const sabina = await import("@/app/api/sabina/route");
  const confirmarRuta = await import("@/app/api/sabina/propuestas/[id]/confirmar/route");
  catalogo = await import("../engine-catalog");

  preguntar = async (texto, conversacionId) => {
    const res = await sabina.POST(
      new NextRequest("http://app.test/api/sabina", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pregunta: texto, ...(conversacionId ? { conversacionId } : {}) }),
      }),
    );
    assert.equal(res.status, 200, `POST /api/sabina respondió ${res.status}`);
    return res.json();
  };
  confirmar = async (id, cuerpo = "{}") => {
    const res = await confirmarRuta.POST(
      new NextRequest(`http://app.test/api/sabina/propuestas/${id}/confirmar`, {
        method: "POST",
        headers: { host: "app.test", origin: "http://app.test", "content-type": "application/json", "user-agent": "prueba" },
        body: cuerpo,
      }),
      { params: { id } },
    );
    return { status: res.status, json: await res.json() };
  };
});

/* ── guion del modelo ───────────────────────────────────────────────────── */

const uso = { input_tokens: 10, output_tokens: 5 };
const pide = (name: string, input: unknown) => ({ content: [{ type: "tool_use", id: `tu_${name}_${Math.random()}`, name, input }], stop_reason: "tool_use", usage: uso });
const dice = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: uso });

/** Lo que el motor le devolvió al modelo en la última ronda (el tool_result ya parseado). */
function ultimoToolResult(): any {
  for (let i = m.alModelo.length - 1; i >= 0; i--) {
    const ultimo = m.alModelo[i].messages[m.alModelo[i].messages.length - 1];
    if (Array.isArray(ultimo?.content)) {
      const r = ultimo.content.find((b: any) => b.type === "tool_result");
      if (r) return JSON.parse(r.content);
    }
  }
  return null;
}

function eventosDe(id: string): string[] {
  return m.propuestas.filas.filter((f) => f.entityType === ENTIDAD_PROPUESTA && f.entityId === id).map((f) => f.action);
}

const citasDelDia = () => m.agenda.filas.appointments.filter((a: any) => a.clinicId === CL_A);

/* ═══════════════════════════════════════════════════════════════════════
   1. EL CATÁLOGO: LO QUE ENTRÓ DE VERDAD
   ═══════════════════════════════════════════════════════════════════════ */

test("el motor ve las cinco nuevas y la confirmación ejecuta las cuatro que escriben, con la key del endpoint", async () => {
  const { accionDeHerramienta } = await import("../engine-acciones");
  const nombres = catalogo.SABINA_TOOLS.map((t) => t.nombre);
  for (const n of ["proponer_horarios", "agendar_cita", "reagendar_cita", "cancelar_cita", "registrar_paciente"]) {
    assert.ok(nombres.includes(n), `el motor no ve ${n}`);
  }
  assert.equal(new Set(nombres).size, nombres.length, "hay nombres repetidos en el catálogo del motor");
  assert.equal(nombres.length, 15, "diez de consulta + proponer_horarios + cuatro acciones");

  const keys = Object.fromEntries(catalogo.ACCIONES_SABINA.map((a) => [a.nombre, a.permiso]));
  // La key de cada acción es la que exige su handler (`denyIfMissingPermission`).
  assert.deepEqual(keys, {
    agendar_cita: "agenda.create",
    reagendar_cita: "agenda.edit",
    cancelar_cita: "agenda.delete",
    registrar_paciente: "patients.create",
  });

  // proponer_horarios es consulta: no produce tarjeta. Las otras cuatro, sí.
  const proponer = catalogo.SABINA_TOOLS.find((t) => t.nombre === "proponer_horarios")!;
  assert.equal(accionDeHerramienta(proponer), null);
  for (const a of catalogo.ACCIONES_SABINA) {
    const t = catalogo.SABINA_TOOLS.find((x) => x.nombre === a.nombre)!;
    assert.equal(accionDeHerramienta(t), a, `${a.nombre} entra al motor como herramienta de acción`);
    assert.notEqual(t.ejecutar, a.ejecutar, `${a.nombre}: el motor no recibe la mitad que escribe`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   2. «AGÉNDAME A MARÍA» — EL CAMINO ENTERO
   ═══════════════════════════════════════════════════════════════════════ */

test("«agéndame a María García» → pregunta cuál → «la del folio P0002» → tarjeta → «sí» no hace nada → botón → la cita existe", async () => {
  const antes = citasDelDia().length;

  /* 1. Dos María García: Sabina PREGUNTA, no elige, y no queda tarjeta. */
  m.guion = [
    pide("agendar_cita", { paciente: "María García", doctor: "Rojas", fecha: DIA, hora: "10:00", motivo: "Limpieza" }),
    dice("Tengo dos pacientes llamadas María García: P0001 y P0002. ¿Cuál es?"),
  ];
  const r1 = await preguntar(`agéndame a María García el ${DIA} a las 10 con la Dra. Rojas, limpieza`);
  assert.equal(r1.propuestas, undefined, "con dos candidatas no hay tarjeta");
  const aclarar = ultimoToolResult();
  assert.equal(aclarar.datos.estado, "falta_aclarar");
  assert.match(aclarar.datos.pregunta, /María García/);
  assert.ok(aclarar.datos.opciones.some((o: string) => /P0001/.test(o) && /pacienteId: p-mg1/.test(o)), JSON.stringify(aclarar.datos.opciones));
  assert.ok(aclarar.datos.opciones.some((o: string) => /P0002/.test(o) && /pacienteId: p-mg2/.test(o)));
  assert.match(m.alModelo[0].system, /LO QUE PUEDES PREPARAR/, "el prompt ya no dice «solo lees»");
  assert.match(m.alModelo[0].system, /agendar citas; mover citas; cancelar citas; dar de alta pacientes/);

  /* 2. El turno siguiente NO trae los ids (el historial es texto): va por folio. */
  m.guion = [
    pide("agendar_cita", { paciente: "P0002", doctor: "Rojas", fecha: DIA, hora: "10:00", motivo: "Limpieza" }),
    dice("Te propongo agendar a María García (P0002) a las 10:00 con Nadia Rojas. Confírmalo en la tarjeta."),
  ];
  const r2 = await preguntar("la del folio P0002", "conv_1");
  assert.equal(r2.propuestas.length, 1);
  const tarjeta = r2.propuestas[0];
  assert.equal(tarjeta.estado, "pendiente");
  assert.equal(tarjeta.accion, "agendar_cita");
  assert.equal(tarjeta.boton, "Sí, agendar");
  assert.match(tarjeta.tarjeta.frase, /María García.*10:00.*Nadia Rojas.*Limpieza/);
  assert.ok(tarjeta.tarjeta.detalles.some((d: any) => d.etiqueta === "Paciente" && /P0002/.test(d.valor)));
  assert.ok(tarjeta.tarjeta.avisos.some((a: string) => /no le manda ningún mensaje/.test(a)), "dice que el paciente no recibe aviso");
  assert.equal(tarjeta.deshacer.reversible, true);
  assert.ok(!("datos" in tarjeta), "los ids no viajan a la pantalla");

  // Lo guardado es la petición exacta al endpoint real, con los ids resueltos.
  const guardada = m.propuestas.filas.find((f) => f.entityId === tarjeta.id && f.action === EVENTO.proponer)!;
  assert.deepEqual(guardada.changes.datos.peticion, {
    metodo: "POST",
    ruta: "/api/appointments",
    cuerpo: {
      patientId: "p-mg2",
      doctorId: U_DOC2,
      resourceId: null,
      startsAt: en(DIA, "10:00").toISOString(),
      endsAt: en(DIA, "10:30").toISOString(),
      reason: "Limpieza",
    },
  });
  assert.match(guardada.changes.huella, /^vigente:/);
  assert.deepEqual(m.escrituras, [], "proponer no escribió nada");
  assert.equal(citasDelDia().length, antes);

  /* 3. Un «sí» escrito no ejecuta nada. Aquí la tarjeta SÍ está en pantalla
        (la del paso 2), así que mandar al botón es verdad y el motor lo deja pasar. */
  m.guion = [dice("Para agendarla toca el botón «Sí, agendar» de la tarjeta.")];
  const r3 = await preguntar("sí, confírmalo", "conv_1");
  assert.equal(r3.propuestas, undefined);
  assert.equal(r3.respuesta, "Para agendarla toca el botón «Sí, agendar» de la tarjeta.");
  assert.match(m.alModelo[m.alModelo.length - 1].system, /propuesta sin confirmar: «Agendar a María García/);
  assert.deepEqual(m.escrituras, []);
  assert.deepEqual(eventosDe(tarjeta.id), [EVENTO.proponer]);

  /* 4. El botón. Aunque el navegador mande otro paciente en el cuerpo, se ejecuta lo guardado. */
  const c = await confirmar(tarjeta.id, JSON.stringify({ datos: { peticion: { cuerpo: { patientId: "p-juan" } } } }));
  assert.equal(c.status, 200);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  assert.match(c.json.propuesta.resultado.frase, /^Listo, quedó agendada\./);

  assert.equal(m.escrituras.length, 1, JSON.stringify(m.escrituras.map((e) => e.op)));
  assert.equal(m.escrituras[0].op, "appointment.create");
  const data = m.escrituras[0].args.data;
  assert.equal(data.clinicId, CL_A);
  assert.equal(data.patientId, "p-mg2");
  assert.equal(data.doctorId, U_DOC2);
  assert.equal(new Date(data.startsAt).toISOString(), en(DIA, "10:00").toISOString());
  assert.equal(data.type, "Limpieza");
  assert.equal(data.status, "SCHEDULED");
  assert.equal(data.overrideReason, null, "Sabina nunca salta el solape");
  assert.equal(citasDelDia().length, antes + 1, "la cita existe");

  // El rastro: la bitácora del endpoint a nombre de quien confirmó, y los eventos de la propuesta.
  assert.deepEqual(m.bitacora, [{ entityType: "appointment", entityId: m.escrituras.length ? "a-nueva-1" : "", action: "create", userId: U_RECEP }]);
  assert.deepEqual(eventosDe(tarjeta.id), [EVENTO.proponer, EVENTO.confirmar, EVENTO.resultado]);
  const resultado = m.propuestas.filas.find((f) => f.entityId === tarjeta.id && f.action === EVENTO.resultado)!;
  assert.deepEqual(resultado.changes.entidad, { tipo: "appointment", id: "a-nueva-1" });
  assert.deepEqual(resultado.changes.llamadas.map((l: any) => `${l.metodo} ${l.ruta} ${l.status}`), ["POST /api/appointments 201"]);

  /* 5. Otro toque no repite. */
  const otra = await confirmar(tarjeta.id);
  assert.equal(otra.status, 409);
  assert.equal(m.escrituras.length, 1);

  /* 6. Y la cita nueva ocupa de verdad: la misma hora ya no se ofrece. */
  m.guion = [
    pide("agendar_cita", { paciente: "Juan Pérez", doctor: "Rojas", fecha: DIA, hora: "10:00", motivo: "Revisión" }),
    dice("A esa hora la Dra. Rojas ya está ocupada."),
  ];
  const r6 = await preguntar("agenda a Juan Pérez a las 10 con la Dra. Rojas");
  assert.equal(r6.propuestas, undefined);
  assert.equal(ultimoToolResult().datos.estado, "no_se_puede");
});

test("si la hora se ocupa entre la tarjeta y el botón, no se escribe y se dice", async () => {
  m.guion = [
    pide("agendar_cita", { paciente: "Juan Pérez", doctor: "Rojas", fecha: DIA, hora: "09:00", motivo: "Revisión" }),
    dice("Te propongo a Juan Pérez a las 9:00."),
  ];
  const { propuestas } = await preguntar("agenda a Juan a las 9 con la Dra. Rojas");
  assert.equal(propuestas.length, 1);

  // Otra recepcionista, por la pantalla, ocupa esa hora mientras tanto.
  m.agenda.filas.appointments.push({
    id: "a-colada", clinicId: CL_A, patientId: "p-mg1", doctorId: U_DOC2, resourceId: null, status: "SCHEDULED",
    type: "Consulta", overrideReason: null, googleCalendarEventId: null, startsAt: en(DIA, "09:00"), endsAt: en(DIA, "09:30"),
  });

  const c = await confirmar(propuestas[0].id);
  assert.equal(c.status, 200);
  assert.equal(c.json.propuesta.estado, "fallida");
  assert.equal(c.json.propuesta.resultado.tipo, "cambio");
  assert.equal(c.json.propuesta.resultado.frase, FRASE.cambio);
  assert.deepEqual(m.escrituras, []);
});

test("si la base falla al volver a comprobar, se dice «no pude comprobar», no «algo cambió»", async () => {
  m.guion = [
    pide("agendar_cita", { paciente: "Juan Pérez", doctor: "Rojas", fecha: DIA, hora: "09:00", motivo: "Revisión" }),
    dice("Te propongo a Juan Pérez a las 9:00."),
  ];
  const { propuestas } = await preguntar("agenda a Juan a las 9 con la Dra. Rojas");
  assert.equal(propuestas.length, 1);
  const clinica = m.agenda.clinic;
  m.agenda.clinic = { findFirst: async () => { throw new Error("timeout del pooler"); } };
  try {
    const c = await confirmar(propuestas[0].id);
    assert.equal(c.json.propuesta.estado, "fallida");
    assert.equal(c.json.propuesta.resultado.frase, FRASE.noComprobable);
  } finally {
    m.agenda.clinic = clinica;
  }
  assert.deepEqual(m.escrituras, []);
});

test("sin el permiso agenda.create al confirmar (se lo quitaron tras la tarjeta), no se escribe", async () => {
  m.guion = [
    pide("agendar_cita", { paciente: "Juan Pérez", doctor: "Rojas", fecha: DIA, hora: "09:00", motivo: "Revisión" }),
    dice("Te propongo a Juan Pérez a las 9:00."),
  ];
  const { propuestas } = await preguntar("agenda a Juan a las 9 con la Dra. Rojas");
  m.sesion = sesionDe(U_RECEP, "RECEPTIONIST", ["agenda.view"]);
  const c = await confirmar(propuestas[0].id);
  assert.equal(c.json.propuesta.estado, "fallida");
  assert.equal(c.json.propuesta.resultado.tipo, "sin_permiso");
  assert.match(c.json.propuesta.resultado.frase, /No tienes permiso para agendar citas/);
  assert.deepEqual(m.escrituras, []);
});

/* ═══════════════════════════════════════════════════════════════════════
   3. MOVER Y CANCELAR, POR SUS HANDLERS
   ═══════════════════════════════════════════════════════════════════════ */

test("mover la cita de Juan: la tarjeta dice antes → después y el botón llama al PATCH real", async () => {
  m.guion = [
    pide("reagendar_cita", { paciente: "Juan Pérez", fechaActual: DIA, nuevaFecha: DIA, nuevaHora: "16:30" }),
    dice("Te propongo mover la cita de Juan a las 16:30."),
  ];
  const { propuestas } = await preguntar("pasa la cita de Juan a las 4 y media");
  assert.equal(propuestas?.length, 1, JSON.stringify(ultimoToolResult()));
  const t = propuestas[0];
  assert.equal(t.accion, "reagendar_cita");
  assert.equal(t.boton, "Sí, mover la cita");
  assert.ok(t.tarjeta.detalles.some((d: any) => d.etiqueta === "Antes" && /10:00/.test(d.valor)));
  assert.ok(t.tarjeta.detalles.some((d: any) => d.etiqueta === "Después" && /16:30/.test(d.valor)));
  assert.ok(t.tarjeta.avisos.some((a: string) => /recordatorio con la hora anterior/.test(a)), "a Juan ya le salió el recordatorio: se avisa");
  assert.deepEqual(m.escrituras, []);

  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  assert.match(c.json.propuesta.resultado.frase, /la cita quedó movida/);
  assert.deepEqual(m.escrituras.map((e) => e.op), ["appointment.update"]);
  const cita = m.agenda.filas.appointments.find((a: any) => a.id === "a-juan-10");
  assert.equal(new Date(cita.startsAt).toISOString(), en(DIA, "16:30").toISOString());
  assert.equal(new Date(cita.endsAt).toISOString(), en(DIA, "17:00").toISOString());
  assert.equal(cita.doctorId, U_DOC1, "mantiene doctor");
  assert.deepEqual(m.recordatorios, ["reprogramar a-juan-10"]);
  assert.deepEqual(m.bitacora.map((b) => `${b.action} ${b.entityId} ${b.userId}`), [`update a-juan-10 ${U_RECEP}`]);
});

test("cancelar: recepción lo hace por el DELETE real; un doctor ni siquiera recibe tarjeta", async () => {
  m.sesion = sesionDe(U_DOC1, "DOCTOR");
  m.guion = [pide("cancelar_cita", { paciente: "Juan Pérez", fecha: DIA }), dice("No puedo cancelarla.")];
  const doc = await preguntar("cancela la cita de Juan");
  assert.equal(doc.propuestas, undefined);
  assert.match(doc.respuesta, /Tu rol no permite cancelar citas/);
  assert.deepEqual(m.escrituras, []);

  m.sesion = sesionDe(U_RECEP, "RECEPTIONIST");
  // Juan tiene dos citas ese día: se pregunta cuál, con el id en cada opción.
  m.guion = [pide("cancelar_cita", { paciente: "Juan Pérez", fecha: DIA, motivo: "El paciente avisó" }), dice("Juan tiene dos citas ese día (a-juan-10 a las 10:00 y a-juan-curso a las 15:00). ¿Cuál?")];
  const pregunta = await preguntar("cancela la cita de Juan, avisó que no viene");
  assert.equal(pregunta.propuestas, undefined);
  const cual = ultimoToolResult().datos;
  assert.equal(cual.estado, "falta_aclarar");
  assert.ok(cual.opciones.some((o: string) => /10:00/.test(o) && /citaId: a-juan-10/.test(o)), JSON.stringify(cual.opciones));

  m.guion = [pide("cancelar_cita", { citaId: "a-juan-10", motivo: "El paciente avisó" }), dice("Te propongo cancelarla.")];
  const { propuestas } = await preguntar("la de las 10", "conv_1");
  assert.equal(propuestas?.length, 1, JSON.stringify(ultimoToolResult()));
  const t = propuestas[0];
  assert.equal(t.deshacer.reversible, false, "la tarjeta dice ANTES que no se deshace");
  assert.deepEqual(m.escrituras, []);

  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  assert.match(c.json.propuesta.resultado.frase, /la cita quedó cancelada/);
  // La cancelación, y el handler limpiando el id del evento de Google que borró.
  assert.deepEqual(m.escrituras.map((e) => e.op), ["appointment.update", "appointment.update"]);
  assert.deepEqual(m.escrituras[1].args.data, { googleCalendarEventId: null });
  const cita = m.agenda.filas.appointments.find((a: any) => a.id === "a-juan-10");
  assert.equal(cita.status, "CANCELLED");
  assert.equal(cita.cancelReason, "El paciente avisó");
  assert.deepEqual(m.recordatorios, ["cancelar a-juan-10"]);
});

/* ═══════════════════════════════════════════════════════════════════════
   4. DAR DE ALTA, POR POST /api/patients
   ═══════════════════════════════════════════════════════════════════════ */

test("alta sin duplicado: tarjeta irreversible y el botón llama al POST /api/patients real", async () => {
  m.sesion = sesionDe(U_ADMIN, "ADMIN");
  m.guion = [
    pide("registrar_paciente", { nombre: "Lucía", apellidos: "Méndez Soto", telefono: "55 1234 0000", alergias: ["ninguna"] }),
    dice("Te propongo dar de alta a Lucía Méndez Soto. Confírmalo en la tarjeta."),
  ];
  const { propuestas } = await preguntar("da de alta a Lucía Méndez Soto, 55 1234 0000, sin alergias");
  assert.equal(propuestas?.length, 1, JSON.stringify(ultimoToolResult()));
  const t = propuestas[0];
  assert.equal(t.accion, "registrar_paciente");
  assert.equal(t.deshacer.reversible, false);
  assert.ok(t.tarjeta.detalles.some((d: any) => d.etiqueta === "Alergias" && d.valor === "Ninguna"));
  // Nombre y apellidos por separado: «María José | Pérez» no es «María | José Pérez».
  assert.ok(t.tarjeta.detalles.some((d: any) => d.etiqueta === "Nombre" && d.valor === "Lucía"));
  assert.ok(t.tarjeta.detalles.some((d: any) => d.etiqueta === "Apellidos" && d.valor === "Méndez Soto"));
  assert.ok(t.tarjeta.avisos.some((a: string) => /No se le manda nada al paciente/.test(a)));
  assert.deepEqual(m.escrituras, []);

  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  assert.match(c.json.propuesta.resultado.frase, /Di de alta a Lucía Méndez Soto/);
  assert.deepEqual(m.escrituras.map((e) => e.op), ["patient.create"]);
  const data = m.escrituras[0].args.data;
  assert.equal(data.clinicId, CL_A);
  assert.deepEqual(data.allergies, ["N/A"]);
  assert.equal(data.phone, "55 1234 0000");
});

test("alta con duplicado: sin tarjeta se pregunta; «es otra persona» da la tarjeta que lo dice y solo el botón crea", async () => {
  m.sesion = sesionDe(U_ADMIN, "ADMIN");
  const alta = { nombre: "María", apellidos: "García", telefono: "5533334444", alergias: ["penicilina"] };

  m.guion = [pide("registrar_paciente", alta), dice("Ya existe una María García con ese teléfono. ¿Es la misma persona?")];
  const r1 = await preguntar("da de alta a María García, 5533334444, alérgica a penicilina");
  assert.equal(r1.propuestas, undefined, "con duplicado no hay tarjeta que confirmar");
  const aclarar = ultimoToolResult();
  assert.equal(aclarar.datos.estado, "falta_aclarar");
  assert.match(aclarar.datos.pregunta, /P0002/);
  assert.deepEqual(m.escrituras, []);

  m.guion = [pide("registrar_paciente", { ...alta, esOtraPersona: true }), dice("Te preparo el alta como paciente nuevo.")];
  const r2 = await preguntar("no, es otra persona", "conv_1");
  assert.equal(r2.propuestas?.length, 1, JSON.stringify(ultimoToolResult()));
  const t = r2.propuestas[0];
  assert.match(t.tarjeta.frase, /como paciente NUEVO, aunque ya existe alguien/);
  assert.ok(t.tarjeta.avisos.some((a: string) => /Ya existe/.test(a) && /P0002/.test(a)));
  assert.deepEqual(m.escrituras, []);

  const c = await confirmar(t.id);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  assert.deepEqual(m.escrituras.map((e) => e.op), ["patient.create"]);
});

test("alta: si aparece un gemelo entre la tarjeta y el botón, no se crea", async () => {
  m.sesion = sesionDe(U_ADMIN, "ADMIN");
  m.guion = [
    pide("registrar_paciente", { nombre: "Lucía", apellidos: "Méndez Soto", telefono: "5512340000", alergias: ["ninguna"] }),
    dice("Te propongo el alta."),
  ];
  const { propuestas } = await preguntar("da de alta a Lucía Méndez Soto");
  m.agenda.filas.patients.push({
    id: "p-gemela", clinicId: CL_A, firstName: "Lucía", lastName: "Méndez Soto", patientNumber: "P0777",
    phone: "5512340000", email: null, status: "ACTIVE", visibleUserIds: [], deletedAt: null,
  });
  const c = await confirmar(propuestas[0].id);
  assert.equal(c.json.propuesta.estado, "fallida");
  assert.equal(c.json.propuesta.resultado.tipo, "cambio");
  assert.deepEqual(m.escrituras, []);
});

/* ═══════════════════════════════════════════════════════════════════════
   5. LA TARJETA QUE NO EXISTE — el fallo que vivió Rafael (14-sep-2026)

   «Ya me creó el paciente, pero para agendar me pide confirmar en la tarjeta
   y no hay ninguna tarjeta ni ningún botón.»

   Todo lo de arriba pasa: cuando `agendar_cita` corre, la tarjeta sale. Lo que
   se rompía es el turno en el que NO corre. Agendar casi nunca cabe en un
   mensaje (el motivo es obligatorio, y luego doctor, sillón u hora), así que
   Sabina termina un turno preguntando «¿te la agendo?». El «sí» que llega
   después caía en la regla del prompt «si te escriben "sí", diles que usen el
   botón de la tarjeta» —sin mirar si había tarjeta—, y el motor dejaba salir
   esa frase aunque en el turno no hubiera ninguna propuesta. Registrar un
   paciente se libraba porque su tarjeta sale en el mismo mensaje del pedido.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * La respuesta ORDENA confirmar en una tarjeta o botón («confírmala en la
 * tarjeta», «toca el botón»). «No hay ninguna tarjeta que confirmar» no ordena nada.
 */
const MANDA_A_LA_TARJETA = /conf[ií]rm(a|al[ao]|e)\b.*(tarjeta|bot[oó]n)|(tarjeta|bot[oó]n).*conf[ií]rm(a|al[ao]|e)\b|toca el bot[oó]n/i;

test("«¿te la agendo?» → «sí» sin tarjeta en pantalla: Sabina prepara la cita de verdad y la tarjeta sale", async () => {
  m.sesion = sesionDe(U_ADMIN, "ADMIN");

  /* Turno 1: consulta horas y PREGUNTA. No prepara nada: no hay tarjeta. */
  m.guion = [
    pide("proponer_horarios", { doctor: "Rojas", fecha: DIA, horaPreferida: "09:00" }),
    dice(`La Dra. Nadia Rojas tiene libre a las 09:00 el ${DIA}. ¿Te agendo a Juan Pérez a esa hora para su limpieza?`),
  ];
  const r1 = await preguntar(`¿la Dra. Rojas puede el ${DIA} a las 9? es para la limpieza de Juan Pérez`);
  assert.equal(r1.propuestas, undefined, "consultar horas no deja tarjeta");

  /* Turno 2: «sí». El modelo hace lo que le mandaba el prompt con un «sí»:
     mandarlo a la tarjeta. Si el motor le dice la verdad, prepara la cita. */
  const desde = m.alModelo.length;
  m.guion = [
    dice("Para agendarla, confírmala con el botón «Sí, agendar» de la tarjeta."),
    pide("agendar_cita", { paciente: "Juan Pérez", doctor: "Rojas", fecha: DIA, hora: "09:00", motivo: "Limpieza" }),
    dice("Te propongo agendar a Juan Pérez a las 09:00 con la Dra. Rojas. Confírmalo en la tarjeta."),
  ];
  const r2 = await preguntar("sí", "conv_1");
  const alModelo = m.alModelo.slice(desde);

  assert.equal(r2.propuestas?.length, 1, `no salió ninguna tarjeta y Sabina dijo: «${r2.respuesta}»`);
  assert.equal(r2.propuestas[0].accion, "agendar_cita");
  assert.equal(r2.propuestas[0].estado, "pendiente");
  assert.match(r2.propuestas[0].tarjeta.frase, /Juan Pérez.*09:00.*Nadia Rojas.*Limpieza/);
  assert.match(r2.respuesta, MANDA_A_LA_TARJETA, "ahora la tarjeta existe: mandar a ella es verdad");

  // La tarjeta sale porque el motor le dijo al modelo que NO había ninguna.
  const correccion = alModelo[1]?.messages?.[alModelo[1].messages.length - 1];
  assert.equal(correccion?.role, "user");
  assert.match(String(correccion?.content), /no preparaste ninguna propuesta/i);

  // Y el prompt ya no manda un «sí» a una tarjeta sin saber si la hay.
  assert.doesNotMatch(alModelo[0].system, /Si te escriben "sí" o "confírmalo", diles que usen el botón de la tarjeta\./);
  assert.match(alModelo[0].system, /NO hay ninguna tarjeta/);

  // Proponer no escribió nada; el botón sí.
  assert.deepEqual(m.escrituras, []);
  const c = await confirmar(r2.propuestas[0].id);
  assert.equal(c.json.propuesta.estado, "hecha", JSON.stringify(c.json.propuesta.resultado));
  assert.deepEqual(m.escrituras.map((e) => e.op), ["appointment.create"]);
});

test("si el modelo insiste en una tarjeta que no preparó, la respuesta NO manda a confirmar nada", async () => {
  m.guion = [
    dice("Listo, te la dejé en la tarjeta: confírmala con el botón «Sí, agendar»."),
    dice("Confírmala en la tarjeta, por favor."),
  ];
  const r = await preguntar("sí, agéndala");
  assert.equal(r.propuestas, undefined);
  assert.doesNotMatch(r.respuesta, MANDA_A_LA_TARJETA, `Sabina sigue mandando a una tarjeta que no existe: «${r.respuesta}»`);
  assert.match(r.respuesta, /no hay ninguna tarjeta/i, r.respuesta);
  assert.deepEqual(m.escrituras, []);
});

test("si agendar NO se puede (la clínica cierra ese día), Sabina lo explica en vez de pedir una confirmación imposible", async () => {
  m.guion = [
    pide("agendar_cita", { paciente: "Juan Pérez", doctor: "Rojas", fecha: DOMINGO, hora: "10:00", motivo: "Limpieza" }),
    dice("Te dejé la cita del domingo lista: confírmala en la tarjeta."),
    dice("Ya está, confírmala en la tarjeta."),
  ];
  const r = await preguntar(`agenda a Juan Pérez el ${DOMINGO} a las 10 con la Dra. Rojas, limpieza`);
  assert.equal(r.propuestas, undefined);
  const resultado = ultimoToolResult();
  assert.equal(resultado?.datos?.estado, "no_se_puede", JSON.stringify(resultado));
  assert.doesNotMatch(r.respuesta, MANDA_A_LA_TARJETA, `pide confirmar lo imposible: «${r.respuesta}»`);
  // El porqué es el de la herramienta, no una frase genérica.
  assert.ok(r.respuesta.includes(resultado.datos.frase), `no explica por qué: «${r.respuesta}»`);
  assert.deepEqual(m.escrituras, []);
});
