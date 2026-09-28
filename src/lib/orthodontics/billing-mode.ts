// ═══════════════════════════════════════════════════════════════════════════
// MODO DE COBRO de ortodoncia (ws1-t1, Ola 2) — decisión de Rafael: «hay
// procedimientos de ortodoncia con costo algunos y otros no... deja que la
// clínica decida una de las 2 opciones».
//
//   PRECIO_TOTAL     — lo que ya existe: factura del caso a plazos (enganche
//                       + mensualidades). Default, y el único modo hasta hoy.
//   PAGO_POR_CONTROL — sin precio total: cada control genera su propio cobro
//                       (precio del catálogo), más la colocación/enganche
//                       como factura aparte.
//
// El modo de la CLÍNICA (`OrthodonticsClinicSettings.billingMode`,
// clinic-settings-db.ts) es el default para casos NUEVOS. El caso guarda su
// propio `billingMode` al nacer (`OrthodonticTreatmentPlan.billingMode`) y
// lo conserva para siempre — cambiar el de la clínica NUNCA reescribe un
// caso ya abierto. Puro, sin I/O: solo el tipo y su normalizador.
// ═══════════════════════════════════════════════════════════════════════════

export type OrthoBillingMode = "PRECIO_TOTAL" | "PAGO_POR_CONTROL";

export const ORTHO_BILLING_MODE_DEFAULT: OrthoBillingMode = "PRECIO_TOTAL";

/** Cualquier valor que no sea exactamente "PAGO_POR_CONTROL" es PRECIO_TOTAL — incluida la ausencia de columna (P2021/P2022) o de fila. */
export function normalizarOrthoBillingMode(v: unknown): OrthoBillingMode {
  return v === "PAGO_POR_CONTROL" ? "PAGO_POR_CONTROL" : ORTHO_BILLING_MODE_DEFAULT;
}

export const ORTHO_BILLING_MODE_LABELS: Record<OrthoBillingMode, string> = {
  PRECIO_TOTAL: "Precio total a plazos",
  PAGO_POR_CONTROL: "Pago por control",
};
