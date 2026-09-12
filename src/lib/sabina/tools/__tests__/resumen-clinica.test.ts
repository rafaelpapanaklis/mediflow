/**
 * `resumen_clinica` — la compuesta, y la regla 3 del contrato.
 *
 * Run: npm run test:sabina-resumen
 *
 * 🔴 Lo que se vigila aquí es lo que el contrato llama «omitir DICIÉNDOLO». En
 * una pregunta directa, callarse una parte ya es grave:
 *
 *   ❌ «No tengo datos de facturación» → el doctor entiende que no se facturó.
 *   ✅ «No tienes acceso a facturación.»
 *
 * En una pregunta ABIERTA es peor, y es el caso de esta herramienta: Sabina
 * daría un consejo sobre medio cuadro con el mismo tono de seguridad. Así que se
 * comprueba que cada parte que falta viaje en `omitidas` CON su key, y que el
 * `resumen` —lo único que el motor puede llegar a leer si recorta— también lo
 * diga.
 *
 * Lo demás que se prueba es la coherencia: los totales de la compuesta tienen
 * que ser LOS MISMOS que devuelven las herramientas sueltas. Si se separaran,
 * Sabina se contradiría a sí misma dentro de una conversación.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { ejecutarHerramienta } from "../index";
import { fechaDe, ventanaDelMes } from "../fechas";
import { HOY_N, TZ_NORTE, adminNorte, base, conPermisos, doctorNorte } from "./siembra";

/** El mes en curso de la clínica, igual que lo arma la herramienta. */
function mesDeLaClinica(): { desde: string; hasta: string } {
  const v = ventanaDelMes(TZ_NORTE);
  return {
    desde: fechaDe(v.desde, TZ_NORTE),
    hasta: fechaDe(new Date(v.hasta.getTime() - 1), TZ_NORTE),
  };
}

