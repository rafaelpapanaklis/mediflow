/**
 * «Abrir caso» desde el módulo de Ortodoncia (H17 de la QA en vivo).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/abrir-caso.test.ts
 *
 * El hallazgo: «no hay "Abrir caso" dentro del módulo; los casos solo se abren
 * desde la ficha del paciente». Ahora Pacientes en tratamiento tiene el botón,
 * que lleva a elegir paciente y de ahí a su ficha con el alta abierta.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_RESULTADOS,
  MIN_LETRAS_BUSQUEDA,
  PARAMETRO_ABRIR_CASO,
  debeAbrirElAlta,
  destinoDeAbrirCaso,
  etiquetaDeSituacion,
  situacionOrto,
} from "../abrir-caso";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

test("H17: Pacientes en tratamiento tiene el botón «Abrir caso», y el vacío también", () => {
  const pagina = leer("src/app/dashboard/orthodontics/pacientes/page.tsx");
  assert.match(pagina, /acciones=\{puedeAbrirCaso \? <AbrirCasoBoton \/> : undefined\}/);
  assert.match(pagina, /"medicalRecord\.edit"/, "lo ve quien puede crear el caso");
  const tabla = leer("src/components/specialties/orthodontics/OrthoPacientesTable.tsx");
  assert.match(tabla, /\{puedeAbrirCaso && <AbrirCasoBoton \/>\}/);
  assert.doesNotMatch(tabla, /Un caso se abre desde la ficha del paciente: entra a su pestaña/, "el texto viejo mandaba a la ficha");

  const boton = leer("src/components/specialties/orthodontics/modulo/abrir-caso.tsx");
  assert.match(boton, /^"use client";/);
  assert.match(boton, /Abrir caso\n/);
  assert.match(boton, /role="dialog" aria-modal="true"/);
  assert.match(boton, /href=\{destinoDeAbrirCaso\(p\.id, p\.situacion\)\}/, "elegir paciente lleva a SU ficha");
  assert.match(boton, /createPortal\(/, "fuera del contenedor del módulo: lo fijo se ancla a la pantalla");
});

test("el buscador saca la clínica de la sesión y respeta la visibilidad de pacientes", () => {
  const accion = leer("src/app/actions/orthodontics/modulo/buscarPacientesParaAbrirCaso.ts");
  assert.match(accion, /^"use server";/);
  assert.match(accion, /await getOrthoActionContext\(\{ write: true \}\)/, "módulo activo + permiso de escribir el expediente");
  // Del cliente solo llega el texto: ninguna clínica ni usuario.
  assert.doesNotMatch(accion, /input[^;\n]*clinicId/);
  const consultas = accion.split(/await prisma\./).slice(1).map((t) => t.slice(0, 200));
  assert.equal(consultas.length, 5, "pacientes (dos caminos), planes y diagnósticos (con y sin la columna nueva)");
  for (const c of consultas) assert.match(c, /where: \{\s*(clinicId: ctx\.clinicId|\.\.\.base)/, "toda consulta filtra por la clínica de la sesión");
  assert.match(accion, /const base = \{\s*clinicId: ctx\.clinicId,/);
  assert.equal((accion.match(/\.\.\.patientVisibilityAnd\(viewer\)/g) ?? []).length, 2, "los dos caminos de búsqueda");
  assert.match(accion, /deletedAt: null,/, "un paciente cancelado no aparece");
  assert.match(accion, /take: MAX_RESULTADOS,/);
  assert.doesNotMatch(accion, /Promise\.all/);
});

test("dónde está cada paciente respecto a ortodoncia", () => {
  assert.equal(situacionOrto({ planes: [], diagnosticos: 0 }), "sin-caso");
  assert.equal(situacionOrto({ planes: [], diagnosticos: 1 }), "con-diagnostico");
  assert.equal(situacionOrto({ planes: [], diagnosticos: 1, enObservacion: true }), "en-observacion");
  for (const s of ["PLANNED", "IN_PROGRESS", "ON_HOLD", "RETENTION"]) {
    assert.equal(situacionOrto({ planes: [s], diagnosticos: 1 }), "con-caso", s);
  }
  // Un caso terminado o abandonado no impide abrir otro.
  assert.equal(situacionOrto({ planes: ["COMPLETED"], diagnosticos: 1 }), "con-diagnostico");
  assert.equal(situacionOrto({ planes: ["DROPPED_OUT"], diagnosticos: 1 }), "con-diagnostico");
  assert.equal(situacionOrto({ planes: ["COMPLETED", "IN_PROGRESS"], diagnosticos: 2 }), "con-caso");
});

test("elegir paciente lleva a su ficha; el alta se abre sola si no tiene caso", () => {
  assert.equal(destinoDeAbrirCaso("cmuk123", "sin-caso"), "/dashboard/patients/cmuk123?tab=ortodoncia&abrirCaso=1");
  assert.equal(destinoDeAbrirCaso("cmuk123", "con-diagnostico"), "/dashboard/patients/cmuk123?tab=ortodoncia&abrirCaso=1");
  assert.equal(destinoDeAbrirCaso("cmuk123", "en-observacion"), "/dashboard/patients/cmuk123?tab=ortodoncia&abrirCaso=1");
  assert.equal(destinoDeAbrirCaso("cmuk123", "con-caso"), "/dashboard/patients/cmuk123?tab=ortodoncia", "ya tiene caso: a verlo");
  assert.equal(destinoDeAbrirCaso("a/b?c", "con-caso"), "/dashboard/patients/a%2Fb%3Fc?tab=ortodoncia", "un id raro no rompe la dirección");
  assert.equal(PARAMETRO_ABRIR_CASO, "abrirCaso");
});

test("el aviso de la dirección no da ningún permiso", () => {
  assert.equal(debeAbrirElAlta({ parametro: "1", tieneCaso: false, puedeCrear: true }), true);
  assert.equal(debeAbrirElAlta({ parametro: "1", tieneCaso: true, puedeCrear: true }), false, "ya tiene caso");
  assert.equal(debeAbrirElAlta({ parametro: "1", tieneCaso: false, puedeCrear: false }), false, "no puede crear: no se abre");
  assert.equal(debeAbrirElAlta({ parametro: null, tieneCaso: false, puedeCrear: true }), false);
  assert.equal(debeAbrirElAlta({ parametro: "true", tieneCaso: false, puedeCrear: true }), false);
  assert.equal(debeAbrirElAlta({ parametro: undefined, tieneCaso: false, puedeCrear: true }), false);
});

test("la ficha abre el asistente de alta al llegar con el aviso, y lo quita de la dirección", () => {
  // La regla vive en un hook que comparten las dos caras de la pestaña.
  const gancho = leer("src/components/specialties/orthodontics/redesign/useAbrirAltaAlLlegar.ts");
  assert.match(gancho, /direccion\.get\(PARAMETRO_ABRIR_CASO\)/);
  assert.match(gancho, /if \(debeAbrirElAlta\(\{ parametro, tieneCaso, puedeCrear \}\)\) abrir\(\);/);
  assert.match(gancho, /direccion\.delete\(PARAMETRO_ABRIR_CASO\);/, "recargar no lo vuelve a abrir");
  // `null` y no el estado de Next: con el estado copiado, Next no se entera y
  // su siguiente refresco devuelve el aviso a la dirección (visto en vivo).
  assert.match(gancho, /window\.history\.replaceState\(null, "", /);

  const ficha = leer("src/components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx");
  assert.match(
    ficha,
    /useAbrirAltaAlLlegar\(\{\s*tieneCaso: Boolean\(t\.treatmentPlanId\),\s*puedeCrear: Boolean\(props\.onCreateCase\),\s*abrir: \(\) => setDrawer\(\{ kind: "new-case" \}\),/,
    "el mismo asistente de siempre (DrawerNewCase), no otro",
  );
});

test("las etiquetas de la lista, dichas para la clínica", () => {
  assert.equal(etiquetaDeSituacion("con-caso").texto, "Ya tiene un caso abierto");
  assert.equal(etiquetaDeSituacion("sin-caso").texto, "Sin caso");
  assert.equal(etiquetaDeSituacion("en-observacion").texto, "En observación");
  assert.equal(etiquetaDeSituacion("con-diagnostico").texto, "Con diagnóstico, sin caso");
  assert.ok(MIN_LETRAS_BUSQUEDA >= 2);
  assert.ok(MAX_RESULTADOS <= 50);
});
