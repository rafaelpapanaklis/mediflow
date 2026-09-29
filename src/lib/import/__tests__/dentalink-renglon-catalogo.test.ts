/**
 * ws1-t8 — piezas PURAS del importador de tratamientos de Dentalink: precio/descuento por renglón, notas del
 * renglón, conciliación de lo pagado, y el catálogo (plan + alta idempotente con una base de mentira).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/dentalink-renglon-catalogo.test.ts
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("@/lib/prisma", { namedExports: { prisma: {} } });

const renglon = () => import("../dentalink/renglon");
const catalogo = () => import("../dentalink/catalogo");

test("precio: el descuento visible es lista − paciente y el importe de la línea sigue siendo el del paciente", async () => {
  const { precioDeRenglon } = await renglon();
  assert.deepEqual(precioDeRenglon({ original: 1000, paciente: 800 }), { unitPrice: 1000, discount: 200 });
  assert.deepEqual(precioDeRenglon({ original: 1000, paciente: 1000 }), { unitPrice: 1000, discount: 0 });
  assert.deepEqual(precioDeRenglon({ original: null, paciente: 800 }), { unitPrice: 800, discount: 0 });
  assert.deepEqual(precioDeRenglon({ original: 1000, paciente: 800, cantidad: 2 }), { unitPrice: 1000, discount: 400 });
  const recargo = precioDeRenglon({ original: 500, paciente: 600 });
  assert.equal(recargo.unitPrice, 600);
  assert.equal(recargo.discount, 0);
  assert.match(recargo.aviso ?? "", /menor que el que paga el paciente/);
});

test("nota del renglón: categoría, código y pagado se escriben y se leen de vuelta", async () => {
  const { notaDeRenglon, leerNotaDeRenglon } = await renglon();
  const nota = notaDeRenglon({ previa: "Cantidad original: 2", categoria: "Operatoria", codigo: "OPE-01", pagado: 1234.5 });
  assert.equal(nota, "Cantidad original: 2 · Categoría: Operatoria · Código: OPE-01 · Pagado en el sistema anterior: $1234.50");
  assert.deepEqual(leerNotaDeRenglon(nota), { categoria: "Operatoria", codigo: "OPE-01", pagado: 1234.5 });
  assert.equal(notaDeRenglon({ pagado: 0 }), null, "sin datos no hay nota");
  assert.deepEqual(leerNotaDeRenglon(null), { categoria: null, codigo: null, pagado: null });
});

test("conciliar: cuadra = sin aviso; si no, manda el total y lo dice", async () => {
  const { conciliarPagado } = await renglon();
  assert.equal(conciliarPagado(500, 500), null);
  assert.match(conciliarPagado(900, 500) ?? "", /supera .* manda el total/);
  assert.match(conciliarPagado(300, 500) ?? "", /sin prestación asignada; manda el total/);
});

test("plan: una entrada por prestación, precio de lista más frecuente, ortodoncia a «orthodontics», control aparte", async () => {
  const { planearCatalogo } = await catalogo();
  const plan = planearCatalogo([
    { nombre: "Resina  estética ", codigo: "OPE-01", categoria: "Operatoria ", precioOriginal: 1000 },
    { nombre: "resina estética", codigo: "OPE-01", categoria: "Operatoria", precioOriginal: 900 },
    { nombre: "Resina estética", codigo: "OPE-01", categoria: "Operatoria", precioOriginal: 1000 },
    { nombre: "Alineadores invisibles", codigo: "ORT-04", categoria: "Ortodoncia", precioOriginal: 60000 },
    { nombre: "Control mensual ortodoncia tradicional", codigo: "12012", categoria: "Ortodoncia", precioOriginal: 600 },
    { nombre: "Limpieza", codigo: null, categoria: null, precioOriginal: null },
    { nombre: "", codigo: "X", categoria: "Y", precioOriginal: 1 },
  ]);
  assert.equal(plan.length, 4);
  const p = (n: string) => plan.find((x) => x.nombre.toLowerCase().startsWith(n))!;
  assert.deepEqual([p("resina").precio, p("resina").codigo, p("resina").categoria, p("resina").ortodoncia], [1000, "DL-OPE-01", "Operatoria", false]);
  assert.deepEqual([p("alineadores").categoria, p("alineadores").ortodoncia, p("alineadores").control], ["orthodontics", true, false]);
  assert.equal(p("control").control, true);
  assert.deepEqual([p("limpieza").categoria, p("limpieza").precio, p("limpieza").codigo], ["general", 0, null]);
});

/** Base de mentira: solo lo que usa asegurarCatalogoDentalink. */
function baseFalsa(inicial: any[]) {
  const filas = [...inicial];
  const bloqueos: string[] = [];
  const db: any = {
    $transaction: async (fn: any) =>
      fn({
        $executeRaw: async (_s: any, ...v: any[]) => { bloqueos.push(String(v[0])); return 0; },
        procedureCatalog: {
          findMany: async (args: any) => filas.filter((f) => f.clinicId === args.where.clinicId).map((f) => ({ ...f })),
          createMany: async (args: any) => { filas.push(...args.data.map((d: any) => ({ isActive: true, ...d }))); return { count: args.data.length }; },
        },
      }),
  };
  return { db, filas, bloqueos };
}

