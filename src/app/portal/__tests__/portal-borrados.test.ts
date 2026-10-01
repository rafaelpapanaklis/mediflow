/**
 * M8 (auditoría 30-sep-2026) — el portal por liga (`/portal/[token]`) no muestra
 * lo que la clínica ya borró ni a un paciente archivado.
 *
 * La base falsa APLICA los `where` que recibe (paciente, archivos, consentimientos):
 * con la página vieja, que no los pedía, los borrados salían igual.
 *
 * Run: npm run test:seguridad-rapidos
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let pacientes: any[];
let firmadas: string[];

beforeEach(() => {
  firmadas = [];
  const base = {
    id: "p1", firstName: "Ana", lastName: "Pérez", patientNumber: 1, email: null, phone: null, dob: null,
    bloodType: null, allergies: null, chronicConditions: null, portalToken: "tok", portalTokenExpiry: null,
    deletedAt: null as Date | null,
    clinic: { id: "c1", name: "C", logoUrl: null, phone: null, specialty: "x", address: null, city: null, timezone: "America/Mexico_City" },
    appointments: [], records: [], invoices: [],
    files: [
      { id: "f-viva", name: "ok.jpg", url: "u-viva", category: "x", mimeType: "image/jpeg", createdAt: new Date(), notes: null, takenAt: null, deletedAt: null },
      { id: "f-borrada", name: "radiografia-de-otro.jpg", url: "u-borrada", category: "x", mimeType: "image/jpeg", createdAt: new Date(), notes: null, takenAt: null, deletedAt: new Date() },
    ],
    consentForms: [
      { id: "c-viva", procedure: "A", signedAt: null, expiresAt: new Date(), signatureUrl: "s-viva", content: "x", deletedAt: null },
      { id: "c-borrada", procedure: "B", signedAt: null, expiresAt: new Date(), signatureUrl: "s-borrada", content: "x", deletedAt: new Date() },
    ],
  };
  pacientes = [base];
});

/** Aplica un `where: { deletedAt: null }` (lo único que la página puede pedir aquí). */
const aplica = (rows: any[], where: any) =>
  where?.deletedAt === null ? rows.filter((r) => r.deletedAt === null) : rows;

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      patient: {
        findFirst: async ({ where, select }: any) => {
          const p = pacientes.find((x) => x.portalToken === where.portalToken && (where.deletedAt !== null || x.deletedAt === null));
          if (!p) return null;
          return {
            ...p,
            files: aplica(p.files, select.files?.where),
            consentForms: aplica(p.consentForms, select.consentForms?.where),
          };
        },
      },
      orthoTreatmentCard: { findMany: async () => [] },
    },
  },
});
(mock as any).module("@/lib/storage", {
  namedExports: { signMaybeUrls: async (urls: any[]) => { firmadas = urls.slice(); return urls.map((u) => `firmada:${u}`); } },
});
(mock as any).module("next/navigation", { namedExports: { notFound: () => { throw new Error("NEXT_NOT_FOUND"); } } });
(mock as any).module("@/app/portal/[token]/portal-client", { namedExports: { PatientPortalClient: () => null } });

async function abrir() {
  const { default: Pagina } = await import("@/app/portal/[token]/page");
  return Pagina({ params: { token: "tok" } }) as Promise<any>;
}

test("los archivos y consentimientos que la clínica borró no salen ni se firman", async () => {
  const el = await abrir();
  const p = el.props.patient;
  assert.deepEqual(p.files.map((f: any) => f.id), ["f-viva"]);
  assert.deepEqual(p.consentForms.map((c: any) => c.id), ["c-viva"]);
  assert.ok(!firmadas.some((u) => u.includes("borrada")), "ni siquiera se firma una URL de lo borrado");
  assert.ok(!JSON.stringify(p).includes("radiografia-de-otro"));
});

test("un paciente archivado (deletedAt) es 404, como su API gemela", async () => {
  pacientes[0].deletedAt = new Date();
  await assert.rejects(abrir, /NEXT_NOT_FOUND/);
});
