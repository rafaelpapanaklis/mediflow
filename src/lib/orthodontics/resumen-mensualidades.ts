// ═══════════════════════════════════════════════════════════════════════════
// La CABECERA de «Mensualidades por cobrar» de Caja (ws1-t2, auditoría de uso
// C-22 y C-23). Puro, sin I/O (src/lib/orthodontics/__tests__/resumen-mensualidades.test.ts).
//
// Decía «14 mensualidades por cobrar · 15 vencidas · Total $62,100»: más
// vencidas que por cobrar. Contaba FILAS arriba (una fila junta todas las
// cuotas vencidas de una factura) y CUOTAS en la pastilla. Y el total mezclaba
// lo vencido con lo que vence hoy y en la semana: $62,100 contra los $60,100
// de «Vencido» en Cobranza, Inicio y Finanzas, sin decirlo.
//
// Ahora todo se cuenta en CUOTAS y el dinero va separado: «Vencido» (el mismo
// de Cobranza de Ortodoncia) y el total con lo que vence en los próximos días.
// ═══════════════════════════════════════════════════════════════════════════

export interface FilaDeMensualidad {
  estado: "vencida" | "hoy" | "proxima";
  monto: number;
  /** Cuántas cuotas vencidas junta la fila (0 si no está vencida). */
  cantidadVencidas: number;
}

export interface ResumenDeMensualidades {
  /** Todas las cuotas de la lista: vencidas + las de hoy + las próximas. */
  cuotas: number;
  vencidas: number;
  hoy: number;
  proximas: number;
  /** Lo vencido, en pesos: la misma cifra que «Vencido» de Cobranza de Ortodoncia. */
  montoVencido: number;
  /** Todo lo de la lista (vencido + hoy + próximas), en pesos. */
  montoTotal: number;
}

const aCentavos = (n: number) => Math.round((Number(n) || 0) * 100);

export function resumenDeMensualidades(filas: FilaDeMensualidad[]): ResumenDeMensualidades {
  let vencidas = 0;
  let hoy = 0;
  let proximas = 0;
  let vencidoC = 0;
  let totalC = 0;
  for (const f of filas) {
    totalC += aCentavos(f.monto);
    if (f.estado === "vencida") {
      vencidas += Math.max(1, f.cantidadVencidas);
      vencidoC += aCentavos(f.monto);
    } else if (f.estado === "hoy") hoy += 1;
    else proximas += 1;
  }
  return { cuotas: vencidas + hoy + proximas, vencidas, hoy, proximas, montoVencido: vencidoC / 100, montoTotal: totalC / 100 };
}

/** «16 cuotas por cobrar» / «1 cuota por cobrar». */
export function rotuloDeCuotas(n: number): string {
  return n === 1 ? "1 cuota por cobrar" : `${n} cuotas por cobrar`;
}

/** «15 vencidas · 1 vence hoy · 2 próximas» (solo las partes que hay). */
export function desgloseDeCuotas(r: Pick<ResumenDeMensualidades, "vencidas" | "hoy" | "proximas">): string {
  const partes: string[] = [];
  if (r.vencidas > 0) partes.push(r.vencidas === 1 ? "1 vencida" : `${r.vencidas} vencidas`);
  if (r.hoy > 0) partes.push(r.hoy === 1 ? "1 vence hoy" : `${r.hoy} vencen hoy`);
  if (r.proximas > 0) partes.push(r.proximas === 1 ? "1 próxima" : `${r.proximas} próximas`);
  return partes.join(" · ");
}
