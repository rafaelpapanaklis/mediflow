/**
 * INVENTARIO, GASTOS Y REPORTES DE SABINA (ws1-t6).
 *
 * Run: npm run test:sabina-negocio
 *
 * Tres herramientas de SOLO LECTURA contra un doble con DOS clínicas. Lo que se
 * demuestra, en este orden de importancia:
 *
 *  1. Las MISMAS cifras que el panel. No se comprueba «el total cuadra con lo que
 *     sembré»: se corre la función que ejecuta la pantalla (o se ESCRIBE a mano la
 *     consulta que hace, cuando es una cuenta dentro del componente) contra la
 *     misma base, y se exige igualdad.
 *  2. Cada parte con su permiso, y lo que falta se DICE (`omitidas`, `sin_permiso`).
 *  3. Otra clínica → nada: las del sur chillan («SUR», 99 999) y no pueden salir.
 *  4. Solo lectura: ninguna consulta que no sea de lectura.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { bucketKeyOf } from "@/lib/analytics/query";
import { money, netRevenueSeries, refundPaymentWhere, revenuePaymentWhere } from "@/lib/caja";
import { calcularResumenFinanzas } from "@/lib/finanzas-resumen.server";
import { expenseWindowEnd, resolveFinanzasWindow, startOfMonthMx } from "@/lib/finanzas-periodo";
import { listarGastosDelPeriodo } from "@/lib/gastos-periodo.server";
import { contarExistenciasVigentes } from "@/lib/inventory/avisos-existencias";
import { getExpiryAlerts } from "@/lib/inventory/lots.server";
import { costoDeRecetaPorProcedimiento } from "@/lib/inventory/costo-receta.server";
import { gastoDe, margenDe } from "@/app/dashboard/procedures/margen";
import { correrHerramienta } from "../base";
import { inventario } from "../inventario";
import { gastos } from "../gastos";
import { reportes } from "../reportes";
import { adminNorte, adminSur, conPermisos, doctorNorte, recepcionNorte, CL_NORTE, CL_SUR, U_DOC2_N, U_DOC_N } from "./siembra";
import { baseNegocio, datosNegocio, INICIO_MES, INICIO_MES_ANT, NORTE } from "./siembra-negocio";
import { crearBase, type BaseDoble } from "./doble-base";

const nuevaBase = () => baseNegocio();

/** Corre una herramienta y exige `ok: true`. */
async function correr<T>(tool: any, ctx: any, params: unknown = {}): Promise<{ datos: T; resumen: string }> {
  const r = await correrHerramienta(tool, ctx, params);
  assert.equal(r.ok, true, `se esperaba ok y salió ${JSON.stringify(r)}`);
  if (!r.ok) throw new Error("unreachable");
  return { datos: r.datos as T, resumen: r.resumen };
}

/** El doble visto sin la rendija de `SabinaDb`: aquí se imita la consulta de la PANTALLA, que usa el prisma completo. */
const comoPantalla = (db: BaseDoble): any => db as any;

/* ══════════════════════════════════════════════════════════════════════
 * INVENTARIO
 * ══════════════════════════════════════════════════════════════════════ */

test("inventario · resumen: las cifras de la pantalla de Inventario, calculadas a mano como su componente", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(inventario, adminNorte(db), {});

  // Lo que hace `inventory-client.tsx` (kpis + itemsVista), literal: a la cantidad
  // guardada se le resta lo caducado que dicen los avisos, y el valor es Σ costo × vigente.
  const items = await comoPantalla(db).inventoryItem.findMany({ where: { clinicId: CL_NORTE } });
  const avisos = await getExpiryAlerts(CL_NORTE, db as any);
  const cad = new Map<string, number>();
  for (const a of avisos.caducado) cad.set(a.itemId, (cad.get(a.itemId) ?? 0) + Math.max(0, a.remaining));
  const vista = items.map((i: any) => ({ ...i, quantity: Math.max(0, i.quantity - Math.round(cad.get(i.id) ?? 0)) }));
  const pantalla = {
    total: items.length,
    totalQty: vista.reduce((s: number, i: any) => s + i.quantity, 0),
    lowCount: vista.filter((i: any) => i.quantity > 0 && i.quantity <= i.minQuantity).length,
    outCount: vista.filter((i: any) => i.quantity === 0).length,
    totalValue: vista.reduce((s: number, i: any) => s + i.unitCost * i.quantity, 0),
  };

  assert.equal(datos.resumen.articulos, pantalla.total);
  assert.equal(datos.resumen.unidades, pantalla.totalQty);
  assert.equal(datos.resumen.bajos, pantalla.lowCount);
  assert.equal(datos.resumen.agotados, pantalla.outCount);
  assert.equal(datos.resumen.valorTotal, pantalla.totalValue);
  // Y a mano, con la siembra: 8 artículos, 2 agotados, 2 bajos, $2,270 en 47 unidades.
  assert.deepEqual(
    { a: datos.resumen.articulos, ag: datos.resumen.agotados, b: datos.resumen.bajos, v: datos.resumen.valorTotal, u: datos.resumen.unidades },
    { a: NORTE.inventario.articulos, ag: NORTE.inventario.agotados, b: NORTE.inventario.bajos, v: NORTE.inventario.valor, u: NORTE.inventario.unidades },
  );
  assert.equal(datos.resumen.lotesPorCaducar, 1);
  assert.equal(datos.resumen.lotesCaducados, 2);
  assert.match(resumen, /\/dashboard\/inventory/, "lleva el enlace a la pantalla");
  assert.match(resumen, /última compra/i);
  assert.match(resumen, /Dental Depot/);
});

