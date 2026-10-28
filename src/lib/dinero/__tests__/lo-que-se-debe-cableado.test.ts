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
import { deudaDeNotaDelPlan, type FilaParaDeuda } from "@/lib/treatments/por-cobrar";
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
  assert.equal((ficha.match(/aunNoSeDebe(: porHacerCompleto)?\s*[,}]/g) ?? []).length >= 3, true, "los tres «Estado de cuenta» reciben la cifra");
  for (const f of [
    "src/components/dashboard/patient-detail/side-cards.tsx",
    "src/components/dashboard/pacientes-rediseno/resumen.tsx",
    "src/components/dashboard/patient-detail/billing-tab.tsx",
  ]) assert.match(leer(f), /patients\.sideCards\.aunNoSeDebe/, f);
});

test("v7 (QA de t12): «Estado de cuenta» (Resumen, lateral y Facturación) dice lo que se DEBE, no el saldo de la nota", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /saldo: saldoQueSeDebe,\n\s*aunNoSeDebe: porHacerCompleto,\n\s*pagadoDeLoPorHacer: adelantoEnPlanes,\n\s*cuotasPorVencer,\n\s*credito: creditBalance,/, "Resumen");
  assert.match(ficha, /balance: saldoQueSeDebe,\n\s*aunNoSeDebe: porHacerCompleto,\n\s*pagadoDeLoPorHacer: adelantoEnPlanes,\n\s*cuotasPorVencer,\n\s*credit: creditBalance,/, "lateral");
  assert.match(ficha, /summary=\{\{ total: totalPlan, paid: totalPaid, balance: saldoQueSeDebe, aunNoSeDebe: porHacerCompleto, pagadoDeLoPorHacer: adelantoEnPlanes, cuotasPorVencer \}\}/, "Facturación");
  assert.doesNotMatch(ficha, /saldo: totalBalance|balance: totalBalance/, "ningún «Estado de cuenta» con la suma de saldos");
  assert.doesNotMatch(ficha, /hasBalance=\{totalBalance > 0\}/, "la pestaña Facturación no se pinta «con deuda» por lo que aún no se debe");
  // v8 (t5, V1): saldo a favor = SOLO el libro; lo adelantado de un plan es «de lo por hacer, ya pagado».
  assert.doesNotMatch(ficha, /creditBalance \+ adelantoEnPlanes/);
  // v12 (t5, m1): sin las cuotas por vencer, que van aparte.
  assert.match(ficha, /const porHacerCompleto = Math\.round\(\(aunNoSeDebe - cuotasPorVencer \+ adelantoEnPlanes\) \* 100\) \/ 100;/);
  for (const f of [
    "src/components/dashboard/patient-detail/side-cards.tsx",
    "src/components/dashboard/pacientes-rediseno/resumen.tsx",
    "src/components/dashboard/patient-detail/billing-tab.tsx",
  ]) assert.match(leer(f), /patients\.sideCards\.pagadoDeLoPorHacer/, f);
  assert.match(leer("src/lib/dinero/lo-que-se-debe.server.ts"), /Math\.min\(d\.saldoAFavor, d\.porHacer\)/);
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
  const desde = ficha.indexOf("const cerrarConsulta = useCallback(");
  const cuerpo = ficha.slice(desde, ficha.indexOf("/complete`", desde));
  assert.ok(cuerpo.indexOf("guardarConsultaAbiertaRef.current") > 0, "se guarda la consulta abierta…");
  assert.ok(cuerpo.indexOf("guardarConsultaAbiertaRef.current") < cuerpo.indexOf("const notaFirmada = notaFirmadaDeLaConsultaRef.current"), "…antes de decidir con qué nota se cierra");
  assert.match(cuerpo, /=== "fallo"\) return;/);
  assert.equal((ficha.match(/registrarGuardado=\{registrarGuardadoDeConsulta\}/g) ?? []).length, 2, "las dos «Nueva consulta» dentales");
  const form = leer("src/components/clinical/dental-form.tsx");
  assert.match(form, /onSaved\(record\);\n\s*return true;/);
  assert.match(form, /return \(await guardar\(\)\) \? "guardada" : "fallo";/);
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

