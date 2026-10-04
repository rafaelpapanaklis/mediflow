// C-79 (auditoría de uso): «Firmar consentimiento» gris sin decir qué falta y «11:05 p.m..» con doble punto.
// Este módulo no existía con el código viejo.

import { test } from "node:test";
import assert from "node:assert/strict";
import { conPuntoFinal, queFaltaParaFirmar } from "../falta-para-firmar";
import { formatConsentDateTime } from "../dates";

test("dice qué falta para firmar", () => {
  assert.equal(
    queFaltaParaFirmar({ aceptado: false, conFirma: false, conHuecos: false, huecosConfirmados: false }),
    "Para firmar, falta dibujar tu firma en el recuadro y marcar que leíste y aceptas la carta.",
  );
  assert.equal(queFaltaParaFirmar({ aceptado: true, conFirma: false, conHuecos: false, huecosConfirmados: false }), "Para firmar, falta dibujar tu firma en el recuadro.");
  assert.match(queFaltaParaFirmar({ aceptado: true, conFirma: true, conHuecos: true, huecosConfirmados: false })!, /espacios sin llenar/);
  assert.equal(queFaltaParaFirmar({ aceptado: true, conFirma: true, conHuecos: true, huecosConfirmados: true }), null);
});

test("sin doble punto tras «p.m.»", () => {
  const hora = formatConsentDateTime(new Date("2026-10-04T05:05:00Z"), "America/Mexico_City");
  const frase = conPuntoFinal(hora);
  assert.ok(!frase.endsWith(".."), frase);
  assert.ok(frase.endsWith("."), frase);
  assert.equal(conPuntoFinal("como representante legal del paciente"), "como representante legal del paciente.");
});
