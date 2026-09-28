// Ortodoncia — Paciente y WhatsApp (ws1-t2, W2): el texto del recordatorio de
// mensualidad. Mismo espíritu que src/lib/anticipos/mensaje-panel.ts: UN solo
// texto para «Enviar por WhatsApp» (dentro de la ventana de 24 h) y para
// «Copiar texto» — nunca dos redacciones que puedan decir cosas distintas.
//
// A propósito NO usa ORTHO_WHATSAPP_TEMPLATES (whatsapp-templates.ts): esas
// plantillas leen OrthoInstallment (el modelo viejo que se oculta, decisión 1
// de la arquitectura — S13, ORTHO_WHATSAPP_ENQUEUE_ENABLED = false). Este
// mensaje sale de `cobranzaDelCaso` (la factura del tratamiento) y se manda
// como texto libre dentro de la ventana de 24 h, igual que el anticipo — sin
// plantilla aprobada por Meta todavía: "Plantillas de WhatsApp OPCIONALES,
// apagadas por defecto (las cobra Meta a la clínica), igual que las de
// anticipos" (decisión de Rafael para este bloque).
//
// PURO: sin Prisma, sin fetch, sin React.

import { formatoPesos } from "@/lib/anticipos/core";

export interface DatosMensualidad {
  paciente: string;
  clinica: string;
  /** "YYYY-MM-DD" — se formatea con fechaHumana (whatsapp/bot/booking-parse). */
  fechaHumana: string;
  montoMxn: number;
}

/** "Tu mensualidad de $1,000 vence el 5 de marzo." — antes de vencer. */
export function textoMensualidadPorVencer(d: DatosMensualidad): string {
  return [
    `Hola ${d.paciente}, te recordamos tu mensualidad de ${formatoPesos(d.montoMxn)} de tu tratamiento en ${d.clinica}.`,
    `Vence el ${d.fechaHumana}.`,
    `Puedes ver el detalle y pagar en línea desde tu portal de paciente.`,
  ].join("\n");
}

/** "Tienes una mensualidad vencida de $1,000." — ya venció, sin pagar. */
export function textoMensualidadVencida(d: DatosMensualidad): string {
  return [
    `Hola ${d.paciente}, tu mensualidad de ${formatoPesos(d.montoMxn)} de tu tratamiento en ${d.clinica} venció el ${d.fechaHumana}.`,
    `Puedes ver el detalle y pagar en línea desde tu portal de paciente, o escribirnos para coordinar tu pago.`,
  ].join("\n");
}
