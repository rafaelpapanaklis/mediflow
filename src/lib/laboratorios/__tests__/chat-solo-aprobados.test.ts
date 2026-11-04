/**
 * ws1-t11 · lead 16 (auditoría run-2) — solo un laboratorio o proveedor
 * APROBADO usa el chat con clínicas.
 *
 * Run: npm run test:chat-solo-aprobados
 *
 * El hallazgo: el alta de laboratorios y proveedores es de autoservicio (queda
 * PENDING). El panel y el resto de su API exigen APPROVED («Cuenta no
 * aprobada»), pero los resolvers compartidos del chat (resolveLabChatCaller y
 * resolveChatCaller) aceptaban cualquier usuario activo: una cuenta recién
 * registrada, suspendida o rechazada abría un hilo con cualquier clínica (por
 * su id, que la página pública de reservas expone) y le escribía en la bandeja.
 *
 * Route handlers REALES de /api/lab-chat y /api/supplier-chat con los
 * resolvers reales; sesiones y Prisma de mentira.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

let lab: any = null;
let proveedor: any = null;
let clinica: any = null;
const escrituras: string[] = [];

mock.module("@/lib/lab-auth", { namedExports: { getDentalLabContext: async () => lab } });
mock.module("@/lib/supplier-auth", { namedExports: { getSupplierContext: async () => proveedor } });
mock.module("@/lib/auth-context", { namedExports: { getAuthContext: async () => clinica } });

const AHORA = new Date();
const hilo = (extra: Record<string, unknown>) => ({
  id: "h1", clinicId: "cli_a", orderId: null, lastMessageAt: AHORA, clinicUnread: 0, labUnread: 0, supplierUnread: 0,
  createdAt: AHORA, messages: [], clinic: { id: "cli_a", name: "Clínica A", logoUrl: null }, ...extra,
});
const mensaje = { id: "m1", threadId: "h1", sender: "LAB", senderId: "lu1", body: "hola", createdAt: AHORA };
const modelo = (nombre: string, fila: () => any) => ({
  findFirst: async () => fila(),
  findUnique: async () => fila(),
  findMany: async () => [fila()],
  upsert: async () => { escrituras.push(`${nombre}.upsert`); return fila(); },
  create: async () => { escrituras.push(`${nombre}.create`); return { ...mensaje }; },
  update: async () => { escrituras.push(`${nombre}.update`); return fila(); },
  updateMany: async () => { escrituras.push(`${nombre}.updateMany`); return { count: 1 }; },
});
const prisma: any = {
  clinic: modelo("clinic", () => ({ id: "cli_a", name: "Clínica A", logoUrl: null })),
  dentalLab: modelo("dentalLab", () => ({ id: "lab1" })),
  supplier: modelo("supplier", () => ({ id: "sup1" })),
  dentalLabChatThread: modelo("dentalLabChatThread", () => hilo({ labId: "lab1" })),
  dentalLabChatMessage: modelo("dentalLabChatMessage", () => mensaje),
  supplierChatThread: modelo("supplierChatThread", () => hilo({ supplierId: "sup1" })),
  supplierChatMessage: modelo("supplierChatMessage", () => ({ ...mensaje, sender: "SUPPLIER" })),
};
prisma.$transaction = async (f: any) => (typeof f === "function" ? f(prisma) : Promise.all(f));
mock.module("@/lib/prisma", { namedExports: { prisma } });

const sesionLab = (status: string) => ({ labUserId: "lu1", labId: "lab1", lab: { id: "lab1", status }, role: "OWNER", status });
const sesionProv = (status: string) => ({ supplierUserId: "su1", supplierId: "sup1", supplier: { id: "sup1", status }, role: "OWNER", status });

beforeEach(() => {
  lab = null; proveedor = null; clinica = null;
  escrituras.length = 0;
});

const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const params = Promise.resolve({ threadId: "h1" });

const LAB = {
  start: async () => (await import("../../../app/api/lab-chat/start/route")).POST(post({ clinicId: "cli_a" })),
  enviar: async () => (await import("../../../app/api/lab-chat/[threadId]/messages/route")).POST(post({ body: "Deposite a esta cuenta" }), { params }),
  leer: async () => (await import("../../../app/api/lab-chat/[threadId]/messages/route")).GET(new Request("http://x"), { params }),
  bandeja: async () => (await import("../../../app/api/lab-chat/route")).GET(),
};
const PROV = {
  start: async () => (await import("../../../app/api/supplier-chat/start/route")).POST(post({ clinicId: "cli_a" })),
  enviar: async () => (await import("../../../app/api/supplier-chat/[threadId]/messages/route")).POST(post({ body: "Deposite a esta cuenta" }), { params }),
  leer: async () => (await import("../../../app/api/supplier-chat/[threadId]/messages/route")).GET(new Request("http://x"), { params }),
  bandeja: async () => (await import("../../../app/api/supplier-chat/route")).GET(),
};

for (const status of ["PENDING", "SUSPENDED", "REJECTED"]) {
  test(`laboratorio ${status}: no abre hilo, no escribe, no lee ni lista`, async () => {
    lab = sesionLab(status);
    for (const [paso, r] of Object.entries({ start: await LAB.start(), enviar: await LAB.enviar(), leer: await LAB.leer(), bandeja: await LAB.bandeja() })) {
      assert.equal(r.status, 401, `${paso} respondió ${r.status}`);
    }
    assert.deepEqual(escrituras, []);
  });

  test(`proveedor ${status}: no abre hilo, no escribe, no lee ni lista`, async () => {
    proveedor = sesionProv(status);
    for (const [paso, r] of Object.entries({ start: await PROV.start(), enviar: await PROV.enviar(), leer: await PROV.leer(), bandeja: await PROV.bandeja() })) {
      assert.equal(r.status, 401, `${paso} respondió ${r.status}`);
    }
    assert.deepEqual(escrituras, []);
  });
}

test("laboratorio APROBADO: abre hilo y escribe como siempre", async () => {
  lab = sesionLab("APPROVED");
  assert.equal((await LAB.start()).status, 201);
  assert.equal((await LAB.enviar()).status, 201);
  assert.ok(escrituras.includes("dentalLabChatMessage.create"));
});

test("proveedor APROBADO: abre hilo y escribe como siempre", async () => {
  proveedor = sesionProv("APPROVED");
  assert.equal((await PROV.start()).status, 201);
  assert.equal((await PROV.enviar()).status, 201);
  assert.ok(escrituras.includes("supplierChatMessage.create"));
});

test("el lado clínica no cambia", async () => {
  clinica = { clinicId: "cli_a", userId: "u1", role: "ADMIN" };
  assert.equal((await LAB.enviar()).status, 201);
  assert.equal((await PROV.enviar()).status, 201);
});
