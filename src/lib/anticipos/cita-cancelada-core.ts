// Cancelar una cita cuya factura tiene dinero pagado (H15, decisión de Rafael:
// opción A — ws1-t4). Puro: sin base. El servidor está en
// `cita-cancelada.server.ts`.
//
// QUÉ SE DECIDE Y QUIÉN
//  - «a_favor»: el dinero queda como SALDO A FAVOR del paciente para su
//    próxima cita, con el mecanismo de saldo a favor que ya existe
//    (patient_credits + Payment «refund» + factura cancelada, igual que
//    `devolverAnticipoAlCancelar`).
//  - «reembolso»: la factura queda marcada POR REEMBOLSAR, con quién y
//    cuándo. DaleControl no mueve dinero: el reembolso real se hace fuera
//    (Mercado Pago o efectivo) y después se registra con «Reembolsar».
//  - «pendiente»: quien cancela sin permiso de cobro (o el paciente, desde el
//    portal o WhatsApp) no decide: la cita se cancela, el dinero se queda como
//    está y la factura lleva la marca PENDIENTE DE DECIDIR, para que quien
//    cobra elija después desde la factura.
//  Solo quien tiene permiso de cobro (`billing.charge`) elige a_favor o
//  reembolso.
//
// LA MARCA. Vive en las notas de la factura (sin cambiar el esquema), con un
// formato fijo que se puede leer de vuelta, y además en la bitácora. Una
// factura con dinero ligada a una cita cancelada nunca se queda sin marca.
//
// CAJA. «a_favor» cancela la factura, y la Caja deja fuera los cobros de
// facturas canceladas. Si parte de lo pagado entró EN EFECTIVO en el turno que
// sigue ABIERTO, cancelarla ahora quitaría ese efectivo del arqueo con los
// billetes todavía en el cajón: el corte no cuadraría. En ese caso «a_favor»
// espera a que se cierre el corte (los cerrados guardan su foto y no cambian).

export type DecisionCitaCancelada = "a_favor" | "reembolso" | "pendiente";

export const ETIQUETA_MARCA = "CITA CANCELADA CON DINERO PAGADO";

const TEXTO_DECISION: Record<DecisionCitaCancelada, string> = {
  a_favor: "A FAVOR DEL PACIENTE",
  reembolso: "POR REEMBOLSAR",
  pendiente: "PENDIENTE DE DECIDIR",
};

export function esDecision(v: unknown): v is DecisionCitaCancelada {
  return v === "a_favor" || v === "reembolso" || v === "pendiente";
}

function pesos(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Math.round(n * 100) / 100);
}

/** La línea que se añade a las notas de la factura. */
export function lineaDeMarca(args: {
  decision: DecisionCitaCancelada;
  monto: number;
  quien: string;
  cuando: Date;
  nota?: string | null;
}): string {
  const fecha = args.cuando.toISOString().slice(0, 16).replace("T", " ");
  const extra = args.nota?.trim() ? ` · ${args.nota.trim()}` : "";
  return `[${ETIQUETA_MARCA} · ${TEXTO_DECISION[args.decision]} · ${pesos(args.monto)} · ${args.quien} · ${fecha} UTC${extra}]`;
}

/** La última marca que llevan las notas, o null si no hay ninguna. */
export function ultimaMarca(notas: string | null | undefined): DecisionCitaCancelada | null {
  if (!notas) return null;
  const re = new RegExp(`\\[${ETIQUETA_MARCA} · (A FAVOR DEL PACIENTE|POR REEMBOLSAR|PENDIENTE DE DECIDIR) ·`, "g");
  let ultima: string | null = null;
  for (const m of notas.matchAll(re)) ultima = m[1];
  if (ultima === "A FAVOR DEL PACIENTE") return "a_favor";
  if (ultima === "POR REEMBOLSAR") return "reembolso";
  if (ultima === "PENDIENTE DE DECIDIR") return "pendiente";
  return null;
}

/** Quien cancela elige solo si tiene permiso de cobro; si no, «pendiente». */
export function decisionEfectiva(pedida: unknown, puedeCobrar: boolean): DecisionCitaCancelada {
  if (!puedeCobrar) return "pendiente";
  return pedida === "a_favor" || pedida === "reembolso" ? pedida : "pendiente";
}

/**
 * ¿Se puede dejar a favor AHORA? No si la factura está timbrada (cancelarla
 * pide cancelar el CFDI ante el SAT) ni si parte de lo pagado entró en
 * efectivo en el turno de caja que sigue abierto (ver CAJA, arriba).
 */
export function motivoParaNoDejarAFavor(args: {
  timbrada: boolean;
  cfdiPorPago: boolean;
  efectivoEnTurnoAbierto: number;
}): string | null {
  if (args.timbrada || args.cfdiPorPago) {
    return "La factura está timbrada: dejarlo a favor la cancelaría y eso pide cancelar antes el CFDI ante el SAT. Márcalo para reembolso o déjalo pendiente.";
  }
  if (args.efectivoEnTurnoAbierto > 0) {
    return `${pesos(args.efectivoEnTurnoAbierto)} de este dinero entró en efectivo en el turno de caja que sigue abierto: si se deja a favor ahora, el corte no cuadraría. Elige «reembolso» o déjalo pendiente y decídelo desde la factura cuando cierres el corte.`;
  }
  return null;
}

/** Qué dice el diálogo de cancelar la cita. */
export function avisoDeDinero(pagado: number): string {
  return `Esta cita tiene ${pesos(pagado)} pagados.`;
}
