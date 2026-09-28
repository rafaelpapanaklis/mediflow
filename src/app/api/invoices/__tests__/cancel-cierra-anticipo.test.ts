/**
 * WS1-T1 · A1 (QA ws1-t10) — cancelar una factura con un anticipo PENDING
 * SIN cobrar debe cerrar ese anticipo y quitar el apartado de la cita, igual
 * que cuando la factura sí tenía algo pagado.
 *
 * Run: npm run test:cancelar-cierra-anticipo
 *   (--experimental-test-module-mocks: se ejecuta el POST /api/invoices/[id]/
 *   cancel DE VERDAD. Se sustituyen Prisma, la sesión, los permisos, la
 *   visibilidad del paciente, la auditoría y la caché de Next; solo se espía
 *   cerrarLinksDeFactura/cerrarAnticiposDePanel para comprobar que SE LLAMAN.)
 *
 * El bug (REPORTE-ws1-t10.md, hallazgo A1): una factura CANCELADA por el
 * camino "sin nada pagado" (`invoice.paid` sigue en 0 mientras el anticipo
 * solo está PENDING, nunca cobrado) nunca llamaba a esas dos funciones —
 * vivían solo en la rama "con algo pagado", más abajo. `GET …/anticipo`
 * seguía dando `pendiente` y la cita seguía apartada después de cancelar.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";

const CLINICA = "cli_1";
const FACTURA_ID = "inv_1";

let FACTURA: any;
const llamadasCerrarLinks: any[] = [];
const llamadasCerrarAnticipos: any[] = [];

const prismaFalso: any = {
  invoice: {
    findFirst: async ({ where }: any) => {
      if (where.id !== FACTURA.id || where.clinicId !== CLINICA) return null;
      return { ...FACTURA };
    },
    updateMany: async ({ where, data }: any) => {
      if (where.id !== FACTURA.id || where.clinicId !== CLINICA) return { count: 0 };
      if ("cfdiUuid" in where && where.cfdiUuid !== FACTURA.cfdiUuid) return { count: 0 };
      if (where.paid?.lte !== undefined && !(FACTURA.paid <= where.paid.lte)) return { count: 0 };
      Object.assign(FACTURA, data);
      return { count: 1 };
    },
  },
};

mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
mock.module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({ clinicId: CLINICA, userId: "u_dr", role: "ADMIN", permissionsOverride: [] }),
  },
});
mock.module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
mock.module("@/lib/patient-visibility", { namedExports: { assertPatientVisible: async () => null } });
mock.module("@/lib/audit", { namedExports: { logMutation: async () => {} } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("@/lib/factura-mp/servicio.server", {
  namedExports: {
    cerrarLinksDeFactura: async (args: any) => { llamadasCerrarLinks.push(args); return 0; },
  },
});
mock.module("@/lib/anticipos/panel.server", {
  namedExports: {
    cerrarAnticiposDePanel: async (args: any) => { llamadasCerrarAnticipos.push(args); return 1; },
  },
});

async function cancelar() {
  const { NextRequest } = await import("next/server");
  const { POST } = await import("../[id]/cancel/route");
  const res = await POST(
    new NextRequest(`http://localhost/api/invoices/${FACTURA_ID}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    { params: { id: FACTURA_ID } },
  );
  return { status: res.status, body: await res.json() };
}

test("A1: cancelar con un anticipo PENDING sin cobrar (paid=0) SÍ cierra los links/anticipos del panel", async () => {
  FACTURA = { id: FACTURA_ID, clinicId: CLINICA, patientId: null, status: "PENDING", paid: 0, cfdiUuid: null, notes: null };
  llamadasCerrarLinks.length = 0;
  llamadasCerrarAnticipos.length = 0;

  const r = await cancelar();

  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(FACTURA.status, "CANCELLED");
  assert.equal(llamadasCerrarLinks.length, 1, "cerrarLinksDeFactura debe llamarse aunque paid=0");
  assert.deepEqual(llamadasCerrarLinks[0], { clinicId: CLINICA, invoiceId: FACTURA_ID });
  assert.equal(llamadasCerrarAnticipos.length, 1, "cerrarAnticiposDePanel debe llamarse aunque paid=0 (A1)");
  assert.deepEqual(llamadasCerrarAnticipos[0], { clinicId: CLINICA, invoiceId: FACTURA_ID });
});
