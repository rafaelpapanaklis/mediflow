/**
 * Las tres herramientas de DINERO: `ingresos_por_periodo`,
 * `pacientes_con_deuda`, `tratamientos_por_ingreso`.
 *
 * Run: npm run test:sabina-dinero
 *
 * La auditoría del repo encontró CERO pruebas sobre la aritmética del dinero, y
 * por eso los hallazgos 12 y 18 no saltaron antes. Estas son las de Sabina, y
 * cada una es el caso concreto de un filtro que, si falta, da un número
 * plausible y equivocado:
 *
 *  · el REEMBOLSO se guarda con monto POSITIVO → sin el filtro se suma como cobro;
 *  · y excluir su fila NO basta: el pago original sigue contando, así que el neto
 *    tiene que RESTARLO (hallazgo 12 — «paga $10,000 el 5, se le devuelve todo el
 *    20» dejaba el mes en $10,000, y sobre ese número se decide la nómina);
 *  · el pago de una factura CANCELADA no es ingreso;
 *  · una factura CANCELADA conserva su `balance` → sin el filtro sigue contando
 *    como deuda para siempre;
 *  · el descuento de factura se PRORRATEA por concepto, con el criterio del SAT,
 *    o el ranking de tratamientos suma el bruto.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { ejecutarHerramienta } from "../index";
import { sumarDias } from "../fechas";
import { HOY_N, adminNorte, base, conPermisos, doctorNorte } from "./siembra";

/** El rango en el que cae todo el dinero sembrado (últimos 10 días). */
const RANGO = { desde: sumarDias(HOY_N, -10), hasta: HOY_N };

