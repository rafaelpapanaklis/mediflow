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

// ───────────────────────── Ortodoncia en la bitácora (ws1-t5) ─────────────────────────
// Revisión de lógica de uso, fila 18 del mapa: las acciones de ortodoncia se
// leían en crudo, no había filtro «Ortodoncia» y una reasignación de doctor no
// decía de quién a quién.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIT_ENTITY_GROUP_ORTHO, AUDIT_ENTITY_OPTIONS, ORTHO_ACTIONS_CONOCIDAS,
  entityOptionsFor, esFilaDeOrtodoncia, fieldLabel, formatAuditFieldValue,
  idsDePersonas, resumenDeCambio,
} from "./audit-core";

const RAIZ = join(__dirname, "..", "..");

test("ortodoncia: toda acción que el módulo registra tiene nombre en español", () => {
  // Las del catálogo del módulo…
  const catalogo = readFileSync(join(RAIZ, "app/actions/orthodontics/audit-actions.ts"), "utf8");
  const acciones = Array.from(catalogo.matchAll(/"(ortho\.[A-Za-z0-9.]+)"/g)).map((m) => m[1]);
  assert.ok(acciones.length >= 35, "no encuentro el catálogo de acciones de ortodoncia");
  for (const a of acciones) {
    const meta = actionMeta(a);
    assert.notEqual(meta.label, a, `«${a}» se sigue leyendo en crudo`);
    assert.ok(!/ortho|\./i.test(meta.label), `«${meta.label}» no es un nombre para el dueño`);
  }
  // …y las que se escriben a mano fuera del catálogo.
  for (const a of ["ortho.elastics.compliance.recorded", "ortho.financialPlan.updated", "ortho.referralLetter.created"]) {
    assert.ok(ORTHO_ACTIONS_CONOCIDAS.includes(a), a);
  }
  assert.deepEqual(actionMeta("ortho.card.signed"), { label: "Hoja de control firmada", tone: "success" });
  // Las de siempre no cambian.
  assert.deepEqual(actionMeta("update"), { label: "Edición", tone: "info" });
});

test("ortodoncia: las entidades del módulo tienen nombre; una nueva cae en «Ortodoncia»", () => {
  assert.equal(entityLabel("OrthodonticTreatmentPlan"), "Caso de ortodoncia");
  assert.equal(entityLabel("OrthoTreatmentCard"), "Hoja de control");
  assert.equal(entityLabel("OrthodonticsClinicSettings"), "Configuración de Ortodoncia");
  assert.equal(entityLabel("OrthoAlgoNuevo"), "Ortodoncia");
  assert.equal(entityLabel(AUDIT_ENTITY_GROUP_ORTHO), "Ortodoncia (todo)");
});

test("ortodoncia: el filtro solo se ofrece en sedes con el módulo", () => {
  assert.deepEqual(entityOptionsFor({ ortodoncia: false }), [...AUDIT_ENTITY_OPTIONS]);
  const con = entityOptionsFor({ ortodoncia: true });
  assert.equal(con[0], AUDIT_ENTITY_GROUP_ORTHO);
  assert.equal(con.length, AUDIT_ENTITY_OPTIONS.length + 1);
});

test("ortodoncia: el filtro trae entidades y acciones del módulo, sin soltar la clínica ni la búsqueda", () => {
  const w = buildAuditWhere({ clinicId: "c1", entityType: AUDIT_ENTITY_GROUP_ORTHO, q: "abc" });
  assert.equal(w.clinicId, "c1");
  assert.equal(w.entityType, undefined);
  assert.deepEqual(w.AND, [
    { OR: [{ entityType: { startsWith: "Ortho" } }, { action: { startsWith: "ortho." } }] },
  ]);
  assert.equal((w.OR as unknown[]).length, 3, "la búsqueda libre se perdió");
  // Un filtro de entidad normal sigue igual.
  assert.deepEqual(buildAuditWhere({ entityType: "invoice" }), { entityType: "invoice" });
  assert.equal(esFilaDeOrtodoncia({ action: "update", entityType: "OrthoWireStep" }), true);
  assert.equal(esFilaDeOrtodoncia({ action: "ortho.collect.recorded", entityType: "invoice" }), true);
  assert.equal(esFilaDeOrtodoncia({ action: "update", entityType: "invoice" }), false);
});

test("ortodoncia: reasignar doctor dice de quién a quién", () => {
  const changes = {
    treatingDoctorId: { before: "u1", after: "u2" },
    status: { before: "IN_PROGRESS", after: "ON_HOLD" },
    totalCostMxn: { before: "35000", after: "38000.5" },
  };
  assert.deepEqual(idsDePersonas(changes).sort(), ["u1", "u2"]);
  const row = {
    entityType: "OrthodonticTreatmentPlan",
    changes,
    personas: { u1: "Ana López", u2: "Luis Gómez" },
  };
  assert.equal(
    resumenDeCambio(row),
    "Doctor tratante: Ana López → Luis Gómez · Estado del caso: En tratamiento → En pausa · Precio total: $35,000 → $38,000.5",
  );
  assert.equal(fieldLabel("treatingDoctorId", row.entityType), "Doctor tratante");
  assert.equal(formatAuditFieldValue("treatingDoctorId", null, row), "Sin asignar");
  // Un id sin nombre (persona de otra clínica o dada de baja) NUNCA se pinta como id.
  assert.equal(formatAuditFieldValue("treatingDoctorId", "u9", row), "Alguien que ya no está en el equipo");
});

test("ortodoncia: fuera del módulo, campos y valores se leen como siempre", () => {
  assert.equal(fieldLabel("status", "invoice"), "status");
  assert.equal(formatAuditFieldValue("status", "IN_PROGRESS", { entityType: "treatment" }), "IN_PROGRESS");
  assert.equal(formatAuditFieldValue("treatingDoctorId", "u1", { entityType: "invoice" }), "u1");
  assert.equal(resumenDeCambio({ entityType: "invoice", changes: { status: { before: "a", after: "b" } } }), null);
  assert.deepEqual(idsDePersonas({ doctorId: { before: "u1", after: "u2" } }), []);
  // Una creación o una fila sin campos legibles no lleva resumen.
  assert.equal(resumenDeCambio({ entityType: "OrthoWireStep", changes: { _created: { before: null, after: { a: 1 } } } }), null);
  assert.equal(resumenDeCambio({ entityType: "OrthoWireStep", changes: { gauge: { before: "a", after: "b" } } }), null);
});

test("ortodoncia: los nombres se resuelven solo con gente de la clínica de la fila", () => {
  const consulta = readFileSync(join(RAIZ, "lib/admin/audit.ts"), "utf8");
  assert.match(consulta, /where: \{ id: \{ in: todosLosIds \}, clinicId: \{ in: clinicas \} \}/);
  assert.match(consulta, /g\.id === id && g\.clinicId === r\.clinicId/);
  // La bitácora de la clínica sigue forzando la clínica de la sesión.
  const ruta = readFileSync(join(RAIZ, "app/api/auditoria/route.ts"), "utf8");
  assert.match(ruta, /clinicId: ctx\.clinicId, \/\/ FORZADO/);
  // Y la pantalla del dueño decide el filtro con el módulo REAL de la sesión.
  const pagina = readFileSync(join(RAIZ, "app/dashboard/auditoria/page.tsx"), "utf8");
  assert.match(pagina, /hasActiveOrthodonticsModule\(ctx\.clinicId\)/);
  assert.match(pagina, /ctx\.clinicCategory === "DENTAL"/);
});
