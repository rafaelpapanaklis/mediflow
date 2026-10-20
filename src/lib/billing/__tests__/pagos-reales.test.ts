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
  ROTULO_PAGO_UNICO_STRIPE,
  rotuloDeFilaSinCobro,
  esRastroDePagoUnicoStripe,
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
  assert.match(c, /const rotulo = rotuloDeFilaSinCobro\(fila\);\s*if \(rotulo\) return <BadgeNew tone="neutral" dot>\{rotulo\}<\/BadgeNew>;/);
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
  assert.match(a, /prisma\.subscriptionInvoice\.create\(\{[\s\S]*?amount: 0,[\s\S]*?status: "paid",[\s\S]*?method: METODO_ACTIVACION_ADMIN,/);
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

/** La función (o flecha con nombre) que contiene la posición: así una excepción es por FUNCIÓN, no por un trozo de texto. */
function funcionQueContiene(texto: string, pos: number): string {
  const decl = /(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/g;
  let nombre = "?";
  for (const m of texto.slice(0, pos).matchAll(decl)) nombre = m[1] ?? m[2];
  return nombre;
}

/**
 * Lecturas de `subscription_invoices` que NO cuentan ni suman pagos reales y por eso no llevan el filtro. Se reconocen
 * por archivo + FUNCIÓN + cuántas hay como máximo: una consulta nueva en la misma función supera el tope y falla.
 */
const PERMITIDAS: Array<{ archivo: string; funcion: string; max: number; razon: string }> = [
  { archivo: "src/lib/billing/record-stripe-invoice.ts", funcion: "recordStripeInvoice", max: 1, razon: "busca SU fila por referencia para escribirla" },
  { archivo: "src/lib/billing/iva-clinica.ts", funcion: "tuvoSuscripcionDeTarjeta", max: 1, razon: "solo cobros de Stripe (method stripe)" },
  { archivo: "src/app/admin/page.tsx", funcion: "renderAdminDashboard", max: 1, razon: "pagos PENDIENTES por verificar" },
  { archivo: "src/app/admin/payments/page.tsx", funcion: "renderPaymentsPage", max: 3, razon: "listas de /admin › Pagos (recientes, sin cobrar, pendientes): se ven, rotuladas" },
  { archivo: "src/app/admin/payments/[id]/cfdi/page.tsx", funcion: "CfdiPaymentPage", max: 1, razon: "una fila por id" },
  { archivo: "src/app/api/webhooks/stripe/route.ts", funcion: "pagoManualCubre", max: 1, razon: "el webhook la lee a propósito: es el rastro" },
  { archivo: "src/lib/billing/factura-fuera-de-stripe.server.ts", funcion: "ultimoPagoManualDelPlan", max: 1, razon: "lee a propósito el último pago MANUAL (incluida la activación) para cortar las facturas que ya existían" },
  { archivo: "src/lib/billing/facturas-tarjeta-pendientes.server.ts", funcion: "clinicasConFacturaPendienteTrasPagoManual", max: 1, razon: "lee a propósito los pagos MANUALES recientes (incluida la activación) para el aviso y el reintento" },
  { archivo: "src/lib/billing/reactivacion-tras-suspension.server.ts", funcion: "registrarComoNoCobrada", max: 1, razon: "busca SU fila por referencia para no duplicarla al dejarla como «No cobrada: servicio suspendido»" },
  { archivo: "src/app/api/cfdi/usage/route.ts", funcion: "GET", max: 1, razon: "adeudos de excedente de CFDI (method cfdi_overage)" },
  { archivo: "src/app/api/admin/subscriptions/route.ts", funcion: "POST", max: 1, razon: "doble clic en «Registrar pago»: busca el mismo pago creado hace menos de 2 minutos" },
  { archivo: "src/app/api/admin/subscriptions/route.ts", funcion: "GET", max: 1, razon: "lista de pagos del admin: se ve, rotulada" },
  { archivo: "src/app/api/admin/billing/route.ts", funcion: "GET", max: 2, razon: "pagos recientes (se ven, rotulados) y transferencias pendientes" },
  { archivo: "src/app/api/admin/billing/route.ts", funcion: "POST", max: 3, razon: "una fila por id (verificar / reembolsar) y la activación reciente (doble clic, Y5)" },
  { archivo: "src/app/api/admin/payments/[id]/cfdi/route.ts", funcion: "POST", max: 1, razon: "una fila por id (rechaza la activación manual con 400)" },
  { archivo: "src/app/api/admin/payments/[id]/receipt/route.ts", funcion: "GET", max: 1, razon: "una fila por id" },
];

// Cualquier lectura por el cliente de Prisma, con cualquier nombre de variable (prisma, tx, db, prismaAdmin…).
const LECTURA = /\bsubscriptionInvoice\s*\.\s*(count|groupBy|aggregate|findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow)\s*\(/g;

test("vigilante: toda lectura de subscription_invoices por Prisma usa sinActivacionManual, o es una excepción de ESA función con su tope", () => {
  const sinFiltro: string[] = [];
  const porFuncion = new Map<string, number>();
  let vistas = 0;
  for (const archivo of archivos(join(process.cwd(), "src"))) {
    const rel = archivo.slice(process.cwd().length + 1);
    const texto = sinComentarios(readFileSync(archivo, "utf8"));
    for (const m of texto.matchAll(LECTURA)) {
      vistas++;
      const cuerpo = llamada(texto, m.index! + m[0].length - 1);
      if (cuerpo.includes("sinActivacionManual(")) continue;
      const funcion = funcionQueContiene(texto, m.index!);
      const clave = `${rel}::${funcion}`;
      porFuncion.set(clave, (porFuncion.get(clave) ?? 0) + 1);
      const permitida = PERMITIDAS.find((p) => p.archivo === rel && p.funcion === funcion);
      if (!permitida || porFuncion.get(clave)! > permitida.max) {
        sinFiltro.push(`${rel} · función ${funcion}: ${m[1]}(${cuerpo.replace(/\s+/g, " ").slice(1, 90)}…`);
      }
    }
  }
  assert.ok(vistas >= 25, `el vigilante debería ver las consultas (vio ${vistas})`);
  assert.deepEqual(sinFiltro, [], "lecturas de subscription_invoices sin pasar por pagos-reales");
  // Las excepciones no envejecen: cada una sigue existiendo (si se borra la consulta, se borra de la lista).
  for (const p of PERMITIDAS) {
    assert.ok((porFuncion.get(`${p.archivo}::${p.funcion}`) ?? 0) >= 1, `excepción huérfana: ${p.archivo} · ${p.funcion}`);
  }
});

test("vigilante: nadie lee los pagos por la RELACIÓN clinic.subscriptionInvoices (include / select / _count)", () => {
  const usos: string[] = [];
  for (const archivo of archivos(join(process.cwd(), "src"))) {
    const texto = sinComentarios(readFileSync(archivo, "utf8"));
    if (/\bsubscriptionInvoices\b/.test(texto)) usos.push(archivo.slice(process.cwd().length + 1));
  }
  assert.deepEqual(usos, [], "la relación no tiene el filtro: leer por ella cuenta la activación manual");
});

test("vigilante: todo SQL crudo sobre subscription_invoices (cualquier alias, con o sin comillas) lleva el filtro", () => {
  const SQL = /\b(?:FROM|JOIN)\s+(?:"?public"?\s*\.\s*)?"?subscription_invoices"?(?:\s+(?:AS\s+)?"?(?!WHERE|ON|JOIN|LEFT|INNER|GROUP|ORDER|LIMIT|AND|OR|WHERE)(\w+)"?)?/gi;
  const CUALQUIER_MENCION = /subscription_invoices/i;
  const sinFiltro: string[] = [];
  let consultas = 0;
  for (const archivo of archivos(join(process.cwd(), "src"))) {
    const rel = archivo.slice(process.cwd().length + 1);
    const texto = sinComentarios(readFileSync(archivo, "utf8"));
    if (!CUALQUIER_MENCION.test(texto)) continue;
    const lecturas = [...texto.matchAll(SQL)];
    consultas += lecturas.length;
    const filtros = (texto.match(/\$\{SIN_ACTIVACION_MANUAL\}/g) ?? []).length;
    // Solo la nombra (un texto de pantalla): vale mientras el archivo no arme SQL crudo con otra forma que el detector no entiende.
    if (lecturas.length === 0) {
      if (/\$(?:query|execute)Raw|Prisma\.sql|Prisma\.raw|\.unsafe\(/.test(texto)) sinFiltro.push(`${rel}: nombra subscription_invoices y arma SQL crudo, pero no es un FROM/JOIN reconocible`);
    }
    else if (filtros < lecturas.length) sinFiltro.push(`${rel}: ${lecturas.length} consultas, ${filtros} con filtro`);
  }
  assert.ok(consultas >= 6, `el vigilante debería ver el SQL del embudo (vio ${consultas})`);
  assert.deepEqual(sinFiltro, []);
  // El detector entiende alias, comillas y esquema (si no, un SQL futuro se le escaparía).
  for (const ejemplo of [
    'FROM subscription_invoices s WHERE', 'FROM "subscription_invoices" AS "si" WHERE', 'JOIN public.subscription_invoices x ON',
    'FROM subscription_invoices\n WHERE', 'from  "public"."subscription_invoices"  inv',
  ]) {
    assert.equal([...ejemplo.matchAll(SQL)].length, 1, ejemplo);
  }
});

test("vigilante: detecta lo que antes se le escapaba (relación, findUnique, otro alias, otro nombre de cliente)", () => {
  const ejemplos = ["await tx.subscriptionInvoice.findUnique({ where: { id } })", "await db.subscriptionInvoice\n  .findFirst({ where: {} })", "prismaAdmin.subscriptionInvoice.findUniqueOrThrow({})"];
  for (const e of ejemplos) assert.equal([...e.matchAll(LECTURA)].length, 1, e);
  assert.equal(funcionQueContiene("export async function GET() {\n  await x.subscriptionInvoice.findMany(", 55), "GET");
  assert.equal(funcionQueContiene("const leer = async (a) => {\n  y", 30), "leer");
});

test("N8 /admin › Pagos: el filtro «Pagados» no muestra las activaciones manuales (el resto de filtros sí las ven, rotuladas)", () => {
  const c = sinComentarios(leer("src/app/admin/payments/payments-client.tsx"));
  assert.match(c, /if \(filterStatus === "paid" && esActivacionManual\(p\)\) return false;/);
  // El mismo criterio sobre filas de ejemplo: con «Pagados» solo quedan los cobros.
  const lista = [
    { id: "1", status: "paid", method: "stripe", amount: 689 },
    { id: "2", status: "paid", method: "admin", amount: 0 },
    { id: "3", status: "paid", method: "transfer", amount: 689 },
  ];
  const pagados = lista.filter((p) => !(p.status === "paid" && esActivacionManual(p)));
  assert.deepEqual(pagados.map((p) => p.id), ["1", "3"]);
});

test("R3 /admin › Pagos distingue el rastro del SPEI/OXXO de Stripe («pago-unico:») de la activación manual", () => {
  assert.equal(ROTULO_PAGO_UNICO_STRIPE, "Pago SPEI/OXXO por Stripe (rastro)");
  assert.equal(esRastroDePagoUnicoStripe({ reference: "pago-unico:cs_1" }), true);
  for (const r of [null, undefined, "", "in_1", "SPEI-1", "pago-unico"]) assert.equal(esRastroDePagoUnicoStripe({ reference: r }), false, String(r));
  assert.equal(rotuloDeFilaSinCobro({ method: "admin", amount: 0, reference: "pago-unico:cs_1" }), "Pago SPEI/OXXO por Stripe (rastro)");
  assert.equal(rotuloDeFilaSinCobro({ method: "admin", amount: 0, reference: null }), "Activación manual (sin cobro)");
  assert.equal(rotuloDeFilaSinCobro({ method: "transfer", amount: 689, reference: "x" }), null);
  const c = sinComentarios(leer("src/app/admin/payments/payments-client.tsx"));
  assert.match(c, /const rotulo = rotuloDeFilaSinCobro\(fila\);/);
  assert.equal((c.match(/methodBadge\(inv\.method, inv\)/g) ?? []).length, 2);
  // Y el rastro se escribe con ese prefijo.
  assert.match(sinComentarios(leer("src/app/api/webhooks/stripe/route.ts")), /reference: source\.sessionId \? `pago-unico:\$\{source\.sessionId\}` : undefined/);
});
