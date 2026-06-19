import type { OriginProfile } from "./origin";

// "Otro" — sistema no listado, sin perfil: exporta como puedas (Excel/CSV) y
// el mapeo es MANUAL en el Paso 5. Si el export es complejo, el usuario puede
// usar la Migración asistida (subir respaldo y que el equipo lo migre).
const otro: OriginProfile = {
  id: "otro",
  name: "Otro",
  hasProfile: false,
  verified: false,
  instructions: [
    { h: "Abre tu sistema actual", p: "Entra a la sección de pacientes o reportes de tu software." },
    { h: "Busca «Exportar»", p: "La mayoría de los sistemas exportan a <code>Excel (.xlsx)</code> o <code>CSV</code>." },
    { h: "Exporta todos los registros", p: "Selecciona el rango completo y descarga el archivo." },
    { h: "¿Export complejo?", p: "Si tu archivo no tiene encabezados claros o es un respaldo, usa la <code>Migración asistida</code>: lo subes y el equipo lo migra por ti." },
  ],
  mapping: {},
};

export default otro;
