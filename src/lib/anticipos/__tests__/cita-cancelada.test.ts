// H15 (decisión de Rafael, opción A — ws1-t4): cancelar una cita con dinero pagado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avisoDeDinero,
  decisionEfectiva,
  lineaDeMarca,
  motivoParaNoDejarAFavor,
  ultimaMarca,
} from "../cita-cancelada-core";

const RAIZ = join(__dirname, "../../../..");
const leer = (r: string) => readFileSync(join(RAIZ, r), "utf8");

test("el aviso dice cuánto hay pagado", () => {
  assert.match(avisoDeDinero(250), /^Esta cita tiene \$250(\.00)? pagados\.$/);
});

test("solo quien tiene permiso de cobro elige; sin él (o sin elección) queda pendiente", () => {
  assert.equal(decisionEfectiva("a_favor", true), "a_favor");
  assert.equal(decisionEfectiva("reembolso", true), "reembolso");
  assert.equal(decisionEfectiva(undefined, true), "pendiente");
  assert.equal(decisionEfectiva("cualquier cosa", true), "pendiente");
  assert.equal(decisionEfectiva("a_favor", false), "pendiente", "el cliente no puede forzarlo");
  assert.equal(decisionEfectiva("reembolso", false), "pendiente");
});

test("la marca se escribe y se lee de vuelta; manda la última", () => {
  const cuando = new Date("2026-09-29T16:00:00Z");
  const p = lineaDeMarca({ decision: "pendiente", monto: 100, quien: "Recepción QA", cuando });
  assert.match(p, /^\[CITA CANCELADA CON DINERO PAGADO · PENDIENTE DE DECIDIR · \$100(\.00)? · Recepción QA · 2026-09-29 16:00 UTC\]$/);
  assert.equal(ultimaMarca(p), "pendiente");
  const r = lineaDeMarca({ decision: "reembolso", monto: 100, quien: "Dueña", cuando });
  assert.equal(ultimaMarca(`notas viejas\n${p}\n${r}`), "reembolso");
  assert.equal(ultimaMarca(lineaDeMarca({ decision: "a_favor", monto: 1, quien: "x", cuando })), "a_favor");
  assert.equal(ultimaMarca("[CANCELADA: otra cosa]"), null);
  assert.equal(ultimaMarca(null), null);
});

test("a favor no se puede con la factura timbrada ni con efectivo del turno abierto", () => {
  assert.equal(motivoParaNoDejarAFavor({ timbrada: false, cfdiPorPago: false, efectivoEnTurnoAbierto: 0 }), null);
  assert.match(motivoParaNoDejarAFavor({ timbrada: true, cfdiPorPago: false, efectivoEnTurnoAbierto: 0 }) ?? "", /timbrada/);
  assert.match(motivoParaNoDejarAFavor({ timbrada: false, cfdiPorPago: true, efectivoEnTurnoAbierto: 0 }) ?? "", /timbrada/);
  assert.match(motivoParaNoDejarAFavor({ timbrada: false, cfdiPorPago: false, efectivoEnTurnoAbierto: 100 }) ?? "", /corte no cuadraría/);
});

