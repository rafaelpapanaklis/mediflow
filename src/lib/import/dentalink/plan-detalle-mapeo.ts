// Dentalink → «Plan de tratamiento» completo del caso (ws1-t12, punto 7: mapeo PREPARADO, todavía sin cablear).
// Puro: sin Prisma ni Next. Si un export de Dentalink trae los campos del plan de ortodoncia (Anclaje superior,
// Aditamentos, Brackets, Cantidad controles…), `planDetalleDesdeDentalink` los convierte a un `PlanDetalle` listo
// para `validarPlanDetalle`. Hoy ningún manejador lo llama: el export que se importa no trae estos campos. Cuando
// lo traiga, basta con pasar aquí la fila y guardar el resultado con `aplicarPlanDetalle`.
//
// Los encabezados se reconocen sin mirar mayúsculas, acentos ni signos («Anclaje Superior», «anclaje_superior»).
// Lo que no se entiende NO se inventa: queda en `avisos` para que la vista previa lo diga.

import {
  ANCLAJES,
  CAMPOS_DE_UNA_OPCION,
  RADIOGRAFIAS,
  leerFdi,
  limpiarTexto,
  normalizarPlanDetalle,
  sinAcentos,
  type AnclajeArcada,
  type PlanDetalle,
  type TipoRadiografia,
} from "@/lib/orthodontics/plan-detalle";

const clave = (t: string): string => sinAcentos(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Encabezado de Dentalink (normalizado) → campo del plan. */
const ENCABEZADOS: Record<string, string> = {
  "tiempo de tratamiento": "duracionMeses",
  "cantidad controles": "controlesPrevistos",
  "cantidad de controles": "controlesPrevistos",
  "alineadores totales": "alineadoresTotales",
  "anclaje superior": "anclajeSuperior",
  "anclaje inferior": "anclajeInferior",
  aditamentos: "aditamentos",
  "extracciones indicadas": "extraccionesIndicadas",
  "extracciones realizadas": "extraccionesRealizadas",
  "tipo control radiografico": "controlRadiografico",
  periodicidad: "periodicidadMeses",
  reevaluacion: "reevaluacion",
  brackets: "brackets",
  alineadores: "alineadores",
  placas: "placas",
  "tubos superiores": "tubosSuperiores",
  "tubos inferiores": "tubosInferiores",
  "bandas superiores": "bandasSuperiores",
  "bandas inferiores": "bandasInferiores",
  "cementacion superior anterior": "cementacionSuperiorAnterior",
  "cementacion superior posterior": "cementacionSuperiorPosterior",
  "cementacion inferior anterior": "cementacionInferiorAnterior",
  "cementacion inferior posterior": "cementacionInferiorPosterior",
  interconsultas: "interconsultas",
};

export interface PlanDesdeDentalink {
  detalle: PlanDetalle;
  /** Las indicadas (columna de siempre `extractionsTeethFdi`). */
  extraccionesIndicadas: number[];
  /** Duración en meses si el export la trae (columna `estimatedDurationMonths`). */
  duracionMeses: number | null;
  /** ¿La fila traía algún campo del plan? false = nada que guardar. */
  traeCampos: boolean;
  avisos: string[];
}

const lista = (v: unknown): string[] =>
  String(v ?? "")
    .split(/[,;|\n]+/)
    .map((x) => limpiarTexto(x))
    .filter(Boolean);

function numero(v: unknown): number | null {
  const m = /\d+/.exec(String(v ?? ""));
  return m ? Number(m[0]) : null;
}

function anclaje(v: unknown): AnclajeArcada | null {
  const k = clave(String(v ?? ""));
  if (!k) return null;
  return ANCLAJES.find((a) => clave(a.label) === k)?.key ?? null;
}

/** Fecha «dd/mm/aaaa» o «aaaa-mm-dd» → "YYYY-MM-DD" (null si no se entiende). */
function fecha(v: unknown): string | null {
  const t = String(v ?? "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(t);
  return dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}` : null;
}

export function planDetalleDesdeDentalink(fila: Record<string, unknown>): PlanDesdeDentalink {
  const crudo: Record<string, unknown> = {};
  const avisos: string[] = [];
  let indicadas: number[] = [];
  let duracionMeses: number | null = null;
  let traeCampos = false;

  for (const [encabezado, valor] of Object.entries(fila)) {
    const campo = ENCABEZADOS[clave(encabezado)];
    if (!campo || valor === null || valor === undefined || String(valor).trim() === "") continue;
    traeCampos = true;
    switch (campo) {
      case "duracionMeses":
        duracionMeses = numero(valor);
        break;
      case "controlesPrevistos":
      case "alineadoresTotales":
      case "periodicidadMeses":
        crudo[campo] = numero(valor);
        break;
      case "anclajeSuperior":
      case "anclajeInferior": {
        const a = anclaje(valor);
        if (a) crudo[campo] = a;
        else avisos.push(`${encabezado}: «${valor}» no es un anclaje conocido (se dejó sin elegir).`);
        break;
      }
      case "extraccionesIndicadas":
      case "extraccionesRealizadas": {
        const r = leerFdi(String(valor));
        if (r.invalidos.length > 0) avisos.push(`${encabezado}: se ignoró «${r.invalidos.join("», «")}» (no es FDI).`);
        if (campo === "extraccionesIndicadas") indicadas = r.validos;
        else crudo.extraccionesRealizadas = r.validos;
        break;
      }
      case "controlRadiografico": {
        const tipos: TipoRadiografia[] = [];
        for (const t of lista(valor)) {
          const k = clave(t);
          const r = RADIOGRAFIAS.find((x) => clave(x.label) === k || (k.startsWith("scanner atm") && x.key === "ATM_POST_DEPROGRAMACION"));
          if (r) tipos.push(r.key);
          else avisos.push(`${encabezado}: «${t}» no es un tipo de control radiográfico conocido.`);
        }
        crudo.controlRadiografico = tipos;
        break;
      }
      case "reevaluacion": {
        const f = fecha(valor);
        if (f) crudo.reevaluacion = f;
        else avisos.push(`${encabezado}: «${valor}» no es una fecha (dd/mm/aaaa).`);
        break;
      }
      case "aditamentos":
      case "brackets":
      case "alineadores":
      case "placas":
        crudo[campo] = lista(valor);
        break;
      case "interconsultas":
        crudo.interconsultas = String(valor);
        break;
      default:
        if (CAMPOS_DE_UNA_OPCION.some((c) => c.campo === campo)) crudo[campo] = limpiarTexto(valor);
    }
  }
  return { detalle: normalizarPlanDetalle(crudo), extraccionesIndicadas: indicadas, duracionMeses, traeCampos, avisos };
}
