/**
 * Pruebas del cálculo de salud de una clínica. Sin base de datos.
 *
 *   npm run test:salud-clinica
 *
 * Los casos NO son inventados: son las 15 clínicas que hay hoy en producción,
 * con sus fechas y sus estados reales (medidos el 20-sep-2026). Cada `test`
 * dice qué clínica representa, para que cuando el número cambie se pueda ir a
 * mirar la de verdad.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluarSaludClinica,
  resumirCartera,
  ordenarPorAtencion,
  diasDesde,
  DIAS_APAGADA,
  DIAS_ENFRIANDOSE,
  MINUTOS_EN_LINEA,
  type EntradaSaludClinica,
} from "./salud-clinica";
import { computeMrr } from "./mrr-core";

/** El "hoy" de todas las pruebas: el día en que se midió producción. */
const AHORA = new Date("2026-09-20T12:00:00.000Z");

/** Clínica sana por defecto; cada caso pisa sólo lo que le importa. */
function clinica(over: Partial<EntradaSaludClinica> = {}): EntradaSaludClinica {
  return {
    id: "c1",
    createdAt: "2025-01-15T00:00:00.000Z",
    subscriptionStatus: "active",
    trialEndsAt: "2026-10-15T00:00:00.000Z",
    nextBillingDate: "2026-10-15T00:00:00.000Z",
    cancelRequested: false,
    pacientes: 120,
    citasPasadas: 800,
    citasVentana: 40,
    facturasVentana: 12,
    notasVentana: 9,
    citasVentanaPrevia: 30,
    facturasVentanaPrevia: 10,
    notasVentanaPrevia: 8,
    ultimaCitaAt: "2026-09-19T00:00:00.000Z",
    proximaCitaAt: "2026-09-21T00:00:00.000Z",
    ultimoAccesoAt: "2026-09-20T08:00:00.000Z",
    pagosRegistrados: 8,
    ultimoPagoAt: "2026-09-15T00:00:00.000Z",
    ...over,
  };
}

// ── Dientitos Felices — el caso que motivó todo ────────────────────────────
// subscriptionStatus "trialing" (que el GATE cuenta como suscripción viva),
// trial terminado el 4-jul, y sigue agendando: última cita el 18-sep.

const DIENTITOS = clinica({
  id: "dientitos",
  subscriptionStatus: "trialing",
  trialEndsAt: "2026-07-04T00:00:00.000Z",
  nextBillingDate: null,
  pacientes: 64,
  citasPasadas: 210,
  citasVentana: 12,
  ultimaCitaAt: "2026-09-18T00:00:00.000Z",
  pagosRegistrados: 0,
  ultimoPagoAt: null,
});

test("Dientitos Felices: trial vencido y usando, NO «al corriente»", () => {
  const s = evaluarSaludClinica(DIENTITOS, AHORA);

  // El gate sigue diciendo lo suyo — y eso NO se toca: la clínica tiene acceso.
  assert.equal(s.plan.kind, "active");
  assert.equal(s.plan.expired, false);

  // Pero el estado de verdad es otro.
  assert.equal(s.estadoOperativo, "trial-vencido");
  assert.equal(s.severidadMaxima, "critico");
  assert.equal(s.riesgos[0].clave, "trial-vencido-usando");
  assert.match(s.riesgos[0].detalle, /78 días/); // 4-jul → 20-sep
  assert.equal(s.esPrueba, false);
  assert.equal(s.cuentaParaTotales, true);
});

test("el mismo trial vencido SIN uso baja a riesgo medio, no crítico", () => {
  const s = evaluarSaludClinica(
    { ...DIENTITOS, citasVentana: 0, ultimaCitaAt: "2026-06-30T00:00:00.000Z" },
    AHORA,
  );
  assert.equal(s.estadoOperativo, "trial-vencido");
  assert.equal(s.riesgos[0].clave, "trial-vencido-sin-uso");
  assert.equal(s.severidadMaxima, "medio");
});

// ── Menta Dental — "activa" en la pantalla, apagada en la realidad ─────────

