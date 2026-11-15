/* ═══════════════════════════════════════════════════════════════════════
   UNA SUCURSAL NUEVA HEREDA LOS SERVICIOS ACTIVOS DE LA MATRIZ.

     npx tsx --test src/lib/barber/__tests__/sucursal-servicios.test.ts

   G3 (parte chica) de la auditoría del 14-nov: la sede nacía con 0 servicios.
   Aquí se prueba QUÉ se copia (función pura). Que se copie dentro de la misma
   transacción que la sede lo fija la lectura de createBranch (ver el último
   test, que es estático).
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { serviciosParaSedeNueva, type ServicioDeMatriz } from "../branch-services";

const MATRIZ: ServicioDeMatriz[] = [
  { name: "Corte", description: "Clásico", durationMin: 30, price: "200.00", category: "general", isActive: true, sortOrder: 0 },
  { name: "Barba", description: null, durationMin: 20, price: "150.50", category: "barba", isActive: true, sortOrder: 1 },
  { name: "Servicio retirado", description: null, durationMin: 15, price: "99.99", category: "general", isActive: false, sortOrder: 2 },
];

test("copia solo los activos, a la sede nueva, con precio y orden intactos", () => {
  const filas = serviciosParaSedeNueva(MATRIZ, "sede-nueva");
  assert.equal(filas.length, 2);
  assert.deepEqual(filas.map((f) => f.name), ["Corte", "Barba"]);
  for (const f of filas) {
    assert.equal(f.barbershopId, "sede-nueva");
    assert.equal(f.isActive, true);
  }
  assert.equal(String(filas[1].price), "150.50"); // sin redondear ni convertir
  assert.equal(filas[1].sortOrder, 1);
  assert.equal(filas[0].description, "Clásico");
});

test("matriz sin servicios activos: no hay nada que copiar", () => {
  assert.deepEqual(serviciosParaSedeNueva([], "x"), []);
  assert.deepEqual(serviciosParaSedeNueva([MATRIZ[2]], "x"), []);
});

test("createBranch crea la sede y copia los servicios en la MISMA transacción", () => {
  const src = readFileSync(path.resolve(__dirname, "..", "branches.ts"), "utf8");
  const i = src.indexOf("export async function createBranch");
  const cuerpo = src.slice(i, src.indexOf("\nexport async function", i + 10));
  assert.match(cuerpo, /prisma\.\$transaction\(async \(tx\)/);
  assert.match(cuerpo, /tx\.barbershop\.create/);
  assert.match(cuerpo, /tx\.barberService\.createMany/);
  // La matriz se lee por el id de la CADENA (sesión), nunca del request.
  assert.match(cuerpo, /tx\.barberService\.findMany\(\{\s*where:\s*\{\s*barbershopId:\s*rootId/);
});
