// Ortodoncia — lo MÍNIMO que la ficha general del paciente necesita saber del
// caso (ws1-t4 ronda 6). Puro: sin React, sin Prisma y sin consultas. Trabaja
// con lo que la ficha ya trae cargado (`orthoData`, el mismo de la pestaña
// Ortodoncia), así que la portada y la pestaña «Plan» dicen lo mismo que el
// resumen del caso («Mes 2 de 18 · Alineación») sin ir otra vez a la base.
//
// Antes, un paciente en el mes 2 de 18 de ortodoncia salía en la portada como
// «Sin tratamiento activo» y en «Plan» como «Sin planes de tratamiento»: la
// ficha general solo miraba los planes generales.
//
// De dónde sale cada dato (igual que `adaptTreatment`, redesign/adapter.ts):
//  · mes actual   → `monthInTreatment` (meses desde la colocación)
//  · meses totales → `plan.estimatedDurationMonths`
//  · fase         → la fase con estado IN_PROGRESS
// El ESTADO sale de `plan.status` y no del `treatment.status` del rediseño,
// que junta «planeado», «pausado» y «abandonado» dentro de «en tratamiento».

export type EstadoCasoOrto =
  | "planeado"
  | "en-curso"
  | "pausado"
  | "retencion"
  | "terminado"
  | "abandonado";

export type FaseCasoOrto =
  | "ALIGNMENT"
  | "LEVELING"
  | "SPACE_CLOSURE"
  | "DETAILS"
  | "FINISHING"
  | "RETENTION";

/** Lo que se necesita del caso. `OrthoTabData` lo cumple tal cual. */
export interface CasoOrtoCargado {
  plan: { status: string; estimatedDurationMonths?: number | null } | null;
  phases?: ReadonlyArray<{ status: string; phaseKey: string }> | null;
  monthInTreatment?: number | null;
}

export interface ResumenOrtoParaFicha {
  estado: EstadoCasoOrto;
  /** El estado en palabras: «En curso», «Por colocar», «Pausado», «En retención»… */
  etiquetaEstado: string;
  /** Meses desde la colocación. 0 si todavía no se coloca. */
  mesActual: number;
  /** Duración estimada del caso en meses. 0 si no se capturó. */
  mesesTotales: number;
  /** La fase en curso, en palabras («Alineación»), o null si no hay ninguna. */
  fase: string | null;
  faseClave: FaseCasoOrto | null;
  /** El caso está en tratamiento activo (ni planeado, ni pausado, ni en retención). */
  enCurso: boolean;
  /** Cuenta como tratamiento del paciente: planeado, en curso, pausado o en retención. */
  abierto: boolean;
  /** Lo que se lee en la ficha: «Mes 2 de 18 · Alineación», «Por colocar», «En retención». */
  linea: string;
  /** Lo mismo sin la fase, para donde no cabe: «Mes 2 de 18», «Por colocar». */
  lineaCorta: string;
}

const ESTADO_POR_STATUS: Record<string, EstadoCasoOrto> = {
  PLANNED: "planeado",
  IN_PROGRESS: "en-curso",
  ON_HOLD: "pausado",
  RETENTION: "retencion",
  COMPLETED: "terminado",
  DROPPED_OUT: "abandonado",
};

export const ETIQUETA_ESTADO_CASO: Record<EstadoCasoOrto, string> = {
  planeado: "Por colocar",
  "en-curso": "En curso",
  pausado: "Pausado",
  retencion: "En retención",
  terminado: "Terminado",
  abandonado: "Abandonado",
};

/** Las mismas palabras que `PHASE_LABELS` de la pestaña Ortodoncia (un test lo vigila). */
export const ETIQUETA_FASE_CASO: Record<FaseCasoOrto, string> = {
  ALIGNMENT: "Alineación",
  LEVELING: "Nivelación",
  SPACE_CLOSURE: "Cierre de espacios",
  DETAILS: "Detalles",
  FINISHING: "Finalización",
  RETENTION: "Retención",
};

const ABIERTOS: ReadonlyArray<EstadoCasoOrto> = ["planeado", "en-curso", "pausado", "retencion"];