test("servidor: una transacción con los candados, sin borrar, y lo pagado entero a favor", () => {
  const src = leer("src/lib/anticipos/cita-cancelada.server.ts");
  assert.match(src, /SELECT id FROM invoices WHERE id = \$\{invoiceId\} AND "clinicId" = \$\{clinicId\} FOR UPDATE/);
  assert.match(src, /pg_advisory_xact_lock\(hashtext\(\$\{claveCandadoSaldo\(clinicId, inv\.patientId\)\}\)\)/);
  assert.match(src, /const resto = round2\(monto - devueltoAplicado\);/, "las dos filas suman lo pagado");
  assert.match(src, /source: FUENTE_DEVUELTO,[\s\S]{0,80}reversesId: ant\.aplicacionId/);
  assert.match(src, /source: FUENTE_CITA_CANCELADA/);
  assert.match(src, /method: "refund"/);
  assert.match(src, /status: "CANCELLED", paid: 0, balance: round2\(inv\.total\), paidAt: null, notes: notas/);
  assert.match(src, /if \(cita && cita\.status !== "CANCELLED"\)/, "solo con la cita ya cancelada");
  assert.match(src, /if \(decision === "pendiente" && previa && previa !== "pendiente"\)/, "pendiente no pisa una decisión");
  assert.match(src, /const bloqueo = await motivoNoAFavorDe\(tx, clinicId, inv\);/);
  assert.match(src, /method: "cash", paidAt: \{ gte: turno\.openedAt \}/);
  assert.doesNotMatch(src, /\.delete\(|deleteMany/);
});

test("la cancelación desde la agenda decide con el permiso de la SESIÓN y cae a pendiente", () => {
  const ruta = leer("src/app/api/appointments/[id]/status/route.ts");
  assert.match(ruta, /const puedeCobrar = denyIfMissingPermission\(session\.user, "billing\.charge"\) === null;/);
  assert.match(ruta, /const pedida = decisionEfectiva\(body\.dineroCita, puedeCobrar\);/);
  assert.match(ruta, /if \(!r\.ok && pedida !== "pendiente"\) \{\s*r = await decidirDineroDeCitaCancelada\(\{ \.\.\.base, decision: "pendiente" \}\);/);
  const info = leer("src/app/api/appointments/[id]/dinero-cita/route.ts");
  assert.match(info, /denyIfMissingPermission\(session\.user, "agenda\.delete"\)/);
  assert.match(info, /puedeDecidir: denyIfMissingPermission\(session\.user, "billing\.charge"\) === null/);
  const despues = leer("src/app/api/invoices/[id]/dinero-cita/route.ts");
  assert.match(despues, /"billing\.refund" : "billing\.charge"/, "decidir pide cobro; «devuelto», reembolso");
});

test("todos los caminos que cancelan una cita marcan «pendiente» si hay dinero", () => {
  for (const r of [
    "src/app/api/appointments/[id]/route.ts",
    "src/app/api/whatsapp/webhook/route.ts",
    "src/app/api/public/appointment-confirm/route.ts",
    "src/app/api/appointment-change-requests/[id]/resolve/route.ts",
    "src/app/api/paciente/appointments/[id]/change-request/route.ts",
  ]) {
    assert.match(leer(r), /await marcarPendienteSiHayDinero\(\{/, r);
  }
});

test("la agenda pregunta antes de cancelar y la factura deja decidir después", () => {
  const panel = leer("src/components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(panel, /fetch\(`\/api\/appointments\/\$\{dto\.id\}\/dinero-cita`\)/);
  assert.match(panel, /await cancelarConDinero\.preguntar\(dinero\)/);
  assert.match(panel, /body: JSON\.stringify\(\{ status, reason, dineroCita \}\)/);
  const dialogo = leer("src/components/dashboard/agenda-nueva/cancelar-con-dinero.tsx");
  assert.match(dialogo, /Dejarlo como saldo a favor/);
  assert.match(dialogo, /DaleControl no mueve dinero/);
  assert.match(dialogo, /pendiente de decidir/);
  assert.match(leer("src/components/dashboard/billing/invoice-detail-modal.tsx"), /<AvisoDineroCitaCancelada\s/);
});

test("con la marca de cita cancelada, la factura no ofrece cobrar más", () => {
  const modal = leer("src/components/dashboard/billing/invoice-detail-modal.tsx");
  assert.match(modal, /const citaCanceladaConDinero = invoice\?\.status !== "CANCELLED" && \(marcaCita === "pendiente" \|\| marcaCita === "reembolso"\);/);
  assert.match(modal, /const cobrable = rediseno && puedeCobrar && !citaCanceladaConDinero &&/);
  assert.match(modal, /const botonRegistrarPago = !puedeCobrar \|\| citaCanceladaConDinero \|\|/);
  assert.equal((modal.match(/puedeCobrar && !citaCanceladaConDinero/g) ?? []).length, 4, "cobrable, los dos «Registrar pago» y «Marcar pagada»");
});

test("«Ya lo devolví» registra el reembolso y cancela la factura en UNA operación del servidor", () => {
  const aviso = leer("src/components/dashboard/billing/aviso-dinero-cita-cancelada.tsx");
  assert.match(aviso, /body: JSON\.stringify\(\{ decision: "devuelto" \}\)/);
  assert.doesNotMatch(aviso, /\/refund`|\/cancel`/, "ya no son dos llamadas");
  assert.match(aviso, /No se registró nada: la factura sigue igual\./, "el fallo dice qué pasó");
  assert.match(aviso, /Sí, registrar reembolso/, "pide confirmación");

  const src = leer("src/lib/anticipos/cita-cancelada.server.ts");
  const fn = src.slice(src.indexOf("export async function registrarDevolucionYCancelar"), src.indexOf("export async function marcarPendienteEnTx"));
  assert.match(fn, /prisma\.\$transaction\(async \(tx\) => \{\s*await tx\.\$queryRaw`SELECT id FROM invoices WHERE id = \$\{invoiceId\} AND "clinicId" = \$\{clinicId\} FOR UPDATE`/);
  assert.match(fn, /tx\.payment\.create\(\{[\s\S]{0,120}method: "refund"/);
  assert.match(fn, /status: "CANCELLED", paid: 0, balance: round2\(inv\.total\), paidAt: null/);
  assert.match(fn, /if \(ultimaMarca\(inv\.notes\) !== "reembolso"\)/, "solo sobre una marcada por reembolsar");
  assert.match(fn, /Cancela primero el CFDI ante el SAT/, "timbrada: no toca nada y dice qué hacer");

  const ruta = leer("src/app/api/invoices/[id]/dinero-cita/route.ts");
  assert.match(ruta, /denyIfMissingPermission\(ctx, decision === "devuelto" \? "billing\.refund" : "billing\.charge"\)/);
});

test("archivar un paciente marca «pendiente» sus facturas con dinero en la MISMA transacción", () => {
  const ruta = leer("src/app/api/patients/[id]/route.ts");
  const fn = ruta.slice(ruta.indexOf("async function cancelFutureAppointmentsForPatient"), ruta.indexOf("export async function DELETE"));
  assert.match(fn, /const marcadas = await prisma\.\$transaction\(async \(tx\) => \{\s*await tx\.appointment\.updateMany\(/);
  assert.match(fn, /tx\.invoice\.findMany\(\{\s*where: \{ clinicId, appointmentId: \{ in: ids \}, status: \{ not: "CANCELLED" \}, paid: \{ gt: 0 \} \}/);
  assert.match(fn, /await marcarPendienteEnTx\(tx, \{ clinicId, invoiceId: f\.id/);
  assert.equal((ruta.match(/await quienDeLaSesion\(ctx\.userId, ctx\.clinicId\)/g) ?? []).length, 2, "PATCH y DELETE");
  const src = leer("src/lib/anticipos/cita-cancelada.server.ts");
  const m = src.slice(src.indexOf("export async function marcarPendienteEnTx"), src.indexOf("export async function marcarPendienteSiHayDinero"));
  assert.match(m, /FOR UPDATE/);
  assert.match(m, /if \(ultimaMarca\(inv\.notes\)\) return null;/, "no pisa una marca");
});

test("el SQL de facturas históricas solo añade la marca que el panel sabe leer", () => {
  const sql = leer("sql/anticipos-cita-cancelada-pendientes.sql")
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.match(sql, /SET "notes" = COALESCE\(i\."notes" \|\| E'\\n', ''\)/);
  assert.doesNotMatch(sql, /\bDELETE\b|\bDROP\b|\bDO\s+\$\$/i);
  assert.doesNotMatch(sql, /SET "(paid|status|balance|total|appointmentId)"/, "solo toca las notas");
  assert.match(sql, /NOT LIKE '%\[CITA CANCELADA CON DINERO PAGADO ·%'/, "idempotente");
  // Lo que escribe el SQL, leído por el panel.
  const escrita = "[CITA CANCELADA CON DINERO PAGADO · PENDIENTE DE DECIDIR · $800.00 · revisión de facturas (SQL) · 2026-09-29 05:00 UTC]";
  assert.equal(ultimaMarca(`nota vieja\n${escrita}`), "pendiente");
});
