import type { OriginProfile } from "./origin";

// Dentrix (Henry Schein, US, UI en inglés). Export típico vía Office Manager /
// Letters & Lists a un archivo de datos, o módulos de reporting de terceros.
// Sin muestra real: mapeo plausible en inglés (verified:false).
const dentrix: OriginProfile = {
  id: "dentrix",
  name: "Dentrix",
  hasProfile: true,
  verified: false,
  instructions: [
    { h: "Abre Office Manager", p: "En Dentrix entra a <code>Office Manager</code>." },
    { h: "Letters &amp; Lists", p: "Usa <code>Letters &amp; Lists</code> para generar la lista de pacientes con los campos que quieras exportar." },
    { h: "Exporta el archivo de datos", p: "Genera el <code>data file</code> (CSV) del listado de pacientes." },
    { h: "Guarda el archivo", p: "Súbelo en el siguiente paso; te ayudamos a emparejar las columnas." },
  ],
  mapping: {
    "First Name": "firstName",
    "FirstName": "firstName",
    "Last Name": "lastName",
    "LastName": "lastName",
    "Home Phone": "phone",
    "Cell Phone": "phone",
    "Phone": "phone",
    "E-mail": "email",
    "Email": "email",
    "Birth Date": "dob",
    "Birthday": "dob",
    "Address": "address",
  },
};

export default dentrix;
