/**
 * ws1-t11 · lead 12 (auditoría run-2) — la ficha del paciente y las páginas de
 * especialidad NO cargan lo clínico sin «Ver expediente clínico».
 *
 * Run: npm run test:guardia-clinica-paginas
 *
 * El hallazgo: la regla de guardia-clinica.ts (lo clínico pide SIEMPRE
 * medicalRecord.view, con el override por persona) se aplicó en src/app/api y
 * src/app/actions, pero las páginas server de /dashboard llamaban a los
 * cargadores de pediatría, periodoncia, endodoncia e implantes con solo la
 * categoría y el módulo. Lo cargado viaja en el payload RSC aunque la pestaña
 * no se pinte: recepción, solo lectura y a quien le quitaron el permiso lo
 * recibían.
 *
 * Se ejecutan las páginas REALES con sus imports doblados (ver
 * _arnes-paginas-server.ts) y la regla de permisos REAL; se mira qué
 * cargadores clínicos corren y qué recibe el componente de cliente.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  preparar, respuestas, llamadas, llamo, propsDe, exportado, prismaFalso, Redireccion, NoEncontrado,
} from "./_arnes-paginas-server";

const FICHA = "src/app/dashboard/patients/[id]/page.tsx";
const DETALLE = (m: string) => `src/app/dashboard/specialties/${m}/[patientId]/page.tsx`;
const LISTA = (m: string) => `src/app/dashboard/specialties/${m}/page.tsx`;
const MODULOS = ["implants", "periodontics", "pediatrics", "endodontics"] as const;

const prisma = prismaFalso();
preparar({
  paginas: [FICHA, ...MODULOS.map(DETALLE), ...MODULOS.map(LISTA)],
  reales: [
    "@/lib/auth/permissions",
    "@/lib/auth/guardia-clinica",
    "@/lib/specialties/keys",
    "@/lib/implants/permissions",
    "@/lib/pediatrics/permissions",
    "@/lib/pediatrics/age",
  ],
  fijos: {
    "@/lib/prisma": { prisma },
    "next/navigation": {
      redirect: (d: string) => { throw new Redireccion(d); },
      notFound: () => { throw new NoEncontrado(); },
    },
  },
});

interface Usuario { id: string; clinicId: string; role: string; permissionsOverride: string[]; clinic: Record<string, unknown> }
let usuario: Usuario;
function como(role: string, permissionsOverride: string[] = []) {
  usuario = {
    id: "u1", clinicId: "cli_a", role, permissionsOverride,
    clinic: { id: "cli_a", category: "DENTAL", timezone: "America/Mexico_City", trialEndsAt: null, subscriptionStatus: "active" },
  };
}

const NINO = { id: "p1", firstName: "Ana", lastName: "Paz", dob: new Date(Date.now() - 8 * 365 * 86_400_000) };

beforeEach(() => {
  llamadas.length = 0;
  respuestas.clear();
  respuestas.set("@/lib/auth#getCurrentUser", async () => usuario);
  respuestas.set("@/i18n/server#getServerT", async () => ({ t: (k: string) => k, locale: "es" }));
  respuestas.set("@/lib/marketplace/access-control#canAccessModule", async () => ({ hasAccess: true }));
  respuestas.set("@/lib/clinical-shared/get-active-clinic-modules#getActiveClinicModuleKeys", async () =>
    ["implants", "periodontics", "pediatric-dentistry", "endodontics"]);
  respuestas.set("@/lib/branches#getPatientVisibility", async () => ({ clinicIds: ["cli_a"], otherClinicNames: {} }));
  respuestas.set("prisma.patient.findFirst", () => ({
    ...NINO, clinicId: "cli_a", appointments: [], records: [], invoices: [], treatments: [], primaryDoctor: null, visibleUserIds: [],
  }));
  respuestas.set("@/lib/periodontics/load-data#loadPerioData", async () => ({ patientId: "p1", patientName: "Ana Paz", recordId: null }));
  respuestas.set("@/lib/pediatrics/load-data#loadPediatricsData", async () => ({ patientId: "p1", patientName: "Ana Paz", patientDob: NINO.dob }));
  respuestas.set("@/lib/helpers/loadEndoToothData#loadEndoToothSummaries", async () => []);
  respuestas.set("@/lib/endodontics/load-soap-prefill#loadEndoSoapPrefill", async () => null);
});

async function correr(pagina: string, props: Record<string, unknown>) {
  const mod = await import(`../../../../${pagina}`);
  try {
    return { arbol: await mod.default(props), error: null as unknown };
  } catch (e) {
    return { arbol: null, error: e };
  }
}

const CARGADORES_FICHA = [
  "@/lib/pediatrics/load-data#loadPediatricsData",
  "@/lib/periodontics/load-data#loadPerioData",
  "@/lib/helpers/loadEndoToothData#loadEndoToothSummaries",
  "@/lib/endodontics/load-soap-prefill#loadEndoSoapPrefill",
  "prisma.implant.findMany",
];

const SIN_EXPEDIENTE: Array<[string, string, string[]]> = [
  ["recepción (default)", "RECEPTIONIST", []],
  ["solo lectura", "READONLY", []],
  ["doctor al que le quitaron «Ver expediente clínico»", "DOCTOR", ["agenda.view", "patients.view", "specialties.implants", "specialties.periodontics", "specialties.pediatrics", "specialties.endodontics"]],
];

// ══════════════════ la ficha del paciente ══════════════════

for (const [quien, rol, override] of SIN_EXPEDIENTE) {
  test(`ficha del paciente · ${quien}: no corre ningún cargador clínico de especialidad y el cliente recibe null`, async () => {
    como(rol, override);
    const { arbol, error } = await correr(FICHA, { params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) });
    assert.equal(error, null, `la ficha debe abrirse (contacto, citas, cobros): ${String(error)}`);
    for (const c of CARGADORES_FICHA) assert.equal(llamo(c), false, `${c} no debe correr para ${quien}`);
    const [p] = propsDe(arbol, exportado("./patient-detail-client", "PatientDetailClient"));
    assert.ok(p, "la ficha pinta PatientDetailClient");
    for (const k of ["pediatricsData", "perioData", "endoSummaries", "endoSoapPrefill", "implants"]) {
      assert.equal(p[k] ?? null, null, `${k} viaja en el payload RSC para ${quien}`);
    }
    assert.equal(p.pediatricsModuleActive, false, "la pestaña de Pediatría no se ofrece (ni desactivada) sin el permiso");
  });
}

test("ficha del paciente · doctor con el permiso: los cargadores siguen corriendo como siempre", async () => {
  como("DOCTOR");
  const { error } = await correr(FICHA, { params: Promise.resolve({ id: "p1" }), searchParams: Promise.resolve({}) });
  assert.equal(error, null, String(error));
  for (const c of CARGADORES_FICHA) assert.equal(llamo(c), true, `${c} debe correr para un doctor`);
});

// ══════════════════ páginas de especialidad: detalle y lista ══════════════════

const CLINICO_DETALLE: Record<(typeof MODULOS)[number], string[]> = {
  implants: ["prisma.implant.findMany"],
  periodontics: ["@/lib/periodontics/load-data#loadPerioData"],
  pediatrics: ["@/lib/pediatrics/load-data#loadPediatricsData"],
  endodontics: ["@/lib/helpers/loadEndoToothData#loadEndoToothSummaries", "@/lib/helpers/loadEndoToothData#loadEndoToothData"],
};
const CLINICO_LISTA: Record<(typeof MODULOS)[number], string[]> = {
  implants: ["@/lib/implants/load-patients#loadImplantPatients", "prisma.implantFollowUp.findMany", "prisma.implantComplication.findMany"],
  periodontics: ["@/lib/periodontics/load-patients#loadPeriodonticPatients"],
  pediatrics: ["@/lib/pediatrics/load-patients#loadPediatricPatients"],
  endodontics: ["@/lib/endodontics/load-patients#loadEndodonticPatients", "prisma.endodonticTreatment.findMany", "prisma.endodonticFollowUp.findMany"],
};

for (const m of MODULOS) {
  for (const [quien, rol, override] of SIN_EXPEDIENTE) {
    test(`/dashboard/specialties/${m}/[patientId] · ${quien}: no carga lo clínico`, async () => {
      como(rol, override);
      await correr(DETALLE(m), { params: Promise.resolve({ patientId: "p1" }), searchParams: Promise.resolve({ tooth: "11" }) });
      for (const c of CLINICO_DETALLE[m]) assert.equal(llamo(c), false, `${c} corrió para ${quien}`);
    });
    test(`/dashboard/specialties/${m} (lista) · ${quien}: no carga lo clínico`, async () => {
      como(rol, override);
      await correr(LISTA(m), {});
      for (const c of CLINICO_LISTA[m]) assert.equal(llamo(c), false, `${c} corrió para ${quien}`);
    });
  }
  test(`/dashboard/specialties/${m}/[patientId] · doctor con el permiso: carga como siempre`, async () => {
    como("DOCTOR");
    await correr(DETALLE(m), { params: Promise.resolve({ patientId: "p1" }), searchParams: Promise.resolve({ tooth: "11" }) });
    assert.ok(CLINICO_DETALLE[m].some(llamo), `ningún cargador de ${m} corrió para el doctor`);
  });
  test(`/dashboard/specialties/${m} (lista) · doctor con el permiso: carga como siempre`, async () => {
    como("DOCTOR");
    await correr(LISTA(m), {});
    assert.ok(CLINICO_LISTA[m].some(llamo), `ningún cargador de la lista de ${m} corrió para el doctor`);
  });
}
