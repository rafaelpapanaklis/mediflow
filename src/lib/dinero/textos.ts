// Textos es/en de los cambios de dinero de ws1-t5 (reembolsos, caja, descuentos).
// Viven aquí y no en los diccionarios grandes para no chocar con las otras
// pantallas que los editan a la vez; se eligen con `textosDinero(locale)`.

const es = {
  devolucion: {
    pregunta: "¿Cómo le devolviste el dinero?",
    elige: "Elige cómo salió el dinero",
    obligatorio: "Di cómo le devolviste el dinero: el corte de caja solo resta lo que salió en efectivo.",
    ayudaEfectivo: "Sale del cajón: el corte de caja lo resta del efectivo esperado.",
    ayudaOtro: "No sale del cajón: el corte de caja no lo resta del efectivo.",
    metodos: {
      cash: "Efectivo (del cajón)",
      transfer: "Transferencia",
      debit: "A la tarjeta de débito",
      credit: "A la tarjeta de crédito",
      check: "Cheque",
      other: "Otro",
    },
  },
  caja: {
    reembolsosEfectivo: "De ellos, en efectivo",
    reembolsosSinMetodo: "Reembolsos sin método registrado (no se restan del efectivo)",
    aplicadoSaldo: "Saldo a favor aplicado (no entra dinero)",
    aSaldoFavor: "Pasó a saldo a favor (no sale dinero)",
    abiertaTitulo: (dias: number) => `La caja lleva ${dias} ${dias === 1 ? "día" : "días"} abierta sin corte`,
    abiertaTexto: "Mientras no se corte, el turno acumula los cobros de todos esos días y el arqueo deja de servir. Haz el corte de caja.",
    abiertaIr: "Ir a Caja",
    fueraTitulo: (n: number) => `${n} ${n === 1 ? "cobro" : "cobros"} en efectivo fuera de todo corte`,
    fueraTexto: "Se cobraron en efectivo cuando no había caja abierta (o con una fecha anterior a la apertura). Ningún corte los cuenta. Si el dinero está en el cajón, pásalo a la caja abierta.",
    fueraSinCaja: "Abre la caja para poder pasarlos a un corte.",
    fueraAsignar: "Pasar a esta caja",
    fueraAsignado: "Cobro pasado a la caja abierta.",
    fueraSinSql: "Falta pegar sql/ws1-t5-dinero-caja.sql para poder asignarlos.",
    cierreAutoTitulo: "Cierre automático a medianoche",
    cierreAutoTexto: "Si la caja sigue abierta a las 00:00 (hora de la clínica), se cierra sola con un «corte automático sin conteo»: congela el resumen del turno, sin efectivo contado ni diferencia. Apagado de fábrica.",
    cierreAutoNota: "Corte automático a medianoche (sin conteo).",
    guardado: "Guardado.",
    guardar: "Guardar",
    ajustesSinSql: "Falta pegar sql/ws1-t5-dinero-caja.sql para poder guardar estos ajustes (mientras, valen los de fábrica).",
    verTodos: (n: number) => `Ver los ${n}`,
    verMenos: "Ver menos",
    // Auditoría de uso C-17 (4-oct-2026): la tabla del turno dice lo que es.
    thCobrado: "Cobrado",
    thDescuentoFactura: "Descuento de la factura",
    notaDescuento: "El descuento se ve una vez por factura. En el arqueo, «Descuentos» es la parte que le toca a lo cobrado en este turno.",
    csvDescuento: "Descuento (parte de este cobro)",
  },
  // Auditoría de uso C-02/C-03/C-30/C-32 (4-oct-2026): qué pasa con la factura al reembolsar.
  reembolso: {
    queHacer: "¿Qué pasa con la factura?",
    elige: "Elige qué pasa con la factura: si no, el paciente podría quedar debiendo lo que le devolviste.",
    destinos: {
      baja_total: "Le cobré de más: baja el total",
      sigue_debiendo: "El paciente sigue debiendo lo devuelto",
      baja_resto: "El tratamiento no sigue: dar de baja el resto",
    },
    ayudas: {
      baja_total: "El total baja lo mismo que devuelves. Lo que debía, lo sigue debiendo.",
      sigue_debiendo: "El total no cambia: lo devuelto vuelve a quedar por cobrar.",
      baja_resto: "El total queda en lo que el paciente se queda pagado; no queda nada por cobrar.",
    },
    quedara: (total: string, saldo: string, estado: string) => `La factura queda: total ${total} · por cobrar ${saldo} · ${estado}.`,
    estados: { PENDING: "Pendiente", PARTIAL: "Parcial", PAID: "Pagada", CANCELLED: "Cancelada" } as Record<string, string>,
    reembolsado: "Reembolsado",
    pasoASaldo: "Pasó a saldo a favor",
    anticipoPorRecibir: "Anticipo pedido, sin recibir",
    exito: (estado: string) => `Reembolso registrado. La factura queda ${estado.toLowerCase()}.`,
  },
  // C-13: «Nueva factura» avisa del saldo a favor que se le va a descontar.
  saldoAFavorEnEditor: (monto: string) => `Este paciente tiene ${monto} a favor: al crear la factura se descuentan solos y queda por cobrar el resto.`,
  // C-31: «Vence el» con una fecha que ya pasó.
  vencePasado: "Esa fecha ya pasó: la factura contará como vencida desde ya.",
  // C-15: el mismo dinero, la misma regla que «Registrar anticipo recibido».
  cobro: {
    faltaReferencia: "Para transferencia, escribe la referencia del depósito (clave de rastreo o folio).",
  },
  // C-07: «Cobrar hoy» con doctor.
  doctorCobro: {
    doctor: "Doctor",
    sinAsignar: "Sin asignar",
    origen: {
      cita: "Lo tomamos de la cita. Puedes cambiarlo.",
      cita_de_hoy: "Lo tomamos de la cita de hoy del paciente. Puedes cambiarlo.",
      plan: "Lo tomamos de su plan de tratamiento activo. Puedes cambiarlo.",
      cabecera: "Lo tomamos de su doctor de cabecera. Puedes cambiarlo.",
    } as Record<string, string>,
    sinDoctor: "Sin doctor, este cobro no entra a la comisión de nadie.",
  },
  cancelarConPagos: {
    texto: (pagado: string, resto: string) => `Esta factura tiene ${pagado} cobrados y ${resto} por cobrar. Elige qué hacer:`,
    devolver: (pagado: string) => `Devolver lo pagado (${pagado}) y cancelar`,
    conservar: (resto: string) => `Quedarse con lo pagado y dar de baja el resto (${resto})`,
    conservarAyuda: "La factura queda pagada por lo que ya se cobró; deja de contar como deuda.",
    exitoConservar: (resto: string) => `Se dio de baja el resto (${resto}). La factura queda pagada.`,
  },
  descuento: {
    requiereDueno: (pct: number, limite: number) =>
      `Un descuento del ${pct}% pasa del ${limite}% que la clínica permite sin autorización. Solo el dueño de la clínica puede aplicarlo.`,
    limiteTitulo: "Descuento máximo sin autorización del dueño",
    limiteTexto: "Por encima de este porcentaje del importe, solo el dueño de la clínica puede aplicar el descuento. 100 = sin límite.",
  },
};

