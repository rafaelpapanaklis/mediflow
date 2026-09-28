/**
 * ws1-t6 — TRATAMIENTOS ACTIVOS: a diferencia de quotesHandler (que entra como
 * historia MIGRATED), esta entidad crea un Quote ACCEPTED + TreatmentPlan
 * (ACTIVE/COMPLETED) + TreatmentSession de lo ya hecho + Invoice + Payment de lo
 * ya abonado — vivo y continuable, sin condiciones de pago (para que el barrido
 * de cobranza no le mande WhatsApp a historia migrada) y sin que
 * `nextExpectedDate` quede nunca en el pasado (para que treatment-followup no
 * dispare un seguimiento el primer barrido tras importar).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/tratamientos-activos.test.ts
 *      (y otra vez con TZ=Asia/Tokyo: nada debe depender de la zona del servidor)
 *
 * Se conduce el motor DE VERDAD (runImport + treatmentPlansHandler) con Prisma
 * sustituido por el doble en memoria (doble-prisma.ts), que hace cumplir el
 * `where` y la unicidad de folio; el folio de FACTURA sale de un SQL crudo que
 * el doble no conoce, así que `lastInvoiceFolio` se sustituye por un contador
 * simple (igual que hace importador-arreglos.test.ts para saldos/quotes).
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const IMPORTA = "u_admin";

function isoFuturo(dias: number): string {
  return new Date(Date.now() + dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function isoPasado(dias: number): string {
  return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const HOY = new Date();

function semilla() {
  const antes = new Date("2026-09-01T10:00:00.000Z");
  return {
    clinic: [{ id: CLINICA, name: "Clínica Sonrisa", timezone: "America/Mexico_City" }],
    patient: [
      { id: "p1", clinicId: CLINICA, patientNumber: "P-0001", firstName: "María", lastName: "Hernández", phone: "5551234567", email: null, dob: null, deletedAt: null, visibleUserIds: [], updatedAt: antes },
    ],
    user: [
      { id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true },
      { id: "u_ana", clinicId: CLINICA, firstName: "Ana", lastName: "López", isActive: true },
    ],
    procedureCatalog: [
      { id: "pc1", clinicId: CLINICA, name: "Profilaxis", isActive: true },
    ],
    // Un presupuesto ACCEPTED normal del panel (NO de esta importación), a
    // propósito con el MISMO paciente + fecha + total que el tratamiento que se
    // va a importar en la prueba 1: si la deduplicación no filtrara por el
    // marcador propio (esNotaDeTratamientoActivo), este lo marcaría "duplicado"
    // por error.
    quote: [
      { id: "q_normal", clinicId: CLINICA, patientId: "p1", folio: "P-0007", status: "ACCEPTED", total: 1350, notes: null, createdAt: new Date("2024-02-05T12:00:00Z") },
    ],
    quoteItem: [],
    treatmentPlan: [],
    treatmentSession: [],
    invoice: [],
    payment: [],
    importExternalIds: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) },
});
mock.module("@/lib/invoices/next-invoice-number", { namedExports: { lastInvoiceFolio: async () => 500 } });

const engine = () => import("../engine");
const entidades = () => import("../entities");

function reiniciar(cambios?: (s: ReturnType<typeof semilla>) => void) {
  const s = semilla();
  cambios?.(s);
  base = crearBase(s);
}

const csv = (nombre: string, texto: string) => new File([texto], nombre, { type: "text/csv" });

async function correr(
  file: File,
  opts: { dryRun?: boolean; skipDuplicates?: boolean; origin?: string; valueMapping?: any } = { dryRun: true },
): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS.treatmentPlans, {
    file,
    clinicId: CLINICA,
    userId: IMPORTA,
    role: "ADMIN",
    dryRun: opts.dryRun ?? true,
    skipDuplicates: opts.skipDuplicates ?? true,
    columnMapping: null,
    origin: opts.origin ?? null,
    valueMapping: opts.valueMapping ?? null,
    sheet: null,
  });
}

const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);
const tabla = (m: string) => base.tablas[m] ?? [];
const CABECERA = "nombre,apellido,telefono,folio,fecha,titulo,doctor,procedimiento,pieza,cantidad,precio,descuento,estado,fechaRealizado,abonado,fechaAbono,proximaVisita";

test("feliz: una línea hecha + una pendiente → ACTIVE, factura PARTIAL, sesión con la fecha real; NO colisiona con un ACCEPTED normal del panel", async () => {
  reiniciar();
  const futuro = isoFuturo(45);
  const texto = [
    CABECERA,
    `María,Hernández,5551234567,9001,${"2024-02-05"},Rehabilitación,Ana López,Resina simple,16,1,850.00,0,Realizado,2024-02-10,500,2024-02-10,${futuro}`,
    `María,Hernández,5551234567,9001,${"2024-02-05"},Rehabilitación,Ana López,PROFILAXIS,,1,600,100,Pendiente,,,,`,
  ].join("\n");
  const prev = await correr(csv("t.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos, prev.duplicados], [2, 2, 0, 0]);

  const hecho = await correr(csv("t.csv", texto), { dryRun: false });
  assert.equal(hecho.created, 1);

  const q = tabla("quote").find((x) => x.id !== "q_normal")!;
  assert.equal(q.status, "ACCEPTED");
  assert.equal(q.patientId, "p1");
  assert.equal(q.total, 1350); // 850 + (600 − 100)
  assert.equal(q.createdAt.toISOString(), "2024-02-05T12:00:00.000Z");
  assert.equal(q.acceptedAt.getTime(), q.createdAt.getTime());
  assert.match(q.notes, /^Tratamiento activo migrado de otro sistema el/);
  assert.match(q.notes, /\nFolio original \(tratamiento activo\): 9001\n/);
  assert.ok(!/^Presupuesto migrado/.test(q.notes));

  const plan = tabla("treatmentPlan").find((p) => p.patientId === "p1")!;
  assert.ok(plan, "crea el plan de tratamiento");
  assert.equal(plan.doctorId, "u_ana");
  assert.equal(plan.status, "ACTIVE");
  assert.equal(plan.totalSessions, 2); // 1 día hecho + 1 hueco pendiente
  assert.equal(plan.totalCost, 1350);
  assert.equal(q.treatmentPlanId, plan.id);

  const sesiones = tabla("treatmentSession").filter((s) => s.treatmentId === plan.id);
  assert.equal(sesiones.length, 1);
  assert.equal(sesiones[0].completedAt.toISOString().slice(0, 10), "2024-02-10");
  assert.match(sesiones[0].notes, /Resina simple/);

  const inv = tabla("invoice").find((i) => i.patientId === "p1" && i.id === q.invoiceId)!;
  assert.ok(inv, "crea la factura");
  assert.equal(inv.total, 1350);
  assert.equal(inv.paid, 500);
  assert.equal(inv.balance, 850);
  assert.equal(inv.status, "PARTIAL");
  assert.match(inv.invoiceNumber, /^MF-\d+$/);
  assert.equal(inv.createdAt.toISOString(), "2024-02-05T12:00:00.000Z");

  const pagos = tabla("payment").filter((p) => p.invoiceId === inv.id);
  assert.equal(pagos.length, 1);
  assert.equal(pagos[0].amount, 500);
  assert.equal(pagos[0].method, "migrated");
  assert.equal(pagos[0].paidAt.toISOString().slice(0, 10), "2024-02-10");

  // Próxima visita declarada (futura): se respeta tal cual, nunca en el pasado.
  assert.equal(plan.nextExpectedDate.toISOString().slice(0, 10), futuro);

  // Nunca se crean condiciones de pago / plan a plazos sobre lo migrado.
  assert.ok(!Object.keys(base.llamadas).some((k) => /^(paymentPlan|orthoPaymentPlan|invoicePaymentLink)\./.test(k)));

  // Reimportar el mismo archivo: 0 nuevos (idempotente), y el q_normal preexistente sigue intacto.
  const prev2 = await correr(csv("t.csv", texto), { dryRun: true });
  assert.equal(prev2.duplicados, 2, "las dos líneas del mismo tratamiento salen como ya migradas");
  const otraVez = await correr(csv("t.csv", texto), { dryRun: false });
  assert.equal(otraVez.created, 0);
  assert.equal(tabla("quote").length, 2); // q_normal + el migrado, ninguno de más
});

test("todo hecho → COMPLETED, sin próxima visita, factura PAID cuando lo abonado cubre el total", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,9002,2024-03-01,Limpieza,,Profilaxis,,1,500,0,Realizado,2024-03-01,500,,",
  ].join("\n");
  await correr(csv("t2.csv", texto), { dryRun: false });
  const plan = tabla("treatmentPlan").find((p) => p.name === "Limpieza · migrado de otro sistema")!;
  assert.ok(plan);
  assert.equal(plan.status, "COMPLETED");
  assert.equal(plan.totalSessions, 1);
  assert.equal(plan.nextExpectedDate, null);
  const q = tabla("quote").find((x) => x.treatmentPlanId === plan.id)!;
  const inv = tabla("invoice").find((i) => i.id === q.invoiceId)!;
  assert.equal(inv.status, "PAID");
  assert.equal(inv.balance, 0);
  assert.ok(inv.paidAt, "factura totalmente pagada: paidAt queda fijo");
});

test("sin abonado: factura PENDING y ningún Payment creado", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,9003,2024-03-05,Endodoncia,,Endodoncia,,1,2000,0,Pendiente,,,,",
  ].join("\n");
  await correr(csv("t3.csv", texto), { dryRun: false });
  const plan = tabla("treatmentPlan").find((p) => p.name.startsWith("Endodoncia"))!;
  const q = tabla("quote").find((x) => x.treatmentPlanId === plan.id)!;
  const inv = tabla("invoice").find((i) => i.id === q.invoiceId)!;
  assert.equal(inv.paid, 0);
  assert.equal(inv.status, "PENDING");
  assert.equal(tabla("payment").filter((p) => p.invoiceId === inv.id).length, 0);
});

test("doctor no encontrado: el tratamiento queda a cargo de quien importa, con aviso — nunca bloquea", async () => {
  reiniciar();
  const texto = [
    CABECERA,
    "María,Hernández,5551234567,9004,2024-03-06,Corona,Dr. Inventado,Corona,,1,3000,0,Pendiente,,,,",
  ].join("\n");
  const prev = await correr(csv("t4.csv", texto), { dryRun: true });
  assert.equal(fila(prev, 2).status, "ok");
  assert.match(fila(prev, 2).warnings.join(" · "), /Doctor "Dr\. Inventado" no encontrado.*el tratamiento queda a cargo de quien importa/);
  await correr(csv("t4.csv", texto), { dryRun: false });
  const plan = tabla("treatmentPlan").find((p) => p.name.startsWith("Corona"))!;
  assert.equal(plan.doctorId, IMPORTA);
});

test("M7 (QA ws1-t10): «Tratamiento» Y «Procedimiento» en la misma hoja no caen en el mismo campo", async () => {
  reiniciar();
  const texto = "nombre,apellido,telefono,folio,fecha,Tratamiento,Procedimiento,precio,estado\nMaría,Hernández,5551234567,9010,2024-04-01,QA plan activo,Resina simple,850,Pendiente\n";
  const prev = await correr(csv("conflicto.csv", texto), { dryRun: true });
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev));
  assert.equal(prev.suggestedMapping["Tratamiento"], "title");
  assert.equal(prev.suggestedMapping["Procedimiento"], "procedure");
  await correr(csv("conflicto.csv", texto), { dryRun: false });
  const plan = tabla("treatmentPlan").find((p) => p.name.startsWith("QA plan activo"))!;
  assert.ok(plan, "el título viene de «Tratamiento», no de «Procedimiento»");
  const q = tabla("quote").find((x) => x.treatmentPlanId === plan.id)!;
  assert.match(q.title ?? "", /QA plan activo/);
});

test("próxima visita ya vencida en el archivo se clampa a futuro: nunca dispara el seguimiento el primer barrido", async () => {
  reiniciar();
  const vencida = isoPasado(400);
  const texto = [
    CABECERA,
    `María,Hernández,5551234567,9005,2024-03-07,Ortodoncia,,Ajuste,,1,800,0,Pendiente,,,,${vencida}`,
  ].join("\n");
  await correr(csv("t5.csv", texto), { dryRun: false });
  const plan = tabla("treatmentPlan").find((p) => p.name.startsWith("Ortodoncia"))!;
  assert.ok(plan.nextExpectedDate.getTime() > HOY.getTime(), "nunca queda en el pasado");
  const dias = (plan.nextExpectedDate.getTime() - HOY.getTime()) / (24 * 60 * 60 * 1000);
  assert.ok(dias > 25 && dias < 35, `se clampa a ~30 días (dio ${dias.toFixed(1)})`);
});