/* ══════════════════════════════════════════════════════════════════════
 * ingresos_por_periodo
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 ingresos: el reembolso no se suma como cobro Y sí se resta del neto", async () => {
  const r = await ejecutarHerramienta("ingresos_por_periodo", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // Cobros del rango: $5,000 (inv-1) + $1,500 (inv-3) + $900 (inv-6) = $7,400.
  // El de $4,000 es de una factura CANCELADA y no cuenta.
  // El de $500 es un reembolso: no es un cobro, y además resta.
  assert.equal(r.datos.cobros, 3, "tres cobros: ni el reembolso ni el de la cancelada");
  assert.equal(r.datos.ingresosBrutos, 7400);
  assert.equal(r.datos.reembolsos, 500);
  assert.equal(r.datos.ingresosNetos, 6900, "7,400 − 500");
});

test("🔴 ingresos: el pago de una factura CANCELADA no es ingreso", async () => {
  const r = await ejecutarHerramienta("ingresos_por_periodo", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // Si contara, los brutos serían 11,400.
  assert.equal(r.datos.ingresosBrutos, 7400);
  assert.notEqual(r.datos.ingresosBrutos, 11400);
});

test("ingresos: la suma de la serie ES el total, por construcción", async () => {
  const r = await ejecutarHerramienta("ingresos_por_periodo", adminNorte(base()), {
    ...RANGO,
    agrupar: "dia",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const suma = r.datos.serie.reduce((a, b) => a + b.monto, 0);
  assert.equal(Math.round(suma * 100) / 100, r.datos.ingresosNetos, "la gráfica suma lo que dice la tarjeta");
  // Y la serie cubre el rango COMPLETO, tramos vacíos incluidos.
  assert.equal(r.datos.serie.length, 11, "del día -10 al día 0, ambos incluidos");
});

test("ingresos: los buckets se arman con la fecha LOCAL del pago", async () => {
  const r = await ejecutarHerramienta("ingresos_por_periodo", adminNorte(base()), {
    ...RANGO,
    agrupar: "dia",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // El cobro de $5,000 se hizo a las 12:00 LOCALES de hace 5 días. Si el bucket
  // saliera de la fecha UTC, un pago de la tarde caería al día siguiente.
  const dia5 = r.datos.serie.find((s) => s.periodo === sumarDias(HOY_N, -5));
  assert.equal(dia5.monto, 5000);
  // Y el reembolso deja su día en negativo, que es la verdad de ese día.
  const dia2 = r.datos.serie.find((s) => s.periodo === sumarDias(HOY_N, -2));
  assert.equal(dia2.monto, -500);
});

test("ingresos: agrupar por mes deja un solo tramo con el neto entero", async () => {
  const r = await ejecutarHerramienta("ingresos_por_periodo", adminNorte(base()), {
    ...RANGO,
    agrupar: "mes",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const suma = r.datos.serie.reduce((a, b) => a + b.monto, 0);
  assert.equal(Math.round(suma * 100) / 100, r.datos.ingresosNetos);
  assert.equal(r.datos.serie.length <= 2, true, "diez días caen en uno o dos meses");
});

test("ingresos: el ticket promedio sale de los cobros, no de los tramos", async () => {
  const r = await ejecutarHerramienta("ingresos_por_periodo", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.ticketPromedio, 2466.67, "7,400 / 3 cobros");
});

/* ══════════════════════════════════════════════════════════════════════
 * pacientes_con_deuda
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 deuda: la factura CANCELADA conserva su balance y NO es deuda", async () => {
  const r = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(base()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // Con saldo: inv-2 ($3,000), inv-3 ($500), inv-4 (borrador, $1,000) e inv-7
  // (de la paciente restringida, $7,777). inv-5 está CANCELADA con balance 4,000
  // intacto: si contara, saldrían 5 pacientes y $16,277.
  assert.equal(r.datos.deudores.total, 4);
  assert.equal(r.datos.totalAdeudado, 12277);
  assert.equal(
    JSON.stringify(r.datos.deudores.filas).indexOf("Elias"),
    -1,
    "el paciente de la factura cancelada no debe nada",
  );
});

test("deuda: el BORRADOR cuenta como saldo (igual que en Pacientes) y NO como vencido", async () => {
  const r = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(base()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // El borrador de Dora ($1,000) está DENTRO del total adeudado…
  assert.equal(
    r.datos.deudores.filas.some((f) => f.paciente === "Dora Sanchez" && f.saldo === 1000),
    true,
  );
  // …y FUERA del vencido, aunque su dueDate pasó hace 20 días: Finanzas → Saldos
  // excluye los borradores. Vencido = solo inv-2 ($3,000); inv-7 no tiene fecha
  // de vencimiento y las facturas sin `dueDate` no vencen jamás.
  assert.equal(r.datos.totalVencido, 3000);
});

test("deuda: ordenada de mayor a menor, con el mayor en el resumen", async () => {
  const r = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(base()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(
    r.datos.deudores.filas.map((f) => f.saldo),
    [7777, 3000, 1000, 500],
  );
  assert.match(r.resumen, /El mayor es Paula Restringida/);
});

test("deuda: `saldoMinimo` estrecha, nunca ensancha", async () => {
  const r = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(base()), {
    saldoMinimo: 1000,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(
    r.datos.deudores.filas.map((f) => f.saldo),
    [7777, 3000, 1000],
  );
  assert.equal(r.datos.totalAdeudado, 11777, "el total sigue al mismo filtro que la lista");
});

test("deuda: no manda al modelo el teléfono ni nada que no haga falta", async () => {
  const r = await ejecutarHerramienta("pacientes_con_deuda", adminNorte(base()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r.datos.deudores.filas[0]).sort(), ["facturas", "folio", "paciente", "saldo"]);
});

test("🔴 deuda: la visibilidad por paciente aplica también por la puerta de facturación", async () => {
  // Un doctor con billing.view ve las facturas de toda la clínica (igual que
  // GET /api/invoices), pero NO las de un paciente restringido a otros. La
  // paciente restringida DEBE $7,777, así que si el filtro faltara se vería.
  const db = base();
  const r = await ejecutarHerramienta("pacientes_con_deuda", doctorNorte(db), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(
    JSON.stringify(r).indexOf("Restringida"),
    -1,
    "la paciente restringida no puede salir por facturación",
  );
  assert.equal(r.datos.deudores.total, 3, "para el doctor son tres deudores, no cuatro");
  assert.equal(
    r.datos.totalAdeudado,
    4500,
    "y el TOTAL también se recorta: si no, la suma delataría al paciente oculto",
  );
});

test("🔴 tratamientos: el concepto de un paciente restringido tampoco viaja", async () => {
  const db = base();
  const rango = { desde: sumarDias(HOY_N, -70), hasta: HOY_N };

  const admin = await ejecutarHerramienta("tratamientos_por_ingreso", adminNorte(db), rango);
  assert.equal(admin.ok, true);
  if (!admin.ok) return;
  assert.equal(admin.datos.totalFacturado, 18677, "la admin sí ve el tratamiento restringido");

  const doc = await ejecutarHerramienta("tratamientos_por_ingreso", doctorNorte(db), rango);
  assert.equal(doc.ok, true);
  if (!doc.ok) return;
  assert.equal(
    JSON.stringify(doc).indexOf("Tratamiento restringido"),
    -1,
    "el nombre del tratamiento de un paciente restringido no puede salir",
  );
  assert.equal(doc.datos.totalFacturado, 10900);
});

/* ══════════════════════════════════════════════════════════════════════
 * tratamientos_por_ingreso
 * ══════════════════════════════════════════════════════════════════════ */