type Textos = typeof es;

const en: Textos = {
  devolucion: {
    pregunta: "How did you refund the money?",
    elige: "Choose how the money went out",
    obligatorio: "Say how you refunded the money: the cash count only subtracts what left in cash.",
    ayudaEfectivo: "Leaves the drawer: the cash count subtracts it from the expected cash.",
    ayudaOtro: "Doesn't leave the drawer: the cash count doesn't subtract it.",
    metodos: {
      cash: "Cash (from the drawer)",
      transfer: "Bank transfer",
      debit: "To the debit card",
      credit: "To the credit card",
      check: "Check",
      other: "Other",
    },
  },
  caja: {
    reembolsosEfectivo: "Of which, in cash",
    reembolsosSinMetodo: "Refunds with no method recorded (not subtracted from cash)",
    aplicadoSaldo: "Patient credit applied (no money comes in)",
    aSaldoFavor: "Moved to patient credit (no money goes out)",
    abiertaTitulo: (dias: number) => `The register has been open ${dias} ${dias === 1 ? "day" : "days"} without a cash count`,
    abiertaTexto: "Until it's closed, the shift piles up the payments of all those days and the count stops being useful. Close the register.",
    abiertaIr: "Go to Cash register",
    fueraTitulo: (n: number) => `${n} cash ${n === 1 ? "payment" : "payments"} outside every cash count`,
    fueraTexto: "They were collected in cash with no register open (or dated before it opened). No cash count includes them. If the money is in the drawer, move it to the open register.",
    fueraSinCaja: "Open the register to move them into a cash count.",
    fueraAsignar: "Move to this register",
    fueraAsignado: "Payment moved to the open register.",
    fueraSinSql: "sql/ws1-t5-dinero-caja.sql must be applied before assigning them.",
    cierreAutoTitulo: "Automatic close at midnight",
    cierreAutoTexto: "If the register is still open at 00:00 (clinic time), it closes itself with an \"automatic close, not counted\": the shift summary is frozen, with no counted cash or variance. Off by default.",
    cierreAutoNota: "Automatic close at midnight (not counted).",
    guardado: "Saved.",
    guardar: "Save",
    ajustesSinSql: "sql/ws1-t5-dinero-caja.sql must be applied before these settings can be saved (until then, the defaults apply).",
    verTodos: (n: number) => `See all ${n}`,
    verMenos: "See less",
    thCobrado: "Collected",
    thDescuentoFactura: "Invoice discount",
    notaDescuento: "The discount shows once per invoice. In the cash count, «Discounts» is the part that belongs to what was collected in this shift.",
    csvDescuento: "Discount (share of this payment)",
  },
  reembolso: {
    queHacer: "What happens to the invoice?",
    elige: "Choose what happens to the invoice: otherwise the patient could end up owing what you refunded.",
    destinos: {
      baja_total: "I overcharged: lower the total",
      sigue_debiendo: "The patient still owes the refunded amount",
      baja_resto: "Treatment won't continue: write off the rest",
    },
    ayudas: {
      baja_total: "The total goes down by what you refund. What they owed, they still owe.",
      sigue_debiendo: "The total doesn't change: the refunded amount is due again.",
      baja_resto: "The total becomes what the patient keeps paid; nothing is left to collect.",
    },
    quedara: (total: string, saldo: string, estado: string) => `The invoice will be: total ${total} · due ${saldo} · ${estado}.`,
    estados: { PENDING: "Pending", PARTIAL: "Partial", PAID: "Paid", CANCELLED: "Cancelled" } as Record<string, string>,
    reembolsado: "Refunded",
    pasoASaldo: "Moved to patient credit",
    anticipoPorRecibir: "Deposit requested, not received",
    exito: (estado: string) => `Refund recorded. The invoice is now ${estado.toLowerCase()}.`,
  },
  saldoAFavorEnEditor: (monto: string) => `This patient has ${monto} in credit: it's applied automatically when the invoice is created, and the rest stays due.`,
  vencePasado: "That date has already passed: the invoice will count as overdue right away.",
  cobro: {
    faltaReferencia: "For a bank transfer, enter the deposit reference (tracking key or folio).",
  },
  doctorCobro: {
    doctor: "Doctor",
    sinAsignar: "Unassigned",
    origen: {
      cita: "Taken from the appointment. You can change it.",
      cita_de_hoy: "Taken from the patient's appointment today. You can change it.",
      plan: "Taken from their active treatment plan. You can change it.",
      cabecera: "Taken from their primary doctor. You can change it.",
    } as Record<string, string>,
    sinDoctor: "With no doctor, this payment won't count toward anyone's commission.",
  },
  cancelarConPagos: {
    texto: (pagado: string, resto: string) => `This invoice has ${pagado} collected and ${resto} still due. Choose what to do:`,
    devolver: (pagado: string) => `Refund what was paid (${pagado}) and cancel`,
    conservar: (resto: string) => `Keep what was paid and write off the rest (${resto})`,
    conservarAyuda: "The invoice is marked paid for what was already collected; it no longer counts as debt.",
    exitoConservar: (resto: string) => `The rest (${resto}) was written off. The invoice is now paid.`,
  },
  descuento: {
    requiereDueno: (pct: number, limite: number) =>
      `A ${pct}% discount is above the ${limite}% the clinic allows without approval. Only the clinic owner can apply it.`,
    limiteTitulo: "Maximum discount without the owner's approval",
    limiteTexto: "Above this percentage of the amount, only the clinic owner can apply the discount. 100 = no limit.",
  },
};

export function textosDinero(locale: string | null | undefined): Textos {
  return locale && locale.toLowerCase().startsWith("en") ? en : es;
}
