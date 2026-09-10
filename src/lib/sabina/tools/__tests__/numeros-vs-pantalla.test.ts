/**
 * LOS NÚMEROS DE SABINA CONTRA LOS DE LA PANTALLA.
 *
 * Run: npm run test:sabina-pantalla
 *
 * Si Sabina dice un número y el panel enseña otro, el que está mal es Sabina —
 * y perdería toda la credibilidad el primer día. Así que aquí no se comprueba
 * «el total cuadra con lo que sembré»: se ESCRIBE A MANO la consulta que hace
 * hoy la pantalla equivalente, tal como está en su archivo, se corre contra la
 * MISMA base de prueba, y se exige que los dos números sean el mismo.
 *
 * Se comparan seis:
 *
 *   1. Citas de hoy          → KPI "CITAS HOY" de /api/patients
 *   2. Citas del periodo     → KPI "Citas" del home admin
 *   3. No-shows del periodo  → KPI "No-shows" del home admin
 *   4. Ingresos del periodo  → KPI "Ingresos del mes" del home admin (BRUTO)
 *   5. Deuda: monto y nº     → KPIs "Monto adeudado" / "Pacientes con deuda"
 *   6. Vencido               → Finanzas → Saldos (`overdueInvoiceWhere`)
 *
 * ── LA ÚNICA DIFERENCIA A PROPÓSITO, Y ES LA ZONA HORARIA ──────────────
 * Las pantallas de arriba arman «hoy» y «el mes» con la hora del PROCESO
 * (`setHours(0,0,0,0)` en /api/patients, `d.getDay()` en el mapa de calor de
 * Analytics). En Vercel el proceso es UTC, y por eso el tablero se vaciaba a las
 * 18:00. Sabina usa la zona de la CLÍNICA. Para que la comparación mida el
 * CRITERIO y no ese fallo, las ventanas de aquí se construyen con la zona de la
 * clínica en los dos lados; la divergencia queda anotada en el reporte.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { overdueInvoiceWhere } from "@/lib/caja";
import { ejecutarHerramienta } from "../index";
import { inicioDeHoy, sumarDias, ventanaDeRango, ventanaDelDia } from "../fechas";
import { CL_NORTE, HOY_N, TZ_NORTE, adminNorte, base } from "./siembra";
import type { BaseDoble } from "./doble-base";

/**
 * El doble visto SIN la rendija de `SabinaDb`.
 *
 * `SabinaDb` sólo declara lo que las herramientas usan de verdad (de `payment`,
 * un `findMany`), y eso está bien: es lo que hace imposible por tipos que una
 * herramienta escriba. Pero aquí no se está llamando a una herramienta: se está
 * imitando la consulta que hace la PANTALLA, que usa el `prisma` completo. Por
 * eso este alias, y sólo en este archivo.
 */
function comoPantalla(db: BaseDoble): any {
  return db as any;
}

const RANGO = { desde: sumarDias(HOY_N, -10), hasta: HOY_N };

/* ══════════════════════════════════════════════════════════════════════
 * 1 · Citas de hoy — KPI "CITAS HOY" de src/app/api/patients/route.ts
 * ══════════════════════════════════════════════════════════════════════ */

