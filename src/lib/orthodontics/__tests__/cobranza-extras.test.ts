// ws1-t4 #80 / #72 — Cobranza cuenta los extras que se deben y dice quién es el
// responsable de pago. Antes un caso con un extra de $350 sin pagar salía «Al corriente».
//
// Correr: npm run test:orto-cobranza-extras
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrthoCaseSummary } from "../specialty-kpis";
import { filasDeCobranza, resumenDeCobranza } from "../cobranza-modulo";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

function caso(extra: Partial<OrthoCaseSummary> = {}): OrthoCaseSummary {
  return {
    planId: "p1", patientId: "pa1", patientName: "Niño Ruiz", treatingDoctorId: null, treatingDoctorName: null,
    status: "IN_PROGRESS", installedAt: null, estimatedDurationMonths: 18, droppedOutAt: null, statusUpdatedAt: new Date("2026-09-01"),
    cobranza: null, ...extra,
  };
}

test("un caso activo sin plan pero con extras pendientes los trae en la fila", () => {
  const [f] = filasDeCobranza([caso({ extrasPendientes: { monto: 350, cantidad: 1 }, responsableNombre: "María Ruiz" })], "2026-09-28");
  assert.equal(f.extrasPendientes, 350);
  assert.equal(f.extrasCantidad, 1);
  assert.equal(f.responsableNombre, "María Ruiz");
});

test("un caso CERRADO sin plan pero que debe extras sigue en la lista (la deuda no se borra al cerrar)", () => {
  const filas = filasDeCobranza([caso({ status: "COMPLETED", extrasPendientes: { monto: 350, cantidad: 1 } })], "2026-09-28");
  assert.equal(filas.length, 1);
  const sinDeuda = filasDeCobranza([caso({ status: "COMPLETED" })], "2026-09-28");
  assert.equal(sinDeuda.length, 0);
});

test("el resumen suma los extras de todos los casos en centavos", () => {
  const filas = filasDeCobranza([
    caso({ planId: "a", extrasPendientes: { monto: 350.1, cantidad: 1 } }),
    caso({ planId: "b", extrasPendientes: { monto: 0.2, cantidad: 1 } }),
  ], "2026-09-28");
  assert.equal(resumenDeCobranza(filas).extras, 350.3);
});

test("sin extras ni responsable las filas salen como siempre", () => {
  const [f] = filasDeCobranza([caso()], "2026-09-28");
  assert.equal(f.extrasPendientes, 0);
  assert.equal(f.responsableNombre, null);
});

