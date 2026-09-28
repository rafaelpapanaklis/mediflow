// ws1-t10, punto 9 — el CFDI de un caso se precarga con los datos del responsable
// de pago (tutor), no con los del niño; hermanos con el mismo responsable.
//
// Correr: npm run test:orto-cfdi-responsable
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizarFiscales, receptorInicial, type ResponsableParaCfdi } from "../receptor-responsable";

const SRC = join(__dirname, "..", "..", "..");
const RAIZ = join(SRC, "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

const tutora = (fiscales: Partial<ResponsableParaCfdi["fiscales"]> = {}): ResponsableParaCfdi => ({
  guardianId: "g1", nombreCompleto: "María Ruiz", parentesco: "madre", email: null,
  fiscales: { rfc: "", nombre: "", regimen: "", cp: "", ...fiscales },
});

test("con responsable y sus fiscales guardados: salen los del tutor, no los del niño", () => {
  const r = receptorInicial({ rfc: "NINO101010AAA", nombre: "Niño Ruiz", regimen: "605", cp: "01000" },
    tutora({ rfc: "RUIM800101AB1", nombre: "MARIA RUIZ LOPEZ", regimen: "612", cp: "64000" }));
  assert.equal(r.origen, "responsable");
  assert.deepEqual(r.datos, { rfc: "RUIM800101AB1", nombre: "MARIA RUIZ LOPEZ", regimen: "612", cp: "64000" });
});

test("con responsable SIN fiscales: al menos su nombre y NUNCA el RFC del niño", () => {
  const r = receptorInicial({ rfc: "NINO101010AAA", nombre: "Niño Ruiz", regimen: "605", cp: "01000" }, tutora());
  assert.equal(r.origen, "responsable");
  assert.equal(r.datos.rfc, "");
  assert.equal(r.datos.cp, "");
  assert.equal(r.datos.nombre, "María Ruiz");
  assert.equal(r.datos.regimen, "612");
});

test("sin responsable: los del paciente, como siempre (régimen 612 por defecto)", () => {
  const r = receptorInicial({ rfc: "abc010101xx1", nombre: "Ana", regimen: "", cp: "01000" }, null);
  assert.equal(r.origen, "paciente");
  assert.equal(r.datos.rfc, "ABC010101XX1");
  assert.equal(r.datos.regimen, "612");
  assert.equal(receptorInicial(null, null).datos.rfc, "");
});

test("hermanos: dos facturas con el MISMO responsable dan el mismo receptor", () => {
  const t = tutora({ rfc: "RUIM800101AB1", nombre: "MARIA RUIZ LOPEZ", regimen: "612", cp: "64000" });
  const a = receptorInicial({ rfc: "", nombre: "Hijo A", regimen: "", cp: "" }, t);
  const b = receptorInicial({ rfc: "", nombre: "Hijo B", regimen: "", cp: "" }, t);
  assert.deepEqual(a.datos, b.datos);
});

test("normalizarFiscales: RFC en mayúsculas sin espacios, CP de 5 dígitos", () => {
  assert.deepEqual(normalizarFiscales({ rfc: " ruim 800101 ab1 ", nombre: "  X ", regimen: " 612 ", cp: "64-000 9" }),
    { rfc: "RUIM800101AB1", nombre: "X", regimen: "612", cp: "64000" });
});

test("el SQL es plano (sin DO), idempotente y solo agrega columnas", () => {
  const sql = readFileSync(join(RAIZ, "sql", "ortodoncia-responsable-fiscal.sql"), "utf8");
  assert.doesNotMatch(sql, /\bDO\s+\$/i);
  const lineas = sql.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
  assert.equal(lineas.length, 4);
  for (const l of lineas) assert.match(l, /^ALTER TABLE "ped_guardians" ADD COLUMN IF NOT EXISTS /);
  assert.doesNotMatch(sql, /\b(DROP|DELETE|UPDATE)\b/);
});

test("el servidor resuelve el tutor desde la factura y la clínica de la sesión; guardar exige admin", () => {
  const db = leer("lib/orthodontics/responsable-fiscal-db.ts");
  assert.match(db, /where: \{ clinicId, invoiceId, deletedAt: null \}/);
  assert.match(db, /if \(!clinicId \|\| !invoiceId\) return null;/);
  assert.match(db, /WHERE "id" = \$\{guardianId\} AND "clinicId" = \$\{clinicId\}/);
  const ruta = leer("app/api/invoices/[id]/receptor-responsable/route.ts");
  assert.match(ruta, /requireAdmin\(ctx\)/);
  assert.match(ruta, /denyIfMissingPermission\(ctx, "billing\.view"\)/);
  assert.match(ruta, /assertPatientVisible/);
});

test("las columnas NO se declaran en schema.prisma (una columna de menos no debe tumbar Guardian)", () => {
  const schema = readFileSync(join(RAIZ, "prisma", "schema.prisma"), "utf8");
  assert.doesNotMatch(schema, /rfcFiscal/);
});

test("el detalle de factura precarga con el responsable y, con responsable, guarda en él y no en el niño", () => {
  const src = leer("components/dashboard/billing/invoice-detail-modal.tsx");
  assert.match(src, /receptorInicial\(/);
  assert.match(src, /if \(fiscalOrigen === "responsable"\)/);
  assert.match(src, /receptor-responsable/);
  const lista = leer("app/dashboard/billing/billing-client.tsx");
  assert.match(lista, /pedirResponsableDeFactura\(inv\.id\)/);
});

test("hermanos: «Datos del caso» de un caso ya abierto también busca el tutor de otro paciente (mismo Guardian.id)", () => {
  const d = leer("components/specialties/orthodontics/redesign/drawers/DrawerCaseSettings.tsx");
  assert.match(d, /buscarTutoresDeLaClinica\(\{ q: tutorQuery, excludePatientId: props\.patientId \}\)/);
  assert.match(d, /data-tutores-de-hermanos/);
  // «Ya registrado» ya no se apaga por no tener tutores propios
  assert.doesNotMatch(d, /disabled=\{!columnsExist\.responsibleGuardianId \|\| guardians\.length === 0\}/);
  // el servidor acepta el tutor de un hermano (de la clínica), no solo los del paciente
  assert.match(leer("lib/orthodontics/validar-personas-del-caso-db.ts"), /clinicId/);
});
