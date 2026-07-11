/**
 * Catálogos SAT para CFDI 4.0 (client-safe).
 *
 * Se separan de `facturapi.ts` porque ese módulo lee process.env.FACTURAPI_USER_KEY
 * en scope de módulo y contiene la lógica de red hacia Facturapi — no debe entrar al
 * bundle del cliente. Estos catálogos son constantes puras y pueden importarse tanto
 * en el servidor como en componentes "use client". `facturapi.ts` los re-exporta para
 * no romper los imports server-side existentes.
 */

// Claves SAT para servicios médicos
export const CLAVES_SAT_MEDICOS = {
  // Servicios médicos generales
  consulta:        { clave: "85101500", descripcion: "Servicios de consulta médica" },
  dental:          { clave: "85121500", descripcion: "Servicios de odontología" },
  psicologia:      { clave: "85122200", descripcion: "Servicios de psicología" },
  nutricion:       { clave: "85181600", descripcion: "Servicios de nutriología" },
  laboratorio:     { clave: "85101700", descripcion: "Servicios de laboratorio clínico" },
  radiologia:      { clave: "85101800", descripcion: "Servicios de radiología" },
  cirugia:         { clave: "85102200", descripcion: "Servicios quirúrgicos" },
  otro:            { clave: "85101500", descripcion: "Servicios médicos" },
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
