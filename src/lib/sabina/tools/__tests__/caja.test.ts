/**
 * `caja` — la herramienta de Caja de Sabina. SOLO LEE.
 *
 * Run: npm run test:sabina-caja
 *
 * Lo que se demuestra, en el orden en que importa:
 *
 *  1. 🔴 El candado es la BANDERA, no la key (hallazgo 23). Un ADMIN con
 *     `billing.view` y sin `canAccessCaja` recibe `sin_permiso` —no una caja,
 *     no una lista vacía—, y sin que se lea una sola fila de caja. El criterio
 *     es `canUseCaja`, el de la pantalla, y la bandera se busca en la fila de
 *     ESTA clínica.
 *  2. 🔴 NORTE no ve nada del SUR y al revés, en las tres vistas.
 *  3. Los números son los de la pantalla: `getCajaState` (lo que pinta Caja)
 *     contra la herramienta, sobre la misma base.
 *  4. El esperado viaja siempre con «no es dinero contado», y el corte manda a
 *     Caja a contar y cerrar con PIN.
 *  5. Pacientes restringidos enmascarados como en Facturas, sin descuadrar
 *     totales; y como mucho 50 cobros con el total real.
 *  6. «Sin cortar» con la regla de la pantalla (18 h o cambio de día natural en
 *     la zona de la clínica).
 *  7. Por el motor de verdad: si el modelo contesta «en caja hay $X» sin decir
 *     que es un cálculo, el motor lo añade; y sin la bandera el doctor lee «No
 *     tienes acceso a Caja» aunque el modelo se calle.
 */

import "../../engine-sin-server-only"; // PRIMERO: la sección 7 carga el motor, que arrastra "server-only"
import { pantalla } from "./preparar-caja";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canUseCaja } from "@/lib/caja-pin";
import { getCajaHistory, getCajaState } from "@/lib/caja";
import { STALE_SHIFT_HOURS, dayKeyIn, staleShiftOf } from "@/lib/caja-turno";
import { fraseSinPermiso } from "../../engine-core";
import { correrHerramienta } from "../base";
import {
  AVISO_ESPERADO,
  AVISO_ESPERADO_RESPUESTA,
  COMO_CERRAR,
  caja,
  type DatosCajaHistorial,
  type DatosCajaTurno,
} from "../caja";
import { CANDADO_CAJA, candadoCaja } from "../candado-caja";
import { crearBase, type BaseDoble, type Datos, type Fila } from "./doble-base";
import type { SabinaCtx } from "../../tipos";

/* ══════════════════════════════════════════════════════════════════════
 * Siembra: dos clínicas, cada una con su caja abierta y sus cortes
 * ══════════════════════════════════════════════════════════════════════ */

const CL_N = "cl-norte";
const CL_S = "cl-sur";
const TZ_N = "America/Mexico_City";
const TZ_S = "America/Cancun";

const U_ADMIN = "u-admin-n"; // ADMIN con bandera
const U_ADMIN_SIN = "u-admin2-n"; // ADMIN SIN bandera: el caso del hallazgo 23
const U_DOC = "u-doc-n"; // DOCTOR con bandera, no ve a la paciente restringida
const U_RECEP = "u-recep-n"; // RECEPCIÓN con bandera: abrió la caja
const U_LECTOR = "u-lector-n"; // READONLY sin bandera
const U_SUPER = "u-super-n"; // SUPER_ADMIN sin bandera: canUseCaja lo deja pasar siempre
const U_BAJA = "u-baja-n"; // con bandera pero dado de baja
const U_ADMIN_S = "u-admin-s";

const AHORA = Date.now();
const hace = (horas: number) => new Date(AHORA - horas * 3_600_000);