const MENTA = clinica({
  id: "menta",
  subscriptionStatus: "active",
  citasVentana: 0,
  ultimaCitaAt: "2026-07-24T00:00:00.000Z",
  proximaCitaAt: null,
  ultimoAccesoAt: "2026-08-02T00:00:00.000Z",
});

test("Menta Dental: paga y no agenda hace 58 días → enfriándose, y sale en riesgo", () => {
  const s = evaluarSaludClinica(MENTA, AHORA);
  assert.equal(s.estadoOperativo, "pagando");
  assert.equal(s.actividad.diasSinCita, 58);
  assert.equal(s.actividad.nivel, "enfriandose");
  assert.equal(s.riesgos.some((r) => r.clave === "enfriandose"), true);
  assert.notEqual(s.severidadMaxima, null);
});

test("activa y sin citas en 60 días → apagada, riesgo alto", () => {
  // Mismos datos, dos semanas después: cruza el umbral.
  const s = evaluarSaludClinica(MENTA, new Date("2026-09-25T12:00:00.000Z"));
  assert.ok(s.actividad.diasSinCita !== null && s.actividad.diasSinCita >= DIAS_APAGADA);
  assert.equal(s.actividad.nivel, "apagada");
  const r = s.riesgos.find((x) => x.clave === "apagada");
  assert.ok(r, "tiene que salir el riesgo «apagada»");
  assert.equal(r.severidad, "alto");
  assert.match(r.detalle, /63 días/);
});

test("los umbrales son los declarados y no un número suelto en la pantalla", () => {
  assert.equal(DIAS_ENFRIANDOSE, 30);
  assert.equal(DIAS_APAGADA, 60);
});

// ── subscriptionStatus = null (Prueba QA, thanos) ──────────────────────────

test("Prueba QA: subscriptionStatus null + trial hasta 2036 → estado decidido, y es prueba", () => {
  const s = evaluarSaludClinica(
    clinica({
      id: "prueba-qa",
      subscriptionStatus: null,
      trialEndsAt: "2036-01-01T00:00:00.000Z",
      nextBillingDate: null,
      pacientes: 0,
      citasPasadas: 0,
      citasVentana: 0,
      ultimaCitaAt: null,
      proximaCitaAt: null,
      ultimoAccesoAt: null,
      pagosRegistrados: 0,
      ultimoPagoAt: null,
    }),
    AHORA,
  );
  // Ni hueco ni "—": tiene estado.
  assert.equal(s.estadoOperativo, "prueba");
  assert.equal(s.esPrueba, true);
  assert.equal(s.cuentaParaTotales, false);
  // Y la fecha de fantasía queda marcada para quien cuente trials.
  assert.equal(s.avisos.periodoImplausible, true);
  // Una prueba no genera ruido en la bandeja de "atender hoy".
  assert.deepEqual(s.riesgos, []);
});

test("subscriptionStatus null con clínica REAL tampoco deja hueco", () => {
  const conPeriodo = evaluarSaludClinica(
    clinica({ id: "null-vigente", subscriptionStatus: null, trialEndsAt: "2026-12-01T00:00:00.000Z", pagosRegistrados: 0 }),
    AHORA,
  );
  assert.equal(conPeriodo.estadoOperativo, "trial-vigente");

  const sinPeriodo = evaluarSaludClinica(
    clinica({ id: "null-vencida", subscriptionStatus: null, trialEndsAt: "2026-02-01T00:00:00.000Z", pagosRegistrados: 0 }),
    AHORA,
  );
  assert.equal(sinPeriodo.estadoOperativo, "vencida");
  assert.equal(sinPeriodo.plan.expired, true);
});

// ── Las seis de pending_payment con cero pacientes ────────────────────────

