/**
 * EL ANTICIPO SE DESCUENTA DE LA FACTURA (WS1-T4).
 *
 * Run: npm run test:saldo-a-favor
 *
 * «Si son $1000 de factura y se pagó $200 de anticipo, el paciente al final
 * debe $800» — y solo en las facturas NUEVAS: las que ya existían se quedan
 * exactamente como están.
 *
 * Cómo prueba: conduce las RUTAS reales (POST /api/invoices, /confirm, /cancel)
 * y el servicio real (patient-credit-aplicar.ts) contra un doble de Prisma que:
 *   · aplica el `where` de verdad (clinicId incluido; un operador que no conoce
 *     LANZA, para que nada pase en verde por accidente);
 *   · implementa los candados: `FOR UPDATE` por fila y `pg_advisory_xact_lock`
 *     por clave, que se sueltan al terminar la transacción, como Postgres;
 *   · deshace lo escrito si la transacción lanza (todo o nada);
 *   · emula las restricciones del SQL (sql/anticipo-aplicado-a-factura.sql):
 *     paymentId y reversesId únicos, una aplicación por factura, y el signo.
 *
 * Concurrencia: una BARRERA hace que las dos transacciones lean el saldo a la
 * vez (cada una espera a la otra hasta 50 ms). Sin candado se cruzan siempre y
 * gastan el mismo peso dos veces; con candado la segunda está bloqueada, la
 * primera agota la espera y sigue. La prueba lo demuestra en los dos sentidos.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cfdiCuadre } from "@/lib/invoices/cfdi-cuadre";
import {
  APLICAR_SALDO_DESDE,
  FUENTE_APLICADO,
  FUENTE_DEVUELTO,
  METODO_ANTICIPO,
  montoAAplicar,
  pagadoEsSoloAnticipo,
  repartoAlCancelar,
} from "@/lib/patient-credit-core";

// ═══════════════════════════════════════════════════════════════════════════
// Doble de Prisma
// ═══════════════════════════════════════════════════════════════════════════
type Row = Record<string, any>;
const db = {
  invoices: [] as Row[],
  payments: [] as Row[],
  credits: [] as Row[],
  seq: 0,
};
const opciones = {
  /** false = el doble ignora pg_advisory_xact_lock (para ver que la prueba lo caza). */
  respetarAdvisory: true,
  /** true = patient_credits sin las columnas nuevas (el SQL aún no se aplicó). */
  faltanColumnas: false,
  /** Lanza al llegar a esta operación (p. ej. "patientCredit.create"). */
  fallarEn: null as string | null,
  /** Barrera: las transacciones que leen el saldo se esperan entre sí. */
  barrera: null as null | { llegados: number; despertar: Array<() => void> },
  /** Carreras: corre justo DESPUÉS de que una ruta lee la factura (otra persona actúa). */
  alLeerFactura: null as null | ((fila: Row) => void),
};
const auditoria: any[] = [];

const nuevoId = (p: string) => `${p}${++db.seq}`;
const clonar = <T,>(x: T): T => structuredClone(x);

/** ¿La fila cumple el `where`? Todas las claves, como Postgres. */
function cumple(row: Row, where: any): boolean {
  for (const [k, v] of Object.entries(where ?? {})) {
    if (v === undefined) continue;
    if (v !== null && typeof v === "object" && !(v instanceof Date)) {
      for (const [op, val] of Object.entries(v as any)) {
        if (op === "in") { if (!(val as any[]).includes(row[k])) return false; }
        else if (op === "notIn") { if ((val as any[]).includes(row[k])) return false; }
        else if (op === "lte") { if (!(row[k] <= (val as any))) return false; }
        else if (op === "gt") { if (!(row[k] > (val as any))) return false; }
        else throw new Error(`el doble no sabe evaluar ${k}: ${op}`);
      }
      continue;
    }
    if ((row[k] ?? null) !== v) return false;
  }
  return true;
}

function proyectar(row: Row, select?: any): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = row[k];
  return out;
}

// ── Candados ────────────────────────────────────────────────────────────────
const candados = new Map<string, { tomado: boolean; cola: Array<() => void> }>();
async function tomar(clave: string) {
  const c = candados.get(clave) ?? { tomado: false, cola: [] };
  candados.set(clave, c);
  if (!c.tomado) { c.tomado = true; return; }
  await new Promise<void>((r) => c.cola.push(r)); // quien suelta nos lo pasa ya tomado
}
function soltar(clave: string) {
  const c = candados.get(clave)!;
  const sig = c.cola.shift();
  if (sig) sig();
  else c.tomado = false;
}

async function barrera() {
  const b = opciones.barrera;
  if (!b) return;
  b.llegados += 1;
  if (b.llegados >= 2) { b.despertar.splice(0).forEach((f) => f()); return; }
  await new Promise<void>((r) => { b.despertar.push(r); setTimeout(r, 50); });
}

function falla(op: string) {
  if (opciones.fallarEn === op) throw new Error(`fallo provocado en ${op}`);
}

// ── Delegados (con registro para deshacer si la transacción lanza) ──────────
type Ctx = { deshacer: Array<() => void> | null; candados: string[] };