function siembra(over: Partial<Datos> = {}): Datos {
  const users: Fila[] = [
    { id: U_ADMIN, clinicId: CL_N, role: "ADMIN", firstName: "Rita", lastName: "Admin", isActive: true, canAccessCaja: true },
    { id: U_ADMIN_SIN, clinicId: CL_N, role: "ADMIN", firstName: "Omar", lastName: "Admin", isActive: true, canAccessCaja: false },
    { id: U_DOC, clinicId: CL_N, role: "DOCTOR", firstName: "Hugo", lastName: "Salas", isActive: true, canAccessCaja: true },
    { id: U_RECEP, clinicId: CL_N, role: "RECEPTIONIST", firstName: "Lupe", lastName: "Mesa", isActive: true, canAccessCaja: true },
    { id: U_LECTOR, clinicId: CL_N, role: "READONLY", firstName: "Leo", lastName: "Lector", isActive: true, canAccessCaja: false },
    { id: U_SUPER, clinicId: CL_N, role: "SUPER_ADMIN", firstName: "Dueño", lastName: "Norte", isActive: true, canAccessCaja: false },
    { id: U_BAJA, clinicId: CL_N, role: "RECEPTIONIST", firstName: "Ex", lastName: "Empleada", isActive: false, canAccessCaja: true },
    { id: U_ADMIN_S, clinicId: CL_S, role: "ADMIN", firstName: "Sara", lastName: "SUR", isActive: true, canAccessCaja: true },
  ];
  const patients: Fila[] = [
    { id: "p-ana", clinicId: CL_N, firstName: "Ana", lastName: "Perez", visibleUserIds: [] },
    { id: "p-rosa", clinicId: CL_N, firstName: "Rosa", lastName: "Restringida", visibleUserIds: [U_ADMIN] },
    { id: "p-sur", clinicId: CL_S, firstName: "Paciente", lastName: "SUR", visibleUserIds: [] },
  ];
  const factura = (id: string, clinicId: string, patientId: string, total: number, concepto: string): Fila => ({
    id, clinicId, patientId, total, discount: 0, taxRate: 0, taxIncluded: true, status: "PAID",
    items: [{ description: concepto }], createdAt: hace(40), balance: 0, doctorId: null,
  });
  const invoices: Fila[] = [
    factura("inv-n1", CL_N, "p-ana", 7000, "Limpieza"),
    factura("inv-n2", CL_N, "p-rosa", 1500, "Endodoncia"),
    factura("inv-s1", CL_S, "p-sur", 99999, "TRATAMIENTO DEL SUR"),
  ];
  const payments: Fila[] = [
    // Turno abierto del norte: abrió hace 20 h.
    { id: "pay-n1", invoiceId: "inv-n1", amount: 800, method: "cash", paidAt: hace(19) },
    { id: "pay-n2", invoiceId: "inv-n1", amount: 1200, method: "debit", paidAt: hace(15) },
    { id: "pay-n3", invoiceId: "inv-n2", amount: 900, method: "credit", paidAt: hace(10) },
    { id: "pay-n4", invoiceId: "inv-n2", amount: 600, method: "cash", paidAt: hace(2) },
    // ANTES de abrir: no es de este turno.
    { id: "pay-n-antes", invoiceId: "inv-n1", amount: 5000, method: "cash", paidAt: hace(30) },
    // Turno del sur.
    { id: "pay-s1", invoiceId: "inv-s1", amount: 99999, method: "cash", paidAt: hace(1) },
  ];
  const cashRegisters: Fila[] = [
    { id: "caja-n", clinicId: CL_N, operatorId: U_RECEP, openedAt: hace(20), openingBalance: 1000, status: "OPEN", closedAt: null },
    {
      id: "corte-n-1", clinicId: CL_N, operatorId: U_ADMIN, openedAt: hace(48), closedAt: hace(36), openingBalance: 500,
      status: "CLOSED", countedClosingBalance: 5300, closingNotes: "Faltó cambio", snapshotExpectedCash: 5500, snapshotVariance: -200,
    },
    {
      id: "corte-n-2", clinicId: CL_N, operatorId: U_ADMIN, openedAt: hace(72), closedAt: hace(60), openingBalance: 500,
      status: "CLOSED", countedClosingBalance: 4100, closingNotes: null, snapshotExpectedCash: 4100, snapshotVariance: 0,
    },
    { id: "caja-s", clinicId: CL_S, operatorId: U_ADMIN_S, openedAt: hace(3), openingBalance: 77777, status: "OPEN", closedAt: null },
    {
      id: "corte-s-1", clinicId: CL_S, operatorId: U_ADMIN_S, openedAt: hace(30), closedAt: hace(26), openingBalance: 77777,
      status: "CLOSED", countedClosingBalance: 88888, closingNotes: "CORTE DEL SUR", snapshotExpectedCash: 88888, snapshotVariance: 0,
    },
  ];
  const cashWithdrawals: Fila[] = [
    { id: "ret-n1", cashRegisterId: "caja-n", amount: 300, reason: "Proveedor de guantes", recordedBy: U_RECEP, recordedAt: hace(10) },
    { id: "ret-n2", cashRegisterId: "caja-n", amount: 200, reason: "Garrafón", recordedBy: U_ADMIN, recordedAt: hace(5) },
    { id: "ret-s1", cashRegisterId: "caja-s", amount: 12345, reason: "RETIRO DEL SUR", recordedBy: U_ADMIN_S, recordedAt: hace(2) },
  ];
  const clinics: Fila[] = [
    { id: CL_N, timezone: TZ_N, cfdiTaxMode: "exempt" },
    { id: CL_S, timezone: TZ_S, cfdiTaxMode: "exempt" },
  ];
  return { clinics, users, patients, invoices, payments, cashRegisters, cashWithdrawals, ...over };
}

