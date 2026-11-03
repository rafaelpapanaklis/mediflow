/**
 * Seguridad admin-auth (revisión ws1-t8, hermano 2) — la bitácora del webhook de Stripe se escribe de verdad.
 *
 * Run: npm run test:seg-admin-auth
 *
 * El webhook escribía `logAudit({ userId: clinicId })`. `audit_logs."userId"` tiene FK a `users` (y, con
 * sql/audit-logs-actor-externo.sql, puede ser NULL solo con actorType patient|public|bot): un clinicId no es un
 * usuario, el INSERT fallaba y logAudit se lo tragaba. Aquí el camino REAL (audit.ts → fila.ts → prisma) contra
 * un doble de prisma que aplica la FK y el CHECK de la base.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";

const USUARIOS = new Set(["u-dueno"]);
const filas: any[] = [];
const errores: unknown[] = [];

const prismaDoble = {
  auditLog: {
    create: async ({ data }: any) => {
      if (data.userId === null || data.userId === undefined) {
        // CHECK audit_logs_actor_externo_check
        if (!["patient", "public", "bot"].includes(data.actorType)) throw Object.assign(new Error("violates check constraint audit_logs_actor_externo_check"), { code: "P2004" });
      } else if (!USUARIOS.has(data.userId)) {
        throw Object.assign(new Error('Foreign key constraint failed on the field: `audit_logs_userId_fkey (index)`'), { code: "P2003" });
      }
      filas.push(data);
      return { id: `a${filas.length}` };
    },
  },
};
const dobles: Record<string, unknown> = {
  "@/lib/prisma": { prisma: prismaDoble },
  "@/lib/admin/suplantacion": { desviarSiSuplantacion: async () => false },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

const errorOriginal = console.error;
beforeEach(() => {
  filas.length = 0;
  errores.length = 0;
  console.error = (...a: unknown[]) => { errores.push(a); };
});

test("así fallaba: logAudit con userId = clinicId no deja fila (FK), y no lanza", async () => {
  const { logAudit } = await import("@/lib/audit");
  await logAudit({ clinicId: "cli-1", userId: "cli-1", entityType: "subscription", entityId: "cs_1", action: "update", changes: { x: { before: null, after: 1 } } });
  console.error = errorOriginal;
  assert.equal(filas.length, 0);
  assert.equal(errores.length, 1, "solo un console.error");
});

test("🔴 logAuditExterno: userId NULL, actorType «public» y el nombre en _mov.after.actor; la fila SÍ se escribe", async () => {
  const audit = (await import("@/lib/audit")) as typeof import("@/lib/audit") & { logAuditExterno?: unknown };
  assert.equal(typeof audit.logAuditExterno, "function", "en 3d51d9a94 no existía: el webhook usaba userId = clinicId");
  await audit.logAuditExterno({
    clinicId: "cli-1", actor: "public", origen: "Stripe (webhook)",
    entityType: "subscription", entityId: "cs_1", action: "update",
    changes: { subscriptionStatus: { before: "past_due", after: "active" } },
  });
  console.error = errorOriginal;
  assert.deepEqual(errores, []);
  assert.equal(filas.length, 1);
  const f = filas[0];
  assert.equal(f.userId, null);
  assert.equal(f.actorType, "public");
  assert.equal(f.clinicId, "cli-1");
  assert.deepEqual(f.changes.subscriptionStatus, { before: "past_due", after: "active" });
  assert.equal(f.changes._mov.after.actor, "Stripe (webhook)");
  const { etiquetaDeActorExterno } = await import("@/lib/movimientos-paciente/catalogo");
  assert.equal(etiquetaDeActorExterno("public", f.changes), "Stripe (webhook)", "así se nombra en /admin › Auditoría");
});

test("logAuditExterno sin clinicId no escribe ni lanza", async () => {
  const { logAuditExterno } = await import("@/lib/audit");
  await logAuditExterno({ clinicId: "", actor: "public", origen: "Stripe (webhook)", entityType: "subscription", entityId: "x", action: "update" });
  console.error = errorOriginal;
  assert.equal(filas.length, 0);
});

test("el webhook de Stripe ya no escribe ningún userId de mentira", async () => {
  const { readFileSync } = await import("node:fs");
  const fuente = readFileSync("src/app/api/webhooks/stripe/route.ts", "utf8");
  assert.doesNotMatch(fuente, /userId:\s*clinic(Id|\.id)\b/);
  assert.doesNotMatch(fuente, /\blogAudit\(/);
  assert.equal((fuente.match(/logAuditExterno\(\{/g) ?? []).length, 14);
});
