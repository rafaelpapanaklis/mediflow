/**
 * ws1-t6 — ARANCELES Y PRECIOS MIGRADOS (procedureCatalogHandler, archivo
 * nuevo src/lib/import/aranceles/handler.ts).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/aranceles.test.ts
 *
 * Se conduce el motor DE VERDAD (runImport + procedureCatalogHandler) con
 * Prisma sustituido por el doble en memoria (doble-prisma.ts). A diferencia
 * del resto del importador, esta entidad NO tiene paciente: escribe directo
 * en `procedureCatalog` (la tabla real, no una "migrada" aparte).
 *
 * Lo que prueban estos tests, en el orden que pide la tarea:
 *   · crea procedimientos nuevos con nombre/código/categoría/precio;
 *   · uno YA existente con el MISMO precio no cambia nada (duplicado limpio);
 *   · uno YA existente con precio DISTINTO se dice en la vista previa y solo
 *     se actualiza si el usuario apaga «Omitir duplicados» — nunca antes.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica Sonrisa", timezone: "America/Mexico_City" }],
    procedureCatalog: [
      { id: "pc_1", clinicId: CLINICA, name: "Profilaxis", code: "PRO-01", category: "dental", basePrice: 600, cost: null, duration: 30, description: null, isActive: true },
    ],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });

const engine = () => import("../engine");
const manejador = () => import("../aranceles/handler");

function reiniciar() {
  base = crearBase(semilla());
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

async function correr(file: File, opts: { dryRun?: boolean; skipDuplicates?: boolean } = { dryRun: true }): Promise<any> {
  const { runImport } = await engine();
  const { procedureCatalogHandler } = await manejador();
  return runImport(procedureCatalogHandler, {
    file,
    clinicId: CLINICA,
    userId: IMPORTA,
    role: "ADMIN",
    dryRun: opts.dryRun ?? true,
    skipDuplicates: opts.skipDuplicates ?? true,
    columnMapping: null,
    origin: null,
    valueMapping: null,
    sheet: null,
  });
}

const CABECERA = "codigo,nombre,categoria,precio";

test("crea un procedimiento nuevo con nombre/código/categoría/precio", async () => {
  reiniciar();
  const texto = [CABECERA, "END-01,Endodoncia unirradicular,dental,2500"].join("\n");

  const prev = await correr(csv("a1.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos, prev.duplicados], [1, 1, 0, 0]);

  const hecho = await correr(csv("a1.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  const nuevo = tabla("procedureCatalog").find((p: any) => p.name === "Endodoncia unirradicular");
  assert.ok(nuevo);
  assert.equal(nuevo.code, "END-01");
  assert.equal(nuevo.category, "dental");
  assert.equal(nuevo.basePrice, 2500);
});

test("sin columna de categoría: usa 'dental' por omisión, con aviso", async () => {
  reiniciar();
  const texto = ["nombre,precio", "Blanqueamiento,3500"].join("\n");
  const prev = await correr(csv("a2.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  assert.match(fila(prev, 2).warnings.join(" · "), /se usa "dental"/);
});

test("ya existe con el MISMO precio: duplicado limpio, no cambia nada", async () => {
  reiniciar();
  const texto = [CABECERA, "PRO-01,Profilaxis,dental,600"].join("\n");
  const prev = await correr(csv("a3.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "duplicate");
  assert.match(fila(prev, 2).warnings.join(" · "), /sin cambios/);

  const hecho = await correr(csv("a3.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 0);
  assert.equal(tabla("procedureCatalog").length, 1, "no se crea un segundo Profilaxis");
  assert.equal(tabla("procedureCatalog")[0].basePrice, 600);
});

test("ya existe con precio DISTINTO: se avisa, y con «Omitir duplicados» prendido NO se toca", async () => {
  reiniciar();
  const texto = [CABECERA, "PRO-01,Profilaxis,dental,750"].join("\n");
  const prev = await correr(csv("a4.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "duplicate");
  assert.match(fila(prev, 2).warnings.join(" · "), /ya existe con precio 600\.00/);
  assert.match(fila(prev, 2).warnings.join(" · "), /Omitir duplicados» apagado se actualiza/);

  const hecho = await correr(csv("a4.csv", texto), { dryRun: false, skipDuplicates: true });
  assert.equal(hecho.created, 0, "con «omitir duplicados» prendido, el precio NO se toca");
  assert.equal(tabla("procedureCatalog")[0].basePrice, 600, "sigue en 600");
});

test("ya existe con precio DISTINTO: con «Omitir duplicados» APAGADO, se actualiza (confirmación explícita)", async () => {
  reiniciar();
  const texto = [CABECERA, "PRO-01,Profilaxis,dental,750"].join("\n");
  const hecho = await correr(csv("a5.csv", texto), { dryRun: false, skipDuplicates: false });
  assert.equal(hecho.created, 1, "cuenta como fila que sí cambió algo");
  assert.equal(tabla("procedureCatalog").length, 1, "sigue siendo UN Profilaxis, no dos");
  assert.equal(tabla("procedureCatalog")[0].basePrice, 750, "el precio se actualizó");
});

test("dos filas del MISMO archivo con el mismo nombre: la primera manda, la segunda es duplicada", async () => {
  reiniciar();
  const texto = [CABECERA, "X-1,Carilla dental,dental,5000", "X-2,Carilla dental,dental,5500"].join("\n");
  const prev = await correr(csv("a6.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  assert.equal(fila(prev, 3).status, "duplicate");

  const hecho = await correr(csv("a6.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);
  const carillas = tabla("procedureCatalog").filter((p: any) => p.name === "Carilla dental");
  assert.equal(carillas.length, 1);
  assert.equal(carillas[0].basePrice, 5000, "la primera fila del archivo manda");
});

test("precio negativo: error, no se importa", async () => {
  reiniciar();
  const texto = [CABECERA, "X-3,Radiografía,dental,-200"].join("\n");
  const prev = await correr(csv("a7.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /no puede ser negativo/);
});

test("sin nombre: error", async () => {
  reiniciar();
  const texto = [CABECERA, ",,dental,500"].join("\n");
  const prev = await correr(csv("a8.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.match(fila(prev, 2).errors.join(" · "), /Falta el nombre/);
});

test("monto ambiguo sin evidencia en el archivo: se marca pendiente, no se adivina", async () => {
  reiniciar();
  const texto = [CABECERA, "X-4,Corona,dental,45.000"].join("\n");
  const prev = await correr(csv("a9.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "error");
  assert.ok(prev.unresolved?.some((u: any) => u.field === "amountFormat"));
});
