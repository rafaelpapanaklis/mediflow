/**
 * LA FILA DE ESPERA HACE LO QUE DICE CADA BOTÓN — ws1-t4.
 *
 * Run: npm run test:walk-in-acciones
 *
 * El cliente manda `{ action }` y el PATCH solo leía status/assignedTo/startedAt/completedAt: «Asignar»,
 * «Iniciar» y «Cancelar» contestaban 200 sin cambiar nada. Ahora cada acción mueve el estado de verdad,
 * «Asignar» exige un profesional de la misma clínica que pueda recibir citas (regla única de ws1-t10) y una
 * transición imposible contesta 409 sin escribir.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ctx: any = { userId: "u1", clinicId: "c1", role: "RECEPTIONIST", permissionsOverride: [] };
let fila: any;
let wheresUser: any[];

beforeEach(() => {
  fila = { id: "w1", clinicId: "c1", status: "WAITING", assignedTo: null, startedAt: null, completedAt: null };
  wheresUser = [];
});

async function updateFila(a: any) {
  assert.equal(a.where.clinicId, "c1");
  if (a.where.id !== fila.id || !a.where.status.in.includes(fila.status)) return { count: 0 };
  Object.assign(fila, a.data);
  return { count: 1 };
}

(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => ctx } });
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      // «Completar»/«Cancelar» cierran fila y cita en una transacción (revision-final.test.ts); aquí no hay cita.
      $transaction: async (fn: any) => fn({ $queryRaw: async () => [], walkInQueue: { updateMany: (a: any) => updateFila(a) }, appointment: { findFirst: async () => null } }),
      user: {
        // Solo "doc1" de c1 cumple la regla; el filtro llega entero para comprobar tenant y regla.
        findFirst: async (a: any) => {
          wheresUser.push(a.where);
          return a.where.id === "doc1" && a.where.clinicId === "c1" ? { id: "doc1" } : null;
        },
      },
      walkInQueue: {
        findFirst: async (a: any) => (a.where.id === fila.id && a.where.clinicId === fila.clinicId ? { ...fila } : null),
        updateMany: (a: any) => updateFila(a),
      },
    },
  },
});

const req = (body?: any) => ({ json: async () => body }) as any;
const idp = { params: { id: "w1" } };

test("asignar: guarda el profesional y pasa a ASSIGNED; el filtro es la regla única + la clínica de la sesión", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  const r = await PATCH(req({ action: "assign", assignedTo: "doc1" }), idp);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.status, "ASSIGNED");
  assert.equal(j.assignedTo, "doc1");
  assert.equal(wheresUser[0].clinicId, "c1");
  assert.deepEqual(wheresUser[0].role.in, ["DOCTOR", "ADMIN", "SUPER_ADMIN"]);
  assert.equal(wheresUser[0].isActive, true);
  assert.equal(wheresUser[0].agendaActive, true);
});

test("asignar: sin profesional, o uno que no recibe citas / de otra clínica, no cambia nada", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  assert.equal((await PATCH(req({ action: "assign" }), idp)).status, 400);
  const r = await PATCH(req({ action: "assign", assignedTo: "recepcion-o-ajeno" }), idp);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, "doctor_not_found");
  assert.equal(fila.status, "WAITING");
  assert.equal(fila.assignedTo, null);
});

test("terminar y cancelar mueven el estado y ponen su marca de tiempo", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  // «Iniciar» ya no es solo un cambio de estado: crea la cita del momento (iniciar-cita.test.ts).
  fila.status = "IN_PROGRESS";
  let j = await (await PATCH(req({ action: "complete" }), idp)).json();
  assert.equal(j.status, "COMPLETED");
  assert.ok(!Number.isNaN(Date.parse(j.completedAt)));

  fila.status = "WAITING";
  j = await (await PATCH(req({ action: "cancel" }), idp)).json();
  assert.equal(j.status, "CANCELLED");
});

test("transiciones imposibles: 409 y la fila queda igual (completar sin iniciar, tocar una cancelada)", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  assert.equal((await PATCH(req({ action: "complete" }), idp)).status, 409);
  assert.equal(fila.status, "WAITING");
  fila.status = "CANCELLED";
  for (const action of ["start", "complete", "cancel"]) {
    assert.equal((await PATCH(req({ action }), idp)).status, 409, action);
  }
  assert.equal(fila.status, "CANCELLED");
});

test("acción desconocida, `status` crudo o cuerpo vacío: 400, no se escribe nada", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  for (const body of [{ action: "explotar" }, { status: "COMPLETED" }, {}, null]) {
    assert.equal((await PATCH(req(body), idp)).status, 400, JSON.stringify(body));
  }
  assert.equal(fila.status, "WAITING");
});

test("otra clínica: 404 aunque el id exista", async () => {
  const { PATCH } = await import("@/app/api/walk-in/[id]/route");
  ctx.clinicId = "c2";
  try {
    assert.equal((await PATCH(req({ action: "cancel" }), idp)).status, 404);
  } finally {
    ctx.clinicId = "c1";
  }
});

test("la pantalla manda `action` + `assignedTo` y el servidor lee lo mismo (el contrato no se vuelve a desviar)", () => {
  const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const cliente = leer("src/app/dashboard/walk-in/walk-in-client.tsx");
  assert.match(cliente, /JSON\.stringify\(\{ action,/);
  const api = leer("src/app/api/walk-in/[id]/route.ts");
  assert.match(api, /body\?\.action/);
  assert.match(api, /body\?\.assignedTo/);
  // Los dos pintados llaman al mismo selector de profesional.
  assert.match(leer("src/components/dashboard/piezas-rediseno/fila-espera.tsx"), /handleAction\(item\.id, "assign", e\.target\.value\)/);
  assert.match(cliente, /handleAction\(item\.id, "assign", e\.target\.value\)/);
});
