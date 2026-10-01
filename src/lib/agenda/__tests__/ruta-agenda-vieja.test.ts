/**
 * /dashboard/appointments (la agenda anterior al rediseño) — ws1-t4.
 *
 * Run: npm run test:agenda-ruta-vieja
 *
 * Con el rediseño encendido manda a /dashboard/agenda ANTES de leer citas;
 * apagado sigue siendo la agenda de la clínica pero exige agenda.view.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasPermission } from "@/lib/auth/permissions";
import { decidirAgendaVieja, destinoAgendaVieja } from "../ruta-agenda-vieja";

const puede = (role: any, override: string[] = []) =>
  hasPermission({ role, permissionsOverride: override }, "agenda.view");

test("rediseño encendido: todos los roles van a la agenda nueva", () => {
  for (const role of ["ADMIN", "RECEPTIONIST", "DOCTOR", "READONLY"])
    assert.equal(decidirAgendaVieja(true, puede(role)), "agenda-nueva", role);
});

test("rediseño apagado: dueño, recepción, doctor y solo lectura ven la pantalla vieja (todos traen agenda.view)", () => {
  for (const role of ["ADMIN", "RECEPTIONIST", "DOCTOR", "READONLY"])
    assert.equal(decidirAgendaVieja(false, puede(role)), "pantalla-vieja", role);
});

test("rediseño apagado y sin agenda.view (permiso a medida): se rechaza", () => {
  assert.equal(puede("RECEPTIONIST", ["today.view"]), false);
  assert.equal(decidirAgendaVieja(false, puede("RECEPTIONIST", ["today.view"])), "sin-permiso");
});

test("la query: se llevan date, highlight y solicitudes; lo demás se descarta", () => {
  assert.equal(destinoAgendaVieja(undefined), "/dashboard/agenda");
  assert.equal(destinoAgendaVieja({}), "/dashboard/agenda");
  assert.equal(
    destinoAgendaVieja({ new: "1", patient: "p1", patientId: "p1", view: "week", date: "2026-10-05", highlight: "a1", focus: "a2" }),
    "/dashboard/agenda?date=2026-10-05&highlight=a1",
  );
  assert.equal(destinoAgendaVieja({ solicitudes: "1", doctorId: "d1" }), "/dashboard/agenda?solicitudes=1");
  assert.equal(destinoAgendaVieja({ date: ["2026-10-05", "x"] }), "/dashboard/agenda?date=2026-10-05");
});

test("la agenda nueva entiende justo esos parámetros", () => {
  const nueva = readFileSync(join(process.cwd(), "src/app/dashboard/agenda/page.tsx"), "utf8");
  for (const k of ["date", "highlight"]) assert.match(nueva, new RegExp(`searchParams\\?\\.${k}`));
  assert.match(readFileSync(join(process.cwd(), "src/components/dashboard/agenda-nueva/agenda-nueva.tsx"), "utf8"), /get\("solicitudes"\)/);
});

test("la página vieja decide ANTES de leer citas y no se borró", () => {
  const src = readFileSync(join(process.cwd(), "src/app/dashboard/appointments/page.tsx"), "utf8");
  const decide = src.indexOf("decidirAgendaVieja(");
  assert.ok(decide > 0);
  assert.ok(decide < src.indexOf("prisma.appointment.findMany"));
  assert.match(src, /redirect\(destinoAgendaVieja\(searchParams\)\)/);
  assert.match(src, /requirePermissionOrRedirect\(user, "agenda\.view"\)/);
  assert.match(src, /menuDosNivelesEncendido\(user\.clinicId\)/);
});
