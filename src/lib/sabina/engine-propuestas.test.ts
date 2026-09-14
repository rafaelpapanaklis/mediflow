/**
 * La fase 2: una propuesta se ejecuta UNA vez, a tiempo, por quien la pidió, y
 * solo si lo que prometía sigue siendo verdad.
 *
 *   npm run test:sabina-propuestas
 *
 * `confirmarPropuesta` corre de verdad contra un doble de base que EVALÚA los
 * `where` de `audit_logs` y emula el candado `pg_advisory_xact_lock` (dos
 * transacciones con la misma clave se esperan). Lo que se prueba es la lógica de
 * reclamar-bajo-candado; que Postgres serialice el candado es cosa de Postgres.
 *
 * La acción es de prueba y su `ejecutar` llama a un handler falso por la llave:
 * así se ve qué llegó al «endpoint» y qué quedó en el rastro.
 */
import "./engine-sin-server-only"; // PRIMERO: engine-propuestas.ts arrastra "server-only"
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

import { definirAccion, type LlaveEscritura, type PropuestaPreparada } from "./engine-acciones";
import {
  confirmarPropuesta,
  consultarPropuesta,
  descartarPropuesta,
  guardarPropuesta,
  propuestasDeConversacion,
} from "./engine-propuestas";
import { crearBaseDePropuestas as crearBase } from "./engine-propuestas-doble";
import { EVENTO, SABINA_PROPUESTA_TTL_MS, origenValido } from "./engine-propuestas-core";
import { soloLectura } from "./engine-solo-lectura";
import type { SabinaCtx } from "./tipos";

/* ── La acción de prueba ────────────────────────────────────────────── */

const mundo = {
  horaLibre: true,
  ejecuciones: 0,
  llegoAlEndpoint: [] as Array<{ metodo: string; ruta: string; cuerpo: unknown; cookie: string | null }>,
  statusEndpoint: 201,
  llaveGuardada: null as LlaveEscritura | null,
  escribirEnHuella: false,
};

const clienteReal = new PrismaClient({ datasourceUrl: "postgresql://nadie:nada@127.0.0.1:1/ninguna" });

async function handlerFalso(req: any) {
  mundo.llegoAlEndpoint.push({
    metodo: req.method,
    ruta: new URL(req.url).pathname,
    cuerpo: await req.json().catch(() => null),
    cookie: req.headers.get("cookie"),
  });
  await new Promise((r) => setTimeout(r, 5)); // que la carrera tenga dónde colarse
  return new Response(JSON.stringify(mundo.statusEndpoint === 201 ? { appointment: { id: "ap_1" } } : { error: "appointment_overlap" }), {
    status: mundo.statusEndpoint,
    headers: { "content-type": "application/json" },
  });
}

const agendar = definirAccion({
  nombre: "agendar_cita",
  descripcion: "Prepara una cita.",
  titulo: "Agendar cita",
  boton: "Sí, agendar",
  queHace: "agendar citas",
  permiso: "agenda.create",
  deshacer: { reversible: true, como: "Cancelando la cita desde la Agenda." },
  parametros: z.object({}),
  datos: z.object({ patientId: z.string(), doctorId: z.string(), date: z.string(), startTime: z.string() }),
  preparar: async () => {
    throw new Error("no se usa aquí");
  },
  huella: async () => {
    if (mundo.escribirEnHuella) await clienteReal.appointment.create({ data: {} as any });
    return mundo.horaLibre ? "18-10:00 libre" : "18-10:00 ocupada";
  },
  ejecutar: async (llave, _ctx, datos) => {
    mundo.ejecuciones += 1;
    mundo.llaveGuardada = llave;
    const r = await llave.llamar(handlerFalso, { metodo: "POST", ruta: "/api/appointments", cuerpo: datos });
    if (r.status === 201) return { ok: true, frase: "Agendé a María López el jueves 18 a las 10:00 con el Dr. Ruiz.", entidad: { tipo: "appointment", id: "ap_1" } };
    return { ok: false, tipo: "conflicto", frase: "A esa hora el Dr. Ruiz ya tiene otra cita. No agendé nada." };
  },
});

const propuesta: PropuestaPreparada = {
  accion: "agendar_cita",
  titulo: "Agendar cita",
  boton: "Sí, agendar",
  queHace: "agendar citas",
  deshacer: { reversible: true, como: "Cancelando la cita desde la Agenda." },
  tarjeta: { frase: "Agendar a María López el jueves 18 a las 10:00 con el Dr. Ruiz", detalles: [{ etiqueta: "Paciente", valor: "María López (P0142)" }], avisos: ["El paciente no recibirá aviso."] },
  datos: { patientId: "pa_maria", doctorId: "us_ruiz", date: "2026-09-18", startTime: "10:00" },
  huella: "18-10:00 libre",
};

