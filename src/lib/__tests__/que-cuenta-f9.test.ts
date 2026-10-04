/**
 * F9 de la auditoría BEVADENT (ws1-t2): «cifras de dinero que no coinciden entre pantallas».
 *
 * Run: npm run test:que-cuenta
 *
 *  · CRM: «Saldo por cobrar $626,054 · 295 pacientes» contaba TODOS los pacientes no archivados;
 *    ahora cuenta los que deben (`owingPatients`), como «Con deuda · 53 pacientes» de Reportes.
 *  · Cada indicador de dinero de Finanzas, Reportes, CRM y Costos y Margen lleva su línea
 *    «Qué cuenta» (periodo, cobrado o facturado, lo migrado), con textos es/en.
 * Con el código viejo fallan todas: no había `owingPatients` ni claves `queCuenta.*`.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(__dirname, "../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

// ── CRM: la API de valor por paciente ────────────────────────────────────────
let sqlVisto = "";
let valoresVistos: unknown[] = [];
const filas = [
  { id: "p1", firstName: "Ana", lastName: "Uno", patientNumber: "1", phone: null, invoiced: 900, paid: 200, balance: 700, visits: 1,
    last_visit: null, next_appt: null, t_invoiced: 1500, t_paid: 800, t_balance: 700, t_patients: 295, t_paying: 2, t_owing: 1 },
];
(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      $queryRaw: async (sql: TemplateStringsArray, ...valores: unknown[]) => {
        sqlVisto = sql.join("?");
        valoresVistos = valores;
        return filas;
      },
    },
  },
});
(mock as any).module("next/cache", {
  namedExports: { unstable_cache: (fn: () => unknown) => fn, revalidatePath: () => {}, revalidateTag: () => {} },
});
(mock as any).module("@/lib/auth", {
  namedExports: { getCurrentUser: async () => ({ role: "ADMIN", clinicId: "c1" }) },
});

test("CRM: el número bajo «Saldo por cobrar» son los pacientes que DEBEN, no todos", async () => {
  const { GET } = await import("@/app/api/analytics/patients-value/route");
  const res = await GET({} as any);
  const body = await res.json();
  assert.equal(body.totals.patients, 295);
  assert.equal(body.totals.owingPatients, 1);
  assert.match(sqlVisto, /FILTER \(WHERE pp\.balance > 0\.005\)/);
  assert.ok(valoresVistos.includes("c1"), "la consulta va con el clinicId de la sesión");
});

test("CRM: el saldo deja fuera los borradores, como «Por cobrar» de Finanzas", async () => {
  const { GET } = await import("@/app/api/analytics/patients-value/route");
  await GET({} as any);
  // ws1-t2 (auditoría de uso C-25): además, solo saldos positivos, como «Por cobrar» de Finanzas.
  assert.match(sqlVisto, /SUM\("balance"\) FILTER \(WHERE "status" <> 'DRAFT' AND "balance" > 0\)/);
  assert.match(sqlVisto, /"status" <> 'CANCELLED'/);
});

test("las dos pantallas del CRM enseñan «N pacientes deben», no el total", () => {
  for (const f of ["src/app/dashboard/analytics/crm/crm-client.tsx", "src/app/dashboard/analytics/crm/crm-rediseno.tsx"]) {
    const s = leer(f);
    assert.match(s, /crmPacientesQueDeben", \{ count: value\?\.totals\.owingPatients/, f);
    assert.doesNotMatch(s, /totals\.patients \?\? 0\} pacientes/, f);
  }
});

// ── «Qué cuenta» ─────────────────────────────────────────────────────────────
const CLAVES = [
  "titulo", "ingresosPeriodo", "ingresosPeriodoConReembolsos", "gastosPeriodo", "utilidad", "utilidadConMargen",
  "efectivo", "porDoctor", "porCobrar", "vencido", "ortoCobrado", "ortoVencido",
  "reportesIngresos", "reportesTicket", "reportesConDeuda", "crmLtv", "crmCobrado", "crmSaldo",
  "crmPacientesConPagos", "crmPacientesQueDeben", "costosIngresos", "costosCostos", "costosMargen",
];

test("los textos «Qué cuenta» existen en es y en, y dicen periodo y lo migrado", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).queCuenta;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).queCuenta;
  for (const k of CLAVES) {
    assert.equal(typeof es?.[k], "string", `es: queCuenta.${k}`);
    assert.equal(typeof en?.[k], "string", `en: queCuenta.${k}`);
  }
  // Lo que pidió el cliente: si entra lo migrado de otro sistema.
  for (const k of ["ingresosPeriodo", "efectivo", "porDoctor", "porCobrar", "reportesIngresos", "reportesConDeuda", "crmCobrado", "crmSaldo", "costosIngresos"]) {
    assert.match(es[k], /migrad/i, `es: queCuenta.${k} dice si entra lo migrado`);
    assert.match(en[k], /migrated/i, `en: queCuenta.${k}`);
  }
});

test("cada indicador de dinero de las cuatro pantallas lleva su «Qué cuenta»", () => {
  const usos: Array<[string, string[]]> = [
    ["src/components/dashboard/finanzas-rediseno/finanzas-rediseno.tsx",
      ["ingresosPeriodo", "gastosPeriodo", "utilidad", "efectivo", "porDoctor", "porCobrar", "vencido"]],
    ["src/app/dashboard/finanzas/finanzas-client.tsx",
      ["ingresosPeriodo", "gastosPeriodo", "utilidad", "efectivo", "porDoctor", "porCobrar", "vencido"]],
    ["src/components/dashboard/finanzas-rediseno/bloque-ortodoncia.tsx", ["ortoCobrado", "ortoVencido"]],
    ["src/app/dashboard/reports/reports-client.tsx", ["reportesIngresos", "reportesTicket", "reportesConDeuda"]],
    ["src/app/dashboard/analytics/crm/crm-client.tsx", ["crmLtv", "crmCobrado", "crmSaldo"]],
    ["src/app/dashboard/analytics/crm/crm-rediseno.tsx", ["crmLtv", "crmCobrado", "crmSaldo"]],
    ["src/app/dashboard/analytics/costs/costs-client.tsx", ["costosIngresos", "costosCostos", "costosMargen"]],
    ["src/app/dashboard/analytics/costs/costs-rediseno.tsx", ["costosIngresos", "costosCostos", "costosMargen"]],
  ];
  for (const [archivo, claves] of usos) {
    const s = leer(archivo);
    for (const c of claves) assert.match(s, new RegExp(`["']${c}["']`), `${archivo}: falta «Qué cuenta» ${c}`);
  }
});
