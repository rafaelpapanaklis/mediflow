/**
 * Sabina consulta FACTURAS y PRESUPUESTOS (ws1-t9): `facturas_de_paciente` (con
 * concepto, CFDI y el detalle de una factura por folio) y `presupuestos`.
 *
 *   npm run test:sabina-consultas-t9-dinero
 *
 * Lo que se prueba, y por qué:
 *  1. LAS CIFRAS SON LAS DE LA PANTALLA. Factura: saldo = total − pagado y
 *     conceptos con `itemLineTotal` (lo mismo que Facturación). Presupuesto: el
 *     total guardado y la MISMA regla de vencimiento que `GET /api/quotes`
 *     (se compara contra el texto de la ruta).
 *  2. 🔴 NO ESCRIBEN: la base es un espía que lanza ante cualquier escritura.
 *  3. 🔴 PERMISOS: sin `billing.view`, `sin_permiso` y ni una consulta; el
 *     paciente restringido no sale para quien no lo ve; el archivado por ARCO
 *     tampoco.
 *  4. 🔴 OTRA CLÍNICA → NADA: la vecina tiene el mismo folio MF-0010 / P-0001.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { itemLineTotal, round2 } from "@/lib/invoice-totals";
import { correrHerramienta } from "../base";
import { sumarDias } from "../fechas";
import { facturasDePaciente, type DatosFacturas } from "../../dinero/facturas-de-paciente";
import { presupuestos, estadoEfectivo, type DatosPresupuestos } from "../presupuestos";
import { CL_A, CL_B, HOY, admin, adminVecina, baseDinero, conKeys, drSalas, recepcion, type BaseDinero } from "../../dinero/__tests__/dinero-siembra";
import { en } from "./agenda-siembra";

const RAIZ = process.cwd();

/** Los presupuestos de la siembra, con lo que la base de verdad guarda de más: subtotal, vigencia y `lineTotal`. */
function conPresupuestos(f: BaseDinero["filas"]) {
  for (const it of f.quoteItems) it.lineTotal = round2(it.quantity * it.unitPrice - (it.discount ?? 0));
  const ayer = en(sumarDias(HOY, -1), "09:00");
  const q = (over: Record<string, any>) => ({ invoiceId: null, discountAmount: 0, subtotal: over.total, validUntil: null, presentedAt: null, acceptedAt: null, rejectedAt: null, createdAt: ayer, updatedAt: ayer, ...over });
  f.quotes.push(
    // Presentado y VIGENTE; presentado con la vigencia PASADA (la base lo guarda PRESENTED hasta que alguien abre la ficha); borrador; rechazado.
    q({ id: "q-vigente", clinicId: CL_A, patientId: "p-mg1", folio: "P-0010", title: "Blanqueamiento", status: "PRESENTED", total: 4000, validUntil: en(sumarDias(HOY, 20), "09:00") }),
    q({ id: "q-pasado", clinicId: CL_A, patientId: "p-mg2", folio: "P-0011", title: "Carillas", status: "PRESENTED", total: 20000, validUntil: en(sumarDias(HOY, -5), "09:00") }),
    q({ id: "q-borrador", clinicId: CL_A, patientId: "p-juan", folio: "P-0012", title: "Limpieza profunda", status: "DRAFT", total: 1500 }),
    q({ id: "q-rechazado", clinicId: CL_A, patientId: "p-juan", folio: "P-0013", title: "Implante", status: "REJECTED", total: 25000, rejectedAt: ayer }),
    // lo que NO debe salir: restringida (presentada), archivada por ARCO, y la de la vecina.
    q({ id: "q-restr-pres", clinicId: CL_A, patientId: "p-restr", folio: "P-0014", title: "RESTRINGIDO", status: "PRESENTED", total: 66666, validUntil: en(sumarDias(HOY, 9), "09:00") }),
    q({ id: "q-borrada", clinicId: CL_A, patientId: "p-borrada", folio: "P-0015", title: "ARCHIVADO", status: "PRESENTED", total: 77777, validUntil: en(sumarDias(HOY, 9), "09:00") }),
    q({ id: "q-vecina-pres", clinicId: CL_B, patientId: "p-mg-vecina", folio: "P-0099", title: "VECINA ABIERTO", status: "PRESENTED", total: 55555, validUntil: en(sumarDias(HOY, 9), "09:00") }),
  );
  f.quotes.find((x) => x.id === "q-juan")!.subtotal = 3000;
}