test("tratamientos: agrupa por concepto y ordena por importe", async () => {
  const r = await ejecutarHerramienta("tratamientos_por_ingreso", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;

  // Facturas emitidas del rango: inv-1 (Limpieza 1,000 + Resina 4,000),
  // inv-2 (Endodoncia 3,000), inv-3 (Limpieza 2,000), inv-6 (Blanqueamiento 900
  // tras el descuento de 100). El borrador y la cancelada no entran.
  assert.equal(r.datos.totalFacturado, 10900);
  assert.equal(r.datos.facturas, 4);

  const porNombre: Record<string, any> = {};
  for (const t of r.datos.tratamientos.filas) porNombre[t.tratamiento] = t;

  assert.equal(r.datos.tratamientos.filas[0].tratamiento, "Resina");
  assert.equal(porNombre["Resina"].importe, 4000);
  assert.equal(porNombre["Resina"].cantidad, 4, "cuatro unidades en una sola línea");
  assert.equal(porNombre["Resina"].precioMedio, 1000);
  assert.equal(porNombre["Limpieza dental"].importe, 3000);
  assert.equal(porNombre["Limpieza dental"].veces, 2, "aparece en dos facturas");
  assert.equal(porNombre["Endodoncia"].importe, 3000);
});

test("🔴 tratamientos: el descuento de factura se prorratea por concepto", async () => {
  const r = await ejecutarHerramienta("tratamientos_por_ingreso", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const blanq = r.datos.tratamientos.filas.find((t) => t.tratamiento === "Blanqueamiento");
  // La línea vale 1,000 y la factura lleva 100 de descuento: se factura 900.
  assert.equal(blanq.importe, 900, "el bruto (1,000) inflaría el ranking");
});

test("tratamientos: el borrador y la cancelada NO se facturaron", async () => {
  const r = await ejecutarHerramienta("tratamientos_por_ingreso", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const nombres = r.datos.tratamientos.filas.map((t) => t.tratamiento);
  assert.equal(nombres.indexOf("Consulta general"), -1, "un borrador no es ingreso");
  assert.equal(nombres.indexOf("Ortodoncia"), -1, "una cancelada no lo fue");
});

test("tratamientos: la participación suma ~100% y el resumen dice «facturados»", async () => {
  const r = await ejecutarHerramienta("tratamientos_por_ingreso", adminNorte(base()), RANGO);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const suma = r.datos.tratamientos.filas.reduce((a, b) => a + b.participacionPct, 0);
  assert.equal(suma >= 97 && suma <= 103, true, `la participación suma ${suma}%`);
  assert.match(r.resumen, /facturados/, "no se puede presentar como caja");
});

test("tratamientos: `top` recorta el ranking sin mentir sobre el total", async () => {
  const r = await ejecutarHerramienta("tratamientos_por_ingreso", adminNorte(base()), {
    ...RANGO,
    top: 2,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.tratamientos.filas.length, 2);
  assert.equal(r.datos.tratamientos.total, 4, "hay cuatro tratamientos distintos");
  assert.equal(r.datos.totalFacturado, 10900, "el total facturado no se recorta");
});

/* ══════════════════════════════════════════════════════════════════════
 * el permiso del dinero
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 quien no tiene billing.view no recibe NINGUNA cifra de dinero", async () => {
  const db = base();
  // Recepción con la facturación apagada en el modal de Permisos, pero con
  // agenda y pacientes: exactamente el caso del contrato.
  const ctx = conPermisos(db, ["today.view", "agenda.view", "patients.view"]);

  for (const nombre of ["ingresos_por_periodo", "pacientes_con_deuda", "tratamientos_por_ingreso"]) {
    const r = await ejecutarHerramienta(nombre, ctx, RANGO);
    assert.equal((r as any).motivo, "sin_permiso", nombre);
    assert.equal((r as any).permiso, "billing.view");
  }

  // Y lo de agenda y pacientes sí lo contesta: el corte es por área, no total.
  const citas = await ejecutarHerramienta("citas_del_dia", ctx, { fecha: HOY_N });
  assert.equal(citas.ok, true);
});
