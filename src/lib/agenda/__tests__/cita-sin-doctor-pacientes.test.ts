/**
 * ws1-t11 · P1 v2 (m2 de la revisión de t12) — la lista de pacientes de un DOCTOR con «solo sus pacientes»:
 * una cita «Sin doctor» abre al paciente solo si es de ESTA clínica y está viva de verdad (por venir, o en
 * «Llegó»/«En sillón» de las últimas 24 h). Una «Llegó» de hace meses que nadie cerró ya no lo abre.
 *
 * Run: npm run test:cita-sin-doctor
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPatientWhere, VENTANA_SIN_DOCTOR_PRESENTE_MS } from "@/lib/auth-context";

function ramaSinDoctor(w: any): any {
  const legacy = w.AND[0].OR[0].AND[1].OR;
  return legacy.find((o: any) => o.appointments?.some?.doctorId === null).appointments.some;
}

test("buildPatientWhere (DOCTOR): la rama «Sin doctor» va por clínica y con tope de fecha en «Llegó»/«En sillón»", () => {
  const antes = Date.now();
  const w: any = buildPatientWhere({ clinicId: "c1", userId: "clx9doc0a000108l4aaaa0001", isAdmin: false, isDoctor: true } as any);
  const r = ramaSinDoctor(w);
  assert.equal(r.clinicId, "c1");
  const presente = r.OR.find((o: any) => o.status.in.includes("CHECKED_IN"));
  assert.deepEqual(presente.status.in, ["CHECKED_IN", "IN_CHAIR"]);
  assert.ok(presente.startsAt?.gte instanceof Date, "sin tope, una «Llegó» vieja abre al paciente para siempre");
  const desde = presente.startsAt.gte.getTime();
  assert.ok(desde >= antes - VENTANA_SIN_DOCTOR_PRESENTE_MS - 1000 && desde <= Date.now() - VENTANA_SIN_DOCTOR_PRESENTE_MS + 1000);
  assert.equal(VENTANA_SIN_DOCTOR_PRESENTE_MS, 24 * 60 * 60 * 1000);
  const porVenir = r.OR.find((o: any) => o.status.in.includes("SCHEDULED"));
  assert.ok(porVenir.endsAt.gte instanceof Date);
});

test("buildPatientWhere: para quien no es DOCTOR no hay rama «Sin doctor» (sin cambios)", () => {
  const w: any = buildPatientWhere({ clinicId: "c1", userId: "u1", isAdmin: false, isDoctor: false } as any);
  assert.ok(!JSON.stringify(w).includes('"doctorId":null'));
});
