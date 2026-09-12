/**
 * Las tres herramientas de AGENDA: `citas_del_dia`, `ausencias`,
 * `agenda_ocupacion`.
 *
 * Run: npm run test:sabina-agenda
 *
 * Lo que se vigila aquí, además de los números:
 *
 *  · La ventana del día es el DÍA NATURAL de la clínica, no su horario de
 *    atención. La siembra tiene a propósito una urgencia a las 07:30 y una cita
 *    a las 23:30, que son exactamente las dos que desaparecían de la agenda
 *    cuando se leía con `[agendaDayStart, agendaDayEnd)` (hallazgos 40 y 32).
 *  · El día se decide en la zona de la CLÍNICA. Las dos clínicas de prueba están
 *    en husos distintos (México UTC-6 y Cancún UTC-5), así que una herramienta
 *    que usara la del proceso daría otro resultado.
 *  · Un DOCTOR ve SUS citas, igual que le pinta /dashboard/agenda.
 *  · La paciente restringida sale ENMASCARADA, no borrada: el hueco de la
 *    agenda existe y hay que respetarlo; lo que no viaja es quién es.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { calcularOcupacion } from "../agenda-ocupacion";
import { ejecutarHerramienta } from "../index";
import { sumarDias } from "../fechas";
import {
  DIA_AUSENCIAS,
  DIA_LLENO,
  HOY_N,
  HOY_S,
  TZ_NORTE,
  U_DOC_N,
  U_DOC2_N,
  adminNorte,
  adminSur,
  base,
  doctorNorte,
} from "./siembra";

/* ══════════════════════════════════════════════════════════════════════
 * citas_del_dia
 * ══════════════════════════════════════════════════════════════════════ */

test("citas_del_dia: cuenta activas, canceladas y no-asistidas por separado", async () => {
  const r = await ejecutarHerramienta("citas_del_dia", adminNorte(base()), { fecha: HOY_N });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // Seis citas hoy: 07:30, 10:00, 11:00 (cancelada), 12:00 (no asistió), 16:00, 23:30.
  assert.equal(r.datos.citas.total, 6);
  assert.equal(r.datos.activas, 4, "activas = ni canceladas ni no-asistidas");
  assert.equal(r.datos.canceladas, 1);
  assert.equal(r.datos.noAsistieron, 1);
  assert.equal(r.datos.citas.truncado, false);
  assert.equal(r.datos.alcance, "clinica");
});

test("🔴 citas_del_dia: la de las 07:30 y la de las 23:30 SÍ salen (día natural, no horario)", async () => {
  const r = await ejecutarHerramienta("citas_del_dia", adminNorte(base()), { fecha: HOY_N });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const horas = r.datos.citas.filas.map((c) => c.hora);
  assert.equal(
    horas.indexOf("07:30–08:15") !== -1,
    true,
    "la urgencia de las 07:30 cae fuera del 08–20 y tiene que verse igual",
  );
  assert.equal(
    horas.some((h) => h.indexOf("23:30") === 0),
    true,
    "la cita de las 23:30 pertenece a su día, no al siguiente",
  );
  // Y la que cruza la medianoche se cuenta en el día en que EMPEZÓ, una sola vez.
  const manana = await ejecutarHerramienta("citas_del_dia", adminNorte(base()), {
    fecha: sumarDias(HOY_N, 1),
  });
  assert.equal(manana.ok, false, "mañana no hay citas: la de las 23:30 no se cuenta dos veces");
});

test("citas_del_dia: las horas se dan en la zona de la CLÍNICA, no en la del proceso", async () => {
  // La siembra pone las citas a las 10:00 LOCALES de cada clínica, y las dos
  // clínicas están en husos distintos. Si la hora se formateara con la zona del
  // servidor, una de las dos saldría corrida.
  const norte = await ejecutarHerramienta("citas_del_dia", adminNorte(base()), { fecha: HOY_N });
  const sur = await ejecutarHerramienta("citas_del_dia", adminSur(base()), { fecha: HOY_S });
  assert.equal(norte.ok && sur.ok, true);
  if (!norte.ok || !sur.ok) return;

  assert.equal(
    norte.datos.citas.filas.some((c) => c.hora === "10:00–10:30"),
    true,
    "la clínica de México ve su cita a las 10:00",
  );
  assert.equal(
    sur.datos.citas.filas.some((c) => c.hora === "10:00–10:30"),
    true,
    "la clínica de Cancún ve su cita a las 10:00, aunque sea otro instante UTC",
  );
});