test("inventario · stock_bajo: los mismos conteos que el aviso de «Hoy» y cada artículo en su lista", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(inventario, adminNorte(db), { vista: "stock_bajo" });

  const items = await comoPantalla(db).inventoryItem.findMany({ where: { clinicId: CL_NORTE } });
  const avisos = await getExpiryAlerts(CL_NORTE, db as any);
  const hoyAviso = contarExistenciasVigentes(
    items.map((i: any) => ({ id: i.id, quantity: i.quantity, minQuantity: i.minQuantity })),
    avisos.caducado.map((a) => ({ itemId: a.itemId, remaining: a.remaining })),
  );
  assert.equal(datos.agotados.total, hoyAviso.agotados);
  assert.equal(datos.bajos.total, hoyAviso.bajos);

  assert.deepEqual(datos.agotados.filas.map((f: any) => f.nombre).sort(), ["Anestesia lidocaína", "Hilo de sutura"]);
  assert.deepEqual(datos.bajos.filas.map((f: any) => f.nombre).sort(), ["Fresa de pulido", "Guantes de látex"]);
  // El hilo tiene 4 guardadas, pero las 4 están caducadas: vigentes 0 → agotado.
  const hilo = datos.agotados.filas.find((f: any) => f.nombre === "Hilo de sutura");
  assert.equal(hilo.existencias, 0);
  assert.equal(hilo.caducadas, 4);
  assert.match(resumen, /2 artículos agotados/);
  assert.match(resumen, /Guantes de látex: 4 pza \(mínimo 5\)/);
});

test("inventario · stock_bajo: tope de 50 filas con el total REAL al lado", async () => {
  const datos = datosNegocio();
  for (let i = 0; i < 60; i++) {
    datos.inventoryItems!.push({
      id: `it-extra-${i}`, clinicId: CL_NORTE, name: `Extra ${String(i).padStart(2, "0")}`, category: "Consumibles",
      quantity: 0, minQuantity: 5, unitCost: 1, unit: "pza", description: null, emoji: "📦", price: null,
      providerId: null, createdAt: new Date(), updatedAt: new Date(),
    });
  }
  const { datos: d, resumen } = await correr<any>(inventario, adminNorte(crearBase(datos)), { vista: "stock_bajo" });
  assert.equal(d.agotados.total, 62);
  assert.equal(d.agotados.filas.length, 50);
  assert.equal(d.agotados.truncado, true);
  assert.match(resumen, /van 50 de 62 artículos/);
});

test("inventario · por_caducar: lo de /api/inventory/alerts, con los días de aviso de la clínica", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(inventario, adminNorte(db), { vista: "por_caducar" });
  const pantalla = await getExpiryAlerts(CL_NORTE, db as any);

  assert.equal(datos.porCaducar.total, pantalla.porCaducar.length);
  assert.equal(datos.caducados.total, pantalla.caducado.length);
  assert.deepEqual(datos.porCaducar.filas.map((l: any) => l.articulo), ["Gasas estériles"]);
  assert.deepEqual(datos.caducados.filas.map((l: any) => l.lote).sort(), ["H-1", "L-OLD"]);
  assert.equal(datos.diasAviso, 30, "sin fila en InventoryAlertSettings, 30 días");
  const gasas = datos.porCaducar.filas[0];
  assert.equal(gasas.dias, 10);
  assert.equal(gasas.restante, 20);
  assert.match(resumen, /Gasas estériles lote G-1: 20 pza, caduca el \d{4}-\d{2}-\d{2} \(en 10 días\)/);
  assert.match(resumen, /no cuentan como existencias/);

  // La clínica del sur tiene su propia ventana de aviso: 5 días.
  const sur = await correr<any>(inventario, adminSur(db), { vista: "por_caducar" });
  assert.equal(sur.datos.diasAviso, 5);
});

