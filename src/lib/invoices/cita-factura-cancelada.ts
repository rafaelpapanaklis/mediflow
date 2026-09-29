// Facturas — una factura CANCELADA ya no es «la factura de la cita» (H1 de la
// revisión final, ws1-t4). Puro: sin base.
//
// EL FALLO. `Invoice.appointmentId` es único en la base y la factura cancelada
// lo conservaba. Resultado: «Pedir anticipo» se ofrecía sobre la cancelada (y
// el servidor lo rechazaba), y crear otra factura para esa cita daba «Esa cita
// ya tiene una factura». La cita quedaba sin salida.
//
// EL CRITERIO. Al LEER, una factura cancelada no cuenta como la de la cita.
// El vínculo se conserva (historial) hasta que haga falta el sitio: al crear
// la factura nueva de esa cita, la cancelada lo suelta y queda anotado en sus
// notas y en la bitácora (`cita-factura-cancelada.server.ts`).

/** ¿Esta factura ocupa la cita? Una cancelada, no. */
export function facturaOcupaLaCita(factura: { status: string } | null | undefined): boolean {
  return !!factura && factura.status !== "CANCELLED";
}

/** Nota que queda en la factura cancelada al soltar la cita. */
export function notaDeCitaSoltada(notas: string | null, appointmentId: string, cuando: Date): string {
  const linea = `[Cita ${appointmentId}: esta factura estaba cancelada y la cita se volvió a facturar el ${cuando.toISOString().slice(0, 10)}]`;
  return notas ? `${notas}\n${linea}` : linea;
}
