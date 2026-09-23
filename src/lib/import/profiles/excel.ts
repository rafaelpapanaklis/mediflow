import type { OriginProfile } from "./origin";

// "Mi Excel" — sin perfil: el usuario usa NUESTRA plantilla (una hoja por tipo
// de dato) o su propio archivo. Sin mapping de perfil: la autodetección genérica
// (headerVariants de cada entidad) reconoce los encabezados de la plantilla, y
// el Paso 5 deja corregir a mano lo que no reconozca.
const excel: OriginProfile = {
  id: "excel",
  name: "Mi Excel",
  hasProfile: false,
  verified: false,
  instructions: [
    { h: "Descarga la plantilla", p: "Usa la <code>Plantilla de DaleControl (.xlsx)</code>: una pestaña por tipo de dato — Pacientes, Saldos, Citas, Expedientes, Notas y Presupuestos." },
    { h: "Pega tus datos", p: "Copia y pega tu información en las columnas indicadas, respetando los encabezados." },
    { h: "Guarda el archivo", p: "Súbelo en el siguiente paso. Si usas tu propio archivo, asegúrate de que la primera fila tenga los nombres de las columnas." },
  ],
  mapping: {},
};

export default excel;
