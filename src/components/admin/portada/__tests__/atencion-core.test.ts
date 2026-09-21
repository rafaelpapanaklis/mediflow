/**
 * Portada de /admin — «qué exige atención hoy».
 *
 * Run: npm run test:admin-portada
 *
 * Qué protege, caso por caso (los tres primeros son los que pidió la tarea, y
 * los tres salen de lo que se midió en producción el 20-sep-2026):
 *
 *  1. Una clínica con el trial VENCIDO y citas este mes tiene que SALIR. Es
 *     `Dientitos Felices`: dos meses y medio vencida, atendiendo pacientes, y
 *     la portada vieja no la enseñaba por ningún lado.
 *  2. Una cuenta de pruebas (0 pacientes, 0 citas, nunca pagó) NO puede
 *     ensuciar los totales. Eran seis de quince: sin apartarlas, «6 clínicas
 *     exigen atención» era ruido y el panel se dejaba de mirar.
 *  3. Sin nada que atender la sección lo DICE. Un hueco mudo se lee igual que
 *     una consulta que no corrió.
 *
 * Y además: que el criterio de trial/vencida sea el del gate (plan-status) y
 * no una comparación a ojo, que el orden sea determinista, y que el dinero en
 * riesgo sea la suma exacta de lo que debe cada clínica.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  construirPortada,
  esCuentaDePrueba,
  estaEnUso,
  senalesDeClinica,
  DIAS_ACTIVIDAD,
  DIAS_APAGADA,
  DIAS_APAGADA_GRAVE,
  DIAS_SIN_LOGIN,
  DIAS_TRIAL_POR_VENCER,
  rankingActividad,
  resumenActividad,
  totalActividad,
  type ActividadClinica,
  type FilaPortada,
  type MotivoAtencion,
} from "../atencion-core";

/** Atajo: `act(116, 1, 2)` = 116 citas, 1 factura, 2 notas. */
function act(citas = 0, facturas = 0, notas = 0): ActividadClinica {
  return { citas, facturas, notas };
}

const AHORA = new Date("2026-09-20T12:00:00.000Z");
const DIA = 86_400_000;

/** `n` días antes de AHORA. */
const haceDias = (n: number) => new Date(AHORA.getTime() - n * DIA);
/** `n` días después de AHORA. */
const enDias = (n: number) => new Date(AHORA.getTime() + n * DIA);

/** Clínica sana por defecto: paga, usa la app y no debe nada. */
function clinica(over: Partial<FilaPortada> = {}): FilaPortada {
  return {
    id: "c1",
    nombre: "Clínica Base",
    plan: "PRO",
    createdAt: haceDias(400),
    trialEndsAt: enDias(20),
    subscriptionStatus: "active",
    nextBillingDate: enDias(20),
    archivedAt: null,
    pacientes: 120,
    citasTotales: 900,
    ultimaCita: haceDias(1),
    actividad: act(40, 3, 5),
    actividadPrevia: act(38, 2, 4),
    ultimoAcceso: haceDias(1),
    enLinea: false,
    cobrosFallidos: 0,
    montoPorCobrar: 0,
    algunaVezPago: true,
    ...over,
  };
}

