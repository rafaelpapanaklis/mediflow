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
