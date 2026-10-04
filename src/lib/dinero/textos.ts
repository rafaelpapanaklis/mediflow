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