function ctx(over: Partial<SabinaCtx> = {}): SabinaCtx {
  return { clinicId: "cl_mia", userId: "us_recepcion", role: "RECEPTIONIST", permissionsOverride: [], timezone: "America/Mexico_City", ...over };
}

function peticion() {
  return new Request("https://app.dalecontrol.mx/api/sabina/propuestas/x/confirmar", {
    method: "POST",
    headers: { cookie: "sb-sesion=abc", "user-agent": "prueba", "x-forwarded-for": "10.0.0.7", host: "app.dalecontrol.mx", origin: "https://app.dalecontrol.mx" },
  });
}

let reloj = 1_757_800_000_000;
const ahora = () => reloj;
let base: ReturnType<typeof crearBase>;

beforeEach(() => {
  reloj = 1_757_800_000_000;
  base = crearBase(ahora);
  Object.assign(mundo, { horaLibre: true, ejecuciones: 0, llegoAlEndpoint: [], statusEndpoint: 201, llaveGuardada: null, escribirEnHuella: false });
});

async function proponer(c = ctx(), conversacionId: string | null = "conv_1") {
  return guardarPropuesta({ ctx: c, propuesta, pedido: "agenda a María el jueves a las 10", conversacionId, modelo: "claude-haiku-4-5", db: base.db, ahora, req: peticion() as any });
}

function confirmar(id: string, c = ctx()) {
  return confirmarPropuesta({ ctx: c, id, req: peticion() as any, acciones: [agendar], db: base.db, ahora });
}

const acciones = (id: string) => base.filas.filter((f) => f.entityId === id).map((f) => f.action);

/* ═══════════════════════════════════════════════════════════════════════ */

test("confirmar ejecuta UNA vez por el endpoint real y deja el rastro completo", async () => {
  const v = await proponer();
  assert.equal(v.estado, "pendiente");
  assert.equal(mundo.ejecuciones, 0, "proponer no ejecuta");

  const d = await confirmar(v.id);
  assert.equal(d.http, 200);
  assert.equal(d.vista?.estado, "hecha");
  assert.equal(d.vista?.resultado?.frase, "Agendé a María López el jueves 18 a las 10:00 con el Dr. Ruiz.");
  assert.equal(mundo.ejecuciones, 1);

  // Al endpoint le llegó lo que se propuso, con la sesión de quien confirmó.
  assert.deepEqual(mundo.llegoAlEndpoint, [
    { metodo: "POST", ruta: "/api/appointments", cuerpo: propuesta.datos, cookie: "sb-sesion=abc" },
  ]);

  // Rastro: quién pidió, qué propuso Sabina, qué confirmó y qué devolvió el servidor.
  assert.deepEqual(acciones(v.id), [EVENTO.proponer, EVENTO.confirmar, EVENTO.resultado]);
  const [p, c, r] = base.filas.filter((f) => f.entityId === v.id);
  assert.equal(p.userId, "us_recepcion");
  assert.equal(p.entityType, "sabina-propuesta");
  assert.equal(p.changes.pedido, "agenda a María el jueves a las 10");
  assert.equal(p.changes.tarjeta.frase, propuesta.tarjeta.frase);
  assert.deepEqual(p.changes.datos, propuesta.datos);
  assert.equal(p.ipAddress, "10.0.0.7");
  assert.equal(c.changes.frase, propuesta.tarjeta.frase);
  assert.equal(r.changes.ok, true);
  assert.deepEqual(r.changes.entidad, { tipo: "appointment", id: "ap_1" });
  assert.equal(r.changes.llamadas[0].status, 201);
  assert.equal(r.changes.llamadas[0].ruta, "/api/appointments");
});

test("dos toques a la vez: se ejecuta UNA sola vez y el otro recibe lo que pasó", async () => {
  const v = await proponer();
  const [a, b] = await Promise.all([confirmar(v.id), confirmar(v.id)]);
  assert.equal(mundo.ejecuciones, 1);
  assert.deepEqual([a.http, b.http].sort(), [200, 409]);
  assert.equal(acciones(v.id).filter((x) => x === EVENTO.confirmar).length, 1);
});

test("una propuesta YA USADA no vuelve a escribir (y devuelve el resultado que quedó)", async () => {
  const v = await proponer();
  await confirmar(v.id);
  const otra = await confirmar(v.id);
  assert.equal(otra.http, 409);
  assert.equal(otra.vista?.estado, "hecha");
  assert.equal(otra.vista?.resultado?.frase, "Agendé a María López el jueves 18 a las 10:00 con el Dr. Ruiz.");
  assert.equal(mundo.ejecuciones, 1);
  assert.equal(mundo.llegoAlEndpoint.length, 1);
  assert.equal(acciones(v.id).at(-1), EVENTO.rechazo);
});