test("v8 · V1 (caso de la QA): plan $2,600, $800 hecho, $1,000 pagado → debe $0; por hacer $1,800, de los que $200 ya pagados", () => {
  const nota = {
    id: "n1", total: 2600, paid: 1000, createdAt: new Date("2026-10-20T16:00:00Z"), discount: 0, taxRate: null, taxIncluded: true,
    items: [
      { name: "Limpieza", quantity: 1, unitPrice: 800, planItemId: "f1" },
      { name: "Corona", quantity: 1, unitPrice: 1800, planItemId: "f2" },
    ],
  };
  const filas = new Map<string, FilaParaDeuda>([
    ["f1", { id: "f1", estado: "hecho", hechoEn: new Date("2026-10-25T16:00:00Z") }],
    ["f2", { id: "f2", estado: "pendiente", hechoEn: null }],
  ]);
  const d = deudaDeNotaDelPlan(nota, filas, null);
  // Lo que suman la ficha («aún no se debe» = por hacer sin pagar) y el endpoint (`adelanto`, con tope en lo por hacer).
  const aunNoSeDebe = d.porHacerSinPagar;
  const adelanto = Math.min(d.saldoAFavor, d.porHacer);
  assert.equal(d.debe, 0);
  assert.equal(aunNoSeDebe, 1600);
  assert.equal(adelanto, 200, "«De lo por hacer, $200 ya están pagados»");
  assert.equal(aunNoSeDebe + adelanto, 1800, "«Además, $1,800 por hacer» = el «Por hacer» de la Cuenta del plan");
  assert.equal(d.porHacer, 1800);
});

test("v8 · V2: «Completar consulta» una sola a la vez (ref + botones desactivados) y sin guardar dos veces", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  const desde = ficha.indexOf("const handleEndConsult = useCallback(");
  const guardia = ficha.slice(desde, ficha.indexOf("}, [t]);", desde));
  assert.match(guardia, /if \(completandoConsultaRef\.current\) return;\n\s*completandoConsultaRef\.current = true;\n\s*setCompletandoConsulta\(true\);/);
  assert.match(guardia, /finally \{\n\s*if \(tope\) clearTimeout\(tope\);\n\s*completandoConsultaRef\.current = false;\n\s*setCompletandoConsulta\(false\);/);
  assert.match(ficha, /cerrarConsultaRef\.current = cerrarConsulta;/);
  assert.match(ficha, /onClose=\{\(\) => handleEndConsult\(\)\}\n\s*ocupado=\{completandoConsulta\}/);
  const barra = leer("src/components/dashboard/patient-detail/consult-bar.tsx");
  assert.equal((barra.match(/disabled=\{ocupado\}/g) ?? []).length, 2, "«Completar» y la X");
  // El formulario: un guardado en curso se espera, no se repite (botón «Guardar consulta» incluido).
  const form = leer("src/components/clinical/dental-form.tsx");
  assert.match(form, /if \(guardadoEnCursoRef\.current\) return guardadoEnCursoRef\.current;/);
  assert.match(form, /if \(guardadoEnCursoRef\.current\) return \(await guardadoEnCursoRef\.current\) \? "guardada" : "fallo";/);
  assert.match(form, /onSubmit=\{e => \{ e\.preventDefault\(\); void guardar\(\); \}\}/);
});

test("v8 · V3 y sospecha 1: el motivo de la barra cuenta; vitales, exploración, pronóstico y dientes son «algo escrito»", () => {
  const form = leer("src/components/clinical/dental-form.tsx");
  assert.match(form, /dxs\.length === 0 && !motivoEnLaBarraRef\.current\)/);
  assert.match(form, /tieneContenido\(form\) \|\| tieneContenido\(vitals\) \|\| tieneContenido\(exploracion\) \|\|\n\s*!!pronostico \|\| dxs\.length > 0 \|\| selectedProcs\.length > 0 \|\| odoBasesRef\.current\.size > 0;/);
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  // Solo cuenta lo que la barra de verdad dejó en la nota (PATCH bien), y solo motivo o diagnóstico.
  assert.match(ficha, /barraEnLaNota = !!r\?\.ok;/);
  assert.match(ficha, /const motivoODiagnostico = barraEnLaNota && !!\(borrador\.subjective\.trim\(\) \|\| borrador\.assessment\.trim\(\)\);/);
  assert.match(ficha, /guardarConsulta\(\{ motivoODiagnostico \}\)/);
});

test("v9 · M1: la Cuenta del plan llama «Pagado por adelantado» a lo pagado de más sobre lo hecho; «saldo a favor» es solo el libro", () => {
  const tarjeta = leer("src/components/dashboard/expediente-rediseno/cuenta-del-plan.tsx");
  assert.match(tarjeta, /<div data-cifra="pagado-por-adelantado">\n\s*<dt>\{t\("planTratamiento\.cobro\.pagadoPorAdelantado"\)\}<\/dt>/);
  assert.doesNotMatch(tarjeta, /planTratamiento\.cobro\.saldoAFavor/, "ningún «Saldo a favor» para dinero que sigue en la nota");
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  assert.equal(es.planTratamiento.cobro.pagadoPorAdelantado, "Pagado por adelantado");
  assert.equal(en.planTratamiento.cobro.pagadoPorAdelantado, "Paid in advance");
  // Lo que dice lo mismo en «Estado de cuenta» y la ayuda de la tarjeta: «pagados por adelantado», no «a favor».
  // v14 (QA): el mismo rótulo que la tarjeta, «Pagado por adelantado: $X».
  assert.ok(es.patients.sideCards.pagadoDeLoPorHacer.startsWith(es.planTratamiento.cobro.pagadoPorAdelantado));
  assert.match(es.planTratamiento.cobro.tambienAFavor, /pagados por adelantado/);
  assert.doesNotMatch(es.planTratamiento.cobro.ayudaAdelanto, /a favor/);
});

