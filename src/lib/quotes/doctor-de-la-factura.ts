// Con qué DOCTOR nace la factura de un presupuesto (ws1-t3). Regla pura, sin
// I/O y con tests; la lectura de la base y el alta viven en
// create-invoice-from-quote.ts.
//
// Hasta aquí nacía «Sin asignar»: el PR #313 lo dejó así a propósito, esperando
// decisión. La decisión: el que CREÓ el presupuesto, y solo si es un DOCTOR de
// la clínica. Si lo creó recepción, o un administrador, o quien lo creó ya no
// existe, la factura nace sin doctor, como hasta hoy: mejor vacío que un doctor
// equivocado en un documento fiscal y en el corte por doctor de Caja. NUNCA se
// cae a «quien pulsa Generar factura»: quien factura casi nunca es quien atendió.
//
// ── Y el VENCIMIENTO sigue naciendo vacío, a propósito ───────────────────
// Se decidió usar la fecha del primer pago de las condiciones de pago. Al
// mirarlo, esa fecha no sirve de vencimiento en ninguno de los dos modos, y por
// eso NO se cableó (detalle en el reporte de ws1-t3, 17-sep-2026):
//
//  · A PLAZOS: «vencida» en el panel es de la factura ENTERA (saldo > 0 y
//    `dueDate` < hoy; caja.ts, Facturas, Finanzas y Sabina comparten la regla).
//    Con la fecha de la PRIMERA mensualidad, al día siguiente TODO el saldo —
//    también lo pactado para dentro de cinco meses— saldría como vencido aunque
//    el paciente vaya al corriente.
//  · UN PAGO: el editor solo enseña «primer pago» en modo a plazos. En modo un
//    pago el campo no se ve, pero conserva (y guarda) la fecha que se sugirió
//    si alguien pasó por «a plazos» y volvió: la factura nacería con un
//    vencimiento que nadie eligió ni ve.
//
// Una factura sin `dueDate` no vence jamás (lib/invoices/due-date.ts): es lo de
// hoy y lo menos dañino hasta que haya una fecha que alguien haya elegido.

/**
 * El doctor con el que nace la factura: `createdById` si está entre los DOCTOR
 * de la clínica, o `null`. `esDoctorDeLaClinica` es el resultado de haberlo
 * buscado con `{ id, clinicId, role: "DOCTOR" }`, el MISMO filtro con el que
 * POST /api/invoices valida el doctor que manda el editor.
 */
export function doctorDeLaFactura(
  createdById: string | null | undefined,
  esDoctorDeLaClinica: boolean,
): string | null {
  if (!createdById) return null;
  return esDoctorDeLaClinica ? createdById : null;
}
