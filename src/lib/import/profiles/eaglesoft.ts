import type { OriginProfile } from "./origin";

// Eaglesoft (Patterson Dental, US, UI en inglés). Export vía reportes / SQL
// (la base es SQL Anywhere). Sin muestra real: mapeo plausible (verified:false).
const eaglesoft: OriginProfile = {
  id: "eaglesoft",
  name: "Eaglesoft",
  hasProfile: true,
  verified: false,
  instructions: [
    { h: "Abre Eaglesoft", p: "Entra a Eaglesoft con un usuario con permisos de reportes." },
    { h: "Genera el listado de pacientes", p: "Usa el módulo de <code>Reports</code> (o el Patient List) para listar a todos tus pacientes." },
    { h: "Exporta a CSV / Excel", p: "Exporta el listado a <code>CSV</code> o <code>Excel</code> desde el visor de reportes." },
    { h: "Guarda el archivo", p: "Lo subirás en el siguiente paso; emparejamos las columnas por ti." },
  ],
  mapping: {
    "First Name": "firstName",
    "FirstName": "firstName",
    "Last Name": "lastName",
    "LastName": "lastName",
    "Phone": "phone",
    "Cell Phone": "phone",
    "Email": "email",
    "Birthdate": "dob",
    "Birth Date": "dob",
    "Address": "address",
  },
};

export default eaglesoft;
