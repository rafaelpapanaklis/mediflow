// Pantallas viejas de ortodoncia → su lugar de hoy (sección I de la revisión
// de lógica de uso). PURO.
//
// `/dashboard/patients/<id>/orthodontics` y
// `/dashboard/specialties/orthodontics/<id>` → la ficha del paciente en su
// pestaña Ortodoncia. `/dashboard/specialties/orthodontics` → el módulo
// (`/dashboard/orthodontics`). Los archivos de las páginas se quedan: solo
// redirigen, para que un marcador o un enlace viejo no acabe en la vista
// anterior.

type Parametros = Record<string, string | string[] | undefined> | undefined;

/** La ficha del paciente en la pestaña Ortodoncia, conservando el resto de la dirección (p. ej. `abrirCaso`). */
export function fichaOrtodonciaDesdeRutaVieja(patientId: string, searchParams?: Parametros): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (k === "tab" || v === undefined) continue;
    for (const uno of Array.isArray(v) ? v : [v]) q.append(k, uno);
  }
  const resto = q.toString();
  return `/dashboard/patients/${encodeURIComponent(patientId)}?tab=ortodoncia${resto ? `&${resto}` : ""}`;
}

export const MODULO_ORTODONCIA = "/dashboard/orthodontics";
