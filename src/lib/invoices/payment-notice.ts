// Texto del aviso de saldo por WhatsApp (POST /api/invoices/[id]/send-whatsapp).
//
// Vive aquí y no dentro del handler porque lo necesitan DOS sitios: el handler,
// que lo manda, y Sabina, que tiene que enseñar en la tarjeta el texto EXACTO
// que va a recibir el paciente antes de que alguien confirme. Con el texto
// copiado en Sabina, el día que alguien retoque la redacción del handler la
// tarjeta seguiría prometiendo el mensaje viejo.
//
// PURO: sin Prisma ni red.

function fmtMXN(n: number): string {
  const v = new Intl.NumberFormat("es-MX", {
    style: "currency", currency: "MXN", minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
  return `${v} MXN`;
}

/** "Limpieza, Resina y 2 más" — resumen corto de los conceptos para el texto. */
function summarizeItems(raw: unknown): string {
  const items = Array.isArray(raw) ? (raw as any[]) : [];
  const names = items
    .map((it) => String(it?.description ?? it?.name ?? "").trim())
    .filter((s) => s.length > 0);
  if (names.length === 0) return "";
  const shown = names.slice(0, 3);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} y ${rest} más` : shown.join(", ");
}

export interface PaymentNoticeInput {
  patient: { firstName?: string | null; lastName?: string | null } | null | undefined;
  clinicName: string;
  /** Teléfono de la clínica, ya recortado. Es {{4}} de dc_aviso_saldo. */
  clinicPhone: string;
  invoiceNumber: string;
  /** La columna `balance` de la factura: es lo que el aviso siempre ha dicho. */
  balance: number;
  items: unknown;
}

export interface PaymentNotice {
  patientName: string;
  /** "$1,200.00 MXN" */
  amount: string;
  /** Texto libre: lo que sale con la ventana de 24 h abierta. */
  body: string;
  /** {{1}}…{{4}} de la plantilla `payment_notice`, en el orden del spec. */
  templateParams: string[];
}

export function buildPaymentNotice(input: PaymentNoticeInput): PaymentNotice {
  const patientName =
    `${input.patient?.firstName ?? ""} ${input.patient?.lastName ?? ""}`.trim() || "Paciente";
  const amount = fmtMXN(input.balance);
  const conceptos = summarizeItems(input.items);
  const body =
    `Hola ${patientName}, te saludamos de ${input.clinicName}. ` +
    `Tienes un saldo pendiente de ${amount} de tu nota ${input.invoiceNumber}` +
    `${conceptos ? ` (${conceptos})` : ""}. ` +
    `Puedes pagar en la clínica o llamarnos al ${input.clinicPhone} para coordinarlo. ¡Gracias!`;
  // Orden del spec dc_aviso_saldo: paciente, clínica, monto, teléfono.
  return { patientName, amount, body, templateParams: [patientName, input.clinicName, amount, input.clinicPhone] };
}
