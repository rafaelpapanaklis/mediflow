/**
 * Portal del paciente — lo que VE el paciente en «Tu ortodoncia» (ws1-t5,
 * hallazgos 93 a 96 y fila 16 del mapa de la revisión de lógica de uso).
 *
 * Run: npx tsx --tsconfig tsconfig.test.json --test src/components/paciente/__tests__/vista-ortodoncia.test.tsx
 *
 * Pinta la vista real a HTML con casos inventados. Lo que escribe (registro
 * diario, foto) llega por `acciones`, así que aquí no hay base ni sesión.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { VistaOrtodoncia, type AccionesOrtodonciaPortal } from "../ortodoncia/vista-ortodoncia";
import type { PacienteOrtodonciaCase } from "../../../app/api/paciente/ortodoncia/route";

const ACCIONES: AccionesOrtodonciaPortal = {
  registrarUso: async () => ({ ok: true }),
  enviarFoto: async () => ({ ok: true }),
};

function caso(extra: Partial<PacienteOrtodonciaCase> = {}): PacienteOrtodonciaCase {
  return {
    treatmentPlanId: "plan-1",
    clinicId: "clinica-1",
    clinicName: "Clínica Sonrisa",
    timezone: "America/Mexico_City",
    patientName: "Ana Ruiz",
    mostrarNombre: false,
    estado: "En tratamiento",
    soloLectura: false,
    avisoSoloLectura: null,
    avance: { texto: "Mes 2 de 18 · Alineación", porcentaje: 11 },
    ultimoControl: null,
    calendario: [],
    registro: { preguntar: false, pregunta: "" },
    aligner: null,
    compliance: { windowDays: 14, compliancePct: null, isLow: false },
    todayLogged: false,
    cobranza: null,
    proximoControl: null,
    ...extra,
  };
}

function pintar(cases: PacienteOrtodonciaCase[]): string {
  return renderToStaticMarkup(<VistaOrtodoncia cases={cases} onSaved={() => {}} acciones={ACCIONES} />);
}

test("93 · con dos hijos, cada tarjeta dice de quién es", () => {
  const html = pintar([
    caso({ treatmentPlanId: "a", patientName: "Ana Ruiz", mostrarNombre: true }),
    caso({ treatmentPlanId: "b", patientName: "Luis Ruiz", mostrarNombre: true }),
  ]);
  assert.match(html, /Ana Ruiz · Clínica Sonrisa/);
  assert.match(html, /Luis Ruiz · Clínica Sonrisa/);
});

test("93 · con un solo paciente la tarjeta sigue llevando el nombre de la clínica", () => {
  const html = pintar([caso()]);
  assert.match(html, /<h2[^>]*>Clínica Sonrisa<\/h2>/);
  assert.doesNotMatch(html, /Ana Ruiz/);
});

test("94 · se ve el estado, el avance y la barra", () => {
  const html = pintar([caso()]);
  assert.match(html, /En tratamiento/);
  assert.match(html, /Mes 2 de 18 · Alineación/);
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="11"/);
});

test("94 · las indicaciones y los elásticos del último control", () => {
  const html = pintar([
    caso({
      ultimoControl: {
        fecha: "2026-09-28",
        indicaciones: "Usa los elásticos 20 horas al día.",
        elasticos: [{ texto: 'Clase II · 1/4" 6oz · de arriba a abajo' }],
      },
    }),
  ]);
  assert.match(html, /Indicaciones de tu último control/);
  assert.match(html, /Control del 28 sep\.? 2026/);
  assert.match(html, /Usa los elásticos 20 horas al día\./);
  assert.match(html, /Clase II · 1\/4&quot; 6oz · de arriba a abajo/);
});

test("94 · un control sin indicaciones escritas lo dice, no deja el bloque vacío", () => {
  const html = pintar([caso({ ultimoControl: { fecha: "2026-09-28", indicaciones: null, elasticos: [] } })]);
  assert.match(html, /No quedaron indicaciones escritas/);
});

test("94 · el calendario lista cada mensualidad con su estado y su fecha sin recorrer", () => {
  const html = pintar([
    caso({
      cobranza: { cuotaDeHoyMxn: 400, proximoVencimiento: "2026-10-05", vencidoMxn: 400, saldoTotalMxn: 16400 },
      calendario: [
        { etiqueta: "Enganche", vencimiento: "2026-07-05", importeMxn: 5000, faltaMxn: 0, estado: "pagada", esLaQueSigue: false },
        { etiqueta: "Mensualidad 1", vencimiento: "2026-09-05", importeMxn: 1000, faltaMxn: 400, estado: "vencida", esLaQueSigue: true },
        { etiqueta: "Mensualidad 2", vencimiento: "2026-10-05", importeMxn: 1000, faltaMxn: 1000, estado: "porVencer", esLaQueSigue: false },
      ],
    }),
  ]);
  assert.match(html, /Calendario de pagos/);
  assert.match(html, /1 de 3 pagados/);
  assert.match(html, /Mensualidad 1/);
  assert.match(html, /la que sigue/);
  assert.match(html, /5 sep\.? 2026 · faltan \$400\.00/);
  assert.match(html, /5 oct\.? 2026/);
  assert.match(html, /Vencida/);
  assert.match(html, /Por pagar/);
  assert.match(html, /Tienes \$400\.00 vencido/);
});

test("94 · la próxima mensualidad dice su fecha sin recorrerla un día", () => {
  const html = pintar([
    caso({ cobranza: { cuotaDeHoyMxn: 1000, proximoVencimiento: "2026-10-05", vencidoMxn: 0, saldoTotalMxn: 16000 } }),
  ]);
  assert.match(html, /Próxima mensualidad: <strong>\$1,000\.00<\/strong> · vence el 5 oct\.? 2026/);
});

test("94 · el próximo control sale con día y hora de la clínica", () => {
  // Martes 29-sep 19:00 en México = miércoles 30-sep 01:00 UTC.
  const html = pintar([caso({ proximoControl: "2026-09-30T01:00:00.000Z" })]);
  assert.match(html, /Tu próximo control es el/);
  assert.match(html, /martes 29 de septiembre a las 19:00/);
});

test("95 · brackets sin elásticos: ni pregunta ni «0 %» de cumplimiento", () => {
  const html = pintar([caso()]);
  assert.doesNotMatch(html, /¿Usaste/);
  assert.doesNotMatch(html, /Cumplimiento/);
  assert.doesNotMatch(html, /Sí, hoy sí/);
});

test("95 · a quien lleva elásticos se le pregunta por sus elásticos", () => {
  const html = pintar([caso({ registro: { preguntar: true, pregunta: "¿Usaste tus elásticos hoy?" } })]);
  assert.match(html, /¿Usaste tus elásticos hoy\?/);
  assert.match(html, /Sí, hoy sí/);
  assert.doesNotMatch(html, /alineador/i);
});

test("95 · si ya marcó hoy se le agradece y no se le vuelve a preguntar", () => {
  const html = pintar([
    caso({ registro: { preguntar: true, pregunta: "¿Usaste tus elásticos hoy?" }, todayLogged: true }),
  ]);
  assert.match(html, /Ya marcaste hoy/);
  assert.doesNotMatch(html, /Sí, hoy sí/);
});

test("96 · un caso abierto puede mandar fotos de seguimiento", () => {
  assert.match(pintar([caso()]), /Envía una foto de seguimiento/);
});

test("16 · un caso terminado se lee, sin pregunta diaria ni fotos", () => {
  const html = pintar([
    caso({
      estado: "Terminado",
      soloLectura: true,
      avisoSoloLectura: "Este caso ya terminó. Aquí queda tu información para consultarla.",
      ultimoControl: { fecha: "2026-08-10", indicaciones: "Usa tu retenedor por las noches.", elasticos: [] },
      calendario: [
        { etiqueta: "Mensualidad 1", vencimiento: "2026-01-05", importeMxn: 1000, faltaMxn: 0, estado: "pagada", esLaQueSigue: false },
      ],
      cobranza: { cuotaDeHoyMxn: null, proximoVencimiento: null, vencidoMxn: 0, saldoTotalMxn: 0 },
    }),
  ]);
  assert.match(html, /Terminado/);
  assert.match(html, /Este caso ya terminó/);
  assert.match(html, /Usa tu retenedor por las noches\./);
  assert.match(html, /Calendario de pagos/);
  assert.match(html, /Vas al corriente con tus pagos/);
  assert.doesNotMatch(html, /¿Usaste/);
  assert.doesNotMatch(html, /Envía una foto/);
  assert.doesNotMatch(html, /Ir a Tus pagos/, "sin deuda no se ofrece pagar");
  assert.doesNotMatch(html, /Te falta por pagar/);
});

test("16 · un caso terminado que todavía debe sí ofrece ir a pagar", () => {
  const html = pintar([
    caso({
      estado: "Terminado",
      soloLectura: true,
      avisoSoloLectura: "Este caso ya terminó. Aquí queda tu información para consultarla.",
      cobranza: { cuotaDeHoyMxn: 1000, proximoVencimiento: null, vencidoMxn: 1000, saldoTotalMxn: 1000 },
    }),
  ]);
  assert.match(html, /Tienes \$1,000\.00 vencido/);
  assert.match(html, /Ir a Tus pagos/);
});

test("sin casos se dice, con la palabra «caso»", () => {
  assert.match(pintar([]), /Todavía no tienes un caso de ortodoncia\./);
});
