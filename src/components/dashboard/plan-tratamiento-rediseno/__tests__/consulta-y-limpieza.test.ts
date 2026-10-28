/**
 * Fase 2 · P9 y P10 (ws1-t5).
 *  · P9 — Consulta → plan: lo que la Nueva consulta le pasa a la ventana rápida (odontograma de
 *    ESA consulta, diagnóstico y pronóstico), y que el formulario lo abra sin tocar su texto libre.
 *  · P10 — Limpieza: «Planes de tratamiento» en el menú nuevo (y solo ahí), y la ficha cuenta
 *    sesiones HECHAS en el Resumen y en la pestaña del plan.
 *
 * Run: npm run test:plan-consulta
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hallazgosPorTratar, sesionesHechas } from "../plan-clinico";
import { chipsDelPlan, entradasDeRegistros, precargaDeConsulta } from "../armar-plan";
import { NAV_ITEMS, shouldShowItem, type SidebarUser, type UserRole } from "@/components/dashboard/sidebar-nav";
import { GRUPOS, ICONO_DE, armarMenu, opcionesVisibles } from "@/components/dashboard/menu-dos-niveles/estructura";

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

// ═══════════════════════════════════════════════════════════════════════════
// P9 · Consulta → plan
// ═══════════════════════════════════════════════════════════════════════════

/** El odontograma de una consulta tal como lo tiene el formulario (letras de PANTALLA). */
const CONSULTA = {
  11: { surfaces: { I: ["caries"], M: ["caries"] }, tooth: [] },          // anterior: la «I» es la «O» de la base
  36: { surfaces: {}, tooth: ["pulpitis"], note: "dolor nocturno" },     // la nota no es un hallazgo
  46: { surfaces: { O: ["restoration"] }, tooth: ["crown", "crown"] },   // trabajo hecho (y un repetido)
  "48": { surfaces: {}, tooth: ["ext_indicated"] },
  99: undefined,
};

test("el odontograma de la consulta pasa a entradas con caras de la base y sin la nota", () => {
  assert.deepEqual(entradasDeRegistros(CONSULTA).map((e) => `${e.toothNumber}${e.surface ?? "·"}:${e.conditionId}`), [
    "11O:caries", "11M:caries", "36·:pulpitis", "46O:restoration", "46·:crown", "48·:ext_indicated",
  ]);
  assert.deepEqual(entradasDeRegistros({}), []);
});

test("lo que marcó el doctor en la consulta (aún sin guardar) sale como chip", () => {
  const entradas = entradasDeRegistros(CONSULTA);
  const chips = chipsDelPlan(hallazgosPorTratar(entradas), [], entradas, []);
  assert.deepEqual(chips.map((c) => c.clave), ["h:36:pulpitis", "h:11:caries", "h:48:ext_indicated"]);
  assert.deepEqual(chips.find((c) => c.clave === "h:11:caries")!.caras, ["O", "M"]);
});

test("la precarga: observaciones + CIE-10 (sin repetir), el pronóstico y el odontograma solo si llegó el vivo", () => {
  const base = { observaciones: "  Caries múltiple; pulpitis en 36. ", cie10: "K04.0 - Pulpitis", pronostico: "reservado" as const, odontograma: CONSULTA, odontogramaListo: true };
  const p = precargaDeConsulta(base);
  assert.equal(p.diagnostico, "Caries múltiple; pulpitis en 36.\nK04.0 - Pulpitis");
  assert.equal(p.pronostico, "reservado");
  assert.equal(p.entradas?.length, 6);
  // Si las observaciones ya traen el CIE-10, no se repite.
  assert.equal(precargaDeConsulta({ ...base, observaciones: "Dx: K04.0 - Pulpitis" }).diagnostico, "Dx: K04.0 - Pulpitis");
  // Solo CIE-10, solo observaciones, o nada.
  assert.equal(precargaDeConsulta({ ...base, observaciones: "" }).diagnostico, "K04.0 - Pulpitis");
  assert.equal(precargaDeConsulta({ ...base, cie10: "" }).diagnostico, "Caries múltiple; pulpitis en 36.");
  assert.equal(precargaDeConsulta({ ...base, observaciones: " ", cie10: "" }).diagnostico, "");
  // Sin la precarga del vivo, el odontograma está a medias: la ventana lee el del paciente.
  assert.equal(precargaDeConsulta({ ...base, odontogramaListo: false }).entradas, undefined);
  assert.equal(precargaDeConsulta({ ...base, pronostico: "" }).pronostico, "");
});

