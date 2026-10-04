// C-62 y C-69 (auditoría de uso).
//  · C-62: «Registrar colocación» solo avisaba de que faltaba el consentimiento de ortodoncia firmado y dejaba pasar.
//    Decisión de Rafael (5): se BLOQUEA. `motivoSinConsentimiento` no existía con el código viejo.
//  · C-69: el calendario de controles y «4 semanas» caían en domingo («dom, 31 de ene de 2027», «dom 1-nov»).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calendarioDeControles,
  diaDeLaSemana,
  diasCerradosDelHorario,
  motivoSinConsentimiento,
  siguienteDiaHabil,
} from "../colocacion";
import { proximaFechaDeControl } from "../hoja-de-control-reglas";

test("C-62: sin consentimiento firmado (o sin poder comprobarlo) no se coloca", () => {
  assert.equal(motivoSinConsentimiento(true), null);
  assert.match(motivoSinConsentimiento(false)!, /Falta el consentimiento de ortodoncia firmado/);
  assert.match(motivoSinConsentimiento(null)!, /No se pudo comprobar/);
});

test("C-69: el calendario propuesto no cae en domingo (sin horario de la clínica)", () => {
  // Colocación el sábado 3-oct-2026, un control cada 30 días: con el código viejo el 4.º caía en domingo 31-ene-2027.
  const cal = calendarioDeControles("2026-10-03", 30, 12);
  assert.ok(cal.fechas.every((f) => diaDeLaSemana(f) !== 0), JSON.stringify(cal.fechas));
  assert.equal(cal.fechas[3], "2027-02-01");
  // El siguiente control se cuenta desde la colocación, no desde el día corrido.
  assert.equal(cal.fechas[4], "2027-03-02");
});

test("C-69: con el horario de la clínica se saltan sus días cerrados (aquí sábado y domingo)", () => {
  const cerrados = diasCerradosDelHorario([1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, enabled: true })).concat([{ dayOfWeek: 6, enabled: false }]));
  assert.deepEqual(cerrados, [0, 6]);
  assert.equal(siguienteDiaHabil("2026-10-31", cerrados), "2026-11-02"); // sábado → lunes
  assert.equal(siguienteDiaHabil("2026-11-04", cerrados), "2026-11-04");
  assert.deepEqual(diasCerradosDelHorario([]), [0]);
  // Horario roto (ningún día abierto): no se mueve nada en vez de dar vueltas.
  assert.equal(siguienteDiaHabil("2026-11-01", [0, 1, 2, 3, 4, 5, 6]), "2026-11-01");
});

test("C-69: «4 semanas» desde un domingo propone el lunes", () => {
  const desde = new Date(2026, 9, 4, 10, 0).toISOString(); // domingo 4-oct-2026 10:00 local
  const r = new Date(proximaFechaDeControl({ desde, semanas: 4 }));
  assert.equal(r.getDay(), 1);
  assert.equal(r.getDate(), 2);
});

test("C-66: una colocación programada (futura) no abre el caso «En curso»", async () => {
  const { colocadoAlAbrir } = await import("../colocacion");
  // El cajón manda el día como medianoche UTC.
  assert.equal(colocadoAlAbrir(new Date("2026-10-14T00:00:00.000Z"), "2026-10-03"), false);
  assert.equal(colocadoAlAbrir(new Date("2026-10-03T00:00:00.000Z"), "2026-10-03"), true);
  assert.equal(colocadoAlAbrir(new Date("2026-09-01T00:00:00.000Z"), "2026-10-03"), true);
  assert.equal(colocadoAlAbrir(null, "2026-10-03"), false);
});

test("C-80: «N pospuestas» arriba y en el enlace dicen la misma cifra", async () => {
  const { cuantasPospuestas } = await import("../alertas-pospuestas");
  assert.equal(cuantasPospuestas({ pospuestas: 1, pospuestasLista: [{}, {}] }), 2);
  assert.equal(cuantasPospuestas({ pospuestas: 3 }), 3);
  assert.equal(cuantasPospuestas({}), 0);
});

test("C-84: «Proponer controles» dice cuántos casos no tienen tiempo de tratamiento", async () => {
  const { mensajeDePropuesta } = await import("../completar-casos");
  const nada = mensajeDePropuesta({ propuestos: 0, sinTiempo: 2, yaTenian: 0 });
  assert.equal(nada.tipo, "aviso");
  assert.match(nada.texto, /2 casos sin tiempo de tratamiento/);
  const parte = mensajeDePropuesta({ propuestos: 3, sinTiempo: 1, yaTenian: 1 });
  assert.equal(parte.tipo, "exito");
  assert.match(parte.texto, /Propuestos en 3 casos.*1 caso sin tiempo.*1 caso ya tenía/);
});
