// «Nueva consulta» — qué tipos ofrece el selector «Tipo» (Rafael, 28-sep-2026).
// Puro, sin React: lo prueban los tests en node.
//
// El fallo: en una clínica DENTAL el selector ofrecía Nutrición, Psicología y
// Medicina general, más un botón «Reset». En DaleControl dental eso no va.
//
//  · Clínica dental → «Dental general» y, SOLO si la sede tiene el módulo,
//    «Ortodoncia». Sin «Reset»: con dos opciones no hay nada que restablecer.
//  · Las demás verticales (medicina, nutrición, psicología…) → lo de siempre.
//    Sus formularios no se tocan ni se borran; solo dejan de salir en dental.
//
// «Ortodoncia» no es un formulario más de esta pantalla: elegirla lleva a la
// hoja de control de ortodoncia (la de «Registrar control»). Ver
// `patient-detail-client.tsx`.

export interface TipoDeConsulta {
  valor: string;
  /** Key i18n del texto de la opción. */
  labelKey: string;
}

export const TIPO_DENTAL = "dental";
export const TIPO_ORTODONCIA = "ortodoncia";

const DE_SIEMPRE: readonly TipoDeConsulta[] = [
  { valor: "dental", labelKey: "patients.newConsult.optDental" },
  { valor: "nutrition", labelKey: "patients.newConsult.optNutrition" },
  { valor: "psychology", labelKey: "patients.newConsult.optPsychology" },
  { valor: "medicine", labelKey: "patients.newConsult.optMedicine" },
];

export function esClinicaDental(categoria: string | null | undefined): boolean {
  return categoria === "DENTAL";
}

/** Las opciones del selector, en orden. */
export function tiposDeConsulta(p: {
  /** `clinic.category`, de la sesión. */
  categoria: string | null | undefined;
  /** La sede tiene el módulo de Ortodoncia contratado de verdad. */
  moduloOrtodoncia: boolean;
}): TipoDeConsulta[] {
  if (!esClinicaDental(p.categoria)) return [...DE_SIEMPRE];
  const tipos: TipoDeConsulta[] = [{ valor: TIPO_DENTAL, labelKey: "patients.newConsult.optDentalGeneral" }];
  if (p.moduloOrtodoncia) tipos.push({ valor: TIPO_ORTODONCIA, labelKey: "patients.newConsult.optOrthodontics" });
  return tipos;
}

/** El botón «Reset» (volver al tipo por defecto de la clínica) solo existe fuera de dental. */
export function permiteRestablecerTipo(categoria: string | null | undefined): boolean {
  return !esClinicaDental(categoria);
}

/**
 * El formulario que se pinta. En dental es SIEMPRE el dental, aunque el tipo
 * detectado o elegido fuera otro (un doctor dado de alta con otra especialidad,
 * un valor que quedó de antes): nunca un formulario que el selector no ofrece.
 */
export function formularioDeConsulta(actual: string, categoria: string | null | undefined): string {
  return esClinicaDental(categoria) ? TIPO_DENTAL : actual;
}