function sesion(db: BaseDoble, over: Partial<SabinaCtx> = {}): SabinaCtx {
  return { clinicId: CL_N, userId: U_ADMIN, role: "ADMIN", permissionsOverride: [], timezone: TZ_N, db, ...over };
}

const MARCAS_SUR = ["SUR", "77777", "99999", "12345", "88888"];
const MARCAS_NORTE = ["Perez", "Restringida", "guantes", "Garraf", "Faltó cambio", "Rita", "Lupe"];

/** Lecturas de caja/cobros/facturas que hizo el doble (la del usuario no cuenta). */
function lecturasDeCaja(db: BaseDoble): string[] {
  return db.contador.llamadas.filter((l) => l.modelo !== "user").map((l) => `${l.modelo}.${l.op}`);
}

async function correr(ctx: SabinaCtx, params: unknown = {}) {
  return correrHerramienta(caja, ctx, params);
}

/* ══════════════════════════════════════════════════════════════════════
 * 1 · 🔴 El candado es la bandera (hallazgo 23)
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 hallazgo 23: un ADMIN con billing.view y SIN la bandera recibe sin_permiso, no la caja", async () => {
  const db = crearBase(siembra());
  const r = await correr(sesion(db, { userId: U_ADMIN_SIN }), { vista: "corte" });

  assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: CANDADO_CAJA });
  assert.deepEqual(lecturasDeCaja(db), [], "sin la bandera no se lee ni una fila de caja, cobros ni facturas");
  // Y la frase que el motor le obliga a decir es la de Caja, no «facturación».
  assert.equal(fraseSinPermiso(CANDADO_CAJA), "No tienes acceso a Caja, eso no te lo puedo contestar.");
});

test("🔴 READONLY sin bandera tampoco, aunque billing.view le venga por defecto", async () => {
  const db = crearBase(siembra());
  for (const vista of ["turno", "corte", "historial"]) {
    const r = await correr(sesion(db, { userId: U_LECTOR, role: "READONLY" }), { vista });
    assert.equal((r as any).motivo, "sin_permiso", vista);
    assert.equal((r as any).permiso, CANDADO_CAJA, vista);
  }
  assert.deepEqual(lecturasDeCaja(db), []);
});

test("el candado decide EXACTAMENTE lo mismo que canUseCaja de la pantalla, usuario por usuario", async () => {
  const datos = siembra();
  const db = crearBase(datos);
  for (const u of datos.users!.filter((x) => x.clinicId === CL_N)) {
    const abre = await candadoCaja.abre(sesion(db, { userId: u.id, role: u.role }));
    // La pantalla pide un usuario ACTIVO (getCurrentUser/getAuthContext); uno de
    // baja ni siquiera llega a Caja.
    const pantallaDeja = u.isActive === true && canUseCaja(u);
    assert.equal(abre, pantallaDeja, `${u.id} (${u.role}, bandera ${u.canAccessCaja})`);
  }
});

test("SUPER_ADMIN sin bandera sí entra, como en la pantalla; recepción con bandera también", async () => {
  const db = crearBase(siembra());
  assert.equal((await correr(sesion(db, { userId: U_SUPER, role: "SUPER_ADMIN" }))).ok, true);
  assert.equal((await correr(sesion(db, { userId: U_RECEP, role: "RECEPTIONIST" }))).ok, true);
});

test("🔴 la bandera de OTRA clínica no abre esta: la fila se busca con el clinicId de la sesión", async () => {
  const db = crearBase(siembra());
  // U_ADMIN tiene la bandera en el NORTE; con la sesión puesta en el SUR no hay fila suya.
  const r = await correr(sesion(db, { clinicId: CL_S, timezone: TZ_S, userId: U_ADMIN }));
  assert.equal((r as any).motivo, "sin_permiso");
  assert.deepEqual(lecturasDeCaja(db), []);
});

test("sin la KEY billing.view se corta antes, sin tocar la base, aunque tenga la bandera", async () => {
  const db = crearBase(siembra());
  const r = await correr(sesion(db, { userId: U_RECEP, role: "RECEPTIONIST", permissionsOverride: ["agenda.view"] }));
  assert.deepEqual(r, { ok: false, motivo: "sin_permiso", permiso: "billing.view" });
  assert.equal(db.contador.llamadas.length, 0);
});

test("la herramienta declara la key de la pantalla Y el candado; la pantalla sigue pidiendo las dos", () => {
  assert.equal(caja.permiso, "billing.view");
  assert.equal(caja.candado, candadoCaja);
  // Si alguien cambia el candado de la pantalla, esta prueba avisa de que Sabina tiene que seguirlo.
  const raiz = process.cwd();
  const page = readFileSync(join(raiz, "src/app/dashboard/caja/page.tsx"), "utf8");
  assert.match(page, /requirePermissionOrRedirect\(user, "billing\.view"\)/);
  assert.match(page, /canUseCaja\(user\)/);
  for (const ruta of ["current", "history"]) {
    const src = readFileSync(join(raiz, `src/app/api/caja/${ruta}/route.ts`), "utf8");
    assert.match(src, /denyIfMissingPermission\(ctx, "billing\.view"\)/, ruta);
    assert.match(src, /canUseCaja\(ctx\.user\)/, ruta);
  }
});

test("si el candado no puede leer la bandera sale error, nunca datos", async () => {
  const db = crearBase(siembra());
  (db as any).user = {
    findFirst: async () => {
      throw new Error("la base se cayó");
    },
    findMany: async () => [],
  };
  const r = await correr(sesion(db));
  assert.equal((r as any).motivo, "error");
  assert.deepEqual(lecturasDeCaja(db), []);
});

test("🔴 llamar a ejecutar directo, saltándose el runner, tampoco abre la caja", async () => {
  const db = crearBase(siembra());
  await assert.rejects(caja.ejecutar(sesion(db, { userId: U_ADMIN_SIN }), {}), /sin_permiso: caja\.acceso/);
  assert.deepEqual(lecturasDeCaja(db), []);
});

/* ══════════════════════════════════════════════════════════════════════
 * 2 · 🔴 Aislamiento entre clínicas
 * ══════════════════════════════════════════════════════════════════════ */