test("una propuesta CADUCADA no escribe", async () => {
  const v = await proponer();
  reloj += SABINA_PROPUESTA_TTL_MS + 1;
  const d = await confirmar(v.id);
  assert.equal(d.http, 410);
  assert.equal(d.vista?.estado, "caducada");
  assert.match(d.vista?.resultado?.frase ?? "", /caducó/);
  assert.equal(mundo.ejecuciones, 0);
  assert.equal(mundo.llegoAlEndpoint.length, 0);
  assert.deepEqual(acciones(v.id), [EVENTO.proponer, EVENTO.rechazo]);
});

test("un segundo antes de caducar todavía vale", async () => {
  const v = await proponer();
  reloj += SABINA_PROPUESTA_TTL_MS - 1_000;
  const d = await confirmar(v.id);
  assert.equal(d.vista?.estado, "hecha");
});

test("si la hora se ocupó mientras tanto (la huella cambió), NO escribe a ciegas", async () => {
  const v = await proponer();
  mundo.horaLibre = false;
  const d = await confirmar(v.id);
  assert.equal(d.http, 200);
  assert.equal(d.vista?.estado, "fallida");
  assert.equal(d.vista?.resultado?.tipo, "cambio");
  assert.match(d.vista?.resultado?.frase ?? "", /Algo cambió/);
  assert.equal(mundo.ejecuciones, 0);
  assert.equal(mundo.llegoAlEndpoint.length, 0);
  // Y queda gastada: no se puede reintentar la misma cuando la hora vuelva a estar libre.
  mundo.horaLibre = true;
  assert.equal((await confirmar(v.id)).http, 409);
  assert.equal(mundo.ejecuciones, 0);
});

test("la huella se recalcula bajo el candado de solo lectura: si intenta escribir, no se ejecuta", async () => {
  const v = await proponer();
  mundo.escribirEnHuella = true;
  const d = await confirmar(v.id);
  assert.equal(d.vista?.estado, "fallida");
  assert.equal(d.vista?.resultado?.tipo, "cambio");
  assert.equal(mundo.ejecuciones, 0);
});

test("si el endpoint rechaza (409 de solape), se dice y no se da por hecho", async () => {
  const v = await proponer();
  mundo.statusEndpoint = 409;
  const d = await confirmar(v.id);
  assert.equal(d.vista?.estado, "fallida");
  assert.equal(d.vista?.resultado?.tipo, "conflicto");
  assert.match(d.vista?.resultado?.frase ?? "", /ya tiene otra cita/);
  const r = base.filas.find((f) => f.entityId === v.id && f.action === EVENTO.resultado)!;
  assert.equal(r.changes.llamadas[0].status, 409);
  assert.deepEqual(r.changes.llamadas[0].cuerpo, { error: "appointment_overlap" });
});

test("si le quitaron el permiso entre proponer y confirmar, no escribe y dice cuál", async () => {
  const v = await proponer();
  const d = await confirmar(v.id, ctx({ permissionsOverride: ["agenda.view"] }));
  assert.equal(d.vista?.estado, "fallida");
  assert.equal(d.vista?.resultado?.tipo, "sin_permiso");
  assert.match(d.vista?.resultado?.frase ?? "", /No tienes permiso para agendar citas/);
  assert.equal(mundo.ejecuciones, 0);
});

test("la propuesta de OTRO usuario, o de otra clínica, es un 404 y no deja huella", async () => {
  const v = await proponer();
  const filasAntes = base.filas.length;
  assert.equal((await confirmar(v.id, ctx({ userId: "us_otro" }))).http, 404);
  assert.equal((await confirmar(v.id, ctx({ clinicId: "cl_vecina" }))).http, 404);
  assert.equal((await confirmar("no-es-un-uuid")).http, 404);
  assert.equal(mundo.ejecuciones, 0);
  assert.equal(base.filas.length, filasAntes);
});

test("una propuesta nueva SUSTITUYE a la pendiente, y la sustituida ya no se confirma", async () => {
  const vieja = await proponer();
  const nueva = await proponer();
  assert.deepEqual(acciones(vieja.id), [EVENTO.proponer, EVENTO.descartar]);
  const d = await confirmar(vieja.id);
  assert.equal(d.http, 409);
  assert.equal(d.vista?.estado, "reemplazada");
  assert.equal(mundo.ejecuciones, 0);
  assert.equal((await confirmar(nueva.id)).vista?.estado, "hecha");
});

