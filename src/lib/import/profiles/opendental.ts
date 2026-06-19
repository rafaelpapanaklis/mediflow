import type { OriginProfile } from "./origin";

// Open Dental (open-source, US, UI en inglés). Export real: ventana Query
// (Tools/Setup → Query) corriendo un SELECT sobre `patient`, botón "Export"
// a CSV; o Reports estándar. Las columnas crudas son nombres de la tabla
// `patient` (LName, FName, WirelessPhone, Birthdate…). Instrucciones REALISTAS;
// mapeo plausible (verified:false hasta validar con un export real).
const opendental: OriginProfile = {
  id: "opendental",
  name: "Open Dental",
  hasProfile: true,
  verified: false,
  instructions: [
    { h: "Abre la herramienta Query", p: "En Open Dental entra a <code>Tools &gt; Query</code> (o <code>Reports &gt; Query</code> según tu versión)." },
    { h: "Lista tus pacientes", p: "Ejecuta una consulta del listado de pacientes, por ejemplo <code>SELECT * FROM patient</code>, y espera los resultados." },
    { h: "Exporta a CSV", p: "Pulsa <code>Export</code> y guarda el resultado como archivo <code>.csv</code>." },
    { h: "Guarda el archivo", p: "Lo subirás en el siguiente paso. Reconocemos las columnas crudas de Open Dental (FName, LName, etc.) automáticamente." },
  ],
  mapping: {
    "FName": "firstName",
    "FirstName": "firstName",
    "LName": "lastName",
    "LastName": "lastName",
    "WirelessPhone": "phone",
    "HmPhone": "phone",
    "Email": "email",
    "EMail": "email",
    "Birthdate": "dob",
    "Gender": "gender",
    "Address": "address",
  },
};

export default opendental;