function sinMarcas(json: string, marcas: string[], contexto: string): void {
  for (const m of marcas) assert.equal(json.indexOf(m), -1, `FUGA DE TENANT en ${contexto}: apareció "${m}"`);
}

test("🔴 NORTE nunca ve nada del SUR, en las tres vistas", async () => {
  const db = crearBase(siembra());
  for (const vista of ["turno", "corte", "historial"]) {
    const r = await correr(sesion(db), { vista });
    assert.equal(r.ok, true, `${vista}: ${JSON.stringify(r)}`);
    sinMarcas(JSON.stringify(r), MARCAS_SUR, `caja/${vista} desde el norte`);
  }
});

test("🔴 SUR nunca ve nada del NORTE, en las tres vistas", async () => {
  const db = crearBase(siembra());
  for (const vista of ["turno", "corte", "historial"]) {
    const r = await correr(sesion(db, { clinicId: CL_S, userId: U_ADMIN_S, timezone: TZ_S }), { vista });
    assert.equal(r.ok, true, `${vista}: ${JSON.stringify(r)}`);
    sinMarcas(JSON.stringify(r), MARCAS_NORTE, `caja/${vista} desde el sur`);
  }
});

test("el instrumento detecta la fuga: sin clinicId, el doble devuelve las cajas de las dos clínicas", async () => {
  const db = crearBase(siembra());
  const todas = await db.cashRegister.findMany({ where: { clinicId: undefined, status: "OPEN" } });
  assert.equal(todas.length, 2);
});

