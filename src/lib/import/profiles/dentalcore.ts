import type { OriginProfile } from "./origin";

// DentalCore (gestión dental). Algunos exports usan UNA sola columna de nombre
// ("Paciente" / "Nombre completo") → la mapeamos a `fullName` para que el engine
// la parta; no forzamos firstName para no perder el apellido. Sin muestra real:
// mapeo plausible (verified:false).
const dentalcore: OriginProfile = {
  id: "dentalcore",
  name: "DentalCore",
  hasProfile: true,
  verified: false,
  instructions: [
    { h: "Entra a DentalCore", p: "Inicia sesión y abre la sección de <code>Pacientes</code> o <code>Reportes</code>." },
    { h: "Genera el listado de pacientes", p: "Incluye a todos los pacientes de la clínica." },
    { h: "Exporta a Excel o CSV", p: "Usa <code>Exportar</code> y elige <code>Excel</code> o <code>CSV</code>." },
    { h: "Guarda el archivo", p: "Súbelo en el siguiente paso; emparejamos las columnas por ti." },
  ],
  mapping: {
    "Paciente": "fullName",
    "Nombre completo": "fullName",
    "Nombre": "firstName",
    "Apellido": "lastName",
    "Teléfono": "phone",
    "Celular": "phone",
    "Correo": "email",
    "Email": "email",
    "Fecha de nacimiento": "dob",
    "Dirección": "address",
  },
};

export default dentalcore;
