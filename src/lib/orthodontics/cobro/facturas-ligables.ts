// Ortodoncia — ws1-t4 #75: un presupuesto aceptado (o una factura del
// tratamiento hecha a mano en Facturación) no abre el caso, y «Abrir plan de
// pago» solo sabía crear OTRA factura: quedaban dos del mismo tratamiento y la
// cartera salía duplicada. Esta regla, pura y con test, decide qué facturas del
// paciente se pueden LIGAR al caso en vez de crear una nueva.

/** Estados de una factura que puede ser «el plan de pago» del caso. Borrador y cancelada, no. */
export const ESTADOS_LIGABLES = ["PENDING", "PARTIAL", "PAID", "OVERDUE"] as const;

export interface FacturaParaLigar {
  status: string;
  /** Cita a la que está ligada (una factura de cita no es el plan de tratamiento). */
  appointmentId: string | null;
  /** Caso de ortodoncia al que YA está ligada como plan (si alguno). */
  ligadaACaso: string | null;
}

export function esFacturaLigable(f: FacturaParaLigar): boolean {
  if (!(ESTADOS_LIGABLES as readonly string[]).includes(f.status)) return false;
  if (f.appointmentId) return false;
  if (f.ligadaACaso) return false;
  return true;
}

/** El primer concepto de la factura, para que quien elige reconozca cuál es. */
export function conceptoDeFactura(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) return "Sin conceptos";
  const nombres = items
    .map((i) => (i && typeof i === "object" ? String((i as { name?: unknown; description?: unknown }).name ?? (i as { description?: unknown }).description ?? "") : ""))
    .filter((n) => n.trim() !== "");
  if (nombres.length === 0) return "Sin conceptos";
  return nombres.length > 1 ? `${nombres[0]} (+${nombres.length - 1})` : nombres[0];
}