test("🔴 sin clinicId en la sesión no se consulta, ni la bandera", async () => {
  const db = crearBase(siembra());
  const r = await correr(sesion(db, { clinicId: "" }));
  assert.equal((r as any).motivo, "error");
  assert.match((r as any).detalle, /sesion_invalida/);
  assert.equal(db.contador.llamadas.length, 0);
});

test("clinicId no entra por parámetro, y una vista inventada es un error explicado", async () => {
  const p = caja.parametros.safeParse({ clinicId: CL_S, vista: "turno" });
  assert.equal(p.success, true);
  assert.equal(Object.prototype.hasOwnProperty.call((p as any).data, "clinicId"), false);

  const db = crearBase(siembra());
  const r = await correr(sesion(db), { vista: "abrir" });
  assert.equal((r as any).motivo, "error");
  assert.match((r as any).detalle, /parametros_invalidos/);
});

/* ══════════════════════════════════════════════════════════════════════
 * 3 · Los números de Sabina contra los de la pantalla
 * ══════════════════════════════════════════════════════════════════════ */

test("turno: el efectivo esperado, la tarjeta y los retiros son los de getCajaState (la pantalla)", async () => {
  const db = crearBase(siembra());
  const r = await correr(sesion(db));
  assert.equal(r.ok, true);
  const t = (r as any).datos.turno as NonNullable<DatosCajaTurno["turno"]>;

  pantalla.db = db;
  try {
    const estado = await getCajaState(CL_N);
    assert.equal(t.efectivoEsperado, estado.totals!.expectedCash);
    assert.equal(t.apertura, estado.totals!.openingBalance);
    assert.equal(t.efectivoCobrado, estado.totals!.cashIncome);
    assert.equal(t.tarjetaDebito, estado.totals!.cardDebitIncome);
    assert.equal(t.tarjetaCredito, estado.totals!.cardCreditIncome);
    assert.equal(t.otrosMetodos, estado.totals!.otherIncome);
    assert.equal(t.totalCobrado, estado.totals!.totalIncome);
    assert.equal(t.retirosTotal, estado.totals!.withdrawals);
    assert.equal(t.retiros.total, estado.withdrawals.length);
    assert.equal(t.abrio, estado.register!.operatorName);
  } finally {
    pantalla.db = null;
  }

  // Y a mano, para que «igual a la pantalla» no sea igual a un error compartido:
  // apertura 1000 + efectivo (800 + 600) − retiros (300 + 200). El cobro de hace
  // 30 h es de antes de abrir y no entra.
  assert.equal(t.efectivoEsperado, 1900);
  assert.equal(t.tarjetaDebito, 1200);
  assert.equal(t.tarjetaCredito, 900);
  assert.equal(t.totalCobrado, 3500);
  assert.equal(t.abrio, "Lupe Mesa");
});

test("historial: esperado, contado y diferencia de cada corte son los de getCajaHistory (la pantalla)", async () => {
  const db = crearBase(siembra());
  const r = await correr(sesion(db), { vista: "historial" });
  assert.equal(r.ok, true);
  const d = (r as any).datos as DatosCajaHistorial;

  pantalla.db = db;
  let historia;
  try {
    historia = await getCajaHistory(CL_N, 30);
  } finally {
    pantalla.db = null;
  }
  // Sabina enseña los 10 más recientes; la pantalla, 30. Las filas son las mismas y en el mismo orden.
  assert.equal(d.cortes.filas.length, Math.min(historia.length, 10));
  d.cortes.filas.forEach((c, i) => {
    assert.equal(c.esperado, historia[i].expectedCash);
    assert.equal(c.contado, historia[i].countedClosingBalance);
    assert.equal(c.diferencia, historia[i].variance);
  });
  // El más reciente primero: el de ayer, que no cuadró.
  assert.equal(d.cortes.filas[0].diferencia, -200);
  assert.match((r as any).resumen, /faltaron \$200/);
  assert.match((r as any).resumen, /1 no cuadró exacto/);
});