test("catálogo: crea lo que falta, liga lo que existe, no duplica al repetir, y marca la ortodoncia «con costo aparte»", async () => {
  const { planearCatalogo, asegurarCatalogoDentalink } = await catalogo();
  const plan = planearCatalogo([
    { nombre: "Resina estética", codigo: "OPE-01", categoria: "Operatoria", precioOriginal: 1000 },
    { nombre: "Profilaxis", codigo: "PRE-01", categoria: "Prevención", precioOriginal: 700 },
    { nombre: "Alineadores invisibles", codigo: "ORT-04", categoria: "Ortodoncia", precioOriginal: 60000 },
  ]);
  const { db, filas, bloqueos } = baseFalsa([
    { id: "pc_prof", clinicId: "A", name: "profilaxis ", code: null, category: "dental", basePrice: 650, isActive: true },
    { id: "pc_otra", clinicId: "B", name: "Resina estética", code: null, category: "dental", basePrice: 1, isActive: true },
  ]);
  const marcados: any[] = [];
  const marcar = async (id: string, clinicId: string, v: boolean | null) => { marcados.push([id, clinicId, v]); };

  const r1 = await asegurarCatalogoDentalink("A", plan, db, marcar);
  assert.equal(r1.creadas, 2);
  assert.equal(r1.existentes, 1);
  assert.equal(r1.ids.get("profilaxis"), "pc_prof", "liga por nombre sin acentos ni espacios");
  const resina = filas.find((f) => f.clinicId === "A" && f.name === "Resina estética")!;
  assert.deepEqual([resina.code, resina.category, resina.basePrice], ["DL-OPE-01", "Operatoria", 1000]);
  const ali = filas.find((f) => f.name === "Alineadores invisibles")!;
  assert.equal(ali.category, "orthodontics");
  assert.deepEqual(marcados, [[ali.id, "A", false]], "solo la de ortodoncia, con costo aparte");
  assert.ok(bloqueos[0].includes("A"), "candado por clínica");

  const antes = filas.length;
  const r2 = await asegurarCatalogoDentalink("A", plan, db, marcar);
  assert.equal(filas.length, antes, "repetir no duplica");
  assert.deepEqual([r2.creadas, r2.existentes], [0, 3]);
  assert.equal(r2.ids.get("resina estetica") ?? r2.ids.get("resina estética"), resina.id);
  assert.ok(!filas.some((f) => f.clinicId === "B" && f.code), "no toca otra clínica");
});

test("catálogo: el control se liga al ORTO_CONTROL de la clínica y jamás se crea uno nuevo", async () => {
  const { planearCatalogo, asegurarCatalogoDentalink } = await catalogo();
  const plan = planearCatalogo([
    { nombre: "Ajuste control mensual de ortodoncia", codigo: "ORT-05", categoria: "Ortodoncia", precioOriginal: 600 },
    { nombre: "Control mensual contención", codigo: null, categoria: "Ortodoncia", precioOriginal: 600 },
  ]);
  const con = baseFalsa([{ id: "pc_ctl", clinicId: "A", name: "Mi control", code: "ORTO_CONTROL", category: "orthodontics", basePrice: 300, isActive: true }]);
  const r = await asegurarCatalogoDentalink("A", plan, con.db, async () => {});
  assert.equal(con.filas.length, 1, "no crea nada");
  assert.deepEqual([...r.ids.values()], ["pc_ctl", "pc_ctl"]);

  const sin = baseFalsa([]);
  const r2 = await asegurarCatalogoDentalink("A", plan, sin.db, async () => {});
  assert.equal(sin.filas.length, 0, "sin ORTO_CONTROL tampoco lo inventa");
  assert.equal(r2.controlSinCatalogo.length, 2);
  assert.equal(r2.ids.size, 0);
});

test("catálogo: sin clinicId no hace nada", async () => {
  const { asegurarCatalogoDentalink } = await catalogo();
  await assert.rejects(() => asegurarCatalogoDentalink("", [], baseFalsa([]).db), /falta clinicId/);
});

test("renglones crudos del export → renglones de catálogo (precio numérico y coma decimal)", async () => {
  const { renglonesDeFilasCrudas } = await catalogo();
  const [a, b] = renglonesDeFilasCrudas([
    { "Nombre Prestación": "Resina", "Código Prestación": 5004, "Nombre Categoría": "Operatoria", "Precio Original": 1000 },
    { "Nombre Prestación": "Otra", "Código Prestación": "", "Nombre Categoría": "", "Precio Original": "850,50" },
  ]);
  assert.deepEqual(a, { nombre: "Resina", codigo: "5004", categoria: "Operatoria", precioOriginal: 1000 });
  assert.deepEqual(b, { nombre: "Otra", codigo: null, categoria: null, precioOriginal: 850.5 });
});
