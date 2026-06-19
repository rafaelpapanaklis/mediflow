import type { OriginProfile } from "./origin";

// Dentalink (software dental LATAM, UI en español). Export real: módulo
// Reportes → "Pacientes" → exportar a Excel. Columnas frecuentes en es-MX.
// Instrucciones REALISTAS; mapeo plausible (verified:false hasta validar con
// un export real de una clínica).
const dentalink: OriginProfile = {
  id: "dentalink",
  name: "Dentalink",
  hasProfile: true,
  verified: false,
  instructions: [
    { h: "Entra a Dentalink", p: "Inicia sesión y abre el menú <code>Reportes</code> en la barra superior." },
    { h: "Abre el reporte de Pacientes", p: "En <code>Reportes &gt; Pacientes</code> elige el listado completo de tu clínica." },
    { h: "Exporta a Excel", p: "Pulsa <code>Exportar</code> y selecciona el formato <code>Excel (.xlsx)</code>." },
    { h: "Guarda el archivo", p: "Descárgalo a tu computadora. Lo subirás en el siguiente paso; nosotros emparejamos las columnas por ti." },
  ],
  mapping: {
    "Nombre": "firstName",
    "Nombres": "firstName",
    "Apellido": "lastName",
    "Apellidos": "lastName",
    "Celular": "phone",
    "Teléfono": "phone",
    "Correo": "email",
    "Email": "email",
    "Fecha de nacimiento": "dob",
    "Fecha nacimiento": "dob",
    "Sexo": "gender",
    "Dirección": "address",
    "RFC": "rfc",
    "Saldo": "balance",
  },
};

export default dentalink;