/* ══════════════════════════════════════════════════════════════════════
 * 4 · El esperado no es dinero contado; el corte manda a Caja
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 el esperado viaja SIEMPRE con su aviso: en los datos y en el resumen", async () => {
  const db = crearBase(siembra());
  for (const vista of ["turno", "corte"]) {
    const r = await correr(sesion(db), { vista });
    assert.equal(r.ok, true);
    assert.equal((r as any).datos.turno.avisoEsperado, AVISO_ESPERADO, vista);
    assert.match((r as any).resumen, /no dinero contado/, vista);
  }
  assert.match((await correr(sesion(db), { vista: "historial" }) as any).resumen, /\(cálculo\)/);
});

test("corte: junta descuentos, IVA y cobros, y manda a Caja a contar y cerrar con PIN", async () => {
  const db = crearBase(siembra());
  const r = await correr(sesion(db), { vista: "corte" });
  assert.equal(r.ok, true);
  const t = (r as any).datos.turno;
  assert.equal(t.comoCerrar, COMO_CERRAR);
  assert.equal(t.cobros.total, 4);
  assert.equal(typeof t.descuentos, "number");
  assert.equal(typeof t.iva, "number");
  assert.match((r as any).resumen, /ve a Caja, cuenta el efectivo y cierra con tu PIN/);
  assert.match((r as any).resumen, /No escribas tu PIN/);
  // Lo más reciente primero.
  assert.equal(t.cobros.filas[0].monto, 600);
  assert.equal(t.cobros.filas[0].metodo, "efectivo");
});

test("turno sin la vista corte no arrastra la lista de cobros (se paga en cada ronda)", async () => {
  const db = crearBase(siembra());
  const t = ((await correr(sesion(db))) as any).datos.turno;
  assert.equal(t.cobros, undefined);
  assert.equal(t.comoCerrar, undefined);
});

test("caja cerrada: se dice que está cerrada y cuál fue el último corte; no hay corte que preparar", async () => {
  const datos = siembra();
  datos.cashRegisters = datos.cashRegisters!.filter((c) => c.status === "CLOSED");
  const db = crearBase(datos);

  const turno = await correr(sesion(db));
  assert.equal(turno.ok, true, "cerrada es una respuesta, no «sin datos»");
  assert.equal((turno as any).datos.abierta, false);
  assert.equal((turno as any).datos.ultimoCorte.diferencia, -200);
  assert.match((turno as any).resumen, /está cerrada/);

  const corte = await correr(sesion(db), { vista: "corte" });
  assert.match((corte as any).resumen, /no hay corte que preparar/);
});

test("sin ningún corte cerrado, el histórico es sin_datos", async () => {
  const datos = siembra();
  datos.cashRegisters = datos.cashRegisters!.filter((c) => c.status === "OPEN");
  const r = await correr(sesion(crearBase(datos)), { vista: "historial" });
  assert.deepEqual(r, { ok: false, motivo: "sin_datos" });
});

/* ══════════════════════════════════════════════════════════════════════
 * 5 · Pacientes restringidos y tope de 50
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 paciente restringido: el DOCTOR que no la ve lee «Paciente privado», con los mismos totales", async () => {
  const db = crearBase(siembra());
  const admin = (await correr(sesion(db), { vista: "corte" })) as any;
  const doctor = (await correr(sesion(db, { userId: U_DOC, role: "DOCTOR" }), { vista: "corte" })) as any;
  assert.equal(admin.ok, true);
  assert.equal(doctor.ok, true);

  const nombres = (r: any) => r.datos.turno.cobros.filas.map((f: any) => f.paciente);
  assert.ok(nombres(admin).includes("Rosa Restringida"), "la admin está en la lista de la paciente");
  assert.ok(!JSON.stringify(doctor).includes("Restringida"), "el doctor no la ve");
  assert.ok(nombres(doctor).includes("Paciente privado"));
  // Enmascarar no saca filas: el corte cuadra igual para los dos.
  assert.equal(doctor.datos.turno.cobros.total, admin.datos.turno.cobros.total);
  assert.equal(doctor.datos.turno.efectivoEsperado, admin.datos.turno.efectivoEsperado);
  assert.equal(doctor.datos.turno.totalCobrado, admin.datos.turno.totalCobrado);
});

test("la pantalla de Caja no cambia: getCajaState sin viewer sigue enseñando el nombre", async () => {
  const db = crearBase(siembra());
  pantalla.db = db;
  try {
    const estado = await getCajaState(CL_N);
    assert.ok(estado.list.some((f) => f.patientName === "Rosa Restringida"));
    assert.ok(!estado.list.some((f) => "visibleUserIds" in (f as any)), "la lista no expone visibleUserIds");
  } finally {
    pantalla.db = null;
  }
});

test("más de 50 cobros: van 50, con el total real, y los totales cuentan los 60", async () => {
  const datos = siembra();
  const extra: Fila[] = [];
  for (let i = 0; i < 56; i++) {
    extra.push({ id: `pay-x${i}`, invoiceId: "inv-n1", amount: 10, method: "cash", paidAt: hace(18 - i * 0.25) });
  }
  datos.payments = [...datos.payments!, ...extra];
  const r = (await correr(sesion(crearBase(datos)), { vista: "corte" })) as any;
  assert.equal(r.ok, true);
  assert.equal(r.datos.turno.cobros.filas.length, 50);
  assert.equal(r.datos.turno.cobros.total, 60);
  assert.equal(r.datos.turno.cobros.truncado, true);
  assert.equal(r.datos.turno.efectivoCobrado, 800 + 600 + 560);
  assert.match(r.resumen, /van 50 de 60 cobros/);
});

/* ══════════════════════════════════════════════════════════════════════
 * 6 · «Sin cortar»: la regla de la pantalla
 * ══════════════════════════════════════════════════════════════════════ */