test("dos preguntas a la vez (dos pestañas) dejan dos propuestas: al confirmar, solo vale la más nueva", async () => {
  const [a, b] = await Promise.all([proponer(), (reloj += 5, proponer())]);
  const [vieja, nueva] = a.creadaEn <= b.creadaEn ? [a, b] : [b, a];
  const d = await confirmar(vieja.id);
  assert.equal(d.http, 409);
  assert.equal(d.vista?.estado, "reemplazada");
  assert.equal(mundo.ejecuciones, 0);
  assert.equal((await confirmar(nueva.id)).vista?.estado, "hecha");
  assert.equal(mundo.ejecuciones, 1);
});

test("consultar es solo lectura: no reclama, no ejecuta y no escribe nada", async () => {
  const v = await proponer();
  const filas = base.filas.length;
  const c = await consultarPropuesta({ ctx: ctx(), id: v.id, db: base.db, ahora });
  assert.equal(c?.estado, "pendiente");
  assert.equal(base.filas.length, filas);
  assert.equal(mundo.ejecuciones, 0);
  assert.equal(await consultarPropuesta({ ctx: ctx({ userId: "us_otro" }), id: v.id, db: base.db, ahora }), null);
  await confirmar(v.id);
  assert.equal((await consultarPropuesta({ ctx: ctx(), id: v.id, db: base.db, ahora }))?.estado, "hecha");
});

test("…pero la de OTRO usuario no se toca", async () => {
  const deOtro = await proponer(ctx({ userId: "us_doctor" }));
  await proponer();
  assert.deepEqual(acciones(deOtro.id), [EVENTO.proponer]);
});

test("descartada no se confirma", async () => {
  const v = await proponer();
  const d = await descartarPropuesta({ ctx: ctx(), id: v.id, db: base.db, ahora });
  assert.equal(d.http, 200);
  assert.equal(d.vista?.estado, "descartada");
  assert.equal((await confirmar(v.id)).http, 409);
  assert.equal(mundo.ejecuciones, 0);
});

test("la llave muere al terminar: guardarla no sirve para escribir después, ni dentro de una fase de solo lectura", async () => {
  const v = await proponer();
  await confirmar(v.id);
  const llave = mundo.llaveGuardada!;
  await assert.rejects(llave.llamar(handlerFalso, { metodo: "POST", ruta: "/api/appointments", cuerpo: {} }), /llave_revocada/);
  assert.equal(mundo.llegoAlEndpoint.length, 1);
});

test("la llave no llama fuera de /api ni con GET", async () => {
  const otra = definirAccion({
    ...agendar,
    ejecutar: async (llave) => {
      await assert.rejects(llave.llamar(handlerFalso, { metodo: "GET" as any, ruta: "/api/appointments" }), /método/);
      await assert.rejects(llave.llamar(handlerFalso, { metodo: "POST", ruta: "https://evil.example/api" }), /ruta/);
      await assert.rejects(
        soloLectura("prueba", () => llave.llamar(handlerFalso, { metodo: "POST", ruta: "/api/appointments" })),
        /sabina_escritura_bloqueada/,
      );
      return { ok: true, frase: "ok" };
    },
  });
  const v = await proponer();
  const d = await confirmarPropuesta({ ctx: ctx(), id: v.id, req: peticion() as any, acciones: [otra], db: base.db, ahora });
  assert.equal(d.vista?.estado, "hecha");
  assert.equal(mundo.llegoAlEndpoint.length, 0);
});

test("si la acción ya no existe en el catálogo, no se ejecuta nada", async () => {
  const v = await proponer();
  const d = await confirmarPropuesta({ ctx: ctx(), id: v.id, req: peticion() as any, acciones: [], db: base.db, ahora });
  assert.equal(d.vista?.estado, "fallida");
  assert.equal(mundo.ejecuciones, 0);
});

test("al reabrir la conversación vuelven sus tarjetas con su estado de ahora", async () => {
  const a = await proponer(ctx(), "conv_1");
  await confirmar(a.id);
  reloj += 1_000;
  const b = await proponer(ctx(), "conv_1");
  await proponer(ctx({ userId: "us_otro" }), "conv_1");
  const vistas = await propuestasDeConversacion({ ctx: ctx(), conversacionId: "conv_1", db: base.db, ahora });
  assert.deepEqual(
    vistas.map((x) => [x.id, x.estado]),
    [
      [a.id, "hecha"],
      [b.id, "pendiente"],
    ],
  );
});

test("la confirmación solo se acepta desde la misma página (Origin o Referer del mismo host)", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(origenValido(h({ host: "app.dalecontrol.mx", origin: "https://app.dalecontrol.mx" })), true);
  assert.equal(origenValido(h({ host: "app.dalecontrol.mx", referer: "https://app.dalecontrol.mx/dashboard/sabina" })), true);
  assert.equal(origenValido(h({ host: "app.dalecontrol.mx", origin: "https://evil.example" })), false);
  assert.equal(origenValido(h({ host: "app.dalecontrol.mx" })), false);
});