function delegados(ctx: Ctx) {
  const insertar = (tabla: Row[], fila: Row) => {
    tabla.push(fila);
    ctx.deshacer?.push(() => tabla.splice(tabla.indexOf(fila), 1));
  };
  const modificar = (fila: Row, data: Row) => {
    const antes = { ...fila };
    for (const [k, v] of Object.entries(data)) if (v !== undefined) fila[k] = v;
    ctx.deshacer?.push(() => { for (const k of Object.keys(fila)) delete fila[k]; Object.assign(fila, antes); });
  };
  const columnasNuevas = ["invoiceId", "paymentId", "reversesId", "createdById"];
  const tocaColumnasNuevas = (obj: any) => obj && columnasNuevas.some((c) => c in obj);
  const sinColumnas = () => Object.assign(new Error("The column `invoiceId` does not exist"), { code: "P2022" });

  return {
    invoice: {
      findFirst: async ({ where, select }: any = {}) => {
        const f = db.invoices.find((r) => cumple(r, where));
        const leida = f ? proyectar(f, select) : null;
        if (f && opciones.alLeerFactura) { const hook = opciones.alLeerFactura; opciones.alLeerFactura = null; hook(f); }
        return leida;
      },
      deleteMany: async ({ where }: any) => {
        const filas = db.invoices.filter((r) => cumple(r, where));
        filas.forEach((f) => db.invoices.splice(db.invoices.indexOf(f), 1));
        return { count: filas.length };
      },
      create: async ({ data, include }: any) => {
        const fila: Row = {
          id: nuevoId("inv"), createdAt: new Date(), updatedAt: new Date(), paid: 0, discount: 0,
          status: "PENDING", cfdiUuid: null, paidAt: null, notes: null, doctorId: null, dueDate: null,
          appointmentId: null, paymentMethod: null, taxRate: 16, taxIncluded: true,
        };
        for (const [k, v] of Object.entries(data)) if (v !== undefined) fila[k] = v;
        insertar(db.invoices, fila);
        return include?.patient ? { ...fila, patient: { id: fila.patientId, firstName: "Ana", portalToken: "secreto" } } : { ...fila };
      },
      updateMany: async ({ where, data }: any) => {
        const filas = db.invoices.filter((r) => cumple(r, where));
        filas.forEach((f) => modificar(f, data));
        return { count: filas.length };
      },
    },
    payment: {
      create: async ({ data, select }: any) => {
        falla("payment.create");
        const fila = { id: nuevoId("pay"), paidAt: new Date(), reference: null, notes: null, ...data };
        insertar(db.payments, fila);
        return proyectar(fila, select);
      },
      count: async ({ where }: any) => db.payments.filter((r) => cumple(r, where)).length,
    },
    patientCredit: {
      findFirst: async ({ where, select }: any) => {
        if (opciones.faltanColumnas && tocaColumnasNuevas(where)) throw sinColumnas();
        const f = db.credits.find((r) => cumple(r, where));
        return f ? proyectar(f, select) : null;
      },
      findMany: async ({ where, select }: any) => {
        if (opciones.faltanColumnas && tocaColumnasNuevas(where)) throw sinColumnas();
        return db.credits.filter((r) => cumple(r, where)).map((r) => proyectar(r, select));
      },
      aggregate: async ({ where }: any) => {
        await barrera();
        const suma = db.credits.filter((r) => cumple(r, where)).reduce((s, r) => s + r.amount, 0);
        return { _sum: { amount: suma } };
      },
      create: async ({ data }: any) => {
        falla("patientCredit.create");
        if (opciones.faltanColumnas && tocaColumnasNuevas(data)) throw sinColumnas();
        const fila: Row = {
          id: nuevoId("cred"), description: null, source: "migrated", creditDate: new Date(), createdAt: new Date(),
          invoiceId: null, paymentId: null, reversesId: null, createdById: null, ...data,
        };
        // Las restricciones del SQL.
        const choca = (campo: string) => fila[campo] != null && db.credits.some((c) => c[campo] === fila[campo]);
        if (choca("paymentId") || choca("reversesId")) throw Object.assign(new Error("unique"), { code: "P2002" });
        if (fila.source === FUENTE_APLICADO && db.credits.some((c) => c.source === FUENTE_APLICADO && c.invoiceId === fila.invoiceId)) {
          throw Object.assign(new Error("patient_credits_una_aplicacion_por_factura"), { code: "P2002" });
        }
        if ((fila.amount < 0) !== (fila.source === FUENTE_APLICADO)) throw new Error("patient_credits_signo_chk");
        insertar(db.credits, fila);
        return { ...fila };
      },
    },
  };
}

function sqlDe(partes: TemplateStringsArray) {
  return partes.join("?");
}