test("citas_del_dia: un DOCTOR ve SUS citas, igual que en /dashboard/agenda", async () => {
  const r = await ejecutarHerramienta("citas_del_dia", doctorNorte(base()), { fecha: HOY_N });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // De las seis del día, cuatro son suyas (07:30, 10:00, 11:00 cancelada, 16:00).
  assert.equal(r.datos.citas.total, 4);
  assert.equal(r.datos.activas, 3);
  assert.equal(r.datos.canceladas, 1);
  assert.equal(r.datos.noAsistieron, 0, "la no-asistida es de su compañera");
  assert.equal(r.datos.alcance, "propio");
  assert.match(r.resumen, /tuyas/);
});

test("🔴 citas_del_dia: la paciente restringida sale ENMASCARADA, no borrada", async () => {
  const db = base();

  // La admin sí puede verla.
  const admin = await ejecutarHerramienta("citas_del_dia", adminNorte(db), { fecha: HOY_N });
  assert.equal(admin.ok, true);
  if (!admin.ok) return;
  assert.equal(
    admin.datos.citas.filas.some((c) => c.paciente === "Paula Restringida"),
    true,
  );

  // El doctor NO está en su lista: ve el hueco de las 16:00, no el nombre.
  const doc = await ejecutarHerramienta("citas_del_dia", doctorNorte(db), { fecha: HOY_N });
  assert.equal(doc.ok, true);
  if (!doc.ok) return;
  const dieciseis = doc.datos.citas.filas.filter((c) => c.hora.indexOf("16:00") === 0);
  assert.equal(dieciseis.length, 1, "la cita sigue ahí: el hueco existe");
  assert.equal(dieciseis[0].paciente, "Paciente privado");
  assert.equal(
    JSON.stringify(doc).indexOf("Restringida"),
    -1,
    "el nombre de la paciente restringida no puede viajar al modelo",
  );
});

test("citas_del_dia: no manda notas ni nada clínico al modelo", async () => {
  const r = await ejecutarHerramienta("citas_del_dia", adminNorte(base()), { fecha: HOY_N });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const claves = Object.keys(r.datos.citas.filas[0]).sort();
  assert.deepEqual(claves, ["doctor", "estado", "hora", "minutos", "motivo", "paciente"]);
});

/* ══════════════════════════════════════════════════════════════════════
 * ausencias
 * ══════════════════════════════════════════════════════════════════════ */