test("la Nueva consulta ofrece «Armar el plan» sin tocar su texto libre, y abre la ventana fuera del <form>", () => {
  const form = leer("src/components/clinical/dental-form.tsx");
  // El botón solo con `armarPlan` (lo da la ficha) y en una nota que no está firmada; es type="button".
  assert.match(form, /\{armarPlan && !isLocked && \(\s*<ButtonNew\s+type="button"/);
  assert.match(form, /onClick=\{abrirPlan\}/);
  // El texto libre del plan futuro sigue ahí, igual que siempre.
  assert.match(form, /value=\{form\.plan\} onChange=\{e => set\("plan", e\.target\.value\)\}/);
  assert.ok(!/set\("plan", ""\)/.test(form), "nadie borra el plan futuro");
  // La ventana en un portal: dentro del <form>, un Enter guardaría la consulta; dentro del <fieldset disabled>, saldría apagada.
  assert.match(form, /createPortal\(\s*<VentanaNuevoPlan[\s\S]*?precarga=\{precargaPlan\}[\s\S]*?document\.body,\s*\)/);
  assert.match(form, /precargaDeConsulta\(\{\s*observaciones: form\.assessment,\s*cie10: dxResumen,\s*pronostico,\s*odontograma: odontogram,\s*odontogramaListo: odoStatus === "ready",/);

  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  // Solo la Nueva consulta del rediseño, y solo con permiso de crear planes.
  assert.equal((ficha.match(/armarPlan=\{/g) ?? []).length, 1);
  // ws1-t12 v18: entre la cita en consulta y `rediseno` va la cita elegida en «Hecho» (citaElegida/onQuitarCitaElegida).
  assert.match(ficha, /citaEnCursoId=\{activeAppointment\?\.id \?\? null\} citaElegida=\{citaParaLaNota\} onQuitarCitaElegida=\{\(\) => setCitaParaLaNota\(null\)\} rediseno armarPlan=\{armarPlanConsulta\} \/>/);
  assert.match(ficha, /const armarPlanConsulta = useMemo\(\(\) => \(canEditTreatments \? \{/);
  // La ventana del plan (P3) avisa a la ficha y el plan sale ya.
  assert.match(ficha, /onCrear=\{handleCreateTreatment\}[\s\S]{0,200}onGuardado=\{\(plan\) => \{\s*setPlanesRecienCreados/);
});

test("la ventana con precarga no relee ni vuelve a pedir: odontograma, diagnóstico y pronóstico de la consulta", () => {
  const v = leer("src/components/dashboard/plan-tratamiento-rediseno/ventana-nuevo-plan.tsx");
  assert.match(v, /if \(!odontogramaDeConsulta\) \{\s*fetch\(`\/api\/odontogram/);
  assert.match(v, /if \(!diagnosticoDeConsulta\) fetch\(`\/api\/clinical/);
  assert.match(v, /pronosticoDeConsulta && plan\.pronostico \? \(/);
});

// ═══════════════════════════════════════════════════════════════════════════
// P10 · Sesiones hechas
// ═══════════════════════════════════════════════════════════════════════════

test("sesiones HECHAS: las que tienen fecha de realizado, no las creadas", () => {
  const sesiones = [
    { completedAt: "2026-10-01T10:00:00Z" }, { completedAt: null }, { completedAt: undefined }, null,
    { completedAt: new Date() }, {},
  ];
  assert.equal(sesionesHechas(sesiones), 2);
  assert.equal(sesionesHechas([]), 0);
  assert.equal(sesionesHechas(undefined), 0);
  assert.equal(sesionesHechas(null), 0);
});

test("la ficha cuenta HECHAS en el Resumen y en la pestaña del plan, con o sin rediseño", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /const done = sesionesHechas\(activePlan\.sessions\);/);
  assert.ok(!/activePlan\.sessions\?\.length/.test(ficha), "el Resumen ya no cuenta las creadas");
  assert.match(ficha, /const sessionsDone = \(s: any\[\] \| undefined\) => sesionesHechas\(s\);/);
  assert.ok(!/rediseno \? \(s \?\? \[\]\)\.filter/.test(ficha), "sin la cuenta vieja detrás de la bandera");
});

// ═══════════════════════════════════════════════════════════════════════════
// P10 · «Planes de tratamiento» en el menú nuevo
// ═══════════════════════════════════════════════════════════════════════════

const persona = (role: UserRole, permissionsOverride: string[] = []): SidebarUser => ({
  firstName: "Ejemplo", lastName: "Prueba", email: "e@x.mx", role, permissionsOverride,
});

test("«Planes de tratamiento» va en Administración → Clínica, junto a Procedimientos, con su ícono", () => {
  const item = NAV_ITEMS.find((it) => it.id === "treatments");
  assert.ok(item);
  assert.deepEqual([item!.href, item!.permission, item!.soloMenuNuevo], ["/dashboard/treatments", "treatments.view", true]);
  const clinica = GRUPOS.find((g) => g.id === "clinica")!.ids;
  assert.equal(clinica.indexOf("treatments"), clinica.indexOf("procedures") + 1);
  assert.equal(ICONO_DE.treatments, "folder");
  // Solo esta opción es exclusiva del menú nuevo.
  assert.deepEqual(NAV_ITEMS.filter((it) => it.soloMenuNuevo).map((it) => it.id), ["treatments"]);
});

test("en el menú nuevo la ve quien tiene treatments.view; el menú de siempre no la pinta", () => {
  const conPermiso = armarMenu(opcionesVisibles(persona("RECEPTIONIST"), "DENTAL", []));
  assert.ok(conPermiso.grupos.find((g) => g.id === "clinica")?.items.some((it) => it.id === "treatments"));
  // Sin el permiso (override sin treatments.view), no sale.
  const sinPermiso = armarMenu(opcionesVisibles(persona("RECEPTIONIST", ["today.view", "agenda.view"]), "DENTAL", []));
  assert.ok(!sinPermiso.grupos.some((g) => g.items.some((it) => it.id === "treatments")));
  // El menú de siempre (sidebar.tsx) filtra `soloMenuNuevo` antes que el permiso: su barra queda como hoy.
  const sidebar = leer("src/components/dashboard/sidebar.tsx");
  assert.match(sidebar, /NAV_ITEMS\.filter\(\(item\) =>\s*\/\/[^\n]*\n\s*!item\.soloMenuNuevo &&\s*shouldShowItem\(/);
  const deSiempre = NAV_ITEMS.filter((item) => !item.soloMenuNuevo && shouldShowItem(item, persona("SUPER_ADMIN"), "DENTAL", []));
  assert.ok(!deSiempre.some((it) => it.id === "treatments"));
  // La página pide el mismo permiso.
  assert.match(leer("src/app/dashboard/treatments/page.tsx"), /requirePermissionOrRedirect\(user, "treatments\.view"\)/);
});
