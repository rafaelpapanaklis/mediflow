// Ortodoncia — qué va plegado en la pestaña del caso según la fase
// (fila 26 de la revisión de uso, ws1-t4 ronda 6).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { juegoDeSeisMesesPendiente, seccionesPlegadasPorFase } from "../secciones-por-fase";

test("en tratamiento (mes 2) Retención y Post-tratamiento van plegadas", () => {
  assert.deepEqual(
    seccionesPlegadasPorFase({ estado: "en-tratamiento", hayRetencionCapturada: false }),
    { retencion: true, postratamiento: true },
  );
});

test("sin caso también van plegadas", () => {
  assert.deepEqual(
    seccionesPlegadasPorFase({ estado: "no-iniciado", hayRetencionCapturada: false }),
    { retencion: true, postratamiento: true },
  );
});

test("en retención, Retención se abre y Post-tratamiento sigue plegada", () => {
  assert.deepEqual(
    seccionesPlegadasPorFase({ estado: "retencion", hayRetencionCapturada: false }),
    { retencion: false, postratamiento: true },
  );
});

test("terminado, las dos abiertas", () => {
  assert.deepEqual(
    seccionesPlegadasPorFase({ estado: "completado", hayRetencionCapturada: true }),
    { retencion: false, postratamiento: false },
  );
});

test("lo que la clínica ya capturó de retención no se esconde aunque siga en tratamiento", () => {
  assert.equal(
    seccionesPlegadasPorFase({ estado: "en-tratamiento", hayRetencionCapturada: true }).retencion,
    false,
  );
});

test("el juego de los 6 meses no se pide antes del mes 6", () => {
  for (const mes of [0, 1, 2, 5]) {
    assert.equal(juegoDeSeisMesesPendiente({ mesActual: mes, yaHayJuego: false }), false, `mes ${mes}`);
  }
});

test("desde el mes 6 se pide, salvo que ya esté subido", () => {
  assert.equal(juegoDeSeisMesesPendiente({ mesActual: 6, yaHayJuego: false }), true);
  assert.equal(juegoDeSeisMesesPendiente({ mesActual: 14, yaHayJuego: false }), true);
  assert.equal(juegoDeSeisMesesPendiente({ mesActual: 14, yaHayJuego: true }), false);
  assert.equal(juegoDeSeisMesesPendiente({ mesActual: Number.NaN, yaHayJuego: false }), false);
});

// Candados de cableado: la pantalla usa estas reglas y no las suyas.
const RAIZ = join(__dirname, "../../../../components/specialties/orthodontics/redesign");

test("la pestaña del caso pliega Retención y Post-tratamiento con la regla por fase", () => {
  const fuente = readFileSync(join(RAIZ, "OrthodonticsRedesignClient.tsx"), "utf8");
  assert.match(fuente, /seccionesPlegadasPorFase\(/);
  assert.match(fuente, /<SeccionPlegada[\s\S]*?id="retention"/);
  assert.match(fuente, /<SeccionPlegada[\s\S]*?id="post"/);
});

test("Fotos pide el juego de los 6 meses con la regla del mes", () => {
  const fuente = readFileSync(join(RAIZ, "sections/SectionPhotos.tsx"), "utf8");
  assert.match(fuente, /juegoDeSeisMesesPendiente\(/);
});
