// Teleconsulta — en qué clínicas está disponible (ws1-t4 ronda 6).
//
// Decisión de Rafael, 28-sep-2026: «Teleconsulta» se OCULTA por ahora en las
// clínicas dentales: sin entradas de menú ni enlaces, y la ruta directa
// redirige. NO se borra código: las demás categorías la conservan tal cual, y
// volver a encenderla en dental es quitar "DENTAL" de esta lista.
//
// Puro: sin sesión, sin Prisma, sin React. La categoría la pasa quien llama y,
// en el servidor, sale SIEMPRE de la sesión.
//
// Lo que NO se toca: la sala pública `/teleconsulta/[cita]` y las rutas para
// entrar y cerrar una sesión. Si una clínica dental tuviera una teleconsulta
// ya agendada y pagada, el paciente no se queda fuera de su cita; lo que ya no
// se puede es crear una nueva ni abrir la pantalla de la lista.

/** Categorías de clínica que hoy NO tienen teleconsulta. */
export const TELECONSULTA_OCULTA_EN: readonly string[] = ["DENTAL"];

/** ¿Esta clínica puede agendar y listar teleconsultas? Sin categoría conocida, no. */
export function teleconsultaDisponible(categoria: string | null | undefined): boolean {
  return !!categoria && TELECONSULTA_OCULTA_EN.indexOf(categoria) === -1;
}

/**
 * El modo con el que se guarda una cita nueva. En una clínica sin
 * teleconsulta la cita es presencial aunque la petición diga otra cosa: la
 * pantalla ya no ofrece la opción, y el servidor no se fía de la pantalla.
 */
export function modoDeLaCita(
  categoria: string | null | undefined,
  pideTeleconsulta: unknown,
): "TELECONSULTATION" | "IN_PERSON" {
  return pideTeleconsulta === true && teleconsultaDisponible(categoria) ? "TELECONSULTATION" : "IN_PERSON";
}
