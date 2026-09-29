/**
 * ws1-t3 — el acceso al módulo de Ortodoncia POR PERSONA (ws1-t2: ahora es la casilla «Ortodoncia» de «Módulos de especialidades»).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/acceso-doctor.test.ts
 *
 *  · Doctor ortodoncista ve el módulo; solo dental no; sede sin módulo no;
 *    recepción cobra (dinero) sin necesitar nada clínico.
 *  · Quien ya existe conserva lo que tiene: un doctor sin override trae el
 *    módulo (default del rol) y no se le quita nada al abrir la pantalla.
 *  · El alta lleva la casilla «Ortodoncia» y el servidor
 *    parte del default del rol: nunca acepta una lista de permisos del cliente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, hasPermission, getEffectivePermissions } from "@/lib/auth/permissions";
import { decidirEntradaAlModulo } from "../contratar";
import { vistaOrtoPorPermisos } from "../pestana-ficha";
import {
  ESPECIALIDAD_ORTODONCIA,
  LLAVE_MODULO_ORTODONCIA,
  esAccesoOrtodoncia,
  overrideConAcceso,
  tieneAccesoOrtodoncia,
} from "../acceso-doctor";
import { esOrtodoncista } from "../doctores-tratantes";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

/** El doctor que el alta deja con «solo dental». */
function soloDental() {
  return { role: "DOCTOR" as const, permissionsOverride: overrideConAcceso({ role: "DOCTOR", permissionsOverride: [] }, "solo_dental")! };
}
/** El doctor que el alta deja con «también ortodoncista». */
function ortodoncista() {
  return { role: "DOCTOR" as const, permissionsOverride: overrideConAcceso({ role: "DOCTOR", permissionsOverride: [] }, "ortodoncista")! };
}

/** Lo que decide el guardia del módulo para una persona en una sede. */
function entrada(user: { role: string; permissionsOverride?: string[] }, sede: { dental?: boolean; modulo: boolean }) {
  return decidirEntradaAlModulo({
    esDental: sede.dental ?? true,
    tienePermiso: tieneAccesoOrtodoncia(user),
    moduloActivo: sede.modulo,
  });
}

test("el permiso se llama «Acceso al módulo de Ortodoncia» y es UNA sola llave de ortodoncia", () => {
  assert.equal(LLAVE_MODULO_ORTODONCIA, "specialties.orthodontics");
  assert.match(ALL_PERMISSIONS["specialties.orthodontics"], /^Acceso al módulo de Ortodoncia/);
  const deOrtodoncia = Object.keys(ALL_PERMISSIONS).filter((k) => /orthodont/i.test(k));
  assert.deepEqual(deOrtodoncia, ["specialties.orthodontics"], "no hay orthodontics.* sueltas que agrupar");
});

test("doctor ortodoncista ve el módulo", () => {
  const d = ortodoncista();
  assert.equal(tieneAccesoOrtodoncia(d), true);
  assert.deepEqual(entrada(d, { modulo: true }), { tipo: "modulo" });
});

test("doctor «solo dental» no ve el módulo: ni el guardia, ni la pestaña del paciente", () => {
  const d = soloDental();
  assert.equal(tieneAccesoOrtodoncia(d), false);
  assert.deepEqual(entrada(d, { modulo: true }), { tipo: "redirigir", a: "/dashboard" });
  assert.equal(
    vistaOrtoPorPermisos({ acceso: "completo", llaveModulo: tieneAccesoOrtodoncia(d), verExpediente: hasPermission(d, "medicalRecord.view") }),
    "oculta",
  );
  // …y sigue siendo un doctor completo en todo lo demás.
  const conservado = getEffectivePermissions(d);
  const esperado = ROLE_DEFAULT_PERMISSIONS.DOCTOR.filter((k) => k !== LLAVE_MODULO_ORTODONCIA);
  assert.deepEqual([...conservado].sort(), [...esperado].sort());
  assert.equal(hasPermission(d, "medicalRecord.edit"), true);
});

