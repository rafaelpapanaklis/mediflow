/**
 * DOS CLÍNICAS DE PRUEBA para inventario, gastos y reportes (ws1-t6).
 *
 * Es una siembra APARTE de `siembra.ts` a propósito: aquí los números tienen que
 * ser exactos y a mano (la utilidad es 27 250, no «lo que salga»), y compartir
 * tabla con la de las otras herramientas haría que cada cambio allí moviera una
 * cifra de aquí. Los usuarios y los ids de clínica sí son los de `siembra.ts`,
 * para poder usar sus constructores de sesión (`adminNorte`, `recepcionNorte`…).
 *
 * Los datos de la clínica de al lado (`CL_SUR`) CHILLAN si se cuelan: «SUR» en
 * el nombre y 99 999 en el importe.
 *
 * ── LAS FECHAS SON RELATIVAS A AHORA ───────────────────────────────────
 * «Este mes» son los primeros minutos del mes de México (nunca en el futuro: un
 * cobro no puede tenerlo), el mes anterior es el día 10 del anterior, y los gastos
 * de este mes incluyen uno con fecha de fin de mes —el que la pantalla de Finanzas
 * cuenta aunque todavía no llegue—.
 */

import { startOfMonthMx } from "@/lib/finanzas-periodo";
import { sumarDias } from "../fechas";
import { crearBase, type BaseDoble, type Datos, type Fila } from "./doble-base";
import {
  CL_NORTE,
  CL_SUR,
  HOY_N,
  TZ_NORTE,
  TZ_SUR,
  U_ADMIN_N,
  U_ADMIN_S,
  U_DOC2_N,
  U_DOC_N,
  U_RECEP_N,
} from "./siembra";

export const U_DOC_S = "u-doc-s";
const DIA = 86_400_000;

export const AHORA = new Date();
export const INICIO_MES = startOfMonthMx(AHORA, 0);
export const INICIO_MES_ANT = startOfMonthMx(AHORA, -1);
/** Un instante de ESTE mes que nunca está en el futuro (los cobros no lo tienen). */
export function esteMes(despuesDelInicioMs: number): Date {
  return new Date(Math.min(INICIO_MES.getTime() + despuesDelInicioMs, AHORA.getTime() - 1000));
}
/** Un instante del mes anterior (día 10, a mediodía). */
export function mesAnterior(): Date {
  return new Date(INICIO_MES_ANT.getTime() + 10 * DIA + 12 * 3_600_000);
}
/** Último día del mes de México, una hora antes de que acabe: un gasto «de fin de mes». */
export function finDeMes(): Date {
  return new Date(startOfMonthMx(AHORA, 1).getTime() - 3_600_000);
}

/** Un día de calendario guardado como se guarda la caducidad: 00:00 UTC. */
function caduca(dias: number): Date {
  return new Date(`${sumarDias(HOY_N, dias)}T00:00:00.000Z`);
}

export const IP_N = "ip-n1";
export const IP_S = "ip-s1";

/* ── los números que prueban los tests, escritos UNA vez ─────────────── */
export const NORTE = {
  ingresosNetos: 65_000, // 30 000 + 20 000 + 20 000 − 5 000 de reembolso
  ingresosBrutos: 70_000,
  reembolsos: 5_000,
  gastos: 37_750, // renta 10 000 + nómina 25 000 + insumos 1 250 + servicios 800 + servicios 700 (fin de mes)
  gastosAnterior: 30_400, // renta 10 000 + nómina 20 000 + insumos 400
  utilidad: 27_250,
  ingresosAnterior: 40_000,
  utilidadAnterior: 9_600,
  ventas: 3, // la DRAFT y la CANCELLED no son ventas
  produccion: { [U_DOC_N]: 50_000, [U_DOC2_N]: 30_000, sinDoctor: 800 },
  inventario: { articulos: 8, agotados: 2, bajos: 2, valor: 2_270, unidades: 47 },
};