test("inventario · articulo: lo vigente, no lo guardado; busca sin acentos y un exacto gana a los que lo contienen", async () => {
  const db = nuevaBase();
  const lido = await correr<any>(inventario, adminNorte(db), { articulo: "lidocaina en gel" });
  assert.equal(lido.datos.vista, "articulo");
  assert.equal(lido.datos.coincidencias.filas.length, 1);
  const f = lido.datos.coincidencias.filas[0];
  assert.equal(f.existencias, 5, "8 guardadas − 3 caducadas");
  assert.equal(f.caducadas, 3);
  assert.equal(lido.datos.lotesDelArticulo.length, 2, "los dos lotes con saldo");
  const viejo = lido.datos.lotesDelArticulo.find((l: any) => l.lote === "L-OLD");
  assert.equal(viejo.estado, "caducado");
  assert.match(lido.resumen, /5 pza/);
  assert.match(lido.resumen, /más 3 caducadas que no cuentan/);
  assert.match(lido.resumen, /L-OLD: 3 pza, caducado/);

  // Dos resinas: no se elige una, se listan las dos.
  const resinas = await correr<any>(inventario, adminNorte(db), { vista: "articulo", articulo: "resina" });
  assert.equal(resinas.datos.coincidencias.total, 2);
  assert.equal(resinas.datos.lotesDelArticulo, null);
  assert.match(resinas.resumen, /Resina compuesta A2: 10 pza/);
  assert.match(resinas.resumen, /Resina compuesta A3: 6 pza/);

  // Un nombre exacto elige ese solo.
  const exacta = await correr<any>(inventario, adminNorte(db), { articulo: "Resina compuesta A3" });
  assert.equal(exacta.datos.coincidencias.filas.length, 1);

  // Lo que no existe es «sin datos», no un cero inventado.
  const nada = await correrHerramienta(inventario, adminNorte(db), { articulo: "xyz inexistente" });
  assert.deepEqual(nada, { ok: false, motivo: "sin_datos" });
});

test("inventario · valor: Σ costo × existencias vigentes, y los que no tienen costo se dicen", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(inventario, adminNorte(db), { vista: "valor" });
  assert.equal(datos.valor.total, 2_270);
  assert.equal(datos.valor.unidades, 47);
  assert.equal(datos.valor.sinCosto, 1, "la fresa tiene 2 en existencia y costo 0");
  assert.equal(datos.valor.porCategoria[0].categoria, "Materiales de restauración");
  assert.equal(datos.valor.porCategoria[0].valor, 1_720);
  assert.match(resumen, /\$2,270/);
  assert.match(resumen, /no tiene costo capturado/);
});

test("inventario · compras: proveedor, fecha y total; la más reciente primero; total = montoTotalCompra", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(inventario, adminNorte(db), { vista: "compras" });
  assert.equal(datos.compras.total, 2);
  const [a, b] = datos.compras.filas;
  assert.deepEqual(
    { proveedor: a.proveedor, folio: a.folio, total: a.total, articulos: a.articulos },
    { proveedor: "Dental Depot", folio: "F-100", total: 1_250, articulos: 2 },
  );
  assert.deepEqual({ proveedor: b.proveedor, total: b.total }, { proveedor: null, total: 400 });
  assert.match(resumen, /Dental Depot \(folio F-100\): \$1,250/);
  assert.match(resumen, /sin proveedor/);
});

test("inventario · aislamiento: la del sur ve lo suyo y la del norte jamás ve «SUR» ni 99 999", async () => {
  const db = nuevaBase();
  for (const vista of ["resumen", "stock_bajo", "por_caducar", "valor", "compras"]) {
    const norte = await correrHerramienta(inventario, adminNorte(db), { vista });
    const texto = JSON.stringify(norte);
    assert.doesNotMatch(texto, /SUR|99999|99,999/, `norte/${vista} dejó pasar algo del sur`);

    const sur = await correrHerramienta(inventario, adminSur(db), { vista });
    const textoSur = JSON.stringify(sur);
    assert.doesNotMatch(textoSur, /Resina|Dental Depot|Guantes|Gasas/, `sur/${vista} dejó pasar algo del norte`);
  }
  const sur = await correr<any>(inventario, adminSur(db), { vista: "compras" });
  assert.equal(sur.datos.compras.total, 1);
  assert.equal(sur.datos.compras.filas[0].proveedor, "PROVEEDOR SUR");
});

test("inventario · permiso: inventory.view, y sin él sale sin_permiso con la key", async () => {
  const db = nuevaBase();
  // Los tres roles que lo tienen por defecto.
  for (const ctx of [adminNorte(db), recepcionNorte(db), doctorNorte(db)]) {
    const r = await correrHerramienta(inventario, ctx, {});
    assert.equal(r.ok, true, ctx.role);
  }
  const limpia = nuevaBase();
  const sin = await correrHerramienta(inventario, conPermisos(limpia, ["billing.view"]), {});
  assert.deepEqual(sin, { ok: false, motivo: "sin_permiso", permiso: "inventory.view" });
  assert.equal(limpia.contador.llamadas.length, 0, "sin permiso no se toca la base");
});

test("inventario · sin clinicId de la sesión no se consulta (regla c)", async () => {
  const db = nuevaBase();
  const r = await correrHerramienta(inventario, { ...adminNorte(db), clinicId: undefined as any }, {});
  assert.equal(r.ok, false);
  assert.equal((r as any).motivo, "error");
  assert.equal(db.contador.llamadas.length, 0);
});

/* ══════════════════════════════════════════════════════════════════════
 * GASTOS
 * ══════════════════════════════════════════════════════════════════════ */

