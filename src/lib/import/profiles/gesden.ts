import type { OriginProfile } from "./origin";

// Gesden (Henry Schein, España, UI en español). Export vía listados/informes a
// Excel. Documento fiscal en España = NIF/DNI (lo mapeamos al slot `rfc`, que es
// el identificador fiscal del paciente en DaleControl). Sin muestra real:
// mapeo plausible (verified:false).
const gesden: OriginProfile = {
  id: "gesden",
  name: "Gesden",
  hasProfile: true,
  verified: false,
  instructions: [
    { h: "Entra a Gesden", p: "Abre Gesden y ve a la sección de <code>Pacientes</code> o <code>Listados</code>." },
    { h: "Genera el listado de pacientes", p: "Crea el informe con todos los pacientes de la clínica." },
    { h: "Exporta a Excel", p: "Usa <code>Exportar a Excel</code> desde el visor del listado." },
    { h: "Guarda el archivo", p: "Súbelo en el siguiente paso; te ayudamos a emparejar las columnas." },
  ],
  mapping: {
    "Nombre": "firstName",
    "Apellidos": "lastName",
    "Apellido": "lastName",
    "Teléfono": "phone",
    "Móvil": "phone",
    "Email": "email",
    "Correo": "email",
    "F. Nacimiento": "dob",
    "Fecha de nacimiento": "dob",
    "Sexo": "gender",
    "Domicilio": "address",
    "NIF": "rfc",
    "DNI": "rfc",
  },
};

export default gesden;
