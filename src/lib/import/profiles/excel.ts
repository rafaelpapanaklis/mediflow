import type { OriginProfile } from "./origin";

// "Mi Excel" — sin perfil: el usuario usa NUESTRA plantilla (3 hojas) o su
// propio archivo, y el mapeo es MANUAL en el Paso 5. Sin mapping automático.
const excel: OriginProfile = {
  id: "excel",
  name: "Mi Excel",
  hasProfile: false,
  verified: false,
  instructions: [
    { h: "Descarga la plantilla", p: "Usa la <code>Plantilla de DaleControl (.xlsx)</code>: tres pestañas — Pacientes, Saldos y Citas." },
    { h: "Pega tus datos", p: "Copia y pega tu información en las columnas indicadas, respetando los encabezados." },
    { h: "Guarda el archivo", p: "Súbelo en el siguiente paso. Si usas tu propio archivo, asegúrate de que la primera fila tenga los nombres de las columnas." },
  ],
  mapping: {},
};

export default excel;
