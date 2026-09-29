// ═══════════════════════════════════════════════════════════════════════════
// ELIMINAR UN CASO «ABIERTO POR ERROR» (ws1-t8). Puro, sin I/O: recibe lo que
// el caso tiene (`HistorialDelCaso`, lo lee `eliminar-caso-db.ts`) y dice si se
// puede borrar y, si no, por qué.
//
// LA REGLA (NOM-004: el expediente clínico se conserva)
//  Un caso solo se elimina si NO tiene nada: ni hojas de control, ni pagos, ni
//  fotos, ni análisis, ni alineadores, ni citas atendidas. Con historial se
//  marca «Terminado» o «Abandonó», nunca se borra.
//  Una factura del caso SIN pagos no es historial: se cancela junto con él, con
//  motivo. Una factura con pagos, o ya timbrada (CFDI vigente), sí lo es.
//
// El borrado es LÓGICO (`deletedAt` del plan y de su diagnóstico): no hace
// falta SQL y el rastro legal se queda en la base.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que cuelga de un caso. Todo son conteos, salvo las facturas a cancelar. */
export interface HistorialDelCaso {
  /** Hojas de control (firmadas o en borrador) que no se han borrado. */
  hojasDeControl: number;
  /** Facturas del caso con dinero recibido (`paid > 0` o algún `Payment`). */
  facturasConPagos: number;
  /** Facturas del caso ya timbradas: cancelarlas aquí las dejaría vigentes ante el SAT. */
  facturasTimbradas: number;
  /** Ids de las facturas del caso SIN pagos y aún no canceladas: se cancelan con el caso. */
  facturasSinPagos: string[];
  /** Juegos de fotos, fotos de seguimiento y las del diagnóstico. */
  fotos: number;
  /** Cefalometría, análisis facial y Bolton. */
  analisis: number;
  /** El alineador del caso. */
  alineadores: number;
  /** Citas de control atendidas desde que se abrió el caso, más los controles registrados. */
  citasAtendidas: number;
  /** Consentimientos del caso, registros digitales, TADs, arcos y mecánica auxiliar. */
  otrosRegistros: number;
  /** Pago registrado en el plan de pagos antiguo (`OrthoPaymentPlan`). */
  pagosDelPlanAntiguo: number;
}

export const HISTORIAL_VACIO: HistorialDelCaso = {
  hojasDeControl: 0,
  facturasConPagos: 0,
  facturasTimbradas: 0,
  facturasSinPagos: [],
  fotos: 0,
  analisis: 0,
  alineadores: 0,
  citasAtendidas: 0,
  otrosRegistros: 0,
  pagosDelPlanAntiguo: 0,
};

/** Lo que se le dice a quien ve un caso con historial (el botón «Eliminar» no sale). */
export const TEXTO_CON_HISTORIAL = "Tiene historial: márcalo como Terminado o Abandonó.";

export const MIN_LETRAS_MOTIVO = 10;
export const MAX_LETRAS_MOTIVO = 300;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export interface VeredictoDeEliminacion {
  puede: boolean;
  /** Vacío cuando se puede. Frases cortas, una por cada cosa que lo impide. */
  motivos: string[];
  /** Cuántas facturas sin pagos se cancelarían junto con el caso. */
  facturasACancelar: number;
}

export function evaluarEliminacion(h: HistorialDelCaso): VeredictoDeEliminacion {
  const motivos: string[] = [];
  if (h.hojasDeControl > 0) motivos.push(plural(h.hojasDeControl, "hoja de control", "hojas de control"));
  if (h.facturasConPagos > 0) motivos.push(plural(h.facturasConPagos, "factura con pagos", "facturas con pagos"));
  if (h.pagosDelPlanAntiguo > 0) motivos.push("pagos registrados en el plan de pagos");
  if (h.facturasTimbradas > 0) motivos.push(plural(h.facturasTimbradas, "factura timbrada", "facturas timbradas"));
  if (h.fotos > 0) motivos.push(plural(h.fotos, "foto o juego de fotos", "fotos o juegos de fotos"));
  if (h.analisis > 0) motivos.push(plural(h.analisis, "análisis", "análisis"));
  if (h.alineadores > 0) motivos.push(plural(h.alineadores, "alineador", "alineadores"));
  if (h.citasAtendidas > 0) motivos.push(plural(h.citasAtendidas, "cita atendida", "citas atendidas"));
  if (h.otrosRegistros > 0) motivos.push(plural(h.otrosRegistros, "registro clínico", "registros clínicos"));
  return { puede: motivos.length === 0, motivos, facturasACancelar: h.facturasSinPagos.length };
}

/** «Tiene historial (2 hojas de control, 1 factura con pagos): márcalo como Terminado o Abandonó.» */
export function explicacionDeHistorial(v: VeredictoDeEliminacion): string {
  if (v.puede) return "";
  return `Tiene historial (${v.motivos.join(", ")}): márcalo como Terminado o Abandonó.`;
}

/** El motivo que se escribe al eliminar, saneado; `null` si no alcanza. */
export function motivoValido(crudo: unknown): string | null {
  if (typeof crudo !== "string") return null;
  const m = crudo.replace(/\s+/g, " ").trim();
  return m.length >= MIN_LETRAS_MOTIVO && m.length <= MAX_LETRAS_MOTIVO ? m : null;
}

/** La frase de «Movimientos del paciente»: quién lo hizo lo pone el registro; aquí, qué y por qué. */
export function textoDelMovimiento(motivo: string, facturasCanceladas: number): string {
  const facturas =
    facturasCanceladas > 0
      ? ` Se ${facturasCanceladas === 1 ? "canceló 1 factura" : `cancelaron ${facturasCanceladas} facturas`} sin pagos del caso.`
      : "";
  return `Eliminó un caso de ortodoncia abierto por error. Motivo: ${motivo}.${facturas}`.replace(/\.\./g, ".");
}

/** La nota que queda en la factura cancelada junto con el caso. */
export function motivoDeCancelacionDeFactura(motivo: string): string {
  return `Caso de ortodoncia eliminado (abierto por error): ${motivo}`;
}