test("resumen_clinica: con todos los permisos trae las cuatro partes y no omite nada", async () => {
  const r = await ejecutarHerramienta("resumen_clinica", adminNorte(base()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.deepEqual(r.datos.omitidas, []);
  assert.notEqual(r.datos.citasHoy, null);
  assert.notEqual(r.datos.ingresosDelMes, null);
  assert.notEqual(r.datos.deuda, null);
  assert.notEqual(r.datos.pacientesDelMes, null);
  assert.equal(r.datos.fecha, HOY_N);
  // Y el resumen no habla de accesos que no faltan.
  assert.equal(r.resumen.indexOf("NO tienes acceso"), -1);
});

test("🔴 resumen_clinica: sin facturación, esa parte se OMITE Y SE DICE", async () => {
  const db = base();
  // Recepción con la facturación apagada en el modal de Permisos.
  const ctx = conPermisos(db, ["today.view", "agenda.view", "patients.view"]);

  const r = await ejecutarHerramienta("resumen_clinica", ctx, {});
  assert.equal(r.ok, true, "no puede contestar `sin_datos`: los otros tres cuadrantes SÍ los tiene");
  if (!r.ok) return;

  // La parte que falta no está…
  assert.equal(r.datos.ingresosDelMes, null);
  assert.equal(r.datos.deuda, null);
  // …y lo que falta se DICE, con la key, una sola vez (ingresos y deuda comparten permiso).
  assert.deepEqual(r.datos.omitidas, [{ seccion: "ingresos y deuda", permiso: "billing.view" }]);
  // Y el resumen lo lleva escrito, para el caso en que el motor sólo lea eso.
  assert.match(r.resumen, /NO tienes acceso a: ingresos y deuda \(falta billing\.view\)/);
  assert.match(r.resumen, /no lo presentes como que no hay datos/);

  // Lo que sí tiene, lo trae.
  assert.notEqual(r.datos.citasHoy, null);
  assert.notEqual(r.datos.pacientesDelMes, null);
  // Y NINGUNA cifra de dinero se escapó por otro lado.
  const json = JSON.stringify(r);
  assert.equal(json.indexOf("12277"), -1);
  assert.equal(json.indexOf("6900"), -1);
});

test("🔴 resumen_clinica: con sólo `today.view` se omiten las tres y se nombran las tres", async () => {
  const db = base();
  const r = await ejecutarHerramienta("resumen_clinica", conPermisos(db, ["today.view"]), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.equal(r.datos.citasHoy, null);
  assert.equal(r.datos.ingresosDelMes, null);
  assert.equal(r.datos.deuda, null);
  assert.equal(r.datos.pacientesDelMes, null);
  assert.deepEqual(
    r.datos.omitidas.map((o) => o.permiso).sort(),
    ["agenda.view", "billing.view", "patients.view"],
  );
  assert.match(r.resumen, /NO tienes acceso a/);
  // Y no se consultó nada: sin permiso no se pregunta a la base.
  assert.equal(db.contador.llamadas.length, 0);
});

test("resumen_clinica: sin ni siquiera `today.view` es `sin_permiso`, no una foto vacía", async () => {
  const r = await ejecutarHerramienta("resumen_clinica", conPermisos(base(), ["settings.view"]), {});
  assert.equal(r.ok, false);
  assert.equal((r as any).motivo, "sin_permiso");
  assert.equal((r as any).permiso, "today.view");
});

test("resumen_clinica: sus totales son LOS MISMOS que los de las herramientas sueltas", async () => {
  const db = base();
  const ctx = adminNorte(db);
  const mes = mesDeLaClinica();

  const resumen = await ejecutarHerramienta("resumen_clinica", ctx, {});
  const citas = await ejecutarHerramienta("citas_del_dia", ctx, { fecha: HOY_N });
  const ingresos = await ejecutarHerramienta("ingresos_por_periodo", ctx, {
    desde: mes.desde,
    hasta: mes.hasta,
    agrupar: "mes",
  });
  const deuda = await ejecutarHerramienta("pacientes_con_deuda", ctx, {});
  const nuevos = await ejecutarHerramienta("pacientes_nuevos", ctx, {
    desde: mes.desde,
    hasta: mes.hasta,
  });

  assert.equal(resumen.ok && citas.ok && deuda.ok, true);
  if (!resumen.ok || !citas.ok || !deuda.ok) return;

  assert.equal(resumen.datos.citasHoy.activas, citas.datos.activas);
  assert.equal(resumen.datos.citasHoy.noAsistieron, citas.datos.noAsistieron);
  assert.equal(resumen.datos.deuda.total, deuda.datos.totalAdeudado);
  assert.equal(resumen.datos.deuda.pacientes, deuda.datos.deudores.total);
  assert.equal(resumen.datos.deuda.vencido, deuda.datos.totalVencido);

  // Los del mes: si el mes en curso no tuviera dinero o altas, la suelta
  // contesta `sin_datos` y la compuesta trae ceros — las dos cosas son ciertas.
  if (ingresos.ok) {
    assert.equal(resumen.datos.ingresosDelMes.netos, ingresos.datos.ingresosNetos);
    assert.equal(resumen.datos.ingresosDelMes.brutos, ingresos.datos.ingresosBrutos);
  } else {
    assert.equal(resumen.datos.ingresosDelMes.netos, 0);
  }
  if (nuevos.ok) {
    assert.equal(resumen.datos.pacientesDelMes.nuevos, nuevos.datos.nuevos.total);
  } else {
    assert.equal(resumen.datos.pacientesDelMes.nuevos, 0);
  }
});

test("resumen_clinica: a un DOCTOR le cuenta SU agenda, no la de la clínica", async () => {
  const db = base();
  const doc = await ejecutarHerramienta("resumen_clinica", doctorNorte(db), {});
  const admin = await ejecutarHerramienta("resumen_clinica", adminNorte(db), {});
  assert.equal(doc.ok && admin.ok, true);
  if (!doc.ok || !admin.ok) return;

  assert.equal(doc.datos.citasHoy.activas, 3, "las suyas");
  assert.equal(admin.datos.citasHoy.activas, 4, "las de la casa");
});

test("resumen_clinica: se mantiene por debajo del presupuesto de consultas del pooler", async () => {
  // La regla de la casa son menos de 7 consultas por `Promise.all`. La compuesta
  // las pide en TRES tandas (dos ligeras juntas, luego pacientes, luego deuda),
  // así que ninguna tanda pasa de 5. Este número vigila que nadie meta la cuarta
  // sección dentro de la primera tanda sin darse cuenta.
  const db = base();
  await ejecutarHerramienta("resumen_clinica", adminNorte(db), {});
  assert.equal(
    db.contador.llamadas.length <= 14,
    true,
    `la foto costó ${db.contador.llamadas.length} consultas`,
  );
});

test("resumen_clinica: no manda listados de pacientes al modelo, sólo los totales", async () => {
  const r = await ejecutarHerramienta("resumen_clinica", adminNorte(base()), {});
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // La compuesta reusa las otras herramientas, pero se queda con sus cifras: si
  // arrastrara las 50 filas de cada una, una sola pregunta abierta se comería el
  // contexto y el monedero.
  assert.deepEqual(Object.keys(r.datos.deuda).sort(), ["pacientes", "total", "vencido"]);
  assert.deepEqual(Object.keys(r.datos.pacientesDelMes).sort(), [
    "nuevos",
    "periodoAnterior",
    "variacionPct",
  ]);
  assert.equal(JSON.stringify(r).indexOf("folio"), -1);
});
