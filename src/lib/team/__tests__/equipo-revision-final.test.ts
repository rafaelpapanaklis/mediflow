/**
 * Equipo — arreglos de la revisión final (ws1-t2 sobre los hallazgos de ws1-t5).
 *
 * `npm run test:equipo-revision-final`
 *
 *  · T1 (pérdida de datos NOM-024): el modal «Editar» arranca con TODO lo guardado
 *    y al guardar solo viaja lo que se tocó. Más la causa raíz: la página de Equipo
 *    trae los tres campos.
 *  · T2: recepción no lleva datos de médico.
 *  · T5: qué se muestra en Permisos y cuándo «Usar default del rol» sale encendido.
 *  · M1: el menú dice «Antes y Después».
 *  · Textos nuevos: español e inglés con las mismas claves.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CAMPOS_DEL_PARCHE,
  formDeMiembro,
  parcheDeCambios,
  rolLlevaDatosClinicos,
  type MiembroGuardado,
} from "../parche-miembro";
import {
  CLAVES_OCULTAS_EN_MODAL,
  diferenciasConElRol,
  gruposVisibles,
  sigueElDefaultDelRol,
} from "../permisos-modal";
import {
  ALL_PERMISSIONS,
  ALL_PERMISSION_KEYS,
  PERMISSION_GROUPS,
  ROLE_DEFAULT_PERMISSIONS,
  type PermissionKey,
} from "@/lib/auth/permissions";
import { NAV_ITEMS } from "@/components/dashboard/sidebar-nav";
import { TEXTOS_EQUIPO } from "@/app/dashboard/team/textos-equipo";

const RAIZ = join(__dirname, "..", "..", "..", "..");

const doctor: MiembroGuardado = {
  firstName: "Johnnifer", lastName: "Benitez", email: "j@x.com", role: "DOCTOR",
  specialty: "Ortodoncia", color: "#7c3aed", phone: "4521214617", services: ["Ortodoncia", "Brackets"],
  cedulaProfesional: "2747272", especialidad: "Ortodoncia y Ortopedia", cedulaEspecialidad: "9988776",
};

/* ── T1 ─────────────────────────────────────────────────────────────── */

test("🔴 T1: el modal arranca con la cédula, la especialidad oficial y todo lo demás", () => {
  const f = formDeMiembro(doctor);
  assert.equal(f.cedulaProfesional, "2747272");
  assert.equal(f.cedulaEspecialidad, "9988776");
  assert.equal(f.especialidad, "Ortodoncia y Ortopedia");
  assert.equal(f.phone, "4521214617");
  assert.equal(f.color, "#7c3aed");
  assert.deepEqual(f.services, ["Ortodoncia", "Brackets"]);
  assert.equal(f.email, "j@x.com");
  assert.equal(f.specialty, "Ortodoncia");
});

test("🔴 T1: guardar sin tocar nada no manda nada; cambiar el teléfono manda SOLO el teléfono", () => {
  const inicial = formDeMiembro(doctor);
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial }), {});
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial, phone: "5550000000" }), { phone: "5550000000" });
});

test("🔴 T1: aunque un campo llegara vacío al modal, si nadie lo tocó no viaja (no se pisa el dato)", () => {
  // La página vieja no traía la cédula: el modal la mostraba vacía.
  const sinCedula = formDeMiembro({ ...doctor, cedulaProfesional: undefined, especialidad: undefined });
  const parche = parcheDeCambios(sinCedula, { ...sinCedula, phone: "5551112222" });
  assert.deepEqual(Object.keys(parche), ["phone"]);
  assert.equal("cedulaProfesional" in parche, false);
  assert.equal("especialidad" in parche, false);
});

test("borrar la cédula a propósito SÍ viaja (vacía) y escribir una nueva también", () => {
  const inicial = formDeMiembro(doctor);
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial, cedulaProfesional: "" }), { cedulaProfesional: "" });
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial, cedulaProfesional: "555" }), { cedulaProfesional: "555" });
});

test("servicios: el orden o un elemento distinto cuentan como cambio; la misma lista no", () => {
  const inicial = formDeMiembro(doctor);
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial, services: ["Ortodoncia", "Brackets"] }), {});
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial, services: ["Ortodoncia"] }), { services: ["Ortodoncia"] });
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial, services: [...inicial.services, "Limpieza"] }).services?.length, 3);
});

test("null y undefined de la base son campo vacío, no un cambio", () => {
  const inicial = formDeMiembro({ ...doctor, phone: null, specialty: undefined });
  assert.equal(inicial.phone, "");
  assert.deepEqual(parcheDeCambios(inicial, { ...inicial }), {});
});

test("el parche solo puede llevar campos de la lista (nada de isActive, permisos ni supabaseId)", () => {
  const inicial = formDeMiembro(doctor);
  const raro = { ...inicial, isActive: false, supabaseId: "x" } as any;
  for (const k of Object.keys(parcheDeCambios(inicial, raro))) assert.ok((CAMPOS_DEL_PARCHE as readonly string[]).includes(k), k);
});

test("🔴 T1 causa raíz: la página de Equipo trae los tres campos NOM-024", () => {
  const fuente = readFileSync(join(RAIZ, "src/app/dashboard/team/page.tsx"), "utf8");
  for (const campo of ["cedulaProfesional", "especialidad", "cedulaEspecialidad"]) {
    assert.match(fuente, new RegExp(`${campo}:\\s*true`), `page.tsx debe seleccionar ${campo}`);
  }
});