test("sede sin el módulo contratado: ni el ortodoncista entra (va a contratar); sede no dental, a /dashboard", () => {
  assert.equal(entrada(ortodoncista(), { modulo: false }).tipo, "redirigir");
  assert.deepEqual(entrada(ortodoncista(), { modulo: false }), { tipo: "redirigir", a: "/dashboard/contratar/ortodoncia" });
  assert.deepEqual(entrada(ortodoncista(), { dental: false, modulo: true }), { tipo: "redirigir", a: "/dashboard" });
});

test("recepción cobra: tiene el módulo y billing.charge por default, sin expediente clínico", () => {
  const r = { role: "RECEPTIONIST" as const, permissionsOverride: [] as string[] };
  assert.equal(tieneAccesoOrtodoncia(r), true);
  assert.equal(hasPermission(r, "billing.charge"), true);
  assert.equal(hasPermission(r, "medicalRecord.edit"), false);
  assert.deepEqual(entrada(r, { modulo: true }), { tipo: "modulo" });
  // El doctor, en cambio, registra sin cobrar: la llave del módulo no le da dinero.
  assert.equal(hasPermission(ortodoncista(), "billing.charge"), false);
});

test("a quien ya existe no se le quita nada: un doctor sin override conserva el módulo", () => {
  assert.equal(tieneAccesoOrtodoncia({ role: "DOCTOR", permissionsOverride: [] }), true);
  assert.equal(tieneAccesoOrtodoncia({ role: "DOCTOR" }), true);
  assert.equal(tieneAccesoOrtodoncia({ role: "ADMIN", permissionsOverride: null }), true);
  assert.equal(tieneAccesoOrtodoncia({ role: "READONLY", permissionsOverride: [] }), false);
});

test("«también ortodoncista» sobre el alta no escribe override: sigue el default del rol", () => {
  assert.deepEqual(overrideConAcceso({ role: "DOCTOR", permissionsOverride: [] }, "ortodoncista"), []);
});

test("overrideConAcceso: quitar y volver a dar la llave, sobre un override que ya existe", () => {
  const base = { role: "DOCTOR" as const, permissionsOverride: ["patients.view", "specialties.orthodontics", "agenda.view"] };
  assert.deepEqual(overrideConAcceso(base, "solo_dental"), ["patients.view", "agenda.view"]);
  const sin = { role: "DOCTOR" as const, permissionsOverride: ["patients.view", "agenda.view"] };
  assert.deepEqual(overrideConAcceso(sin, "ortodoncista"), ["patients.view", "agenda.view", "specialties.orthodontics"]);
  // ya está como se pide → no cambia nada
  assert.deepEqual(overrideConAcceso(base, "ortodoncista"), base.permissionsOverride);
  assert.deepEqual(overrideConAcceso(sin, "solo_dental"), sin.permissionsOverride);
});

test("overrideConAcceso nunca devuelve [] al quitar (un override vacío = default del rol, que la trae)", () => {
  assert.equal(overrideConAcceso({ role: "DOCTOR", permissionsOverride: ["specialties.orthodontics"] }, "solo_dental"), null);
  for (const acceso of ["solo_dental", "ortodoncista"] as const) {
    const r = overrideConAcceso({ role: "DOCTOR", permissionsOverride: [] }, acceso);
    if (acceso === "solo_dental") assert.ok(r && r.length > 0);
  }
});

test("esAccesoOrtodoncia solo acepta las dos respuestas", () => {
  assert.equal(esAccesoOrtodoncia("ortodoncista"), true);
  assert.equal(esAccesoOrtodoncia("solo_dental"), true);
  for (const x of ["", "admin", null, undefined, 1, ["ortodoncista"]]) assert.equal(esAccesoOrtodoncia(x), false);
});