function enteroNoNegativo(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** «Mes 2 de 18», «Mes 2» si no hay duración, o null si no hay nada que decir. */
export function textoDelMes(mesActual: number, mesesTotales: number): string | null {
  if (mesesTotales > 0) return `Mes ${mesActual} de ${mesesTotales}`;
  if (mesActual > 0) return `Mes ${mesActual}`;
  return null;
}

/** Dónde viven en el diccionario los textos de la ficha (`es.json` / `en.json`). */
export const CLAVES_CASO_ORTO = "pacientesRediseno.casoOrto";

const CLAVE_DE_ESTADO: Record<EstadoCasoOrto, string> = {
  planeado: "porColocar",
  "en-curso": "enCurso",
  pausado: "pausado",
  retencion: "enRetencion",
  terminado: "terminado",
  abandonado: "abandonado",
};

type Traductor = (clave: string, vars?: Record<string, string | number>) => string;

/**
 * La misma `linea`, pero en el idioma de la clínica. En español devuelve
 * exactamente `resumen.linea` (un test compara las dos contra `es.json`).
 */
export function lineaDelCasoTraducida(
  resumen: ResumenOrtoParaFicha,
  t: Traductor,
  opciones: { conFase?: boolean } = {},
): string {
  const conFase = opciones.conFase !== false;
  const estado = t(`${CLAVES_CASO_ORTO}.${CLAVE_DE_ESTADO[resumen.estado]}`);
  if (!resumen.enCurso) return estado;
  const mes =
    resumen.mesesTotales > 0
      ? t(`${CLAVES_CASO_ORTO}.mesDe`, { mes: resumen.mesActual, total: resumen.mesesTotales })
      : resumen.mesActual > 0
        ? t(`${CLAVES_CASO_ORTO}.mes`, { mes: resumen.mesActual })
        : estado;
  const fase = conFase && resumen.faseClave ? t(`${CLAVES_CASO_ORTO}.fase.${resumen.faseClave}`) : null;
  return [mes, fase].filter(Boolean).join(" · ");
}

/**
 * El resumen del caso para la ficha general, o `null` si el paciente no tiene
 * caso (sin datos de ortodoncia, o sin plan: solo valorado).
 *
 * Un estado que este archivo no conoce NO se da por abierto: se devuelve
 * `null`, que es no pintar nada, antes que anunciar un tratamiento que quizá
 * no existe.
 */
export function resumenOrtoParaFicha(caso: CasoOrtoCargado | null | undefined): ResumenOrtoParaFicha | null {
  const plan = caso?.plan ?? null;
  if (!caso || !plan) return null;

  const estado = ESTADO_POR_STATUS[String(plan.status)];
  if (!estado) return null;

  const mesActual = enteroNoNegativo(caso.monthInTreatment);
  const mesesTotales = enteroNoNegativo(plan.estimatedDurationMonths);

  const claveEnCurso = (caso.phases ?? []).find((f) => f.status === "IN_PROGRESS")?.phaseKey ?? null;
  const faseClave =
    claveEnCurso && claveEnCurso in ETIQUETA_FASE_CASO ? (claveEnCurso as FaseCasoOrto) : null;
  const fase = faseClave ? ETIQUETA_FASE_CASO[faseClave] : null;

  const etiquetaEstado = ETIQUETA_ESTADO_CASO[estado];
  const enCurso = estado === "en-curso";

  // En curso se cuenta por dónde va («Mes 2 de 18 · Alineación»). En los demás
  // estados lo que importa es el estado: decir «Mes 9 de 18» de un caso en
  // pausa da a entender que sigue avanzando.
  const lineaCorta = enCurso ? (textoDelMes(mesActual, mesesTotales) ?? etiquetaEstado) : etiquetaEstado;
  const linea = enCurso ? [lineaCorta, fase].filter(Boolean).join(" · ") : etiquetaEstado;

  return {
    estado,
    etiquetaEstado,
    mesActual,
    mesesTotales,
    fase,
    faseClave,
    enCurso,
    abierto: ABIERTOS.indexOf(estado) !== -1,
    linea,
    lineaCorta,
  };
}