const prismaDoble: any = {
  ...delegados({ deshacer: null, candados: [] }),
  // Fuera de transacción no hay candados que tomar.
  $queryRaw: async () => [],
  $executeRaw: async () => 0,
  $transaction: async (arg: any) => {
    if (typeof arg !== "function") return Promise.all(arg);
    const ctx: Ctx = { deshacer: [], candados: [] };
    const tx: any = {
      ...delegados(ctx),
      $queryRaw: async (partes: TemplateStringsArray, ...vals: any[]) => {
        const sql = sqlDe(partes);
        if (/FOR UPDATE/i.test(sql) && /invoices/.test(sql)) {
          const clave = `fila:invoices:${vals[0]}`;
          if (!ctx.candados.includes(clave)) { await tomar(clave); ctx.candados.push(clave); }
          return [];
        }
        throw new Error(`el doble no conoce este SQL: ${sql}`);
      },
      $executeRaw: async (partes: TemplateStringsArray, ...vals: any[]) => {
        const sql = sqlDe(partes);
        if (/pg_advisory_xact_lock\(hashtext\(/.test(sql)) {
          if (!opciones.respetarAdvisory) return 0;
          const clave = `advisory:${vals[0]}`;
          if (!ctx.candados.includes(clave)) { await tomar(clave); ctx.candados.push(clave); }
          return 0;
        }
        throw new Error(`el doble no conoce este SQL: ${sql}`);
      },
    };
    try {
      return await arg(tx);
    } catch (e) {
      ctx.deshacer!.reverse().forEach((f) => f());
      throw e;
    } finally {
      ctx.candados.reverse().forEach(soltar);
    }
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Módulos que las rutas importan
// ═══════════════════════════════════════════════════════════════════════════
const sesion: any = { clinicId: "c1", userId: "u1", role: "ADMIN", permissionsOverride: null, clinic: { timezone: "America/Mexico_City" } };
let folio = 0;

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaDoble } });
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => sesion } });
(mock as any).module("next/cache", { namedExports: { revalidatePath: () => {}, revalidateTag: () => {} } });
(mock as any).module("@/lib/audit", {
  namedExports: {
    logMutation: async (o: any) => { auditoria.push(o); },
    logAudit: async (o: any) => { auditoria.push(o); },
  },
});
(mock as any).module("@/lib/cache/revalidate", { namedExports: { revalidateAfter: () => {} } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, relatedPatientVisibilityAnd: () => [] },
});
(mock as any).module("@/lib/invoices/next-invoice-number", {
  namedExports: {
    nextInvoiceNumber: async () => `MF-${String(++folio).padStart(4, "0")}`,
    withInvoiceNumberRetry: (fn: () => Promise<any>) => fn(),
    InvoiceNumberExhaustedError: class extends Error {},
  },
});

const rutas = async () => ({
  crear: (await import("@/app/api/invoices/route")).POST,
  confirmar: (await import("@/app/api/invoices/[id]/confirm/route")).POST,
  cancelar: (await import("@/app/api/invoices/[id]/cancel/route")).POST,
  factura: await import("@/app/api/invoices/[id]/route"),
  servicio: await import("@/lib/patient-credit-aplicar"),
});

function req(body?: any): any {
  return { json: async () => body ?? {}, headers: new Headers(), url: "http://localhost/api/invoices" };
}
async function leer(res: any) {
  return { status: res.status, body: await res.json() };
}
function silencio<T>(fn: () => Promise<T>): Promise<T> {
  const orig = console.error;
  console.error = () => {};
  return fn().finally(() => { console.error = orig; });
}

// ── Siembra ─────────────────────────────────────────────────────────────────
function sembrarCredito(amount: number, over: Row = {}) {
  const fila = {
    id: nuevoId("cred"), clinicId: "c1", patientId: "p1", amount, description: null, source: "migrated",
    creditDate: new Date("2026-06-21"), createdAt: new Date("2026-06-21"),
    invoiceId: null, paymentId: null, reversesId: null, createdById: null, ...over,
  };
  db.credits.push(fila);
  return fila;
}
function sembrarFactura(over: Row) {
  const fila = {
    id: nuevoId("inv"), clinicId: "c1", patientId: "p1", invoiceNumber: `MF-V${db.seq}`,
    items: [{ description: "Tratamiento", quantity: 1, unitPrice: over.total ?? 1000, total: over.total ?? 1000 }],
    subtotal: over.total ?? 1000, discount: 0, total: 1000, paid: 0, balance: 1000, status: "PENDING",
    paymentMethod: null, notes: null, dueDate: null, paidAt: null, cfdiUuid: null, doctorId: null,
    appointmentId: null, taxRate: 0, taxIncluded: true,
    createdAt: new Date("2026-05-01T12:00:00Z"), updatedAt: new Date("2026-05-01T12:00:00Z"), ...over,
  };
  db.invoices.push(fila);
  return fila;
}
const cuerpo = (total: number, patientId = "p1") => ({
  patientId,
  items: [{ description: "Resina", quantity: 1, unitPrice: total, total }],
  discount: 0,
  taxRate: 0,
});
const saldo = (patientId = "p1", clinicId = "c1") =>
  Math.round(db.credits.filter((c) => c.clinicId === clinicId && c.patientId === patientId).reduce((s, c) => s + c.amount, 0) * 100) / 100;
const pagosAnticipo = (invoiceId?: string) =>
  db.payments.filter((p) => p.method === METODO_ANTICIPO && (!invoiceId || p.invoiceId === invoiceId));

/**
 * El dinero no se crea ni se destruye: lo que sigue a favor + lo que las
 * facturas VIVAS conservan del anticipo = lo que entró a favor. Y cada fila
 * negativa tiene su Payment «anticipo» del mismo importe (y viceversa).
 */