test("gastos · este mes: el total de la tarjeta «Gastos» de Finanzas y la lista de /api/gastos, por construcción", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(gastos, adminNorte(db), {});

  // La ventana de la pantalla y su suma, a mano.
  const win = resolveFinanzasWindow(new URLSearchParams("period=mes"));
  assert.ok(!("error" in win));
  if ("error" in win) return;
  const expenseTo = expenseWindowEnd("mes", new Date(), win.to);
  const lista = await listarGastosDelPeriodo({ clinicId: CL_NORTE, from: win.from, expenseTo }, db);
  const sumaLista = money(lista.gastos.reduce((s, g) => s + g.amount, 0));

  // La tarjeta de Finanzas: la MISMA función que ejecuta GET /api/finanzas.
  const finanzas = await calcularResumenFinanzas({ clinicId: CL_NORTE, from: win.from, to: win.to, expenseTo }, db);

  assert.equal(datos.total, sumaLista);
  assert.equal(datos.total, finanzas.gastos, "Sabina = tarjeta Gastos de Finanzas");
  assert.equal(datos.total, NORTE.gastos);
  assert.equal(datos.gastos, 5);
  assert.match(resumen, /\$37,750/);
  assert.match(resumen, /\/dashboard\/finanzas/);
});

test("gastos · por categoría, los más grandes y la comparación con el mes anterior", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(gastos, adminNorte(db), { periodo: "mes" });
  const cat = Object.fromEntries(datos.porCategoria.filas.map((c: any) => [c.categoria, c.total]));
  assert.deepEqual(cat, { Nómina: 25_000, Renta: 10_000, Servicios: 1_500, Insumos: 1_250 });
  assert.deepEqual(datos.porCategoria.filas.map((c: any) => c.categoria), ["Nómina", "Renta", "Servicios", "Insumos"], "de mayor a menor");
  assert.equal(datos.porCategoria.filas[0].porcentaje, 66);

  assert.equal(datos.mayores[0].categoria, "Nómina");
  assert.equal(datos.mayores[0].monto, 25_000);
  assert.equal(datos.mayores[1].proveedor, null, "la renta no viene de una compra");
  // El gasto de la compra de inventario sabe de qué proveedor es.
  const insumos = datos.mayores.find((g: any) => g.categoria === "Insumos");
  assert.equal(insumos.proveedor, "Dental Depot");

  assert.equal(datos.comparacion.total, NORTE.gastosAnterior);
  assert.equal(datos.comparacion.diferencia, 7_350);
  assert.equal(datos.comparacion.variacionPct, 24);
  assert.match(resumen, /\+\$7,350 \(\+24%\)/);
  assert.match(resumen, /Nómina: \$25,000 \(66%/);
  assert.match(resumen, /Los más grandes:/);
});

test("gastos · «este mes» cuenta el gasto con fecha de fin de mes, como Finanzas", async () => {
  const db = nuevaBase();
  const { datos } = await correr<any>(gastos, adminNorte(db), {});
  // 700 de «Internet» con fecha de fin de mes: dentro de los 1 500 de Servicios.
  const servicios = datos.porCategoria.filas.find((c: any) => c.categoria === "Servicios");
  assert.equal(servicios.total, 1_500);
  assert.equal(datos.hasta, bucketKeyOf(new Date(startOfMonthMx(new Date(), 1).getTime() - 1), "day"), "«hasta» es el último día del mes");
});

test("gastos · mes anterior, rango y categoría con otra ortografía", async () => {
  const db = nuevaBase();
  const ant = await correr<any>(gastos, adminNorte(db), { periodo: "mes_anterior" });
  assert.equal(ant.datos.total, NORTE.gastosAnterior);
  assert.equal(ant.datos.comparacion.total, 0);
  assert.equal(ant.datos.comparacion.variacionPct, null);
  assert.match(ant.resumen, /no hubo gastos, así que no hay con qué comparar/);

  // El mismo mes anterior pedido por rango, con las fechas que enseña la pantalla.
  const desde = bucketKeyOf(INICIO_MES_ANT, "day");
  const hasta = bucketKeyOf(new Date(INICIO_MES.getTime() - 1), "day");
  const rango = await correr<any>(gastos, adminNorte(db), { periodo: "custom", desde, hasta });
  assert.equal(rango.datos.total, NORTE.gastosAnterior);

  // «nomina» sin acento encuentra «Nómina».
  const nom = await correr<any>(gastos, adminNorte(db), { categoria: "nomina" });
  assert.deepEqual(
    { total: nom.datos.categoriaConsultada.total, anterior: nom.datos.categoriaConsultada.anterior, cats: nom.datos.categoriaConsultada.categorias },
    { total: 25_000, anterior: 20_000, cats: ["Nómina"] },
  );
  assert.match(nom.resumen, /De «Nómina»: \$25,000/);

  const marketing = await correr<any>(gastos, adminNorte(db), { categoria: "marketing" });
  assert.equal(marketing.datos.categoriaConsultada.gastos, 0);
  assert.match(marketing.resumen, /De «marketing» no hay gastos/);
});

