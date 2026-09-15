/**
 * El área de DINERO de Sabina (ws1-t2): `facturas_de_paciente`, `cobrar_factura`,
 * `crear_factura` y `avisar_saldo_whatsapp`, contra el doble de DOS clínicas.
 *
 *   npm run test:sabina-dinero-acciones
 *
 * Las tres pruebas que el contrato exige a cada herramienta nueva, y las que
 * cada candado de MAPA-dinero §7 necesita para no ser una promesa:
 *   (a) no cruza de clínica — la vecina tiene el MISMO folio MF-0010;
 *   (b) sin permiso devuelve `sin_permiso`, sin tocar la base;
 *   (c) `preparar` no escribe — la base es un espía que lanza ante cualquier escritura.
 *
 * Lo que decide corre de verdad: el resolvedor de pacientes, la visibilidad por
 * paciente, `computeTotals`/`computeInvoiceTotal`, `invoiceFieldsFromQuote`,
 * `buildPaymentNotice`, `decideSendMode`, `hasPermission`. Se sustituye solo lo
 * que no carga fuera de Next (ver ../../tools/__tests__/preparar.ts) y la
 * lectura de la ventana de 24 h del Inbox, que usa el `prisma` global.
 */

import "../../tools/__tests__/preparar";
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const ventana = { ultimoMensajeDelPaciente: new Date(Date.now() - 60 * 60_000) as Date | null };
mock.module("@/lib/whatsapp/inbox-log", {
  namedExports: { lastInboundAtForPhone: async () => ventana.ultimoMensajeDelPaciente },
});

import { computeInvoiceTotal } from "@/lib/invoice-totals";
import { buildPaymentNotice } from "@/lib/invoices/payment-notice";
import { herramientaDeAccion, propuestaDeDatos, definirAccion, type RespuestaEndpoint } from "../../engine-acciones";
import { ENTIDAD_PROPUESTA, EVENTO } from "../../engine-propuestas-core";
import { correrHerramienta } from "../../tools/base";
import { inicioDeHoy } from "../../tools/fechas";
import { accionAvisarSaldo } from "../avisar-saldo";
import { accionCobrarFactura, saldoTras } from "../cobrar-factura";
import { METODOS_COBRO } from "../comun";
import { accionCrearFactura, calcularFactura } from "../crear-factura";
import { facturasDePaciente } from "../facturas-de-paciente";
import {
  CL_A,
  CL_B,
  TZ_A,
  admin,
  adminVecina,
  avisoEnInbox,
  baseDinero,
  conKeys,
  draRojas,
  drSalas,
  recepcion,
  type BaseDinero,
} from "./dinero-siembra";

const RAIZ = process.cwd();

/** Todas las consultas hechas llevaron el clinicId de la sesión y NUNCA el de la otra clínica. */
function soloDeSuClinica(db: BaseDinero, propia: string, ajena: string) {
  for (const l of db.espia.llamadas) {
    if (l.op === "$queryRaw") continue;
    const texto = JSON.stringify(l.args ?? {});
    assert.ok(texto.includes(`"${propia}"`), `${l.op} sin el clinicId de la sesión: ${texto}`);
    assert.ok(!texto.includes(ajena), `${l.op} menciona la otra clínica: ${texto}`);
  }
}