const datos = <T>(r: any): T => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.datos as T;
};

/* ══════════════════════════════════════════════════════════════════════
 * FACTURAS
 * ══════════════════════════════════════════════════════════════════════ */

test("facturas: la lista trae folio, fecha, concepto, total, pagado, saldo, estado y CFDI", async () => {
  const db = baseDinero();
  const r = await correrHerramienta(facturasDePaciente, recepcion(db), { paciente: "Juan Pérez" });
  const d = datos<Extract<DatosFacturas, { estado: "ok" }>>(r);
  assert.equal(d.porFolio, false);
  const porFolio = Object.fromEntries(d.facturas.filas.map((f) => [f.folio, f]));
  assert.deepEqual(Object.keys(porFolio).sort(), ["MF-0009", "MF-0010", "MF-0011"]);

  const a = porFolio["MF-0010"];
  assert.equal(a.concepto, "Limpieza dental");
  assert.equal(a.total, 1200);
  assert.equal(a.pagado, 0);
  assert.equal(a.saldo, 1200);
  assert.equal(a.estado, "pendiente");
  assert.equal(a.timbrada, false);
  assert.match(a.fecha, /^\d{4}-\d{2}-\d{2}$/);

  const b = porFolio["MF-0011"];
  assert.equal(b.concepto, "Resina");
  assert.equal(b.saldo, 2000, "saldo = total − pagado");
  assert.equal(b.estado, "parcial");
  assert.equal(porFolio["MF-0009"].saldo, 0, "una cancelada no se debe");

  // El resumen que lee el modelo trae esas mismas cifras, una por línea, con CFDI sí/no y el enlace.
  assert.match(r.ok ? r.resumen : "", /MF-0010 — .*Limpieza dental: total \$1,200\.00, pagado \$0\.00, saldo \$1,200\.00, pendiente, sin CFDI/);
  assert.match(r.ok ? r.resumen : "", /\[Facturación\]\(\/dashboard\/billing\)/);
});

test("facturas: una factura timbrada dice «con CFDI»", async () => {
  const db = baseDinero();
  const r = await correrHerramienta(facturasDePaciente, recepcion(db), { factura: "MF-0015" });
  const d = datos<Extract<DatosFacturas, { estado: "ok" }>>(r);
  assert.equal(d.facturas.filas[0].timbrada, true);
  assert.match(r.ok ? r.resumen : "", /Tiene CFDI timbrado/);
});

test("facturas: UNA por folio trae sus conceptos, sus pagos y su estado, con las cuentas del panel", async () => {
  const db = baseDinero();
  const r = await correrHerramienta(facturasDePaciente, recepcion(db), { factura: "MF-0011" });
  const d = datos<Extract<DatosFacturas, { estado: "ok" }>>(r);
  assert.equal(d.porFolio, true);
  assert.equal(d.facturas.filas.length, 1);
  const f = d.facturas.filas[0];
  const crudo = db.filas.invoices.find((i) => i.id === "inv-juan-2")!;
  assert.deepEqual(f.conceptos, [{ descripcion: "Resina", cantidad: 2, precio: 1500, total: itemLineTotal(crudo.items[0]) }]);
  assert.deepEqual(f.pagos.map((p) => [p.monto, p.metodo]), [[1000, "Tarjeta crédito"]]);
  assert.equal(f.saldo, round2(crudo.total - crudo.paid));
  const t = r.ok ? r.resumen : "";
  assert.match(t, /Factura MF-0011 de Juan Pérez \(P0003\): parcial/);
  assert.match(t, /Total \$3,000\.00, pagado \$1,000\.00, saldo \$2,000\.00/);
  assert.match(t, /Sin CFDI/);
  assert.match(t, /Concepto: Resina \(2 × \$1,500\.00\)/, "un solo concepto va en la frase, no en lista");
  assert.match(t, /Pago: .*\$1,000\.00 \(Tarjeta crédito\)/);
});

