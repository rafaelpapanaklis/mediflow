/**
 * Ortodoncia — el aviso de las fotos que manda el paciente (ws1-t5, hallazgo
 * 96 de la revisión de lógica de uso).
 *
 * Run: npx tsx --test src/lib/orthodontics/__tests__/fotos-paciente.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparFotosPorRevisar,
  avisosDeFotos,
  nombreDeLaFoto,
  notaCorta,
  resumenDeFotos,
  type FotoPendiente,
} from "../fotos-paciente";

let n = 0;
function foto(plan: string, paciente: string, cuando: string, nota: string | null = null, angle = "FRONTAL"): FotoPendiente {
  n += 1;
  return {
    id: `foto-${n}`,
    treatmentPlanId: plan,
    patientId: `pac-${plan}`,
    patientName: paciente,
    angle,
    patientNote: nota,
    submittedAt: new Date(cuando),
  };
}

test("96 · cuatro fotos del mismo caso son UNA fila, con su cuenta", () => {
  const filas = agruparFotosPorRevisar([
    foto("a", "Ana Ruiz", "2026-09-28T15:00:00Z"),
    foto("a", "Ana Ruiz", "2026-09-28T15:01:00Z", "Me molesta el bracket de arriba"),
    foto("a", "Ana Ruiz", "2026-09-28T15:02:00Z"),
    foto("a", "Ana Ruiz", "2026-09-27T10:00:00Z", "nota vieja"),
  ]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.pendientes, 4);
  assert.equal(filas[0]!.patientName, "Ana Ruiz");
  assert.equal(filas[0]!.ultimaAt.toISOString(), "2026-09-28T15:02:00.000Z");
  assert.equal(filas[0]!.primeraAt.toISOString(), "2026-09-27T10:00:00.000Z");
  assert.equal(filas[0]!.nota, "Me molesta el bracket de arriba", "la nota más reciente, no la última foto sin nota");
  assert.equal("notaAt" in filas[0]!, false);
});

test("96 · primero el caso que lleva más tiempo esperando", () => {
  const filas = agruparFotosPorRevisar([
    foto("b", "Luis Ruiz", "2026-09-28T09:00:00Z"),
    foto("a", "Ana Ruiz", "2026-09-20T09:00:00Z"),
    foto("c", "Eva Paz", "2026-09-25T09:00:00Z"),
    foto("a", "Ana Ruiz", "2026-09-28T12:00:00Z"),
  ]);
  assert.deepEqual(filas.map((f) => f.patientName), ["Ana Ruiz", "Eva Paz", "Luis Ruiz"]);
});

test("96 · sin fotos no hay filas ni avisos", () => {
  assert.deepEqual(agruparFotosPorRevisar([]), []);
  assert.deepEqual(avisosDeFotos([]), []);
});

test("96 · una nota en blanco cuenta como sin nota", () => {
  const filas = agruparFotosPorRevisar([foto("a", "Ana Ruiz", "2026-09-28T15:00:00Z", "   ")]);
  assert.equal(filas[0]!.nota, null);
});

test("96 · la campana lleva un aviso por caso, el más reciente arriba, y abre la pestaña de Ortodoncia", () => {
  const avisos = avisosDeFotos([
    foto("a", "Ana Ruiz", "2026-09-20T09:00:00Z"),
    foto("b", "Luis Ruiz", "2026-09-28T09:00:00Z", "¿Así está bien el elástico?"),
    foto("a", "Ana Ruiz", "2026-09-21T09:00:00Z"),
  ]);
  assert.equal(avisos.length, 2);
  assert.equal(avisos[0]!.title, "Foto de seguimiento — Luis Ruiz");
  assert.equal(avisos[0]!.subtitle, "Ortodoncia · «¿Así está bien el elástico?»");
  assert.equal(avisos[0]!.href, "/dashboard/patients/pac-b?tab=ortodoncia");
  assert.equal(avisos[1]!.title, "2 fotos de seguimiento — Ana Ruiz");
  assert.equal(avisos[1]!.subtitle, "Ortodoncia · por revisar");
  assert.equal(avisos[1]!.at.toISOString(), "2026-09-21T09:00:00.000Z");
});

test("96 · una foto nueva del mismo caso es un aviso NUEVO para la campana", () => {
  const antes = avisosDeFotos([foto("a", "Ana Ruiz", "2026-09-20T09:00:00Z")]);
  const despues = avisosDeFotos([
    foto("a", "Ana Ruiz", "2026-09-20T09:00:00Z"),
    foto("a", "Ana Ruiz", "2026-09-28T09:00:00Z"),
  ]);
  assert.notEqual(antes[0]!.id, despues[0]!.id);
});

test("96 · la campana no pasa del tope", () => {
  const fotos = Array.from({ length: 25 }, (_, i) =>
    foto(`caso-${i}`, `Paciente ${i}`, `2026-09-${String((i % 27) + 1).padStart(2, "0")}T09:00:00Z`),
  );
  assert.equal(avisosDeFotos(fotos).length, 10);
  assert.equal(avisosDeFotos(fotos, 3).length, 3);
});

test("textos: plural, ángulo y nota recortada", () => {
  assert.equal(resumenDeFotos(1), "1 foto sin revisar");
  assert.equal(resumenDeFotos(3), "3 fotos sin revisar");
  assert.equal(nombreDeLaFoto("FRONTAL"), "foto de frente");
  assert.equal(nombreDeLaFoto("OTHER"), "foto");
  assert.equal(nombreDeLaFoto("RARO"), "foto");
  assert.equal(notaCorta(null), null);
  assert.equal(notaCorta("  hola \n mundo "), "hola mundo");
  const larga = notaCorta("palabra ".repeat(40), 30);
  assert.ok(larga && larga.length <= 31 && larga.endsWith("…"), larga ?? "");
  assert.doesNotMatch(larga ?? "", /\s…$/);
});

// ── En el caso: la foto se ABRE, no se marca sola ────────────────────────────

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PANEL = readFileSync(
  join(__dirname, "..", "..", "..", "components", "specialties", "orthodontics", "alineadores", "AlineadoresPanel.tsx"),
  "utf8",
);

test("96 · en el caso, tocar la miniatura abre la foto; revisarla es un botón aparte", () => {
  const bloque = PANEL.slice(PANEL.indexOf("function MonitoringBlock"));
  assert.match(bloque, /<a key=\{p\.id\} href=\{p\.url\} target="_blank" rel="noopener noreferrer"/);
  assert.match(bloque, /Marcar como revisada/);
  assert.equal((bloque.match(/reviewMonitoringPhoto\(/g) ?? []).length, 1, "una sola llamada, la del botón");
  assert.match(bloque, /onClick=\{\(\) => marcarRevisada\(p\.id\)\}/);
});

test("96 · en el caso se lee lo que el paciente escribió junto a la foto", () => {
  const bloque = PANEL.slice(PANEL.indexOf("function MonitoringBlock"));
  assert.match(bloque, /notaCorta\(p\.patientNote/);
  assert.match(bloque, /nombreDeLaFoto\(p\.angle\)/);
});