test("la pantalla lo pinta y el cargador pide los extras UNA vez para todos los casos, con la clínica de la sesión", () => {
  const vista = leer("components/specialties/orthodontics/modulo/vista-cobranza.tsx");
  assert.match(vista, /data-extras/);
  assert.match(vista, /Responsable: \{f\.responsableNombre\}/);
  const tablero = leer("lib/orthodontics/tablero-data.ts");
  assert.match(tablero, /extrasPendientesPorCasos\(clinicId, plans\.map/);
  const db = leer("lib/orthodontics/cobro/extras-db.ts");
  assert.match(db, /if \(!clinicId \|\| treatmentPlanIds\.length === 0\) return out;/);
  assert.match(db, /WHERE "clinicId" = \$\{clinicId\}/);
});

// ws1-t4 #70 / #71 — el panel de la cita de un control de ortodoncia.
test("panel de la cita: sin «Pedir anticipo» en un control, y el «Cobrar» sin factura manda al recuadro de Ortodoncia", () => {
  const src = leer("components/dashboard/agenda-nueva/panel-cita.tsx");
  assert.match(src, /!ocultarAnticipoPorMensualidad\(esCitaOrtoConHoja\(dto\.reason \?\? null\), modoCobroOrto\)/);
  assert.match(src, /cóbralo desde el recuadro de Ortodoncia/);
});

// ws1-t4 #84 — Hoy y Caja cuentan las mismas «vencidas»: cuotas.
test("Hoy y Caja cuentan cuotas vencidas, no casos", () => {
  const hoy = leer("app/actions/orthodontics/hoy/resumenDeHoy.ts");
  assert.match(hoy, /count: items\.reduce\(\(s, it\) => s \+ Math\.max\(1, it\.cantidadVencidas\), 0\)/);
  const caja = leer("components/specialties/orthodontics/cobranza/ListaMensualidades.tsx");
  assert.match(caja, /reduce\(\(n, it\) => n \+ Math\.max\(1, it\.cantidadVencidas\), 0\)/);
});

// ws1-t4 #83 — «Enviar indicaciones» ya no se bloquea por OTRO mensaje suelto del panel.
test("el candado de indicaciones busca el texto de ESE control, no cualquier «manual_api»", () => {
  const dedupe = leer("lib/orthodontics/whatsapp-dedupe.ts");
  assert.match(dedupe, /\.\.\.\(bodyContains \? \{ body: \{ contains: bodyContains \} \} : \{\}\)/);
  const envio = leer("app/actions/orthodontics/whatsapp/sendControlInstructions.ts");
  assert.match(envio, /lastSentOfKind\(ctx\.clinicId, patient\.phone, "manual_api", ahora, 24, card\.indications\)/);
  // el recordatorio de mensualidad y las demás llamadas siguen igual (sin el filtro)
  const mens = leer("app/actions/orthodontics/whatsapp/sendMensualidadReminder.ts");
  assert.match(mens, /lastSentOfKind\(ctx\.clinicId, telefonoDestino, "payment_notice", ahora\)/);
});

// ws1-t4 #82 — un aviso de cobro por teléfono al día también desde la factura.
test("«Enviar por WhatsApp» de la factura no manda un segundo aviso de cobro el mismo día sin confirmar", () => {
  const ruta = leer("app/api/invoices/[id]/send-whatsapp/route.ts");
  assert.match(ruta, /if \(pedido\?\.forzar !== true\)/);
  assert.match(ruta, /lastSentOfKind\(ctx\.clinicId, tel, "payment_notice", new Date\(\)\)/);
  assert.match(ruta, /code: "AVISO_YA_ENVIADO"/);
  // el candado va ANTES de crear el link de pago (que escribe)
  assert.ok(ruta.indexOf("AVISO_YA_ENVIADO") < ruta.indexOf("linkParaEnviar({"));
  const modal = leer("components/dashboard/billing/invoice-detail-modal.tsx");
  assert.match(modal, /data\.code === "AVISO_YA_ENVIADO"/);
  assert.match(modal, /handleSendWhatsApp\(true\)/);
});

// Correcciones de la revisión (revisor, ws1-t10).
test("las facturas canceladas no cuentan como deuda en Tablero/Cobranza/Alertas ni como cargos de control; los controles no cuentan como extras", () => {
  const t = leer("lib/orthodontics/tablero-data.ts");
  assert.match(t, /invoice != null && invoice\.status !== "CANCELLED"/);
  const c = leer("lib/orthodontics/cobranza-controles-db.ts");
  assert.ok((c.match(/i\."status" NOT IN \(.DRAFT., .CANCELLED.\)/g) ?? []).length >= 2);
  assert.match(leer("lib/orthodontics/cobro/extras-db.ts"), /AND "appointmentId" IS NULL/);
});

test("ligar una factura elegida nunca cancela otra por «duplicada», y no acepta extras/controles ni facturas de cita", () => {
  const a = leer("app/actions/orthodontics/cobro/abrirPlanDePago.ts");
  assert.equal((a.match(/if \(soloLigar\) return fail\(/g) ?? []).length, 2);
  assert.match(a, /Esa factura es de una cita/);
  assert.match(a, /idsDeFacturasLigadasAUnCaso\(ctx\.clinicId, \[invoice\.id\]\)/);
  assert.match(leer("components/specialties/orthodontics/redesign/drawers/DrawerLigarFactura.tsx"), /origen: "ligar"/);
  assert.match(leer("app/actions/orthodontics/cobro/listarFacturasLigables.ts"), /idsDeFacturasLigadasAUnCaso\(ctx\.clinicId/);
});

test("pasar controles al doctor nuevo: ventana acotada, bloqueos de agenda y choque tardío sin dejar la tanda a medias", () => {
  const m = leer("app/actions/orthodontics/moverControlesFuturosAlDoctor.ts");
  assert.match(m, /startsAt: \{ lt: hasta \}/);
  assert.match(m, /prisma\.agendaBlock\.findMany/);
  assert.match(m, /if \(!isOverlapError\(e\)\) throw e;/);
});

test("el tope de un aviso mira también el teléfono del responsable; la ficha rediseñada puede confirmar", () => {
  const r = leer("app/api/invoices/[id]/send-whatsapp/route.ts");
  assert.match(r, /telefonoDelResponsableDeLaFactura\(ctx\.clinicId, invoice\.id\)/);
  assert.match(r, /en las últimas 24 h/);
  assert.match(leer("components/dashboard/factura-ficha-rediseno/extras.ts"), /forzar/);
  assert.match(leer("components/dashboard/factura-ficha-rediseno/fichas-factura.tsx"), /r\.codigo === "AVISO_YA_ENVIADO"/);
});

test("el CFDI encuentra al responsable también desde la factura de un control/extra, y la precarga async no pisa otra factura", () => {
  assert.match(leer("lib/orthodontics/responsable-fiscal-db.ts"), /casoDeLaFacturaLigada\(clinicId, invoiceId\)/);
  assert.match(leer("app/dashboard/billing/billing-client.tsx"), /cfdiAbiertoParaRef\.current !== inv\.id/);
});
