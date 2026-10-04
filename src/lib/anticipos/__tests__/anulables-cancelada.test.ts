/**
 * F6 de la tercera auditoría de uso (ws1-t5, 4-oct-2026): «Anular anticipo» se
 * ofrecía en una factura cancelada cuyo anticipo pasó a saldo a favor, y el
 * servidor respondía 409 «La factura está cancelada.».
 *
 * Run: npm run test:anulables-cancelada
 */
import Module from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

let facturas: any[] = [];
let depositos: any[] = [];
let pagos: any[] = [];
const prismaFalso = {
  invoice: { findFirst: async ({ where }: any) => facturas.find((f) => f.id === where.id && f.clinicId === where.clinicId) ?? null },
  appointmentDeposit: {
    findMany: async ({ where }: any) =>
      depositos.filter((d) => d.clinicId === where.clinicId && d.invoiceId === where.invoiceId && d.status === where.status && d.paymentId),
  },
  payment: { findMany: async ({ where }: any) => pagos.filter((p) => p.invoiceId === where.invoiceId && where.id.in.includes(p.id) && p.amount > 0) },
};

// Sin `--experimental-test-module-mocks`: `anular.server.ts` lleva `import "server-only"`,
// que con ese flag no se deja pisar (igual que agenda-bloqueos/politica.test.ts). Se
// parchea `Module._load` para ese paquete y para `@/lib/prisma`.
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  if (req === "server-only") return {};
  if (req === "@/lib/prisma") return { prisma: prismaFalso };
  return cargaOriginal.call(this, req, ...r);
};

test("F6 · «Anular anticipo» no se ofrece en una factura cancelada (antes: botón y luego 409 «La factura está cancelada.»)", async () => {
  const { anticiposAnulables } = await import("@/lib/anticipos/anular.server");
  depositos = [{ id: "d1", clinicId: "c1", invoiceId: "mf1166", status: "PAID", paymentId: "pg1", method: "cash" }];
  pagos = [{ id: "pg1", invoiceId: "mf1166", amount: 300, method: "cash", paidAt: new Date("2026-10-04T12:00:00Z") }];
  facturas = [{ id: "mf1166", clinicId: "c1", status: "CANCELLED" }];
  assert.deepEqual(await anticiposAnulables("c1", "mf1166"), []);
  facturas = [{ id: "mf1166", clinicId: "c1", status: "PAID" }];
  assert.equal((await anticiposAnulables("c1", "mf1166")).length, 1);
  assert.deepEqual(await anticiposAnulables("otra", "mf1166"), [], "otra clínica: nada");
});

