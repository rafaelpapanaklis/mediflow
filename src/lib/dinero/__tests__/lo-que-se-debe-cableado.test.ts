/**
 * Revisión t5 (A1–A4): todo lo que dice «saldo» o «deuda» —al paciente y en el panel— resta lo que aún
 * no se debe (por hacer de planes, por vencer de ortodoncia «Precio total») con EL MISMO ayudante
 * (`lib/dinero/lo-que-se-debe.server.ts`, que es `computeReceivables`). La aritmética está probada en
 * `plan-por-cobrar-api.test.ts` (PGlite) y `por-cobrar-vencido.test.ts`; esto es el candado de que
 * cada sitio sigue cableado a ella.
 *
 * Run: npm run test:plan-por-cobrar
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const SITIOS: Array<{ archivo: string; usa: RegExp; que: string }> = [
  { archivo: "src/lib/inbox/template-offer.ts", usa: /balance: Math\.max\(0, Math\.round\(\(saldo - \(noSeDebe\?\.total \?\? 0\)\)/, que: "A1 · «Aviso de saldo» del Inbox" },
  { archivo: "src/app/api/invoices/[id]/send-whatsapp/route.ts", usa: /balance: saldoDelAviso,/, que: "A1 · aviso de saldo de la nota" },
  { archivo: "src/app/api/paciente/payments/route.ts", usa: /pendingTotal \+= inv\.balance - \(inv\.aunNoSeDebe \?\? 0\)/, que: "A1 · portal → Pagos" },
  { archivo: "src/app/api/paciente/summary/route.ts", usa: /sum \+ exigible\(inv\)/, que: "A1 · portal → Inicio" },
  { archivo: "src/app/dashboard/reports/cargar-reportes.ts", usa: /withDebtAmount: Math\.max\(0, Math\.round\(\(Number\(debtAggregate\?\._sum\?\.balance \?\? 0\) - \(noSeDebe\?\.total \?\? 0\)\)/, que: "A3 · Reportes" },
  { archivo: "src/app/api/analytics/patients-value/route.ts", usa: /balance: saldoDe\(r\.id, r\.balance\)/, que: "A3 · valor de pacientes" },
  { archivo: "src/app/api/analytics/churn-risk/route.ts", usa: /noSeDebePorPaciente\.get\(r\.id\)/, que: "A3 · pacientes en riesgo" },
  { archivo: "src/app/api/patients/route.ts", usa: /\(inv\.balance \?\? 0\) - noSeDebe\(inv\.id\)/, que: "A4 · lista de Pacientes" },
  { archivo: "src/app/api/patients/[id]/lo-que-aun-no-se-debe/route.ts", usa: /loQueAunNoSeDebe\(ctx\.clinicId, \{ ids:/, que: "A2/A4 · cabecera y Estado de cuenta" },
];

for (const s of SITIOS) {
  test(`${s.que}: resta lo que aún no se debe con el ayudante único`, () => {
    const codigo = leer(s.archivo);
    assert.match(codigo, /from "@\/lib\/dinero\/lo-que-se-debe\.server"/, `${s.archivo} importa el ayudante`);
    assert.match(codigo, s.usa, `${s.archivo} lo usa en su cifra`);
  });
}

test("A2: «Estado de cuenta» (lateral, Resumen y Facturación) dice aparte cuánto aún no se debe", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /pendingBalance=\{saldoQueSeDebe\}/, "la cabecera: lo que se debe de verdad");
  assert.equal((ficha.match(/aunNoSeDebe\s*[,}]/g) ?? []).length >= 3, true, "los tres «Estado de cuenta» reciben la cifra");
  for (const f of [
    "src/components/dashboard/patient-detail/side-cards.tsx",
    "src/components/dashboard/pacientes-rediseno/resumen.tsx",
    "src/components/dashboard/patient-detail/billing-tab.tsx",
  ]) assert.match(leer(f), /patients\.sideCards\.aunNoSeDebe/, f);
});

test("A8: la lista de Pacientes ya no trae todas las facturas con deuda de la clínica", () => {
  const ruta = leer("src/app/api/patients/route.ts");
  assert.doesNotMatch(ruta, /select: \{ id: true, patientId: true, balance: true \},\n\s*\}\),/);
  assert.match(ruta, /candidatasNoExigibles\(ctx\.clinicId\)/);
});
