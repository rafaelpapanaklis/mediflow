/**
 * ws1-t8 — revisión en panel.108 de ws1-t9, fallo 3: el aviso «La cita del … no se tocó» no se podía ver desde
 * ninguna pantalla. Desde la ficha solo viajaba la cita de la consulta EN CURSO (y el servidor solo la aceptaba con
 * el paciente presente), así que la cita futura de `?appointment=` no llegaba a la hoja: se firmaba sin cita y sin
 * decir nada. Ahora esa cita llega a la hoja cuando es de un día FUTURO sin el paciente: el cajón avisa antes de
 * firmar y la firma la deja intacta y lo repite.
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/orthodontics/__tests__/aviso-cita-futura-ficha.test.ts
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Cita = { id: string; clinicId: string; patientId: string; type: string; status: string; startsAt: Date; endsAt: Date };
let citas: Cita[] = [];
let construidaCon: { id: string } | null | undefined;

const enRango = (d: Date, r?: { gte: Date; lt: Date }) => !r || (d >= r.gte && d < r.lt);
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: { findFirst: async () => ({ id: "plan", clinicId: "c1", patientId: "p1" }) },
      clinic: { findUnique: async () => ({ timezone: "America/Mexico_City" }) },
      appointment: {
        findFirst: async ({ where }: { where: { id?: string; clinicId: string; patientId: string; status?: { in?: string[]; notIn?: string[] }; startsAt?: { gte: Date; lt: Date } } }) =>
          citas
            .filter(
              (c) =>
                (!where.id || c.id === where.id) &&
                c.clinicId === where.clinicId &&
                c.patientId === where.patientId &&
                (!where.status?.in || where.status.in.includes(c.status)) &&
                (!where.status?.notIn || !where.status.notIn.includes(c.status)) &&
                enRango(c.startsAt, where.startsAt),
            )
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ?? null,
      },
    },
  },
});
mock.module("@/app/actions/orthodontics/_helpers", {
  namedExports: {
    getOrthoActionContext: async () => ({ ok: true, data: { ctx: { clinicId: "c1", userId: "u1", role: "DOCTOR" } } }),
    loadPatientForOrtho: async () => ({ ok: true, data: {} }),
  },
});
mock.module("@/lib/orthodontics/treatment-card-context", {
  namedExports: {
    buildTreatmentCardContext: async (_plan: unknown, appt: { id: string } | null) => {
      construidaCon = appt;
      return { appointmentId: appt?.id ?? null };
    },
  },
});

// La acción usa el reloj real: la cita «futura» se fecha 4 días después de ahora.
const DIA = 24 * 3600 * 1000;
const ahora = Date.now();
beforeEach(() => {
  construidaCon = undefined;
  citas = [
    { id: "futura", clinicId: "c1", patientId: "p1", type: "Control de ortodoncia", status: "SCHEDULED", startsAt: new Date(ahora + 4 * DIA), endsAt: new Date(ahora + 4 * DIA + 1800000) },
  ];
});

const abrir = async (enCurso: string | null, deLaDireccion: string | null) => {
  const { getTreatmentCardContextForPatient } = await import("@/app/actions/orthodontics/getTreatmentCardContextForPatient");
  const r = await getTreatmentCardContextForPatient("plan", enCurso, deLaDireccion);
  assert.equal(r.ok, true);
  return construidaCon;
};

test("P0155: ficha con ?appointment=<cita del 6-oct> y el paciente sin llegar → la hoja nace con ESA cita (para avisar)", async () => {
  assert.equal((await abrir(null, "futura"))?.id, "futura");
});

test("sin la cita de la dirección se sigue como antes: no hay cita de hoy → hoja sin cita", async () => {
  assert.equal(await abrir(null, null), null);
});

test("la cita de la dirección ya atendida o cancelada no se usa", async () => {
  citas[0].status = "COMPLETED";
  assert.equal(await abrir(null, "futura"), null);
  citas[0].status = "CANCELLED";
  assert.equal(await abrir(null, "futura"), null);
});

test("una cita futura con el paciente presente sigue siendo la de la consulta en curso (adelantada)", async () => {
  citas[0].status = "IN_PROGRESS";
  assert.equal((await abrir("futura", "futura"))?.id, "futura");
});

test("la cita de la dirección de OTRO paciente no se toma", async () => {
  citas[0].patientId = "otro";
  assert.equal(await abrir(null, "futura"), null);
});

test("la ficha manda la cita de la dirección a la pestaña, y la hoja y la firma ya avisan con ella", () => {
  const SRC = join(__dirname, "..", "..", "..");
  const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
  assert.match(leer("app/dashboard/patients/[id]/patient-detail-client.tsx"), /citaDeLaDireccionId=\{consultClosed \? null : consultAppointmentId\}/);
  assert.match(leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"), /citaDeLaDireccionId=\{citaDeLaDireccionId \?\? null\}/);
  assert.match(
    leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx"),
    /getTreatmentCardContextForPatient\(t\.treatmentPlanId, props\.citaEnCursoId \?\? null, props\.citaDeLaDireccionId \?\? null\)/,
  );
  // El aviso del cajón (antes de firmar) y el de después de firmar ya existían; ahora les llega la cita.
  assert.match(leer("components/specialties/orthodontics/redesign/drawers/DrawerTreatmentCard.tsx"), /textosFirma\.citaDeOtroDia\(decisionCita\.diaDeLaCita\)/);
  assert.match(leer("components/specialties/orthodontics/redesign/OrthodonticsPatientTab.tsx"), /textosFirma\.firmadaSinTocarCita\(res\.data\.citaDeOtroDiaSinTocar\)/);
  // La hoja a continuar es la de HOY cuando la visita es de hoy (no la del día de la cita futura).
  assert.match(leer("lib/orthodontics/treatment-card-context.ts"), /tarjetaDeControlDeHoy\(cards, clinicTimezone, appt && !visitaHoy \? appt\.startsAt : new Date\(\)\)/);
});
