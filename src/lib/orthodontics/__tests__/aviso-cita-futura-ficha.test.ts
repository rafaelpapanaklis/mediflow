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

type Cita = { id: string; clinicId: string; patientId: string; type: string; status: string; startsAt: Date; endsAt: Date; doctorId?: string | null };
let citas: Cita[] = [];
let construidaCon: { id: string } | null | undefined;
let ligadaCon: string | null | undefined;
let sesion = { clinicId: "c1", userId: "u1", role: "DOCTOR" };
type Hoja = { id: string; clinicId: string; treatmentPlanId: string; status: string; appointmentId: string | null; visitDate: Date };
let hojas: Hoja[] = [];

const enRango = (d: Date, r?: { gte: Date; lt: Date }) => !r || (d >= r.gte && d < r.lt);
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: { findFirst: async () => ({ id: "plan", clinicId: "c1", patientId: "p1" }) },
      clinic: { findUnique: async () => ({ timezone: "America/Mexico_City" }) },
      orthoTreatmentCard: {
        findFirst: async ({ where }: { where: { clinicId: string; appointmentId: string } }) =>
          hojas.find((h) => h.clinicId === where.clinicId && h.appointmentId === where.appointmentId) ?? null,
        findMany: async ({ where }: { where: { clinicId: string; treatmentPlanId: { in: string[] }; status: string; appointmentId: null; visitDate: { gte: Date; lt: Date } } }) =>
          hojas.filter(
            (h) =>
              h.clinicId === where.clinicId &&
              where.treatmentPlanId.in.includes(h.treatmentPlanId) &&
              h.status === where.status &&
              h.appointmentId === where.appointmentId &&
              enRango(h.visitDate, where.visitDate),
          ),
      },
      appointment: {
        findMany: async ({ where }: { where: { clinicId: string; patientId: string; status?: { notIn?: string[] }; startsAt?: { gte: Date; lt: Date } } }) =>
          citas
            .filter(
              (c) =>
                c.clinicId === where.clinicId &&
                c.patientId === where.patientId &&
                (!where.status?.notIn || !where.status.notIn.includes(c.status)) &&
                enRango(c.startsAt, where.startsAt),
            )
            .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
        findFirst: async ({ where }: { where: { id?: string; clinicId: string; patientId: string; status?: { in?: string[]; notIn?: string[] }; startsAt?: { gte: Date; lt: Date } } }) =>
          citas
            .filter(
              (c) =>
                (!where.id || c.id === where.id) &&
                c.clinicId === where.clinicId &&
                (!where.patientId || c.patientId === where.patientId) &&
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
    getOrthoActionContext: async () => ({ ok: true, data: { ctx: sesion } }),
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

mock.module("@/lib/orthodontics/ligar-hoja-firmada-db", {
  namedExports: {
    ligarHojaFirmadaDeHoyALaCita: async (a: { cita: { id: string } }) => {
      ligadaCon = a.cita.id;
      return { cardId: "hoja", citaCerrada: a.cita.id };
    },
  },
});

// La acción usa el reloj real: la cita «futura» se fecha 4 días después de ahora.
const DIA = 24 * 3600 * 1000;
const ahora = Date.now();
beforeEach(() => {
  hojas = [];
  construidaCon = undefined;
  ligadaCon = undefined;
  sesion = { clinicId: "c1", userId: "u1", role: "DOCTOR" };
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

// ═══ Revisión final de ws1-t9, fallo nuevo 2 ═══════════════════════════════════════════════════════════════
// P0147: hoy 14:00 con la Dra. Cortés y 15:00 con el doctor en sesión (u1). La ficha abierta con
// `?appointment=<15:00>` → «Ver el control de hoy (firmado)» ligaba y COMPLETABA la de 14:00 (la primera del día,
// de otra doctora) y la de 15:00 seguía «Agendada».
const diaMx = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const p0147 = (): Cita[] => [
  { id: "14h-cortes", clinicId: "c1", patientId: "p1", type: "Control de ortodoncia", status: "SCHEDULED", startsAt: new Date(`${diaMx}T20:00:00Z`), endsAt: new Date(`${diaMx}T20:30:00Z`), doctorId: "cortes" },
  { id: "15h-mia", clinicId: "c1", patientId: "p1", type: "Control de ortodoncia", status: "SCHEDULED", startsAt: new Date(`${diaMx}T21:00:00Z`), endsAt: new Date(`${diaMx}T21:30:00Z`), doctorId: "u1" },
];
const ligar = async (citaId: string | null) => {
  const { ligarControlFirmadoDeHoy } = await import("@/app/actions/orthodontics/ligarControlFirmadoDeHoy");
  const r = await ligarControlFirmadoDeHoy("plan", citaId);
  assert.equal(r.ok, true);
  return ligadaCon ?? null;
};

test("fallo nuevo 2: la ficha manda a «Ver el control de hoy (firmado)» la cita de la dirección, no solo la de la consulta en curso", () => {
  const SRC = join(__dirname, "..", "..", "..");
  assert.match(
    readFileSync(join(SRC, "components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx"), "utf8"),
    /ligarControlFirmadoDeHoy\(t\.treatmentPlanId, props\.citaEnCursoId \?\? props\.citaDeLaDireccionId \?\? null\)/,
  );
});

test("fallo nuevo 2 (P0147): abierta desde la de 15:00, la hoja firmada se liga a la de 15:00", async () => {
  citas = p0147();
  assert.equal(await ligar("15h-mia"), "15h-mia");
});

test("fallo nuevo 2: sin cita de origen, el doctor liga la primera SUYA del día, no la de 14:00 de la Dra. Cortés", async () => {
  citas = p0147();
  assert.equal(await ligar(null), "15h-mia");
});

test("fallo nuevo 2: abierta desde la cita de OTRO doctor, no se liga a ninguna (ni a esa ni a la suya en su lugar)", async () => {
  citas = p0147();
  assert.equal(await ligar("14h-cortes"), null);
});

test("fallo nuevo 2: un ADMIN sí puede ligar la de cualquier doctor, y respeta la cita de origen", async () => {
  sesion = { clinicId: "c1", userId: "admin", role: "ADMIN" };
  citas = p0147();
  assert.equal(await ligar("15h-mia"), "15h-mia");
  ligadaCon = undefined;
  assert.equal(await ligar(null), "14h-cortes");
});

test("fallo nuevo 2: la cita de origen ya atendida o de otro día no se cambia por otra de hoy", async () => {
  citas = p0147();
  citas[1].status = "COMPLETED";
  assert.equal(await ligar("15h-mia"), null);
  citas = [...p0147(), { id: "futura", clinicId: "c1", patientId: "p1", type: "Control de ortodoncia", status: "SCHEDULED", startsAt: new Date(ahora + 4 * DIA), endsAt: new Date(ahora + 4 * DIA + 1800000), doctorId: "u1" }];
  assert.equal(await ligar("futura"), null);
});

test("fallo nuevo 2: una hoja NUEVA abierta desde la de 15:00 nace con la de 15:00, no con la primera del día", async () => {
  citas = p0147();
  assert.equal((await abrir(null, "15h-mia"))?.id, "15h-mia");
  assert.equal((await abrir(null, null))?.id, "15h-mia", "sin dirección, la primera de control del doctor en sesión");
  assert.equal(await abrir(null, "14h-cortes"), null, "la de otro doctor no se toma");
});

// ═══ Revisión final de ws1-t9, fallo nuevo 4 ═══════════════════════════════════════════════════════════════
// «Registrar control» salía en filas ya «Completadas» con la hoja firmada (Carla, Beto, Dario, R4…) en Hoy y en
// el módulo; al pulsarlo abría la hoja firmada. Ahora el botón sabe si el control de esa cita ya está firmado.
const hojaFirmada = (h: Partial<Hoja>): Hoja => ({ id: "h", clinicId: "c1", treatmentPlanId: "plan", status: "SIGNED", appointmentId: null, visitDate: new Date(), ...h });
const firmadaDeLaCita = async (appointmentId: string) => {
  const { hojaFirmadaDeLaCita } = await import("@/lib/orthodontics/hoja-firmada-de-la-cita-db");
  return hojaFirmadaDeLaCita({ clinicId: "c1", appointmentId, planId: "plan", zona: "America/Mexico_City" });
};

test("fallo nuevo 4: la cita con su hoja FIRMADA ligada → «Ver control»; con la hoja en borrador, no", async () => {
  citas = p0147();
  hojas = [hojaFirmada({ appointmentId: "15h-mia" })];
  assert.equal(await firmadaDeLaCita("15h-mia"), true);
  hojas = [hojaFirmada({ appointmentId: "15h-mia", status: "DRAFT" })];
  assert.equal(await firmadaDeLaCita("15h-mia"), false);
});

test("fallo nuevo 4: la cita de HOY sin hoja ligada pero con la de hoy firmada «sin cita» del caso → «Ver control»", async () => {
  citas = p0147();
  hojas = [hojaFirmada({})];
  assert.equal(await firmadaDeLaCita("15h-mia"), true);
  // De otro caso, o de otro día, no cuenta.
  hojas = [hojaFirmada({ treatmentPlanId: "otro-caso" })];
  assert.equal(await firmadaDeLaCita("15h-mia"), false);
  hojas = [hojaFirmada({ visitDate: new Date(ahora - 3 * DIA) })];
  assert.equal(await firmadaDeLaCita("15h-mia"), false);
  // Una cita FUTURA no se da por hecha con la hoja de hoy.
  citas = [...p0147(), { id: "futura", clinicId: "c1", patientId: "p1", type: "Control de ortodoncia", status: "SCHEDULED", startsAt: new Date(ahora + 4 * DIA), endsAt: new Date(ahora + 4 * DIA + 1800000) }];
  hojas = [hojaFirmada({})];
  assert.equal(await firmadaDeLaCita("futura"), false);
  // Sin ninguna hoja: «Registrar control» como siempre.
  hojas = [];
  assert.equal(await firmadaDeLaCita("15h-mia"), false);
});

test("fallo nuevo 4: Hoy, el panel de la cita, Tablero y Controles le dicen al botón que la hoja ya está firmada", async () => {
  const SRC = join(__dirname, "..", "..", "..");
  const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
  const boton = leer("components/specialties/orthodontics/agenda/BotonHojaControl.tsx");
  assert.match(boton, /firmada \? textosFirma\.verControl : "Registrar control"/);
  const fila = leer("components/specialties/orthodontics/agenda/RegistrarControlEnFila.tsx");
  assert.match(fila, /getTreatmentPlanIdForAppointment\(patientId, appointmentId\)/);
  assert.match(fila, /firmada=\{state\.hojaFirmada\}/);
  const ranura = leer("components/specialties/orthodontics/agenda/RanuraCita.tsx");
  assert.match(ranura, /getTreatmentPlanIdForAppointment\(dto\.patient\.id, dto\.id\)/);
  assert.match(ranura, /firmada=\{state\.hojaFirmada\}/);
  assert.match(leer("components/specialties/orthodontics/modulo/vista-tablero.tsx"), /firmada=\{c\.hojaFirmadaSinCita\}/);
  assert.match(leer("components/specialties/orthodontics/modulo/vista-controles.tsx"), /firmada=\{cita\.hojaFirmadaSinCita\}/);
  assert.match(leer("lib/orthodontics/tablero-data.ts"), /hojaFirmadaSinCita: !card && firmadasSinCita\.has\(/);
  assert.match(leer("lib/orthodontics/controles-data.ts"), /firmadasSinCita\.has\(planIdPorPaciente\.get\(c\.patientId\)/);
  const { resolverEstadoRanuraCita } = await import("@/components/specialties/orthodontics/agenda/ranura-cita-estado");
  assert.equal(resolverEstadoRanuraCita({ ok: true, data: { treatmentPlanId: "plan", canOpenClinicalCard: true, hojaFirmada: true } }).hojaFirmada, true);
  assert.equal(resolverEstadoRanuraCita({ ok: true, data: { treatmentPlanId: "plan", canOpenClinicalCard: true } }).hojaFirmada, false);
});
