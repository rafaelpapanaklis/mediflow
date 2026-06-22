import type { OriginProfile } from "./origin";

// Medilink (gestión clínica LATAM, UI en español). Sin export de muestra real:
// instrucciones genéricas-tailored y mapeo plausible por convención
// (verified:false). Validar contra un export real antes de marcar verificado.
const medilink: OriginProfile = {
  id: "medilink",
  name: "Medilink",
  hasProfile: true,
  verified: false,
  instructions: [
    { h: "Entra a Medilink", p: "Inicia sesión y abre la sección de <code>Pacientes</code> o <code>Reportes</code>." },
    { h: "Genera el listado", p: "Filtra «todos los pacientes» para incluir tu base completa." },
    { h: "Exporta a Excel o CSV", p: "Usa la opción <code>Exportar</code> y elige <code>Excel (.xlsx)</code> o <code>CSV</code>." },
    { h: "Guarda el archivo", p: "Lo subirás en el siguiente paso; te ayudamos a emparejar las columnas." },
  ],
  mapping: {
    "Nombre": "firstName",
    "Nombres": "firstName",
    "Apellidos": "lastName",
    "Apellido": "lastName",
    "Teléfono": "phone",
    "Celular": "phone",
    "Correo": "email",
    "Email": "email",
    "Fecha Nac": "dob",
    "Fecha de nacimiento": "dob",
    "Sexo": "gender",
    "Dirección": "address",
  },
};

export default medilink;
