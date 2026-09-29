/**
 * GET /api/patients/[id]/movimientos — la puerta de «Movimientos Completo».
 *
 * Ejecuta el route handler de verdad con Prisma, la sesión, la visibilidad y las
 * sedes sustituidos. Lo que tiene que ser verdad:
 *  1. rol sin acceso → 403; sin clínica en la sesión → 403 y NO se consulta;
 *  2. paciente no visible → el 404 de `assertPatientVisible`, sin consultar;
 *  3. las sedes salen de la sesión, jamás de la URL;
 *  4. quien no tiene «medicalRecord.view» ni «billing.view» NO recibe el texto
 *     verdadero de lo clínico ni de lo económico (el enmascarado es del servidor);
 *  5. CSV y PDF salen con su tipo, y cada descarga deja su lectura en la bitácora.
 *
 * Corre con: npm run test:movimientos-paciente
 */
import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

let usuario: any;
let visibilidad: NextResponse | null;
let sedes: string[];
let consultas: Array<{ sql: string; values: unknown[] }> = [];
let bitacora: Array<Record<string, any>> = [];
let filas: any[] = [];

mock.module("@/lib/auth", { namedExports: { getCurrentUser: async () => usuario } });
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => visibilidad } });
mock.module("@/lib/branches", { namedExports: { getVisiblePatientClinicIds: async (id: string) => (sedes.length ? sedes : [id]) } });
mock.module("@/lib/pediatrics/audit", { namedExports: { PEDIATRIC_AUDIT_ACTIONS: [] } });
mock.module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: { findUnique: async () => ({ timezone: "America/Tijuana" }) },
      patient: {
        findFirst: async () => ({ firstName: "Laura", lastName: "Méndez", patientNumber: "P-0042", clinic: { timezone: "America/Mexico_City" } }),
      },
      auditLog: {
        create: async (a: { data: Record<string, any> }) => {
          bitacora.push(a.data);
          return { id: "log" };
        },
      },
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
        const q = Prisma.sql(strings, ...values);
        consultas.push({ sql: q.sql, values: q.values as unknown[] });
        return Promise.resolve(/COUNT\(\*\)/.test(q.sql) ? [{ n: BigInt(filas.length) }] : filas);
      },
    },
  },
});

const cruda = (o: any) => ({
  id: "l1",
  entityType: "appointment",
  entityId: "a1",
  action: "create",
  changes: null,
  createdAt: new Date("2026-10-03T16:00:00.000Z"),
  actorType: "staff",
  firstName: "Ana",
  lastName: "Pérez",
  ...o,
});

function pedir(qs = "") {
  return new NextRequest(`http://localhost/api/patients/pat_1/movimientos${qs}`, { headers: { "user-agent": "UA" } });
}
async function GET(qs = "") {
  const { GET: handler } = await import("../[id]/movimientos/route");
  return handler(pedir(qs), { params: { id: "pat_1" } });
}
const DOCTOR = { id: "u1", role: "DOCTOR", clinicId: "cli_1", permissionsOverride: [] as string[] };

describe("GET /api/patients/[id]/movimientos", () => {
  beforeEach(() => {
    usuario = { ...DOCTOR };
    visibilidad = null;
    sedes = [];
    consultas = [];
    bitacora = [];
    filas = [
      cruda({ id: "1", entityType: "record", changes: { _mov: { after: { texto: "Creó una nota de consulta" } } } }),
      cruda({ id: "2", entityType: "invoice", action: "update", changes: { _mov: { after: { texto: "Registró un pago de $500.00" } } } }),
      cruda({ id: "3", entityType: "appointment", changes: { _mov: { after: { texto: "Agendó una cita" } } } }),
    ];
  });

  it("un rol sin acceso recibe 403 y no se consulta nada", async () => {
    usuario = { ...DOCTOR, role: "READONLY" };
    const r = await GET();
    assert.equal(r.status, 403);
    assert.equal(consultas.length, 0);
  });

  it("sin clínica en la sesión: 403 y no se consulta (un undefined no filtra)", async () => {
    usuario = { ...DOCTOR, clinicId: undefined };
    const r = await GET();
    assert.equal(r.status, 403);
    assert.equal(consultas.length, 0);
  });

  it("paciente no visible: el 404 de la visibilidad, sin consultar", async () => {
    visibilidad = NextResponse.json({ error: "not_found" }, { status: 404 });
    const r = await GET();
    assert.equal(r.status, 404);
    assert.equal(consultas.length, 0);
  });

  it("las sedes salen de la sesión, no de la URL", async () => {
    sedes = ["cli_1", "cli_2"];
    await GET("?clinicId=cli_OTRA&clinicIds=cli_OTRA");
    const q = consultas[0];
    assert.ok(q.values.includes("cli_1") && q.values.includes("cli_2"));
    assert.ok(!q.values.includes("cli_OTRA"));
  });

  it("un doctor con todos los permisos por defecto ve el texto completo", async () => {
    const r = await GET();
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.deepEqual(j.items.map((i: any) => i.texto).filter(Boolean).length, 3);
  });

  it("sin permiso clínico ni de facturación, lo clínico y lo económico salen enmascarados", async () => {
    usuario = { ...DOCTOR, role: "RECEPTIONIST", permissionsOverride: ["patients.view"] };
    const r = await GET();
    const j = await r.json();
    const textos = j.items.map((i: any) => i.texto);
    assert.ok(textos.includes("Se actualizó el expediente"));
    assert.ok(textos.includes("Se actualizó la facturación"));
    assert.ok(textos.includes("Agendó una cita"));
    const plano = JSON.stringify(j);
    assert.ok(!plano.includes("nota de consulta"));
    assert.ok(!plano.includes("$500"));
  });

  it("manda la zona horaria de la clínica para que la pantalla pinte la hora en ella (no en la del navegador)", async () => {
    const j = await (await GET()).json();
    assert.equal(j.zona, "America/Tijuana");
  });

  it("pagina: pide la página y el tamaño que dice la URL, con tope", async () => {
    await GET("?page=3&pageSize=9999");
    const lista = consultas[0];
    assert.deepEqual(lista.values.slice(-2), [100, 200]); // límite 100 (tope), offset (3-1)*100
  });

  it("CSV: tipo, BOM, y deja su lectura en la bitácora", async () => {
    const r = await GET("?formato=csv");
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(r.headers.get("content-disposition") ?? "", /movimientos-P-0042\.csv/);
    // `text()` se come el BOM al decodificar: se mira en los bytes.
    const bytes = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.ok(bytes.toString("utf8").includes("Agendó una cita"));
    assert.equal(bitacora.length, 1);
    assert.equal(bitacora[0].action, "view");
    assert.equal(bitacora[0].changes._read.after.kind, "movimientos_export");
    assert.equal(bitacora[0].entityId, "pat_1");
    assert.equal(bitacora[0].clinicId, "cli_1");
  });

  it("el CSV también sale enmascarado para quien no tiene el permiso", async () => {
    usuario = { ...DOCTOR, role: "RECEPTIONIST", permissionsOverride: ["patients.view"] };
    const t = await (await GET("?formato=csv")).text();
    assert.ok(!t.includes("nota de consulta"));
    assert.ok(t.includes("Se actualizó el expediente"));
  });

  it("PDF: application/pdf y deja su lectura en la bitácora", async () => {
    const r = await GET("?formato=pdf");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/pdf");
    const b = Buffer.from(await r.arrayBuffer());
    assert.equal(b.subarray(0, 4).toString(), "%PDF");
    assert.equal(bitacora.length, 1);
    assert.equal(bitacora[0].changes._read.after.kind, "movimientos_export");
  });
});