test("gastos · un periodo sin gastos ni anterior es sin_datos; custom incompleto o al revés es un error explicado", async () => {
  const db = nuevaBase();
  const vacio = await correrHerramienta(gastos, adminNorte(db), { periodo: "custom", desde: "2020-01-01", hasta: "2020-01-31" });
  assert.deepEqual(vacio, { ok: false, motivo: "sin_datos" });

  const incompleto = await correrHerramienta(gastos, adminNorte(db), { periodo: "custom", desde: "2026-01-01" });
  assert.equal(incompleto.ok, false);
  assert.match((incompleto as any).detalle, /rango_invalido/);

  const alReves = await correrHerramienta(gastos, adminNorte(db), { periodo: "custom", desde: "2026-02-10", hasta: "2026-02-01" });
  assert.equal(alReves.ok, false);
  assert.match((alReves as any).detalle, /rango_invalido/);
});

test("gastos · sin la tabla expenses no revienta ni inventa ceros: lo dice", async () => {
  const db = nuevaBase();
  const sinTabla = {
    ...db,
    expense: { findMany: async () => { throw Object.assign(new Error("no existe"), { code: "P2021" }); } },
  } as any;
  const { datos, resumen } = await correr<any>(gastos, { ...adminNorte(db), db: sinTabla }, {});
  assert.equal(datos.tablaFaltante, true);
  assert.match(resumen, /todavía no está disponible/);
});

test("gastos · aislamiento: el sur ve su renta de 99 999 y el norte nunca la ve", async () => {
  const db = nuevaBase();
  const norte = await correrHerramienta(gastos, adminNorte(db), {});
  assert.doesNotMatch(JSON.stringify(norte), /SUR|99999|99,999/);

  const sur = await correr<any>(gastos, adminSur(db), {});
  assert.equal(sur.datos.total, 99_999);
  assert.deepEqual(sur.datos.porCategoria.filas.map((c: any) => c.categoria), ["Renta SUR"]);
  assert.doesNotMatch(JSON.stringify(sur), /Nómina|Dental Depot|37,?750/);
});

test("gastos · permiso analytics.view: recepción no lo tiene y se le dice, sin tocar la base", async () => {
  const db = nuevaBase();
  const r = await correrHerramienta(gastos, recepcionNorte(db), {});
  assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: "analytics.view" });
  const d = await correrHerramienta(gastos, doctorNorte(db), {});
  assert.deepEqual(d, { ok: false, motivo: "sin_permiso", permiso: "analytics.view" });
  assert.equal(db.contador.llamadas.some((l) => l.modelo === "expense"), false);
  // Con la llave suelta sí.
  const con = await correrHerramienta(gastos, conPermisos(db, ["analytics.view"]), {});
  assert.equal(con.ok, true);
});

/* ══════════════════════════════════════════════════════════════════════
 * REPORTES
 * ══════════════════════════════════════════════════════════════════════ */

test("reportes · utilidad: ingresos − gastos, igual que /api/finanzas, y contra el periodo anterior", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(reportes, adminNorte(db), { vista: "utilidad" });

  const win = resolveFinanzasWindow(new URLSearchParams("period=mes"));
  assert.ok(!("error" in win));
  if ("error" in win) return;
  const expenseTo = expenseWindowEnd("mes", new Date(), win.to);

  // 1) La función de la ruta.
  const finanzas = await calcularResumenFinanzas({ clinicId: CL_NORTE, from: win.from, to: win.to, expenseTo }, db);
  assert.equal(datos.utilidad.ingresos, finanzas.ingresos);
  assert.equal(datos.utilidad.gastos, finanzas.gastos);
  assert.equal(datos.utilidad.utilidad, finanzas.utilidad);
  assert.equal(datos.utilidad.reembolsos, finanzas.reembolsos);

  // 2) Y la cuenta a mano de la pantalla: cobros − reembolsos, sin facturas canceladas.
  const cobros = await db.payment.findMany({ where: revenuePaymentWhere(CL_NORTE, { gte: win.from, lte: win.to }), select: { amount: true, paidAt: true } });
  const devueltos = await db.payment.findMany({ where: refundPaymentWhere(CL_NORTE, { gte: win.from, lte: win.to }), select: { amount: true, paidAt: true } });
  const neto = netRevenueSeries(cobros, devueltos, (d) => bucketKeyOf(d, "day"));
  assert.equal(datos.utilidad.ingresos, neto.ingresos);

  assert.equal(datos.utilidad.ingresos, NORTE.ingresosNetos);
  assert.equal(datos.utilidad.reembolsos, NORTE.reembolsos);
  assert.equal(datos.utilidad.gastos, NORTE.gastos);
  assert.equal(datos.utilidad.utilidad, NORTE.utilidad);
  assert.equal(datos.utilidad.margenPct, 42);
  assert.equal(datos.utilidad.anterior.ingresos, NORTE.ingresosAnterior);
  assert.equal(datos.utilidad.anterior.utilidad, NORTE.utilidadAnterior);
  assert.equal(datos.utilidad.variacionUtilidadPct, 184);
  assert.match(resumen, /utilidad de \$27,250/);
  assert.match(resumen, /ya restados \$5,000 de reembolsos/);
  assert.match(resumen, /\/dashboard\/finanzas/);
  assert.equal(datos.produccion, null, "la vista utilidad no trae producción");
});

