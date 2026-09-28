/**
 * Portal del paciente — «Tu ortodoncia» y la cita nueva con varios pacientes
 * en la misma cuenta (ws1-t5, hallazgos 93 a 96 y fila 16 del mapa).
 *
 * Run: npx tsx --test src/lib/patient-portal/__tests__/ortodoncia-portal.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avanceDelCaso,
  calendarioDeMensualidades,
  diaDeLaClinica,
  elasticoParaPaciente,
  estadoDelCasoParaPaciente,
  fechaConHoraEnClinica,
  fechaDeRegistro,
  fechaSinHora,
  hayQueNombrarAlPaciente,
  inicioDeVentana,
  pacienteDeLaCita,
  permisosDelCaso,
  porcentajeDeAvance,
  registroDiario,
  ultimoControlParaPaciente,
} from "../ortodoncia-portal";

const MX = "America/Mexico_City";

// ── 95: el día es el de la clínica ───────────────────────────────────────────

test("95 · a las 19:30 de México sigue siendo hoy, no mañana", () => {
  // 28-sep 19:30 en México = 29-sep 01:30 UTC.
  const ahora = new Date("2026-09-29T01:30:00.000Z");
  assert.equal(ahora.toISOString().slice(0, 10), "2026-09-29", "en UTC ya es mañana");
  assert.equal(diaDeLaClinica(ahora, MX), "2026-09-28");
});

test("95 · a media mañana coincide con UTC", () => {
  assert.equal(diaDeLaClinica(new Date("2026-09-28T16:00:00.000Z"), MX), "2026-09-28");
});

test("95 · una clínica en Tijuana a las 23:00 sigue en su día", () => {
  // 28-sep 23:00 en Tijuana (UTC-7) = 29-sep 06:00 UTC.
  assert.equal(diaDeLaClinica(new Date("2026-09-29T06:00:00.000Z"), "America/Tijuana"), "2026-09-28");
});

test("95 · sin zona o con una zona mal escrita no revienta: usa la de México", () => {
  const ahora = new Date("2026-09-29T01:30:00.000Z");
  assert.equal(diaDeLaClinica(ahora, null), "2026-09-28");
  assert.equal(diaDeLaClinica(ahora, "Marte/Olimpo"), "2026-09-28");
});

test("95 · el día se guarda a medianoche UTC y la ventana cuenta hacia atrás", () => {
  assert.equal(fechaDeRegistro("2026-09-28").toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(inicioDeVentana("2026-09-28", 14).toISOString(), "2026-09-14T00:00:00.000Z");
  assert.equal(inicioDeVentana("2026-03-05", 14).toISOString(), "2026-02-19T00:00:00.000Z");
});

// ── 95: la pregunta, solo a quien los lleva ──────────────────────────────────

const base = { estado: "IN_PROGRESS", soloLectura: false, elasticosVigentes: 0, estadoAlineador: null };

test("95 · brackets sin elásticos: no se le pregunta nada", () => {
  assert.deepEqual(registroDiario(base), { preguntar: false, pregunta: "" });
});

test("95 · con elásticos vigentes se le pregunta por los elásticos", () => {
  const r = registroDiario({ ...base, elasticosVigentes: 2 });
  assert.equal(r.preguntar, true);
  assert.equal(r.pregunta, "¿Usaste tus elásticos hoy?");
});

test("95 · con alineadores activos se le pregunta por los alineadores", () => {
  const r = registroDiario({ ...base, estadoAlineador: "ACTIVE" });
  assert.equal(r.preguntar, true);
  assert.equal(r.pregunta, "¿Usaste tus alineadores hoy?");
});

test("95 · con los dos, una sola pregunta que nombra los dos", () => {
  const r = registroDiario({ ...base, elasticosVigentes: 1, estadoAlineador: "ACTIVE" });
  assert.equal(r.pregunta, "¿Usaste hoy tus alineadores y tus elásticos?");
});

test("95 · alineadores en pausa o terminados no cuentan", () => {
  assert.equal(registroDiario({ ...base, estadoAlineador: "PAUSED" }).preguntar, false);
  assert.equal(registroDiario({ ...base, estadoAlineador: "FINISHED" }).preguntar, false);
});

test("95 · caso en pausa, en retención, terminado o cerrado: no se pregunta aunque tuviera elásticos", () => {
  for (const estado of ["ON_HOLD", "RETENTION", "COMPLETED", "DROPPED_OUT"]) {
    const r = registroDiario({ ...base, estado, elasticosVigentes: 2, estadoAlineador: "ACTIVE" });
    assert.equal(r.preguntar, false, estado);
  }
});

test("95 · de solo lectura nunca se pregunta", () => {
  assert.equal(registroDiario({ ...base, soloLectura: true, elasticosVigentes: 3 }).preguntar, false);
});

// ── Mapa 16: caso terminado y módulo apagado ─────────────────────────────────

test("16 · un caso abierto con el módulo activo se puede usar entero", () => {
  for (const estado of ["PLANNED", "IN_PROGRESS", "ON_HOLD", "RETENTION"]) {
    assert.deepEqual(permisosDelCaso(estado, true), { soloLectura: false, aviso: null }, estado);
  }
});

test("16 · un caso terminado se puede LEER, y dice que ya terminó", () => {
  const p = permisosDelCaso("COMPLETED", true);
  assert.equal(p.soloLectura, true);
  assert.match(p.aviso ?? "", /ya terminó/);
});

test("16 · un caso cerrado por abandono no usa la palabra «abandono» con el paciente", () => {
  const p = permisosDelCaso("DROPPED_OUT", true);
  assert.equal(p.soloLectura, true);
  assert.doesNotMatch(p.aviso ?? "", /abandon/i);
  assert.doesNotMatch(estadoDelCasoParaPaciente("DROPPED_OUT"), /abandon/i);
});

test("16 · decisión 3: con el módulo apagado el paciente sigue leyendo, sin registrar ni mandar fotos", () => {
  const p = permisosDelCaso("IN_PROGRESS", false);
  assert.equal(p.soloLectura, true);
  assert.match(p.aviso ?? "", /sigue disponible/);
});

test("16 · un estado desconocido se trata como cerrado", () => {
  assert.equal(permisosDelCaso("OTRO", true).soloLectura, true);
  assert.equal(estadoDelCasoParaPaciente("OTRO"), "Sin estado");
});

test("16 · estados en español para el paciente", () => {
  assert.equal(estadoDelCasoParaPaciente("IN_PROGRESS"), "En tratamiento");
  assert.equal(estadoDelCasoParaPaciente("ON_HOLD"), "En pausa");
  assert.equal(estadoDelCasoParaPaciente("RETENTION"), "En retención");
  assert.equal(estadoDelCasoParaPaciente("COMPLETED"), "Terminado");
});

// ── 94: avance ───────────────────────────────────────────────────────────────

const FASES = [
  { phaseKey: "ALIGNMENT", status: "IN_PROGRESS", orderIndex: 0 },
  { phaseKey: "LEVELING", status: "NOT_STARTED", orderIndex: 1 },
];

test("94 · «Mes 2 de 18 · Alineación», con la misma cuenta que la ficha", () => {
  const a = avanceDelCaso({
    installedAt: new Date("2026-07-20T15:00:00.000Z"),
    estimatedDurationMonths: 18,
    fases: FASES,
    ahora: new Date("2026-09-28T18:00:00.000Z"),
  });
  assert.equal(a.mes, 2);
  assert.equal(a.de, 18);
  assert.equal(a.fase, "Alineación");
  assert.equal(a.texto, "Mes 2 de 18 · Alineación");
  assert.equal(porcentajeDeAvance(a), 11);
});

test("94 · recién colocado no dice «Mes 0»", () => {
  const a = avanceDelCaso({
    installedAt: new Date("2026-09-20T15:00:00.000Z"),
    estimatedDurationMonths: 18,
    fases: FASES,
    ahora: new Date("2026-09-28T18:00:00.000Z"),
  });
  assert.equal(a.texto, "Primer mes de 18 · Alineación");
  assert.equal(porcentajeDeAvance(a), 0);
});

test("94 · sin aparatos colocados dice la duración estimada, sin inventar un mes", () => {
  const a = avanceDelCaso({ installedAt: null, estimatedDurationMonths: 24, fases: [], ahora: new Date() });
  assert.equal(a.mes, null);
  assert.equal(a.texto, "Duración estimada: 24 meses");
  assert.equal(porcentajeDeAvance(a), null);
});

test("94 · pasado de la duración estimada la barra no pasa de 100", () => {
  const a = avanceDelCaso({
    installedAt: new Date("2024-01-10T15:00:00.000Z"),
    estimatedDurationMonths: 18,
    fases: [{ phaseKey: "FINISHING", status: "IN_PROGRESS", orderIndex: 4 }],
    ahora: new Date("2026-09-28T18:00:00.000Z"),
  });
  assert.equal(a.texto, "Mes 32 de 18 · Finalización");
  assert.equal(porcentajeDeAvance(a), 100);
});

test("94 · la fase en curso es la primera en orden, vengan como vengan", () => {
  const a = avanceDelCaso({
    installedAt: new Date("2026-01-10T15:00:00.000Z"),
    estimatedDurationMonths: 12,
    fases: [
      { phaseKey: "SPACE_CLOSURE", status: "IN_PROGRESS", orderIndex: 2 },
      { phaseKey: "ALIGNMENT", status: "COMPLETED", orderIndex: 0 },
      { phaseKey: "LEVELING", status: "IN_PROGRESS", orderIndex: 1 },
    ],
    ahora: new Date("2026-09-28T18:00:00.000Z"),
  });
  assert.equal(a.fase, "Nivelación");
});

// ── 94: indicaciones y elásticos del último control ─────────────────────────

test("94 · el último control enseña las indicaciones y los elásticos, nunca la nota clínica", () => {
  const hoja = {
    visitDate: new Date("2026-09-29T01:30:00.000Z"), // 28-sep 19:30 en México
    indications: "  Usa los elásticos 20 horas al día. Evita chicle y caramelo.  ",
    elastics: [{ elasticClass: "CLASE_II", config: '1/4" 6oz', zone: "INTERMAXILAR" }],
    // Lo que NO debe salir aunque venga en la fila:
    soapS: "Refiere dolor",
    soapA: "Clase II esquelética",
  };
  const u = ultimoControlParaPaciente(hoja, MX);
  assert.ok(u);
  assert.equal(u.fecha, "2026-09-28");
  assert.equal(u.indicaciones, "Usa los elásticos 20 horas al día. Evita chicle y caramelo.");
  assert.deepEqual(u.elasticos, [{ texto: 'Clase II · 1/4" 6oz · de arriba a abajo' }]);
  assert.doesNotMatch(JSON.stringify(u), /dolor|esquelética|soap/i);
});

test("94 · sin control firmado no hay bloque; con indicaciones en blanco quedan en null", () => {
  assert.equal(ultimoControlParaPaciente(null, MX), null);
  const u = ultimoControlParaPaciente({ visitDate: new Date("2026-09-28T16:00:00Z"), indications: "   ", elastics: [] }, MX);
  assert.equal(u?.indicaciones, null);
  assert.deepEqual(u?.elasticos, []);
});

test("94 · un elástico de clase o zona desconocida no sale vacío", () => {
  assert.equal(elasticoParaPaciente({ elasticClass: "NUEVA", config: "", zone: "OTRA" }).texto, "NUEVA");
});

// ── 94: calendario de mensualidades ─────────────────────────────────────────

function cuota(
  numero: number,
  estado: "pagada" | "vencida" | "porVencer",
  vencimiento: string | null,
  extra: Partial<{ esEnganche: boolean; importe: number; falta: number; invoiceId: string }> = {},
) {
  const importe = extra.importe ?? 1000;
  return {
    numero,
    esEnganche: extra.esEnganche ?? false,
    importe,
    vencimiento,
    abonado: importe - (extra.falta ?? (estado === "pagada" ? 0 : importe)),
    falta: extra.falta ?? (estado === "pagada" ? 0 : importe),
    estado,
    ...(extra.invoiceId ? { invoiceId: extra.invoiceId } : {}),
  };
}

test("94 · el calendario sale en orden: enganche, pagadas, vencida y las que vienen", () => {
  const vencida = cuota(2, "vencida", "2026-09-05", { falta: 400 });
  const cal = calendarioDeMensualidades({
    pagadas: [cuota(0, "pagada", "2026-07-05", { esEnganche: true, importe: 5000 }), cuota(1, "pagada", "2026-08-05")],
    vencidas: [vencida],
    proximas: [cuota(4, "porVencer", "2026-11-05"), cuota(3, "porVencer", "2026-10-05")],
    cuotaDeHoy: vencida,
  });
  assert.deepEqual(
    cal.map((c) => [c.etiqueta, c.estado, c.vencimiento, c.faltaMxn, c.esLaQueSigue]),
    [
      ["Enganche", "pagada", "2026-07-05", 0, false],
      ["Mensualidad 1", "pagada", "2026-08-05", 0, false],
      ["Mensualidad 2", "vencida", "2026-09-05", 400, true],
      ["Mensualidad 3", "porVencer", "2026-10-05", 1000, false],
      ["Mensualidad 4", "porVencer", "2026-11-05", 1000, false],
    ],
  );
});

test("94 · con todo pagado ninguna es «la que sigue»", () => {
  const cal = calendarioDeMensualidades({
    pagadas: [cuota(1, "pagada", "2026-08-05"), cuota(2, "pagada", "2026-09-05")],
    vencidas: [],
    proximas: [],
    cuotaDeHoy: null,
  });
  assert.equal(cal.length, 2);
  assert.equal(cal.some((c) => c.esLaQueSigue), false);
});

test("94 · en pago por control cada cargo se llama «Control», no «Mensualidad N»", () => {
  const debe = cuota(1, "vencida", "2026-09-10", { invoiceId: "fac-2", importe: 800 });
  const cal = calendarioDeMensualidades({
    pagadas: [cuota(1, "pagada", "2026-08-10", { invoiceId: "fac-1", importe: 800 })],
    vencidas: [debe],
    proximas: [],
    cuotaDeHoy: debe,
  });
  assert.deepEqual(cal.map((c) => c.etiqueta), ["Control", "Control"]);
  assert.deepEqual(cal.map((c) => c.esLaQueSigue), [false, true]);
});

test("94 · sin plan de pago el calendario sale vacío", () => {
  assert.deepEqual(calendarioDeMensualidades({ pagadas: [], vencidas: [], proximas: [], cuotaDeHoy: null }), []);
});

// ── 93: una cuenta, varios pacientes ─────────────────────────────────────────

const NORTE = "clinica-norte";
const SUR = "clinica-sur";
const MAMA = [
  { patientId: "ana", clinicId: NORTE },
  { patientId: "luis", clinicId: NORTE },
];

test("93 · con un solo paciente no hace falta nombrarlo; con dos, sí", () => {
  assert.equal(hayQueNombrarAlPaciente([{ patientId: "ana" }]), false);
  assert.equal(hayQueNombrarAlPaciente([{ patientId: "ana" }, { patientId: "ana" }]), false);
  assert.equal(hayQueNombrarAlPaciente(MAMA), true);
});

test("93 · la cita del segundo hijo queda a SU nombre", () => {
  assert.deepEqual(pacienteDeLaCita(MAMA, NORTE, "luis"), { ok: true, patientId: "luis" });
  assert.deepEqual(pacienteDeLaCita(MAMA, NORTE, "ana"), { ok: true, patientId: "ana" });
});

test("93 · con dos hijos en la clínica y sin decir cuál, no se adivina", () => {
  assert.deepEqual(pacienteDeLaCita(MAMA, NORTE, undefined), { ok: false, motivo: "falta-elegir" });
  assert.deepEqual(pacienteDeLaCita(MAMA, NORTE, "  "), { ok: false, motivo: "falta-elegir" });
});

test("93 · con un solo paciente en la clínica sigue funcionando sin mandar nada", () => {
  assert.deepEqual(pacienteDeLaCita([{ patientId: "ana", clinicId: NORTE }], NORTE, null), {
    ok: true,
    patientId: "ana",
  });
});

test("93 · seguridad: un paciente que no es de la cuenta se rechaza", () => {
  assert.deepEqual(pacienteDeLaCita(MAMA, NORTE, "otro-paciente"), { ok: false, motivo: "ajeno" });
});

test("93 · seguridad: un paciente de la cuenta pero de OTRA clínica se rechaza", () => {
  const vinculos = [...MAMA, { patientId: "ana-sur", clinicId: SUR }];
  assert.deepEqual(pacienteDeLaCita(vinculos, NORTE, "ana-sur"), { ok: false, motivo: "ajeno" });
  assert.deepEqual(pacienteDeLaCita(vinculos, SUR, "ana"), { ok: false, motivo: "ajeno" });
  assert.deepEqual(pacienteDeLaCita(vinculos, SUR, undefined), { ok: true, patientId: "ana-sur" });
});

test("93 · seguridad: una clínica sin vínculo no agenda, aunque mande un paciente", () => {
  assert.deepEqual(pacienteDeLaCita(MAMA, SUR, "ana"), { ok: false, motivo: "sin-vinculo" });
  assert.deepEqual(pacienteDeLaCita([], NORTE, "ana"), { ok: false, motivo: "sin-vinculo" });
});

// ── Fechas para pintar ───────────────────────────────────────────────────────

test("una fecha sin hora no se recorre un día al pintarla", () => {
  assert.match(fechaSinHora("2026-10-05"), /^5 oct\.? 2026$/);
  assert.match(fechaSinHora("2026-01-01"), /^1 ene\.? 2026$/);
  assert.equal(fechaSinHora("sin fecha"), "sin fecha");
});

test("el próximo control se pinta en la hora de la clínica", () => {
  // Martes 29-sep 19:00 en México = miércoles 30-sep 01:00 UTC.
  const texto = fechaConHoraEnClinica("2026-09-30T01:00:00.000Z", MX);
  assert.equal(texto, "martes 29 de septiembre a las 19:00");
  // La misma cita, vista desde una clínica en Tijuana, es a las 18:00.
  assert.equal(fechaConHoraEnClinica("2026-09-30T01:00:00.000Z", "America/Tijuana"), "martes 29 de septiembre a las 18:00");
  // Medianoche se escribe 00:00, no 24:00.
  assert.equal(fechaConHoraEnClinica("2026-09-30T06:00:00.000Z", MX), "miércoles 30 de septiembre a las 00:00");
  assert.equal(fechaConHoraEnClinica("no es fecha", MX), "");
});
