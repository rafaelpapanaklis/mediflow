/**
 * ws1-t12 — ODONTOGRAMA: una fila = una condición en (diente, cara opcional)
 * del odontograma VIVO del paciente (odontogram_entries), el MISMO modelo que
 * pinta la pestaña Odontograma (odontogram-v2) — sin catálogo inventado aparte.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/odontograma.test.ts
 *
 * Se conduce el motor DE VERDAD (runImport + odontogramHandler) con Prisma
 * sustituido por el doble en memoria (doble-prisma.ts).
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function semilla() {
  return {
    patient: [
      { id: "p1", clinicId: CLINICA, firstName: "María", lastName: "Hernández", phone: "5551234567", email: null, dob: null, deletedAt: null, visibleUserIds: [] },
      { id: "p2", clinicId: CLINICA, firstName: "Jorge", lastName: "López", phone: "5559876543", email: null, dob: null, deletedAt: null, visibleUserIds: [] },
    ],
    odontogramEntry: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) },
});

const engine = () => import("../engine");
const entidades = () => import("../entities");

function reiniciar() {
  base = crearBase(semilla());
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

async function correr(
  file: File,
  opts: { dryRun?: boolean; skipDuplicates?: boolean; valueMapping?: any } = { dryRun: true },
): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS.odontogram, {
    file,
    clinicId: CLINICA,
    userId: IMPORTA,
    role: "ADMIN",
    dryRun: opts.dryRun ?? true,
    skipDuplicates: opts.skipDuplicates ?? true,
    columnMapping: null,
    origin: null,
    valueMapping: opts.valueMapping ?? null,
    sheet: null,
  });
}

const CABECERA = "nombre,apellido,telefono,pieza,cara,hallazgo";

test("feliz: pieza + cara + hallazgo reconocido crea la entrada; reimportar el mismo archivo no duplica", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,16,Mesial,Caries"].join("\n");
  const prev = await correr(csv("o1.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos, prev.duplicados], [1, 1, 0, 0]);

  const hecho = await correr(csv("o1.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  const e = tabla("odontogramEntry")[0];
  assert.equal(e.patientId, "p1");
  assert.equal(e.toothNumber, 16);
  assert.equal(e.surface, "M");
  assert.equal(e.conditionId, "caries");

  // Reimportar: la vista previa lo marca duplicado (candado = unique real) y el commit no crea nada más.
  const prev2 = await correr(csv("o1.csv", texto), { dryRun: true });
  assert.equal(prev2.duplicados, 1);
  assert.match(fila(prev2, 2).warnings.join(" · "), /ya está en el odontograma/);
  const otraVez = await correr(csv("o1.csv", texto), { dryRun: false });
  assert.equal(otraVez.created, 0);
  assert.equal(tabla("odontogramEntry").length, 1);
});

test("hallazgo no reconocido: sin emparejar (nunca en silencio); con equivalente elegido, importa; con 'sin ligar', sigue sin importarse", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,21,Vestibular,Mancha rarísima XYZ"].join("\n");
  const prev = await correr(csv("o2.csv", texto), { dryRun: true });
  assert.equal(prev.validos, 1, "no es un error: es 'ok' pendiente de decisión");
  assert.equal(prev.unresolved?.length, 1);
  assert.equal(prev.unresolved![0].field, "condition");
  assert.ok(prev.options?.condition?.some((o: any) => o.id === "caries"));

  // Sin decisión: no se importa (a diferencia de un procedimiento de presupuesto, aquí no hay "sin ligar" que guardar).
  const sinDecidir = await correr(csv("o2.csv", texto), { dryRun: false });
  assert.equal(sinDecidir.created, 0);
  assert.equal(tabla("odontogramEntry").length, 0);

  // VALUE_UNLINKED tampoco importa nada (no es un conditionId real).
  const { VALUE_UNLINKED } = await import("../types");
  const key = prev.unresolved![0].key;
  const conUnlinked = await correr(csv("o2.csv", texto), { dryRun: false, valueMapping: { condition: { [key]: VALUE_UNLINKED } } });
  assert.equal(conUnlinked.created, 0);

  // Con el equivalente real elegido: importa con ese conditionId.
  const conEquivalente = await correr(csv("o2.csv", texto), { dryRun: false, valueMapping: { condition: { [key]: "pigmentation" } } });
  assert.equal(conEquivalente.created, 1);
  assert.equal(tabla("odontogramEntry")[0].conditionId, "pigmentation");
});

test("condición de diente completo ignora la cara sin aviso; condición de superficie sin cara avisa y guarda sin cara específica", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,11,Oclusal,Corona", // target=tooth: la cara se ignora
    "María,Hernández,5551234567,22,,Caries", // target=surface, sin cara: avisa
  ].join("\n");
  const prev = await correr(csv("o3.csv", texto), { dryRun: true });
  assert.deepEqual(fila(prev, 2).warnings, []);
  assert.equal(fila(prev, 2).data.surface, null);
  assert.match(fila(prev, 3).warnings.join(" · "), /suele llevar una cara/);
  assert.equal(fila(prev, 3).data.surface, null);

  const hecho = await correr(csv("o3.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 2);
  const corona = tabla("odontogramEntry").find((e) => e.toothNumber === 11)!;
  assert.equal(corona.surface, null);
  assert.equal(corona.conditionId, "crown");
});

test("pieza FDI inválida (fuera de la numeración real) es un error, no se adivina", async () => {
  reiniciar();
  const texto = [CABECERA, "María,Hernández,5551234567,19,,Caries"].join("\n"); // 19 no existe en FDI
  const prev = await correr(csv("o4.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /Pieza dental inválida/);
});

test("mismo diente+cara+hallazgo repetido EN el archivo: la segunda fila es duplicado, no se cuentan dos", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,16,Mesial,Caries",
    "María,Hernández,5551234567,16,Mesial,Caries",
  ].join("\n");
  const prev = await correr(csv("o5.csv", texto), { dryRun: true });
  assert.deepEqual([prev.validos, prev.duplicados], [1, 1]);
  const hecho = await correr(csv("o5.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
});

test("paciente no encontrado: error, no se inventa", async () => {
  reiniciar();
  const texto = [CABECERA, "Pedro,Inventado,5550000000,16,Mesial,Caries"].join("\n");
  const prev = await correr(csv("o6.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /Paciente no encontrado/);
});

test("cara distinta en el mismo diente y misma condición NO es duplicado (son hallazgos distintos)", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,16,Mesial,Caries",
    "María,Hernández,5551234567,16,Distal,Caries",
  ].join("\n");
  const prev = await correr(csv("o7.csv", texto), { dryRun: true });
  assert.deepEqual([prev.validos, prev.duplicados], [2, 0]);
  const hecho = await correr(csv("o7.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 2);
});