function assertCuadra(entroAFavor: number, patientId = "p1") {
  const vivas = db.invoices.filter((i) => i.patientId === patientId && i.status !== "CANCELLED");
  const retenido = vivas.reduce((s, i) => {
    const ant = pagosAnticipo(i.id).reduce((a, p) => a + p.amount, 0);
    return s + Math.min(i.paid, ant);
  }, 0);
  assert.equal(Math.round((saldo(patientId) + retenido) * 100) / 100, entroAFavor, "saldo + aplicado vivo = lo que entró a favor");
  const aplicaciones = db.credits.filter((c) => c.patientId === patientId && c.source === FUENTE_APLICADO);
  for (const a of aplicaciones) {
    const pago = db.payments.find((p) => p.id === a.paymentId);
    assert.ok(pago, "cada aplicación tiene su Payment");
    assert.equal(pago!.method, METODO_ANTICIPO);
    assert.equal(pago!.amount, -a.amount, "la fila negativa y el Payment son el mismo dinero");
    assert.equal(pago!.invoiceId, a.invoiceId);
  }
  assert.equal(pagosAnticipo().filter((p) => db.invoices.find((i) => i.id === p.invoiceId)?.patientId === patientId).length, aplicaciones.length);
  for (const i of db.invoices) assert.ok(i.balance >= 0, `balance negativo en ${i.invoiceNumber}`);
}

beforeEach(() => {
  db.invoices = []; db.payments = []; db.credits = []; db.seq = 0;
  opciones.respetarAdvisory = true; opciones.faltanColumnas = false; opciones.fallarEn = null; opciones.barrera = null;
  opciones.alLeerFactura = null;
  auditoria.length = 0;
  candados.clear();
});

// ═══════════════════════════════════════════════════════════════════════════
// Lo que pidió Rafael: $1,000 de factura y $200 de anticipo → debe $800
// ═══════════════════════════════════════════════════════════════════════════
test("anticipo MENOR que la factura: $1,000 con $200 a favor → la factura nace debiendo $800", async () => {
  const { crear } = await rutas();
  sembrarCredito(200, { source: "anticipo_mercadopago" });

  const r = await leer(await crear(req(cuerpo(1000))));
  assert.equal(r.status, 201);
  assert.equal(r.body.anticipoAplicado, 200);
  assert.equal(r.body.total, 1000, "el total NO cambia: el anticipo no es un descuento");
  assert.equal(r.body.paid, 200);
  assert.equal(r.body.balance, 800);
  assert.equal(r.body.status, "PARTIAL");
  assert.equal(r.body.patient?.portalToken, undefined, "la respuesta sigue sin secretos del paciente");

  const inv = db.invoices[0];
  assert.deepEqual([inv.paid, inv.balance, inv.status], [200, 800, "PARTIAL"]);
  assert.equal(saldo(), 0, "el saldo a favor bajó lo mismo que subió lo pagado");

  // Rastro: quién, cuándo, contra qué factura.
  const aplicacion = db.credits.find((c) => c.source === FUENTE_APLICADO)!;
  assert.equal(aplicacion.amount, -200);
  assert.equal(aplicacion.invoiceId, inv.id);
  assert.equal(aplicacion.createdById, "u1");
  assert.ok(aplicacion.creditDate instanceof Date);
  assert.match(aplicacion.description, new RegExp(inv.invoiceNumber));
  const pago = pagosAnticipo(inv.id)[0];
  assert.equal(aplicacion.paymentId, pago.id);
  assert.equal(pago.amount, 200);
  const audit = auditoria.find((a) => a.action === "create");
  assert.equal(audit.after.anticipoAplicado, 200);
  assertCuadra(200);
});

test("anticipo IGUAL a la factura: nace PAGADA, saldo 0 y el crédito a 0", async () => {
  const { crear } = await rutas();
  sembrarCredito(1000);
  const r = await leer(await crear(req(cuerpo(1000))));
  assert.equal(r.body.anticipoAplicado, 1000);
  assert.deepEqual([r.body.paid, r.body.balance, r.body.status], [1000, 0, "PAID"]);
  assert.ok(db.invoices[0].paidAt instanceof Date, "PAID lleva paidAt");
  assert.equal(saldo(), 0);
  assertCuadra(1000);
});

test("anticipo MAYOR que la factura: solo se aplica lo que cabe y el resto SIGUE a favor", async () => {
  const { crear } = await rutas();
  sembrarCredito(1500);
  const r = await leer(await crear(req(cuerpo(1000))));
  assert.equal(r.body.anticipoAplicado, 1000);
  assert.deepEqual([r.body.paid, r.body.balance, r.body.status], [1000, 0, "PAID"]);
  assert.equal(saldo(), 500, "los $500 que no cupieron siguen a favor");

  // La siguiente factura se lleva lo que quedó, y nada más.
  const r2 = await leer(await crear(req(cuerpo(300))));
  assert.equal(r2.body.anticipoAplicado, 300);
  assert.equal(r2.body.balance, 0);
  assert.equal(saldo(), 200);
  const r3 = await leer(await crear(req(cuerpo(700))));
  assert.equal(r3.body.anticipoAplicado, 200);
  assert.deepEqual([r3.body.paid, r3.body.balance, r3.body.status], [200, 500, "PARTIAL"]);
  assert.equal(saldo(), 0);
  assertCuadra(1500);
});

