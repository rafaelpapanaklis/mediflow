// Ortodoncia — X4: «Abrir plan de pago» con dos pestañas abiertas.
//
// La factura del plan la crea el editor de SIEMPRE (POST /api/invoices) y
// DESPUÉS `abrirPlanDePago` la liga al caso. Con dos pestañas, las dos pueden
// crear su factura antes de que ninguna la ligue: la liga es condicional (solo
// entra si el caso sigue sin factura vigente) y la gana la primera. Aquí vive
// la regla, pura y con test, de qué hacer con la de la segunda:
//
//   - La segunda pestaña recibe la factura que YA quedó ligada (no un error).
//   - Su factura recién creada se cancela SOLO si es claramente una copia sin
//     consecuencias: del mismo paciente, PENDIENTE, sin nada pagado (ni saldo a
//     favor aplicado), sin CFDI, sin cita, sin ligar a otro caso y creada hace
//     muy poco. Si no cumple TODO, no se toca y se avisa para cancelarla a mano.

/** Cuánto tiempo después de crearla se considera «la que acaba de crear esta pestaña». */
export const VENTANA_DUPLICADA_MS = 30 * 60 * 1000;

export interface FacturaCandidataADuplicada {
  patientId: string | null;
  status: string;
  paid: number;
  cfdiUuid: string | null;
  appointmentId: string | null;
  createdAt: Date;
  /** Caso de ortodoncia al que YA está ligada (si alguno). */
  ligadaACaso: string | null;
}

/** `motivo` = por qué NO se cancela (null cuando sí). */
export interface DecisionDuplicada {
  cancelar: boolean;
  motivo: string | null;
}

export function decidirFacturaDuplicada(args: {
  duplicada: FacturaCandidataADuplicada | null;
  patientIdDelCaso: string;
  ahora: Date;
}): DecisionDuplicada {
  const f = args.duplicada;
  if (!f) return { cancelar: false, motivo: "no existe" };
  if (f.patientId !== args.patientIdDelCaso) return { cancelar: false, motivo: "es de otro paciente" };
  if (f.ligadaACaso) return { cancelar: false, motivo: "ya está ligada a un caso" };
  if (f.status !== "PENDING") return { cancelar: false, motivo: "ya no está pendiente" };
  if (f.paid > 0) return { cancelar: false, motivo: "tiene pagos o saldo a favor aplicado" };
  if (f.cfdiUuid) return { cancelar: false, motivo: "está timbrada" };
  if (f.appointmentId) return { cancelar: false, motivo: "está ligada a una cita" };
  const edad = args.ahora.getTime() - f.createdAt.getTime();
  if (!(edad >= 0 && edad <= VENTANA_DUPLICADA_MS)) return { cancelar: false, motivo: "no es reciente" };
  return { cancelar: true, motivo: null };
}

export const NOTA_CANCELADA_POR_DUPLICADA =
  "[CANCELADA: duplicada — otra pestaña ya había abierto el plan de pago de ortodoncia de este caso]";

/** Aviso para quien estaba en la segunda pestaña. */
export function avisoDePlanYaAbierto(args: {
  numeroVigente: string | null;
  numeroDuplicada: string | null;
  duplicadaCancelada: boolean;
}): string {
  const vigente = args.numeroVigente ? ` (${args.numeroVigente})` : "";
  const dup = args.numeroDuplicada ? ` (${args.numeroDuplicada})` : "";
  return args.duplicadaCancelada
    ? `Este caso ya tenía su plan de pago abierto desde otra pestaña${vigente}. Se quedó esa factura y la que acabas de crear${dup} se canceló.`
    : `Este caso ya tenía su plan de pago abierto desde otra pestaña${vigente}. La factura que acabas de crear${dup} NO quedó ligada al caso: revísala y cancélala desde Facturación.`;
}