test("0 pacientes + 0 citas + nunca pagó → prueba, y NO ensucia los totales", () => {
  const basura = [1, 2, 3, 4, 5, 6].map((n) =>
    evaluarSaludClinica(
      clinica({
        id: `basura-${n}`,
        subscriptionStatus: "pending_payment",
        pacientes: 0,
        citasPasadas: 0,
        citasVentana: 0,
        ultimaCitaAt: null,
        proximaCitaAt: null,
        ultimoAccesoAt: null,
        pagosRegistrados: 0,
        ultimoPagoAt: null,
      }),
      AHORA,
    ),
  );
  for (const s of basura) {
    assert.equal(s.esPrueba, true);
    assert.equal(s.estadoOperativo, "prueba");
    assert.equal(s.cuentaParaTotales, false);
  }

  const resumen = resumirCartera([
    ...basura,
    evaluarSaludClinica(MENTA, AHORA),
    evaluarSaludClinica(DIENTITOS, AHORA),
  ]);
  assert.equal(resumen.total, 8);
  assert.equal(resumen.pruebas, 6);
  assert.equal(resumen.reales, 2); // <- lo que un total de clientes debe decir
  assert.equal(resumen.porEstado.pagando, 1);
  assert.equal(resumen.porEstado["trial-vencido"], 1);
  assert.equal(resumen.criticas, 1);
});

test("pending_payment CON actividad no es basura: es un cobro a medias", () => {
  const s = evaluarSaludClinica(
    clinica({
      id: "pendiente-usando",
      subscriptionStatus: "pending_payment",
      trialEndsAt: "2026-12-01T00:00:00.000Z",
      pacientes: 31,
      citasPasadas: 90,
      citasVentana: 9,
      pagosRegistrados: 0,
      ultimoPagoAt: null,
    }),
    AHORA,
  );
  assert.equal(s.esPrueba, false);
  assert.equal(s.estadoOperativo, "pago-pendiente");
  const r = s.riesgos.find((x) => x.clave === "pago-pendiente-usando");
  assert.ok(r);
  assert.equal(r.severidad, "alto");
});

test("una clínica que PAGÓ y aún no carga pacientes es real, no una prueba", () => {
  const s = evaluarSaludClinica(
    clinica({
      id: "pago-sin-arrancar",
      createdAt: "2026-08-01T00:00:00.000Z",
      pacientes: 0,
      citasPasadas: 0,
      citasVentana: 0,
      ultimaCitaAt: null,
      proximaCitaAt: null,
      pagosRegistrados: 1,
    }),
    AHORA,
  );
  assert.equal(s.esPrueba, false);
  assert.equal(s.cuentaParaTotales, true);
  assert.equal(s.actividad.nivel, "sin-estrenar");
  assert.equal(s.riesgos.some((r) => r.clave === "sin-estrenar"), true);
});

// ── BEVADENT — alta de ayer con 272 pacientes ──────────────────────────────

test("BEVADENT: alta de ayer con 272 pacientes se marca como importación", () => {
  const s = evaluarSaludClinica(
    clinica({
      id: "bevadent",
      createdAt: "2026-09-19T00:00:00.000Z",
      pacientes: 272,
      citasPasadas: 0,
      citasVentana: 0,
      ultimaCitaAt: null,
      proximaCitaAt: null,
      pagosRegistrados: 0,
      ultimoPagoAt: null,
      subscriptionStatus: "trialing",
      trialEndsAt: "2026-10-03T00:00:00.000Z",
    }),
    AHORA,
  );
  assert.equal(s.avisos.esImportacion, true);
  assert.equal(s.diasDesdeAlta, 1);
  // Recién nacida: "sin estrenar" todavía no es un reproche.
  assert.equal(s.actividad.nivel, "nueva");
  assert.equal(s.riesgos.some((r) => r.clave === "sin-estrenar"), false);
});

test("una clínica vieja con muchos pacientes NO es una importación", () => {
  const s = evaluarSaludClinica(clinica({ pacientes: 400 }), AHORA);
  assert.equal(s.avisos.esImportacion, false);
});

// ── Cobro fallido, cancelación y acceso ────────────────────────────────────

test("past_due → cobro fallido crítico, con acceso todavía", () => {
  const s = evaluarSaludClinica(
    clinica({ id: "past-due", subscriptionStatus: "past_due", trialEndsAt: "2026-10-10T00:00:00.000Z" }),
    AHORA,
  );
  assert.equal(s.plan.kind, "past_due");
  assert.equal(s.estadoOperativo, "cobro-fallido");
  assert.equal(s.severidadMaxima, "critico");
});

