// Ortodoncia — el formulario del «Plan de tratamiento» (popup «Editar plan» y sección opcional del alta del
// caso), ws1-t12. PURO: convierte entre lo que se teclea (textos) y lo que se manda al servidor. El servidor
// vuelve a validarlo todo (`validarPlanDetalle`): esto solo evita que quien llena tenga que descubrirlo al
// guardar y le dice, en palabras de la clínica, qué corregir.

import {
  CAMPOS_DE_UNA_OPCION,
  ALINEADORES_MAXIMOS,
  CONTROLES_MAXIMOS,
  PERIODICIDAD_MAXIMA_MESES,
  datoDelPlanSinCapturar,
  fechaIsoValida,
  leerFdi,
  textoFdi,
  type AnclajeArcada,
  type CampoDeUnaOpcion,
  type DatoDelPlanQuePuedeFaltar,
  type PlanDeTratamientoVista,
  type PlanDetalle,
  type TipoRadiografia,
} from "./plan-detalle";

export interface FormularioDelPlan {
  duracion: string;
  controles: string;
  alineadoresTotales: string;
  anclajeSuperior: AnclajeArcada | "";
  anclajeInferior: AnclajeArcada | "";
  aditamentos: string[];
  extraccionesIndicadas: string;
  extraccionesRealizadas: string;
  radiografias: TipoRadiografia[];
  periodicidad: string;
  reevaluacion: string;
  brackets: string[];
  alineadores: string[];
  placas: string[];
  tubosSuperiores: string;
  tubosInferiores: string;
  bandasSuperiores: string;
  bandasInferiores: string;
  cementacionSuperiorAnterior: string;
  cementacionSuperiorPosterior: string;
  cementacionInferiorAnterior: string;
  cementacionInferiorPosterior: string;
  interconsultas: string;
}

export function formularioVacio(duracionMeses: number | null = null): FormularioDelPlan {
  return {
    duracion: duracionMeses ? String(duracionMeses) : "",
    controles: "",
    alineadoresTotales: "",
    anclajeSuperior: "",
    anclajeInferior: "",
    aditamentos: [],
    extraccionesIndicadas: "",
    extraccionesRealizadas: "",
    radiografias: [],
    periodicidad: "",
    reevaluacion: "",
    brackets: [],
    alineadores: [],
    placas: [],
    tubosSuperiores: "",
    tubosInferiores: "",
    bandasSuperiores: "",
    bandasInferiores: "",
    cementacionSuperiorAnterior: "",
    cementacionSuperiorPosterior: "",
    cementacionInferiorAnterior: "",
    cementacionInferiorPosterior: "",
    interconsultas: "",
  };
}

/** El formulario de «Editar plan»: parte de lo que el caso ya tiene. */
export function formularioDesdeLaVista(v: PlanDeTratamientoVista): FormularioDelPlan {
  const d = v.detalle;
  // Una duración guardada como relleno («sin capturar») se ve VACÍA: el formulario no la presenta como dato.
  const f = formularioVacio(datoDelPlanSinCapturar(d, "duracion") ? null : v.duracionMeses);
  return {
    ...f,
    controles: d.controlesPrevistos ? String(d.controlesPrevistos) : "",
    alineadoresTotales: d.alineadoresTotales ? String(d.alineadoresTotales) : "",
    anclajeSuperior: d.anclajeSuperior ?? "",
    anclajeInferior: d.anclajeInferior ?? "",
    aditamentos: [...d.aditamentos],
    extraccionesIndicadas: textoFdi(v.extraccionesIndicadas),
    extraccionesRealizadas: textoFdi(d.extraccionesRealizadas),
    radiografias: [...d.controlRadiografico],
    periodicidad: d.periodicidadMeses ? String(d.periodicidadMeses) : "",
    reevaluacion: d.reevaluacion ?? "",
    brackets: [...d.brackets],
    alineadores: [...d.alineadores],
    placas: [...d.placas],
    tubosSuperiores: d.tubosSuperiores ?? "",
    tubosInferiores: d.tubosInferiores ?? "",
    bandasSuperiores: d.bandasSuperiores ?? "",
    bandasInferiores: d.bandasInferiores ?? "",
    cementacionSuperiorAnterior: d.cementacionSuperiorAnterior ?? "",
    cementacionSuperiorPosterior: d.cementacionSuperiorPosterior ?? "",
    cementacionInferiorAnterior: d.cementacionInferiorAnterior ?? "",
    cementacionInferiorPosterior: d.cementacionInferiorPosterior ?? "",
    interconsultas: d.interconsultas ?? "",
  };
}

