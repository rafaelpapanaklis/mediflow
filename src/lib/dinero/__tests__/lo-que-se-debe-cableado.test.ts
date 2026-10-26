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

test("v4 · N1: la cabecera se relee también cuando cambian las cuentas de los planes («marcar hecho»)", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  const desde = ficha.indexOf("const aunNoSeDebe = useLoQueAunNoSeDebe(");
  const llamada = ficha.slice(desde, ficha.indexOf(");", desde));
  assert.match(llamada, /refrescoCuentas/);
  assert.match(llamada, /planesDelServidor/);
});

test("v4 · sospecha 2: un plan TERMINADO no enseña «Cerrar plan»", () => {
  assert.match(leer("src/components/dashboard/expediente-rediseno/cuenta-del-plan.tsx"), /cuenta\.estado !== "COMPLETED" && \(c\.porHacer > 0\.005/);
});

test("v4 · N2: el aviso de la nota de ortodoncia dice lo vencido y el total aparte; el bot, «Debes» = lo vencido", () => {
  const ruta = leer("src/app/api/invoices/[id]/send-whatsapp/route.ts");
  assert.match(ruta, /saldoTotalDelTratamiento,/);
  assert.match(ruta, /if \(aunNo > 0\)/, "ya no solo las notas de plan: también ortodoncia");
  assert.match(leer("src/lib/whatsapp/cobranza/datos.ts"), /vencido: redondea\(vencidoTotal\)/);
});

test("v4 · N3: el correo de la nota lleva la línea del portal y su link cobra solo lo debido", () => {
  assert.match(leer("src/app/api/invoices/[id]/send-email/route.ts"), /aunNoSeDebe,\n\s*\}\);/);
  // v5 (N4/N5): un solo cálculo del monto (`montoParaLink`) para el POST, el GET y Stripe.
  assert.match(leer("src/lib/factura-mp/servicio.server.ts"), /const cuanto = montoParaLink\(\{ sugerido, saldo: saldoPorCobrar\(inv\), noSeDebe, adelanto: args\.adelanto === true \}\);/);
  assert.match(leer("src/app/api/paciente/payments/checkout/route.ts"), /montoParaLink\(\{ sugerido: invoice\.balance, saldo: invoice\.balance, noSeDebe, adelanto: body\?\.adelanto === true \}\)/);
});

test("A8: la lista de Pacientes ya no trae todas las facturas con deuda de la clínica", () => {
  const ruta = leer("src/app/api/patients/route.ts");
  assert.doesNotMatch(ruta, /select: \{ id: true, patientId: true, balance: true \},\n\s*\}\),/);
  assert.match(ruta, /candidatasNoExigibles\(ctx\.clinicId\)/);
});
