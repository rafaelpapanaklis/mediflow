/**
 * Tests unitarios de la lógica pura del panel de auditoría (WS-SEG · T3).
 * No toca Prisma — solo `audit-core.ts`. Correr con:
 *   npm run test:audit
 *   # o: npx tsx --test src/lib/admin/audit-core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampPage, clampPageSize, parseAuditDate, buildAuditWhere,
  normalizeChanges, formatAuditValue, actionMeta, entityLabel,
} from "./audit-core";

test("clampPage: default y saneo", () => {
  assert.equal(clampPage(undefined), 1);
  assert.equal(clampPage(0), 1);
  assert.equal(clampPage(-5), 1);
  assert.equal(clampPage(3), 3);
  assert.equal(clampPage(2.9), 2);
  assert.equal(clampPage(NaN), 1);
});

test("clampPageSize: default 50, máx 200", () => {
  assert.equal(clampPageSize(undefined), 50);
  assert.equal(clampPageSize(0), 50);
  assert.equal(clampPageSize(25), 25);
  assert.equal(clampPageSize(999), 200);
  assert.equal(clampPageSize(NaN), 50);
});

test("parseAuditDate: date-only ancla inicio/fin de día; inválida = null", () => {
  assert.equal(parseAuditDate(undefined, false), null);
  assert.equal(parseAuditDate("no-es-fecha", false), null);
  const start = parseAuditDate("2026-06-22", false);
  const end = parseAuditDate("2026-06-22", true);
  assert.ok(start instanceof Date && end instanceof Date);
  assert.ok((end as Date).getTime() > (start as Date).getTime());
  assert.ok(parseAuditDate("2026-06-22T10:30:00.000Z", false) instanceof Date);
});

test("buildAuditWhere: filtros vacíos = where vacío", () => {
  assert.deepEqual(buildAuditWhere({}), {});
});

test("buildAuditWhere: escalares pasan directo", () => {
  const w = buildAuditWhere({ clinicId: "c1", userId: "u1", action: "update", entityType: "patient", entityId: "p1" });
  assert.equal(w.clinicId, "c1");
  assert.equal(w.userId, "u1");
  assert.equal(w.action, "update");
  assert.equal(w.entityType, "patient");
  assert.equal(w.entityId, "p1");
});

test("buildAuditWhere: rol válido filtra la relación; inválido se ignora", () => {
  assert.deepEqual(buildAuditWhere({ role: "ADMIN" }).user, { role: "ADMIN" });
  assert.equal(buildAuditWhere({ role: "HACKER" }).user, undefined);
});

test("buildAuditWhere: q arma OR sobre entityId/ip/userAgent", () => {
  const w = buildAuditWhere({ q: "  1.2.3.4 " });
  assert.ok(Array.isArray(w.OR));
  assert.equal((w.OR as unknown[]).length, 3);
});

test("buildAuditWhere: rango de fechas en createdAt", () => {
  const w = buildAuditWhere({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
  const c = w.createdAt as { gte?: Date; lte?: Date };
  assert.ok(c.gte instanceof Date && c.lte instanceof Date);
  assert.ok(c.lte.getTime() > c.gte.getTime());
});

test("normalizeChanges: vacío / created / deleted / updated", () => {
  assert.deepEqual(normalizeChanges(null), { kind: "empty", fields: [] });

  const created = normalizeChanges({ _created: { before: null, after: { a: 1, b: "x" } } });
  assert.equal(created.kind, "created");
  assert.equal(created.fields.length, 2);
  assert.deepEqual(created.fields.find((f) => f.field === "a"), { field: "a", before: null, after: 1 });

  const deleted = normalizeChanges({ _deleted: { before: { a: 1 }, after: null } });
  assert.equal(deleted.kind, "deleted");
  assert.equal(deleted.fields[0].field, "a");
  assert.equal(deleted.fields[0].before, 1);

  const updated = normalizeChanges({ name: { before: "a", after: "b" } });
  assert.equal(updated.kind, "updated");
  assert.deepEqual(updated.fields[0], { field: "name", before: "a", after: "b" });
});

test("formatAuditValue: nulos, vacío, primitivos y objetos", () => {
  assert.equal(formatAuditValue(null), "—");
  assert.equal(formatAuditValue(undefined), "—");
  assert.equal(formatAuditValue(""), "(vacío)");
  assert.equal(formatAuditValue(5), "5");
  assert.equal(formatAuditValue(true), "true");
  assert.equal(formatAuditValue({ a: 1 }), '{"a":1}');
});

test("actionMeta / entityLabel: conocidos y fallback", () => {
  assert.deepEqual(actionMeta("create"), { label: "Creación", tone: "success" });
  assert.deepEqual(actionMeta("rarito"), { label: "rarito", tone: "neutral" });
  assert.equal(entityLabel("patient"), "Paciente");
  assert.equal(entityLabel("ped-guardian"), "Pediatría");
  assert.equal(entityLabel("loquesea"), "loquesea");
});