test("1 · citas de hoy: el mismo número que el KPI «CITAS HOY» de Pacientes", async () => {
  const db = base();
  const { desde, hasta } = ventanaDelDia(HOY_N, TZ_NORTE);

  // La consulta de la pantalla, tal cual (api/patients/route.ts, `nextApptToday`).
  const pantalla = await db.appointment.count({
    where: {
      clinicId: CL_NORTE,
      startsAt: { gte: desde, lt: hasta },
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
  });

  const sabina = await ejecutarHerramienta("citas_del_dia", adminNorte(db), { fecha: HOY_N });
  assert.equal(sabina.ok, true);
  if (!sabina.ok) return;

  assert.equal(sabina.datos.activas, pantalla, "Sabina y el KPI de Pacientes tienen que decir lo mismo");
  assert.equal(pantalla, 4, "y son cuatro: la cancelada y la no-asistida no cuentan");
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 y 3 · Citas y no-shows — `aggregateAdminPeriodKpis` (@/lib/agenda/server),
 *          que alimenta las tarjetas del home del administrador.
 * ══════════════════════════════════════════════════════════════════════ */

test("2 · citas agendadas del periodo: el mismo número que el KPI «Citas» del home admin", async () => {
  const db = base();
  const { desde, hasta } = ventanaDeRango(RANGO.desde, RANGO.hasta, TZ_NORTE);

  // `aggregateAdminPeriodKpis`: appointments = todo lo que NO se canceló.
  const pantalla = await db.appointment.count({
    where: { clinicId: CL_NORTE, startsAt: { gte: desde, lt: hasta }, status: { notIn: ["CANCELLED"] } },
  });

  const sabina = await ejecutarHerramienta("ausencias", adminNorte(db), RANGO);
  assert.equal(sabina.ok, true);
  if (!sabina.ok) return;

  assert.equal(
    sabina.datos.citasAgendadas,
    pantalla,
    "el denominador de la tasa de ausencias ES el KPI «Citas» del home",
  );
});

test("3 · no-shows del periodo: el mismo número que el KPI «No-shows» del home admin", async () => {
  const db = base();
  const { desde, hasta } = ventanaDeRango(RANGO.desde, RANGO.hasta, TZ_NORTE);

  const pantalla = await db.appointment.count({
    where: { clinicId: CL_NORTE, startsAt: { gte: desde, lt: hasta }, status: "NO_SHOW" },
  });

  const sabina = await ejecutarHerramienta("ausencias", adminNorte(db), RANGO);
  assert.equal(sabina.ok, true);
  if (!sabina.ok) return;

  assert.equal(sabina.datos.ausencias.total, pantalla);
  // Las tres de hace cinco días más la de hoy: el rango llega hasta hoy incluido.
  assert.equal(pantalla, 4);
});

/* ══════════════════════════════════════════════════════════════════════
 * 4 · Ingresos — el KPI del home admin suma BRUTO (no resta reembolsos).
 * ══════════════════════════════════════════════════════════════════════ */

test("4 · ingresos: `ingresosBrutos` es EXACTAMENTE el KPI del home admin", async () => {
  const db = base();
  const { desde, hasta } = ventanaDeRango(RANGO.desde, RANGO.hasta, TZ_NORTE);

  // `aggregateAdminPeriodKpis`, literal: el tenant por `invoice.clinicId`, fuera
  // las canceladas, fuera las filas de método "refund".
  const pantalla = await comoPantalla(db).payment.aggregate({
    where: {
      invoice: { clinicId: CL_NORTE, status: { notIn: ["CANCELLED"] } },
      paidAt: { gte: desde, lt: hasta },
      method: { not: "refund" },
    },
    _sum: { amount: true },
  });

  const sabina = await ejecutarHerramienta("ingresos_por_periodo", adminNorte(db), RANGO);
  assert.equal(sabina.ok, true);
  if (!sabina.ok) return;

  assert.equal(
    sabina.datos.ingresosBrutos,
    pantalla._sum.amount,
    "el bruto de Sabina es el número que hoy enseña la tarjeta del home",
  );

  // 🔴 Y el NETO es distinto, a propósito: el home no resta lo devuelto y
  // Finanzas sí (hallazgo 12). Sabina devuelve LOS DOS con su nombre, porque dar
  // uno solo contradiría a una de las dos pantallas sin poder explicar por qué.
  assert.equal(sabina.datos.ingresosNetos, 6900);
  assert.equal(sabina.datos.ingresosBrutos, 7400);
  assert.notEqual(sabina.datos.ingresosNetos, sabina.datos.ingresosBrutos);
});

/* ══════════════════════════════════════════════════════════════════════
 * 5 · Deuda — KPIs "Monto adeudado" y "Pacientes con deuda" de Pacientes.
 * ══════════════════════════════════════════════════════════════════════ */

test("5 · deuda: monto y número de pacientes iguales a los KPIs de Pacientes", async () => {
  const db = base();

  // api/patients/route.ts, `debtAggregate` y `distinctDebtPatients`.
  const whereDeuda = { clinicId: CL_NORTE, balance: { gt: 0 }, status: { not: "CANCELLED" } };
  const montoPantalla = await db.invoice.aggregate({ _sum: { balance: true }, where: whereDeuda });
  const pacientesPantalla = await db.invoice.findMany({
    where: whereDeuda,
    select: { patientId: true },
    distinct: ["patientId"],
  });

  const sabina = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(db), {});
  assert.equal(sabina.ok, true);
  if (!sabina.ok) return;

  assert.equal(sabina.datos.totalAdeudado, montoPantalla._sum.balance, "«Monto adeudado»");
  assert.equal(sabina.datos.deudores.total, pacientesPantalla.length, "«Pacientes con deuda»");
});

/* ══════════════════════════════════════════════════════════════════════
 * 6 · Vencido — Finanzas → Saldos, por el mismo helper del repo.
 * ══════════════════════════════════════════════════════════════════════ */

test("6 · vencido: el mismo `overdueInvoiceWhere` que Finanzas y el corte de Caja", async () => {
  const db = base();
  // El helper es el de @/lib/caja: no se reescribe su criterio, se llama.
  const pantalla = await db.invoice.aggregate({
    _sum: { balance: true },
    where: overdueInvoiceWhere(CL_NORTE, inicioDeHoy(TZ_NORTE)),
  });

  const sabina = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(db), {});
  assert.equal(sabina.ok, true);
  if (!sabina.ok) return;

  assert.equal(sabina.datos.totalVencido, pantalla._sum.balance);
  assert.equal(
    pantalla._sum.balance,
    3000,
    "sólo inv-2: el borrador no vence (Finanzas excluye DRAFT) y sin dueDate no se vence nunca",
  );
});

/* ══════════════════════════════════════════════════════════════════════
 * Y la diferencia que NO es un fallo de Sabina, documentada con números.
 * ══════════════════════════════════════════════════════════════════════ */

test("la ventana de «hoy» de la clínica y la del proceso NO son la misma", () => {
  // Este test no compara a Sabina con nada: fija por qué las comparaciones de
  // arriba construyen la ventana con la zona de la clínica en los dos lados.
  const clinica = ventanaDelDia(HOY_N, TZ_NORTE);

  // Lo que hace hoy /api/patients: medianoche en la zona del PROCESO.
  const proceso = new Date();
  proceso.setHours(0, 0, 0, 0);

  const horas = Math.abs(clinica.desde.getTime() - proceso.getTime()) / 3_600_000;
  assert.equal(
    horas === 0 || horas >= 1,
    true,
    "o el proceso corre en la zona de la clínica, o las dos ventanas se separan horas",
  );
  // Y con la zona de la clínica, «hoy» dura exactamente 24 h (o 23/25 en el
  // cambio de horario), no un día UTC corrido.
  const duracion = (clinica.hasta.getTime() - clinica.desde.getTime()) / 3_600_000;
  assert.equal(duracion >= 23 && duracion <= 25, true, `el día duró ${duracion} h`);
});