test("ausencias: la tasa se mide contra las citas AGENDADAS, no contra todas", async () => {
  const r = await ejecutarHerramienta("ausencias", adminNorte(base()), {
    desde: DIA_AUSENCIAS,
    hasta: DIA_AUSENCIAS,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // Ese día: 3 NO_SHOW + 4 COMPLETED + 1 CANCELLED.
  assert.equal(r.datos.ausencias.total, 3);
  assert.equal(
    r.datos.citasAgendadas,
    7,
    "la cancelada NO entra en el denominador: el hueco se pudo reasignar",
  );
  assert.equal(r.datos.tasaPct, 43, "3/7 = 42.86% -> 43%");
});

test("ausencias: cero ausencias NO es «sin datos» — es una buena noticia", async () => {
  // Un día con citas y sin ninguna falta.
  const r = await ejecutarHerramienta("ausencias", adminNorte(base()), {
    desde: HOY_N,
    hasta: HOY_N,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.ausencias.total, 1, "hoy hay una no-asistida");

  // Y un día SIN citas ninguna: eso sí es no tener nada que medir.
  const seco = await ejecutarHerramienta("ausencias", adminNorte(base()), {
    desde: sumarDias(HOY_N, 5),
    hasta: sumarDias(HOY_N, 5),
  });
  assert.equal(seco.ok, false);
  assert.equal((seco as any).motivo, "sin_datos");
});

test("ausencias: señala a quien falla más de una vez", async () => {
  const r = await ejecutarHerramienta("ausencias", adminNorte(base()), {
    desde: DIA_AUSENCIAS,
    hasta: DIA_AUSENCIAS,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.datos.reincidentes, [{ paciente: "Ana Perez", veces: 2 }]);
});

test("ausencias: un DOCTOR ve las de SU agenda", async () => {
  const r = await ejecutarHerramienta("ausencias", doctorNorte(base()), {
    desde: DIA_AUSENCIAS,
    hasta: DIA_AUSENCIAS,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // De las 3 faltas del día, 2 son de su agenda; la tercera es de su compañera.
  assert.equal(r.datos.ausencias.total, 2);
  assert.equal(r.datos.alcance, "propio");
});

/* ══════════════════════════════════════════════════════════════════════
 * agenda_ocupacion — la aritmética, sin base de datos
 * ══════════════════════════════════════════════════════════════════════ */

const HORARIO_LV_9_19 = [
  { dayOfWeek: 0, enabled: true, openTime: "09:00", closeTime: "19:00" },
  { dayOfWeek: 1, enabled: true, openTime: "09:00", closeTime: "19:00" },
  { dayOfWeek: 2, enabled: true, openTime: "09:00", closeTime: "19:00" },
  { dayOfWeek: 3, enabled: true, openTime: "09:00", closeTime: "19:00" },
  { dayOfWeek: 4, enabled: true, openTime: "09:00", closeTime: "19:00" },
  { dayOfWeek: 5, enabled: true, openTime: "09:00", closeTime: "14:00" },
  { dayOfWeek: 6, enabled: false, openTime: "09:00", closeTime: "14:00" },
];

/** Una cita del martes 2026-09-08 (México) de `min` minutos, a partir de las 09:00. */
function citaMartes(horaInicio: number, minutos: number) {
  const inicio = new Date(`2026-09-08T${String(horaInicio).padStart(2, "0")}:00:00-06:00`);
  return { startsAt: inicio, endsAt: new Date(inicio.getTime() + minutos * 60000) };
}

test("agenda_ocupacion: 240 min vendidos de 600 disponibles el martes = 40%", () => {
  // Semana exacta lunes 7 → domingo 13 de septiembre de 2026: un día de cada.
  const r = calcularOcupacion({
    citas: [citaMartes(9, 120), citaMartes(14, 120)],
    horarios: HORARIO_LV_9_19,
    horarioGeneral: { agendaDayStart: 8, agendaDayEnd: 20 },
    unidades: 1,
    desdeISO: "2026-09-07",
    hastaISO: "2026-09-13",
    timezone: TZ_NORTE,
  });

  const martes = r.porDia[1];
  assert.equal(martes.nombre, "martes");
  assert.equal(martes.veces, 1, "en esa semana hay un solo martes");
  assert.equal(martes.citas, 2);
  assert.equal(martes.minutosAgendados, 240);
  assert.equal(martes.capacidadMinutos, 600, "09:00–19:00 = 600 min, por un sillón");
  assert.equal(martes.ocupacionPct, 40);
  assert.equal(r.masLleno.nombre, "martes");
});

test("agenda_ocupacion: los sillones multiplican la capacidad, no las citas", () => {
  const r = calcularOcupacion({
    citas: [citaMartes(9, 120), citaMartes(14, 120)],
    horarios: HORARIO_LV_9_19,
    horarioGeneral: { agendaDayStart: 8, agendaDayEnd: 20 },
    unidades: 2, // dos sillones: el mismo tiempo vendido rinde la mitad
    desdeISO: "2026-09-07",
    hastaISO: "2026-09-13",
    timezone: TZ_NORTE,
  });
  assert.equal(r.porDia[1].capacidadMinutos, 1200);
  assert.equal(r.porDia[1].ocupacionPct, 20);
});

test("agenda_ocupacion: el domingo cerrado no es 0% de ocupación, es «no aplica»", () => {
  const r = calcularOcupacion({
    citas: [],
    horarios: HORARIO_LV_9_19,
    horarioGeneral: { agendaDayStart: 8, agendaDayEnd: 20 },
    unidades: 1,
    desdeISO: "2026-09-07",
    hastaISO: "2026-09-13",
    timezone: TZ_NORTE,
  });
  const domingo = r.porDia[6];
  assert.equal(domingo.nombre, "domingo");
  assert.equal(domingo.cerrado, true);
  assert.equal(domingo.capacidadMinutos, null);
  assert.equal(domingo.ocupacionPct, null, "0% diría que la agenda está vacía; está CERRADA");
  // Y el sábado abre menos horas: su capacidad es menor, no igual.
  assert.equal(r.porDia[5].capacidadMinutos, 300);
});

test("🔴 agenda_ocupacion: sin sillones configurados NO se inventa un denominador", () => {
  const r = calcularOcupacion({
    citas: [citaMartes(9, 120)],
    horarios: HORARIO_LV_9_19,
    horarioGeneral: { agendaDayStart: 8, agendaDayEnd: 20 },
    unidades: 0,
    desdeISO: "2026-09-07",
    hastaISO: "2026-09-13",
    timezone: TZ_NORTE,
  });
  assert.equal(r.citasTotales, 1);
  assert.equal(r.minutosAgendadosTotal, 120);
  assert.equal(r.ocupacionPctTotal, null);
  assert.equal(r.porDia[1].ocupacionPct, null);
});

test("agenda_ocupacion: sin horario en Ajustes se conserva el agendaDayStart/End histórico", () => {
  const r = calcularOcupacion({
    citas: [],
    horarios: [],
    horarioGeneral: { agendaDayStart: 8, agendaDayEnd: 20 },
    unidades: 1,
    desdeISO: "2026-09-07",
    hastaISO: "2026-09-13",
    timezone: TZ_NORTE,
  });
  assert.equal(r.fuenteHorario, "horario_general");
  // Los siete días abiertos 08–20 = 720 min, domingo incluido: es el
  // comportamiento de siempre, no una decisión nueva.
  assert.equal(r.porDia[6].cerrado, false);
  assert.equal(r.porDia[6].capacidadMinutos, 720);
});

test("agenda_ocupacion: los días se cuentan del CALENDARIO, no de los datos", () => {
  // Dos semanas: dos martes. Aunque uno de ellos no tenga ni una cita, cuenta
  // como capacidad — si no, un mes flojo parecería lleno.
  const r = calcularOcupacion({
    citas: [citaMartes(9, 120), citaMartes(14, 120)],
    horarios: HORARIO_LV_9_19,
    horarioGeneral: { agendaDayStart: 8, agendaDayEnd: 20 },
    unidades: 1,
    desdeISO: "2026-09-07",
    hastaISO: "2026-09-20",
    timezone: TZ_NORTE,
  });
  assert.equal(r.porDia[1].veces, 2);
  assert.equal(r.porDia[1].capacidadMinutos, 1200);
  assert.equal(r.porDia[1].ocupacionPct, 20, "los mismos 240 min repartidos en dos martes");
});

test("agenda_ocupacion: de punta a punta lee sillones activos y horario de la clínica", async () => {
  const r = await ejecutarHerramienta("agenda_ocupacion", adminNorte(base()), {
    desde: sumarDias(HOY_N, -30),
    hasta: HOY_N,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Dos recursos de tratamiento activos; el de baja y la sala de espera no cuentan.
  assert.equal(r.datos.unidades, 2);
  assert.equal(r.datos.fuenteHorario, "ajustes");
  assert.equal(r.datos.alcance, "clinica");
});

test("agenda_ocupacion: a un DOCTOR se le mide SU tiempo, no los sillones de la casa", async () => {
  const r = await ejecutarHerramienta("agenda_ocupacion", doctorNorte(base()), {
    desde: sumarDias(HOY_N, -30),
    hasta: HOY_N,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.unidades, 1, "su denominador es una agenda, no dos sillones");
  assert.equal(r.datos.alcance, "propio");

  // Y pedir un doctor concreto hace lo mismo.
  const uno = await ejecutarHerramienta("agenda_ocupacion", adminNorte(base()), {
    desde: sumarDias(HOY_N, -30),
    hasta: HOY_N,
    doctorId: U_DOC_N,
  });
  assert.equal(uno.ok, true);
  if (uno.ok) {
    assert.equal(uno.datos.unidades, 1);
    assert.equal(uno.datos.alcance, "doctor");
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * Dos guardas que se añadieron al revisar el propio código
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 citas_del_dia: con 60 citas el contador dice 60, no las 51 que leyó", async () => {
  // Los conteos salen de un `groupBy` sobre TODAS las filas, no de la página.
  // Sacarlos de la página daría «tienes 51 citas» en un día de 60: un número
  // plausible y falso, que es la peor clase de número.
  const r = await ejecutarHerramienta("citas_del_dia", adminNorte(base()), { fecha: DIA_LLENO });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.equal(r.datos.citas.filas.length, 50, "se enseñan 50");
  assert.equal(r.datos.citas.total, 60, "pero hay 60");
  assert.equal(r.datos.activas, 60, "y las activas son 60, no 51");
  assert.equal(r.datos.porEstado["confirmada"], 60);
  assert.match(r.resumen, /60 citas activas/);
});

test("🔴 agenda_ocupacion: un DOCTOR no puede pedir la agenda de su compañera", async () => {
  const db = base();
  const rango = { desde: sumarDias(HOY_N, -30), hasta: HOY_N };

  // La admin sí puede mirar a cada doctora por separado.
  const propias = await ejecutarHerramienta("agenda_ocupacion", adminNorte(db), {
    ...rango,
    doctorId: U_DOC_N,
  });
  const deLaOtra = await ejecutarHerramienta("agenda_ocupacion", adminNorte(db), {
    ...rango,
    doctorId: U_DOC2_N,
  });
  assert.equal(propias.ok && deLaOtra.ok, true);
  if (!propias.ok || !deLaOtra.ok) return;
  assert.equal(propias.datos.citasTotales, 65);
  assert.equal(deLaOtra.datos.citasTotales, 3);

  // Pero el doctor, pidiendo el id de su compañera, recibe LO SUYO: el scope del
  // rol manda sobre el parámetro, igual que `doctorIdScope` en la agenda. Y este
  // parámetro lo elige el MODELO, así que no puede ser una puerta.
  const colado = await ejecutarHerramienta("agenda_ocupacion", doctorNorte(db), {
    ...rango,
    doctorId: U_DOC2_N,
  });
  assert.equal(colado.ok, true);
  if (!colado.ok) return;
  assert.equal(colado.datos.citasTotales, 65, "le tocan sus 65, no las 3 de su compañera");
  assert.equal(colado.datos.alcance, "propio");
});
