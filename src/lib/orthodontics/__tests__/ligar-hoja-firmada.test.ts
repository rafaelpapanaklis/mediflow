/**
 * ws1-t8 — revisión en panel.108 de ws1-t9, fallo 2: la hoja de control se firmó «sin cita» y después apareció
 * la cita de hoy; la cita quedaba «Agendada» / «por registrar» y no había forma de cerrarla. Una nota por
 * visita: esa hoja ES el control de la cita, así que se liga a ella y la cita se cierra sin pedir otra nota.
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/orthodontics/__tests__/ligar-hoja-firmada.test.ts
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Hoja = { id: string; clinicId: string; treatmentPlanId: string; status: string; appointmentId: string | null; visitDate: Date };
type Nota = { id: string; patientId: string; subjective: string | null; objective: string | null; assessment: string | null; plan: string | null; specialtyData: Record<string, unknown> };
type Cita = { id: string; clinicId: string; status: string; startsAt: Date; [k: string]: unknown };

let hojas: Hoja[] = [];
let notas: Nota[] = [];
let citas: Cita[] = [];
let resenas: string[] = [];

const coincideNota = (n: Nota, w: { patientId?: string; specialtyData?: { path: string[]; equals: string } }) =>
  (!w.patientId || n.patientId === w.patientId) &&
  (!w.specialtyData || n.specialtyData[w.specialtyData.path[0]] === w.specialtyData.equals);

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthoTreatmentCard: {
        findFirst: async ({ where }: { where: { clinicId: string; appointmentId: string } }) =>
          hojas.find((h) => h.clinicId === where.clinicId && h.appointmentId === where.appointmentId) ?? null,
        findMany: async ({ where }: { where: Partial<Hoja> }) =>
          hojas.filter(
            (h) =>
              h.clinicId === where.clinicId &&
              h.treatmentPlanId === where.treatmentPlanId &&
              h.status === where.status &&
              h.appointmentId === where.appointmentId,
          ),
        updateMany: async ({ where, data }: { where: { id: string; clinicId: string; appointmentId: null }; data: { appointmentId: string } }) => {
          const h = hojas.find((x) => x.id === where.id && x.clinicId === where.clinicId && x.appointmentId === null);
          if (!h) return { count: 0 };
          h.appointmentId = data.appointmentId;
          return { count: 1 };
        },
      },
      medicalRecord: {
        findFirst: async ({ where }: { where: { specialtyData: { path: string[]; equals: string } } }) =>
          notas.find((n) => coincideNota(n, where)) ?? null,
        findMany: async ({ where }: { where: { patientId: string; specialtyData: { path: string[]; equals: string } } }) =>
          notas.filter((n) => coincideNota(n, where)),
        update: async ({ where, data }: { where: { id: string }; data: Partial<Nota> }) => {
          const i = notas.findIndex((n) => n.id === where.id);
          notas[i] = { ...notas[i], ...data };
          return notas[i];
        },
      },
      appointment: {
        updateMany: async ({ where, data }: { where: { id: string; clinicId: string; status: string }; data: Record<string, unknown> }) => {
          const c = citas.find((x) => x.id === where.id && x.clinicId === where.clinicId && x.status === where.status);
          if (!c) return { count: 0 };
          Object.assign(c, data);
          return { count: 1 };
        },
      },
    },
  },
});
mock.module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async (id: string) => void resenas.push(id) } });
mock.module("../catalog-procedures", { namedExports: { listarProcedimientosDeOrtodoncia: async () => [] } });

const ZONA = "America/Mexico_City";
const AHORA = new Date("2026-10-02T22:00:00Z"); // 2-oct 16:00 en CDMX

beforeEach(() => {
  hojas = [{ id: "hoja", clinicId: "c1", treatmentPlanId: "plan", status: "SIGNED", appointmentId: null, visitDate: new Date("2026-10-02T17:00:00Z") }];
  notas = [{ id: "nota-hoja", patientId: "p1", subjective: "S", objective: "O", assessment: "A", plan: "P", specialtyData: { status: "SIGNED", treatmentCardId: "hoja", appointmentId: null } }];
  citas = [{ id: "cita-hoy", clinicId: "c1", status: "SCHEDULED", startsAt: new Date("2026-10-02T23:00:00Z") }];
  resenas = [];
});

const ligar = async (cita: Partial<Cita> = {}, rol = "DOCTOR") => {
  const { ligarHojaFirmadaDeHoyALaCita } = await import("../ligar-hoja-firmada-db");
  const c = { ...citas[0], ...cita };
  return ligarHojaFirmadaDeHoyALaCita({
    clinicId: "c1", patientId: "p1", planId: "plan", cita: { id: c.id, status: c.status, startsAt: c.startsAt }, rol, zona: ZONA, ahora: AHORA,
  });
};

test("P0147: hoja firmada «sin cita» y luego la cita de hoy → la hoja queda ligada y la cita ATENDIDA, sin otra nota", async () => {
  const r = await ligar();
  assert.deepEqual(r, { cardId: "hoja", citaCerrada: "cita-hoy" });
  assert.equal(hojas[0].appointmentId, "cita-hoy");
  assert.equal(citas[0].status, "COMPLETED");
  assert.ok(citas[0].startedAt instanceof Date, "pasa por «En consulta» como al firmar con la cita");
  assert.equal(notas.length, 1, "no se crea otra nota");
  assert.equal(notas[0].specialtyData.appointmentId, "cita-hoy", "la nota firmada solo apunta a la cita");
  assert.equal(notas[0].plan, "P", "su texto no se reescribe");
  assert.deepEqual(resenas, ["cita-hoy"], "misma invitación a reseña que al firmar con la cita");
});

test("la consulta en curso tenía un borrador vacío: queda absorbido por la nota de la hoja y la cita se cierra", async () => {
  citas[0].status = "IN_PROGRESS";
  notas.push({ id: "borrador", patientId: "p1", subjective: "", objective: null, assessment: null, plan: null, specialtyData: { status: "DRAFT", appointmentId: "cita-hoy" } });
  const r = await ligar();
  assert.equal(r.citaCerrada, "cita-hoy");
  assert.equal(notas.find((n) => n.id === "borrador")!.specialtyData.absorbidaEnNota, "nota-hoja");
});

test("si en la consulta se escribió una nota propia, la hoja se liga pero la cita la cierra «Terminar consulta»", async () => {
  citas[0].status = "IN_PROGRESS";
  notas.push({ id: "borrador", patientId: "p1", subjective: "Dolor en 24", objective: null, assessment: null, plan: null, specialtyData: { status: "DRAFT", appointmentId: "cita-hoy" } });
  const r = await ligar();
  assert.deepEqual(r, { cardId: "hoja", citaCerrada: null });
  assert.equal(hojas[0].appointmentId, "cita-hoy");
  assert.equal(citas[0].status, "IN_PROGRESS");
  assert.deepEqual(resenas, []);
});

test("no toca: una cita de otro día, una cita ya cerrada, una cita que ya tiene su hoja, ni una hoja de otro día", async () => {
  assert.deepEqual(await ligar({ startsAt: new Date("2026-10-06T16:00:00Z") }), { cardId: null, citaCerrada: null });
  assert.deepEqual(await ligar({ status: "COMPLETED" }), { cardId: null, citaCerrada: null });
  assert.deepEqual(await ligar({ status: "CANCELLED" }), { cardId: null, citaCerrada: null });
  hojas.push({ id: "otra", clinicId: "c1", treatmentPlanId: "plan", status: "DRAFT", appointmentId: "cita-hoy", visitDate: AHORA });
  assert.deepEqual(await ligar(), { cardId: null, citaCerrada: null });
  hojas = [{ ...hojas[0], appointmentId: null, visitDate: new Date("2026-10-01T17:00:00Z") }];
  assert.deepEqual(await ligar(), { cardId: null, citaCerrada: null });
  assert.equal(citas[0].status, "SCHEDULED");
  assert.deepEqual(resenas, []);
});

test("un rol que no puede cerrar citas liga la hoja pero no cierra la cita", async () => {
  const r = await ligar({}, "RECEPTIONIST");
  assert.deepEqual(r, { cardId: "hoja", citaCerrada: null });
  assert.equal(citas[0].status, "SCHEDULED");
});

test("se usa al abrir la hoja desde la cita (Hoy/Agenda/Controles), en «Ver el control de hoy» y al «Terminar consulta»", () => {
  const SRC = join(__dirname, "..", "..", "..");
  const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
  const desdeCita = leer("app/actions/orthodontics/getTreatmentCardContextForAppointment.ts");
  assert.ok(desdeCita.indexOf("ligarHojaFirmadaDeHoyALaCita({") < desdeCita.indexOf("buildTreatmentCardContext(plan, citaVigente, zona)"));
  assert.match(leer("components/specialties/orthodontics/agenda/BotonHojaControl.tsx"), /if \(res\.data\.hojaFirmadaLigada\)/);
  const cliente = leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  const i = cliente.indexOf("if (hojaDeHoyFirmada) {");
  assert.ok(cliente.indexOf("ligarControlFirmadoDeHoy(t.treatmentPlanId, props.citaEnCursoId ?? null)", i) > i);
  const ficha = leer("app/dashboard/patients/[id]/patient-detail-client.tsx");
  const iLigar = ficha.indexOf("await ligarControlFirmadoDeHoy(planOrto, activeAppointment.id)");
  const iCompletar = ficha.indexOf("/api/appointments/${activeAppointment.id}/complete");
  assert.ok(iLigar > 0 && iLigar < iCompletar, "«Terminar consulta» liga la hoja ANTES de completar (y no pide otra nota)");
});
