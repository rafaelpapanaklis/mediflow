// N-63 (ws1-t8, segunda auditoría de uso): Configuración › Mi clínica ofrecía
// las zonas con un GMT escrito a mano («New York (GMT-5)», «Madrid (GMT+1)»)
// que en horario de verano era falso (hoy -4 y +2) y con dos separadores
// distintos (« - » y « / »). Ahora el desfase sale de Intl para la fecha en que
// se mira, y todas dicen «Ciudad, región».

export const ZONAS_HORARIAS: ReadonlyArray<{ id: string; nombre: string }> = [
  { id: "America/Mexico_City", nombre: "Ciudad de México" },
  { id: "America/Cancun", nombre: "Cancún, Quintana Roo" },
  { id: "America/Merida", nombre: "Mérida, Yucatán" },
  { id: "America/Monterrey", nombre: "Monterrey, Nuevo León" },
  { id: "America/Hermosillo", nombre: "Hermosillo, Sonora" },
  { id: "America/Mazatlan", nombre: "Mazatlán, Sinaloa" },
  { id: "America/Tijuana", nombre: "Tijuana, Baja California" },
  { id: "America/Bogota", nombre: "Bogotá, Colombia" },
  { id: "America/Lima", nombre: "Lima, Perú" },
  { id: "America/Guatemala", nombre: "Guatemala" },
  { id: "America/Costa_Rica", nombre: "Costa Rica" },
  { id: "America/Santo_Domingo", nombre: "Santo Domingo, República Dominicana" },
  { id: "America/Caracas", nombre: "Caracas, Venezuela" },
  { id: "America/La_Paz", nombre: "La Paz, Bolivia" },
  { id: "America/Asuncion", nombre: "Asunción, Paraguay" },
  { id: "America/Santiago", nombre: "Santiago, Chile" },
  { id: "America/Buenos_Aires", nombre: "Buenos Aires, Argentina" },
  { id: "America/Montevideo", nombre: "Montevideo, Uruguay" },
  { id: "America/Sao_Paulo", nombre: "São Paulo, Brasil" },
  { id: "Europe/Madrid", nombre: "Madrid, España" },
  { id: "America/New_York", nombre: "Nueva York, EE. UU. (Este)" },
  { id: "America/Los_Angeles", nombre: "Los Ángeles, EE. UU. (Pacífico)" },
];

/** «GMT-6» para esa zona en esa fecha (con horario de verano si aplica). */
export function desfaseDeZona(id: string, fecha: Date = new Date()): string {
  try {
    const parte = new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: "shortOffset" })
      .formatToParts(fecha)
      .find((p) => p.type === "timeZoneName");
    const v = parte?.value ?? "";
    return v === "GMT" ? "GMT+0" : v;
  } catch {
    return "";
  }
}

/** La etiqueta del selector: «Madrid, España (GMT+2)». */
export function etiquetaDeZona(id: string, nombre: string, fecha: Date = new Date()): string {
  const d = desfaseDeZona(id, fecha);
  return d ? `${nombre} (${d})` : nombre;
}
