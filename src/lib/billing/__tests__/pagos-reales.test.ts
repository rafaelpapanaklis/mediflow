/**
 * LA ACTIVACIÓN MANUAL DE /admin NO ES UN COBRO (ws1-t1).
 *
 * Run: npm run test:cobro-rechazado
 *
 * `activate_clinic` deja una fila pagada de $0 con `method = "admin"` como rastro para el webhook. Esa fila no puede
 * disparar una comisión de afiliado, acercar un hito, contar como «primer pago» o «clínica que paga», ni inflar un
 * KPI de /admin; sí se ve en /admin › Pagos, rotulada «Activación manual (sin cobro)». Aquí se prueba el filtro
 * único (`pagos-reales.ts`), los sitios que lo usan con una base en memoria que evalúa el `where` de verdad, y se
 * vigila que ninguna consulta nueva cuente pagos sin pasar por él.
 */
import Module from "node:module";
import path from "node:path";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  FILTRO_SIN_ACTIVACION_MANUAL,
  ROTULO_ACTIVACION_MANUAL,
  esActivacionManual,
  sinActivacionManual,
  sinFilasDeActivacionManual,
  sqlSinActivacionManual,
} from "../pagos-reales";
import { isFirstContract } from "../first-month-promo";

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ── Base en memoria que evalúa el `where` de Prisma de verdad ─────────── */

type Fila = Record<string, any>;
function coincide(fila: Fila, where: any): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === "OR") return (v as any[]).some((w) => coincide(fila, w));
    if (k === "AND") return (Array.isArray(v) ? v : [v]).every((w: any) => coincide(fila, w));
    const x = fila[k];
    if (v === null) return x == null;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(x);
      if ("gte" in v) return x != null && x >= v.gte;
      if ("startsWith" in v) return typeof x === "string" && x.startsWith(v.startsWith);
      if ("not" in v) {
        if (v.not && typeof v.not === "object") return !(typeof x === "string" && "startsWith" in v.not && x.startsWith(v.not.startsWith));
        return x != null && x !== v.not; // SQL: <> excluye los NULL
      }
      throw new Error(`operador no soportado: ${JSON.stringify(v)}`);
    }
    return x === v;
  });
}

let filas: Fila[] = [];
const prismaDoble: any = {
  subscriptionInvoice: {
    count: async ({ where }: any) => filas.filter((f) => coincide(f, where)).length,
    groupBy: async ({ by, where }: any) => {
      const grupos = new Map<string, number>();
      filas.filter((f) => coincide(f, where)).forEach((f) => grupos.set(f[by[0]], (grupos.get(f[by[0]]) ?? 0) + 1));
      return [...grupos].map(([clinicId, n]) => ({ clinicId, _count: { _all: n } }));
    },
  },
};

const RAIZ = path.resolve(__dirname, "../../../..");
const dobles = new Map<string, unknown>();
type M = typeof Module & { _load: (r: string, p: unknown, m: boolean) => unknown; _resolveFilename: (r: string, p: unknown, m: boolean) => string };
const Mod = Module as M;
const cargaOriginal = Mod._load;
Mod._load = function (req, parent, isMain) {
  if (req === "server-only" || req === "client-only") return {};
  let resuelto: string | null = null;
  try {
    resuelto = Mod._resolveFilename(req, parent, isMain);
  } catch {
    resuelto = null;
  }
  if (resuelto && dobles.has(resuelto)) return dobles.get(resuelto);
  return cargaOriginal.call(this, req, parent, isMain);
};

let payout: typeof import("../../affiliates/payout");
let hitos: typeof import("../../affiliates/milestones-progress");
before(async () => {
  dobles.set(path.join(RAIZ, "src/lib/prisma.ts"), { prisma: prismaDoble });
  payout = await import("../../affiliates/payout");
  hitos = await import("../../affiliates/milestones-progress");
});