test("reportes · utilidad negativa se llama pérdida, no «utilidad de −$»", async () => {
  const datos = datosNegocio();
  datos.expenses!.push({ id: "ng-grande", clinicId: CL_NORTE, date: new Date(Date.now() - 1000), category: "Equipo", amount: 90_000, note: null, createdById: "x", purchaseId: null });
  const { datos: d, resumen } = await correr<any>(reportes, adminNorte(crearBase(datos)), { vista: "utilidad" });
  assert.equal(d.utilidad.utilidad, 27_250 - 90_000);
  assert.match(resumen, /= pérdida de \$62,750/);
});

test("reportes · producción por doctor: lo facturado, sin borradores ni canceladas, igual que «Por doctor» de Finanzas", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(reportes, adminNorte(db), { vista: "produccion_doctores" });

  const win = resolveFinanzasWindow(new URLSearchParams("period=mes"));
  assert.ok(!("error" in win));
  if ("error" in win) return;
  const finanzas = await calcularResumenFinanzas({ clinicId: CL_NORTE, from: win.from, to: win.to, expenseTo: expenseWindowEnd("mes", new Date(), win.to) }, db);

  assert.deepEqual(
    datos.produccion.doctores.filas.map((d: any) => [d.doctor, d.facturado]),
    finanzas.porDoctor.map((d) => [d.doctor, d.ingresos]),
  );
  assert.deepEqual(
    datos.produccion.doctores.filas.map((d: any) => [d.doctor, d.facturado]),
    [["Hugo Salas", NORTE.produccion[U_DOC_N]], ["Nadia Rojas", NORTE.produccion[U_DOC2_N]], ["Sin doctor", NORTE.produccion.sinDoctor]],
  );
  assert.equal(datos.produccion.total, 80_800);
  assert.equal(datos.produccion.facturas, NORTE.ventas);
  assert.equal(datos.produccion.doctores.filas[0].porcentaje, 62);
  assert.equal(datos.utilidad, null);
  assert.match(resumen, /lo facturado, no lo cobrado/);
  assert.match(resumen, /Hugo Salas: \$50,000/);
});

test("reportes · rentabilidad: precio − gasto con las funciones del catálogo; sin costo se dice «sin costo capturado»", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(reportes, adminNorte(db), { vista: "rentabilidad" });

  // La pantalla de Procedimientos, a mano: catálogo + costo de receta + gastoDe/margenDe.
  const procs = await db.procedureCatalog.findMany({ where: { clinicId: CL_NORTE, isActive: true } });
  const receta = await costoDeRecetaPorProcedimiento(CL_NORTE, db);
  const pantalla = new Map<string, number | null>();
  for (const p of procs as any[]) {
    const g = gastoDe(p.cost, receta[p.id]);
    pantalla.set(p.name, margenDe(p.basePrice, g ? g.monto : null));
  }
  for (const f of datos.rentabilidad.conMargen.filas) {
    assert.equal(f.margen, pantalla.get(f.nombre), `margen de ${f.nombre}`);
  }
  assert.deepEqual(
    datos.rentabilidad.sinCosto.filas.map((s: any) => s.nombre).sort(),
    [...pantalla.entries()].filter(([, m]) => m === null).map(([n]) => n).sort(),
  );

  // Y a mano con la siembra, ordenado del más al menos rentable (%).
  assert.deepEqual(
    datos.rentabilidad.conMargen.filas.map((f: any) => [f.nombre, f.margen, f.margenPct]),
    [["Extracción", 1_200, 100], ["Resina", 800, 80], ["Limpieza dental", 600, 75], ["Blanqueamiento", -500, -25]],
  );
  const resina = datos.rentabilidad.conMargen.filas.find((f: any) => f.nombre === "Resina");
  assert.deepEqual({ gasto: resina.gasto, origen: resina.origenGasto }, { gasto: 200, origen: "receta" });
  const extraccion = datos.rentabilidad.conMargen.filas.find((f: any) => f.nombre === "Extracción");
  assert.equal(extraccion.origenGasto, "manual", "gasto 0 capturado es un dato, no «sin costo»");
  // Endodoncia no tiene nada; Sellador tiene receta pero con un insumo sin costo (suma 0): tampoco hay dato.
  assert.deepEqual(datos.rentabilidad.sinCosto.filas.map((s: any) => s.nombre).sort(), ["Endodoncia", "Sellador"]);
  assert.equal(datos.rentabilidad.procedimientos, 6, "el inactivo no entra");
  assert.match(resumen, /sin costo capturado \(no se les calcula margen\): .*Endodoncia/);
  assert.match(resumen, /Blanqueamiento: precio \$2,000, gasto \$2,500 \(capturado\), margen −\$500 \(−25%\)/);
  assert.match(resumen, /\/dashboard\/procedures/);
  assert.doesNotMatch(JSON.stringify(datos), /Procedimiento de baja/);
});