test("las server actions del módulo exigen la llave además del módulo contratado", () => {
  for (const rel of [
    "src/app/actions/orthodontics/_helpers.ts",
  ]) {
    const src = leer(rel);
    const funciones = src.split(/\nexport async function /).slice(1).filter((f) => f.includes("hasActiveOrthodonticsModule"));
    assert.equal(funciones.length, 4, "los cuatro contextos comunes");
    for (const f of funciones) {
      assert.match(f, /tieneAccesoOrtodoncia\(/, `${f.slice(0, 40)}… no comprueba la llave`);
      assert.ok(f.indexOf("tieneAccesoOrtodoncia(") > f.indexOf("hasActiveOrthodonticsModule("), "la llave va después del módulo");
    }
  }
  for (const rel of [
    "src/app/actions/orthodontics/recepcion/_ctx.ts",
    "src/app/actions/orthodontics/getTreatmentPlanIdForAppointment.ts",
    "src/app/actions/orthodontics/agendarRevisionRetencion.ts",
    "src/app/actions/orthodontics/agendarProximoControlDesdeCard.ts",
    "src/app/actions/orthodontics/whatsapp/sendControlInstructions.ts",
    "src/app/actions/orthodontics/whatsapp/sendMensualidadReminder.ts",
    "src/app/actions/orthodontics/whatsapp/avisarProximoControlAlPaciente.ts",
    "src/app/api/orthodontics/context/route.ts",
    "src/app/api/orthodontics/imagen/upload/route.ts",
    "src/app/api/orthodontics/photos/upload/route.ts",
    "src/app/api/orthodontics/treatment-plans/[id]/progress-report-pdf/route.tsx",
    "src/app/api/orthodontics/treatment-plans/[id]/discharge-letter-pdf/route.tsx",
  ]) {
    assert.match(leer(rel), /tieneAccesoOrtodoncia\(/, `${rel} no comprueba la llave por persona`);
  }
});

test("la agenda no calcula la insignia de mensualidad vencida para quien no tiene el módulo", () => {
  const server = leer("src/lib/agenda/server.ts");
  assert.equal((server.match(/filter\.ortoAcceso === false/g) ?? []).length, 2, "día y rango");
  for (const rel of [
    "src/app/dashboard/agenda/page.tsx",
    "src/app/api/appointments/route.ts",
    "src/app/api/agenda/range/route.ts",
    "src/app/api/dashboard/home/receptionist/route.ts",
    "src/app/api/dashboard/home/doctor/route.ts",
  ]) {
    assert.match(leer(rel), /ortoAcceso: hasPermission\(/, `${rel} no pasa ortoAcceso`);
  }
});

test("el alta (POST /api/team): solo un DOCTOR de sede dental CON módulo, y sin aceptar permisos del cliente", () => {
  const post = leer("src/app/api/team/route.ts");
  assert.match(post, /esAccesoOrtodoncia\(accesoOrtodoncia\) && rolNuevo === "DOCTOR" && ctx!\.clinicCategory === "DENTAL"/);
  assert.match(post, /hasActiveOrthodonticsModule\(ctx!\.clinicId\)/);
  assert.match(post, /overrideConAcceso\(\{ role: "DOCTOR", permissionsOverride: \[\] \}, acceso\)/);
  assert.doesNotMatch(post, /permissionsOverride:\s*body\./, "el override nunca sale del body");
  assert.doesNotMatch(post, /const \{[^}]*permissionsOverride[^}]*\} = body/);
});

test("la edición (PATCH /api/team/[id]): solo el dueño cambia permisos, y se rechaza si dejaría a la persona sin nada", () => {
  const patch = leer("src/app/api/team/[id]/route.ts");
  assert.match(patch, /esAccesoOrtodoncia\(body\.accesoOrtodoncia\)/);
  assert.match(patch, /if \(!ctx!\.isSuperAdmin\)/);
  assert.match(patch, /overrideConAcceso\(\{ role: efectivoRol, permissionsOverride: member\.permissionsOverride \}/);
  assert.match(patch, /nuevo === null/);
});

test("la pantalla de Equipo pinta «Módulos de especialidades» solo a un doctor de sede dental; deshabilitada sin el módulo", () => {
  const page = leer("src/app/dashboard/team/page.tsx");
  assert.match(page, /hasActiveOrthodonticsModule\(user\.clinicId\)/);
  const cliente = leer("src/app/dashboard/team/team-client.tsx");
  assert.match(cliente, /seccionModulosVisible\(\{ role: form\.role, sedeDental \}\)/);
  assert.match(cliente, /verModulos && \(/);
  assert.match(cliente, /puedeCambiarAcceso=\{isSuperAdmin\}/, "en la edición solo el dueño");
});