test("🔴 facturas: otra clínica → nada (mismo folio MF-0010) y cada consulta lleva el clinicId de la sesión", async () => {
  const db = baseDinero();
  const suya = await correrHerramienta(facturasDePaciente, admin(db), { factura: "MF-0010" });
  const a = datos<Extract<DatosFacturas, { estado: "ok" }>>(suya);
  assert.equal(a.facturas.filas[0].total, 1200);
  assert.ok(!JSON.stringify(a).includes("VECINA"));

  const dbB = baseDinero();
  const vecina = await correrHerramienta(facturasDePaciente, adminVecina(dbB), { factura: "MF-0010" });
  assert.equal(datos<Extract<DatosFacturas, { estado: "ok" }>>(vecina).facturas.filas[0].total, 99999);
  const aJuan = await correrHerramienta(facturasDePaciente, adminVecina(dbB), { paciente: "Juan Pérez" });
  assert.ok(!JSON.stringify(aJuan).includes("Limpieza dental"), "la vecina no ve a Juan");
  for (const l of dbB.espia.llamadas) {
    if (l.op === "$queryRaw") continue;
    assert.ok(!JSON.stringify(l.args ?? {}).includes(`"${CL_A}"`), `${l.op} mencionó la otra clínica`);
  }
});

test("🔴 facturas: sin billing.view → sin_permiso, y ni una consulta", async () => {
  const db = baseDinero();
  const r = await correrHerramienta(facturasDePaciente, conKeys(db, ["agenda.view"]), { paciente: "Juan" });
  assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: "billing.view" });
  assert.equal(db.espia.llamadas.length, 0);
});

test("🔴 facturas: la factura de la paciente restringida no sale para quien no la ve, y no escribe nada", async () => {
  const db = baseDinero();
  const r = await correrHerramienta(facturasDePaciente, drSalas(db), { factura: "MF-0014" });
  assert.equal((r as any).ok, true);
  assert.equal((r as any).datos.estado, "no_encontrado");
  assert.ok(!JSON.stringify(r).includes("RESTRINGIDO"));
  assert.deepEqual(db.espia.escrituras, []);
});

/* ══════════════════════════════════════════════════════════════════════
 * PRESUPUESTOS
 * ══════════════════════════════════════════════════════════════════════ */

test("presupuestos: los de un paciente, con estado, total y conceptos de la pantalla", async () => {
  const db = baseDinero(conPresupuestos);
  const r = await correrHerramienta(presupuestos, recepcion(db), { paciente: "Juan Pérez" });
  const d = datos<Extract<DatosPresupuestos, { tipo: "paciente" }>>(r);
  const por = Object.fromEntries(d.presupuestos.filas.map((f) => [f.folio, f]));
  assert.deepEqual(Object.keys(por).sort(), ["P-0001", "P-0003", "P-0012", "P-0013"]);
  assert.equal(por["P-0001"].estado, "aceptado");
  assert.equal(por["P-0001"].total, 2900);
  assert.equal(por["P-0001"].conceptos, "Resina y 1 más", "el primero por sortOrder");
  assert.equal(por["P-0003"].estado, "presentado");
  assert.equal(por["P-0012"].estado, "borrador");
  assert.equal(por["P-0013"].estado, "rechazado");
  assert.equal(d.vivos, 30000 + 1500, "borrador + presentado vigente");
  assert.equal(d.aceptados, 2900);
  const t = r.ok ? r.resumen : "";
  assert.match(t, /- P-0003 — [^\n]*\$30,000\.00, presentado\n/);
  assert.match(t, /\[la pestaña Presupuestos\]\(\/dashboard\/patients\/p-juan\?tab=presupuestos\)/);
});

