// C-67 (auditoría de uso): «3 de 3 controles · 6 meses» con un plan de 4 meses y «Avance 75 %» con 4 de 4 controles.
// Con el código viejo los rótulos vivían en SectionHero («· 6 meses», «Avance del tratamiento») y este módulo no existía.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rotuloDeTiempo, subtituloDeAsistencia } from "../textos-avance-del-caso";

test("la asistencia dice que la ventana son los ÚLTIMOS 6 meses", () => {
  assert.equal(subtituloDeAsistencia({ pct: 100, asistio: 3, falto: 0 }), "3 de 3 controles · últimos 6 meses");
  assert.equal(subtituloDeAsistencia({ pct: 75, asistio: 3, falto: 1 }), "faltó a 1 de 4 · últimos 6 meses");
  assert.equal(subtituloDeAsistencia({ pct: null, asistio: 0, falto: 0 }), "sin controles registrados");
  assert.equal(subtituloDeAsistencia(null), "últimos 6 meses");
});

test("la barra de avance es de TIEMPO: «Mes 3 de 4 · 75 %», no «Avance 75 %»", () => {
  assert.deepEqual(rotuloDeTiempo(3, 4), { titulo: "Tiempo de tratamiento", cifra: "Mes 3 de 4 · 75 %", pct: 75 });
  assert.equal(rotuloDeTiempo(7, 4).pct, 100);
});
