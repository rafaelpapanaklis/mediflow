/**
 * «Mi perfil»: un DOCTOR edita SUS datos profesionales (cédula…), nunca su rol ni sus permisos
 * (ws1-t1, 3-oct-2026).
 *
 * Run: npm run test:mi-perfil
 *
 * Antes un DOCTOR no tenía `team.edit` (Equipo) ni `settings.view` (Configuración → Perfil) y
 * PATCH /api/users/me solo guardaba nombre, teléfono y especialidad: su cédula solo la cambiaba el dueño. Con el
 * código viejo la ruta no guarda la cédula y no hay página ni enlace para quien no tiene settings.view.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cambiosDeMiPerfil, leerCambiosPropios } from "@/lib/team/mis-datos-profesionales";

const yo: any = {
  id: "doc-daisy", clinicId: "c1", role: "DOCTOR", permissionsOverride: [],
  firstName: "Daisy", lastName: "Prueba", phone: "5550000000", specialty: "dental",
  cedulaProfesional: "1234567", especialidad: null, cedulaEspecialidad: null,
};
let updates: any[];
let bitacora: any[];
beforeEach(() => { updates = []; bitacora = []; });

(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => ({ user: yo, userId: yo.id, clinicId: yo.clinicId, role: yo.role }) } });
(mock as any).module("@/lib/audit", { namedExports: { logMutation: async (a: any) => { bitacora.push(a); } } });
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      user: {
        update: async (a: any) => { updates.push(a); return { ...yo, ...a.data, email: "daisy@example.com", supabaseId: "x" }; },
      },
    },
  },
});

const req = (body: any) => ({ json: async () => body, headers: new Headers() }) as any;

test("la doctora guarda su cédula, su especialidad oficial y su cédula de especialidad en SU fila", async () => {
  const { PATCH } = await import("@/app/api/users/me/route");
  const r = await PATCH(req({ cedulaProfesional: " 7654321 ", especialidad: "Ortodoncia y Ortopedia Dentomaxilofacial", cedulaEspecialidad: "998877" }));
  assert.equal(r.status, 200);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].where, { id: "doc-daisy" }, "siempre la fila de la sesión");
  assert.deepEqual(updates[0].data, {
    cedulaProfesional: "7654321",
    especialidad: "Ortodoncia y Ortopedia Dentomaxilofacial",
    cedulaEspecialidad: "998877",
  });
  assert.equal(bitacora.length, 1, "queda en la bitácora");
  assert.equal(bitacora[0].entityId, "doc-daisy");
  assert.equal(bitacora[0].before.cedulaProfesional, "1234567");
  assert.equal(bitacora[0].after.cedulaProfesional, "7654321");
});

test("rol, permisos, estado, correo, color, agenda o clínica en el cuerpo NO se escriben", async () => {
  const { PATCH } = await import("@/app/api/users/me/route");
  const r = await PATCH(req({
    role: "SUPER_ADMIN", permissionsOverride: ["team.edit"], isActive: true, email: "otra@example.com",
    color: "#000000", agendaActive: false, clinicId: "c2", id: "otro", supabaseId: "y", cedulaProfesional: "111",
  }));
  assert.equal(r.status, 200);
  assert.deepEqual(updates[0].data, { cedulaProfesional: "111" });
  assert.deepEqual(updates[0].where, { id: "doc-daisy" });
});

test("nombre vacío o un campo demasiado largo: 400 y nada se escribe", async () => {
  const { PATCH } = await import("@/app/api/users/me/route");
  assert.equal((await PATCH(req({ firstName: "   " }))).status, 400);
  assert.equal((await PATCH(req({ cedulaProfesional: "9".repeat(31) }))).status, 400);
  assert.equal((await PATCH(req({ cedulaProfesional: 1234567 }))).status, 400);
  assert.equal(updates.length, 0);
});

test("lectura pura: los datos NOM-024 se pueden borrar a propósito; teléfono y especialidad vacíos no se tocan", () => {
  assert.deepEqual(leerCambiosPropios({ cedulaEspecialidad: "", especialidad: null }), {
    ok: true, data: { cedulaEspecialidad: null, especialidad: null },
  });
  assert.deepEqual(leerCambiosPropios({ phone: "", specialty: "" }), { ok: true, data: {} });
  assert.deepEqual(leerCambiosPropios({ firstName: " Ana  María ", lastName: "López" }), {
    ok: true, data: { firstName: "Ana María", lastName: "López" },
  });
  assert.equal(leerCambiosPropios({ lastName: null }).ok, false);
  assert.deepEqual(leerCambiosPropios(null), { ok: true, data: {} });
});

test("«Mi perfil» solo manda lo que cambió", () => {
  const base = { firstName: "Daisy", lastName: "Prueba", phone: "1", specialty: "Odontología General", cedulaProfesional: "1", especialidad: "", cedulaEspecialidad: "" };
  assert.deepEqual(cambiosDeMiPerfil(base, { ...base, cedulaProfesional: "2" }), { cedulaProfesional: "2" });
  assert.deepEqual(cambiosDeMiPerfil(base, { ...base }), {});
});

test("sin settings.view, «Mi perfil» lleva a /dashboard/mi-perfil (menú nuevo, menú clásico y Configuración)", () => {
  const menu = readFileSync(join(process.cwd(), "src/components/dashboard/menu-dos-niveles/menu-dos-niveles.tsx"), "utf8");
  assert.match(menu, /const puedeVerPerfil = !isExpired;/);
  assert.match(menu, /puede\("settings\.view"\) \? "\/dashboard\/settings\?tab=perfil" : "\/dashboard\/mi-perfil"/);
  const ajustes = readFileSync(join(process.cwd(), "src/app/dashboard/settings/page.tsx"), "utf8");
  const salto = ajustes.indexOf('redirect("/dashboard/mi-perfil")');
  assert.ok(salto > 0 && salto < ajustes.indexOf('requirePermissionOrRedirect(user, "settings.view")'), "antes del rebote por permiso");
  const lateral = readFileSync(join(process.cwd(), "src/components/dashboard/sidebar.tsx"), "utf8");
  assert.match(lateral, /href="\/dashboard\/settings\?tab=perfil"/);
  // La página no pide permiso propio y nunca edita rol ni correo.
  const pagina = readFileSync(join(process.cwd(), "src/app/dashboard/mi-perfil/mi-perfil-client.tsx"), "utf8");
  assert.doesNotMatch(readFileSync(join(process.cwd(), "src/app/dashboard/mi-perfil/page.tsx"), "utf8"), /requirePermissionOrRedirect/);
  assert.match(pagina, /id="mp-rol"[^>]*disabled/);
  assert.match(pagina, /id="mp-correo"[^>]*disabled/);
});