test("presupuestos: UNO por folio trae conceptos con su precio y descuento, y las fechas", async () => {
  const db = baseDinero(conPresupuestos);
  const r = await correrHerramienta(presupuestos, recepcion(db), { presupuesto: "P-0001" });
  const d = datos<Extract<DatosPresupuestos, { tipo: "paciente" }>>(r);
  assert.equal(d.porFolio, true);
  const x = d.presupuestos.filas[0].detalle!;
  assert.deepEqual(x.items.map((i) => [i.descripcion, i.cantidad, i.precio, i.total]), [["Resina", 2, 250, 500], ["Corona", 1, 2500, 2500]]);
  assert.equal(x.subtotal, 3000);
  assert.equal(x.descuento, 100);
  const t = r.ok ? r.resumen : "";
  assert.match(t, /Presupuesto P-0001 de Juan Pérez \(P0003\) «Rehabilitación»: aceptado/);
  assert.match(t, /Total \$2,900\.00 \(subtotal \$3,000\.00, descuento \$100\.00\)/);
  assert.match(t, /Corona \(diente 16\) — 1 × \$2,500\.00 = \$2,500\.00/);
  // «p-1» y «1» nombran el mismo folio (misma ayuda que cobrar y facturar).
  for (const dicho of ["p-1", "P 1", "1"]) {
    const o = await correrHerramienta(presupuestos, recepcion(db), { presupuesto: dicho });
    assert.equal(datos<Extract<DatosPresupuestos, { tipo: "paciente" }>>(o).presupuestos.filas[0].folio, "P-0001", dicho);
  }
});

test("presupuestos: un presentado con la vigencia pasada sale «vencido», con la regla de GET /api/quotes", async () => {
  const db = baseDinero(conPresupuestos);
  const r = await correrHerramienta(presupuestos, recepcion(db), { presupuesto: "P-0011" });
  assert.equal(datos<Extract<DatosPresupuestos, { tipo: "paciente" }>>(r).presupuestos.filas[0].estado, "vencido");
  const vigente = await correrHerramienta(presupuestos, recepcion(db), { presupuesto: "P-0010" });
  assert.equal(datos<Extract<DatosPresupuestos, { tipo: "paciente" }>>(vigente).presupuestos.filas[0].estado, "presentado");

  // La regla es la de la ruta del panel, no una parecida.
  const ruta = readFileSync(path.join(RAIZ, "src/app/api/quotes/route.ts"), "utf8");
  // (revisión final de ws1-t2: las dos usan `estaVencida`, el día de vigencia completo en la zona de la clínica)
  assert.match(ruta, /estaVencida\(q\.validUntil, zona\)/);
  assert.match(ruta, /data: \{ status: "EXPIRED" \}/);
  const ahora = new Date("2026-10-01T12:00:00Z");
  assert.equal(estadoEfectivo("PRESENTED", new Date("2026-09-30T12:00:00Z"), ahora), "EXPIRED");
  assert.equal(estadoEfectivo("PRESENTED", new Date("2026-10-02T12:00:00Z"), ahora), "PRESENTED");
  assert.equal(estadoEfectivo("PRESENTED", null, ahora), "PRESENTED");
  assert.equal(estadoEfectivo("ACCEPTED", new Date("2020-01-01T00:00:00Z"), ahora), "ACCEPTED", "un aceptado no vence");
});

test("presupuestos: el resumen de abiertos de la clínica, con el dinero separado y sin lo ajeno", async () => {
  const db = baseDinero(conPresupuestos);
  const r = await correrHerramienta(presupuestos, admin(db), { abiertos: true });
  const d = datos<Extract<DatosPresupuestos, { tipo: "abiertos" }>>(r);
  // esperando: P-0003 ($30,000), P-0010 ($4,000) y el de la restringida ($66,666: la administradora sí la ve); borrador: P-0012; vencido: P-0011.
  assert.deepEqual(d.esperando, { cantidad: 3, total: 100666 });
  assert.deepEqual(d.borradores, { cantidad: 1, total: 1500 });
  assert.deepEqual(d.vencidos, { cantidad: 1, total: 20000 });
  assert.ok(!JSON.stringify(d).includes("VECINA"), "la vecina no entra");
  assert.ok(!JSON.stringify(d).includes("ARCHIVADO"), "el archivado por ARCO no entra");
  assert.ok(!JSON.stringify(d).includes("ACCEPTED") && !d.filas.filas.some((f) => f.folio === "P-0001"), "un aceptado no está abierto");
  const t = r.ok ? r.resumen : "";
  assert.match(t, /NO es venta/);
  // Sin parámetros, es lo mismo.
  const sin = await correrHerramienta(presupuestos, admin(db), {});
  assert.equal(datos<Extract<DatosPresupuestos, { tipo: "abiertos" }>>(sin).esperando.total, 100666);
});

