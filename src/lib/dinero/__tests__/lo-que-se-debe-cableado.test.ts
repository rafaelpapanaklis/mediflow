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
import { pendientesPrevios } from "@/lib/invoices/cobrar-hoy";
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

test("v7 (QA de t12): «Estado de cuenta» (Resumen, lateral y Facturación) dice lo que se DEBE, no el saldo de la nota", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /saldo: saldoQueSeDebe,\n\s*aunNoSeDebe,\n\s*credito: saldoAFavorTotal,/, "Resumen");
  assert.match(ficha, /balance: saldoQueSeDebe,\n\s*aunNoSeDebe,\n\s*credit: saldoAFavorTotal,/, "lateral");
  assert.match(ficha, /summary=\{\{ total: totalPlan, paid: totalPaid, balance: saldoQueSeDebe, aunNoSeDebe \}\}/, "Facturación");
  assert.doesNotMatch(ficha, /saldo: totalBalance|balance: totalBalance/, "ningún «Estado de cuenta» con la suma de saldos");
  assert.doesNotMatch(ficha, /hasBalance=\{totalBalance > 0\}/, "la pestaña Facturación no se pinta «con deuda» por lo que aún no se debe");
  // Saldo a favor = libro + lo pagado de más sobre lo hecho en sus notas de plan (la Cuenta del plan).
  assert.match(ficha, /creditBalance \+ adelantoEnPlanes/);
  assert.match(leer("src/app/api/patients/[id]/lo-que-aun-no-se-debe/route.ts"), /adelantoEnNotasDePlan\(ctx\.clinicId,/);
  // «Cobrar hoy»: «Además tiene $X por cobrar en notas anteriores» sin lo por hacer del plan.
  assert.match(ficha, /pendientes=\{pendientesPrevios\(invoices, aunNoSeDebePorFactura\)\}/);
  // El «aún no se debe» ya no es «de esto» (el número grande ya lo descuenta).
  for (const f of [
    "src/components/dashboard/patient-detail/side-cards.tsx",
    "src/components/dashboard/pacientes-rediseno/resumen.tsx",
    "src/components/dashboard/patient-detail/billing-tab.tsx",
  ]) assert.doesNotMatch(leer(f), /Math\.min\((finanzas\.saldo|finance\.balance|summary\.balance), /, f);
  assert.doesNotMatch(leer("src/i18n/dictionaries/es.json"), /"aunNoSeDebe": "De esto/);
});

test("v7 (QA de t12): la Cuenta del plan se relee sola al aceptar un presupuesto y al cerrar el plan", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  const desde = ficha.indexOf("const cuentasDePlanes = useCuentasDelPaciente(");
  const llamada = ficha.slice(desde, ficha.indexOf(");", desde));
  assert.match(llamada, /\(invoices as any\[\]\)\.map/, "la clave lleva las notas del paciente (aceptar crea la nota sin tocar el plan)");
  assert.ok(desde > ficha.indexOf("const [invoices, setInvoices] = useState("), "se llama después de declarar `invoices`");
  assert.match(ficha, /onCuentaCambio=\{alCambiarDineroDePlanes\}/);
  assert.match(ficha, /onCambio=\{\(\) => alCambiarDineroDePlanes\(\)\}/);
  const presupuestos = leer("src/components/quotes/quotes-tab.tsx");
  assert.match(presupuestos, /onChanged=\{recargarYAvisar\}/);
  assert.match(presupuestos, /onRecargar=\{recargarYAvisar\}/);
  const tarjeta = leer("src/components/dashboard/expediente-rediseno/cuenta-del-plan.tsx");
  assert.match(tarjeta, /onCambio\?\.\(notas\);\n\s*setTimeout\(\(\) => router\.refresh\(\), 0\);/);
  assert.match(leer("src/components/dashboard/expediente-rediseno/plan-tratamiento.tsx"), /cuentas\?\.get\(p\.id\)\?\.estado === "ABANDONED"/);
});

test("v7 (QA de t12): «Completar consulta» guarda antes lo escrito en «Nueva consulta»", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  const desde = ficha.indexOf("const handleEndConsult = useCallback(");
  const cuerpo = ficha.slice(desde, ficha.indexOf("/complete`", desde));
  assert.ok(cuerpo.indexOf("guardarConsultaAbiertaRef.current") > 0, "se guarda la consulta abierta…");
  assert.ok(cuerpo.indexOf("guardarConsultaAbiertaRef.current") < cuerpo.indexOf("const notaFirmada = notaFirmadaDeLaConsultaRef.current"), "…antes de decidir con qué nota se cierra");
  assert.match(cuerpo, /=== "fallo"\) return;/);
  assert.equal((ficha.match(/registrarGuardado=\{registrarGuardadoDeConsulta\}/g) ?? []).length, 2, "las dos «Nueva consulta» dentales");
  const form = leer("src/components/clinical/dental-form.tsx");
  assert.match(form, /onSaved\(record\);\n\s*return true;/);
  assert.match(form, /return \(await handleSave\(\)\) \? "guardada" : "fallo";/);
  assert.match(form, /return \(\) => registrarGuardado\(null\);/);
});

test("v4 · N1: la cabecera se relee también cuando cambian las cuentas de los planes («marcar hecho»)", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  const desde = ficha.indexOf("porFactura: aunNoSeDebePorFactura } = useLoQueAunNoSeDebe(");
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

test("v7: «Cobrar hoy» — «además tiene $X por cobrar» sin lo que aún no se debe", () => {
  const facturas = [
    { id: "nota-plan", status: "PENDING", balance: 2050.5 },
    { id: "extra", status: "PARTIAL", balance: 300 },
    { id: "pagada", status: "PAID", balance: 0 },
  ];
  assert.deepEqual(pendientesPrevios(facturas), { cuantas: 2, saldo: 2350.5 }, "sin datos, como siempre");
  assert.deepEqual(pendientesPrevios(facturas, { "nota-plan": 2050.5 }), { cuantas: 1, saldo: 300 }, "plan sin hacer: no cuenta");
  assert.deepEqual(pendientesPrevios(facturas, { "nota-plan": 1250.5 }), { cuantas: 2, saldo: 1100 }, "lo hecho sí");
});