const stripe = { clinicId: "c1", status: "paid", method: "stripe", amount: 689, notes: null, reference: "in_1" };
const manual = { clinicId: "c1", status: "paid", method: "transfer", amount: 689, notes: null, reference: "SPEI-1" };
const activacion = { clinicId: "c1", status: "paid", method: "admin", amount: 0, notes: "Activación manual desde /admin (sin cobro registrado)", reference: null };

/* ── El filtro ─────────────────────────────────────────────────────────── */

test("el filtro: una fila de $0 con método «admin» no cuenta; cualquier otra sí (incluso sin método, o «admin» con importe)", () => {
  assert.equal(esActivacionManual(activacion), true);
  assert.equal(esActivacionManual({ method: "admin", amount: 0 }), true);
  for (const f of [stripe, manual, { method: "admin", amount: 300 }, { method: null, amount: 0 }, { method: "transfer", amount: 0 }, null, undefined]) {
    assert.equal(esActivacionManual(f as any), false, JSON.stringify(f));
  }
  const cuentan = [stripe, manual, { ...activacion, amount: 300 }, { ...activacion, method: null }];
  for (const f of cuentan) assert.equal(coincide(f, FILTRO_SIN_ACTIVACION_MANUAL), true, JSON.stringify(f));
  assert.equal(coincide(activacion, FILTRO_SIN_ACTIVACION_MANUAL), false);
  assert.deepEqual(sinFilasDeActivacionManual([stripe, activacion, manual]), [stripe, manual]);
  // Compone con un `where` que ya trae OR / AND sin pisarlo.
  const w = sinActivacionManual({ status: "paid", OR: [{ notes: null }, { notes: "x" }], AND: [{ clinicId: "c1" }] });
  assert.deepEqual(filas.filter(() => false), []);
  assert.equal([stripe, manual, activacion, { ...stripe, status: "pending" }].filter((f) => coincide(f, w)).length, 2);
  assert.equal(ROTULO_ACTIVACION_MANUAL, "Activación manual (sin cobro)");
  assert.match(sqlSinActivacionManual("s"), /s\.method IS DISTINCT FROM 'admin' OR s\.amount <> 0/);
});

/* ── Afiliados ─────────────────────────────────────────────────────────── */

test("afiliados: la activación manual no cuenta para el número de factura (getInvoiceNo) ni para los hitos", async () => {
  filas = [stripe, activacion];
  assert.equal(await payout.getInvoiceNo("c1", null), 2, "1 pago real + 1 → la siguiente es la 2ª, no la 3ª");
  filas = [activacion];
  assert.equal(await payout.getInvoiceNo("c1", null), 1, "solo la activación: el primer cobro real sigue siendo el 1º (sin comisión)");
  filas = [stripe, manual, activacion, { ...activacion, clinicId: "c2" }, { ...stripe, clinicId: "c2" }];
  const m = await hitos.paidInvoiceCountByClinic(["c1", "c2"]);
  assert.equal(m.get("c1"), 2);
  assert.equal(m.get("c2"), 1);
  filas = [activacion];
  assert.equal((await hitos.paidInvoiceCountByClinic(["c1"])).get("c1"), undefined, "ni un hito de más");
});

/* ── Embudo (SQL crudo) ────────────────────────────────────────────────── */

test("embudo de /admin: «checkout iniciado» y «primer pago» llevan el filtro en cada EXISTS sobre subscription_invoices", async () => {
  const { leerConteosEmbudo, leerEmbudoPorFuente } = await import("../../admin/embudo-captacion");
  const consultas: Array<{ sql: string; valores: any[] }> = [];
  const db = {
    $queryRaw: async (q: TemplateStringsArray, ...valores: any[]) => {
      consultas.push({ sql: q.join("?"), valores });
      return [{ n: 0n, utmSourceFirst: null, platform: null, utmSource: null, gclid: null, referrerHost: null }];
    },
  };
  await leerConteosEmbudo(db as any);
  await leerEmbudoPorFuente(db as any);
  const conTabla = consultas.filter((c) => c.sql.includes("subscription_invoices"));
  assert.ok(conTabla.length >= 4, `se esperaban al menos 4 consultas sobre subscription_invoices, hubo ${conTabla.length}`);
  for (const c of conTabla) {
    const fragmentos = c.valores.filter((v) => v && Array.isArray(v.strings)).map((v) => v.strings.join(""));
    assert.ok(fragmentos.some((f) => f.includes("IS DISTINCT FROM 'admin'")), `sin filtro: ${c.sql.replace(/\s+/g, " ").slice(0, 160)}`);
  }
});