test("sin saldo a favor la factura nace exactamente como hoy (ni Payment ni fila de crédito)", async () => {
  const { crear } = await rutas();
  const r = await leer(await crear(req(cuerpo(1000))));
  assert.equal(r.body.anticipoAplicado, 0);
  assert.deepEqual([r.body.paid, r.body.balance, r.body.status], [0, 1000, "PENDING"]);
  assert.equal(db.payments.length, 0);
  assert.equal(db.credits.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Concurrencia: el mismo saldo a favor no se gasta dos veces
// ═══════════════════════════════════════════════════════════════════════════
async function dosFacturasALaVez() {
  const { crear } = await rutas();
  sembrarCredito(600);
  opciones.barrera = { llegados: 0, despertar: [] };
  const [a, b] = await Promise.all([crear(req(cuerpo(1000))), crear(req(cuerpo(1000)))].map((p) => p.then(leer)));
  return [a.body.anticipoAplicado, b.body.anticipoAplicado].sort((x, y) => x - y);
}

test("dos facturas a la vez contra $600 a favor: una se lleva los $600 y la otra nada", async () => {
  const aplicados = await dosFacturasALaVez();
  assert.deepEqual(aplicados, [0, 600]);
  assert.equal(saldo(), 0);
  assert.equal(pagosAnticipo().reduce((s, p) => s + p.amount, 0), 600, "en total se abonaron $600, no $1,200");
  assertCuadra(600);
});

test("…y la prueba de arriba SÍ caza el doble gasto: sin el candado por paciente se aplican $1,200", async () => {
  opciones.respetarAdvisory = false;
  const aplicados = await dosFacturasALaVez();
  assert.deepEqual(aplicados, [600, 600], "sin candado las dos leen $600 a la vez");
  assert.equal(saldo(), -600, "el saldo a favor quedaría negativo: dinero contado dos veces");
});

test("la MISMA factura aplicada dos veces a la vez recibe el saldo una sola vez", async () => {
  const { servicio } = await rutas();
  sembrarCredito(600);
  const inv = sembrarFactura({ createdAt: new Date(), total: 1000, balance: 1000 });
  const [a, b] = await Promise.all([
    servicio.aplicarSaldoAFavor({ clinicId: "c1", invoiceId: inv.id, userId: "u1", origen: "creada" }),
    servicio.aplicarSaldoAFavor({ clinicId: "c1", invoiceId: inv.id, userId: "u1", origen: "creada" }),
  ]);
  assert.deepEqual([a.aplicado, b.aplicado].sort(), [0, 600]);
  assert.equal(inv.paid, 600);
  assert.equal(pagosAnticipo(inv.id).length, 1);
  // Y una tercera, ya en frío, tampoco.
  const c = await servicio.aplicarSaldoAFavor({ clinicId: "c1", invoiceId: inv.id, userId: "u1", origen: "creada" });
  assert.equal(c.aplicado, 0);
  assertCuadra(600);
});

// ═══════════════════════════════════════════════════════════════════════════
// Cancelar deshace: el dinero vuelve a favor
// ═══════════════════════════════════════════════════════════════════════════
test("cancelar una factura con anticipo aplicado devuelve el dinero a favor, con rastro, una sola vez", async () => {
  const { crear, cancelar } = await rutas();
  sembrarCredito(200);
  const creada = await leer(await crear(req(cuerpo(1000))));
  const id = creada.body.id;
  assert.equal(saldo(), 0);

  sesion.userId = "u2";
  try {
    const r = await leer(await cancelar(req({ reason: "se equivocó de paciente" }), { params: { id } }));
    assert.equal(r.status, 200);
    assert.equal(r.body.anticipoDevuelto, 200);
  } finally {
    sesion.userId = "u1";
  }
  const inv = db.invoices.find((i) => i.id === id)!;
  assert.deepEqual([inv.status, inv.paid, inv.balance, inv.paidAt], ["CANCELLED", 0, 1000, null]);
  assert.match(inv.notes, /\[CANCELADA: se equivocó de paciente\]/);
  assert.equal(saldo(), 200, "los $200 vuelven a estar a favor");

  const aplicacion = db.credits.find((c) => c.source === FUENTE_APLICADO)!;
  const devolucion = db.credits.find((c) => c.source === FUENTE_DEVUELTO)!;
  assert.equal(devolucion.amount, 200);
  assert.equal(devolucion.reversesId, aplicacion.id);
  assert.equal(devolucion.invoiceId, id);
  assert.equal(devolucion.createdById, "u2", "quién canceló");
  const reembolso = db.payments.find((p) => p.invoiceId === id && p.method === "refund")!;
  assert.equal(reembolso.amount, 200);

  // Segunda cancelación: nada se mueve.
  const otra = await leer(await cancelar(req({}), { params: { id } }));
  assert.equal(otra.status, 400);
  assert.equal(saldo(), 200);
  assert.equal(db.credits.filter((c) => c.source === FUENTE_DEVUELTO).length, 1);

  // La devolución directa repetida tampoco devuelve dos veces.
  const { servicio } = await rutas();
  const r2 = await prismaDoble.$transaction((tx: any) =>
    servicio.devolverAnticipoAlCancelar(tx, { clinicId: "c1", invoice: { id, patientId: "p1", invoiceNumber: inv.invoiceNumber, paid: 200 }, userId: "u1" }),
  );
  assert.equal(r2.devuelto, 0);
  assert.equal(saldo(), 200);

  // Y la siguiente factura lo vuelve a recibir.
  const nueva = await leer(await crear(req(cuerpo(500))));
  assert.equal(nueva.body.anticipoAplicado, 200);
  assert.equal(saldo(), 0);
  assertCuadra(200);
});

test("una factura PAGADA solo con el anticipo también se cancela y lo devuelve", async () => {
  const { crear, cancelar } = await rutas();
  sembrarCredito(1000);
  const { body } = await leer(await crear(req(cuerpo(1000))));
  assert.equal(body.status, "PAID");
  const r = await leer(await cancelar(req({}), { params: { id: body.id } }));
  assert.equal(r.status, 200);
  assert.equal(saldo(), 1000);
  assertCuadra(1000);
});

test("con pagos que NO son anticipo, cancelar sigue pidiendo reembolsar primero y no mueve nada", async () => {
  const { crear, cancelar } = await rutas();
  sembrarCredito(200);
  const { body } = await leer(await crear(req(cuerpo(1000))));
  const inv = db.invoices.find((i) => i.id === body.id)!;
  // Recepción cobra $300 en efectivo.
  db.payments.push({ id: "cash1", invoiceId: inv.id, amount: 300, method: "cash", paidAt: new Date() });
  inv.paid = 500; inv.balance = 500;
  const antes = clonar({ inv, credits: db.credits, payments: db.payments });

  const r = await leer(await cancelar(req({}), { params: { id: inv.id } }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /300\.00 pagados además del anticipo/);
  assert.deepEqual(clonar({ inv, credits: db.credits, payments: db.payments }), antes, "nada cambió");
});

test("cancelar una factura con pagos y SIN anticipo responde lo mismo que antes", async () => {
  const { cancelar } = await rutas();
  const pagada = sembrarFactura({ total: 500, paid: 500, balance: 0, status: "PAID" });
  const parcial = sembrarFactura({ total: 500, paid: 100, balance: 400, status: "PARTIAL" });
  const a = await leer(await cancelar(req({}), { params: { id: pagada.id } }));
  const b = await leer(await cancelar(req({}), { params: { id: parcial.id } }));
  assert.deepEqual([a.status, a.body.error], [400, "No se puede cancelar una factura pagada — usa Reembolsar"]);
  assert.deepEqual([b.status, b.body.error], [400, "Esta factura tiene pagos registrados — usa Reembolsar primero"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// SOLO FACTURAS NUEVAS: las que existían se quedan exactamente como están
// ═══════════════════════════════════════════════════════════════════════════
test("las facturas viejas quedan IDÉNTICAS: el crédito de $600 va a la siguiente factura, no a la de $36,000", async () => {
  const { crear, confirmar, cancelar } = await rutas();
  // El caso real de producción: $600 migrados y una factura vieja de $36,000.
  sembrarCredito(600, { source: "migrated" });
  const vieja = sembrarFactura({ total: 36000, balance: 36000, invoiceNumber: "MF-0100" });
  const parcial = sembrarFactura({ total: 5000, paid: 1000, balance: 4000, status: "PARTIAL", invoiceNumber: "MF-0101" });
  const borrador = sembrarFactura({ total: 900, balance: 900, status: "DRAFT", invoiceNumber: "MF-0102" });
  const otraClinica = sembrarFactura({ clinicId: "c2", total: 800, balance: 800, invoiceNumber: "MF-0001" });
  const fotoPagos = clonar(db.payments);
  const foto = clonar([vieja, parcial, otraClinica]);

  // Llega una factura nueva.
  const nueva = await leer(await crear(req(cuerpo(1000))));
  assert.equal(nueva.body.anticipoAplicado, 600);
  assert.equal(nueva.body.balance, 400);

  // Confirmar el borrador VIEJO: pasa a PENDING como siempre, sin saldo a favor.
  sembrarCredito(50, { source: "anticipo_mercadopago" });
  const conf = await leer(await confirmar(req(), { params: { id: borrador.id } }));
  assert.equal(conf.status, 200);
  assert.equal(conf.body.anticipoAplicado, 0);
  assert.deepEqual([borrador.status, borrador.paid, borrador.balance], ["PENDING", 0, 900]);
  assert.equal(saldo(), 50, "el borrador viejo no se llevó los $50");

  // Cancelar una factura vieja sin pagos: el mismo resultado de siempre.
  const sinPagos = sembrarFactura({ total: 300, balance: 300, invoiceNumber: "MF-0103" });
  const c = await leer(await cancelar(req({ reason: "duplicada" }), { params: { id: sinPagos.id } }));
  assert.deepEqual([c.status, c.body], [200, { success: true }]);
  assert.deepEqual([sinPagos.status, sinPagos.paid, sinPagos.balance, sinPagos.notes], ["CANCELLED", 0, 300, "[CANCELADA: duplicada]"]);

  assert.deepEqual(clonar([vieja, parcial, otraClinica]), foto, "ni un campo de las facturas viejas cambió");
  assert.deepEqual(
    db.payments.filter((p) => [vieja.id, parcial.id, borrador.id, otraClinica.id, sinPagos.id].includes(p.invoiceId)),
    fotoPagos,
    "ni un Payment nuevo en facturas viejas",
  );
  assert.ok(db.credits.every((c) => c.invoiceId == null || c.invoiceId === nueva.body.id));
});

test("un borrador NUEVO que se confirma sí recibe el saldo a favor (y la pantalla se entera)", async () => {
  const { confirmar } = await rutas();
  sembrarCredito(250);
  const borrador = sembrarFactura({
    total: 900, balance: 900, status: "DRAFT",
    createdAt: new Date(APLICAR_SALDO_DESDE.getTime() + 60_000),
  });
  const r = await leer(await confirmar(req(), { params: { id: borrador.id } }));
  assert.equal(r.status, 200);
  assert.equal(r.body.anticipoAplicado, 250);
  assert.equal(r.body.balance, 650, "lo que queda por cobrar, para no cobrar sobre el total del borrador");
  assert.deepEqual([borrador.status, borrador.paid], ["PARTIAL", 250]);
  const aplicacion = db.credits.find((c) => c.source === FUENTE_APLICADO)!;
  assert.match(aplicacion.description, /al confirmarla/);
  assertCuadra(250);
});

// ═══════════════════════════════════════════════════════════════════════════
// Carreras alrededor de un borrador: el saldo aplicado nunca se queda huérfano
// ═══════════════════════════════════════════════════════════════════════════
test("confirmar un borrador que otra persona canceló entre la lectura y el UPDATE: 409, no revive ni recibe saldo", async () => {
  const { confirmar } = await rutas();
  sembrarCredito(300);
  const b = sembrarFactura({ status: "DRAFT", createdAt: new Date(APLICAR_SALDO_DESDE.getTime() + 60_000) });
  opciones.alLeerFactura = (f) => { f.status = "CANCELLED"; };
  const r = await leer(await confirmar(req(), { params: { id: b.id } }));
  assert.equal(r.status, 409);
  assert.deepEqual([b.status, b.paid], ["CANCELLED", 0]);
  assert.equal(saldo(), 300);
  assert.equal(db.payments.length, 0);
});

test("borrar un borrador que otra persona confirmó (y recibió el saldo) mientras tanto: 409 y no se borra", async () => {
  const { factura } = await rutas();
  sembrarCredito(1000);
  const b = sembrarFactura({ status: "DRAFT" });
  // Entre la lectura del DELETE y el borrado, alguien lo confirma y se aplica el anticipo.
  opciones.alLeerFactura = (f) => { Object.assign(f, { status: "PAID", paid: 1000, balance: 0 }); };
  const r = await leer(await factura.DELETE(req(), { params: { id: b.id } }));
  assert.equal(r.status, 409);
  assert.ok(db.invoices.includes(b), "la factura sigue ahí: cancelarla devolvería el anticipo");
});

test("editar los conceptos de un borrador que se confirmó mientras tanto: 409 y el total no baja de lo aplicado", async () => {
  const { factura } = await rutas();
  const b = sembrarFactura({ status: "DRAFT", total: 1000, balance: 1000 });
  opciones.alLeerFactura = (f) => { Object.assign(f, { status: "PAID", paid: 1000, balance: 0 }); };
  const items = [{ description: "Resina", quantity: 1, unitPrice: 500, total: 500 }];
  const r = await leer(await factura.PATCH(req({ items }), { params: { id: b.id } }));
  assert.equal(r.status, 409);
  assert.deepEqual([b.total, b.paid, b.balance], [1000, 1000, 0]);
});

test("«anticipo» no se puede teclear como método de pago", async () => {
  const { factura } = await rutas();
  const inv = sembrarFactura({});
  const r = await leer(await factura.POST(req({ amount: 100, method: METODO_ANTICIPO }), { params: { id: inv.id } }));
  assert.equal(r.status, 400);
  assert.equal(db.payments.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Aislamiento por clínica
// ═══════════════════════════════════════════════════════════════════════════
test("el crédito de otra clínica no existe, y la factura de otra clínica no se toca", async () => {
  const { crear, servicio } = await rutas();
  sembrarCredito(700, { clinicId: "c2" }); // mismo patientId, OTRA clínica
  const r = await leer(await crear(req(cuerpo(1000))));
  assert.equal(r.body.anticipoAplicado, 0, "el saldo de c2 no se aplica en c1");
  assert.equal(saldo("p1", "c2"), 700);

  // Con la sesión de c2 no se alcanza una factura de c1.
  sembrarCredito(100);
  const deC1 = db.invoices[0];
  const x = await servicio.aplicarSaldoAFavor({ clinicId: "c2", invoiceId: deC1.id, userId: "u9", origen: "creada" });
  assert.equal(x.aplicado, 0);
  assert.equal(x.motivo, "factura no encontrada");
  assert.equal(deC1.paid, 0);
  // Sin clinicId no se consulta nada.
  const y = await servicio.aplicarSaldoAFavor({ clinicId: "", invoiceId: deC1.id, userId: "u1", origen: "creada" });
  assert.equal(y.motivo, "faltan datos");
});

// ═══════════════════════════════════════════════════════════════════════════
// Todo o nada, y sin el SQL todo sigue como hoy
// ═══════════════════════════════════════════════════════════════════════════
test("si la aplicación falla a medias no queda nada escrito: ni Payment ni crédito gastado", async () => {
  const { crear } = await rutas();
  sembrarCredito(200);
  opciones.fallarEn = "patientCredit.create";
  const r = await silencio(async () => leer(await crear(req(cuerpo(1000)))));
  assert.equal(r.status, 201, "la factura se creó: el error no la tumba (un reintento crearía otra)");
  assert.equal(r.body.anticipoAplicado, 0);
  assert.deepEqual([r.body.paid, r.body.balance, r.body.status], [0, 1000, "PENDING"]);
  assert.equal(db.payments.length, 0, "el Payment se deshizo con la transacción");
  assert.equal(saldo(), 200, "el saldo a favor sigue entero");
});

test("sin el SQL aplicado (columnas nuevas inexistentes) las facturas se crean y cancelan como hoy", async () => {
  const { crear, cancelar } = await rutas();
  opciones.faltanColumnas = true;
  sembrarCredito(200);
  const r = await leer(await crear(req(cuerpo(1000))));
  assert.equal(r.status, 201);
  assert.equal(r.body.anticipoAplicado, 0);
  assert.equal(db.payments.length, 0);
  assert.equal(saldo(), 200);
  const c = await leer(await cancelar(req({}), { params: { id: r.body.id } }));
  assert.equal(c.status, 200);
});

// ═══════════════════════════════════════════════════════════════════════════
// El SAT: la guarda del timbrado sigue cerrando
// ═══════════════════════════════════════════════════════════════════════════
test("una factura con anticipo aplicado sigue cuadrando para timbrar (cfdiCuadre)", async () => {
  const { crear } = await rutas();
  sembrarCredito(200);
  const exenta = await leer(await crear(req(cuerpo(1000))));
  const incluido = await leer(await crear(req({ ...cuerpo(1160), taxRate: 16, taxIncluded: true })));
  for (const inv of [exenta.body, incluido.body]) {
    const c = cfdiCuadre({
      items: inv.items, discount: inv.discount, total: inv.total,
      taxMode: inv.taxRate === 0 ? "exento" : "iva16", taxIncluded: inv.taxIncluded,
    });
    assert.equal(c.ok, true, `cuadra ${inv.invoiceNumber}`);
    assert.equal(c.invoiceTotal, inv.total, "el total que timbra es el de la factura, no lo que resta cobrar");
  }
  // Y si alguien llegara a restar el anticipo del TOTAL, la guarda lo bloquearía.
  const roto = cfdiCuadre({ items: exenta.body.items, discount: 0, total: exenta.body.total - 200, taxMode: "exento", taxIncluded: true });
  assert.equal(roto.ok, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Aritmética pura
// ═══════════════════════════════════════════════════════════════════════════
test("montoAAplicar: nunca negativo, nunca más que lo pendiente, redondeado a centavos", () => {
  assert.equal(montoAAplicar(200, 1000, 0), 200);
  assert.equal(montoAAplicar(1000, 1000, 0), 1000);
  assert.equal(montoAAplicar(1500, 1000, 0), 1000);
  assert.equal(montoAAplicar(1500, 1000, 400), 600);
  assert.equal(montoAAplicar(0, 1000, 0), 0);
  assert.equal(montoAAplicar(-50, 1000, 0), 0);
  assert.equal(montoAAplicar(500, 1000, 1000), 0);
  assert.equal(montoAAplicar(0.1 + 0.2, 1000, 0), 0.3);
});

test("repartoAlCancelar y pagadoEsSoloAnticipo: un reembolso sale primero de lo que no es anticipo", () => {
  assert.deepEqual(repartoAlCancelar(200, 200), { devolver: 200, otrosPagos: 0 });
  assert.deepEqual(repartoAlCancelar(500, 200), { devolver: 200, otrosPagos: 300 });
  assert.deepEqual(repartoAlCancelar(1000, 999.99), { devolver: 999.99, otrosPagos: 0.01 }, "un centavo que no es anticipo también cuenta");
  // $200 anticipo + $800 efectivo, reembolsados $800: queda el anticipo entero.
  assert.deepEqual(repartoAlCancelar(200, 200), { devolver: 200, otrosPagos: 0 });
  // Reembolsado todo en efectivo: ya se le entregó, no vuelve a favor.
  assert.deepEqual(repartoAlCancelar(0, 200), { devolver: 0, otrosPagos: 0 });
  assert.equal(pagadoEsSoloAnticipo(200, [{ method: "anticipo", amount: 200 }]), true);
  assert.equal(pagadoEsSoloAnticipo(500, [{ method: "anticipo", amount: 200 }, { method: "cash", amount: 300 }]), false);
  assert.equal(pagadoEsSoloAnticipo(200, [{ method: "cash", amount: 200 }]), false);
  assert.equal(pagadoEsSoloAnticipo(0, [{ method: "anticipo", amount: 200 }]), false);
});