const cdmx = (iso: string) => new Date(`${iso}-06:00`); // Ciudad de México, UTC−6 sin horario de verano

test("la regla: 18 h o cambio de día natural EN LA ZONA DE LA CLÍNICA", () => {
  const dia = dayKeyIn(TZ_N);
  assert.equal(STALE_SHIFT_HOURS, 18);

  // 08:00 → 20:00 del mismo día en CDMX: 12 h. En UTC ya cambió el día (02:00Z
  // del siguiente), y aun así NO hay aviso: el día es el de la clínica.
  assert.equal(staleShiftOf(cdmx("2026-09-14T08:00:00"), cdmx("2026-09-14T20:00:00").getTime(), dia), null);
  assert.notEqual(dayKeyIn("UTC")(cdmx("2026-09-14T08:00:00")), dayKeyIn("UTC")(cdmx("2026-09-14T20:00:00")));

  // 22:00 → 01:00: solo 3 h, pero cruzó la medianoche.
  assert.deepEqual(staleShiftOf(cdmx("2026-09-14T22:00:00"), cdmx("2026-09-15T01:00:00").getTime(), dia), {
    hours: 3,
    crossedDay: true,
  });
  // 05:00 → 23:30 del mismo día: 18,5 h.
  assert.deepEqual(staleShiftOf(cdmx("2026-09-14T05:00:00"), cdmx("2026-09-14T23:30:00").getTime(), dia), {
    hours: 18,
    crossedDay: false,
  });
  // 17 h 59 min del mismo día: todavía no.
  assert.equal(staleShiftOf(cdmx("2026-09-14T06:00:00"), cdmx("2026-09-14T23:59:00").getTime(), dia), null);
});

test("Sabina da el mismo aviso que la pantalla para el turno sembrado (abierto hace 20 h)", async () => {
  const db = crearBase(siembra());
  const r = (await correr(sesion(db))) as any;
  const pantallaDice = staleShiftOf(hace(20), Date.now(), dayKeyIn(TZ_N));
  assert.ok(pantallaDice, "20 h abiertas siempre avisan");
  assert.deepEqual(r.datos.turno.sinCortar, { horas: pantallaDice!.hours, cambioDeDia: pantallaDice!.crossedDay });
  assert.match(r.resumen, /sin cortar/);
});

