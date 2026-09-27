// El texto del anticipo pedido desde el panel (ws1-t3 fase 1): paciente,
// monto, fecha y hora de la cita (si la hay), plazo y link. Es EL MISMO texto
// para «Enviar por WhatsApp» (dentro de la ventana de 24 h) y para «Copiar
// texto» — nunca hay dos redacciones que puedan decir cosas distintas.
//
// PURO: sin Prisma, sin fetch, sin React.

import { formatoPesos } from "./core";

export interface DatosAnticipoPanel {
  paciente: string;
  clinica: string;
  monto: number;
  horas: number;
  url: string;
  /** null = el anticipo no está ligado a una cita (factura suelta). */
  fechaHumana?: string | null;
  hora?: string | null;
}

export function textoAnticipoPanel(d: DatosAnticipoPanel): string {
  const cuando = d.fechaHumana && d.hora ? ` de tu cita del ${d.fechaHumana} a las ${d.hora}` : "";
  return [
    `Hola ${d.paciente}, te compartimos el link para pagar el anticipo${cuando} en ${d.clinica}.`,
    `Monto: ${formatoPesos(d.monto)}`,
    `Tienes ${d.horas} h para pagarlo.`,
    d.url,
  ].join("\n");
}

// ── Transferencia (ws1-t3 fase 2) ───────────────────────────────────────
//
// MISMA estructura que textoAnticipoPanel (paciente, cita, monto, plazo) pero
// SIN link: en su lugar, los datos bancarios de la sede y la guía de
// referencia. Es el texto que se copia y el que acompaña al PDF «Solicitud de
// anticipo» por WhatsApp.

export interface DatosAnticipoTransferencia {
  paciente: string;
  clinica: string;
  monto: number;
  horas: number;
  banco: string;
  beneficiario: string;
  /** YA agrupada de 3 en 3 (clabeAgrupada de spei-directo-core), para copiar/dictar. */
  clabeAgrupada: string;
  /** Guía del concepto ("Escribe el nombre del paciente"). null = sin guía. */
  referencia: string | null;
  fechaHumana?: string | null;
  hora?: string | null;
}

export function textoAnticipoTransferencia(d: DatosAnticipoTransferencia): string {
  const cuando = d.fechaHumana && d.hora ? ` de tu cita del ${d.fechaHumana} a las ${d.hora}` : "";
  return [
    `Hola ${d.paciente}, para apartar${cuando} en ${d.clinica} te pedimos un anticipo de ${formatoPesos(d.monto)} por transferencia.`,
    `Banco: ${d.banco}`,
    `Beneficiario: ${d.beneficiario}`,
    `CLABE: ${d.clabeAgrupada}`,
    ...(d.referencia ? [`Concepto: ${d.referencia}`] : []),
    `Tienes ${d.horas} h para transferir. En cuanto lo veamos, te confirmamos por aquí.`,
  ].join("\n");
}

// ── «Enviar recibo» (ws1-t3 fase 3) ─────────────────────────────────────
//
// Confirma que YA se recibió el pago (cualquiera, no solo anticipo): al
// paciente que pagó en efectivo, transferencia o terminal en el mostrador, o
// cuyo anticipo se acreditó. Nunca automático — solo al pulsar el botón.

export function textoRecibo(d: { paciente: string; clinica: string; monto: number; folio: string }): string {
  return (
    `Hola ${d.paciente}, en ${d.clinica} recibimos tu pago de ${formatoPesos(d.monto)} ` +
    `(factura ${d.folio}). Te adjuntamos el comprobante. ¡Gracias!`
  );
}