test("v9 · observación 1: «Completar consulta» tiene tope: pasado, suelta los botones y avisa", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /const TOPE_COMPLETAR_CONSULTA_MS = 90_000;/);
  const desde = ficha.indexOf("const handleEndConsult = useCallback(");
  const guardia = ficha.slice(desde, ficha.indexOf("}, [t]);", desde));
  assert.match(guardia, /Promise\.race\(\[/);
  assert.match(guardia, /setTimeout\(\(\) => resolver\("tarda"\), TOPE_COMPLETAR_CONSULTA_MS\)/);
  assert.match(guardia, /if \(resultado === "tarda"\) toast\.error\(t\("patients\.consult\.completeSlow"\)/);
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  assert.ok(es.patients.consult.completeSlow);
});

test("A9 (27-oct): con cuotas acordadas manda la mensualidad — Caja, Cuenta del plan, aviso, Sabina y la ficha usan la misma regla", () => {
  // Una sola regla (`deudaConCuotasAcordadas`), en Caja (→ `loQueAunNoSeDebe`, portal, Inbox, Pacientes) y en la Cuenta del plan.
  const caja = leer("src/lib/caja.ts");
  assert.match(caja, /const deuda = deLoHecho && esPlanAPlazos\(porFactura\.get\(f\.id\)\) \? deudaConCuotasAcordadas\(deLoHecho, delCalendario\) : deLoHecho;/);
  assert.match(caja, /if \(deuda\?\.porCuotas\) porVencerCuotasC \+= /);
  const cuenta = leer("src/lib/treatments/cobro.server.ts");
  assert.match(cuenta, /deudaConCuotasAcordadas\(deLoHecho, estadoDelPlan\(calendarioDeCuotas\(c, l\.nota\.total\), pagosDesdeFilas\(cobros\.get\(f\.id\)\), hoy\)\.importeVencido\)/);
  const ayudante = leer("src/lib/dinero/lo-que-se-debe.server.ts");
  assert.match(ayudante, /const porVencer = Math\.round\(\(\(s\.porVencerOrto \?\? 0\) \+ \(s\.porVencerCuotas \?\? 0\)\) \* 100\) \/ 100;/);
  // El bot y el WhatsApp de cobranza ya siguen el calendario de cuotas: la misma cuenta (`estadoDelPlan`).
  const datos = leer("src/lib/whatsapp/cobranza/datos.ts");
  assert.match(datos, /const estado = estadoDelPlan\(cuotas, f\.pagos, hoy\);/);
  // El aviso de saldo (ruta y tarjeta de Sabina): lo vencido y, aparte, el saldo total.
  const ruta = leer("src/app/api/invoices/[id]/send-whatsapp/route.ts");
  assert.match(ruta, /const aCuotas = noSeDebe\.porVencer > 0;\n\s*if \(aCuotas\) saldoTotalDelTratamiento = invoice\.balance;/);
  const sabina = leer("src/lib/sabina/dinero/avisar-saldo.ts");
  assert.match(sabina, /const m = await mensajeDe\(ctx, f, aCuotas \? saldoCompleto : null\);/);
  assert.match(sabina, /saldoTotalDelTratamiento,\n/);
  // La ficha dice por qué: cuotas vencidas, no «lo hecho».
  const tarjeta = leer("src/components/dashboard/expediente-rediseno/cuenta-del-plan.tsx");
  assert.match(tarjeta, /c\.aCuotas \? "planTratamiento\.cobro\.vencidoCuotas" : "planTratamiento\.cobro\.vencidoDe"/);
  assert.match(tarjeta, /t\("planTratamiento\.cobro\.cuotasAyuda"\)/);
  const abono = leer("src/components/dashboard/cobrar-hoy/abono-al-plan.tsx");
  assert.match(abono, /plan\.aCuotas \? "planTratamiento\.cobro\.debeHoyCuotas" : "planTratamiento\.cobro\.debeHoy"/);
  // v14: la forma de la cuenta vive en un ayudante que usan /cuentas y las acciones («Hecho», «Cerrar plan»).
  assert.match(leer("src/lib/treatments/cuenta-para-la-ficha.server.ts"), /aCuotas: cuenta\.aCuotas \?\? false,/);
  for (const idioma of ["es", "en"]) {
    const cobro = JSON.parse(leer(`src/i18n/dictionaries/${idioma}.json`)).planTratamiento.cobro;
    for (const k of ["vencidoCuotas", "cuotasAyuda", "tambienAdelantoCuotas", "cerrarSigueCuotas", "debeHoyCuotas", "ayudaAdelantoCuotas"]) {
      assert.ok(cobro[k], `${idioma}: planTratamiento.cobro.${k}`);
    }
    for (const k of ["vencidoCuotas", "tambienAdelantoCuotas", "cerrarSigueCuotas"]) assert.match(cobro[k], /\{monto\}/);
    assert.match(cobro.ayudaAdelantoCuotas, /\{debe\}[\s\S]*\{saldo\}/);
  }
});

test("v11 · «Hecho» en la tarjeta del plan: misma acción que la consulta, refresca la ficha sin recargar; plan cerrado sin botones", async () => {
  const tarjeta = leer("src/components/dashboard/expediente-rediseno/plan-tratamiento.tsx");
  assert.match(tarjeta, /<ProcedimientosDelPlan\n\s*planId=\{plan\.id\}\n\s*estadoDelPlan=\{plan\.status\}/);
  assert.match(tarjeta, /onCambio=\{\(\) => onCuentaCambio\?\.\(\[\]\)\}/, "relee cuentas, «Estado de cuenta» y el odontograma (alCambiarDineroDePlanes)");
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /puedeMarcarHecho=\{canEditTreatments \|\| currentUser\.role === "SUPER_ADMIN"\}/);
  assert.match(ficha, /refresco=\{`\$\{refrescoCuentas\}\|/);
  // `loQueAunNoSeDebe` (cabecera, «Estado de cuenta», Cobrar hoy) se relee con el mismo `refrescoCuentas`.
  assert.match(ficha, /useLoQueAunNoSeDebe\(\n\s*patient\.id,\n[^\n]*\n\s*`\$\{refrescoCuentas\}\|/);
  const bloque = leer("src/components/dashboard/expediente-rediseno/procedimientos-del-plan.tsx");
  assert.match(bloque, /^"use client";/);
  assert.match(bloque, /const cerrado = ESTADOS_DE_PLAN_SIN_HECHO\.includes\(estadoDelPlan\);\n\s*const conBotones = puede && !cerrado;/);
  assert.match(bloque, /await marcarHecho\(planId, \[f\.id\], null\)/);
  assert.match(bloque, /await deshacerHecho\(planId, f\.id\)/);
  const ruta = leer("src/app/api/treatments/[id]/route.ts");
  assert.match(ruta, /const deniedPerm = esHecho && ctx\.role === "SUPER_ADMIN" \? null : denyIfMissingPermission\(ctx, "treatments\.edit"\);/);
  for (const idioma of ["es", "en"]) {
    const h = JSON.parse(leer(`src/i18n/dictionaries/${idioma}.json`)).planTratamiento.hecho;
    for (const k of ["procedimientos", "estadoPorHacer", "estadoEnCurso", "estadoHecho", "botonHecho", "marcando", "marcarAria", "deshacerAria", "ayudaTarjeta", "planCerrado"]) {
      assert.ok(h[k], `${idioma}: planTratamiento.hecho.${k}`);
    }
    assert.ok(h.error.plan_cerrado, `${idioma}: planTratamiento.hecho.error.plan_cerrado`);
    assert.match(h.estadoHecho, /\{fecha\}/);
  }

  // El cliente del deshacer: estado y avisos del servidor; un PATCH de antes (sin `item`) no es un éxito.
  const { deshacerHecho, ESTADOS_DE_PLAN_SIN_HECHO } = await import("@/lib/treatments/marcar-hecho-cliente");
  assert.deepEqual(ESTADOS_DE_PLAN_SIN_HECHO, ["ABANDONED"]);
  const pedidos: Array<{ url: string; body: string }> = [];
  const responde = (status: number, cuerpo: unknown) => async (url: string, init?: RequestInit) => {
    pedidos.push({ url, body: String(init?.body) });
    return new Response(JSON.stringify(cuerpo), { status });
  };
  const ok = await deshacerHecho("p 1", "f1", responde(200, {
    success: true, item: { id: "f1" }, estado: "en_curso", mensaje: "Listo.",
    odontograma: { conflictos: [{ mensaje: "Diente 16: no se devolvió." }] }, // sin motivo: no es un conflicto que se sepa decir
  }));
  // v12 (t5, m3): datos, no el texto español del servidor (la tarjeta lo dice en su idioma).
  assert.deepEqual(ok, { ok: true, status: 200, estado: "en_curso" });
  assert.equal(pedidos[0].url, "/api/treatments/p%201");
  assert.deepEqual(JSON.parse(pedidos[0].body), { action: "deshacer_hecho", itemId: "f1" });
  assert.deepEqual(await deshacerHecho("p", "f1", responde(409, { error: "Este plan está cerrado.", code: "plan_cerrado" })), { ok: false, status: 409, error: "Este plan está cerrado.", codigo: "plan_cerrado" });
  assert.equal((await deshacerHecho("p", "f1", responde(200, { success: true }))).noDisponible, true);
});

test("v12 · m3: los avisos de «Hecho» / «Deshacer» de la tarjeta salen en el idioma de la pantalla, no en el español del servidor", async () => {
  const { avisoDeHecho, avisoDeDeshacer, errorDeHecho, marcarHecho, deshacerHecho, CODIGOS_DE_HECHO, RESULTADOS_DE_HECHO } = await import("@/lib/treatments/marcar-hecho-cliente");
  const { getDict } = await import("@/i18n/dictionaries");
  const { makeT } = await import("@/i18n/t");
  const en = makeT(getDict("en"));
  const es = makeT(getDict("es"));
  const dicEn = JSON.parse(leer("src/i18n/dictionaries/en.json")).planTratamiento.hecho;
  // Cada estado, motivo y código tiene su texto en los dos idiomas.
  for (const d of [dicEn, JSON.parse(leer("src/i18n/dictionaries/es.json")).planTratamiento.hecho]) {
    for (const k of RESULTADOS_DE_HECHO) assert.ok(d.resultado[k], `resultado.${k}`);
    for (const k of CODIGOS_DE_HECHO) assert.ok(d.error[k], `error.${k}`);
  }

  // Marcar: el servidor manda su texto en español; la tarjeta usa el estado.
  const r = await marcarHecho("p", ["f1"], null, async () => new Response(JSON.stringify({
    success: true, items: [{ id: "f1", estado: "hecho" }],
    odontograma: [{ itemId: "f1", estado: "sin_cambio", mensaje: "Hecho. Este procedimiento no cambia el odontograma." }],
  }), { status: 200 }));
  assert.deepEqual(r, { ok: true, status: 200, resultado: "sin_cambio" });
  assert.equal(avisoDeHecho(en, r), dicEn.resultado.sin_cambio);
  assert.equal(avisoDeHecho(en, {}), dicEn.resultado.aplicado);
  assert.equal(avisoDeHecho(en, { resultado: "raro" }), dicEn.resultado.aplicado);

  // Deshacer: estado + conflictos como datos → frase en inglés, con el hallazgo en inglés.
  const d = await deshacerHecho("p", "f1", async () => new Response(JSON.stringify({
    success: true, item: { id: "f1" }, estado: "pendiente", mensaje: "Listo: el procedimiento vuelve a pendiente…",
    odontograma: { conflictos: [{ motivo: "cambio_posterior", toothNumber: 16, conditionId: "caries", nota: null, mensaje: "Diente 16: …" }] },
  }), { status: 200 }));
  assert.deepEqual(d.conflictos, [{ motivo: "cambio_posterior", toothNumber: 16, conditionId: "caries", nota: null }]);
  const frase = avisoDeDeshacer(en, d, () => "Caries");
  assert.equal(frase, `${dicEn.deshecho.pendiente} ${en("planTratamiento.hecho.conflicto.cambio_posterior", { diente: "16", hallazgo: "Caries", nota: "" })}`);
  assert.doesNotMatch(frase, /Listo|Diente/);
  assert.equal(avisoDeDeshacer(en, { estado: "en_curso" }, (x) => x), dicEn.deshecho.en_curso);

  // Errores por código; uno desconocido, el genérico.
  assert.equal(errorDeHecho(en, { codigo: "plan_cerrado" }), dicEn.error.plan_cerrado);
  assert.equal(errorDeHecho(es, { codigo: "plan_cerrado" }), "Este plan está cerrado: ya no se marcan ni se deshacen procedimientos.");
  assert.equal(errorDeHecho(en, { codigo: "otro" }), dicEn.error.generico);

  // La tarjeta no enseña el texto del servidor: ni `mensaje` ni `error`.
  const bloque = leer("src/components/dashboard/expediente-rediseno/procedimientos-del-plan.tsx");
  assert.match(bloque, /toast\.success\(avisoDeHecho\(t, r\)\);/);
  assert.match(bloque, /toast\.success\(avisoDeDeshacer\(t, r, nombreDeHallazgo\), \{ duration: 8000 \}\);/);
  assert.match(bloque, /toast\.error\(errorDeHecho\(t, r, "marcar"\)\);/);
  assert.match(bloque, /toast\.error\(errorDeHecho\(t, r, "deshacer"\)\);/);
  assert.doesNotMatch(bloque, /r\.mensaje|r\.error/);
  // El servidor usa la misma lista de códigos.
  assert.match(leer("src/lib/treatments/aplicar-hecho.server.ts"), /const CODIGOS_HECHO = CODIGOS_DE_HECHO;/);
});

test("v12 · m2: con cuotas (o sin ver dinero) la ayuda de «Procedimientos» no dice que lo hecho pasa a «Debe»", () => {
  const tarjeta = leer("src/components/dashboard/expediente-rediseno/plan-tratamiento.tsx");
  assert.match(tarjeta, /debeSigueLoHecho=\{!!cuentas\?\.get\(plan\.id\) && !cuentas\.get\(plan\.id\)!\.aCuotas\}/);
  const bloque = leer("src/components/dashboard/expediente-rediseno/procedimientos-del-plan.tsx");
  assert.match(bloque, /debeSigueLoHecho = false/, "por omisión, sin hablar de «Debe»");
  // v13 (t5, n1): además, solo si lo por hacer ya está en una nota (`ayudaHablaDeDebe`).
  assert.match(bloque, /const conDebe = ayudaHablaDeDebe\(debeSigueLoHecho, vivas\);/);
  assert.match(bloque, /t\(conDebe \? "planTratamiento\.hecho\.ayudaTarjeta" : "planTratamiento\.hecho\.ayudaTarjetaSinDebe"\)/);
  for (const idioma of ["es", "en"]) {
    const h = JSON.parse(leer(`src/i18n/dictionaries/${idioma}.json`)).planTratamiento.hecho;
    assert.match(h.ayudaTarjeta, idioma === "es" ? /«Debe»/ : /“Owes”/);
    assert.doesNotMatch(h.ayudaTarjetaSinDebe, /Debe|Owes/);
    assert.match(h.ayudaTarjetaSinDebe, idioma === "es" ? /odontograma se actualiza\. Se puede deshacer\.$/ : /odontogram is updated\. It can be undone\.$/);
  }
});

test("v12 · m1: con cuotas, «Además» de la ficha dice solo las cuotas que aún no vencen, sin «ya pagados»; sin cuotas, como v8", () => {
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /const \{ total: aunNoSeDebe, adelanto: adelantoEnPlanes, cuotas: cuotasPorVencer, porFactura: aunNoSeDebePorFactura \} = useLoQueAunNoSeDebe\(/);
  assert.match(ficha, /const porHacerCompleto = Math\.round\(\(aunNoSeDebe - cuotasPorVencer \+ adelantoEnPlanes\) \* 100\) \/ 100;/);
  // Los tres sitios que lo pintan reciben las cuotas aparte.
  assert.equal((ficha.match(/pagadoDeLoPorHacer: adelantoEnPlanes,\n\s*cuotasPorVencer,/g) ?? []).length, 2);
  assert.match(ficha, /pagadoDeLoPorHacer: adelantoEnPlanes, cuotasPorVencer \}\}/);
  for (const archivo of [
    "src/components/dashboard/pacientes-rediseno/resumen.tsx",
    "src/components/dashboard/patient-detail/side-cards.tsx",
    "src/components/dashboard/patient-detail/billing-tab.tsx",
  ]) {
    const x = leer(archivo);
    assert.match(x, /data-cuotas-por-vencer/, archivo);
    assert.match(x, /t\("patients\.sideCards\.cuotasPorVencer", \{ monto: /, archivo);
  }
  // El adelanto («ya pagados») no cuenta las notas con cuotas.
  const ayudante = leer("src/lib/dinero/lo-que-se-debe.server.ts");
  assert.match(ayudante, /if \(esPlanAPlazos\(condiciones\.get\(id\)\)\) continue;/);
  assert.match(leer("src/app/api/patients/[id]/lo-que-aun-no-se-debe/route.ts"), /porVencerCuotas: r\.porVencerCuotas,/);
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json")).patients.sideCards;
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json")).patients.sideCards;
  assert.equal(es.cuotasPorVencer, "Además, {monto} de cuotas que aún no vencen");
  assert.equal(en.cuotasPorVencer, "Plus {monto} in installments not yet due");
});

test("v13 · n1: la ayuda solo dice «pasa a Debe» si lo que falta por hacer ya está en una nota de cobro", async () => {
  const { ayudaHablaDeDebe } = await import("@/lib/treatments/marcar-hecho-cliente");
  const fila = (estado: string, invoiceId: string | null) => ({ estado, invoiceId });
  // Plan sin aceptar (sin nota): «Hecho» no crea cobros → sin «Debe».
  assert.equal(ayudaHablaDeDebe(true, [fila("pendiente", null), fila("pendiente", null)]), false);
  // Aceptado: lo por hacer está en la nota.
  assert.equal(ayudaHablaDeDebe(true, [fila("pendiente", "n1"), fila("hecho", "n1")]), true);
  // Solo quedan por hacer filas agregadas después de la nota (sin nota).
  assert.equal(ayudaHablaDeDebe(true, [fila("hecho", "n1"), fila("en_curso", null)]), false);
  assert.equal(ayudaHablaDeDebe(true, [fila("cancelado", "n1"), fila("pendiente", null)]), false);
  // Con cuotas o sin cuenta (v12 m2), nunca.
  assert.equal(ayudaHablaDeDebe(false, [fila("pendiente", "n1")]), false);
});

test("v13 · n2: un error sin código no cae al genérico de «marcar»: 403 → permiso; si no, el genérico de la acción", async () => {
  const { errorDeHecho } = await import("@/lib/treatments/marcar-hecho-cliente");
  const { getDict } = await import("@/i18n/dictionaries");
  const { makeT } = await import("@/i18n/t");
  const en = makeT(getDict("en"));
  const es = makeT(getDict("es"));
  const e = (l: string) => JSON.parse(leer(`src/i18n/dictionaries/${l}.json`)).planTratamiento.hecho.error;
  const [errEs, errEn] = [e("es"), e("en")];
  // 403 sin código (permiso, doctor de otro plan, visibilidad): permiso, en los dos idiomas y en las dos acciones.
  assert.equal(errorDeHecho(en, { status: 403 }, "marcar"), errEn.sin_permiso);
  assert.equal(errorDeHecho(en, { status: 403 }, "deshacer"), errEn.sin_permiso);
  assert.equal(errorDeHecho(es, { status: 403 }, "deshacer"), "No tienes permiso para marcar o deshacer procedimientos de este plan. Pídeselo al administrador.");
  assert.match(errEn.sin_permiso, /permission/);
  // El código manda sobre el status (el 403 del odontograma tiene su propio texto).
  assert.equal(errorDeHecho(en, { status: 403, codigo: "sin_permiso_odontograma" }, "deshacer"), errEn.sin_permiso_odontograma);
  // 404, 401, red caída: el genérico de lo que se pulsó.
  assert.equal(errorDeHecho(en, { status: 404 }, "marcar"), errEn.generico);
  assert.equal(errorDeHecho(en, { status: 404 }, "deshacer"), errEn.genericoDeshacer);
  assert.equal(errorDeHecho(es, { status: 0 }, "deshacer"), "No se pudo deshacer el procedimiento.");
  assert.equal(errEn.genericoDeshacer, "The procedure couldn't be undone.");
  assert.doesNotMatch(errEs.genericoDeshacer, /marcar/);
  // Por omisión (la consulta, que solo marca): como antes.
  assert.equal(errorDeHecho(en, {}), errEn.generico);
});


test("v14 · 1: «Estado de cuenta» (Resumen, lateral, Facturación) dice «Pagado por adelantado» con la cifra de la tarjeta (centavos)", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  assert.equal(es.patients.sideCards.pagadoDeLoPorHacer, "Pagado por adelantado: {monto}");
  assert.equal(en.patients.sideCards.pagadoDeLoPorHacer, "Paid in advance: {monto}");
  assert.ok(en.patients.sideCards.pagadoDeLoPorHacer.startsWith(en.planTratamiento.cobro.pagadoPorAdelantado));
  for (const [f, valor] of [
    ["src/components/dashboard/pacientes-rediseno/resumen.tsx", "finanzas.pagadoDeLoPorHacer"],
    ["src/components/dashboard/patient-detail/side-cards.tsx", "finance.pagadoDeLoPorHacer"],
    ["src/components/dashboard/patient-detail/billing-tab.tsx", "summary.pagadoDeLoPorHacer"],
  ] as const) {
    // La tarjeta pinta $300.00 (fmtMXNdec): los tres sitios, igual (antes $300, y $300.50 salía $301).
    assert.ok(leer(f).includes(`t("patients.sideCards.pagadoDeLoPorHacer", { monto: fmtMXNdec(${valor} ?? 0) })`), f);
  }
});

