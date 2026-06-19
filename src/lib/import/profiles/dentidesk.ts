import type { OriginProfile } from "./origin";

// Dentidesk (gestión dental, UI en español). Sin muestra real: instrucciones
// genéricas-tailored y mapeo plausible (verified:false).
const dentidesk: OriginProfile = {
  id: "dentidesk",
  name: "Dentidesk",
  hasProfile: true,
  verified: false,
  instructions: [
    { h: "Entra a Dentidesk", p: "Inicia sesión y abre la sección de <code>Pacientes</code>." },
    { h: "Abre el listado completo", p: "Muestra todos los pacientes de la clínica (sin filtros)." },
    { h: "Exporta a Excel o CSV", p: "Usa la opción <code>Exportar</code> y elige <code>Excel</code> o <code>CSV</code>." },
    { h: "Guarda el archivo", p: "Súbelo en el siguiente paso; te ayudamos a emparejar las columnas." },
  ],
  mapping: {
    "Nombre": "firstName",
    "Apellido": "lastName",
    "Apellidos": "lastName",
    "Teléfono": "phone",
    "Celular": "phone",
    "Correo": "email",
    "Email": "email",
    "Fecha de nacimiento": "dob",
    "Dirección": "address",
  },
};

export default dentidesk;
