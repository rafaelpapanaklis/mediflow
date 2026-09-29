// Ortodoncia — el formulario del «Plan de tratamiento» (popup «Editar plan» y sección opcional del alta del
// caso), ws1-t12. PURO: convierte entre lo que se teclea (textos) y lo que se manda al servidor. El servidor
// vuelve a validarlo todo (`validarPlanDetalle`): esto solo evita que quien llena tenga que descubrirlo al
// guardar y le dice, en palabras de la clínica, qué corregir.

import {
  CAMPOS_DE_UNA_OPCION,
  ALINEADORES_MAXIMOS,
  CONTROLES_MAXIMOS,
  PERIODICIDAD_MAXIMA_MESES,
  fechaIsoValida,
  leerFdi,
  textoFdi,
  type AnclajeArcada,
  type CampoDeUnaOpcion,
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
  const f = formularioVacio(v.duracionMeses);
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
  duracionMeses?: number;
}

export type ResultadoDelFormulario = { ok: true; peticion: PeticionDelPlan } | { ok: false; error: string };

/** Lo que se mandará al servidor, o lo primero que hay que corregir. */
export function formularioAPeticion(f: FormularioDelPlan, opts: { conDuracion: boolean } = { conDuracion: true }): ResultadoDelFormulario {
  const controles = entero(f.controles, 1, CONTROLES_MAXIMOS, "Cantidad de controles");
  if (!controles.ok) return controles;
  const alineadores = entero(f.alineadoresTotales, 1, ALINEADORES_MAXIMOS, "Alineadores totales");
  if (!alineadores.ok) return alineadores;
  const periodicidad = entero(f.periodicidad, 1, PERIODICIDAD_MAXIMA_MESES, "Periodicidad");
  if (!periodicidad.ok) return periodicidad;
  let duracionMeses: number | undefined;
  if (opts.conDuracion) {
    const d = entero(f.duracion, 3, 60, "Tiempo de tratamiento");
    if (!d.ok) return d;
    if (d.valor === null) return { ok: false, error: "Tiempo de tratamiento: escribe los meses (de 3 a 60)." };
    duracionMeses = d.valor;
  }
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
