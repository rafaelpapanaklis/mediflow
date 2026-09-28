// La hoja de control sugería «Próximo control» siempre a 30 min. La clínica ya
// configura la duración de «Control de ortodoncia» en Configuración → tipos de
// cita; se usa esa, ajustada a la opción más cercana que ofrece el selector.
import { TIPO_CITA_CONTROL_ORTO } from "./agenda-constants";

export const DURACIONES_PROXIMO_CONTROL = [15, 30, 45, 60, 90] as const;

export function duracionSugeridaProximoControl(
  tipos: ReadonlyArray<{ label: string; durationMin?: number | null }> | null | undefined,
): number | null {
  const min = tipos?.find((t) => t.label === TIPO_CITA_CONTROL_ORTO)?.durationMin;
  if (typeof min !== "number" || !Number.isFinite(min) || min <= 0) return null;
  return DURACIONES_PROXIMO_CONTROL.reduce((mejor, d) =>
    Math.abs(d - min) < Math.abs(mejor - min) ? d : mejor,
  );
}