export function datosNegocio(): Datos {
  const clinics: Fila[] = [
    { id: CL_NORTE, timezone: TZ_NORTE, category: "DENTAL" },
    { id: CL_SUR, timezone: TZ_SUR, category: "DENTAL" },
  ];

  const users: Fila[] = [
    { id: U_ADMIN_N, clinicId: CL_NORTE, role: "ADMIN", firstName: "Rita", lastName: "Admin", isActive: true },
    { id: U_DOC_N, clinicId: CL_NORTE, role: "DOCTOR", firstName: "Hugo", lastName: "Salas", isActive: true },
    { id: U_DOC2_N, clinicId: CL_NORTE, role: "DOCTOR", firstName: "Nadia", lastName: "Rojas", isActive: true },
    { id: U_RECEP_N, clinicId: CL_NORTE, role: "RECEPTIONIST", firstName: "Lupe", lastName: "Mesa", isActive: true },
    { id: U_ADMIN_S, clinicId: CL_SUR, role: "ADMIN", firstName: "Sara", lastName: "Sur", isActive: true },
    { id: U_DOC_S, clinicId: CL_SUR, role: "DOCTOR", firstName: "DOCTOR", lastName: "SUR", isActive: true },
  ];

  /* ── dinero: facturas y pagos ──────────────────────────────────────── */
  const factura = (over: Fila): Fila => ({ paid: 0, discount: 0, dueDate: null, items: [], ...over });
  const invoices: Fila[] = [
    factura({ id: "ng-i1", clinicId: CL_NORTE, patientId: "ng-p1", doctorId: U_DOC_N, status: "PAID", total: 50_000, paid: 50_000, balance: 0, createdAt: esteMes(3_600_000) }),
    factura({ id: "ng-i2", clinicId: CL_NORTE, patientId: "ng-p2", doctorId: U_DOC2_N, status: "PARTIAL", total: 30_000, paid: 20_000, balance: 10_000, createdAt: esteMes(3_600_000) }),
    factura({ id: "ng-i3", clinicId: CL_NORTE, patientId: "ng-p3", doctorId: null, status: "PENDING", total: 800, balance: 800, createdAt: esteMes(3_600_000) }),
    // BORRADOR: no es una venta ni cuenta en la producción del doctor.
    factura({ id: "ng-i4", clinicId: CL_NORTE, patientId: "ng-p1", doctorId: U_DOC_N, status: "DRAFT", total: 9_000, balance: 9_000, createdAt: esteMes(3_600_000) }),
    // CANCELADA: sus pagos no son ingreso y no es venta.
    factura({ id: "ng-i5", clinicId: CL_NORTE, patientId: "ng-p1", doctorId: U_DOC_N, status: "CANCELLED", total: 7_777, paid: 7_777, balance: 0, createdAt: esteMes(3_600_000) }),
    // El mes anterior.
    factura({ id: "ng-i6", clinicId: CL_NORTE, patientId: "ng-p4", doctorId: U_DOC_N, status: "PAID", total: 40_000, paid: 40_000, balance: 0, createdAt: mesAnterior() }),
    // La del sur: 99 999 por todos lados.
    factura({ id: "ng-s1", clinicId: CL_SUR, patientId: "ng-ps1", doctorId: U_DOC_S, status: "PAID", total: 99_999, paid: 99_999, balance: 0, createdAt: esteMes(3_600_000) }),
    factura({ id: "ng-s2", clinicId: CL_SUR, patientId: "ng-ps1", doctorId: U_DOC_S, status: "PAID", total: 99_999, paid: 99_999, balance: 0, createdAt: mesAnterior() }),
  ];
  const pago = (id: string, invoiceId: string, amount: number, method: string, paidAt: Date): Fila => ({ id, invoiceId, amount, method, paidAt });
  const payments: Fila[] = [
    pago("ng-g1", "ng-i1", 30_000, "cash", esteMes(3_600_000)),
    pago("ng-g2", "ng-i1", 20_000, "card", esteMes(3_600_000)),
    pago("ng-g3", "ng-i2", 20_000, "transfer", esteMes(3_600_000)),
    pago("ng-g4", "ng-i1", 5_000, "refund", esteMes(7_200_000)), // reembolso: se guarda en POSITIVO
    pago("ng-g5", "ng-i5", 7_777, "cash", esteMes(3_600_000)), // de una factura cancelada
    pago("ng-g6", "ng-i6", 40_000, "card", mesAnterior()),
    pago("ng-gs1", "ng-s1", 99_999, "cash", esteMes(3_600_000)),
    pago("ng-gs2", "ng-s2", 99_999, "cash", mesAnterior()),
  ];

  /* ── gastos ────────────────────────────────────────────────────────── */
  const gasto = (id: string, clinicId: string, date: Date, category: string, amount: number, over: Fila = {}): Fila => ({
    id, clinicId, date, category, amount, note: null, createdById: U_ADMIN_N, purchaseId: null, ...over,
  });
  const expenses: Fila[] = [
    gasto("ng-e1", CL_NORTE, esteMes(2 * 3_600_000), "Renta", 10_000, { note: "Local de octubre" }),
    gasto("ng-e2", CL_NORTE, esteMes(2 * 3_600_000), "Nómina", 25_000),
    gasto("ng-e3", CL_NORTE, esteMes(3 * 3_600_000), "Insumos", 1_250, { purchaseId: "pu-1" }),
    gasto("ng-e4", CL_NORTE, esteMes(4 * 3_600_000), "Servicios", 800, { note: "Luz" }),
    gasto("ng-e5", CL_NORTE, finDeMes(), "Servicios", 700, { note: "Internet (fecha de fin de mes)" }),
    gasto("ng-e6", CL_NORTE, mesAnterior(), "Renta", 10_000),
    gasto("ng-e7", CL_NORTE, mesAnterior(), "Nómina", 20_000),
    gasto("ng-e8", CL_NORTE, mesAnterior(), "Insumos", 400),
    gasto("ng-es1", CL_SUR, esteMes(2 * 3_600_000), "Renta SUR", 99_999, { createdById: U_ADMIN_S }),
    gasto("ng-es2", CL_SUR, mesAnterior(), "Renta SUR", 99_999, { createdById: U_ADMIN_S }),
  ];

  /* ── pacientes y citas ─────────────────────────────────────────────── */
  const paciente = (id: string, clinicId: string, createdAt: Date, over: Fila = {}): Fila => ({
    id, clinicId, firstName: id, lastName: "Prueba", status: "ACTIVE", visibleUserIds: [], deletedAt: null, createdAt, ...over,
  });
  const patients: Fila[] = [
    paciente("ng-p1", CL_NORTE, esteMes(3_600_000)),
    paciente("ng-p2", CL_NORTE, esteMes(3_600_000)),
    paciente("ng-p3", CL_NORTE, esteMes(3_600_000)),
    paciente("ng-p4", CL_NORTE, mesAnterior()),
    // Archivado por ARCO: Reportes lo cuenta (su `patient.count` no filtra `deletedAt`).
    paciente("ng-p5", CL_NORTE, esteMes(3_600_000), { deletedAt: new Date() }),
    paciente("ng-ps1", CL_SUR, esteMes(3_600_000)),
    paciente("ng-ps2", CL_SUR, esteMes(3_600_000)),
  ];
  const cita = (id: string, clinicId: string, patientId: string, status: string, startsAt: Date): Fila => ({
    id, clinicId, patientId, status, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000), type: "Consulta", doctorId: U_DOC_N, resourceId: null,
  });
  const appointments: Fila[] = [
    cita("ng-c1", CL_NORTE, "ng-p1", "COMPLETED", esteMes(3_600_000)),
    cita("ng-c2", CL_NORTE, "ng-p1", "COMPLETED", esteMes(3_600_000)),
    cita("ng-c3", CL_NORTE, "ng-p2", "CHECKED_OUT", esteMes(3_600_000)),
    cita("ng-c4", CL_NORTE, "ng-p3", "CANCELLED", esteMes(3_600_000)),
    cita("ng-c5", CL_NORTE, "ng-p3", "SCHEDULED", esteMes(3_600_000)),
    cita("ng-c6", CL_NORTE, "ng-p4", "COMPLETED", mesAnterior()),
    cita("ng-cs1", CL_SUR, "ng-ps1", "COMPLETED", esteMes(3_600_000)),
    cita("ng-cs2", CL_SUR, "ng-ps2", "COMPLETED", esteMes(3_600_000)),
  ];

  /* ── inventario ────────────────────────────────────────────────────── */
  const articulo = (id: string, clinicId: string, name: string, category: string, quantity: number, minQuantity: number, unitCost: number, over: Fila = {}): Fila => ({
    id, clinicId, name, category, quantity, minQuantity, unitCost, unit: "pza", description: null, emoji: "📦", price: null,
    providerId: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  });
  const inventoryItems: Fila[] = [
    articulo("it-resina", CL_NORTE, "Resina compuesta A2", "Materiales de restauración", 10, 3, 100),
    articulo("it-resina3", CL_NORTE, "Resina compuesta A3", "Materiales de restauración", 6, 3, 120),
    articulo("it-guantes", CL_NORTE, "Guantes de látex", "Consumibles", 4, 5, 50),
    articulo("it-anest", CL_NORTE, "Anestesia lidocaína", "Consumibles", 0, 5, 200),
    articulo("it-lido", CL_NORTE, "Lidocaína en gel", "Consumibles", 8, 2, 30), // 8 guardadas, 3 caducadas → 5 vigentes
    articulo("it-fresa", CL_NORTE, "Fresa de pulido", "Fresas dentales", 2, 2, 0), // sin costo capturado
    articulo("it-gasas", CL_NORTE, "Gasas estériles", "Consumibles", 20, 5, 10),
    articulo("it-hilo", CL_NORTE, "Hilo de sutura", "Consumibles", 4, 2, 20), // las 4 caducadas → 0 vigentes
    articulo("it-sur", CL_SUR, "ARTICULO SUR", "Consumibles", 0, 5, 99_999),
  ];
  const lote = (id: string, clinicId: string, itemId: string, lotNumber: string, expiresAt: Date | null, remaining: number): Fila => ({
    id, clinicId, itemId, lotNumber, expiresAt, quantity: remaining, remaining, unitCost: null, purchaseLineId: null, createdAt: new Date(), updatedAt: new Date(),
  });
  const inventoryLots: Fila[] = [
    lote("l-resina", CL_NORTE, "it-resina", "R-1", caduca(400), 10),
    lote("l-lido-viejo", CL_NORTE, "it-lido", "L-OLD", caduca(-10), 3),
    lote("l-lido-nuevo", CL_NORTE, "it-lido", "L-NEW", caduca(300), 5),
    lote("l-gasas", CL_NORTE, "it-gasas", "G-1", caduca(10), 20),
    lote("l-hilo", CL_NORTE, "it-hilo", "H-1", caduca(-2), 4),
    lote("l-sur", CL_SUR, "it-sur", "SUR-1", caduca(-5), 77),
  ];

  /* ── compras ───────────────────────────────────────────────────────── */
  const inventoryProviders: Fila[] = [
    { id: IP_N, clinicId: CL_NORTE, name: "Dental Depot" },
    { id: IP_S, clinicId: CL_SUR, name: "PROVEEDOR SUR" },
  ];
  const inventoryPurchases: Fila[] = [
    { id: "pu-1", clinicId: CL_NORTE, providerId: IP_N, date: new Date(Date.now() - 5 * DIA), receiptRef: "F-100", receiptFilePath: null, receiptFileName: null, createdById: U_ADMIN_N },
    { id: "pu-2", clinicId: CL_NORTE, providerId: null, date: new Date(Date.now() - 30 * DIA), receiptRef: null, receiptFilePath: null, receiptFileName: null, createdById: U_ADMIN_N },
    { id: "pu-s1", clinicId: CL_SUR, providerId: IP_S, date: new Date(Date.now() - 1 * DIA), receiptRef: "SUR-1", receiptFilePath: null, receiptFileName: null, createdById: U_ADMIN_S },
  ];
  const inventoryPurchaseLines: Fila[] = [
    { id: "pl-1", purchaseId: "pu-1", itemId: "it-resina", quantity: 10, unitCost: 100 },
    { id: "pl-2", purchaseId: "pu-1", itemId: "it-guantes", quantity: 5, unitCost: 50 },
    { id: "pl-3", purchaseId: "pu-2", itemId: "it-anest", quantity: 2, unitCost: 200 },
    { id: "pl-s1", purchaseId: "pu-s1", itemId: "it-sur", quantity: 1, unitCost: 99_999 },
  ];

  /* ── catálogo de procedimientos y recetas ──────────────────────────── */
  const proc = (id: string, clinicId: string, name: string, category: string, basePrice: number, cost: number | null, over: Fila = {}): Fila => ({
    id, clinicId, name, category, basePrice, cost, isActive: true, duration: 30, code: null, ...over,
  });
  const procedureCatalogs: Fila[] = [
    proc("pc-limpieza", CL_NORTE, "Limpieza dental", "general", 800, 200), // gasto manual → margen 600 (75%)
    proc("pc-resina", CL_NORTE, "Resina", "dental", 1_000, null), // sin gasto manual: receta 1×100 + 2×50 = 200 → margen 800 (80%)
    proc("pc-endo", CL_NORTE, "Endodoncia", "dental", 3_500, null), // sin costo capturado
    proc("pc-extra", CL_NORTE, "Extracción", "dental", 1_200, 0), // «no gasta nada»: 0 es un dato → margen 1 200 (100%)
    proc("pc-blanq", CL_NORTE, "Blanqueamiento", "aesthetic", 2_000, 2_500), // pierde: margen −500 (−25%)
    proc("pc-sellador", CL_NORTE, "Sellador", "dental", 500, null), // su receta usa un insumo SIN costo → suma 0 → sin costo
    proc("pc-baja", CL_NORTE, "Procedimiento de baja", "dental", 100, 10, { isActive: false }), // inactivo: no entra
    proc("pc-sur", CL_SUR, "PROCEDIMIENTO SUR", "dental", 99_999, 1),
  ];
  const procedureMaterialRecipes: Fila[] = [
    { id: "pr-1", clinicId: CL_NORTE, procedureId: "pc-resina", itemId: "it-resina", quantity: 1 },
    { id: "pr-2", clinicId: CL_NORTE, procedureId: "pc-resina", itemId: "it-guantes", quantity: 2 },
    { id: "pr-3", clinicId: CL_NORTE, procedureId: "pc-sellador", itemId: "it-fresa", quantity: 1 },
  ];

  return {
    clinics, users, patients, appointments, invoices, payments, expenses,
    inventoryItems, inventoryLots, inventoryAlertSettings: [
      { clinicId: CL_SUR, alertDaysAhead: 5 }, // la del norte no tiene fila: 30 días por defecto
    ],
    inventoryProviders, inventoryPurchases, inventoryPurchaseLines,
    procedureCatalogs, procedureMaterialRecipes,
  };
}

export function baseNegocio(): BaseDoble {
  return crearBase(datosNegocio());
}
