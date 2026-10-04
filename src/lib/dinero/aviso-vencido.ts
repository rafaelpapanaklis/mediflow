// Los dos avisos de «vencido» de Hoy, dichos de forma que se distingan
// (ws1-t2, auditoría de uso N-10; t10 F-10). Puro, sin I/O
// (src/lib/dinero/__tests__/aviso-vencido.test.ts).
//
// Hoy enseñaba a la vez «16 mensualidades vencidas · $60,400» y «16 facturas
// vencidas · $67,200»: mismo número de renglones, dos importes, y ninguno
// decía qué era. Son cosas distintas y están bien las dos:
//   · el de FACTURAS es todo lo vencido de la clínica (facturas, cuotas de
//     planes a plazos y cargos de ortodoncia), el de Caja y Finanzas;
//   · el de MENSUALIDADES es solo ortodoncia, contado por CUOTA, y ya va
//     dentro del anterior.
// Ahora cada uno lo dice en su segunda línea.

const mxn = (n: number) => `$${n.toLocaleString("es-MX", { maximumFractionDigits: 0 })}`;

/** El aviso de facturas vencidas (dueño y recepción): título y la línea que dice qué cuenta. */
export function avisoDeFacturasVencidas(count: number, total: number): { titulo: string; detalle: string } {
  return {
    titulo: `${count} factura${count === 1 ? "" : "s"} vencida${count === 1 ? "" : "s"} · ${mxn(total)}`,
    detalle: "Todo lo vencido de la clínica (ortodoncia incluida), el mismo «Vencido» de Caja y Finanzas",
  };
}

/** La segunda línea del aviso de mensualidades de ortodoncia vencidas. */
export function detalleDeMensualidadesVencidas(puedeVerModulo: boolean): string {
  return `Solo ortodoncia, por cuota; ya va dentro de las facturas vencidas · ${puedeVerModulo ? "ver quién debe en Cobranza" : "cobrar en Caja"}`;
}