/** ¿Se llenó algo del plan (sin contar la duración, que el alta ya pide arriba)? Para no mandar un plan vacío. */
export function formularioTocado(f: FormularioDelPlan): boolean {
  const { duracion: _duracion, ...resto } = f;
  void _duracion;
  return Object.values(resto).some((v) => (Array.isArray(v) ? v.length > 0 : String(v).trim() !== ""));
}

function entero(texto: string, min: number, max: number, rotulo: string): { ok: true; valor: number | null } | { ok: false; error: string } {
  const t = texto.trim();
  if (t === "") return { ok: true, valor: null };
  const n = /^\d+$/.test(t) ? Number(t) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return { ok: false, error: `${rotulo}: escribe un número entero de ${min} a ${max}.` };
  return { ok: true, valor: n };
}

export interface PeticionDelPlan {
  /** Va tal cual a `validarPlanDetalle`. */
  plan: Record<string, unknown>;
  extraccionesIndicadas: number[];
  /** Ausente = la duración quedó sin capturar (el servidor no la toca y la marca queda en `plan.sinCapturar`). */
  duracionMeses?: number;
}

/** Cómo se lee el formulario: qué se exige y qué marcas del plan viajan de vuelta. */
export interface OpcionesDelFormulario {
  /** Pide la duración (3 a 60). Con `false` no se manda. */
  conDuracion: boolean;
  /** La duración vacía es válida y queda «sin capturar» (el alta; o un caso que ya la tenía sin capturar). */
  permitirSinDuracion?: boolean;
  /** Los objetivos del caso están sin elegir: quedan «sin capturar». */
  objetivosSinCapturar?: boolean;
  /** El anclaje general lo eligió quien abrió el caso a propósito (se conserva al editar). */
  anclajeGeneralElegido?: boolean;
}

export type ResultadoDelFormulario = { ok: true; peticion: PeticionDelPlan } | { ok: false; error: string };

/** Lo que se mandará al servidor, o lo primero que hay que corregir. */
export function formularioAPeticion(f: FormularioDelPlan, opts: OpcionesDelFormulario = { conDuracion: true }): ResultadoDelFormulario {
  const controles = entero(f.controles, 1, CONTROLES_MAXIMOS, "Cantidad de controles");
  if (controles.ok === false) return controles;
  const alineadores = entero(f.alineadoresTotales, 1, ALINEADORES_MAXIMOS, "Alineadores totales");
  if (alineadores.ok === false) return alineadores;
  const periodicidad = entero(f.periodicidad, 1, PERIODICIDAD_MAXIMA_MESES, "Periodicidad");
  if (periodicidad.ok === false) return periodicidad;
  let duracionMeses: number | undefined;
  const sinCapturar: DatoDelPlanQuePuedeFaltar[] = [];
  if (opts.conDuracion) {
    const d = entero(f.duracion, 3, 60, "Tiempo de tratamiento");
    if (d.ok === false) return d;
    if (d.valor === null) {
      if (!opts.permitirSinDuracion) return { ok: false, error: "Tiempo de tratamiento: escribe los meses (de 3 a 60)." };
      sinCapturar.push("duracion");
    } else {
      duracionMeses = d.valor;
    }
  }
  if (opts.objetivosSinCapturar) sinCapturar.push("objetivos");
  const indicadas = leerFdi(f.extraccionesIndicadas);
  if (indicadas.invalidos.length > 0) return { ok: false, error: `Extracciones indicadas: «${indicadas.invalidos.join("», «")}» no es una pieza FDI válida (por ejemplo 14, 24, 34, 44).` };
  const realizadas = leerFdi(f.extraccionesRealizadas);
  if (realizadas.invalidos.length > 0) return { ok: false, error: `Extracciones realizadas: «${realizadas.invalidos.join("», «")}» no es una pieza FDI válida.` };
  if (f.reevaluacion.trim() !== "" && fechaIsoValida(f.reevaluacion) === null) return { ok: false, error: "La fecha de reevaluación no es válida." };

  const plan: Record<string, unknown> = {
    controlesPrevistos: controles.valor,
    alineadoresTotales: alineadores.valor,
    anclajeSuperior: f.anclajeSuperior || null,
    anclajeInferior: f.anclajeInferior || null,
    aditamentos: f.aditamentos,
    extraccionesRealizadas: realizadas.validos,
    controlRadiografico: f.radiografias,
    periodicidadMeses: periodicidad.valor,
    reevaluacion: f.reevaluacion.trim() || null,
    brackets: f.brackets,
    alineadores: f.alineadores,
    placas: f.placas,
    interconsultas: f.interconsultas.trim() || null,
    ...(sinCapturar.length > 0 ? { sinCapturar } : {}),
    ...(opts.anclajeGeneralElegido ? { anclajeGeneralElegido: true } : {}),
  };
  for (const c of CAMPOS_DE_UNA_OPCION) plan[c.campo] = (f[c.campo as CampoDeUnaOpcion] as string).trim() || null;
  return { ok: true, peticion: { plan, extraccionesIndicadas: indicadas.validos, ...(duracionMeses !== undefined ? { duracionMeses } : {}) } };
}