test("reportes · pacientes: nuevos como los cuenta Reportes, y atendidos = pacientes distintos con cita cumplida", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(reportes, adminNorte(db), { vista: "pacientes" });

  const win = resolveFinanzasWindow(new URLSearchParams("period=mes"));
  assert.ok(!("error" in win));
  if ("error" in win) return;
  // El `patient.count` de cargar-reportes.ts, literal.
  const pantalla = await comoPantalla(db).patient.count({ where: { clinicId: CL_NORTE, createdAt: { gte: win.from, lte: win.to } } });
  assert.equal(datos.pacientes.nuevos, pantalla);
  assert.equal(datos.pacientes.nuevos, 4, "incluye al archivado: Reportes tampoco filtra deletedAt");
  assert.equal(datos.pacientes.nuevosAnterior, 1);
  assert.equal(datos.pacientes.variacionPct, 300);
  assert.equal(datos.pacientes.atendidos, 2);
  assert.equal(datos.pacientes.citasCumplidas, 3);
  assert.match(resumen, /2 atendidos \(3 citas cumplidas\) y 4 nuevos \(\+300% contra 1/);
  assert.match(resumen, /\/dashboard\/reports/);
});

test("reportes · resumen: la clínica en el periodo, con por cobrar y citas como Finanzas", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(reportes, adminNorte(db), {});
  assert.equal(datos.vista, "resumen");
  assert.deepEqual(datos.omitidas, []);
  assert.equal(datos.utilidad.utilidad, NORTE.utilidad);
  assert.equal(datos.produccion.total, 80_800);
  assert.equal(datos.rentabilidad.conMargen.total, 4);
  assert.equal(datos.pacientes.atendidos, 2);
  // Finanzas: citas del periodo sin canceladas (4 de 5) y saldos globales.
  assert.equal(datos.actividad.citas, 4);
  assert.equal(datos.actividad.porCobrar, 10_800);
  assert.equal(datos.actividad.vencido, 0);
  assert.match(resumen, /Por cobrar: \$10,800/);
  assert.match(resumen, /Detalle en \[Finanzas\]\(\/dashboard\/finanzas\) · \[Reportes\]\(\/dashboard\/reports\) · \[Procedimientos\]\(\/dashboard\/procedures\)/);
});

test("reportes · recepción sin finanzas: no ve utilidad ni producción, y se le DICE (no «no hay datos»)", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(reportes, recepcionNorte(db), {});
  assert.equal(datos.utilidad, null);
  assert.equal(datos.produccion, null);
  assert.equal(datos.actividad, null);
  assert.equal(datos.rentabilidad, null);
  assert.equal(datos.pacientes, null);
  assert.deepEqual(
    datos.omitidas.map((o: any) => o.permiso).sort(),
    ["analytics.view", "procedures.view", "reports.view"],
  );
  assert.match(resumen, /NO tienes acceso a: utilidad, producción y saldos \(falta analytics\.view\)/);
  assert.match(resumen, /dilo, no lo presentes como que no hay datos/);
  // Ni una cifra del dinero en lo que sale hacia el modelo.
  assert.doesNotMatch(JSON.stringify({ datos, resumen }), /27250|27,250|65000|65,000|37750|37,750|80800/);
  // Y no se consultó dinero: ni pagos ni gastos ni catálogo.
  const tocadas = new Set(db.contador.llamadas.map((l) => l.modelo));
  for (const m of ["payment", "expense", "procedureCatalog", "patient"]) assert.equal(tocadas.has(m), false, `tocó ${m} sin permiso`);
});

test("reportes · cada parte con su llave: solo reports.view → solo pacientes; el resto, omitido y nombrado", async () => {
  const db = nuevaBase();
  const { datos, resumen } = await correr<any>(reportes, conPermisos(db, ["today.view", "reports.view"]), {});
  assert.notEqual(datos.pacientes, null);
  assert.equal(datos.utilidad, null);
  assert.equal(datos.rentabilidad, null);
  assert.deepEqual(datos.omitidas.map((o: any) => o.permiso).sort(), ["analytics.view", "procedures.view"]);
  assert.match(resumen, /Pacientes: 2 atendidos/);
  assert.match(resumen, /NO tienes acceso a: utilidad, producción y saldos/);

  // Una vista concreta sin su llave: omitida con su nombre, sin datos de otra parte.
  const util = await correr<any>(reportes, recepcionNorte(db), { vista: "utilidad" });
  assert.equal(util.datos.utilidad, null);
  assert.deepEqual(util.datos.omitidas, [{ seccion: "utilidad", permiso: "analytics.view" }]);
});

test("reportes · lo que el Super Admin le quitó a Sabina NO se dice como «no tienes acceso»", async () => {
  const db = nuevaBase();
  const ctx = {
    ...adminNorte(db),
    permissionsOverride: ["today.view", "reports.view", "procedures.view"],
    sabina: { apagada: false, quitadas: ["analytics.view"] },
  } as any;
  const { datos, resumen } = await correr<any>(reportes, ctx, {});
  assert.equal(datos.utilidad, null);
  assert.deepEqual(datos.omitidas, [{ seccion: "utilidad, producción y saldos", permiso: "analytics.view", causa: "sabina" }]);
  assert.match(resumen, /el usuario SÍ tiene ese acceso, pero el Super Admin no te deja usarlo en su nombre/);
  assert.doesNotMatch(resumen, /NO tienes acceso a/);
});