function motivos(f: FilaPortada): MotivoAtencion[] {
  return senalesDeClinica(f, AHORA).map((s) => s.motivo);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Trial vencido + citas este mes → sale en «atención hoy»
// ─────────────────────────────────────────────────────────────────────────────

test("trial vencido con citas este mes SALE, y como crítico", () => {
  // Dientitos Felices: venció el 5 de julio y sigue agendando.
  const dientitos = clinica({
    id: "dientitos",
    nombre: "Dientitos Felices",
    trialEndsAt: haceDias(77),
    subscriptionStatus: "pending_payment",
    nextBillingDate: null,
    algunaVezPago: false,
    actividad: act(18, 0, 1),
    ultimaCita: haceDias(2),
  });

  assert.ok(motivos(dientitos).includes("usando_sin_plan"));

  const portada = construirPortada([dientitos], AHORA);
  const grupo = portada.grupos.find((g) => g.motivo === "usando_sin_plan");
  assert.ok(grupo, "el grupo 'usando sin plan' tiene que existir");
  assert.equal(grupo.severidad, "critico");
  assert.equal(grupo.senales.length, 1);
  assert.equal(grupo.senales[0].clinicaNombre, "Dientitos Felices");
  // El porqué se lee sin abrir la ficha: nunca pagó y lleva 77 días vencida.
  assert.match(grupo.senales[0].porQue, /nunca pagó/);
  assert.match(grupo.senales[0].porQue, /77 días/);
  assert.match(grupo.senales[0].dato ?? "", /18 citas/);
  assert.equal(portada.totales.conSenal, 1);
});

test("vencida SIN uso no entra en 'usando sin plan' (es baja, no fuga)", () => {
  const muerta = clinica({
    trialEndsAt: haceDias(100),
    subscriptionStatus: "cancelled",
    actividad: act(0, 0, 0),
    ultimaCita: haceDias(200),
    ultimoAcceso: haceDias(200),
  });
  assert.ok(!motivos(muerta).includes("usando_sin_plan"));
  // Pero sí se ve como apagada: no desaparece del panel, cambia de motivo.
  assert.ok(motivos(muerta).includes("apagada"));
});

test("el criterio de vencida es el del gate, no una comparación a ojo", () => {
  // Menta Dental: pagó y Stripe renovó, pero trialEndsAt se quedó atrás. Una
  // comparación propia de trialEndsAt contra hoy la pintaría como vencida.
  const menta = clinica({
    nombre: "Menta Dental",
    trialEndsAt: haceDias(27),
    subscriptionStatus: "active",
    nextBillingDate: enDias(4),
    actividad: act(12, 1, 1),
  });
  assert.ok(!motivos(menta).includes("usando_sin_plan"));
});

test("una clínica que PAGA nunca aparece como trial por vencer", () => {
  const pagando = clinica({ subscriptionStatus: "active", trialEndsAt: enDias(2) });
  assert.ok(!motivos(pagando).includes("trial_por_vencer"));

  const enTrial = clinica({ subscriptionStatus: null, trialEndsAt: enDias(2), algunaVezPago: false });
  assert.ok(motivos(enTrial).includes("trial_por_vencer"));
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Las cuentas de prueba no ensucian los totales
// ─────────────────────────────────────────────────────────────────────────────

test("cuenta de prueba: 0 pacientes, 0 citas, nunca pagó → apartada, no borrada", () => {
  const prueba = clinica({
    id: "test-1",
    nombre: "Prueba 1",
    subscriptionStatus: "pending_payment",
    trialEndsAt: haceDias(3),
    pacientes: 0,
    citasTotales: 0,
    ultimaCita: null,
    actividad: act(0, 0, 0),
    ultimoAcceso: null,
    algunaVezPago: false,
  });
  assert.equal(esCuentaDePrueba(prueba), true);

  const real = clinica({ id: "real", nombre: "Real" });
  const portada = construirPortada([prueba, real], AHORA);

  assert.equal(portada.totales.clinicas, 2);
  assert.equal(portada.totales.dePrueba, 1);
  assert.equal(portada.totales.reales, 1);
  assert.equal(portada.totales.conSenal, 0);
  // Se sigue pudiendo nombrar: apartar no es esconder.
  assert.deepEqual(portada.cuentasDePrueba, [{ id: "test-1", nombre: "Prueba 1" }]);
  // Y no aparece en ninguna señal.
  const ids = portada.grupos.flatMap((g) => g.senales.map((s) => s.clinicaId));
  assert.ok(!ids.includes("test-1"));
});

test("seis cuentas vacías no inflan el conteo de 'exigen atención'", () => {
  const vacias = Array.from({ length: 6 }, (_, i) =>
    clinica({
      id: `v${i}`,
      nombre: `Vacía ${i}`,
      subscriptionStatus: "pending_payment",
      trialEndsAt: haceDias(10),
      pacientes: 0,
      citasTotales: 0,
      ultimaCita: null,
      actividad: act(0, 0, 0),
      ultimoAcceso: null,
      algunaVezPago: false,
    }),
  );
  const conProblema = clinica({ id: "x", nombre: "Con problema", cobrosFallidos: 1, montoPorCobrar: 689 });

  const portada = construirPortada([...vacias, conProblema], AHORA);
  assert.equal(portada.totales.dePrueba, 6);
  assert.equal(portada.totales.reales, 1);
  assert.equal(portada.totales.conSenal, 1);
});

test("una cuenta vacía que YA DEBE dinero no se aparta: eso es dinero, no basura", () => {
  const debe = clinica({
    pacientes: 0,
    citasTotales: 0,
    ultimaCita: null,
    actividad: act(0, 0, 0),
    ultimoAcceso: null,
    algunaVezPago: false,
    subscriptionStatus: "pending_payment",
    montoPorCobrar: 419,
    cobrosFallidos: 1,
  });
  assert.equal(esCuentaDePrueba(debe), false);
  const portada = construirPortada([debe], AHORA);
  assert.equal(portada.totales.dePrueba, 0);
  assert.equal(portada.totales.dineroEnRiesgo, 419);
});

test("una cuenta vacía que alguna vez pagó tampoco se aparta", () => {
  const exCliente = clinica({
    pacientes: 0,
    citasTotales: 0,
    ultimaCita: null,
    actividad: act(0, 0, 0),
    ultimoAcceso: null,
    algunaVezPago: true,
    subscriptionStatus: "cancelled",
    trialEndsAt: haceDias(30),
  });
  assert.equal(esCuentaDePrueba(exCliente), false);
});

test("una clínica archivada se aparta aparte: se apagó a propósito", () => {
  const archivada = clinica({
    id: "arch",
    nombre: "Archivada",
    archivedAt: haceDias(10),
    ultimaCita: haceDias(120),
    subscriptionStatus: "cancelled",
    trialEndsAt: haceDias(120),
  });
  const portada = construirPortada([archivada], AHORA);
  assert.equal(portada.totales.archivadas, 1);
  assert.equal(portada.totales.reales, 0);
  assert.equal(portada.grupos.length, 0);
  assert.deepEqual(portada.archivadas, [{ id: "arch", nombre: "Archivada" }]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sin nada que atender, la sección lo dice
// ─────────────────────────────────────────────────────────────────────────────

test("sin nada que atender no quedan grupos, pero sí clínicas revisadas", () => {
  const portada = construirPortada([clinica({ id: "a" }), clinica({ id: "b" })], AHORA);
  assert.equal(portada.grupos.length, 0);
  assert.equal(portada.totales.senales, 0);
  assert.equal(portada.totales.conSenal, 0);
  // El número que la pantalla necesita para decir "se revisaron N y ninguna
  // disparó": sin él, "no hay nada" y "no se miró" se ven igual.
  assert.equal(portada.totales.reales, 2);
});

test("un grupo sin señales NO se devuelve vacío", () => {
  const portada = construirPortada([clinica({ cobrosFallidos: 2, montoPorCobrar: 1378 })], AHORA);
  assert.equal(portada.grupos.length, 1);
  assert.equal(portada.grupos[0].motivo, "cobro_fallido");
  assert.ok(portada.grupos.every((g) => g.senales.length > 0));
});

// ─────────────────────────────────────────────────────────────────────────────
// Cobro fallido
// ─────────────────────────────────────────────────────────────────────────────

test("cobro fallido entra por factura rechazada O por suscripción en past_due", () => {
  const porFactura = clinica({ cobrosFallidos: 2, montoPorCobrar: 1378 });
  assert.ok(motivos(porFactura).includes("cobro_fallido"));

  // past_due con periodo por delante: Stripe reintenta y todavía tiene acceso.
  const porStatus = clinica({ subscriptionStatus: "past_due", trialEndsAt: enDias(5) });
  assert.ok(motivos(porStatus).includes("cobro_fallido"));

  assert.ok(!motivos(clinica()).includes("cobro_fallido"));
});

test("el dinero en riesgo es la suma exacta de lo que debe cada clínica", () => {
  const portada = construirPortada(
    [
      clinica({ id: "a", nombre: "A", cobrosFallidos: 1, montoPorCobrar: 689 }),
      clinica({ id: "b", nombre: "B", cobrosFallidos: 1, montoPorCobrar: 419 }),
      clinica({ id: "c", nombre: "C" }),
    ],
    AHORA,
  );
  assert.equal(portada.totales.dineroEnRiesgo, 1108);
  assert.equal(portada.grupos.find((g) => g.motivo === "cobro_fallido")?.monto, 1108);
});

// ─────────────────────────────────────────────────────────────────────────────
// Trial por vencer
// ─────────────────────────────────────────────────────────────────────────────

test("trial por vencer: dentro de la ventana sí, fuera no, y las últimas horas se matizan", () => {
  const base = { subscriptionStatus: null as string | null, algunaVezPago: false };

  assert.ok(motivos(clinica({ ...base, trialEndsAt: enDias(DIAS_TRIAL_POR_VENCER - 1) })).includes("trial_por_vencer"));
  assert.ok(!motivos(clinica({ ...base, trialEndsAt: enDias(DIAS_TRIAL_POR_VENCER + 5) })).includes("trial_por_vencer"));

  // `daysUntil` redondea hacia arriba y para un trial VIVO nunca devuelve 0:
  // a tres horas del final dice "1". Por eso el texto lleva "o menos" — y no
  // una resta propia de trialEndsAt, que plan-status-guard prohíbe.
  const casi = clinica({ ...base, trialEndsAt: new Date(AHORA.getTime() + 3 * 3_600_000) });
  const s = senalesDeClinica(casi, AHORA).find((x) => x.motivo === "trial_por_vencer");
  assert.equal(s?.dato, "en 1 día o menos");

  // Y a partir de ahí, en días.
  const dos = clinica({ ...base, trialEndsAt: enDias(2) });
  const s2 = senalesDeClinica(dos, AHORA).find((x) => x.motivo === "trial_por_vencer");
  assert.equal(s2?.dato, "en 2 días");
});

// ─────────────────────────────────────────────────────────────────────────────
// Se apagaron
// ─────────────────────────────────────────────────────────────────────────────

test("apagada: 30 días es aviso medio, 60 es alto, 29 no es nada", () => {
  const a29 = senalesDeClinica(clinica({ ultimaCita: haceDias(DIAS_APAGADA - 1) }), AHORA);
  assert.ok(!a29.some((s) => s.motivo === "apagada"));

  const a30 = senalesDeClinica(clinica({ ultimaCita: haceDias(DIAS_APAGADA) }), AHORA)
    .find((s) => s.motivo === "apagada");
  assert.equal(a30?.severidad, "medio");

  const a60 = senalesDeClinica(clinica({ ultimaCita: haceDias(DIAS_APAGADA_GRAVE) }), AHORA)
    .find((s) => s.motivo === "apagada");
  assert.equal(a60?.severidad, "alto");
  assert.equal(a60?.dato, "hace 60 días");
});

test("una cita FUTURA mantiene viva a la clínica", () => {
  // Sin citas desde hace meses, pero con una agendada para dentro de 3 días.
  const conAgenda = clinica({ ultimaCita: enDias(3), actividad: act(0, 0, 0), ultimoAcceso: haceDias(1) });
  assert.ok(!motivos(conAgenda).includes("apagada"));
});

test("pacientes de alta y ninguna cita: se quedó a medio arrancar", () => {
  const s = senalesDeClinica(
    clinica({ pacientes: 4, citasTotales: 0, ultimaCita: null, actividad: act(0, 0, 0) }),
    AHORA,
  ).find((x) => x.motivo === "apagada");
  assert.equal(s?.dato, "nunca agendó");
});

test("Menta Dental: figura activa y lleva desde julio sin una cita", () => {
  const menta = clinica({
    nombre: "Menta Dental",
    subscriptionStatus: "active",
    ultimaCita: haceDias(58),
    actividad: act(0, 0, 0),
    ultimoAcceso: haceDias(40),
  });
  const s = senalesDeClinica(menta, AHORA).find((x) => x.motivo === "apagada");
  assert.ok(s);
  assert.equal(s.dato, "hace 58 días");
  assert.match(s.porQue, /figura activa/);
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagan y nadie entra
// ─────────────────────────────────────────────────────────────────────────────

test("nadie entra: cubre a quien paga Y al trial vigente (la vieja 'Trial inactivo')", () => {
  const paga = clinica({ subscriptionStatus: "active", ultimoAcceso: haceDias(DIAS_SIN_LOGIN + 1) });
  assert.ok(motivos(paga).includes("sin_login"));

  // El caso que la tarjeta vieja "Trial inactivo" enseñaba y que se caía por
  // el hueco: trial con 25 días por delante —o sea, fuera de "vence esta
  // semana"— y nadie ha entrado en 20 días. Es el prospecto que se enfría.
  const trialFrio = clinica({
    subscriptionStatus: "pending_payment",
    trialEndsAt: enDias(25),
    algunaVezPago: false,
    pacientes: 6,
    ultimaCita: haceDias(7),
    ultimoAcceso: haceDias(20),
  });
  const m = motivos(trialFrio);
  assert.ok(!m.includes("trial_por_vencer"), "aún le quedan 25 días");
  assert.ok(!m.includes("apagada"), "agendó hace una semana");
  assert.ok(m.includes("sin_login"), "tiene que salir por algún sitio");
  const s = senalesDeClinica(trialFrio, AHORA).find((x) => x.motivo === "sin_login");
  assert.match(s?.porQue ?? "", /trial vigente/);

  // Una vencida sin trial vivo no entra por aquí: ya la recogen otros motivos.
  const vencida = clinica({
    subscriptionStatus: "pending_payment",
    trialEndsAt: haceDias(40),
    algunaVezPago: false,
    ultimoAcceso: haceDias(40),
    ultimaCita: haceDias(2),
    actividad: act(4, 0, 0),
  });
  assert.ok(!motivos(vencida).includes("sin_login"));
});

test("sin_login se calla si la clínica ya salió como apagada: una ausencia, un aviso", () => {
  const m = motivos(clinica({
    subscriptionStatus: "active",
    ultimaCita: haceDias(90),
    actividad: act(0, 0, 0),
    ultimoAcceso: haceDias(90),
  }));
  assert.ok(m.includes("apagada"));
  assert.ok(!m.includes("sin_login"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Sin estado de suscripción: se dice, no se supone
// ─────────────────────────────────────────────────────────────────────────────

test("subscriptionStatus null se enseña tal cual", () => {
  const s = senalesDeClinica(
    clinica({ subscriptionStatus: null, trialEndsAt: enDias(60), algunaVezPago: false }),
    AHORA,
  ).find((x) => x.motivo === "estado_desconocido");
  assert.ok(s);
  assert.equal(s.dato, "subscriptionStatus: null");
  assert.equal(s.severidad, "medio");
});

// ─────────────────────────────────────────────────────────────────────────────
// Actividad, orden y determinismo
// ─────────────────────────────────────────────────────────────────────────────

test("estaEnUso: citas recientes o login dentro de la ventana", () => {
  assert.equal(estaEnUso(clinica({ actividad: act(1, 0, 0), ultimoAcceso: null }), AHORA), true);
  assert.equal(estaEnUso(clinica({ actividad: act(0, 0, 0), ultimoAcceso: haceDias(DIAS_ACTIVIDAD - 1) }), AHORA), true);
  assert.equal(estaEnUso(clinica({ actividad: act(0, 0, 0), ultimoAcceso: haceDias(DIAS_ACTIVIDAD + 1) }), AHORA), false);
  assert.equal(estaEnUso(clinica({ actividad: act(0, 0, 0), ultimoAcceso: null }), AHORA), false);
});

test("los grupos salen ordenados por severidad: lo crítico arriba", () => {
  const portada = construirPortada(
    [
      clinica({ id: "1", nombre: "Apagada", ultimaCita: haceDias(70), actividad: act(0, 0, 0) }),
      clinica({ id: "2", nombre: "Sin estado", subscriptionStatus: null, trialEndsAt: enDias(90), algunaVezPago: false }),
      clinica({ id: "3", nombre: "Fallida", cobrosFallidos: 1, montoPorCobrar: 689 }),
    ],
    AHORA,
  );
  const sevs = portada.grupos.map((g) => g.severidad);
  const peso = { critico: 0, alto: 1, medio: 2 } as const;
  for (let i = 1; i < sevs.length; i++) {
    assert.ok(peso[sevs[i - 1]] <= peso[sevs[i]], `orden roto: ${sevs.join(" → ")}`);
  }
  assert.equal(portada.grupos[0].motivo, "cobro_fallido");
});

test("dentro de un grupo manda el dinero, luego la antigüedad, luego el nombre", () => {
  const portada = construirPortada(
    [
      clinica({ id: "a", nombre: "Zeta",  cobrosFallidos: 1, montoPorCobrar: 100 }),
      clinica({ id: "b", nombre: "Alfa",  cobrosFallidos: 1, montoPorCobrar: 900 }),
      clinica({ id: "c", nombre: "Beta",  cobrosFallidos: 1, montoPorCobrar: 100 }),
    ],
    AHORA,
  );
  const nombres = portada.grupos[0].senales.map((s) => s.clinicaNombre);
  assert.deepEqual(nombres, ["Alfa", "Beta", "Zeta"]);
});

test("dos construcciones seguidas dan exactamente lo mismo", () => {
  const filas = [
    clinica({ id: "a", nombre: "A", cobrosFallidos: 1, montoPorCobrar: 100 }),
    clinica({ id: "b", nombre: "B", ultimaCita: haceDias(80), actividad: act(0, 0, 0) }),
    clinica({ id: "c", nombre: "C", subscriptionStatus: null, trialEndsAt: enDias(3), algunaVezPago: false }),
  ];
  const uno = construirPortada(filas, AHORA);
  const dos = construirPortada(filas, AHORA);
  assert.deepEqual(JSON.parse(JSON.stringify(uno)), JSON.parse(JSON.stringify(dos)));
});

test("una clínica con varios problemas cuenta UNA vez en conSenal y varias en senales", () => {
  const rota = clinica({
    id: "rota",
    nombre: "Rota",
    subscriptionStatus: null,
    trialEndsAt: haceDias(40),
    algunaVezPago: false,
    actividad: act(5, 0, 0),
    ultimaCita: haceDias(1),
    cobrosFallidos: 1,
    montoPorCobrar: 689,
  });
  const portada = construirPortada([rota], AHORA);
  assert.equal(portada.totales.conSenal, 1);
  assert.ok(portada.totales.senales >= 3);
});

test("las claves de señal son únicas: React no repite keys", () => {
  const portada = construirPortada(
    [
      clinica({ id: "a", nombre: "A", cobrosFallidos: 1, montoPorCobrar: 10 }),
      clinica({ id: "b", nombre: "B", cobrosFallidos: 1, montoPorCobrar: 10 }),
      clinica({ id: "c", nombre: "C", subscriptionStatus: null, trialEndsAt: enDias(2), algunaVezPago: false }),
    ],
    AHORA,
  );
  const claves = portada.grupos.flatMap((g) => g.senales.map((s) => s.clave));
  assert.equal(new Set(claves).size, claves.length);
});

test("lista vacía: ni grupos ni totales inventados", () => {
  const portada = construirPortada([], AHORA);
  assert.deepEqual(portada.grupos, []);
  assert.equal(portada.totales.clinicas, 0);
  assert.equal(portada.totales.reales, 0);
  assert.equal(portada.totales.dineroEnRiesgo, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// Cuando una consulta no pudo correr: se calla, no inventa
//
// Las tres agregaciones de la página llevan `.catch` para que un timeout del
// pooler no tumbe /admin. El peligro no es el crash: es que el valor de
// respaldo se lea como un hecho.
// ─────────────────────────────────────────────────────────────────────────────

test("si no se pudo leer la última cita, NADIE dice 'nunca agendó'", () => {
  // Es exactamente lo que deja el `.catch` del groupBy: ultimaCita null para
  // todas. Esta clínica tiene 900 citas en su `_count`.
  const conHistorial = clinica({ ultimaCita: null, actividad: act(0, 0, 0) });
  assert.equal(conHistorial.citasTotales, 900);
  const m = motivos(conHistorial);
  assert.ok(!m.includes("apagada"), "no se puede afirmar que se apagó sin el dato");

  // Y la que de verdad no ha agendado nunca (0 en el _count) sí sale.
  const nuncaAgendo = clinica({ ultimaCita: null, citasTotales: 0, actividad: act(0, 0, 0), pacientes: 4 });
  const s = senalesDeClinica(nuncaAgendo, AHORA).find((x) => x.motivo === "apagada");
  assert.equal(s?.dato, "nunca agendó");
});

test("si no se pudo leer el histórico de pagos, nadie se aparta como cuenta de prueba", () => {
  const vacia = clinica({
    pacientes: 0, citasTotales: 0, ultimaCita: null, actividad: act(0, 0, 0),
    ultimoAcceso: null, subscriptionStatus: "pending_payment", trialEndsAt: haceDias(5),
    algunaVezPago: null, // ← no se pudo mirar
  });
  assert.equal(esCuentaDePrueba(vacia), false);

  const portada = construirPortada([vacia], AHORA);
  assert.equal(portada.totales.dePrueba, 0);
  assert.equal(portada.totales.reales, 1);
});

test("con el histórico ilegible, el texto lo dice en vez de afirmar 'sin pagos'", () => {
  const s = senalesDeClinica(
    clinica({ subscriptionStatus: null, trialEndsAt: enDias(60), algunaVezPago: null }),
    AHORA,
  ).find((x) => x.motivo === "estado_desconocido");
  assert.match(s?.porQue ?? "", /no se pudo leer/);
});

test("past_due sin factura fallida dice qué pasa, no 'sin dato'", () => {
  const s = senalesDeClinica(
    clinica({ subscriptionStatus: "past_due", trialEndsAt: enDias(5), montoPorCobrar: 0, cobrosFallidos: 0 }),
    AHORA,
  ).find((x) => x.motivo === "cobro_fallido");
  assert.equal(s?.dato, "sin factura fallida aún");

  // Con importe, el texto se deja en null: lo pinta la UI con formatCurrency.
  const conImporte = senalesDeClinica(clinica({ cobrosFallidos: 1, montoPorCobrar: 689 }), AHORA)
    .find((x) => x.motivo === "cobro_fallido");
  assert.equal(conImporte?.dato, null);
  assert.equal(conImporte?.montoEnRiesgo, 689);
});

test("dineroEnRiesgo es un SUBCONJUNTO del pendiente, y no pretende ser el total", () => {
  // Clínica al corriente con una factura pending (sobrecupo de CFDI): debe
  // dinero, pero no hay nada roto que atender, así que no genera señal.
  const alCorriente = clinica({ id: "ok", nombre: "Al corriente", montoPorCobrar: 340, cobrosFallidos: 0 });
  const rota = clinica({ id: "rota", nombre: "Rota", cobrosFallidos: 1, montoPorCobrar: 689 });

  const portada = construirPortada([alCorriente, rota], AHORA);
  // Solo la rota aporta: 689, no 1029. El titular de la pantalla usa el total
  // del KPI (pendingPay), no esta cifra — ver AtencionHoy.dineroSinCobrar.
  assert.equal(portada.totales.dineroEnRiesgo, 689);
  assert.ok(!motivos(alCorriente).includes("cobro_fallido"));
});

// ─────────────────────────────────────────────────────────────────────────────
// Actividad medida: no «hubo o no hubo», sino CUÁNTA
// ─────────────────────────────────────────────────────────────────────────────

test("resumenActividad enseña los tres números y se salta los ceros", () => {
  assert.equal(resumenActividad(act(116, 1, 2), 30), "116 citas · 1 factura · 2 notas en 30 d");
  assert.equal(resumenActividad(act(4, 5, 1), 30), "4 citas · 5 facturas · 1 nota en 30 d");
  assert.equal(resumenActividad(act(1, 0, 0), 30), "1 cita en 30 d");
  assert.equal(resumenActividad(act(0, 0, 0), 30), "sin actividad en 30 d");
});

test("la señal de 'usando sin plan' dice cuánto ha hecho, no solo que lo usa", () => {
  const s = senalesDeClinica(
    clinica({
      trialEndsAt: haceDias(77),
      subscriptionStatus: "pending_payment",
      algunaVezPago: false,
      actividad: act(1, 0, 0),
    }),
    AHORA,
  ).find((x) => x.motivo === "usando_sin_plan");
  assert.equal(s?.dato, "1 cita en 30 d");
});

test("una factura o una nota cuentan como uso, aunque no haya citas", () => {
  const soloFactura = clinica({
    trialEndsAt: haceDias(40), subscriptionStatus: "pending_payment", algunaVezPago: false,
    actividad: act(0, 3, 0), ultimoAcceso: null,
  });
  assert.equal(estaEnUso(soloFactura, AHORA), true);
  assert.ok(motivos(soloFactura).includes("usando_sin_plan"));

  const nada = clinica({
    trialEndsAt: haceDias(40), subscriptionStatus: "pending_payment", algunaVezPago: false,
    actividad: act(0, 0, 0), ultimoAcceso: null,
  });
  assert.equal(estaEnUso(nada, AHORA), false);
});

test("rankingActividad ordena por lo hecho y calcula la tendencia", () => {
  const filas = [
    clinica({ id: "a", nombre: "Mariel", actividad: act(2, 1, 0), actividadPrevia: act(6, 0, 0) }),
    clinica({ id: "b", nombre: "Local Altabrisa", actividad: act(116, 1, 2), actividadPrevia: act(100, 0, 0) }),
    clinica({ id: "c", nombre: "Arranca", actividad: act(5, 0, 0), actividadPrevia: act(0, 0, 0) }),
  ];
  const r = rankingActividad(filas, AHORA);
  assert.deepEqual(r.map((x) => x.nombre), ["Local Altabrisa", "Arranca", "Mariel"]);

  // 119 contra 100 → +19 %
  assert.equal(r[0].cambioPct, 19);
  // 3 contra 6 → −50 %
  assert.equal(r[2].cambioPct, -50);
  // De 0 a 5 no es un porcentaje: es un arranque, y se dice con `null`.
  assert.equal(r[1].cambioPct, null);
});

test("el ranking no incluye cuentas de prueba ni archivadas", () => {
  const filas = [
    clinica({ id: "real", nombre: "Real", actividad: act(3, 0, 0) }),
    clinica({
      id: "demo", nombre: "Demo", pacientes: 0, citasTotales: 0, ultimaCita: null,
      actividad: act(0, 0, 0), ultimoAcceso: null, algunaVezPago: false,
      subscriptionStatus: "pending_payment", trialEndsAt: haceDias(5),
    }),
    clinica({ id: "arch", nombre: "Archivada", archivedAt: haceDias(9) }),
  ];
  assert.deepEqual(rankingActividad(filas, AHORA).map((x) => x.id), ["real"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// «En línea» y el acceso real (analytics_sessions, NO users.lastLogin)
// ─────────────────────────────────────────────────────────────────────────────

test("sin registro de sesión NO se acusa a nadie de que no entra", () => {
  // Es el caso mayoritario: analytics_sessions solo guarda sesiones recientes,
  // así que la mayoría de clínicas sale a null. Antes, con users.lastLogin
  // (vacío en las 36 filas de la base), esto marcaba a TODAS "nunca entró".
  const sinRegistro = clinica({ subscriptionStatus: "active", ultimoAcceso: null });
  assert.ok(!motivos(sinRegistro).includes("sin_login"));

  // En cambio, de quien SÍ consta que entraba y dejó de hacerlo, sí se avisa.
  const dejoDeEntrar = clinica({
    subscriptionStatus: "active",
    ultimoAcceso: haceDias(DIAS_SIN_LOGIN + 3),
  });
  const s = senalesDeClinica(dejoDeEntrar, AHORA).find((x) => x.motivo === "sin_login");
  assert.equal(s?.dato, "visto hace 10 días");
});

test("quien está EN LÍNEA ahora mismo no sale en 'nadie entra'", () => {
  const dentro = clinica({
    subscriptionStatus: "active",
    ultimoAcceso: haceDias(DIAS_SIN_LOGIN + 3),
    enLinea: true,
  });
  assert.ok(!motivos(dentro).includes("sin_login"));
  assert.equal(estaEnUso(dentro, AHORA), true);
});

test("los totales cuentan cuántas clínicas están dentro del panel", () => {
  const portada = construirPortada(
    [
      clinica({ id: "a", nombre: "A", enLinea: true }),
      clinica({ id: "b", nombre: "B", enLinea: true }),
      clinica({ id: "c", nombre: "C", enLinea: false }),
    ],
    AHORA,
  );
  assert.equal(portada.totales.enLinea, 2);
});

test("totalActividad suma las tres", () => {
  assert.equal(totalActividad(act(116, 1, 2)), 119);
  assert.equal(totalActividad(act(0, 0, 0)), 0);
});
