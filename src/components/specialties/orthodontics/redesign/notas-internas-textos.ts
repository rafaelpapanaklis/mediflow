// «Notas internas» del caso de ortodoncia (solo-equipo): qué frase del diccionario le toca a cada código que
// contesta la API. Puro, para que la pantalla no invente el texto del error y tenga prueba.

const CLAVES: Record<string, string> = {
  TEXTO_VACIO: "ortoNotasInternas.textoVacio",
  TEXTO_LARGO: "ortoNotasInternas.textoLargo",
  SIN_CAMBIOS: "ortoNotasInternas.sinCambios",
  SIN_PERMISO: "ortoNotasInternas.sinPermiso",
  MODULE_REQUIRED: "ortoNotasInternas.sinPermiso",
  SOLO_AUTOR_O_ADMIN: "ortoNotasInternas.soloAutor",
  NO_ENCONTRADA: "ortoNotasInternas.noEncontrada",
  SIN_TABLA: "ortoNotasInternas.noDisponible",
};

export function claveDeErrorNotaInterna(codigo: unknown): string {
  return typeof codigo === "string" && Object.prototype.hasOwnProperty.call(CLAVES, codigo)
    ? CLAVES[codigo]
    : "ortoNotasInternas.errorGuardar";
}