test("cancelación solicitada sale aunque la clínica esté sana", () => {
  const s = evaluarSaludClinica(clinica({ cancelRequested: true }), AHORA);
  assert.equal(s.estadoOperativo, "pagando");
  assert.equal(s.riesgos.some((r) => r.clave === "cancelacion-solicitada"), true);
});

test("sin registro de acceso es un AVISO DE DATO, nunca un riesgo", () => {
  // users.lastLogin está vacío en las 36 filas de producción y
  // analytics_sessions solo cubre a 4 clínicas: una alarma aquí sería falsa en
  // casi todo el roster. Se dice lo que se sabe y no más.
  const s = evaluarSaludClinica(clinica({ ultimoAccesoAt: null }), AHORA);
  assert.equal(s.actividad.ultimoAccesoAt, null);
  assert.equal(s.actividad.diasSinAcceso, null);
  assert.equal(s.avisos.sinRegistroDeAcceso, true);
  assert.deepEqual(s.riesgos, [], "no puede generar riesgo");
});

test("con acceso registrado el aviso se apaga", () => {
  const s = evaluarSaludClinica(clinica({ ultimoAccesoAt: "2026-09-19T00:00:00.000Z" }), AHORA);
  assert.equal(s.avisos.sinRegistroDeAcceso, false);
  assert.equal(s.actividad.diasSinAcceso, 1);
});

// ── Cuánto ha hecho, no solo si hizo algo ─────────────────────────────────

test("el volumen suma citas + facturas + notas de la ventana", () => {
  // Local Altabrisa, los números reales de los últimos 30 días.
  const s = evaluarSaludClinica(
    clinica({ id: "altabrisa", citasVentana: 116, facturasVentana: 1, notasVentana: 2 }),
    AHORA,
  );
  assert.deepEqual(s.actividad.volumen, { citas: 116, facturas: 1, notas: 2, total: 119 });
});

test("una clínica que trabaja y otra que solo entra a mirar no dan el mismo volumen", () => {
  const trabaja = evaluarSaludClinica(
    clinica({ id: "altabrisa", citasVentana: 116, facturasVentana: 1, notasVentana: 2 }), AHORA);
  const mira = evaluarSaludClinica(
    clinica({ id: "dientitos", citasVentana: 1, facturasVentana: 0, notasVentana: 0 }), AHORA);
  assert.ok(trabaja.actividad.volumen.total > mira.actividad.volumen.total * 50);
});

test("la tendencia compara con la ventana anterior", () => {
  const sube = evaluarSaludClinica(
    clinica({ citasVentana: 20, facturasVentana: 0, notasVentana: 0,
              citasVentanaPrevia: 10, facturasVentanaPrevia: 0, notasVentanaPrevia: 0 }), AHORA);
  assert.equal(sube.actividad.tendencia.direccion, "sube");
  assert.equal(sube.actividad.tendencia.deltaPct, 100);

  const baja = evaluarSaludClinica(
    clinica({ citasVentana: 5, facturasVentana: 0, notasVentana: 0,
              citasVentanaPrevia: 20, facturasVentanaPrevia: 0, notasVentanaPrevia: 0 }), AHORA);
  assert.equal(baja.actividad.tendencia.direccion, "baja");
  assert.equal(baja.actividad.tendencia.deltaPct, -75);

  const igual = evaluarSaludClinica(
    clinica({ citasVentana: 7, facturasVentana: 0, notasVentana: 0,
              citasVentanaPrevia: 7, facturasVentanaPrevia: 0, notasVentanaPrevia: 0 }), AHORA);
  assert.equal(igual.actividad.tendencia.direccion, "igual");
  assert.equal(igual.actividad.tendencia.deltaPct, 0);
});

test("de cero a algo NO es un porcentaje: deltaPct es null, no +100 %", () => {
  const s = evaluarSaludClinica(
    clinica({ citasVentana: 9, facturasVentana: 0, notasVentana: 0,
              citasVentanaPrevia: 0, facturasVentanaPrevia: 0, notasVentanaPrevia: 0 }), AHORA);
  assert.equal(s.actividad.tendencia.direccion, "sube");
  assert.equal(s.actividad.tendencia.deltaPct, null);
});