/* ── La promo del primer mes ───────────────────────────────────────────── */

test("isFirstContract no lee pagos: la fila de $0 ni gana ni pierde la promo del primer mes", () => {
  const fuente = sinComentarios(leer("src/lib/billing/first-month-promo.ts"));
  assert.doesNotMatch(fuente, /subscriptionInvoice|subscription_invoices/);
  // Decide solo con la suscripción y el próximo cobro de la clínica: la misma respuesta con o sin la fila.
  const nueva = { stripeSubscriptionId: null, subscriptionId: null, nextBillingDate: null };
  filas = [];
  const sinFila = isFirstContract(nueva);
  filas = [activacion];
  assert.equal(isFirstContract(nueva), sinFila);
  assert.equal(sinFila, true);
  assert.equal(isFirstContract({ ...nueva, nextBillingDate: new Date() }), false);
  // Quienes la usan le pasan campos de la clínica, no filas de pagos.
  for (const f of ["src/app/api/billing/checkout/route.ts", "src/app/dashboard/suspended/page.tsx"]) {
    assert.doesNotMatch(sinComentarios(leer(f)), /isFirstContract\([^)]*subscriptionInvoice/, f);
  }
});

/* ── /admin › Pagos: se ve, rotulada ───────────────────────────────────── */

test("/admin › Pagos enseña la fila como «Activación manual (sin cobro)», no como «Pagado», y sin enlace a CFDI", () => {
  const c = sinComentarios(leer("src/app/admin/payments/payments-client.tsx"));
  assert.match(c, /if \(esActivacionManual\(fila\)\) return <BadgeNew tone="neutral" dot>\{ROTULO_ACTIVACION_MANUAL\}<\/BadgeNew>;/);
  assert.match(c, /<td>\{statusBadge\(inv\.status, inv\)\}<\/td>/);
  assert.match(c, /\{!esActivacionManual\(inv\) && \(\s*<Link\s+href=\{`\/admin\/payments\/\$\{inv\.id\}\/cfdi`\}/);
  // La lista de pagos NO la filtra: la consulta de las listas de /admin › Pagos sigue trayendo todas las filas.
  const p = sinComentarios(leer("src/app/admin/payments/page.tsx"));
  assert.match(p, /where: \{ paidAt: \{ not: null \} \}/);
});

/* ── El webhook SÍ la usa como rastro ──────────────────────────────────── */

test("el webhook sigue leyendo la activación manual como rastro (no pasa por el filtro) y la activación la escribe", () => {
  const w = sinComentarios(leer("src/app/api/webhooks/stripe/route.ts"));
  const fn = w.slice(w.indexOf("async function pagoManualCubre"), w.indexOf("async function resolveClinicIdByCustomer"));
  assert.doesNotMatch(fn, /sinActivacionManual/);
  assert.match(fn, /METODOS_DE_PAGO_MANUAL_DEL_PLAN/);
  const a = sinComentarios(leer("src/app/api/admin/billing/route.ts"));
  assert.match(a, /prisma\.subscriptionInvoice\.create\(\{[\s\S]*?amount: 0,[\s\S]*?status: "paid",[\s\S]*?method: metodo,/);
});

/* ── Vigilante: ninguna consulta nueva cuenta pagos sin el filtro ──────── */

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "node_modules" ? [] : archivos(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

/** El texto de la llamada que empieza en `desde` (el paréntesis de apertura), hasta su cierre. */
function llamada(texto: string, desde: number): string {
  let nivel = 0;
  for (let i = desde; i < texto.length; i++) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")" && --nivel === 0) return texto.slice(desde, i + 1);
  }
  return texto.slice(desde);
}

// Consultas que NO cuentan ni suman pagos reales y por eso no llevan el filtro, con su razón.
const PERMITIDAS: Array<{ archivo: string; marca: string; razon: string }> = [
  { archivo: "src/app/api/webhooks/stripe/route.ts", marca: "METODOS_DE_PAGO_MANUAL_DEL_PLAN", razon: "el webhook la lee a propósito: es el rastro" },
  { archivo: "src/lib/billing/iva-clinica.ts", marca: 'method: "stripe"', razon: "solo cobros de Stripe" },
  { archivo: "src/app/api/cfdi/usage/route.ts", marca: "CFDI_OVERAGE_METHOD", razon: "adeudos de excedente de CFDI (pendientes)" },
  { archivo: "src/app/admin/payments/page.tsx", marca: 'paidAt: { not: null }', razon: "lista de pagos recientes: se ve, rotulada" },
  { archivo: "src/app/admin/payments/page.tsx", marca: "paidAt: null", razon: "lista de pagos sin cobrar" },
  { archivo: "src/app/admin/payments/page.tsx", marca: 'status: "pending"', razon: "pendientes de verificar" },
  { archivo: "src/app/api/admin/billing/route.ts", marca: 'orderBy: { createdAt: "desc" }, take: 50', razon: "lista de pagos recientes: se ve, rotulada" },
  { archivo: "src/app/api/admin/billing/route.ts", marca: 'status: "pending"', razon: "transferencias pendientes" },
  { archivo: "src/app/api/admin/subscriptions/route.ts", marca: "take:    100", razon: "lista de pagos del admin: se ve" },
  { archivo: "src/app/admin/page.tsx", marca: 'status: "pending"', razon: "pendientes por verificar" },
];

test("vigilante: toda consulta que cuenta o suma subscription_invoices usa sinActivacionManual (o está en la lista de permitidas, con razón)", () => {
  const consulta = /subscriptionInvoice\s*\.\s*(count|groupBy|aggregate|findMany|findFirst)\s*\(/g;
  const sinFiltro: string[] = [];
  let vistas = 0;
  for (const archivo of archivos(join(process.cwd(), "src"))) {
    const rel = archivo.slice(process.cwd().length + 1);
    const texto = sinComentarios(readFileSync(archivo, "utf8"));
    for (const m of texto.matchAll(consulta)) {
      vistas++;
      const abre = m.index! + m[0].length - 1;
      const cuerpo = llamada(texto, abre);
      if (cuerpo.includes("sinActivacionManual(")) continue;
      if (PERMITIDAS.some((p) => p.archivo === rel && cuerpo.includes(p.marca))) continue;
      sinFiltro.push(`${rel}: ${cuerpo.replace(/\s+/g, " ").slice(0, 110)}`);
    }
  }
  assert.ok(vistas >= 20, `el vigilante debería ver las consultas (vio ${vistas})`);
  assert.deepEqual(sinFiltro, [], "consultas sobre subscription_invoices sin pasar por pagos-reales");
  // Y el SQL crudo.
  const crudo = archivos(join(process.cwd(), "src")).filter((f) => /FROM subscription_invoices/.test(readFileSync(f, "utf8")));
  for (const f of crudo) {
    const t = sinComentarios(readFileSync(f, "utf8"));
    const usos = t.match(/subscription_invoices s/g)?.length ?? 0;
    const filtros = t.match(/\$\{SIN_ACTIVACION_MANUAL\}/g)?.length ?? 0;
    assert.ok(usos > 0 && filtros >= usos, `${f}: ${usos} consultas, ${filtros} con filtro`);
  }
});
