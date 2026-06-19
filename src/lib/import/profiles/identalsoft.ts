import type { OriginProfile } from "./origin";

// iDentalSoft (nube, US/LATAM). Sin export de muestra real: instrucciones
// genéricas-tailored y mapeo plausible (verified:false).
const identalsoft: OriginProfile = {
  id: "identalsoft",
  name: "iDentalSoft",
  hasProfile: true,
  verified: false,
  instructions: [
    { h: "Entra a iDentalSoft", p: "Inicia sesión y abre el módulo de <code>Patients</code> / <code>Pacientes</code>." },
    { h: "Abre reportes", p: "Busca <code>Reports</code> y el listado de pacientes de tu consultorio." },
    { h: "Exporta a Excel o CSV", p: "Usa <code>Export</code> y elige <code>Excel</code> o <code>CSV</code>." },
    { h: "Guarda el archivo", p: "Lo subirás en el siguiente paso; emparejamos las columnas por ti." },
  ],
  mapping: {
    "First Name": "firstName",
    "Nombre": "firstName",
    "Last Name": "lastName",
    "Apellido": "lastName",
    "Cell": "phone",
    "Celular": "phone",
    "Phone": "phone",
    "Email": "email",
    "Correo": "email",
    "Birth Date": "dob",
    "Nacimiento": "dob",
    "Address": "address",
  },
};

export default identalsoft;
