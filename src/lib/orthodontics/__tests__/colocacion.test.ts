/**
 * ws1-t8 — F12 y mejora 5 de la auditoría de BEVADENT: «no hay acción visible para colocar aparatos». La colocación
 * solo se registraba escribiendo «Fecha de colocación» dentro de «Datos del caso». Ahora la fila «Por colocar» de
 * Casos y la cabecera del caso tienen su botón, con un cajón (fecha, técnica, controles previstos) que pasa el caso a
 * «En curso» y propone el calendario de controles.
 *
 * Run: npm run test:orto-casos-alertas
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calendarioDeControles,
  fechaDeCalendario,
  instanteDeColocacion,
  motivoParaNoColocar,
  sumarDiasACalendario,
  validarColocacion,
} from "../colocacion";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const HOY = "2026-10-03";

test("la fecha: hoy o antes, nunca un día que aún no llega; el año, razonable", () => {
  assert.deepEqual(validarColocacion({ treatmentPlanId: "p1", fecha: HOY }, HOY), { ok: true, datos: { treatmentPlanId: "p1", fecha: HOY } });
  assert.equal(validarColocacion({ treatmentPlanId: "p1", fecha: "2026-09-15" }, HOY).ok, true);
  const futuro = validarColocacion({ treatmentPlanId: "p1", fecha: "2026-10-04" }, HOY);
  assert.equal(futuro.ok, false);
  assert.match(!futuro.ok ? futuro.error : "", /aún no llega/);
  assert.equal(validarColocacion({ treatmentPlanId: "p1", fecha: "1926-10-03" }, HOY).ok, false);
  assert.equal(validarColocacion({ treatmentPlanId: "p1", fecha: "2026-02-30" }, HOY).ok, false);
  assert.equal(validarColocacion({ treatmentPlanId: "p1", fecha: "" }, HOY).ok, false);
  assert.equal(validarColocacion({ fecha: HOY }, HOY).ok, false);
});

test("técnica por id y controles previstos, validados", () => {
  const r = validarColocacion({ treatmentPlanId: "p1", fecha: HOY, tecnicaId: "t-ab12", controlesPrevistos: "18" }, HOY);
  assert.deepEqual(r, { ok: true, datos: { treatmentPlanId: "p1", fecha: HOY, tecnicaId: "t-ab12", controlesPrevistos: 18 } });
  assert.equal(validarColocacion({ treatmentPlanId: "p1", fecha: HOY, controlesPrevistos: 0 }, HOY).ok, false);
  assert.equal(validarColocacion({ treatmentPlanId: "p1", fecha: HOY, controlesPrevistos: 121 }, HOY).ok, false);
  assert.equal(validarColocacion({ treatmentPlanId: "p1", fecha: HOY, tecnicaId: "<script>" }, HOY).ok, false);
});

test("se guarda al mediodía UTC: el mismo día en cualquier zona de México", () => {
  const i = instanteDeColocacion("2026-10-03");
  assert.equal(i.toISOString(), "2026-10-03T12:00:00.000Z");
  const enCdmx = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(i);
  const enTijuana = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Tijuana" }).format(i);
  const enCancun = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cancun" }).format(i);
  assert.deepEqual([enCdmx, enTijuana, enCancun], ["2026-10-03", "2026-10-03", "2026-10-03"]);
});

test("solo un caso «Por colocar» se coloca", () => {
  assert.equal(motivoParaNoColocar("PLANNED"), null);
  assert.match(motivoParaNoColocar("IN_PROGRESS") ?? "", /ya tiene la colocación registrada/);
  assert.match(motivoParaNoColocar("ON_HOLD") ?? "", /Datos del caso/);
  assert.match(motivoParaNoColocar("COMPLETED") ?? "", /ya no está activo/);
});

test("calendario propuesto: un control cada frecuencia desde la colocación; los previstos dicen cuántos", () => {
  assert.equal(sumarDiasACalendario("2026-01-31", 30), "2026-03-02");
  const c = calendarioDeControles("2026-10-03", 30, 18);
  assert.deepEqual(c.fechas, ["2026-11-02", "2026-12-02", "2027-01-01", "2027-01-31", "2027-03-02", "2027-04-01"]);
  assert.equal(c.total, 18);
  assert.equal(c.masAdelante, 12);
  const sinPrevistos = calendarioDeControles("2026-10-03", 21, null);
  assert.equal(sinPrevistos.fechas.length, 6);
  assert.equal(sinPrevistos.fechas[0], "2026-10-24");
  assert.equal(sinPrevistos.total, null);
  assert.equal(calendarioDeControles("2026-10-03", 30, 2).fechas.length, 2);
  assert.equal(calendarioDeControles("2026-10-03", 999, 2).fechas[0], "2026-11-02", "frecuencia absurda → cada mes");
  assert.equal(fechaDeCalendario("2026-13-01"), null);
});

test("la acción: permiso clínico, caso de la clínica y del paciente visible, solo «Por colocar», nada se agenda solo", () => {
  const a = sinComentarios(leer("app/actions/orthodontics/registrarColocacion.ts"));
  assert.match(a, /^"use server";/);
  assert.equal((a.match(/getOrthoActionContext\(\)/g) ?? []).length, 2, "las dos acciones piden medicalRecord.edit");
  assert.equal((a.match(/loadPatientForOrtho\(/g) ?? []).length, 2, "paciente visible en las dos");
  assert.match(a, /where: \{ id: antes\.id, clinicId: ctx\.clinicId, deletedAt: null, status: "PLANNED" \}/);
  assert.match(a, /status: "IN_PROGRESS"/);
  assert.match(a, /aplicarEfectosDeEstado\(tx, \{ id: antes\.id, clinicId: ctx\.clinicId \}, "IN_PROGRESS", ahora\)/);
  assert.match(a, /tecnicasActivas\(\(await leerTecnicasDeLaClinica\(ctx\.clinicId\)\)\.tecnicas\)/, "la técnica sale de la lista de la clínica, no del navegador");
  assert.match(a, /fijarPrecioControlSegunTecnica\(/);
  assert.match(a, /aplicarPlanDetalle\(\{/);
  assert.match(a, /auditOrtho\(\{/);
  assert.doesNotMatch(a, /appointment\.(create|createMany)|enviarWhatsApp|sendWhatsApp/, "no agenda ni avisa al paciente");
});

test("cableado: botón en la fila «Por colocar» de Casos, en la cabecera del caso y desde el aviso de la hoja", () => {
  const tabla = sinComentarios(leer("components/specialties/orthodontics/OrthoPacientesTable.tsx"));
  assert.match(tabla, /puedeAbrirCaso && r\.estado === "planeado" &&/);
  assert.match(tabla, /Registrar colocación/);
  assert.match(tabla, /<RegistrarColocacionDelCaso /);
  const hero = sinComentarios(leer("components/specialties/orthodontics/redesign/sections/SectionHero.tsx"));
  assert.match(hero, /props\.onRegistrarColocacion \?/);
  assert.match(hero, /Colocar aparatos hoy/);
  const ficha = sinComentarios(leer("components/specialties/orthodontics/redesign/OrthodonticsRedesignClient.tsx"));
  assert.match(ficha, /t\.casoPorColocar && t\.treatmentPlanId && props\.onUpdateCaseSettings \? \(\) => setDrawer\(\{ kind: "colocacion" \}\)/);
  assert.match(ficha, /setDrawer\(\{ kind: "colocacion" \}\);\s*toast\(textosFirma\.porColocarBorradorGuardado/, "el aviso de la hoja abre el cajón de la colocación");
  assert.match(ficha, /<DrawerColocacion/);
  const cajon = sinComentarios(leer("components/specialties/orthodontics/redesign/drawers/DrawerColocacion.tsx"));
  assert.match(cajon, /^"use client";/);
  assert.match(cajon, /initialReason: TIPO_CITA_CONTROL_ORTO,\s*initialDateISO: dia/);
});