/** Quita o pone una opción de una lista de elegidas. */
export function alternar(lista: readonly string[], nombre: string): string[] {
  return lista.includes(nombre) ? lista.filter((x) => x !== nombre) : [...lista, nombre];
}

/** El plan que el formulario dice, en el formato de la base (para comparar «¿cambió algo?»). */
export function detalleDesdePeticion(p: PeticionDelPlan): Partial<PlanDetalle> {
  return p.plan as Partial<PlanDetalle>;
}

// ─── Las secciones del popup (navegación) ───────────────────────────────

export const SECCIONES_DEL_FORMULARIO = [
  { clave: "tiempo", titulo: "Tiempo y controles" },
  { clave: "anclaje", titulo: "Anclaje" },
  { clave: "aditamentos", titulo: "Aditamentos" },
  { clave: "extracciones", titulo: "Extracciones" },
  { clave: "radiografico", titulo: "Control radiográfico" },
  { clave: "aparatologia", titulo: "Aparatología" },
  { clave: "tubos", titulo: "Tubos, bandas y cementación" },
  { clave: "interconsultas", titulo: "Interconsultas" },
] as const;
export type ClaveDeSeccion = (typeof SECCIONES_DEL_FORMULARIO)[number]["clave"];

const lleno = (v: string): boolean => v.trim() !== "";

/** Qué secciones ya tienen algo anotado: la navegación del popup marca las llenas. */
export function seccionesConDatos(f: FormularioDelPlan): Record<ClaveDeSeccion, boolean> {
  return {
    tiempo: lleno(f.controles) || lleno(f.alineadoresTotales),
    anclaje: f.anclajeSuperior !== "" || f.anclajeInferior !== "",
    aditamentos: f.aditamentos.length > 0,
    extracciones: lleno(f.extraccionesIndicadas) || lleno(f.extraccionesRealizadas),
    radiografico: f.radiografias.length > 0 || lleno(f.periodicidad) || lleno(f.reevaluacion),
    aparatologia: f.brackets.length + f.alineadores.length + f.placas.length > 0,
    tubos: CAMPOS_DE_UNA_OPCION.some((c) => lleno(f[c.campo as CampoDeUnaOpcion] as string)),
    interconsultas: lleno(f.interconsultas),
  };
}

/** Periodicidades que se ofrecen como atajo (el campo admite cualquier número de 1 a 60). */
export const PERIODICIDADES_COMUNES = [3, 6, 9, 12, 18, 24] as const;

// ─── Las secciones de la ventana del caso (paso «Plan de tratamiento») ──

export type ClaveDeLaVentana = ClaveDeSeccion | "tecnica" | "retencion" | "cobro";

/** La navegación del paso «Plan de tratamiento»: técnica y doctor arriba, retención y cobro al final. */
export const SECCIONES_DE_LA_VENTANA: ReadonlyArray<{ clave: ClaveDeLaVentana; titulo: string }> = [
  { clave: "tecnica", titulo: "Técnica y doctor" },
  ...SECCIONES_DEL_FORMULARIO,
  { clave: "retencion", titulo: "Plan de retención" },
  { clave: "cobro", titulo: "Cobro" },
];
