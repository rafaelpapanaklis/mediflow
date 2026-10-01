// A3 (auditoría 30-sep-2026): las solicitudes ARCO anónimas (clinicId null) son
// de la plataforma; ningún usuario de clínica las ve ni las edita.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { arcoEsDeMiClinica, armarCambioArco } from "../alcance";

const leer = (f: string) => readFileSync(f, "utf8");

test("la solicitud de mi clínica es mía; la de otra clínica no", () => {
  assert.equal(arcoEsDeMiClinica("clinA", "clinA"), true);
  assert.equal(arcoEsDeMiClinica("clinB", "clinA"), false);
});

test("la anónima (null) no es de NINGUNA clínica, ni de un dueño SUPER_ADMIN", () => {
  assert.equal(arcoEsDeMiClinica(null, "clinA"), false);
  assert.equal(arcoEsDeMiClinica(undefined, "clinA"), false);
});

test("sin clínica en la sesión nunca coincide (ni null/undefined contra null/undefined)", () => {
  assert.equal(arcoEsDeMiClinica("clinA", null), false);
  assert.equal(arcoEsDeMiClinica("clinA", undefined), false);
  assert.equal(arcoEsDeMiClinica(null, null), false);
  assert.equal(arcoEsDeMiClinica(undefined, undefined), false);
  assert.equal(arcoEsDeMiClinica("", ""), false);
});

test("armarCambioArco: resolver fija resolvedAt, reabrir lo limpia, estado inválido se rechaza", () => {
  const ahora = new Date("2026-10-01T00:00:00Z");
  assert.deepEqual(armarCambioArco({ status: "resolved" }, ahora), { data: { status: "RESOLVED", resolvedAt: ahora } });
  assert.deepEqual(armarCambioArco({ status: "REJECTED" }, ahora), { data: { status: "REJECTED", resolvedAt: ahora } });
  assert.deepEqual(armarCambioArco({ status: "PENDING" }, ahora), { data: { status: "PENDING", resolvedAt: null } });
  assert.deepEqual(armarCambioArco({ status: "IN_PROGRESS" }, ahora), { data: { status: "IN_PROGRESS", resolvedAt: null } });
  assert.deepEqual(armarCambioArco({ status: "HACKED" }), { error: "invalid_status" });
});

test("armarCambioArco: las notas se recortan a 4000 y lo que no es texto las borra", () => {
  const r = armarCambioArco({ resolvedNotes: "x".repeat(5000) });
  assert.ok("data" in r && r.data.resolvedNotes?.length === 4000);
  const n = armarCambioArco({ resolvedNotes: { a: 1 } });
  assert.ok("data" in n && n.data.resolvedNotes === null);
  assert.deepEqual(armarCambioArco({}), { data: {} });
});

test("GET y PATCH /api/arco/[id]: ya no hay rama SUPER_ADMIN para clinicId null", () => {
  const src = leer("src/app/api/arco/[id]/route.ts");
  assert.doesNotMatch(src, /user\.role\s*[!=]==/);
  assert.doesNotMatch(src, /clinicId === null/);
  assert.equal((src.match(/arcoEsDeMiClinica\(arco\.clinicId, user\.clinicId\)/g) ?? []).length, 2);
});

test("el panel de la clínica no consulta clinicId null y exige clínica en la sesión", () => {
  const page = leer("src/app/dashboard/settings/arco-requests/page.tsx");
  assert.doesNotMatch(page, /clinicId:\s*null/);
  assert.doesNotMatch(page, /user\.role/);
  assert.match(page, /if \(!clinicId\) redirect/);
  assert.match(page, /where:\s*\{\s*clinicId\s*\}/);
  const cliente = leer("src/app/dashboard/settings/arco-requests/arco-requests-client.tsx");
  assert.doesNotMatch(cliente, /anonymousRequests|isSuperAdmin/);
});

test("las anónimas solo se leen/editan desde /api/admin/arco con sesión de AdminUser y clinicId:null fijo", () => {
  const lista = leer("src/app/api/admin/arco/route.ts");
  const una = leer("src/app/api/admin/arco/[id]/route.ts");
  for (const src of [lista, una]) {
    assert.match(src, /getAdminSession\(\)/);
    assert.match(src, /clinicId:\s*null/);
    assert.doesNotMatch(src, /getCurrentUser|getAuthContext/);
  }
  assert.match(una, /updateMany\(\{\s*where:\s*\{\s*id:\s*params\.id,\s*clinicId:\s*null/);
  assert.match(leer("src/app/admin/arco/page.tsx"), /where:\s*\{\s*clinicId:\s*null\s*\}/);
});
