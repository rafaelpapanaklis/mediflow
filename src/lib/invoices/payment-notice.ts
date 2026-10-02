// Texto del aviso de saldo por WhatsApp (POST /api/invoices/[id]/send-whatsapp).
//
// Vive aquí y no dentro del handler porque lo necesitan DOS sitios: el handler,
// que lo manda, y Sabina, que tiene que enseñar en la tarjeta el texto EXACTO
// que va a recibir el paciente antes de que alguien confirme. Con el texto
// copiado en Sabina, el día que alguien retoque la redacción del handler la
// tarjeta seguiría prometiendo el mensaje viejo.
//
// PURO: sin Prisma ni red.
//
// ws1-t1: si la factura se cobra por Mercado Pago, el texto libre lleva además
// el link y el monto (`linkPago`). La PLANTILLA no cambia: sus cuatro huecos los
// aprobó Meta y no admiten un link, así que con la ventana cerrada el link no
// viaja (la ruta lo dice y la pantalla ofrece copiarlo).

import { lineaLinkWhatsApp } from "@/lib/factura-mp/core";
import type { EstadoDeCobro } from "@/lib/invoices/due-date";
import type { WhatsAppSendKind } from "@/lib/whatsapp/system-message";

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
  /**
   * Factura A PLAZOS: lo que toca pagar ESTE mes (lo vencido, o la cuota por la que va).
   * Solo cambia el TEXTO LIBRE («Tu pago de este mes es $X (saldo total $Y)»); la
   * plantilla aprobada por Meta no se toca y sigue diciendo el saldo total.
   */
  pagoDelMes?: number | null;
  /** Link de Mercado Pago de la factura (ws1-t1). Sin él, el texto de siempre. */
  linkPago?: { url: string; monto: number } | null;
  /**
   * ws1-t10: el aviso va al RESPONSABLE DE PAGO, no al paciente: `patient` es a quien se saluda
   * (el responsable) y aquí va el nombre del paciente, de quien es la nota. Solo cambia el TEXTO
   * LIBRE; la plantilla de Meta conserva sus cuatro huecos.
   */
  aNombreDe?: string | null;
  /**
   * ws1-t4 (8c) — ¿la nota está vencida o solo por pagar? Sale de `estadoDeCobro` /
   * `fechaDeVencimientoHumana` (lib/invoices/due-date: el mismo criterio que el filtro
   * «Vencidas»). Sin él, el texto de siempre («saldo pendiente»). Con plazos
   * (`pagoDelMes`) no se usa: la cuota ya dice lo de este mes.
   */
  cobro?: { estado: EstadoDeCobro; vence: string | null } | null;
}

export interface PaymentNotice {
  patientName: string;
  /** "$1,200.00 MXN" */
  amount: string;
  /** Texto libre: lo que sale con la ventana de 24 h abierta. */
  body: string;
  /** {{1}}…{{4}} de la plantilla `payment_notice`, en el orden del spec. */
  templateParams: string[];
  /**
   * ws1-t4 (8c) — la plantilla que dice lo mismo que el texto libre: `payment_due`
   * («pago por realizar») o `payment_overdue` («saldo vencido»). Mismos cuatro datos que
   * dc_aviso_saldo; mientras Meta no la apruebe, sendWhatsAppLogged usa dc_aviso_saldo.
   */
  plantillaPreferida: WhatsAppSendKind | null;
}

export function buildPaymentNotice(input: PaymentNoticeInput): PaymentNotice {
  const patientName =
    `${input.patient?.firstName ?? ""} ${input.patient?.lastName ?? ""}`.trim() || "Paciente";
  const amount = fmtMXN(input.balance);
  const conceptos = summarizeItems(input.items);
  const pagoDelMes = input.pagoDelMes != null && input.pagoDelMes > 0 && input.pagoDelMes < input.balance - 0.005 ? input.pagoDelMes : null;
  const cobro = pagoDelMes == null && input.cobro ? input.cobro : null;
  const queEs = cobro?.estado === "vencido" ? "un saldo vencido" : cobro?.estado === "por_pagar" ? "un pago por realizar" : "un saldo pendiente";
  const cifras = pagoDelMes != null
    ? `${input.aNombreDe ? "El pago de este mes es" : "Tu pago de este mes es"} de ${fmtMXN(pagoDelMes)} (saldo total ${amount})`
    : `${input.aNombreDe ? "Hay" : "Tienes"} ${queEs} de ${amount}`;
  const vence = cobro?.vence ? ` ${cobro.estado === "vencido" ? "Venció" : "Vence"} el ${cobro.vence}.` : "";
  const body =
    `Hola ${patientName}, te saludamos de ${input.clinicName}. ` +
    `${cifras} de ${input.aNombreDe ? `la nota ${input.invoiceNumber} de ${input.aNombreDe}` : `tu nota ${input.invoiceNumber}`}` +
    `${conceptos ? ` (${conceptos})` : ""}.${vence} ` +
    (input.linkPago
      // El link en su propia línea: pegado a un punto, WhatsApp lo corta mal.
      ? `\n\n${lineaLinkWhatsApp(input.linkPago.url, input.linkPago.monto)}\n\n` +
        `También puedes pagar en la clínica o llamarnos al ${input.clinicPhone}. ¡Gracias!`
      : `Puedes pagar en la clínica o llamarnos al ${input.clinicPhone} para coordinarlo. ¡Gracias!`);
  // Orden del spec dc_aviso_saldo: paciente, clínica, monto, teléfono.
  const plantillaPreferida: WhatsAppSendKind | null =
    cobro?.estado === "vencido" ? "payment_overdue" : cobro?.estado === "por_pagar" ? "payment_due" : null;
  return { patientName, amount, body, templateParams: [patientName, input.clinicName, amount, input.clinicPhone], plantillaPreferida };
}
