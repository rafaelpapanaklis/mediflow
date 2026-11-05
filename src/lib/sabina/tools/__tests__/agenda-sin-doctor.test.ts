/**
 * Sabina ante una cita «Sin doctor» (ws1-t10 · fase 2 · P3). Sabina la usa el
 * equipo: puede moverla o cancelarla conservándola «Sin doctor», con la
 * ocupación de la clínica y del sillón (las «Sin doctor» no se bloquean entre
 * sí). Un DOCTOR la puede tomar desde la agenda, pero no moverla ni cancelarla.
 *
 * Run: npm run test:cita-sin-doctor-mensajes
 *
 * Mismo arnés que agenda-acciones.test.ts: la base es un espía de solo lectura
 * y los route handlers están sustituidos (fase 1 propone, no escribe).
 */
import "./preparar";
import { mock, test } from "node:test";
import assert from "node:assert/strict";

const espiaRuta = (nombre: string) => async () => {
  throw new Error(`una herramienta de fase 1 llamó al endpoint ${nombre}`);
};
mock.module("@/app/api/appointments/route", {
  namedExports: { GET: espiaRuta("GET"), POST: espiaRuta("POST") },
});
mock.module("@/app/api/appointments/[id]/route", {
  namedExports: { PATCH: espiaRuta("PATCH"), DELETE: espiaRuta("DELETE") },
});
mock.module("@/app/api/appointments/[id]/status/route", {
  namedExports: { PATCH: espiaRuta("PATCH status") },
});

import * as catalogo from "../index";
import { accionReagendarCita, accionCancelarCita } from "../../acciones-agenda";
import { DIA, CL_A, baseAgenda, drSalas, en, recepcion } from "./agenda-siembra";
import type { SabinaCtx } from "../../tipos";

const iso = (dia: string, hhmm: string) => en(dia, hhmm).toISOString();

function herramienta(nombre: string) {
  const t = ((catalogo as any).HERRAMIENTAS_AGENDA as any[]).find((h) => h.nombre === nombre);
  assert.ok(t, nombre);
  return t;
}
async function datos(nombre: string, ctx: SabinaCtx, params: Record<string, unknown>): Promise<any> {
  const r = await (catalogo as any).correrHerramienta(herramienta(nombre), ctx, params);
  assert.equal(r.ok, true, `${nombre}: ${JSON.stringify(r)}`);
  return r.datos;
}

/** La base de agenda-siembra + dos «Sin doctor» del DIA a las 13:00 (ids de Dentalink y de siembra). */
function conSinDoctor() {
  const db = baseAgenda();
  const sd = (id: string, patientId: string, de: string, a: string) => ({
    id, clinicId: CL_A, patientId, doctorId: null, resourceId: null, status: "SCHEDULED", type: "Limpieza",
    overrideReason: null, googleCalendarEventId: null, holdExpiresAt: null, startsAt: en(DIA, de), endsAt: en(DIA, a),
  });
  db.filas.appointments.push(sd("dentalink-cita-48213", "p-mg2", "13:00", "13:30"), sd("seed-cita-sd-2", "p-mg1", "16:00", "16:30"));
  return db;
}

test("🔴 recepción mueve una «Sin doctor» encima de OTRA «Sin doctor»: no choca y sigue sin doctor", async () => {
  const db = conSinDoctor();
  const d = await datos("reagendar_cita", recepcion(db), { citaId: "seed-cita-sd-2", nuevaFecha: DIA, nuevaHora: "13:00" });
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
  const p = d.propuesta;
  assert.deepEqual(p.peticion.cuerpo, { startsAt: iso(DIA, "13:00"), endsAt: iso(DIA, "13:30"), notifyPatient: false }, "no manda doctorId: el PATCH la deja «Sin doctor»");
  assert.match(p.frase, /\(sin doctor\)/);
  assert.doesNotMatch(p.frase, /con\s+del|undefined|null/, p.frase);
  assert.deepEqual(p.detalle.find((f: any) => f.campo === "Doctor"), { campo: "Doctor", valor: "Sin doctor" });
  assert.equal(p.esperado.doctorId, null);
  // La propuesta guardada pasa su esquema (antes `doctorId: z.string()` la rechazaba).
  const v = (accionReagendarCita as any).datos.safeParse(p);
  assert.equal(v.success, true, JSON.stringify(v.error?.issues));
});

test("una «Sin doctor» tampoco choca con las citas de un doctor a esa hora (no ocupa a nadie)", async () => {
  const db = conSinDoctor();
  // A las 10:00 el Dr. Salas tiene a Juan.
  const d = await datos("reagendar_cita", recepcion(db), { citaId: "dentalink-cita-48213", nuevaFecha: DIA, nuevaHora: "10:00" });
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
});

test("recepción cancela una «Sin doctor»: propuesta válida, «Sin doctor» en la tarjeta", async () => {
  const db = conSinDoctor();
  const d = await datos("cancelar_cita", recepcion(db), { citaId: "dentalink-cita-48213" });
  assert.equal(d.estado, "propuesta", JSON.stringify(d));
  assert.match(d.propuesta.frase, /\(sin doctor\)/);
  assert.equal(d.propuesta.esperado.doctorId, null);
  const v = (accionCancelarCita as any).datos.safeParse(d.propuesta);
  assert.equal(v.success, true, JSON.stringify(v.error?.issues));
});

test("un DOCTOR no la mueve ni la cancela por Sabina (el endpoint le daría 403): se lo dice antes", async () => {
  const db = conSinDoctor();
  const r = await datos("reagendar_cita", drSalas(db), { citaId: "dentalink-cita-48213", nuevaFecha: DIA, nuevaHora: "14:00" });
  assert.equal(r.estado, "sin_permiso", JSON.stringify(r));
  assert.match(r.frase, /todavía no tiene doctor/);
  const c = await datos("cancelar_cita", drSalas(db), { citaId: "dentalink-cita-48213" });
  assert.equal(c.estado, "sin_permiso", JSON.stringify(c));
});

test("al elegir entre varias citas, la «Sin doctor» se distingue («sin doctor», no «con »)", async () => {
  const db = conSinDoctor();
  const d = await datos("cancelar_cita", recepcion(db), { paciente: "María García" , pacienteId: "p-mg1" });
  if (d.estado === "pregunta") {
    const detalles = d.preguntas.flatMap((q: any) => q.opciones.map((o: any) => o.detalle));
    assert.ok(detalles.some((x: string) => /^sin doctor · /.test(x)), JSON.stringify(detalles));
    assert.ok(detalles.every((x: string) => !/^con  ·|^con ·/.test(x)), JSON.stringify(detalles));
  } else {
    assert.fail(`esperaba la pregunta de cuál cita: ${JSON.stringify(d)}`);
  }
});