/* ── T2 ─────────────────────────────────────────────────────────────── */

test("T2: recepción y solo lectura no llevan datos de médico; doctor, admin y dueño sí", () => {
  assert.equal(rolLlevaDatosClinicos("RECEPTIONIST"), false);
  assert.equal(rolLlevaDatosClinicos("READONLY"), false);
  for (const r of ["DOCTOR", "ADMIN", "SUPER_ADMIN"]) assert.equal(rolLlevaDatosClinicos(r), true, r);
});

/* ── T5 ─────────────────────────────────────────────────────────────── */

test("T5: Permisos no enseña Marketplace ni las especialidades que ya no se contratan", () => {
  const visibles = gruposVisibles(PERMISSION_GROUPS).flatMap((g) => g.keys);
  for (const k of ["marketplace.view", "specialties.pediatrics", "specialties.endodontics", "specialties.periodontics", "specialties.implants"] as PermissionKey[]) {
    assert.equal(visibles.includes(k), false, k);
  }
  assert.ok(visibles.includes("specialties.orthodontics"), "el interruptor de Ortodoncia por persona se queda");
  assert.equal(gruposVisibles(PERMISSION_GROUPS).some((g) => g.title === "Marketplace"), false);
  assert.ok(gruposVisibles(PERMISSION_GROUPS).some((g) => g.title === "Ortodoncia"));
});

test("T5: ocultar NO borra: los permisos siguen existiendo y en los defaults de los roles", () => {
  for (const k of CLAVES_OCULTAS_EN_MODAL) {
    assert.ok(k in ALL_PERMISSIONS, k);
    assert.ok(PERMISSION_GROUPS.some((g) => g.keys.includes(k)), `${k} sigue en PERMISSION_GROUPS`);
  }
  assert.ok(ROLE_DEFAULT_PERMISSIONS.SUPER_ADMIN.includes("marketplace.view"));
});

test("T5: 'Usar default del rol' — vacío, o igual al rol (en otro orden), sale encendido", () => {
  const doc = ROLE_DEFAULT_PERMISSIONS.DOCTOR;
  assert.equal(sigueElDefaultDelRol([], doc), true);
  assert.equal(sigueElDefaultDelRol(null, doc), true);
  assert.equal(sigueElDefaultDelRol([...doc].reverse(), doc), true);
});

test("T5: 'Usar default del rol' — un override que difiere (solo dental, o uno de más) sale apagado", () => {
  const doc = ROLE_DEFAULT_PERMISSIONS.DOCTOR;
  const soloDental = doc.filter((k) => k !== "specialties.orthodontics");
  assert.equal(sigueElDefaultDelRol(soloDental, doc), false);
  const extra = ALL_PERMISSION_KEYS.find((k) => !doc.includes(k))!;
  assert.equal(sigueElDefaultDelRol([...doc, extra], doc), false, "uno de más ya es 'propio'");
  assert.equal(sigueElDefaultDelRol(["today.view"], doc), false);
});

test("T5: el aviso de diferencias dice 'sin Ortodoncia' para un solo-dental y calla lo oculto", () => {
  const doc = ROLE_DEFAULT_PERMISSIONS.DOCTOR;
  const sel = doc.filter((k) => k !== "specialties.orthodontics" && k !== "marketplace.view");
  const d = diferenciasConElRol(sel, doc);
  assert.deepEqual(d.sinLoDelRol, ["specialties.orthodontics"]);
  assert.deepEqual(d.ademasDelRol, []);
});

/* ── M1 ─────────────────────────────────────────────────────────────── */

test("M1: el menú dice «Antes y Después» (igual que el título de la página)", () => {
  const item = NAV_ITEMS.find((i) => i.id === "before-after");
  assert.equal(item?.label, "Antes y Después");
  const dic = JSON.parse(readFileSync(join(RAIZ, "src/i18n/dictionaries/es.json"), "utf8"));
  assert.equal(dic.sidebar.nav["before-after"], "Antes y Después");
  assert.equal(dic.menuDosNiveles.nav["before-after"], "Antes y Después");
  assert.equal(dic.shell.topbar.routeAntesDespues, "Antes y Después");
});

/* ── Textos ─────────────────────────────────────────────────────────── */

test("los textos nuevos de Equipo existen en español e inglés con las mismas claves", () => {
  assert.deepEqual(Object.keys(TEXTOS_EQUIPO.es).sort(), Object.keys(TEXTOS_EQUIPO.en).sort());
  for (const [k, v] of Object.entries(TEXTOS_EQUIPO.es)) {
    const otro = (TEXTOS_EQUIPO.en as Record<string, unknown>)[k];
    assert.equal(typeof otro, typeof v, k);
  }
});

test("T2/T3: 'Restablecer', y ningún texto de alta genérico dice 'doctor'", () => {
  const x = TEXTOS_EQUIPO.es;
  assert.equal(x.restablecerBtn, "Restablecer contraseña");
  assert.match(x.restablecerConfirmTitulo("Ana"), /Restablecer la contraseña de Ana/);
  for (const t of [x.agregarMiembro, x.altaIntro, x.crearCuenta, x.emailHintAlta, x.tempCreadaTitulo, x.miembroDesactivado, x.miembroEliminado]) {
    assert.doesNotMatch(t, /doctor/i, t);
  }
  assert.match(x.altaIntro, /contraseña temporal/);
  assert.match(x.altaIntro, /No se envía ninguna invitación/);
});
