/**
 * Catálogos SAT para CFDI 4.0 (client-safe).
 *
 * Se separan de `facturapi.ts` porque ese módulo lee process.env.FACTURAPI_USER_KEY
 * en scope de módulo y contiene la lógica de red hacia Facturapi — no debe entrar al
 * bundle del cliente. Estos catálogos son constantes puras y pueden importarse tanto
 * en el servidor como en componentes "use client". `facturapi.ts` los re-exporta para
 * no romper los imports server-side existentes.
 */

// Claves SAT para servicios médicos.
// OJO: usar claves HOJA del catálogo c_ClaveProdServ. Las terminadas en 00 son
// a veces solo "clase" no facturable (85101500 no existe como clave → Facturapi
// respondía "No se encontró la clave de producto o servicio"). 85121502
// (medicina general) y 85121600 (especialistas) están confirmadas en Anexo 20.
export const CLAVES_SAT_MEDICOS = {
  // Servicios médicos generales
  consulta:        { clave: "85121502", descripcion: "Servicios de consulta médica general" },
  dental:          { clave: "85121600", descripcion: "Servicios médicos especializados (odontología)" },
  psicologia:      { clave: "85121600", descripcion: "Servicios médicos especializados (psicología)" },
  nutricion:       { clave: "85121600", descripcion: "Servicios médicos especializados (nutrición)" },
  laboratorio:     { clave: "85121600", descripcion: "Servicios médicos especializados (laboratorio)" },
  radiologia:      { clave: "85121600", descripcion: "Servicios médicos especializados (radiología)" },
  cirugia:         { clave: "85121600", descripcion: "Servicios médicos especializados (cirugía)" },
  otro:            { clave: "85121502", descripcion: "Servicios médicos" },
};

export const UNIDAD_SAT = "E48"; // Unidad de servicio

export const REGIMENES_FISCALES = [
  { clave: "601", descripcion: "General de Ley Personas Morales" },
  { clave: "603", descripcion: "Personas Morales con Fines no Lucrativos" },
  { clave: "605", descripcion: "Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { clave: "606", descripcion: "Arrendamiento" },
  { clave: "607", descripcion: "Régimen de Enajenación o Adquisición de Bienes" },
  { clave: "608", descripcion: "Demás ingresos" },
  { clave: "610", descripcion: "Residentes en el Extranjero sin Establecimiento Permanente en México" },
  { clave: "611", descripcion: "Ingresos por Dividendos (socios y accionistas)" },
  { clave: "612", descripcion: "Personas Físicas con Actividades Empresariales y Profesionales" },
  { clave: "614", descripcion: "Ingresos por intereses" },
  { clave: "615", descripcion: "Régimen de los ingresos por obtención de premios" },
  { clave: "616", descripcion: "Sin obligaciones fiscales" },
  { clave: "621", descripcion: "Incorporación Fiscal" },
  { clave: "622", descripcion: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras" },
  { clave: "623", descripcion: "Opcional para Grupos de Sociedades" },
  { clave: "624", descripcion: "Coordinados" },
  { clave: "625", descripcion: "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas" },
  { clave: "626", descripcion: "Régimen Simplificado de Confianza" },
];

export const USOS_CFDI = [
  { clave: "G03", descripcion: "Gastos en general" },
  { clave: "D01", descripcion: "Honorarios médicos, dentales y gastos hospitalarios" },
  { clave: "D02", descripcion: "Gastos médicos por incapacidad o discapacidad" },
  { clave: "D04", descripcion: "Donativos" },
  { clave: "D07", descripcion: "Primas por seguros de gastos médicos" },
  { clave: "S01", descripcion: "Sin efectos fiscales" },
  { clave: "CP01", descripcion: "Pagos" },
];
