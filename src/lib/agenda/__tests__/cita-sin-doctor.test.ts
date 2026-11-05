/**
 * Cita «Sin doctor» — las reglas puras y los `where` de Prisma (ws1-t11 · fase 2 · P1).
 *
 * Run: npm run test:cita-sin-doctor
 *
 * Lo que esto fija, porque Prisma y Postgres lo harían mal en silencio:
 *  · `{ doctorId: null }` es `IS NULL`: en un choque «mismo doctor» empataría a
 *    todas las «Sin doctor» entre sí → la rama del doctor se OMITE;
 *  · `{ doctorId: { not: X } }` excluye los NULL → «de otro doctor o sin doctor» va con OR;
 *  · `OR: []` no da filas → sin doctor y sin sillón, ni se consulta.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let consultas: any[];
let respuesta: any[];
beforeEach(() => {
  consultas = [];
  respuesta = [];
});
const prismaStub: any = {
  appointment: {
    findMany: async (args: any) => { consultas.push(args); return respuesta; },
    findFirst: async (args: any) => { consultas.push(args); return null; },
  },
};
(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });

const DRA = "clx9doc0a000108l4aaaa0001";
const DR2 = "seed-doctor-2";

// ═══════════════ el cuerpo ═══════════════

test("doctorDelAlta: null explícito = «Sin doctor»; ausente o vacío = falta", async () => {
  const { doctorDelAlta } = await import("@/lib/agenda/sin-doctor");
  assert.deepEqual(doctorDelAlta(null), { ok: true, doctorId: null });
  assert.deepEqual(doctorDelAlta(DRA), { ok: true, doctorId: DRA });
  for (const v of [undefined, "", "   ", 7, {}]) assert.equal(doctorDelAlta(v).ok, false, String(v));
});

test("doctorDelCambio: ausente o \"\" no cambia; null quita; un id asigna", async () => {
  const { doctorDelCambio } = await import("@/lib/agenda/sin-doctor");
  assert.equal(doctorDelCambio(undefined).cambia, false);
  assert.equal(doctorDelCambio("").cambia, false);
  assert.deepEqual(doctorDelCambio(null), { cambia: true, doctorId: null });
  assert.deepEqual(doctorDelCambio(DR2), { cambia: true, doctorId: DR2 });
});

test("listas y ramas: sin doctor, ninguna (nada de `in: [null]` ni `{doctorId: null}`)", async () => {
  const { doctorIdsDe, ramaDelDoctor, deOtroDoctorOSinDoctor, teleconsultaSinDoctor } = await import("@/lib/agenda/sin-doctor");
  assert.deepEqual(doctorIdsDe(null), []);
  assert.deepEqual(doctorIdsDe(DRA), [DRA]);
  assert.deepEqual(ramaDelDoctor(null), []);
  assert.deepEqual(ramaDelDoctor(DRA), [{ doctorId: DRA }]);
  assert.equal(deOtroDoctorOSinDoctor(null), null);
  assert.deepEqual(deOtroDoctorOSinDoctor(DRA), { OR: [{ doctorId: { not: DRA } }, { doctorId: null }] });
  assert.equal(teleconsultaSinDoctor("TELECONSULTATION", null), true);
  assert.equal(teleconsultaSinDoctor("TELECONSULTATION", DRA), false);
  assert.equal(teleconsultaSinDoctor("IN_PERSON", null), false);
});

// ═══════════════ quién puede ═══════════════

test("doctorPuedeEditar: el DOCTOR toma una «Sin doctor» solo asignándosela a sí mismo", async () => {
  const { doctorPuedeEditar, doctorDelCambio: c } = await import("@/lib/agenda/sin-doctor");
  assert.equal(doctorPuedeEditar("RECEPTIONIST", "u", null, c(undefined)), true);
  assert.equal(doctorPuedeEditar("DOCTOR", DRA, DRA, c(DR2)), true, "las suyas, como siempre");
  assert.equal(doctorPuedeEditar("DOCTOR", DRA, DR2, c(DRA)), false, "la de otro, nunca");
  assert.equal(doctorPuedeEditar("DOCTOR", DRA, null, c(undefined)), false, "sin tomarla no la edita");
  assert.equal(doctorPuedeEditar("DOCTOR", DRA, null, c(DR2)), false, "no se la da a otro");
  assert.equal(doctorPuedeEditar("DOCTOR", DRA, null, c(DRA)), true);
  const { doctorPuedeVer } = await import("@/lib/agenda/sin-doctor");
  assert.equal(doctorPuedeVer("DOCTOR", DRA, null), true);
  assert.equal(doctorPuedeVer("DOCTOR", DRA, DR2), false);
});

test("doctorAlCambiarEstado: la matriz de D3/D9", async () => {
  const { doctorAlCambiarEstado: d } = await import("@/lib/agenda/sin-doctor");
  const base = { userId: DRA, citaDoctorId: null as string | null, pedido: undefined as unknown };
  // DOCTOR con una «Sin doctor»
  assert.deepEqual(d({ ...base, role: "DOCTOR", destino: "IN_PROGRESS" }), { asignar: DRA, rechazo: null });
  assert.deepEqual(d({ ...base, role: "DOCTOR", destino: "COMPLETED" }), { asignar: DRA, rechazo: null });
  assert.deepEqual(d({ ...base, role: "DOCTOR", destino: "IN_CHAIR" }), { asignar: null, rechazo: null });
  assert.deepEqual(d({ ...base, role: "DOCTOR", destino: "IN_CHAIR", pedido: DRA }), { asignar: DRA, rechazo: null });
  for (const s of ["CANCELLED", "NO_SHOW", "SCHEDULED", "CONFIRMED"]) assert.equal(d({ ...base, role: "DOCTOR", destino: s }).rechazo?.status, 403, s);
  assert.equal(d({ ...base, role: "DOCTOR", destino: "IN_PROGRESS", pedido: DR2 }).rechazo?.status, 403);
  // otro rol
  assert.equal(d({ ...base, role: "ADMIN", destino: "IN_PROGRESS" }).rechazo?.status, 409);
  assert.deepEqual(d({ ...base, role: "ADMIN", destino: "IN_PROGRESS", pedido: DR2 }), { asignar: DR2, rechazo: null });
  assert.deepEqual(d({ ...base, role: "RECEPTIONIST", destino: "CHECKED_IN" }), { asignar: null, rechazo: null });
  assert.deepEqual(d({ ...base, role: "RECEPTIONIST", destino: "CHECKED_IN", pedido: DR2 }), { asignar: DR2, rechazo: null });
  assert.deepEqual(d({ ...base, role: "ADMIN", destino: "COMPLETED" }), { asignar: null, rechazo: null }, "terminar sin doctor se permite");
  // cita con doctor: como siempre, y no se reasigna por aquí
  assert.deepEqual(d({ ...base, citaDoctorId: DR2, role: "ADMIN", destino: "IN_PROGRESS", pedido: DRA }), { asignar: null, rechazo: null });
  assert.equal(d({ ...base, citaDoctorId: DR2, role: "DOCTOR", destino: "IN_PROGRESS" }).rechazo?.status, 403);
});

test("esCitaQuePuedeMover: `null` es tomable para un DOCTOR; `undefined` (no se leyó) no abre nada", async () => {
  const { esCitaQuePuedeMover } = await import("@/lib/agenda/cita-del-usuario");
  assert.equal(esCitaQuePuedeMover({ doctorId: null }, { id: DRA, role: "DOCTOR" }), true);
  assert.equal(esCitaQuePuedeMover({}, { id: DRA, role: "DOCTOR" }), false);
  assert.equal(esCitaQuePuedeMover({ doctorId: DR2 }, { id: DRA, role: "DOCTOR" }), false);
  assert.equal(esCitaQuePuedeMover({ doctorId: DR2 }, { id: "x", role: "RECEPTIONIST" }), true);
});

test("rescheduleRuleViolation: ponerle doctor a una «Sin doctor» completada NO es moverla; quitárselo, sí", async () => {
  const { rescheduleRuleViolation } = await import("@/lib/agenda/booking-rules");
  const hace3d = new Date(Date.now() - 3 * 86_400_000);
  const base = { reason: undefined, patientStatus: "ACTIVE", slotMinutes: 30, now: new Date() };
  assert.equal(
    rescheduleRuleViolation({ ...base, current: { status: "COMPLETED", startsAt: hace3d, doctorId: null, reason: "x" }, next: { startsAt: hace3d, doctorId: DRA } }),
    null,
  );
  assert.equal(
    rescheduleRuleViolation({ ...base, current: { status: "COMPLETED", startsAt: hace3d, doctorId: DRA, reason: "x" }, next: { startsAt: hace3d, doctorId: null } })?.error,
    "appointment_not_movable",
  );
  assert.equal(
    rescheduleRuleViolation({ ...base, current: { status: "COMPLETED", startsAt: hace3d, doctorId: DRA, reason: "x" }, next: { startsAt: hace3d, doctorId: DR2 } })?.error,
    "appointment_not_movable",
    "cambiar de doctor sigue siendo moverla",
  );
});

test("la nota de consulta se puede ligar a una «Sin doctor» (no es «de otro doctor»)", async () => {
  const { resolveNoteAppointmentId } = await import("@/lib/clinical/note-appointment-link");
  const ahora = new Date();
  const cita = { id: "cmh0cita0001", status: "IN_PROGRESS", startsAt: ahora.toISOString(), doctorId: null };
  assert.equal(resolveNoteAppointmentId("cmh0cita0001", [cita], { doctorId: DRA, now: ahora } as any), "cmh0cita0001");
  assert.equal(resolveNoteAppointmentId("cmh0cita0001", [{ ...cita, doctorId: DR2 }], { doctorId: DRA, now: ahora } as any), null);
  const { notaLigable } = await import("@/lib/treatments/cita-del-hecho");
  assert.equal(notaLigable({ status: "SCHEDULED", doctorId: null, momento: "hoy" }, DRA), true);
  assert.equal(notaLigable({ status: "SCHEDULED", doctorId: DR2, momento: "hoy" }, DRA), false);
});

test("tipoDeChoque: una «Sin doctor» nunca choca como «otra cita del doctor»", async () => {
  const { tipoDeChoque } = await import("@/lib/agenda/agenda-flexible");
  assert.equal(tipoDeChoque({ conflicto: { doctorId: null, resourceId: "r1" }, intento: { doctorId: null, resourceId: "r1" } }), "sillon");
  assert.equal(tipoDeChoque({ conflicto: { doctorId: DRA, resourceId: null }, intento: { doctorId: DRA, resourceId: null } }), "doctor");
});

test("overlap-client: sin doctor no hay «mismo doctor» (`undefined === undefined` empataba); el sillón sí", async () => {
  const { findOverlap, findAllOverlaps } = await import("@/lib/agenda/overlap-client");
  const otra: any = { id: "x", status: "SCHEDULED", overrideReason: null, startsAt: "2026-11-10T16:00:00.000Z", endsAt: "2026-11-10T16:30:00.000Z", doctor: undefined, resourceId: "r1" };
  const cand = { doctorId: null, resourceId: null, startsAt: "2026-11-10T16:00:00.000Z", endsAt: "2026-11-10T16:30:00.000Z" };
  assert.equal(findOverlap(cand, [otra]), null);
  assert.equal(findAllOverlaps(cand, [otra]).length, 0);
  assert.equal(findOverlap({ ...cand, resourceId: "r1" }, [otra])?.reason, "resource");
});

// ═══════════════ los where ═══════════════

test("buscarChoqueDeCita: sin doctor y sin sillón ni consulta; con sillón, solo el sillón; con doctor, como siempre", async () => {
  const { buscarChoqueDeCita } = await import("@/lib/agenda/sobreagendar.server");
  const h = { clinicId: "c1", startsAt: new Date("2026-11-10T16:00:00Z"), endsAt: new Date("2026-11-10T16:30:00Z") };
  assert.equal(await buscarChoqueDeCita({ ...h, doctorId: null, resourceId: null }), null);
  assert.equal(consultas.length, 0, "`OR: []` no da filas: ni se pregunta");
  await buscarChoqueDeCita({ ...h, doctorId: null, resourceId: "r1" });
  assert.deepEqual(consultas[0].where.OR, [{ resourceId: "r1" }]);
  await buscarChoqueDeCita({ ...h, doctorId: DRA, resourceId: "r1" });
  assert.deepEqual(consultas[1].where.OR, [{ doctorId: DRA }, { resourceId: "r1" }]);
  assert.ok(!JSON.stringify(consultas).includes('"doctorId":null'), "nunca la rama {doctorId: null}");
});

test("buscarPacienteEmpalmado: con doctor también ve las «Sin doctor»; sin doctor, cualquier otra del paciente", async () => {
  const { buscarPacienteEmpalmado } = await import("@/lib/agenda/paciente-empalmado");
  const h = { clinicId: "c1", patientId: "p1", startsAt: new Date("2026-11-10T16:00:00Z"), endsAt: new Date("2026-11-10T16:30:00Z"), timezone: "America/Mexico_City" };
  await buscarPacienteEmpalmado({ ...h, doctorId: DRA });
  assert.deepEqual(consultas[0].where.OR, [{ doctorId: { not: DRA } }, { doctorId: null }]);
  assert.equal(consultas[0].where.doctorId, undefined);
  await buscarPacienteEmpalmado({ ...h, doctorId: null });
  assert.equal(consultas[1].where.OR, undefined);
  assert.equal(consultas[1].where.doctorId, undefined);
});

test("dondeCitasDelDoctor (D3): las suyas y las «Sin doctor» de pacientes que puede ver; el filtro acepta «Sin doctor»", async () => {
  const { dondeCitasDelDoctor, dondeDoctoresElegidos } = await import("@/lib/agenda/citas-del-doctor");
  const { FILTRO_SIN_DOCTOR } = await import("@/lib/agenda/sin-doctor");
  assert.deepEqual(dondeCitasDelDoctor({ userId: DRA, clinicId: "c1" }), {
    OR: [
      { doctorId: DRA },
      { doctorId: null, patient: { is: { OR: [{ visibleUserIds: { isEmpty: true } }, { visibleUserIds: { has: DRA } }] } } },
    ],
  });
  assert.deepEqual(dondeCitasDelDoctor({ userId: "", clinicId: "c1" }), { id: { in: [] } }, "sin id, nada (no `doctorId: undefined`)");
  assert.deepEqual(dondeDoctoresElegidos([DRA, DR2]), { doctorId: { in: [DRA, DR2] } });
  assert.deepEqual(dondeDoctoresElegidos([FILTRO_SIN_DOCTOR]), { doctorId: null });
  assert.deepEqual(dondeDoctoresElegidos([DRA, FILTRO_SIN_DOCTOR]), { OR: [{ doctorId: { in: [DRA] } }, { doctorId: null }] });
});

test("asignarSiSinDoctor (firmar la hoja de ortodoncia): condicional a `doctorId: null` y nunca lanza", async () => {
  const { asignarSiSinDoctor } = await import("@/lib/agenda/sin-doctor.server");
  const llamadas: any[] = [];
  const db = { appointment: { updateMany: async (a: any) => { llamadas.push(a); return { count: 1 }; } } };
  assert.equal(await asignarSiSinDoctor(db, { clinicId: "c1", appointmentId: "cmh0cita0001", doctorId: DRA }), true);
  assert.deepEqual(llamadas[0], { where: { id: "cmh0cita0001", clinicId: "c1", doctorId: null }, data: { doctorId: DRA } });
  assert.equal(await asignarSiSinDoctor(db, { clinicId: "", appointmentId: "x", doctorId: DRA }), false);
  assert.equal(llamadas.length, 1, "sin clínica no se consulta");
  const choca = { appointment: { updateMany: async () => { throw Object.assign(new Error("exclusion"), { code: "23P01" }); } } };
  assert.equal(await asignarSiSinDoctor(choca, { clinicId: "c1", appointmentId: "x", doctorId: DRA }), false);
});

test("sonda «¿ya se pegó el SQL?»: YES/NO de information_schema, memoria, y al guardar vuelve a preguntar si dijo «no»", async () => {
  const { sinDoctorDisponible, sinDoctorDisponibleAlGuardar, _olvidarSinDoctor } = await import("@/lib/agenda/sin-doctor.server");
  let si = false;
  let preguntas = 0;
  const db = { $queryRaw: async (s: TemplateStringsArray) => { preguntas++; assert.match(s.join(""), /information_schema\.columns/); return [{ si }]; } };
  _olvidarSinDoctor();
  assert.equal(await sinDoctorDisponible({ db }), false);
  assert.equal(await sinDoctorDisponible({ db }), false);
  assert.equal(preguntas, 1, "en memoria");
  si = true; // Rafael pegó el SQL
  assert.equal(await sinDoctorDisponible({ db }), false, "la memoria aún dice que no…");
  assert.equal(await sinDoctorDisponibleAlGuardar({ db }), true, "…pero al guardar se vuelve a preguntar");
  assert.equal(await sinDoctorDisponible({ db }), true);
  _olvidarSinDoctor();
  const rota = { $queryRaw: async () => { throw new Error("timeout"); } };
  assert.equal(await sinDoctorDisponible({ db: rota }), false, "sin respuesta, no se ofrece");
});