/** Un llamador de endpoints falso: apunta lo que le piden y contesta lo que le digan. */
function llaveFalsa(respuestas: Array<RespuestaEndpoint | ((pet: any) => RespuestaEndpoint)>) {
  const pedidas: any[] = [];
  return {
    pedidas,
    llave: {
      propuestaId: "p-1",
      async llamar(_h: unknown, pet: any) {
        pedidas.push(pet);
        const r = respuestas.shift();
        if (!r) throw new Error("el endpoint se llamó más veces de las previstas");
        return typeof r === "function" ? r(pet) : r;
      },
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * (a) NO CRUZA DE CLÍNICA
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 aislamiento: el folio MF-0010 existe en las dos clínicas y cada una ve SOLO la suya", async () => {
  const db = baseDinero();
  const a = await correrHerramienta(facturasDePaciente, admin(db), { factura: "MF-0010" });
  assert.equal(a.ok, true);
  if (!a.ok) return;
  assert.equal(a.datos.estado, "ok");
  const filasA = (a.datos as any).facturas.filas;
  assert.deepEqual(filasA.map((f: any) => f.total), [1200]);
  assert.ok(!JSON.stringify(a.datos).includes("99999"), "no se cuela la factura de la vecina");
  soloDeSuClinica(db, CL_A, CL_B);

  const dbB = baseDinero();
  const b = await correrHerramienta(facturasDePaciente, adminVecina(dbB), { factura: "MF-0010" });
  assert.equal(b.ok, true);
  if (!b.ok) return;
  assert.deepEqual((b.datos as any).facturas.filas.map((f: any) => f.total), [99999]);
  soloDeSuClinica(dbB, CL_B, CL_A);
});

test("🔴 aislamiento: cobrar, avisar y facturar el MF-0010 / P-0001 apuntan a la factura de la propia clínica", async () => {
  const db = baseDinero();
  const cobro = await accionCobrarFactura.preparar(admin(db), { factura: "MF-0010", metodo: "cash" });
  assert.equal(cobro.tipo, "propuesta");
  assert.equal((cobro as any).datos.facturaId, "inv-juan-1");
  const aviso = await accionAvisarSaldo.preparar(admin(db), { factura: "mf 10" });
  assert.equal(aviso.tipo, "propuesta", JSON.stringify(aviso));
  assert.equal((aviso as any).datos.facturaId, "inv-juan-1");
  const presupuesto = await accionCrearFactura.preparar(admin(db), { presupuesto: "P-0001" });
  assert.equal((presupuesto as any).datos?.quoteId, "q-juan");
  soloDeSuClinica(db, CL_A, CL_B);

  const dbB = baseDinero();
  const cobroB = await accionCobrarFactura.preparar(adminVecina(dbB), { factura: "MF-0010", metodo: "cash" });
  assert.equal((cobroB as any).datos.facturaId, "inv-vecina");
  const presB = await accionCrearFactura.preparar(adminVecina(dbB), { presupuesto: "P-0001" });
  assert.equal((presB as any).datos?.quoteId, "q-vecina");
  // Un paciente de la clínica A no existe para la vecina.
  const juanDesdeB = await accionCobrarFactura.preparar(adminVecina(dbB), { paciente: "Juan Pérez", metodo: "cash" });
  assert.equal(juanDesdeB.tipo, "no_se_puede");
  soloDeSuClinica(dbB, CL_B, CL_A);
});

test("🔴 visibilidad: la deuda de la paciente restringida no sale por ninguna puerta de dinero", async () => {
  const db = baseDinero();
  const lista = await correrHerramienta(facturasDePaciente, recepcion(db), { factura: "MF-0014" });
  assert.equal(lista.ok && (lista.datos as any).estado, "no_encontrado");
  const porNombre = await correrHerramienta(facturasDePaciente, recepcion(db), { paciente: "Renata" });
  assert.equal(porNombre.ok && (porNombre.datos as any).estado, "no_encontrado");
  assert.equal((await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0014", metodo: "cash" })).tipo, "no_se_puede");
  assert.equal((await accionAvisarSaldo.preparar(recepcion(db), { factura: "MF-0014" })).tipo, "no_se_puede");
  assert.equal((await accionCrearFactura.preparar(recepcion(db), { presupuesto: "P-0004" })).tipo, "no_se_puede");
  assert.ok(!JSON.stringify(lista).includes("7000"));

  // La Dra. Rojas sí la ve.
  const suya = await correrHerramienta(facturasDePaciente, draRojas(db), { factura: "MF-0014" });
  assert.equal(suya.ok && (suya.datos as any).facturas.filas[0].saldo, 7000);
});

/* ══════════════════════════════════════════════════════════════════════
 * (b) SIN PERMISO SE DICE, Y SIN TOCAR LA BASE
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 sin permiso: las cuatro devuelven sin_permiso con su key y no hacen ni una consulta", async () => {
  const casos: Array<[any, unknown, string]> = [
    [facturasDePaciente, { paciente: "Juan" }, "billing.view"],
    [herramientaDeAccion(accionCobrarFactura), { factura: "MF-0010", metodo: "cash" }, "billing.charge"],
    [herramientaDeAccion(accionCrearFactura), { paciente: "Juan", conceptos: [{ concepto: "Limpieza", precio: 500 }] }, "billing.create"],
    [herramientaDeAccion(accionAvisarSaldo), { factura: "MF-0010" }, "whatsapp.send"],
  ];
  for (const [tool, params, key] of casos) {
    const db = baseDinero();
    const r = await correrHerramienta(tool, conKeys(db, ["agenda.view"]), params);
    assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: key }, tool.nombre);
    assert.equal(db.espia.llamadas.length, 0, `${tool.nombre}: consultó la base sin permiso`);
  }
});

test("sin permiso por rol: el doctor no cobra ni manda avisos (como en la pantalla), pero sí factura", async () => {
  const db = baseDinero();
  const cobro = await correrHerramienta(herramientaDeAccion(accionCobrarFactura), drSalas(db), { factura: "MF-0010", metodo: "cash" });
  assert.equal(!cobro.ok && (cobro as any).permiso, "billing.charge");
  const aviso = await correrHerramienta(herramientaDeAccion(accionAvisarSaldo), drSalas(db), { factura: "MF-0010" });
  assert.equal(!aviso.ok && (aviso as any).permiso, "whatsapp.send");
  const factura = await correrHerramienta(herramientaDeAccion(accionCrearFactura), drSalas(db), {
    paciente: "Juan Pérez",
    conceptos: [{ concepto: "Limpieza", precio: 500 }],
  });
  assert.equal(factura.ok, true, JSON.stringify(factura));
});

/* ══════════════════════════════════════════════════════════════════════
 * (c) PREPARAR NO ESCRIBE
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 preparar no escribe: una propuesta de cada acción, y el espía sin una sola escritura", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const propuestas = [
    await accionCobrarFactura.preparar(ctx, { factura: "MF-0011", monto: 500, metodo: "cash" }),
    await accionCobrarFactura.preparar(ctx, { factura: "MF-0012", metodo: "debit" }),
    await accionCrearFactura.preparar(ctx, { paciente: "Juan Pérez", conceptos: [{ concepto: "Limpieza", precio: 700 }] }),
    await accionCrearFactura.preparar(ctx, { presupuesto: "P-0001" }),
    await accionAvisarSaldo.preparar(ctx, { factura: "MF-0010" }),
  ];
  for (const p of propuestas) assert.equal(p.tipo, "propuesta", JSON.stringify(p));
  for (const [accion, p] of [
    [accionCobrarFactura, propuestas[0]],
    [accionCrearFactura, propuestas[3]],
    [accionAvisarSaldo, propuestas[4]],
  ] as const) {
    await (accion as any).huella(ctx, (p as any).datos);
  }
  assert.deepEqual(db.espia.escrituras, []);
});

/* ══════════════════════════════════════════════════════════════════════
 * facturas_de_paciente
 * ══════════════════════════════════════════════════════════════════════ */

test("facturas de Juan: saldo = total − pagado, la cancelada no debe, comprobante y presupuesto aceptado", async () => {
  const db = baseDinero();
  const r = await correrHerramienta(facturasDePaciente, recepcion(db), { paciente: "Juan Pérez" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const d = r.datos as any;
  assert.equal(d.paciente, "Juan Pérez (P0003)");
  assert.deepEqual(d.facturas.filas.map((f: any) => [f.folio, f.estado, f.saldo]), [
    ["MF-0011", "parcial", 2000],
    ["MF-0010", "pendiente", 1200],
    ["MF-0009", "cancelada", 0],
  ]);
  assert.equal(d.saldoPorCobrar, 3200);
  assert.equal(d.facturas.filas[0].pagos[0].metodo, "Tarjeta crédito");
  assert.equal(d.facturas.filas[1].comprobante, "/api/invoices/inv-juan-1/print");
  assert.deepEqual(d.presupuestosAceptados, [{ folio: "P-0001", titulo: "Rehabilitación", total: 2900, factura: null }]);
  assert.match(r.resumen, /saldo por cobrar \$3,200\.00/);
});

test("facturas: dos «María García» se preguntan, con lo que el usuario puede repetir; el borrador va aparte", async () => {
  const db = baseDinero();
  const r = await correrHerramienta(facturasDePaciente, recepcion(db), { paciente: "María García" });
  assert.equal(r.ok && (r.datos as any).estado, "falta_aclarar");
  const opciones = (r as any).datos.opciones;
  assert.ok(opciones.some((o: string) => /→ paciente: P0001/.test(o)), JSON.stringify(opciones));
  assert.ok(opciones.some((o: string) => /→ paciente: P0002/.test(o)));

  const mg1 = await correrHerramienta(facturasDePaciente, recepcion(db), { paciente: "P0001" });
  const d = (mg1 as any).datos;
  assert.equal(d.saldoPorCobrar, 0, "un borrador no es saldo por cobrar");
  assert.equal(d.enBorrador, 800);
  assert.deepEqual(d.presupuestosAceptados, [{ folio: "P-0002", titulo: "Extracción", total: 800, factura: "MF-0012 (borrador)" }]);
});

/* ══════════════════════════════════════════════════════════════════════
 * cobrar_factura
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 cobrar: sin método PREGUNTA (nunca efectivo por defecto) y `refund` no existe", async () => {
  const db = baseDinero();
  const r = await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0010" });
  assert.equal(r.tipo, "aclarar");
  const opciones = (r as any).opciones as string[];
  assert.equal(opciones.length, 6);
  assert.ok(opciones.every((o) => !/refund|reembolso/i.test(o)));
  assert.deepEqual([...METODOS_COBRO], ["cash", "debit", "credit", "transfer", "check", "other"]);
  assert.equal(accionCobrarFactura.parametros.safeParse({ factura: "MF-0010", metodo: "refund" }).success, false);
  assert.equal(accionCobrarFactura.datos.safeParse({
    facturaId: "inv-juan-1", folio: "MF-0010", paciente: "Juan", modo: "abono", monto: 10, metodo: "refund",
    confirmarPrimero: false, antes: { total: 1, paid: 0 },
  }).success, false, "ni guardada en la propuesta");
});

test("cobrar: la lista de métodos es la del selector de la pantalla, ni uno más", () => {
  const modal = readFileSync(path.join(RAIZ, "src/components/dashboard/billing/payment-modal.tsx"), "utf8");
  const tipo = /export type PaymentMethod = ([^;]+);/.exec(modal)?.[1] ?? "";
  const delModal = Array.from(tipo.matchAll(/"([a-z]+)"/g)).map((m) => m[1]);
  assert.deepEqual(delModal, [...METODOS_COBRO]);
});

test("cobrar: con paciente y dos facturas con saldo, pregunta cuál por folio; la cancelada y la pagada no son opción", async () => {
  const db = baseDinero();
  const r = await accionCobrarFactura.preparar(recepcion(db), { paciente: "Juan Pérez", metodo: "cash" });
  assert.equal(r.tipo, "aclarar");
  const opciones = (r as any).opciones as string[];
  assert.equal(opciones.length, 2);
  assert.ok(opciones.some((o) => /MF-0010 · pendiente · saldo \$1,200\.00 → factura: MF-0010/.test(o)), JSON.stringify(opciones));
  assert.ok(!opciones.some((o) => /MF-0009/.test(o)));
  assert.equal((await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0009", metodo: "cash" })).tipo, "no_se_puede");
  const pagada = await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0013", metodo: "cash" });
  assert.match((pagada as any).frase, /ya está pagada/);
});

test("🔴 cobrar: el monto no pasa del saldo (total − pagado); la tarjeta dice el saldo antes → después", async () => {
  const db = baseDinero();
  const demas = await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0011", monto: 2000.01, metodo: "cash" });
  assert.equal(demas.tipo, "no_se_puede");
  assert.match((demas as any).frase, /le quedan \$2,000\.00/);

  const abono = await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0011", monto: 500, metodo: "transfer" });
  assert.equal(abono.tipo, "propuesta");
  const p = abono as any;
  assert.deepEqual(p.datos, {
    facturaId: "inv-juan-2", folio: "MF-0011", paciente: "Juan Pérez", modo: "abono", monto: 500, metodo: "transfer",
    confirmarPrimero: false, antes: { total: 3000, paid: 1000 },
  });
  assert.match(p.tarjeta.frase, /pago de \$500\.00 \(transferencia\) a la factura MF-0011 de Juan Pérez/);
  const saldo = p.tarjeta.detalles.find((x: any) => x.etiqueta === "Saldo");
  assert.deepEqual(saldo, { etiqueta: "Saldo", antes: "$2,000.00", valor: "$1,500.00" });
  assert.equal(accionCobrarFactura.deshacer.reversible, false);

  const saldar = await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0010", metodo: "debit" });
  assert.equal((saldar as any).datos.modo, "saldar");
  assert.equal((saldar as any).datos.monto, 1200);
  assert.equal(saldoTras({ total: 1200, paid: 0 }, 1200), 0);
});

test("🔴 cobrar un BORRADOR: la tarjeta dice que primero lo confirma; sin permiso de crear facturas, no hay tarjeta", async () => {
  const db = baseDinero();
  const r = await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0012", metodo: "cash" });
  assert.equal(r.tipo, "propuesta");
  assert.equal((r as any).datos.confirmarPrimero, true);
  assert.ok((r as any).tarjeta.avisos.some((a: string) => /BORRADOR: primero la voy a confirmar/.test(a)));

  const sinCrear = await accionCobrarFactura.preparar(conKeys(db, ["billing.view", "billing.charge"]), { factura: "MF-0012", metodo: "cash" });
  assert.equal(sinCrear.tipo, "sin_permiso");
});

test("cobrar una factura timbrada avisa que no genera complemento de pago", async () => {
  const db = baseDinero();
  const r = await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0015", monto: 100, metodo: "cash" });
  assert.ok((r as any).tarjeta.avisos.some((a: string) => /timbrada \(CFDI\)/.test(a)));
});

test("🔴 cobrar: si otro cobro entra entre la tarjeta y el botón, la huella cambia", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const r = (await accionCobrarFactura.preparar(ctx, { factura: "MF-0011", monto: 500, metodo: "cash" })) as any;
  const antes = await accionCobrarFactura.huella(ctx, r.datos);
  assert.equal(await accionCobrarFactura.huella(ctx, r.datos), antes, "sin cambios, la misma huella");
  const inv = db.filas.invoices.find((i: any) => i.id === "inv-juan-2");
  inv.paid = 1500;
  inv.updatedAt = new Date();
  assert.notEqual(await accionCobrarFactura.huella(ctx, r.datos), antes);
});

test("cobrar → ejecutar: llama al endpoint de la pantalla con el método de la lista, sin fecha ni `refund`", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const abono = (await accionCobrarFactura.preparar(ctx, { factura: "MF-0011", monto: 500, metodo: "cash" })) as any;
  const f = llaveFalsa([{ status: 200, cuerpo: { success: true, warning: "Efectivo cobrado sin caja abierta — no entra en ningún corte" } }]);
  const ej = await accionCobrarFactura.ejecutar(f.llave as any, ctx, abono.datos);
  assert.deepEqual(f.pedidas, [{ metodo: "POST", ruta: "/api/invoices/inv-juan-2", cuerpo: { amount: 500, method: "cash" }, params: { id: "inv-juan-2" } }]);
  assert.equal(ej.ok, true);
  assert.match((ej as any).frase, /registré \$500\.00 \(efectivo\) a la factura MF-0011.*Le quedan \$1,500\.00\. Ojo: Efectivo cobrado sin caja abierta/);
  assert.deepEqual((ej as any).enlace, { texto: "Comprobante MF-0011", url: "/api/invoices/inv-juan-2/print" });

  const saldar = (await accionCobrarFactura.preparar(ctx, { factura: "MF-0010", metodo: "check" })) as any;
  const g = llaveFalsa([{ status: 200, cuerpo: { success: true } }]);
  await accionCobrarFactura.ejecutar(g.llave as any, ctx, saldar.datos);
  assert.deepEqual(g.pedidas[0], { metodo: "POST", ruta: "/api/invoices/inv-juan-1/mark-paid", cuerpo: { method: "check" }, params: { id: "inv-juan-1" } });

  const trampa = llaveFalsa([]);
  const conRefund = await accionCobrarFactura.ejecutar(trampa.llave as any, ctx, { ...abono.datos, metodo: "refund" });
  assert.equal(conRefund.ok, false);
  assert.equal(trampa.pedidas.length, 0, "con `refund` guardado no se llama a nada");
});

test("cobrar un borrador → ejecutar: confirma y DESPUÉS cobra; si confirmar falla, no cobra", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const r = (await accionCobrarFactura.preparar(ctx, { factura: "MF-0012", metodo: "credit" })) as any;
  const bien = llaveFalsa([{ status: 200, cuerpo: { success: true } }, { status: 200, cuerpo: { success: true } }]);
  const ej = await accionCobrarFactura.ejecutar(bien.llave as any, ctx, r.datos);
  assert.deepEqual(bien.pedidas.map((p) => p.ruta), ["/api/invoices/inv-mg1-borrador/confirm", "/api/invoices/inv-mg1-borrador/mark-paid"]);
  assert.match((ej as any).frase, /^Confirmé la factura MF-0012 y registré \$800\.00/);

  const mal = llaveFalsa([{ status: 400, cuerpo: { error: "Solo se pueden confirmar borradores" } }]);
  const ej2 = await accionCobrarFactura.ejecutar(mal.llave as any, ctx, r.datos);
  assert.equal(mal.pedidas.length, 1, "sin confirmar no se intenta cobrar");
  assert.equal(ej2.ok, false);
  assert.match((ej2 as any).frase, /No confirmé la factura MF-0012 ni cobré nada: Solo se pueden confirmar borradores\./);
});

test("🔴 cobrar tras un 500: RELEE la factura y dice si el cobro quedó o no (N8), nunca «inténtalo otra vez» a ciegas", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const r = (await accionCobrarFactura.preparar(ctx, { factura: "MF-0011", monto: 500, metodo: "cash" })) as any;
  const inv = db.filas.invoices.find((i: any) => i.id === "inv-juan-2");

  // El handler escribió y después falló.
  const escribioYFallo = llaveFalsa([() => { inv.paid = 1500; return { status: 500, cuerpo: null }; }]);
  const si = await accionCobrarFactura.ejecutar(escribioYFallo.llave as any, ctx, r.datos);
  assert.equal(si.ok, true);
  assert.match((si as any).frase, /SÍ quedó registrado.*No lo repitas/);

  inv.paid = 1000;
  const noEscribio = llaveFalsa([{ status: 500, cuerpo: null }]);
  const no = await accionCobrarFactura.ejecutar(noEscribio.llave as any, ctx, r.datos);
  assert.equal(no.ok, false);
  assert.match((no as any).frase, /NO quedó registrado.*Puedes pedírmelo otra vez/);

  const otro = llaveFalsa([() => { inv.paid = 1200; return { status: 500, cuerpo: null }; }]);
  const raro = await accionCobrarFactura.ejecutar(otro.llave as any, ctx, r.datos);
  assert.match((raro as any).frase, /cambió de otra forma.*antes de volver a cobrar/);
});

test("cobrar: los 400 del servidor se pasan con su porqué, no como «el sistema rechazó los datos»", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const r = (await accionCobrarFactura.preparar(ctx, { factura: "MF-0011", monto: 500, metodo: "cash" })) as any;
  const f = llaveFalsa([{ status: 400, cuerpo: { error: "El monto excede el saldo pendiente" } }]);
  const ej = await accionCobrarFactura.ejecutar(f.llave as any, ctx, r.datos);
  assert.deepEqual(ej, { ok: false, tipo: "invalido", frase: "No se registró el cobro: El monto excede el saldo pendiente." });
});

/* ══════════════════════════════════════════════════════════════════════
 * crear_factura
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 el total de la tarjeta es computeInvoiceTotal sobre LAS LÍNEAS (el caso de $3,093.28, no $3,093.30)", () => {
  const conceptos = [549.84, 960.53, 922.78, 193.46, 40.03].map((precio, i) => ({ concepto: `C${i}`, precio }));
  const c = calcularFactura(conceptos, 0, { taxRate: 16, taxIncluded: false }) as any;
  assert.equal(c.ok, true);
  assert.equal(c.total, 3093.28);
  assert.equal(c.total, computeInvoiceTotal(c.items, c.discount, 16, false).total);
  assert.notEqual(c.total, computeInvoiceTotal(c.subtotal, c.discount, 16, false).total, "la rama legado (la suma) daría otro");
});

test("crear factura con conceptos: IVA explícito de la clínica, las mismas líneas, tabla con totales y el folio que se gasta", async () => {
  const db = baseDinero();
  const r = (await accionCrearFactura.preparar(recepcion(db), {
    paciente: "Juan Pérez",
    conceptos: [
      { concepto: "Limpieza", precio: 800 },
      { concepto: "Resina", cantidad: 2, precio: 350.5, descuento: 50 },
    ],
    descuento: 100,
  })) as any;
  assert.equal(r.tipo, "propuesta", JSON.stringify(r));
  assert.deepEqual(r.datos.cuerpo, {
    patientId: "p-juan",
    items: [
      { description: "Limpieza", quantity: 1, unitPrice: 800, total: 800 },
      { description: "Resina", quantity: 2, unitPrice: 350.5, discount: 50, total: 651 },
    ],
    discount: 100,
    taxRate: 0,
    taxIncluded: true,
  });
  assert.equal(r.datos.total, 1351);
  assert.equal(r.datos.total, computeInvoiceTotal(r.datos.cuerpo.items, 100, 0, true).total);
  assert.deepEqual(r.tarjeta.tabla.columnas.map((c: any) => c.titulo), ["Concepto", "Cant.", "Precio", "Desc.", "Importe"]);
  assert.deepEqual(r.tarjeta.tabla.filas[1], ["Resina", "2", "$350.50", "−$50.00", "$651.00"]);
  assert.deepEqual(r.tarjeta.tabla.pie, [
    { etiqueta: "Subtotal", valor: "$1,451.00" },
    { etiqueta: "Descuento", valor: "−$100.00" },
    { etiqueta: "Total", valor: "$1,351.00", fuerte: true },
  ]);
  assert.ok(r.tarjeta.avisos.some((a: string) => /no se puede borrar, solo anular/.test(a)));
  assert.ok(r.tarjeta.detalles.some((d: any) => d.etiqueta === "IVA" && /Exento/.test(d.valor)));
  assert.equal(r.deshacer.reversible, false);

  const iva = baseDinero((d) => { d.clinics.find((c: any) => c.id === CL_A).cfdiTaxMode = "iva16"; });
  const r16 = (await accionCrearFactura.preparar(recepcion(iva), { paciente: "Juan Pérez", conceptos: [{ concepto: "Blanqueamiento", precio: 2320 }] })) as any;
  assert.equal(r16.datos.cuerpo.taxRate, 16, "sin taxRate el servidor pondría 16 % por su cuenta: se manda siempre");
  assert.equal(r16.datos.cuerpo.taxIncluded, true);
});

test("crear factura: donde el editor recorta en silencio, Sabina lo dice; y una de $0 se pregunta", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const global = await accionCrearFactura.preparar(ctx, { paciente: "Juan Pérez", conceptos: [{ concepto: "A", precio: 100 }], descuento: 150 });
  assert.match((global as any).frase, /descuento \(\$150\.00\) es mayor que la suma/);
  const linea = await accionCrearFactura.preparar(ctx, { paciente: "Juan Pérez", conceptos: [{ concepto: "A", precio: 100, descuento: 101 }] });
  assert.match((linea as any).frase, /descuento de «A»/);
  assert.equal((await accionCrearFactura.preparar(ctx, { paciente: "Juan Pérez", conceptos: [{ concepto: "A", precio: 0 }] })).tipo, "aclarar");
  assert.equal((await accionCrearFactura.preparar(ctx, { paciente: "Juan Pérez" })).tipo, "aclarar");
  assert.equal((await accionCrearFactura.preparar(ctx, { paciente: "María García", conceptos: [{ concepto: "A", precio: 1 }] })).tipo, "aclarar");
});

test("🔴 crear factura → ejecutar: si el total guardado no es el de la tarjeta, lo dice", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const r = (await accionCrearFactura.preparar(ctx, { paciente: "Juan Pérez", conceptos: [{ concepto: "Limpieza", precio: 800 }] })) as any;
  const igual = llaveFalsa([{ status: 201, cuerpo: { id: "inv-nueva", invoiceNumber: "MF-0016", total: 800 } }]);
  const ok = await accionCrearFactura.ejecutar(igual.llave as any, ctx, r.datos);
  assert.deepEqual(igual.pedidas[0], { metodo: "POST", ruta: "/api/invoices", cuerpo: r.datos.cuerpo });
  assert.match((ok as any).frase, /^Listo: creé la factura MF-0016 de Juan Pérez por \$800\.00/);
  assert.deepEqual((ok as any).enlace, { texto: "Comprobante MF-0016", url: "/api/invoices/inv-nueva/print" });

  const distinto = llaveFalsa([{ status: 201, cuerpo: { id: "inv-nueva", invoiceNumber: "MF-0016", total: 800.01 } }]);
  const mal = await accionCrearFactura.ejecutar(distinto.llave as any, ctx, r.datos);
  assert.match((mal as any).frase, /la guardó por \$800\.01 y en la tarjeta te dije \$800\.00/);
});

test("crear factura desde presupuesto: total de invoiceFieldsFromQuote, en borrador y reversible", async () => {
  const db = baseDinero();
  const r = (await accionCrearFactura.preparar(recepcion(db), { presupuesto: "p-1" })) as any;
  assert.equal(r.tipo, "propuesta", JSON.stringify(r));
  assert.equal(r.datos.total, 2900, "Resina 2×250 + Corona 2,500 − 100 de descuento");
  assert.deepEqual(r.tarjeta.tabla.filas.map((f: string[]) => f[0]), ["Resina", "Corona (16)"], "en el orden del presupuesto");
  assert.deepEqual(r.deshacer, { reversible: true, como: "Mientras siga en borrador se puede eliminar desde el detalle de la factura." });
  assert.ok(r.tarjeta.avisos.some((a: string) => /BORRADOR/.test(a)));
  assert.ok(r.tarjeta.avisos.some((a: string) => /IVA 16 % incluido aunque la clínica sea exenta/.test(a)));

  const conFactura = await accionCrearFactura.preparar(recepcion(db), { presupuesto: "P-0002" });
  assert.match((conFactura as any).frase, /ya tiene su factura, la MF-0012 \(borrador\)/);
  const presentado = await accionCrearFactura.preparar(recepcion(db), { presupuesto: "P-0003" });
  assert.match((presentado as any).frase, /solo se factura un presupuesto aceptado/);
});

test("🔴 presupuesto: si le crean la factura por la pantalla entre la tarjeta y el botón, la huella cambia", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const r = (await accionCrearFactura.preparar(ctx, { presupuesto: "P-0001" })) as any;
  const antes = await accionCrearFactura.huella(ctx, r.datos);
  db.filas.quotes.find((q: any) => q.id === "q-juan").invoiceId = "inv-juan-1";
  assert.notEqual(await accionCrearFactura.huella(ctx, r.datos), antes);
});

test("el motor recibe la tabla y el «deshacer» de ESTA propuesta, no el general de la acción", async () => {
  const db = baseDinero();
  const tool = herramientaDeAccion(accionCrearFactura);
  const r = await correrHerramienta(tool, recepcion(db), { presupuesto: "P-0001" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal((r.datos as any).se_puede_deshacer, true);
  assert.ok((r.datos as any).tabla);
  // Integración #259 + #260: el prompt dice «sin tablas en el chat»; la de la tarjeta
  // la arma el servidor, y al modelo se le dice que no la repita.
  assert.match((r.datos as any).instruccion, /ya salen en la tabla de la tarjeta: no los copies en el chat/);
  const guardada = propuestaDeDatos(r.datos)!;
  assert.equal(guardada.deshacer.reversible, true);
  assert.equal(guardada.tarjeta.tabla?.filas.length, 2);

  // Una tabla que no cuadra no se propone.
  const rota = definirAccion<any, any>({
    ...accionCrearFactura,
    nombre: "rota",
    preparar: async () => ({ tipo: "propuesta", datos: { tipo: "presupuesto", quoteId: "q", presupuesto: "P", patientId: "p", paciente: "x", total: 1 }, tarjeta: { frase: "x", detalles: [], avisos: [], tabla: { columnas: [{ titulo: "A" }], filas: [["1", "2"]] } } }),
    huella: async () => "h",
  });
  const mal = await correrHerramienta(herramientaDeAccion(rota), recepcion(db), {});
  assert.equal(mal.ok, false);
  assert.match((mal as any).detalle, /tabla_de_tarjeta_invalida/);

  // Sin tabla (un cobro), la instrucción no paga esa frase de más.
  const cobro = await correrHerramienta(herramientaDeAccion(accionCobrarFactura), admin(db), { factura: "MF-0010", metodo: "cash" });
  assert.equal(cobro.ok, true, JSON.stringify(cobro));
  if (!cobro.ok) return;
  assert.equal((cobro.datos as any).estado, "propuesta_sin_confirmar");
  assert.equal((cobro.datos as any).tabla, undefined);
  assert.doesNotMatch((cobro.datos as any).instruccion, /tabla/);
});

/* ══════════════════════════════════════════════════════════════════════
 * avisar_saldo_whatsapp
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 aviso: la tarjeta enseña el texto EXACTO del handler (ventana abierta) y el de la plantilla (cerrada)", async () => {
  const db = baseDinero();
  ventana.ultimoMensajeDelPaciente = new Date(Date.now() - 60 * 60_000);
  const abierta = (await accionAvisarSaldo.preparar(recepcion(db), { factura: "MF-0010" })) as any;
  const esperado = buildPaymentNotice({
    patient: { firstName: "Juan", lastName: "Pérez" }, clinicName: "Clínica QA", clinicPhone: "55 5000 1000",
    invoiceNumber: "MF-0010", balance: 1200, items: [{ description: "Limpieza dental" }],
  }).body;
  const mensaje = abierta.tarjeta.detalles.find((d: any) => d.etiqueta === "Mensaje que recibe").valor;
  assert.equal(mensaje, `«${esperado}»`);
  assert.match(esperado, /^Hola Juan Pérez, te saludamos de Clínica QA\. Tienes un saldo pendiente de \$1,200\.00 MXN de tu nota MF-0010 \(Limpieza dental\)\./);
  assert.equal(abierta.datos.modo, "text");
  assert.ok(abierta.tarjeta.avisos.some((a: string) => /comprobante PDF adjunto/.test(a)));

  ventana.ultimoMensajeDelPaciente = null;
  const cerrada = (await accionAvisarSaldo.preparar(recepcion(db), { factura: "MF-0010" })) as any;
  assert.equal(cerrada.datos.modo, "template");
  assert.equal(
    cerrada.tarjeta.detalles.find((d: any) => d.etiqueta === "Mensaje que recibe").valor,
    "«Hola Juan Pérez, te saludamos de Clínica QA. Tienes un saldo pendiente de $1,200.00 MXN. Llámanos al 55 5000 1000 o responde este mensaje para coordinar tu pago. ¡Gracias!»",
  );

  // Y el token de WhatsApp no se leyó nunca.
  for (const l of db.espia.llamadas.filter((x) => x.op === "clinic.findFirst")) {
    assert.ok(!l.args?.select?.waAccessToken, "se pidió el token de WhatsApp");
  }
  ventana.ultimoMensajeDelPaciente = new Date(Date.now() - 60 * 60_000);
});

test("🔴 aviso: si la ventana se cierra entre la tarjeta y el botón, el texto cambia y la huella también", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  ventana.ultimoMensajeDelPaciente = new Date(Date.now() - 60 * 60_000);
  const r = (await accionAvisarSaldo.preparar(ctx, { factura: "MF-0010" })) as any;
  const antes = await accionAvisarSaldo.huella(ctx, r.datos);
  ventana.ultimoMensajeDelPaciente = null;
  assert.notEqual(await accionAvisarSaldo.huella(ctx, r.datos), antes);
  ventana.ultimoMensajeDelPaciente = new Date(Date.now() - 60 * 60_000);
});

test("🔴 aviso: UNO por factura al día — lo que ya salió hoy por el Inbox o por Sabina lo frena", async () => {
  // Salió hoy el de esta misma nota.
  const mismo = baseDinero((d) => avisoEnInbox(d, "5599990000", "Hola Juan Pérez, … de tu nota MF-0010 (Limpieza dental). ¡Gracias!"));
  const r1 = await accionAvisarSaldo.preparar(recepcion(mismo), { factura: "MF-0010" });
  assert.equal(r1.tipo, "no_se_puede");
  assert.match((r1 as any).frase, /ya salió un aviso de saldo a Juan Pérez.*no preparo otro/);

  // Salió uno por plantilla (no dice de qué nota): cuenta, para no mandarle dos cobros el mismo día.
  const plantilla = baseDinero((d) => avisoEnInbox(d, "+52 1 55 9999 0000", "Hola Juan Pérez, te saludamos de Clínica QA. Tienes un saldo pendiente de $2,000.00 MXN."));
  assert.equal((await accionAvisarSaldo.preparar(recepcion(plantilla), { factura: "MF-0010" })).tipo, "no_se_puede");

  // Salió el de OTRA nota: este sí se puede.
  const otra = baseDinero((d) => avisoEnInbox(d, "5599990000", "Hola Juan Pérez, … de tu nota MF-0011 (Resina)."));
  assert.equal((await accionAvisarSaldo.preparar(recepcion(otra), { factura: "MF-0010" })).tipo, "propuesta");

  // Uno de AYER no cuenta.
  const ayer = baseDinero((d) => avisoEnInbox(d, "5599990000", "… de tu nota MF-0010 …", 36 * 3600));
  assert.equal((await accionAvisarSaldo.preparar(recepcion(ayer), { factura: "MF-0010" })).tipo, "propuesta");

  // Sabina lo mandó hoy (aunque el Inbox no lo tenga).
  const porSabina = baseDinero((d) => rastroDeAviso(d, "inv-juan-1", { ok: true, status: 200 }));
  assert.match((await accionAvisarSaldo.preparar(recepcion(porSabina), { factura: "MF-0010" }) as any).frase, /ya le mandé/);

  // Uno que Sabina mandó ayer a las 23:56 no frena el de hoy, aunque su propuesta (23:55)
  // caiga dentro del margen de medianoche con el que se buscan las propuestas.
  const casiMedianoche = new Date(inicioDeHoy(TZ_A).getTime() - 4 * 60_000);
  const deAyer = baseDinero((d) => rastroDeAviso(d, "inv-juan-1", { ok: true, status: 200 }, undefined, casiMedianoche));
  assert.equal((await accionAvisarSaldo.preparar(recepcion(deAyer), { factura: "MF-0010" })).tipo, "propuesta");

  // Un aviso de OTRA factura que mandó Sabina no frena este.
  const otraPorSabina = baseDinero((d) => rastroDeAviso(d, "inv-juan-2", { ok: true, status: 200 }));
  assert.equal((await accionAvisarSaldo.preparar(recepcion(otraPorSabina), { factura: "MF-0010" })).tipo, "propuesta");
});

/** El rastro de una propuesta de aviso: proponer, confirmar y (si se da) resultado. */
function rastroDeAviso(d: any, facturaId: string, resultado: { ok: boolean; status: number } | null, intento = "11111111-1111-4111-8111-111111111111", ancla = new Date()) {
  const id = `prop-${d.auditLogs.length}`;
  const hace = (s: number) => new Date(ancla.getTime() - s * 1000);
  const base = { clinicId: CL_A, entityType: ENTIDAD_PROPUESTA, entityId: id };
  d.auditLogs.push({ ...base, id: `${id}-p`, action: EVENTO.proponer, createdAt: hace(300), changes: { accion: "avisar_saldo_whatsapp", datos: { facturaId, intento } } });
  d.auditLogs.push({ ...base, id: `${id}-c`, action: EVENTO.confirmar, createdAt: hace(240), changes: { accion: "avisar_saldo_whatsapp" } });
  if (resultado) {
    d.auditLogs.push({
      ...base, id: `${id}-r`, action: EVENTO.resultado, createdAt: hace(230),
      changes: { accion: "avisar_saldo_whatsapp", ok: resultado.ok, llamadas: [{ ruta: `/api/invoices/${facturaId}/send-whatsapp`, status: resultado.status }] },
    });
  }
}

test("🔴 aviso tras un 502 de hoy, o con un envío en curso: ese día no hay otra tarjeta (el Inbox no prueba que no llegó)", async () => {
  const con502 = baseDinero((d) => rastroDeAviso(d, "inv-juan-1", { ok: false, status: 502 }));
  const r502 = await accionAvisarSaldo.preparar(recepcion(con502), { factura: "MF-0010" });
  assert.equal(r502.tipo, "no_se_puede");
  assert.match((r502 as any).frase, /pudo haberle llegado aunque no aparezca en el Inbox.*hoy no preparo otro/);

  const enCurso = baseDinero((d) => rastroDeAviso(d, "inv-juan-1", null));
  const rCurso = await accionAvisarSaldo.preparar(recepcion(enCurso), { factura: "MF-0010" });
  assert.match((rCurso as any).frase, /todavía no termina \(o se cortó a la mitad\)/);

  // Un 409 (sin plantilla, sin teléfono) no mandó nada: no frena.
  const con409 = baseDinero((d) => rastroDeAviso(d, "inv-juan-1", { ok: false, status: 409 }));
  assert.equal((await accionAvisarSaldo.preparar(recepcion(con409), { factura: "MF-0010" })).tipo, "propuesta");
});

test("🔴 aviso: al confirmar, la huella no se ve a sí misma «en curso» (su propio sabina_confirmar ya está escrito)", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const r = (await accionAvisarSaldo.preparar(ctx, { factura: "MF-0010" })) as any;
  const alProponer = await accionAvisarSaldo.huella(ctx, r.datos);
  // Lo que escribe la confirmación ANTES de recalcular la huella: su proponer y su confirmar.
  rastroDeAviso(db.filas, "inv-juan-1", null, r.datos.intento);
  assert.equal(await accionAvisarSaldo.huella(ctx, r.datos), alProponer, "sigue vigente: es ella misma");
  // Otra propuesta del mismo aviso, confirmada y sin resultado: esa sí la frena.
  rastroDeAviso(db.filas, "inv-juan-1", null, "22222222-2222-4222-8222-222222222222");
  assert.notEqual(await accionAvisarSaldo.huella(ctx, r.datos), alProponer);
});

test("aviso → ejecutar: un 502 no se reintenta y no manda a «revisar el Inbox» como si eso probara algo", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const r = (await accionAvisarSaldo.preparar(ctx, { factura: "MF-0010" })) as any;
  const f = llaveFalsa([{ status: 502, cuerpo: { error: "Meta no respondió" } }]);
  const ej = await accionAvisarSaldo.ejecutar(f.llave as any, ctx, r.datos);
  assert.equal(f.pedidas.length, 1);
  assert.deepEqual(f.pedidas[0], { metodo: "POST", ruta: "/api/invoices/inv-juan-1/send-whatsapp", params: { id: "inv-juan-1" } });
  assert.equal(ej.ok, false);
  assert.match((ej as any).frase, /no sé si el mensaje le llegó.*pudo llegar aunque no aparezca en el Inbox.*hoy no lo vuelvo a intentar/);

  const bloqueado = llaveFalsa([{ status: 409, cuerpo: { error: "WhatsApp no está conectado en esta clínica." } }]);
  assert.match((await accionAvisarSaldo.ejecutar(bloqueado.llave as any, ctx, r.datos) as any).frase, /^No se mandó el aviso: WhatsApp no está conectado/);
});

test("aviso: borrador, sin teléfono, sin WhatsApp o sin plantilla fuera de ventana → no hay tarjeta, y se dice por qué", async () => {
  const db = baseDinero();
  assert.match((await accionAvisarSaldo.preparar(recepcion(db), { factura: "MF-0012" }) as any).frase, /borrador/);
  const sinTel = baseDinero((d) => { d.patients.find((p: any) => p.id === "p-juan").phone = null; });
  assert.match((await accionAvisarSaldo.preparar(recepcion(sinTel), { factura: "MF-0010" }) as any).frase, /no tiene teléfono/);
  const sinWa = baseDinero((d) => { d.clinics.find((c: any) => c.id === CL_A).waAccessToken = null; });
  assert.match((await accionAvisarSaldo.preparar(recepcion(sinWa), { factura: "MF-0010" }) as any).frase, /WhatsApp no está conectado/);
  const sinPlantilla = baseDinero((d) => { d.clinics.find((c: any) => c.id === CL_A).waTemplates = null; });
  ventana.ultimoMensajeDelPaciente = null;
  const r = await accionAvisarSaldo.preparar(recepcion(sinPlantilla), { factura: "MF-0010" });
  ventana.ultimoMensajeDelPaciente = new Date(Date.now() - 60 * 60_000);
  assert.equal(r.tipo, "no_se_puede");
  assert.match((r as any).frase, /falta configurar la plantilla/);
});

test("el handler del aviso arma el texto con buildPaymentNotice: la tarjeta y el mensaje no se pueden separar", () => {
  const ruta = readFileSync(path.join(RAIZ, "src/app/api/invoices/[id]/send-whatsapp/route.ts"), "utf8");
  assert.match(ruta, /buildPaymentNotice\(/);
  assert.ok(!ruta.includes("Tienes un saldo pendiente"), "el texto volvió a copiarse dentro del handler");
});

/* ══════════════════════════════════════════════════════════════════════
 * Lo que encontró la auditoría (revisor)
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 folio: lo tecleado tal cual gana; «P0042» (folio de paciente) no se convierte en MF-0042; dos posibles se preguntan", async () => {
  const db = baseDinero((d) => {
    const juan1 = d.invoices.find((i: any) => i.id === "inv-juan-1");
    d.invoices.push({ ...juan1, id: "inv-legado", invoiceNumber: "INV-2026-0010", patientId: "p-mg2", total: 333, balance: 333 });
    d.invoices.push({ ...juan1, id: "inv-mf-42", invoiceNumber: "MF-0042", patientId: "p-mg2", total: 4242, balance: 4242 });
  });
  const ctx = recepcion(db);
  // «INV-2026-0010» existe tal cual: es esa, no la MF-0010 de Juan.
  const legado = (await accionCobrarFactura.preparar(ctx, { factura: "INV-2026-0010", metodo: "cash" })) as any;
  assert.equal(legado.datos?.facturaId, "inv-legado");
  // «P0042» no nombra a la serie MF: no se inventa la MF-0042.
  assert.equal((await accionCobrarFactura.preparar(ctx, { factura: "P0042", metodo: "cash" })).tipo, "no_se_puede");
  // «42» sí es la MF-0042.
  assert.equal(((await accionCobrarFactura.preparar(ctx, { factura: "42", metodo: "cash" })) as any).datos?.facturaId, "inv-mf-42");
  // Un presupuesto: «P0001» es un paciente, «p-1» el presupuesto.
  assert.equal((await accionCrearFactura.preparar(ctx, { presupuesto: "P0001" })).tipo, "no_se_puede");
});

test("🔴 folio y paciente que no cuadran: no se cobra a quien no se nombró", async () => {
  const db = baseDinero();
  const r = await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0010", paciente: "María García", metodo: "cash" });
  assert.equal(r.tipo, "no_se_puede");
  assert.match((r as any).frase, /La factura MF-0010 es de Juan Pérez \(P0003\), no de «María García»/);
  assert.equal((await accionCobrarFactura.preparar(recepcion(db), { factura: "MF-0010", paciente: "Juan", metodo: "cash" })).tipo, "propuesta");
});

test("con paciente, el estado va en la consulta: 70 facturas pagadas recientes no esconden la cobrable vieja", async () => {
  const db = baseDinero((d) => {
    for (let i = 0; i < 70; i++) {
      d.invoices.push({
        id: `inv-pagada-${i}`, clinicId: CL_A, patientId: "p-mg2", invoiceNumber: `MF-${1000 + i}`, status: "PAID",
        subtotal: 10, total: 10, paid: 10, balance: 0, discount: 0, taxRate: 0, taxIncluded: true, cfdiUuid: null, dueDate: null,
        items: [], createdAt: new Date(), updatedAt: new Date(),
      });
    }
    d.invoices.find((i: any) => i.id === "inv-mg2-timbrada").createdAt = new Date("2020-01-01");
  });
  const r = (await accionCobrarFactura.preparar(recepcion(db), { paciente: "P0002", metodo: "cash" })) as any;
  assert.equal(r.tipo, "propuesta", JSON.stringify(r));
  assert.equal(r.datos.folio, "MF-0015");
});

test("🔴 sin billing.view no se enseña ni un folio, aunque tenga la key de cobrar o de mandar WhatsApp", async () => {
  const db = baseDinero();
  const soloCobrar = conKeys(db, ["billing.charge", "billing.create", "whatsapp.send"]);
  for (const [accion, params] of [
    [accionCobrarFactura, { factura: "MF-0010", metodo: "cash" }],
    [accionAvisarSaldo, { factura: "MF-0010" }],
    [accionCrearFactura, { presupuesto: "P-0001" }],
  ] as const) {
    const r = await (accion as any).preparar(soloCobrar, params);
    assert.equal(r.tipo, "sin_permiso", accion.nombre);
    assert.ok(!JSON.stringify(r).includes("MF-0010"));
  }
  assert.equal(db.espia.llamadas.length, 0);
});

test("una tabla que la pantalla recortaría (más de 40 filas) no se propone; un presupuesto así se manda a la pantalla", async () => {
  const db = baseDinero((d) => {
    for (let i = 0; i < 45; i++) d.quoteItems.push({ id: `qi-x${i}`, quoteId: "q-juan", name: `Pieza ${i}`, toothFdi: null, quantity: 1, unitPrice: 10, discount: 0, sortOrder: 10 + i });
  });
  const r = await accionCrearFactura.preparar(recepcion(db), { presupuesto: "P-0001" });
  assert.equal(r.tipo, "no_se_puede");
  assert.match((r as any).frase, /tiene 47 conceptos/);

  const larga = definirAccion<any, any>({
    ...accionCrearFactura,
    nombre: "larga",
    preparar: async () => ({
      tipo: "propuesta",
      datos: { tipo: "presupuesto", quoteId: "q", presupuesto: "P", patientId: "p", paciente: "x", total: 1 },
      tarjeta: { frase: "x", detalles: [], avisos: [], tabla: { columnas: [{ titulo: "A" }], filas: Array.from({ length: 41 }, (_, i) => [String(i)]) } },
    }),
    huella: async () => "h",
  });
  const mal = await correrHerramienta(herramientaDeAccion(larga), recepcion(db), {});
  assert.match((mal as any).detalle, /tabla_de_tarjeta_invalida/);
});

test("🔴 crear factura: un 400 que llega DESPUÉS del INSERT no se da por «no se creó»; se busca antes", async () => {
  const db = baseDinero();
  const ctx = recepcion(db);
  const r = (await accionCrearFactura.preparar(ctx, { paciente: "Juan Pérez", conceptos: [{ concepto: "Limpieza", precio: 800 }] })) as any;
  const f = llaveFalsa([() => {
    db.filas.invoices.push({ id: "inv-fantasma", clinicId: CL_A, patientId: "p-juan", invoiceNumber: "MF-0016", status: "PENDING", total: 800, paid: 0, balance: 800, items: r.datos.cuerpo.items, createdAt: new Date(), updatedAt: new Date() });
    return { status: 400, cuerpo: { error: "Connection terminated unexpectedly" } };
  }]);
  const ej = await accionCrearFactura.ejecutar(f.llave as any, ctx, r.datos);
  assert.equal(ej.ok, true);
  assert.match((ej as any).frase, /revisé: la factura MF-0016 de Juan Pérez por \$800\.00 SÍ se creó\. No la repitas/);

  const db2 = baseDinero();
  const r2 = (await accionCrearFactura.preparar(recepcion(db2), { paciente: "Juan Pérez", conceptos: [{ concepto: "Limpieza", precio: 800 }] })) as any;
  // Otra factura del mismo paciente y el mismo total, con OTROS conceptos, no es la nuestra.
  const ajena = llaveFalsa([() => {
    db2.filas.invoices.push({ id: "inv-ajena", clinicId: CL_A, patientId: "p-juan", invoiceNumber: "MF-0017", status: "PENDING", total: 800, paid: 0, balance: 800, items: [{ description: "Resina", quantity: 1, unitPrice: 800, total: 800 }], createdAt: new Date(), updatedAt: new Date() });
    return { status: 500, cuerpo: null };
  }]);
  const noEsLaNuestra = await accionCrearFactura.ejecutar(ajena.llave as any, recepcion(db2), r2.datos);
  assert.equal(noEsLaNuestra.ok, false);
  assert.match((noEsLaNuestra as any).frase, /no se creó/);

  const g = llaveFalsa([{ status: 400, cuerpo: { error: "El descuento excede el subtotal" } }]);
  assert.deepEqual(await accionCrearFactura.ejecutar(g.llave as any, recepcion(db2), r2.datos), {
    ok: false, tipo: "invalido", frase: "No se creó la factura: El descuento excede el subtotal.",
  });
});