test("v14 · 2: la Cuenta del plan cambia con la respuesta de «Hecho» / «Deshacer» / «Cerrar plan», y ninguna lectura vieja pisa una nueva", () => {
  const ruta = leer("src/app/api/treatments/[id]/route.ts");
  assert.match(ruta, /denyIfMissingPermission\(ctx, "billing\.view"\) \|\| denyIfMissingPermission\(ctx, "treatments\.view"\)\) return res;/);
  assert.match(ruta, /cuentaDeUnPlanParaLaFicha\(ctx\.clinicId, plan\.id\)/);
  const cerrar = leer("src/app/api/treatments/[id]/cerrar/route.ts");
  assert.match(cerrar, /denyIfMissingPermission\(ctx, "billing\.view"\) \|\| denyIfMissingPermission\(ctx, "treatments\.view"\)\n\s*\? null\n\s*: await cuentaDeUnPlanParaLaFicha\(ctx\.clinicId, plan\.id\)/);
  // Una sola forma de la cuenta: la de /cuentas y la de las acciones salen del mismo ayudante.
  assert.match(leer("src/app/api/treatments/cuentas/route.ts"), /await cuentaParaLaFicha\(\{ clinicId: ctx\.clinicId, plan: p,/);
  const tarjeta = leer("src/components/dashboard/expediente-rediseno/cuenta-del-plan.tsx");
  assert.match(tarjeta, /if \(paciente\.current !== delPaciente \|\| n < aplicado\.current\) return;/);
  assert.doesNotMatch(tarjeta, /vivo = false/, "una lectura en curso ya no se tira al cambiar la clave");
  assert.match(tarjeta, /const nueva = cuentaDeLaRespuesta\(cuerpo\);\n\s*if \(nueva\) onCuenta\?\.\(nueva\);/);
  const proc = leer("src/components/dashboard/expediente-rediseno/procedimientos-del-plan.tsx");
  assert.equal((proc.match(/if \(r\.cuenta\) onCuenta\?\.\(r\.cuenta\);/g) ?? []).length, 2, "al marcar y al deshacer");
  const plan = leer("src/components/dashboard/expediente-rediseno/plan-tratamiento.tsx");
  assert.match(plan, /onCambio=\{onCuentaCambio\} onCuenta=\{onCuentaNueva\} \/>/);
  assert.match(plan, /onCuenta=\{onCuentaNueva\}\n/);
  assert.match(leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx"), /onCuentaNueva=\{cuentasDePlanes\.poner\}/);
});

test("v14 · 3: «Tratamientos detectados» no dice «Cancelar factura»: «Cerrar» si no ofrece factura (todo es del plan), «No facturar» si la ofrece", () => {
  const modal = leer("src/components/dashboard/patient-detail/treatments-modal.tsx");
  assert.doesNotMatch(modal, /treatmentsModal\.cancelInvoice/);
  assert.match(modal, /const ofreceFactura = rows\.length > 0 \|\| !hayPlan;/);
  assert.match(modal, /\{ofreceFactura \? t\("patients\.treatmentsModal\.noFacturar"\) : t\("common\.close"\)\}/);
  assert.match(modal, /\{ofreceFactura && \(/, "factura y presupuesto, solo con lo de fuera de todo plan (como antes)");
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  assert.equal(es.patients.treatmentsModal.noFacturar, "No facturar");
  assert.equal(en.patients.treatmentsModal.noFacturar, "Don't invoice");
  assert.equal(es.common.close, "Cerrar");
});

test("v14 · 4: «Movimientos» (recientes y completo) se relee cuando la ficha cambia algo del paciente", () => {
  const mov = leer("src/components/dashboard/pacientes-rediseno/movimientos.tsx");
  assert.match(mov, /\}, \[patientId, q\.page, q\.pageSize, q\.categoria, q\.desde, q\.hasta, clave\]\);/);
  assert.match(mov, /useMovimientos\(patientId, consulta, clave\);[\s\S]*useMovimientos\(patientId, consulta, clave\);/);
  const ficha = leer("src/app/dashboard/patients/[id]/patient-detail-client.tsx");
  assert.match(ficha, /<MovimientosRecientes patientId=\{patient\.id\} onVerCompleto=\{\(\) => setTab\("movimientos"\)\} clave=\{claveMovimientos\} \/>/);
  assert.match(ficha, /<MovimientosCompleto patientId=\{patient\.id\} clave=\{claveMovimientos\} \/>/);
  assert.match(ficha, /appointments\.map\(\(a: any\) => `\$\{a\.id\}:\$\{a\.status\}`\)/, "una cita completada cambia la clave");
  // Y la ruta de «Completar consulta» sigue escribiendo su movimiento (no era un hueco del registro).
  assert.match(leer("src/app/api/appointments/[id]/complete/route.ts"), /patientId: existing\.patientId,\n\s*texto: textoCita\.completada\(/);
});
