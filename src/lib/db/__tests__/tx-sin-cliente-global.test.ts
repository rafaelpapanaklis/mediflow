/**
 * ws1-t11 v4 — nada usa el `prisma` GLOBAL con una transacción interactiva
 * abierta (hermanos que encontró t12).
 *
 * Run: npm run test:tx-sin-cliente-global
 *
 * Un helper que consulta con el cliente global desde dentro de una
 * `$transaction` interactiva ocupa una SEGUNDA conexión del pooler mientras la
 * de la transacción sigue abierta, y lo que escribe queda FUERA de ella:
 *   1. setPrimaryGuardian → ensurePediatricRecord;
 *   2. cobrarProcedimientoDeHoja → crearFacturaDesdeCita (y lo que llama: folio,
 *      doctor, saldo a favor) y vincularExtraAlCaso — la factura nacía fuera de la tx;
 *   3. presupuestoDesdeElPlan → createQuoteWithFolio.
 *
 * El doble de Prisma LANZA si se usa el cliente global con una transacción
 * abierta, y su `tx` imita a Postgres: después de un error la transacción queda
 * abortada («current transaction is aborted») salvo ROLLBACK TO SAVEPOINT. Así
 * se prueba también que el reintento del folio sigue funcionando dentro de una tx.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { preparar, respuestas, Redireccion } from "../../auth/__tests__/_arnes-paginas-server";

// ── el doble ──
let abiertas = 0;
let abortada = false;
const usosGlobalesConTx: string[] = [];
const sentencias: string[] = [];
let fallos: Array<{ quien: string; error: unknown }> = [];

function responder(quien: string, args: unknown[]) {
  const i = fallos.findIndex((f) => f.quien === quien);
  if (i >= 0) {
    const [f] = fallos.splice(i, 1);
    throw f.error;
  }
  const r = respuestas.get(quien);
  if (r) return r(...args);
  const metodo = quien.split(".").pop()!;
  if (metodo.startsWith("findMany")) return [];
  if (/^(create|update|upsert)$/.test(metodo)) return { id: `${quien}_id`, ...(((args[0] as any)?.data) ?? {}) };
  if (/Many$/.test(metodo)) return { count: 1 };
  return null;
}

function cliente(tipo: "global" | "tx"): any {
  const raw = (nombre: string) => (...args: unknown[]) => {
    const texto = Array.isArray(args[0]) ? (args[0] as string[]).join("?") : String(args[0]);
    if (tipo === "global" && abiertas > 0) {
      usosGlobalesConTx.push(nombre);
      return Promise.reject(new Error(`cliente GLOBAL con una transacción abierta: ${nombre}`));
    }
    if (tipo === "tx") {
      sentencias.push(texto.trim().split(/\s+/).slice(0, 4).join(" "));
      if (/^ROLLBACK TO SAVEPOINT/.test(texto.trim())) { abortada = false; return Promise.resolve(0); }
      if (abortada) return Promise.reject(new Error("current transaction is aborted"));
    }
    return Promise.resolve(nombre === "$queryRaw" ? (respuestas.get(`${tipo}.$queryRaw`)?.(texto) ?? []) : 0);
  };
  return new Proxy({}, {
    get(_t, modelo) {
      if (modelo === "then") return undefined;
      if (modelo === "$transaction") {
        if (tipo === "tx") return undefined;
        return async (f: any) => {
          if (Array.isArray(f)) return Promise.all(f);
          abiertas++;
          abortada = false;
          try { return await f(cliente("tx")); } finally { abiertas--; }
        };
      }
      if (typeof modelo === "string" && modelo.startsWith("$")) return raw(modelo);
      return new Proxy({}, {
        get(_t2, metodo) {
          if (metodo === "then") return undefined;
          const quien = `${String(modelo)}.${String(metodo)}`;
          return async (...args: unknown[]) => {
            if (tipo === "global" && abiertas > 0) {
              usosGlobalesConTx.push(quien);
              throw new Error(`cliente GLOBAL con una transacción abierta: ${quien}`);
            }
            if (tipo === "tx" && abortada) throw new Error("current transaction is aborted");
            try {
              return await responder(quien, args);
            } catch (e) {
              if (tipo === "tx") abortada = true; // como Postgres
              throw e;
            }
          };
        },
      });
    },
  });
}
const prisma = cliente("global");

const ACCIONES = {
  guardian: "src/app/actions/pediatrics/guardian.ts",
  hoja: "src/app/actions/orthodontics/procedimientosDeHoja.ts",
  presentar: "src/lib/treatments/presentar.server.ts",
};
preparar({
  paginas: [ACCIONES.guardian, ACCIONES.hoja, ACCIONES.presentar, "src/app/actions/pediatrics/_helpers.ts", "src/lib/invoices/crear-desde-cita.server.ts"],
  reales: [
    "zod", "@prisma/client", "src/app/actions/pediatrics/_helpers.ts", "./result",
    "@/lib/invoices/crear-desde-cita.server", "@/lib/orthodontics/cobro/extras-db", "@/lib/quotes/service",
    "@/lib/invoice-totals", "@/lib/invoices/next-invoice-number", "@/lib/patient-credit-aplicar",
    "./doctor-de-factura.server", "./cita-factura-cancelada.server", "./cita-factura-cancelada",
    "@/lib/orthodontics/procedimientos-de-visita", "@/lib/db/punto-de-guardado",
  ],
  fijos: {
    "@/lib/prisma": { prisma },
    "next/navigation": { redirect: (d: string) => { throw new Redireccion(d); }, notFound: () => { throw new Error("404"); } },
    // presentar.server: el plan sin filas propias, y el candado del plan con el tx (eso no es lo que se prueba).
    "./items-db": { repoFilas: { leer: async () => [] }, bloquearPlan: async () => {} },
    "@/lib/quotes/desde-plan": {
      ESTADOS_QUE_YA_CUENTAN: ["DRAFT", "PRESENTED", "ACCEPTED"],
      armarPresupuestoDePlan: () => ({ conceptos: [{ name: "Limpieza", quantity: 1, unitPrice: 600 }] }),
    },
  },
});

const CTX = { userId: "u1", clinicId: "cli_a", role: "ADMIN", permissionsOverride: [], clinicCategory: "DENTAL", isAdmin: true, isSuperAdmin: false };

beforeEach(() => {
  abiertas = 0;
  abortada = false;
  usosGlobalesConTx.length = 0;
  sentencias.length = 0;
  fallos = [];
  respuestas.clear();
  respuestas.set("@/lib/auth-context#getAuthContext", async () => CTX);
  respuestas.set("@/lib/clinical-shared/auth/paciente-oculto#pacienteOcultoPara", async () => false);
  respuestas.set("./_helpers#getOrthoBillingActionContext", async () => ({ ok: true, data: { ctx: CTX } }));
  respuestas.set("./cobro/_ctx#loadCasoParaCobro", async () => ({ ok: true, data: { id: "plan1", patientId: "p1" } }));
  respuestas.set("./cobro/_ctx#auditarCobro", async () => {});
});

// ═══════════ 1 · pediatría: el tutor principal ═══════════

test("setPrimaryGuardian: el expediente pediátrico se busca/crea con el tx, no con el cliente global", async () => {
  respuestas.set("guardian.findUnique", () => ({ id: "g1", clinicId: "cli_a", patientId: "p1" }));
  const { setPrimaryGuardian } = await import(`../../../../${ACCIONES.guardian}`);
  const r = await setPrimaryGuardian({ guardianId: "g1" });
  assert.deepEqual(usosGlobalesConTx, [], "usó el cliente global dentro de la transacción");
  assert.equal(r.ok, true, JSON.stringify(r));
});

// ═══════════ 2 · ortodoncia: cobrar un procedimiento de la hoja ═══════════

const NOTA = {
  id: "nota1",
  specialtyData: { treatmentCardId: "card1", procedimientos: [{ procedureId: "proc1", name: "Botón lingual", unitPrice: 500, quantity: 1, incluido: false }] },
};
function prepararHoja() {
  respuestas.set("orthoTreatmentCard.findFirst", () => ({ id: "card1", patientId: "p1", treatmentPlanId: "plan1", cardNumber: 3, status: "SIGNED" }));
  respuestas.set("medicalRecord.findFirst", () => NOTA);
  respuestas.set("invoice.findFirst", () => null);
  respuestas.set("clinic.findUnique", () => ({ cfdiTaxMode: null, timezone: "America/Mexico_City" }));
  respuestas.set("tx.$queryRaw", (sql: string) => (/information_schema/.test(sql) ? [{ existe: true }] : /UPDATE "invoices"/.test(sql) ? [{ id: "fac1" }] : []));
}

test("cobrarProcedimientoDeHoja: la factura y su vínculo al caso nacen DENTRO de la transacción", async () => {
  prepararHoja();
  const { cobrarProcedimientoDeHoja } = await import(`../../../../${ACCIONES.hoja}`);
  const r = await cobrarProcedimientoDeHoja({ cardId: "card1", procedureId: "proc1" });
  assert.deepEqual(usosGlobalesConTx, [], "usó el cliente global dentro de la transacción (factura fuera de la tx)");
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("cobrarProcedimientoDeHoja: un choque de folio dentro de la tx se reintenta (punto de guardado) y la tx sigue viva", async () => {
  prepararHoja();
  fallos.push({
    quien: "invoice.create",
    error: new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "x", meta: { target: ["clinicId", "invoiceNumber"] } }),
  });
  const { cobrarProcedimientoDeHoja } = await import(`../../../../${ACCIONES.hoja}`);
  const r = await cobrarProcedimientoDeHoja({ cardId: "card1", procedureId: "proc1" });
  assert.equal(r.ok, true, `con el folio repetido ya no se reintenta dentro de la tx: ${JSON.stringify(r)}`);
  assert.ok(sentencias.some((s) => s.startsWith("ROLLBACK TO SAVEPOINT")), "no deshizo el intento fallido con su punto de guardado");
});

// ═══════════ 3 · presupuesto desde el plan ═══════════

test("presupuestoDesdeElPlan: el presupuesto (folio incluido) se crea con el tx del plan bloqueado", async () => {
  respuestas.set("./leer-plan#leerPlan", () => ({ fuente: "texto", textoRedondeado: "" }));
  respuestas.set("quote.findFirst", () => null);
  respuestas.set("quote.create", ({ data }: any) => ({ id: "q1", folio: data.folio, patientId: "p1", status: "DRAFT", total: 600, title: data.title, items: [], acceptToken: null, validUntil: null }));
  const { presupuestoDesdeElPlan } = await import(`../../../../${ACCIONES.presentar}`);
  await presupuestoDesdeElPlan({
    clinicId: "cli_a", userId: "u1", presentar: false,
    plan: { id: "plan1", patientId: "p1", name: "Plan", description: "", totalCost: 600 } as never,
  }).catch((e: unknown) => { if (process.env.DEPURAR) console.error("presentar:", e); });
  assert.deepEqual(usosGlobalesConTx, [], "usó el cliente global dentro de la transacción");
  assert.ok(sentencias.some((s) => s.startsWith("SAVEPOINT")), "el alta del presupuesto no pasó por el tx");
});

// ═══════════ fuera de una transacción: igual que siempre ═══════════

test("sin transacción, los helpers siguen usando el cliente global y sin puntos de guardado", async () => {
  const { crearFacturaDesdeCita } = await import("@/lib/invoices/crear-desde-cita.server");
  respuestas.set("clinic.findUnique", () => ({ cfdiTaxMode: null }));
  const r = await crearFacturaDesdeCita({ clinicId: "cli_a", appointmentId: null, patientId: "p1", lineItems: [{ description: "x", unitPrice: 100, quantity: 1 }], userId: "u1" } as never);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!sentencias.some((s) => s.includes("SAVEPOINT")), "fuera de una transacción no debe abrir puntos de guardado");
});

test("esTransaccion: el tx sí; el cliente global no; un doble de prisma sin $transaction tampoco", async () => {
  const { esTransaccion, conPuntoDeGuardado } = await import("@/lib/db/punto-de-guardado");
  assert.equal(esTransaccion(prisma), false);
  let tx: unknown;
  await prisma.$transaction(async (t: unknown) => { tx = t; });
  assert.equal(esTransaccion(tx as never), true);
  const doble = { invoice: { findFirst: async () => null } };
  assert.equal(esTransaccion(doble as never), false, "un doble de pruebas no es una transacción");
  assert.equal(await conPuntoDeGuardado(doble as never, async () => 7), 7, "con un doble, el paso corre tal cual");
});