test("reportes · aislamiento: el sur ve su 99 999 y el norte nunca ve «SUR»", async () => {
  const db = nuevaBase();
  for (const vista of ["resumen", "utilidad", "produccion_doctores", "rentabilidad", "pacientes"]) {
    const norte = await correrHerramienta(reportes, adminNorte(db), { vista });
    assert.doesNotMatch(JSON.stringify(norte), /SUR|99999|99,999/, `norte/${vista}`);
    const sur = await correrHerramienta(reportes, adminSur(db), { vista });
    assert.doesNotMatch(JSON.stringify(sur), /Hugo|Nadia|Resina|Limpieza|Dental Depot/, `sur/${vista}`);
  }
  const sur = await correr<any>(reportes, adminSur(db), {});
  assert.equal(sur.datos.utilidad.ingresos, 99_999);
  assert.equal(sur.datos.utilidad.gastos, 99_999);
  assert.equal(sur.datos.utilidad.utilidad, 0);
  assert.equal(sur.datos.produccion.total, 99_999);
  assert.equal(sur.datos.rentabilidad.conMargen.filas[0].margen, 99_998);
  assert.equal(sur.datos.pacientes.nuevos, 2);
});

test("reportes · custom incompleto es un error explicado, no una consulta a ciegas", async () => {
  const db = nuevaBase();
  const r = await correrHerramienta(reportes, adminNorte(db), { vista: "utilidad", periodo: "custom", hasta: "2026-01-31" });
  assert.equal(r.ok, false);
  assert.match((r as any).detalle, /rango_invalido/);
});

/* ══════════════════════════════════════════════════════════════════════
 * LAS TRES: SOLO LECTURA, Y EL POOLER
 * ══════════════════════════════════════════════════════════════════════ */

test("solo lectura: las tres herramientas, en todas sus vistas, solo hacen consultas de lectura", async () => {
  const db = nuevaBase();
  const ctx = adminNorte(db);
  for (const p of [{}, { vista: "stock_bajo" }, { vista: "por_caducar" }, { vista: "valor" }, { vista: "compras" }, { articulo: "resina" }]) {
    await correrHerramienta(inventario, ctx, p);
  }
  for (const p of [{}, { periodo: "mes_anterior" }, { categoria: "renta" }]) await correrHerramienta(gastos, ctx, p);
  for (const vista of ["resumen", "utilidad", "produccion_doctores", "rentabilidad", "pacientes"]) await correrHerramienta(reportes, ctx, { vista });

  const ops = new Set(db.contador.llamadas.map((l) => l.op));
  for (const op of ops) assert.ok(["findMany", "findFirst", "findUnique", "count", "aggregate", "groupBy"].includes(op), `op de escritura o desconocida: ${op}`);
  // Y el tipo lo impide de origen: la rendija no tiene create/update/delete.
  for (const modelo of ["inventoryItem", "inventoryLot", "inventoryPurchase", "expense", "procedureMaterialRecipe"]) {
    for (const op of ["create", "update", "delete", "upsert", "createMany", "updateMany", "deleteMany"]) {
      assert.equal((db as any)[modelo][op], undefined, `${modelo}.${op} existe en la rendija`);
    }
  }
});

test("pooler: ninguna vista abre más de 6 consultas a la vez", async () => {
  // Se mide la concurrencia real: cada delegado cuenta las llamadas en vuelo.
  const db = nuevaBase() as any;
  let enVuelo = 0;
  let maximo = 0;
  const envolver = (obj: any) => {
    for (const modelo of Object.keys(obj)) {
      const d = obj[modelo];
      if (!d || typeof d !== "object") continue;
      for (const op of Object.keys(d)) {
        const original = d[op];
        if (typeof original !== "function") continue;
        d[op] = async (...args: unknown[]) => {
          enVuelo++;
          maximo = Math.max(maximo, enVuelo);
          await new Promise((r) => setTimeout(r, 1));
          try { return await original(...args); } finally { enVuelo--; }
        };
      }
    }
  };
  envolver(db);
  const ctx = adminNorte(db);
  for (const [tool, p] of [
    [inventario, {}], [inventario, { vista: "por_caducar" }], [inventario, { vista: "compras" }],
    [gastos, {}], [reportes, {}], [reportes, { vista: "utilidad" }], [reportes, { vista: "pacientes" }],
  ] as const) {
    maximo = 0;
    await correrHerramienta(tool as any, ctx, p);
    assert.ok(maximo < 7, `${(tool as any).nombre} ${JSON.stringify(p)} abrió ${maximo} consultas a la vez`);
  }
});

test("la fecha de México: el mes de la siembra empieza donde lo dice la pantalla", () => {
  // Sanidad de la propia siembra: «este mes» y «el anterior» no se solapan.
  assert.ok(INICIO_MES.getTime() > INICIO_MES_ANT.getTime());
  assert.notEqual(String(CL_NORTE), String(CL_SUR));
});
