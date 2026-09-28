// Ortodoncia — la sección «Post-tratamiento» no promete lo que no pasa
// (ws1-t5, ronda 6 · sección I de la revisión de uso).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encuestaSalio,
  estadoDeEncuestaEnPalabras,
  vistaDePostratamiento,
  type EncuestaSembrada,
} from "../postratamiento";

function encuesta(parcial: Partial<EncuestaSembrada> & Pick<EncuestaSembrada, "npsType">): EncuestaSembrada {
  return { status: "SCHEDULED", npsScore: null, googleReviewTriggered: false, ...parcial };
}

const SEMBRADAS: EncuestaSembrada[] = [
  encuesta({ npsType: "POST_DEBOND_3D" }),
  encuesta({ npsType: "POST_DEBOND_6M" }),
  encuesta({ npsType: "POST_DEBOND_12M" }),
];

test("lo que pasa hoy al entrar a retención: tres encuestas sembradas y ninguna enviada → la tarjeta no se enseña", () => {
  const v = vistaDePostratamiento({ encuestas: SEMBRADAS, codigoDeReferidos: null });
  assert.equal(v.encuesta.visible, false);
  assert.equal(v.referidos.visible, false);
  assert.equal(v.tarjetas, 1);
  assert.equal(v.subtitulo, "Comparativa final");
});

test("sin ninguna encuesta tampoco se enseña", () => {
  const v = vistaDePostratamiento({ encuestas: [], codigoDeReferidos: undefined });
  assert.equal(v.encuesta.visible, false);
  assert.equal(v.tarjetas, 1);
});

test("con una respuesta real la tarjeta se enseña, en orden y con palabras", () => {
  const v = vistaDePostratamiento({
    encuestas: [
      encuesta({ npsType: "POST_DEBOND_12M" }),
      encuesta({ npsType: "POST_DEBOND_3D", status: "RESPONDED", npsScore: 9, googleReviewTriggered: true }),
      encuesta({ npsType: "POST_DEBOND_6M", status: "SENT" }),
    ],
    codigoDeReferidos: null,
  });
  assert.equal(v.encuesta.visible, true);
  assert.deepEqual(v.encuesta.filas, [
    { clave: "POST_DEBOND_3D", etiqueta: "Encuesta a los 3 días", estado: "9 de 10" },
    { clave: "POST_DEBOND_6M", etiqueta: "Encuesta a los 6 meses", estado: "Enviada, sin respuesta" },
    { clave: "POST_DEBOND_12M", etiqueta: "Encuesta a los 12 meses", estado: "Sin enviar" },
  ]);
  assert.equal(v.encuesta.resumen, "1 de 2 respondidas");
  assert.equal(v.encuesta.resenaPedida, true);
  assert.equal(v.tarjetas, 2);
  assert.equal(v.subtitulo, "Comparativa final y satisfacción");
});

test("el resumen cuenta contra las que salieron, no contra las sembradas", () => {
  const v = vistaDePostratamiento({
    encuestas: [
      encuesta({ npsType: "POST_DEBOND_3D", status: "RESPONDED", npsScore: 10 }),
      encuesta({ npsType: "POST_DEBOND_6M" }),
      encuesta({ npsType: "POST_DEBOND_12M" }),
    ],
    codigoDeReferidos: null,
  });
  assert.equal(v.encuesta.resumen, "1 de 1 respondida");
});

test("ningún estado sale en inglés ni en crudo", () => {
  for (const status of ["SCHEDULED", "SENT", "RESPONDED", "EXPIRED", "CANCELLED", "ALGO_NUEVO"]) {
    const texto = estadoDeEncuestaEnPalabras({ status, npsScore: null });
    assert.equal(/scheduled|sent|responded|expired|cancelled|algo_nuevo/i.test(texto), false, `${status} → ${texto}`);
    assert.ok(texto.length > 0);
  }
});

test("una encuesta sembrada nunca se llama «programada»: suena a que va a salir sola", () => {
  assert.equal(/programad/i.test(estadoDeEncuestaEnPalabras({ status: "SCHEDULED", npsScore: null })), false);
});

test("respondida sin puntuación no inventa un número", () => {
  assert.equal(estadoDeEncuestaEnPalabras({ status: "RESPONDED", npsScore: null }), "Respondida");
  assert.equal(estadoDeEncuestaEnPalabras({ status: "RESPONDED", npsScore: 0 }), "0 de 10");
});

test("sembrada y cancelada no cuentan como enviadas; enviada, respondida y vencida sí", () => {
  assert.equal(encuestaSalio({ status: "SCHEDULED" }), false);
  assert.equal(encuestaSalio({ status: "CANCELLED" }), false);
  assert.equal(encuestaSalio({ status: "SENT" }), true);
  assert.equal(encuestaSalio({ status: "RESPONDED" }), true);
  assert.equal(encuestaSalio({ status: "EXPIRED" }), true);
});

test("Referidos solo se enseña con un código de verdad", () => {
  assert.equal(vistaDePostratamiento({ encuestas: [], codigoDeReferidos: "GABY26" }).referidos.visible, true);
  for (const vacio of [null, undefined, "", "   ", "—"]) {
    assert.equal(vistaDePostratamiento({ encuestas: [], codigoDeReferidos: vacio }).referidos.visible, false, String(vacio));
  }
});

test("con las tres tarjetas el subtítulo las nombra todas", () => {
  const v = vistaDePostratamiento({
    encuestas: [encuesta({ npsType: "POST_DEBOND_3D", status: "SENT" })],
    codigoDeReferidos: "GABY26",
  });
  assert.equal(v.tarjetas, 3);
  assert.equal(v.subtitulo, "Comparativa final, satisfacción y referidos");
});

test("solo con referidos el subtítulo no menciona la encuesta", () => {
  const v = vistaDePostratamiento({ encuestas: SEMBRADAS, codigoDeReferidos: "GABY26" });
  assert.equal(v.tarjetas, 2);
  assert.equal(v.subtitulo, "Comparativa final y referidos");
});
