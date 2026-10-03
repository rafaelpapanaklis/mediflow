/**
 * El gancho del cobro automático (ws1-t6) que llaman `cerrarLinksDeFactura`, el
 * cambio de plan de pago y el cambio de estado del caso.
 *
 * Lo que importa: SIN el SQL pegado no ensucia los logs de Postgres de producción
 * (una sola pregunta `to_regclass`, recordada; ninguna consulta a las tablas que
 * no existen), nunca lanza, y solo con una suscripción viva en la factura llama a
 * reconciliar.
 *
 * Run: npm run test:cobro-automatico
 */
import Module from "node:module";
import path from "node:path";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

const RAIZ = path.resolve(__dirname, "../../../..");
const reconciliadas: unknown[] = [];
const reconciliar = async (a: unknown) => { reconciliadas.push(a); };
const prohibido = new Proxy({}, { get: (_t, k) => { throw new Error(`prueba: nadie debe tocar la base real (prisma.${String(k)})`); } });
const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown; _resolveFilename: (r: string, p: unknown, m: boolean) => string };
const cargaOriginal = M._load;
M._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let r: string | null = null;
  try { r = M._resolveFilename(req, parent, isMain); } catch { r = null; }
  if (r === path.join(RAIZ, "src/lib/prisma.ts")) return { prisma: prohibido };
  return cargaOriginal.call(this, req, parent, isMain);
};

const { avisarCambioDeFactura, avisarPagoDeFactura } = require("../gancho") as typeof import("../gancho");
const { _olvidarTablas } = require("../db") as typeof import("../db");

function base(existen: boolean | "lanza", filas: Record<string, unknown>[] = []) {
  const sql: string[] = [];
  const db = {
    $queryRaw: async (partes: TemplateStringsArray) => {
      const q = partes.join("?");
      sql.push(q);
      if (/to_regclass/.test(q)) {
        if (existen === "lanza") throw new Error("doble: consulta sin doble");
        return [{ existen }];
      }
      return filas;
    },
    $executeRaw: async () => 0,
  };
  return { db: db as never, sql };
}

beforeEach(() => {
  _olvidarTablas();
  reconciliadas.length = 0;
});

test("sin el SQL: UNA pregunta to_regclass para muchas facturas, ninguna consulta a las tablas, nada se reconcilia", async () => {
  const b = base(false);
  for (let i = 0; i < 25; i++) await avisarCambioDeFactura({ clinicId: "c1", invoiceId: `f${i}` }, b.db, reconciliar);
  assert.equal(b.sql.length, 1);
  assert.match(b.sql[0], /to_regclass/);
  assert.equal(reconciliadas.length, 0);
});

test("una base que no contesta (o el doble de otras pruebas) no rompe a quien llama", async () => {
  const b = base("lanza");
  await avisarCambioDeFactura({ clinicId: "c1", invoiceId: "f1" }, b.db, reconciliar);
  assert.equal(reconciliadas.length, 0);
});

test("con el SQL y sin suscripción viva: una consulta filtrada por clínica y nada más", async () => {
  const b = base(true, []);
  await avisarCambioDeFactura({ clinicId: "c1", invoiceId: "f1" }, b.db, reconciliar);
  assert.equal(reconciliadas.length, 0);
  assert.match(b.sql[1], /"clinicId" = \? AND "invoiceId" = \?/);
});

test("con una suscripción viva: reconcilia esa factura", async () => {
  const b = base(true, [{ id: "cob1", clinicId: "c1", invoiceId: "f1", status: "authorized", amount: 3000, payerEmail: "a@b.mx" }]);
  await avisarCambioDeFactura({ clinicId: "c1", invoiceId: "f1" }, b.db, reconciliar);
  assert.deepEqual(reconciliadas, [{ clinicId: "c1", invoiceId: "f1" }]);
});

test("sin clínica o sin factura no pregunta nada (un clinicId vacío no filtraría)", async () => {
  const b = base(true);
  await avisarCambioDeFactura({ clinicId: "", invoiceId: "f1" }, b.db, reconciliar);
  assert.equal(b.sql.length, 0);
});

test("pago por el link de MP (webhook de factura): sin SQL no lee ni la factura; con SQL toma la clínica de la factura", async () => {
  let lecturas = 0;
  const sinSql = base(false);
  const conFactura = (b: ReturnType<typeof base>) =>
    ({ ...(b.db as object), invoice: { findUnique: async () => { lecturas++; return { clinicId: "c1" }; } } }) as never;
  await avisarPagoDeFactura("f1", conFactura(sinSql));
  assert.equal(lecturas, 0);
  _olvidarTablas();
  const conSql = base(true, []);
  await avisarPagoDeFactura("f1", conFactura(conSql));
  assert.equal(lecturas, 1);
  assert.match(conSql.sql.at(-1) ?? "", /"clinicId" = \? AND "invoiceId" = \?/);
});
