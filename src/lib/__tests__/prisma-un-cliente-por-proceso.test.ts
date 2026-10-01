/**
 * ws1-t12 · UN cliente de Prisma por proceso, también en producción.
 *
 * Run: npm run test:conexiones-base
 *
 * El build de Next mete src/lib/prisma.ts en varios módulos de webpack
 * (medido en el build del 1-oct-2026: 3 ids distintos — páginas, server actions
 * y el sitemap). Con el singleton solo fuera de producción, cada copia creaba
 * su propio PrismaClient y su propio pool de `connection_limit` conexiones en
 * la misma función. Aquí se evalúa DOS veces cada módulo (se borra de la caché
 * de require entre una y otra, como dos copias del bundle) con
 * NODE_ENV=production.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";

let creados = 0;
class PrismaClientFalso {
  constructor() { creados++; }
  $extends() { return this; }
}
mock.module("@prisma/client", { namedExports: { PrismaClient: PrismaClientFalso } });

/** Evalúa el módulo otra vez, como otra copia del bundle. */
function otraCopia(ruta: string) {
  const resuelta = require.resolve(ruta);
  delete require.cache[resuelta];
  return require(resuelta);
}

test("dos copias de @/lib/prisma y de @/lib/prisma-admin en producción: un cliente de cada uno", () => {
  const antes = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = "production";
  try {
    const a = otraCopia("../prisma");
    const b = otraCopia("../prisma");
    assert.equal(a.prisma, b.prisma);
    const c = otraCopia("../prisma-admin");
    const d = otraCopia("../prisma-admin");
    assert.equal(c.prismaAdmin, d.prismaAdmin);
    assert.equal(creados, 2, "uno para prisma y uno para prismaAdmin");
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = antes;
  }
});

test("el contexto de clínica también es uno: lo que fija una copia lo ve la otra", () => {
  const a = otraCopia("../clinic-context");
  const b = otraCopia("../clinic-context");
  assert.ok(a.clinicContextStorage instanceof AsyncLocalStorage);
  assert.equal(a.clinicContextStorage, b.clinicContextStorage);
  a.clinicContextStorage.run({ clinicId: "cli_a" }, () => {
    assert.equal(b.getCurrentClinicContext()?.clinicId, "cli_a");
  });
});
