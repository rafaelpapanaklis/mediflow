/**
 * WS1-T4 ronda 6 · G5 — textos POR DEFECTO de la página pública según el giro.
 *
 * Las plantillas nacieron con frases de consultorio médico («Equipo médico»,
 * «…para tu salud y bienestar»). Una clínica DENTAL ve su versión dental; las
 * demás categorías ven EXACTAMENTE el literal de siempre.
 *
 * Solo toca el texto POR DEFECTO (el `porDefecto` de <Txt>): si la clínica
 * escribió el suyo, <Txt> pinta el suyo y esta función ni se entera.
 *
 * Archivo puro y mínimo a propósito: viaja al navegador del paciente dentro de
 * la plantilla, así que no importa el manifiesto ni nada más.
 */

/** literal de la plantilla → su versión para clínicas dentales. */
const VERSION_DENTAL: Readonly<Record<string, string>> = {
  "Equipo médico": "Nuestro equipo",
  "Tratamientos con tecnología de vanguardia para tu salud y bienestar":
    "Tratamientos con tecnología de vanguardia para tu salud bucal",
  "Profesionales certificados comprometidos con tu salud":
    "Profesionales certificados comprometidos con tu salud bucal",
};

/**
 * El texto por defecto que le toca a la clínica.
 *
 * @param categoria `Clinic.category` tal como la leyó el SERVIDOR de la base.
 * @param literal   el texto por defecto de la plantilla / del manifiesto.
 */
export function porDefectoSegunGiro(categoria: string | null | undefined, literal: string): string {
  if (categoria !== "DENTAL") return literal;
  return VERSION_DENTAL[literal] ?? literal;
}