test("sin los campos nuevos el volumen no se inventa: cuenta solo las citas", () => {
  // Las tres pantallas no tienen por qué pasar los seis contadores.
  const s = evaluarSaludClinica(clinica({ citasVentana: 4,
    facturasVentana: undefined, notasVentana: undefined,
    citasVentanaPrevia: undefined, facturasVentanaPrevia: undefined, notasVentanaPrevia: undefined }), AHORA);
  assert.deepEqual(s.actividad.volumen, { citas: 4, facturas: 0, notas: 0, total: 4 });
  assert.equal(s.actividad.tendencia.deltaPct, null);
});

test("«en línea» es opt-in y por defecto es false, no un sí inventado", () => {
  assert.equal(MINUTOS_EN_LINEA, 15);
  assert.equal(evaluarSaludClinica(clinica(), AHORA).actividad.enLinea, false);
  assert.equal(evaluarSaludClinica(clinica({ enLinea: true }), AHORA).actividad.enLinea, true);
});

test("una clínica sana no inventa riesgos", () => {
  const s = evaluarSaludClinica(clinica(), AHORA);
  assert.deepEqual(s.riesgos, []);
  assert.equal(s.severidadMaxima, null);
  assert.equal(s.prioridad, 0);
  assert.equal(s.estadoOperativo, "pagando");
  assert.equal(s.actividad.nivel, "activa");
});

// ── Orden de la bandeja ────────────────────────────────────────────────────

test("ordenarPorAtencion pone lo crítico arriba y deja fuera lo que no pasa nada", () => {
  const sana     = evaluarSaludClinica(clinica({ id: "sana" }), AHORA);
  const menta    = evaluarSaludClinica(MENTA, AHORA);
  const dientitos = evaluarSaludClinica(DIENTITOS, AHORA);
  const orden = ordenarPorAtencion([sana, menta, dientitos]);
  assert.deepEqual(orden.map((s) => s.id), ["dientitos", "menta"]);
});

test("entre dos apagadas sale antes la que lleva más tiempo muerta", () => {
  const base = { ...MENTA, subscriptionStatus: "active" as const };
  const vieja  = evaluarSaludClinica({ ...base, id: "vieja",  ultimaCitaAt: "2026-01-10T00:00:00.000Z" }, AHORA);
  const reciente = evaluarSaludClinica({ ...base, id: "reciente", ultimaCitaAt: "2026-06-10T00:00:00.000Z" }, AHORA);
  assert.deepEqual(ordenarPorAtencion([reciente, vieja]).map((s) => s.id), ["vieja", "reciente"]);
});

// ── Fechas ─────────────────────────────────────────────────────────────────

test("diasDesde cuenta días enteros y aguanta null y futuro", () => {
  assert.equal(diasDesde(null, AHORA), null);
  assert.equal(diasDesde(undefined, AHORA), null);
  assert.equal(diasDesde("2026-09-20T00:00:00.000Z", AHORA), 0);
  assert.equal(diasDesde("2026-09-19T00:00:00.000Z", AHORA), 1);
  assert.equal(diasDesde("2026-09-25T00:00:00.000Z", AHORA), -5);
  assert.equal(diasDesde("no-es-una-fecha", AHORA), null);
});

// ── MRR: el precio negociado manda sobre el del plan ───────────────────────
// No se recalcula aquí: se comprueba que la fuente única (mrr-core) es la que
// contesta, porque la lista de clínicas la usa para su KPI.

test("una clínica con precio negociado aporta el negociado, no el del plan", () => {
  const precios = { BASIC: 419, PRO: 689, CLINIC: 1719 };
  const mrr = computeMrr(
    [
      { plan: "PRO", monthlyPrice: 500, subscriptionStatus: "active" },  // negociado
      { plan: "PRO", monthlyPrice: 0,   subscriptionStatus: "active" },  // lista
    ],
    precios,
  );
  assert.equal(mrr.total, 500 + 689);
  assert.equal(mrr.byPlan[0].negotiated, 1);
});
