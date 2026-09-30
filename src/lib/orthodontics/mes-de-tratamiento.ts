// Ortodoncia — el «mes» de una hoja de control (ws1-t10). PURO.
// Antes cada pantalla lo contaba a su manera (meses de calendario en la Agenda, meses cumplidos en la ficha) y el
// historial acababa diciendo «mes 0.0» para todo. Aquí hay una sola cuenta: los meses REALES entre la colocación (o,
// sin ella, el inicio del caso) y el día de la visita, con un decimal. Misma unidad que ya usa la migración de Dentalink.

const DIA_MS = 86_400_000;
const DIAS_POR_MES = 30.4375;

/** Meses (un decimal, nunca negativo) de `colocacion` a `visita`. Sin fecha de colocación: 0. */
export function mesDeTratamiento(colocacion: Date | null | undefined, visita: Date): number {
  if (!colocacion) return 0;
  const desde = colocacion.getTime();
  const hasta = visita.getTime();
  if (!Number.isFinite(desde) || !Number.isFinite(hasta)) return 0;
  const meses = (hasta - desde) / (DIAS_POR_MES * DIA_MS);
  return Math.max(0, Math.round(meses * 10) / 10);
}

/** «mes 0», «mes 3», «mes 3.5»: sin el «.0» que hacía parecer un dato vacío lo que es una cuenta exacta. */
export function textoDelMes(mes: number): string {
  const m = Number.isFinite(mes) ? Math.max(0, mes) : 0;
  return `mes ${Number.isInteger(m) ? m : m.toFixed(1)}`;
}