test("la pantalla de Caja usa la regla compartida, no una copia", () => {
  const src = readFileSync(join(process.cwd(), "src/app/dashboard/caja/caja-client.tsx"), "utf8");
  assert.match(src, /from "@\/lib\/caja-turno"/);
  assert.match(src, /staleShiftOf\(/);
  assert.doesNotMatch(src, /STALE_SHIFT_HOURS\s*=/, "el umbral vive solo en lib/caja-turno");
});

/* ══════════════════════════════════════════════════════════════════════
 * 7 · Por el motor: lo que de verdad lee el doctor
 * ══════════════════════════════════════════════════════════════════════ */

/** Un modelo de guion: pide `caja` con esos parámetros y luego contesta `texto`. */
function modeloQue(params: unknown, texto: string) {
  let i = 0;
  const turnos = [
    { bloques: [{ type: "tool_use", id: "tu_1", name: "caja", input: params }], stopReason: "tool_use", tokensEntrada: 1, tokensSalida: 1, error: null },
    { bloques: [{ type: "text", text: texto }], stopReason: "end_turn", tokensEntrada: 1, tokensSalida: 1, error: null },
  ];
  return async () => turnos[Math.min(i++, turnos.length - 1)] as any;
}

async function preguntar(ctx: SabinaCtx, params: unknown, texto: string): Promise<string> {
  const { ejecutarSabina } = await import("../../engine");
  const salida = await ejecutarSabina({ ctx, pregunta: "¿cuánto hay en caja?", tools: [caja], llamar: modeloQue(params, texto) });
  return salida.respuesta;
}

test("🔴 si el modelo dice «en caja hay $1,900» a secas, el motor añade que es un cálculo", async () => {
  const respuesta = await preguntar(sesion(crearBase(siembra())), {}, "En caja hay $1,900.");
  assert.match(respuesta, /^En caja hay \$1,900\./);
  assert.ok(respuesta.includes(AVISO_ESPERADO_RESPUESTA.frase), respuesta);
});

test("si el modelo ya lo dijo a su manera, no se repite", async () => {
  const texto = "Deberían quedar $1,900 en el cajón, pero es un cálculo: cuéntalo antes de cerrar.";
  assert.equal(await preguntar(sesion(crearBase(siembra())), { vista: "corte" }, texto), texto);
});

test("el histórico y la caja cerrada no disparan el aviso del turno", async () => {
  const texto = "El corte de ayer no cuadró: faltaron $200.";
  assert.equal(await preguntar(sesion(crearBase(siembra())), { vista: "historial" }, texto), texto);

  const datos = siembra();
  datos.cashRegisters = datos.cashRegisters!.filter((c) => c.status === "CLOSED");
  assert.equal(await preguntar(sesion(crearBase(datos)), {}, "La caja está cerrada."), "La caja está cerrada.");
});

test("🔴 hallazgo 23 por el motor: aunque el modelo se calle, el doctor lee «No tienes acceso a Caja»", async () => {
  const db = crearBase(siembra());
  const respuesta = await preguntar(sesion(db, { userId: U_ADMIN_SIN }), {}, "No tengo datos de la caja.");
  assert.ok(respuesta.includes("No tienes acceso a Caja"), respuesta);
  assert.doesNotMatch(respuesta, /1,900|Lupe|guantes/);
  assert.deepEqual(lecturasDeCaja(db), []);
});

test("si el modelo no contestó nada, la red no se inventa una respuesta hecha solo del aviso", async () => {
  const { garantizarAvisosObligatorios } = await import("../../engine-core");
  assert.equal(garantizarAvisosObligatorios("", [AVISO_ESPERADO_RESPUESTA]), "");
  assert.equal(garantizarAvisosObligatorios("   ", [AVISO_ESPERADO_RESPUESTA]), "   ");

  // Por el motor: el modelo pide `caja` y nunca escribe texto → sigue siendo un fallo.
  const { ejecutarSabina } = await import("../../engine");
  const soloHerramienta = async () =>
    ({ bloques: [{ type: "tool_use", id: "tu_x", name: "caja", input: {} }], stopReason: "tool_use", tokensEntrada: 1, tokensSalida: 1, error: null }) as any;
  const salida = await ejecutarSabina({ ctx: sesion(crearBase(siembra())), pregunta: "¿caja?", tools: [caja], llamar: soloHerramienta });
  assert.equal(salida.fallo, true);
  assert.ok(!salida.respuesta.includes(AVISO_ESPERADO_RESPUESTA.frase));
});

test("histórico con cortes sin diferencia guardada: no se dice que todos cuadraron", async () => {
  const datos = siembra();
  datos.cashRegisters = datos.cashRegisters!.map((c) => (c.status === "CLOSED" ? { ...c, snapshotVariance: null } : c));
  const r = (await correr(sesion(crearBase(datos)), { vista: "historial" })) as any;
  assert.doesNotMatch(r.resumen, /Todos cuadraron/);
  assert.match(r.resumen, /2 no tienen la diferencia guardada/);
  assert.match(r.resumen, /la diferencia no quedó guardada/);
});
