/**
 * CUERPOS A MANO para las rutas del núcleo clínico y de dinero — ws1-t10.
 *
 * La petición universal del arnés (cada campo `…Id` apunta a una fila de la
 * clínica pedida) sirve para casi todas, pero una ruta que valida su cuerpo ANTES
 * de consultar (400 «falta el motivo») nunca llega a la parte que comprueba el
 * tenant, y el «bloqueada» de B no probaría nada. Aquí se completan, por ruta,
 * los campos de negocio que faltan para que el handler llegue hasta sus
 * consultas. Los ids siguen siendo los de la clínica pedida (A o B).
 *
 * No hace falta que la operación TERMINE bien: basta con que pase la validación
 * de forma y toque la base, que es donde se decide a qué clínica pertenece cada
 * fila. El control con ids de A mide cuántas llegan.
 *
 * Clave: «MÉTODO /api/ruta/[id]». `quitar` borra llaves del cuerpo universal que
 * estorban (p. ej. `status: "ACTIVE"`, que es de pacientes y no de facturas).
 */
export interface Ajuste {
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  quitar?: string[];
}
type Ctx = { id: string; doc: string };

const concepto = { description: "Limpieza dental", quantity: 1, unitPrice: 100, total: 100 };
const linea = { name: "Limpieza dental", description: "Limpieza dental", unitPrice: 100, quantity: 1 };
const receptor = { rfc: "XAXX010101000", razonSocial: "Publico en General", nombre: "Publico en General", regimenFiscal: "616", regimen: "616", codigoPostal: "06000", cp: "06000", usoCfdi: "S01" };

export const AJUSTES: Record<string, (c: Ctx) => Ajuste> = {
  // ── agenda ────────────────────────────────────────────────────────────
  "POST /api/appointments": () => ({ body: { reason: "Limpieza", isTeleconsult: false }, quitar: ["status"] }),
  "PATCH /api/appointments/[id]": () => ({ body: { notes: "nota" }, quitar: ["status"] }),
  "PATCH /api/appointments/[id]/status": () => ({ body: { status: "CONFIRMED" } }),
  "PATCH /api/appointments/[id]/complete": () => ({ body: {} }),
  "POST /api/appointments/[id]/anticipo": () => ({ body: { monto: 500 } }),
  // ── facturas y dinero ─────────────────────────────────────────────────
  "POST /api/invoices": () => ({ body: { items: [concepto], discount: 0, taxIncluded: true }, quitar: ["status"] }),
  "POST /api/invoices/from-appointment": () => ({ body: { lineItems: [linea], discount: 0 } }),
  "POST /api/invoices/[id]": () => ({ body: { amount: 50, method: "cash" }, quitar: ["status"] }),
  "PATCH /api/invoices/[id]": () => ({ body: { notes: "nota" }, quitar: ["status", "items"] }),
  "POST /api/invoices/[id]/anticipo": () => ({ body: { monto: 500 } }),
  "POST /api/invoices/[id]/anticipo/registrar": () => ({ body: { monto: 500, metodo: "efectivo" } }),
  "POST /api/invoices/[id]/anticipo/anular": () => ({ body: { motivo: "Motivo de prueba" } }),
  "POST /api/invoices/[id]/refund": () => ({ body: { amount: 10, reason: "Prueba" } }),
  "POST /api/invoices/[id]/edit-price": () => ({ body: { total: 90 } }),
  "POST /api/invoices/[id]/dinero-cita": () => ({ body: { decision: "a_favor" } }),
  "POST /api/invoices/[id]/saldo-orto": () => ({ body: { accion: "aplicar" } }),
  "POST /api/payment-plans": () => ({ body: { totalAmount: 1000, installments: 2, frequency: "MONTHLY", startDate: "2026-07-01", items: [concepto] } }),
  "POST /api/cfdi": () => ({ body: { ...receptor, receptor, paymentForm: "01", paymentMethod: "PUE" } }),
  "POST /api/payments/[id]/cfdi": () => ({ body: { ...receptor, receptor } }),
  // ── paciente y expediente ─────────────────────────────────────────────
  "POST /api/patients": () => ({ body: { firstName: "Ana", lastName: "Prueba", phone: "5555555555" }, quitar: ["status"] }),
  "PUT /api/patients/[id]": () => ({ body: { firstName: "Ana", lastName: "Prueba", phone: "5555555555" }, quitar: ["status"] }),
  "PATCH /api/patients/[id]": () => ({ body: { firstName: "Ana" }, quitar: ["status"] }),
  "POST /api/treatments": () => ({ body: { name: "Endodoncia", nombre: "Endodoncia" } }),
  "POST /api/periodontal": () => ({ body: { measurements: [{ tooth: 11, site: "MB", depth: 3 }], notes: "nota", bleedingIndex: 10, plaquIndex: 10 } }),
  "POST /api/medical-records/[id]/diagnoses": () => ({ body: { cie10Code: "K02.1", description: "Caries" } }),
  "PATCH /api/clinical-notes/[id]": () => ({ body: { status: "DRAFT", subjective: "s" } }),
  "POST /api/clinical-notes/[id]/addendum": () => ({ body: { content: "Adenda de prueba", text: "Adenda de prueba", reason: "prueba" } }),
  "POST /api/prescriptions": () => ({ body: { items: [{ cumsKey: "CUMS-PRUEBA", dosage: "1 cada 8 horas" }], indications: "Reposo" } }),
  "POST /api/prescriptions/[id]/send": () => ({ body: { via: "email" } }),
  // ── presupuestos ──────────────────────────────────────────────────────
  "POST /api/quotes/from-appointment": () => ({ body: { lineItems: [linea], title: "Presupuesto" } }),
  "POST /api/quotes/[id]/status": () => ({ body: { action: "present" } }),
  // ── imagen ────────────────────────────────────────────────────────────
  "POST /api/xrays/[id]/annotations": () => ({ body: { annotations: [] } }),
  "PUT /api/xrays/[id]/annotations": () => ({ body: { annotations: [] } }),
  "PATCH /api/xrays/[id]": () => ({ body: { notes: "nota", title: "Panorámica" } }),
  // ── consentimientos ───────────────────────────────────────────────────
  "POST /api/consent/[id]/revoke": () => ({ body: { reason: "Motivo de prueba", motivo: "Motivo de prueba" } }),
};

/** Aplica el ajuste de una ruta sobre el cuerpo/consulta universales. */
export function aplicarAjuste<T extends Record<string, unknown>>(base: T, ajuste: Ajuste | undefined, parte: "body" | "query"): Record<string, unknown> {
  if (!ajuste) return base;
  const salida: Record<string, unknown> = { ...base };
  for (const k of ajuste.quitar ?? []) delete salida[k];
  Object.assign(salida, ajuste[parte] ?? {});
  return salida;
}
