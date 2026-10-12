/**
 * Auditoría de uso C-04 (ws1-t5, 4-oct-2026): «Anular anticipo» exige el
 * permiso de REEMBOLSO (dueño/administración), no el de cobro.
 *
 * Run: npm run test:anular-anticipo-permiso
 *
 * Con el código viejo, recepción (billing.charge sí, billing.refund no) pasaba
 * la puerta: el GET le listaba el anticipo y el POST lo dejaba en $0 (MF-1139).
 * Aquí la base es un doble que no encuentra la factura: quien pasa la puerta
 * de permiso recibe 404; quien no, 403 (POST) o la lista vacía (GET).
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const authCtx: any = { clinicId: "c1", userId: "u1", role: "RECEPTIONIST", permissionsOverride: null };
const prismaStub: any = {
  invoice: { findFirst: async () => null },
  user: { findFirst: async () => null },
};
(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => authCtx } });
(mock as any).module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/rate-limit", { namedExports: { rateLimit: () => null } });
(mock as any).module("@/lib/anticipos/anular.server", {
  namedExports: { anticiposAnulables: async () => [{ id: "d1" }], anularAnticipoRecibido: async () => ({ ok: false, error: "no_encontrada" }) },
});
(mock as any).module("@/lib/factura-mp/servicio.server", { namedExports: { cerrarLinksDeFactura: async () => {} } });
(mock as any).module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });

const req = (body?: any): any => ({ json: async () => body ?? {}, headers: new Headers(), url: "http://localhost/api/invoices/inv1/anticipo/anular" });
const P = { params: Promise.resolve({ id: "inv1" }) };

test("C-04 · recepción: el POST de «Anular anticipo» da 403 y el GET no le ofrece nada", async () => {
  const { GET, POST } = await import("@/app/api/invoices/[id]/anticipo/anular/route");
  authCtx.role = "RECEPTIONIST";
  const r = await POST(req({ depositId: "d1", motivo: "dedazo" }), P);
  assert.equal(r.status, 403, "antes: pasaba la puerta con billing.charge");
  const g = await GET(req(), P);
  assert.deepEqual(await g.json(), { anulables: [] });
});

test("C-04 · el dueño y administración sí pasan la puerta (aquí la factura no existe: 404)", async () => {
  const { POST } = await import("@/app/api/invoices/[id]/anticipo/anular/route");
  for (const role of ["SUPER_ADMIN", "ADMIN"]) {
    authCtx.role = role;
    const r = await POST(req({ depositId: "d1", motivo: "dedazo" }), P);
    assert.equal(r.status, 404, role);
  }
  authCtx.role = "RECEPTIONIST";
});
