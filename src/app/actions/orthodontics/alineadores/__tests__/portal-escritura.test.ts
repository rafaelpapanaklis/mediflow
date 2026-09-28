/**
 * Ortodoncia — lo que el PACIENTE escribe desde su portal (ws1-t5, ronda 6:
 * hallazgo 95 y fila 16 del mapa de la revisión de lógica de uso).
 *
 *   · El día del registro lo decide el servidor con la hora de la CLÍNICA:
 *     lo que mande el navegador se ignora.
 *   · Un caso terminado, cerrado, o de una clínica con el módulo apagado no
 *     acepta registros ni fotos.
 *   · Un caso de otro paciente o de otra clínica no se toca, y ni siquiera se
 *     pregunta por el módulo.
 *
 * Necesita --experimental-test-module-mocks.
 * Run: npx tsx --test --experimental-test-module-mocks src/app/actions/orthodontics/alineadores/__tests__/portal-escritura.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

interface Plan {
  id: string;
  clinicId: string;
  patientId: string;
  deletedAt: Date | null;
  status: string;
  clinic: { timezone: string };
}

let sesion: { account: { id: string }; links: Array<{ patientId: string; clinicId: string }> } | null = null;
let plan: Plan | null = null;
let moduloActivo = true;
let preguntasPorModulo: string[] = [];
let registros: Array<{ where: { treatmentPlanId_logDate: { logDate: Date } }; create: Record<string, unknown> }> = [];
let fotos: Array<{ data: Record<string, unknown> }> = [];

mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      orthodonticTreatmentPlan: { findUnique: async () => plan },
      orthodonticElasticsLog: {
        upsert: async (args: (typeof registros)[number]) => {
          registros.push(args);
          return { id: "log-1" };
        },
      },
      orthodonticMonitoringPhoto: {
        create: async (args: (typeof fotos)[number]) => {
          fotos.push(args);
          return { id: "foto-1" };
        },
      },
    },
  },
});

mock.module("@/lib/patient-portal/guard", {
  namedExports: { getPatientPortalContext: async () => sesion },
});

mock.module("@/lib/orthodontics/access", {
  namedExports: {
    hasActiveOrthodonticsModule: async (clinicId: string) => {
      preguntasPorModulo.push(clinicId);
      return moduloActivo;
    },
  },
});

function preparar(opts: { estado?: string; modulo?: boolean; zona?: string; vinculo?: { patientId: string; clinicId: string } } = {}) {
  sesion = { account: { id: "cuenta-1" }, links: [opts.vinculo ?? { patientId: "ana", clinicId: "norte" }] };
  plan = {
    id: "plan-1",
    clinicId: "norte",
    patientId: "ana",
    deletedAt: null,
    status: opts.estado ?? "IN_PROGRESS",
    clinic: { timezone: opts.zona ?? "America/Mexico_City" },
  };
  moduloActivo = opts.modulo ?? true;
  preguntasPorModulo = [];
  registros = [];
  fotos = [];
}

/** El día que es AHORA en una zona, calculado aparte del código que se prueba. */
function hoyEn(zona: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

const FOTO = {
  treatmentPlanId: "plan-1",
  storageKey: "norte/ana/ortho-monitoreo/abc.jpg",
  angle: "FRONTAL" as const,
};

test("95 · el día lo pone el servidor en la hora de la clínica; lo que mande el navegador se ignora", async () => {
  // Honolulu va entre 15 y 16 horas detrás de Kiritimati: nunca comparten día
  // más que un rato, así que una de las dos SIEMPRE difiere del día en UTC.
  for (const zona of ["Pacific/Honolulu", "Pacific/Kiritimati", "America/Mexico_City"]) {
    preparar({ zona });
    const { logElasticsComplianceFromPortal } = await import("../logElasticsComplianceFromPortal");
    const res = await logElasticsComplianceFromPortal({
      treatmentPlanId: "plan-1",
      logDate: "1999-01-01",
      usedElastics: true,
      wornHours: 20,
    });
    assert.equal(res.ok, true, zona);
    assert.equal(registros.length, 1, zona);
    const guardado = registros[0]!.where.treatmentPlanId_logDate.logDate;
    assert.equal(guardado.toISOString(), `${hoyEn(zona)}T00:00:00.000Z`, zona);
    assert.equal(registros[0]!.create.patientId, "ana");
    assert.equal(registros[0]!.create.clinicId, "norte");
    assert.equal(registros[0]!.create.source, "PATIENT_PORTAL");
  }
});

test("95 · horas imposibles se rechazan sin tocar la base", async () => {
  preparar();
  const { logElasticsComplianceFromPortal } = await import("../logElasticsComplianceFromPortal");
  for (const wornHours of [-1, 25, Number.NaN, Number.POSITIVE_INFINITY]) {
    const res = await logElasticsComplianceFromPortal({ treatmentPlanId: "plan-1", usedElastics: true, wornHours });
    assert.equal(res.ok, false, String(wornHours));
  }
  assert.equal(registros.length, 0);
});

test("16 · un caso terminado o cerrado no acepta registros ni fotos", async () => {
  const { logElasticsComplianceFromPortal } = await import("../logElasticsComplianceFromPortal");
  const { submitMonitoringPhoto } = await import("../submitMonitoringPhoto");
  for (const estado of ["COMPLETED", "DROPPED_OUT"]) {
    preparar({ estado });
    const registro = await logElasticsComplianceFromPortal({ treatmentPlanId: "plan-1", usedElastics: true });
    const foto = await submitMonitoringPhoto(FOTO);
    assert.equal(registro.ok, false, estado);
    assert.equal(foto.ok, false, estado);
    assert.equal(registros.length, 0, estado);
    assert.equal(fotos.length, 0, estado);
  }
});

test("16 · decisión 3: con el módulo apagado tampoco se escribe, y el mensaje no asusta", async () => {
  preparar({ modulo: false });
  const { submitMonitoringPhoto } = await import("../submitMonitoringPhoto");
  const res = await submitMonitoringPhoto(FOTO);
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.error : "", /sigue disponible/);
  assert.equal(fotos.length, 0);
});

