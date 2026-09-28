// Ortodoncia — qué apartados del submenú ve cada quien (ws1-t4 ronda 6, fila
// 31 de la revisión de lógica de uso). Puro: sin React, sin sesión.
//
// EL FALLO QUE ARREGLA. «Configuración» salía en el submenú para todos. Un
// doctor o alguien de recepción entraba y recibía «No se pudo cargar la
// Configuración: Sin permisos: settings.view»: un callejón sin salida con un
// mensaje para programadores.
//
// Los demás apartados los abre el permiso del módulo
// (`specialties.orthodontics`), que ya comprueba el guardia. Configuración
// pide además `settings.view`, el mismo que exige la acción que la carga
// (`getOrthoConfigActionContext`).

export const RUTA_CONFIGURACION_ORTO = "/dashboard/orthodontics/configuracion";

/** El permiso que pide cada apartado ADEMÁS del permiso del módulo. */
export const PERMISO_DE_APARTADO: Readonly<Record<string, string>> = {
  [RUTA_CONFIGURACION_ORTO]: "settings.view",
};

/**
 * Los apartados que esta persona puede abrir, en el mismo orden.
 * `puede(permiso)` lo decide quien llama, con la sesión.
 */
export function apartadosPermitidos<T extends { href: string }>(
  apartados: readonly T[],
  puede: (permiso: string) => boolean,
): T[] {
  return apartados.filter((a) => {
    const permiso = PERMISO_DE_APARTADO[a.href];
    return permiso === undefined || puede(permiso);
  });
}