test("🔴 presupuestos: el restringido no sale para quien no lo ve (ni en lista, ni por folio, ni en el resumen)", async () => {
  const db = baseDinero(conPresupuestos);
  const resumen = await correrHerramienta(presupuestos, drSalas(db), { abiertos: true });
  assert.ok(!JSON.stringify(resumen).includes("RESTRINGIDO"));
  assert.ok(!JSON.stringify(resumen).includes("66666"));
  const folio = await correrHerramienta(presupuestos, drSalas(db), { presupuesto: "P-0014" });
  assert.equal((folio as any).datos.tipo, "no_encontrado");
  const rec = await correrHerramienta(presupuestos, recepcion(db), { paciente: "Renata" });
  assert.ok(!JSON.stringify(rec).includes("RESTRINGIDO"));
});

test("🔴 presupuestos: otra clínica → nada (mismo folio P-0001) y cada consulta lleva su clinicId", async () => {
  const db = baseDinero(conPresupuestos);
  const suya = await correrHerramienta(presupuestos, admin(db), { presupuesto: "P-0001" });
  assert.equal(datos<Extract<DatosPresupuestos, { tipo: "paciente" }>>(suya).presupuestos.filas[0].titulo, "Rehabilitación");
  const dbB = baseDinero(conPresupuestos);
  const vecina = await correrHerramienta(presupuestos, adminVecina(dbB), { presupuesto: "P-0001" });
  const d = datos<Extract<DatosPresupuestos, { tipo: "paciente" }>>(vecina);
  assert.equal(d.presupuestos.filas[0].titulo, "DE LA VECINA");
  assert.equal(d.presupuestos.filas[0].total, 88888);
  const abiertosVecina = await correrHerramienta(presupuestos, adminVecina(dbB), { abiertos: true });
  const e = datos<Extract<DatosPresupuestos, { tipo: "abiertos" }>>(abiertosVecina);
  assert.deepEqual(e.esperando, { cantidad: 1, total: 55555 });
  for (const l of dbB.espia.llamadas) {
    if (l.op === "$queryRaw") continue;
    assert.ok(!JSON.stringify(l.args ?? {}).includes(`"${CL_A}"`), `${l.op} mencionó la otra clínica`);
  }
  // Y la sesión sin clínica no consulta nada.
  const roto = await correrHerramienta(presupuestos, { ...admin(db), clinicId: undefined as any }, { abiertos: true });
  assert.equal((roto as any).motivo, "error");
});

test("🔴 presupuestos: sin billing.view → sin_permiso y ni una consulta; y no escribe nada", async () => {
  const db = baseDinero(conPresupuestos);
  const r = await correrHerramienta(presupuestos, conKeys(db, ["agenda.view"]), { abiertos: true });
  assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: "billing.view" });
  assert.equal(db.espia.llamadas.length, 0);

  const ok = baseDinero(conPresupuestos);
  for (const p of [{ paciente: "Juan Pérez" }, { presupuesto: "P-0001" }, { abiertos: true }]) {
    await correrHerramienta(presupuestos, admin(ok), p);
    await correrHerramienta(facturasDePaciente, admin(ok), { paciente: "Juan Pérez", ...p });
  }
  assert.deepEqual(ok.espia.escrituras, []);
});

test("presupuestos: dos «María García» se preguntan, no se elige", async () => {
  const db = baseDinero(conPresupuestos);
  const r = await correrHerramienta(presupuestos, recepcion(db), { paciente: "María García" });
  assert.equal((r as any).datos.tipo, "falta_aclarar");
  assert.match((r as any).resumen, /NO elijas tú/);
});

test("el código de las dos solo lee", () => {
  for (const f of ["src/lib/sabina/tools/presupuestos.ts", "src/lib/sabina/dinero/facturas-de-paciente.ts"]) {
    const src = readFileSync(path.join(RAIZ, f), "utf8");
    assert.doesNotMatch(src, /\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\(|\$executeRaw|\$transaction|fetch\(/, f);
  }
});