test("16 · un caso abierto con el módulo activo sí guarda la foto, pendiente de revisar", async () => {
  for (const estado of ["PLANNED", "IN_PROGRESS", "ON_HOLD", "RETENTION"]) {
    preparar({ estado });
    const { submitMonitoringPhoto } = await import("../submitMonitoringPhoto");
    const res = await submitMonitoringPhoto(FOTO);
    assert.equal(res.ok, true, estado);
    assert.equal(fotos.length, 1, estado);
    assert.equal(fotos[0]!.data.reviewStatus, "PENDING");
    assert.equal(fotos[0]!.data.clinicId, "norte");
    assert.equal(fotos[0]!.data.patientId, "ana");
  }
});

test("seguridad · el caso de otro paciente no se toca, y ni se pregunta por el módulo", async () => {
  preparar({ vinculo: { patientId: "otro", clinicId: "norte" } });
  const { logElasticsComplianceFromPortal } = await import("../logElasticsComplianceFromPortal");
  const res = await logElasticsComplianceFromPortal({ treatmentPlanId: "plan-1", usedElastics: true });
  assert.deepEqual(res, { ok: false, error: "Sin acceso a este caso" });
  assert.equal(registros.length, 0);
  assert.deepEqual(preguntasPorModulo, []);
});

test("seguridad · mismo paciente pero vínculo de OTRA clínica: sin acceso", async () => {
  preparar({ vinculo: { patientId: "ana", clinicId: "sur" } });
  const { submitMonitoringPhoto } = await import("../submitMonitoringPhoto");
  const res = await submitMonitoringPhoto(FOTO);
  assert.deepEqual(res, { ok: false, error: "Sin acceso a este caso" });
  assert.equal(fotos.length, 0);
});

test("seguridad · una foto con la llave de otro paciente se rechaza aunque el caso sea suyo", async () => {
  preparar();
  const { submitMonitoringPhoto } = await import("../submitMonitoringPhoto");
  const res = await submitMonitoringPhoto({ ...FOTO, storageKey: "norte/luis/ortho-monitoreo/abc.jpg" });
  assert.deepEqual(res, { ok: false, error: "Foto inválida" });
  assert.equal(fotos.length, 0);
});

test("sin sesión de paciente no se escribe nada", async () => {
  preparar();
  sesion = null;
  const { logElasticsComplianceFromPortal } = await import("../logElasticsComplianceFromPortal");
  const res = await logElasticsComplianceFromPortal({ treatmentPlanId: "plan-1", usedElastics: false });
  assert.deepEqual(res, { ok: false, error: "No autenticado" });
  assert.equal(registros.length, 0);
});
