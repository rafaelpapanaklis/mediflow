/**
 * Menores de la revisión final de la Agenda (ws1-t10, 2-oct-2026). Fallos 1, 4, 5 y 6 del REPORTE ws1-t1
 * («Fallos nuevos» de la revisión final en panel.108).
 *
 * Run: npm run test:agenda-menores-revision-final
 *
 *  1. Día con 22 columnas: el nombre corto medía 0 px y solo se veían las iniciales, repetidas («WS» ×3), sin
 *     tooltip. Ahora la columna tiene un ancho mínimo (la rejilla se desplaza), la cabecera estrecha es
 *     compacta (sin círculo, nombre en dos renglones) y el nombre completo sale en toda la cabecera.
 *  4. Editar cita: «Conflicto» y «Sobrescribir y guardar» se quedaban al pasar a un doctor libre.
 *  5. Nueva cita: el resumen decía «QA con Cuenta de Prueba» para «QA Importado Eta».
 *  6. Plan de tratamiento: «Dr/a. Dr Import Ortodoncista T5».
 *
 * Con el código viejo fallan todas: no existen `anchoMinimoColumnaDia` ni `conflicto-editar-cita.ts`, y las
 * fuentes siguen con `split(" ")[0]` y `t("patients.doctorPrefix")` en los selectores del plan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ANCHO_EJE, ANCHO_MINIMO_COLUMNA_DIA, anchoMinimoColumnaDia } from "@/lib/agenda-nueva/tokens";
import { claveDelHueco, conflictoVigente, type HuecoEditado } from "../conflicto-editar-cita";
import { etiquetasDeProfesionales } from "../etiqueta-profesional";
import { nombreDeProfesional } from "@/lib/nombre-profesional";
import type { AgendaAppointmentDTO } from "../types";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ─── 1 · Columnas del Día ────────────────────────────────────────────────────────────────────────────

test("1 · con pocas columnas no se fuerza ancho (el suelo de 720 px de las pantallas estrechas sigue mandando)", () => {
  assert.equal(anchoMinimoColumnaDia(1), undefined);
  assert.equal(anchoMinimoColumnaDia(3), undefined);
  assert.equal(anchoMinimoColumnaDia(7), undefined); // 64 + 7 × 88 = 680
});

test("1 · con 22 columnas cada una mide al menos 88 px (antes ~45 px a 1280: nombre de 0 px)", () => {
  assert.equal(anchoMinimoColumnaDia(8), ANCHO_MINIMO_COLUMNA_DIA); // 64 + 8 × 88 = 768
  assert.equal(anchoMinimoColumnaDia(22), ANCHO_MINIMO_COLUMNA_DIA);
  assert.ok(ANCHO_EJE + 22 * ANCHO_MINIMO_COLUMNA_DIA > 1280, "a 1280 con 22 columnas la rejilla se desplaza");
});

test("1 · vista-dia: pasa el ancho mínimo, el nombre completo en TODA la cabecera y el círculo sin texto leíble", () => {
  const src = sinComentarios(leer("src/components/dashboard/agenda-nueva/vista-dia.tsx"));
  assert.match(src, /anchoMinimoColumna=\{anchoMinimoColumnaDia\(columnasConSombra\.length\)\}/);
  assert.match(src, /<div className=\{s\.cabeceraDiaMarco\} title=\{r\.nombre\}>/);
  assert.match(src, /className=\{s\.avatarResponsable\}[^>]*aria-hidden/);
});

test("1 · CSS: la cabecera estrecha es compacta — franja de color en vez del círculo y nombre en dos renglones", () => {
  const css = leer("src/components/dashboard/agenda-nueva/agenda-nueva.module.css");
  assert.match(css, /\.cabeceraDiaMarco \{[^}]*container-type: inline-size;/);
  const compacta = css.match(/@container \(max-width: 150px\) \{([\s\S]*?)\n\}/);
  assert.ok(compacta, "falta la consulta @container de la cabecera compacta");
  const reglas = compacta![1]!;
  assert.match(reglas, /\.avatarResponsable \{[^}]*font-size: 0;/);
  assert.match(reglas, /\.avatarResponsable \{[^}]*height: 3px;/);
  assert.match(reglas, /\.cabeceraNombre \{[^}]*white-space: normal;[^}]*-webkit-line-clamp: 2;/);
});

// ─── 4 · Editar cita: el conflicto se recalcula ──────────────────────────────────────────────────────

const TZ_OFFSET = "-06:00"; // CDMX: las horas del hueco y de las citas van en la misma zona.
const iso = (fechaHora: string) => new Date(`${fechaHora}:00${TZ_OFFSET}`).toISOString();
const cita = (id: string, doctorId: string, desde: string, hasta: string, extra: Partial<AgendaAppointmentDTO> = {}) =>
  ({
    id,
    startsAt: iso(desde),
    endsAt: iso(hasta),
    status: "CONFIRMED",
    patient: { id: `p-${id}`, name: "Lucía Ramos" },
    doctor: { id: doctorId, shortName: doctorId },
    resourceId: null,
    source: "DASHBOARD",
    requiresValidation: false,
    overrideReason: null,
    ...extra,
  }) as AgendaAppointmentDTO;

const MARIANA = "doc_mariana";
const LIBRE = "doc_ws1t5b";
const CITAS = [cita("a1", MARIANA, "2026-10-02T12:00", "2026-10-02T12:30")];
const hueco = (doctorId: string, startTime = "12:00"): HuecoEditado => ({
  date: "2026-10-02",
  startTime,
  durationMin: 30,
  doctorId,
  resourceId: "",
});
const rango = (h: HuecoEditado) => {
  const startsAt = iso(`${h.date}T${h.startTime}`);
  return { startsAt, endsAt: new Date(new Date(startsAt).getTime() + h.durationMin * 60_000).toISOString() };
};
const AVISO = { texto: "El doctor ya tiene una cita con Lucía Ramos a esa hora.", clave: claveDelHueco(hueco(MARIANA)) };

test("4 · el aviso del servidor vale para su hueco", () => {
  const h = hueco(MARIANA);
  assert.equal(conflictoVigente({ delServidor: AVISO, hueco: h, rango: rango(h), citaId: "mia", citas: CITAS }), AVISO.texto);
});

test("4 · al pasar a un doctor libre el aviso se va (y con él «Sobrescribir y guardar»)", () => {
  const h = hueco(LIBRE);
  assert.equal(conflictoVigente({ delServidor: AVISO, hueco: h, rango: rango(h), citaId: "mia", citas: CITAS }), null);
});

test("4 · al cambiar la hora a una libre del mismo doctor, también se va", () => {
  const h = hueco(MARIANA, "13:00");
  assert.equal(conflictoVigente({ delServidor: AVISO, hueco: h, rango: rango(h), citaId: "mia", citas: CITAS }), null);
});

test("4 · al volver a un hueco ocupado, se recalcula con las citas cargadas (misma frase que el servidor)", () => {
  const otra = cita("a2", LIBRE, "2026-10-02T13:00", "2026-10-02T14:00");
  const h = hueco(LIBRE, "13:15");
  assert.equal(
    conflictoVigente({ delServidor: AVISO, hueco: h, rango: rango(h), citaId: "mia", citas: [...CITAS, otra] }),
    "El doctor ya tiene una cita con Lucía Ramos a esa hora.",
  );
  // Una cancelada o la propia cita no cuentan.
  const cancelada = cita("a3", LIBRE, "2026-10-02T13:00", "2026-10-02T14:00", { status: "CANCELLED" });
  assert.equal(conflictoVigente({ delServidor: AVISO, hueco: h, rango: rango(h), citaId: "mia", citas: [cancelada] }), null);
  const propia = cita("mia", LIBRE, "2026-10-02T13:00", "2026-10-02T14:00");
  assert.equal(conflictoVigente({ delServidor: AVISO, hueco: h, rango: rango(h), citaId: "mia", citas: [propia] }), null);
});

test("4 · sin aviso previo del servidor no se adelanta nada (la ventana se comporta como siempre)", () => {
  const h = hueco(MARIANA);
  assert.equal(conflictoVigente({ delServidor: null, hueco: h, rango: rango(h), citaId: "mia", citas: CITAS }), null);
});

test("4 · el modal pinta el aviso recalculado y solo manda el motivo para forzar si el aviso sigue", () => {
  const src = sinComentarios(leer("src/components/dashboard/agenda/agenda-edit-appointment-modal.tsx"));
  assert.match(src, /const conflict = conflictoVigente\(\{/);
  assert.match(src, /\.\.\.\(conflict && form\.overrideReason \? \{ overrideReason: form\.overrideReason \} : \{\}\)/);
  assert.match(src, /setConflict\(\{\s*clave: claveDelHueco\(form\),/);
  assert.doesNotMatch(src, /\.\.\.\(form\.overrideReason \? \{ overrideReason/);
});

// ─── 5 · Nueva cita: el nombre del paciente en el resumen ────────────────────────────────────────────

test("5 · el resumen del pie lleva el nombre visible completo del paciente, no la primera palabra", () => {
  const src = sinComentarios(leer("src/components/dashboard/new-appointment/new-appointment-dialog.tsx"));
  assert.doesNotMatch(src, /patientName\.split\(" "\)\[0\]/);
  assert.match(src, /<b \{\.\.\.fuerte\}>\{nombrePaciente\}<\/b>/);
});

// ─── 6 · Plan de tratamiento: sin «Dr/a. Dr …» ───────────────────────────────────────────────────────

test("6 · el nombre del plan sale tal como está en Equipo, sin prefijo inventado", () => {
  const padron = [
    { id: "a", firstName: "Dr Import", lastName: "Ortodoncista T5" },
    { id: "b", firstName: "Dra Import", lastName: "General T5" },
    { id: "c", firstName: "Mariana", lastName: "Cortés Valdés" },
  ];
  const e = etiquetasDeProfesionales(padron);
  assert.equal(e.get("a")!.nombre, "Dr Import Ortodoncista T5");
  assert.equal(e.get("b")!.nombre, "Dra Import General T5");
  assert.equal(e.get("c")!.nombre, "Mariana Cortés Valdés");
  assert.equal(nombreDeProfesional(padron[0]), "Dr Import Ortodoncista T5");
});

test("6 · los selectores y la tarjeta del plan (rediseño y vista de siempre) ya no anteponen «Dr/a.»", () => {
  const nuevo = sinComentarios(leer("src/components/dashboard/plan-tratamiento-rediseno/ventana-nuevo-plan.tsx"));
  assert.doesNotMatch(nuevo, /t\("patients\.doctorPrefix"\)/);
  assert.match(nuevo, /<option key=\{d\.id\} value=\{d\.id\}>\{nombresDoctores\.get\(d\.id\)\?\.nombre\}<\/option>/);
  const ver = sinComentarios(leer("src/components/dashboard/plan-tratamiento-rediseno/ventanas-plan.tsx"));
  assert.doesNotMatch(ver, /t\("patients\.doctorPrefix"\)/);
  const ficha = sinComentarios(leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx"));
  assert.match(ficha, /<option key=\{d\.id\} value=\{d\.id\}>\{etiquetasDoctoresPlan\.get\(d\.id\)\?\.nombre\}<\/option>/);
  assert.doesNotMatch(ficha, /\{t\("patients\.doctorPrefix"\)\} \{plan\.doctor\?\.firstName\}/);
});
