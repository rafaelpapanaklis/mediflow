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
  // Reportes clínicos (ws1-t4, 22-sep-2026). SIN export real delante: son los
  // nombres más probables en los reportes de Dentalink (vocabulario chileno:
  // «prestación», «profesional», «N° presupuesto»). Por eso `verified` sigue en
  // false: si no casan, el paso de mapeo pide emparejar a mano y nada se rompe.
  // La autodetección genérica (headerVariants de cada entidad) ya cubre las
  // variantes comunes («Fecha», «Alergias», «Precio»…); aquí va lo propio.
  entityMappings: {
    medicalHistory: {
      "Paciente": "name",
      "Nombre paciente": "name",
      "Celular": "phone",
      "Email": "email",
      "Alergias": "allergies",
      "Alergia a medicamentos": "allergies",
      "Enfermedades": "chronicConditions",
      "Enfermedades sistémicas": "chronicConditions",
      "Medicamentos": "currentMedications",
      "Medicamentos que toma": "currentMedications",
      "Antecedentes familiares": "familyHistory",
      "Hábitos": "nonPathologicalHistory",
    },
    clinicalNotes: {
      "Paciente": "name",
      "Nombre paciente": "name",
      "Celular": "phone",
      "Fecha evolución": "date",
      "Fecha de evolución": "date",
      "Fecha atención": "date",
      "Profesional": "doctor",
      "Dentista": "doctor",
      "Tratamiento": "title",
      "Evolución": "text",
      "Detalle evolución": "text",
    },
    quotes: {
      "Paciente": "name",
      "Nombre paciente": "name",
      "Celular": "phone",
      "N° Presupuesto": "folio",
      "Nº Presupuesto": "folio",
      "N° Tratamiento": "folio",
      "Fecha creación": "date",
      "Fecha presupuesto": "date",
      "Tratamiento": "title",
      "Nombre tratamiento": "title",
      "Prestación": "procedure",
      "Prestaciones": "procedure",
      "Pieza": "tooth",
      "Diente": "tooth",
      "Valor": "price",
      "Valor unitario": "price",
      "Dcto.": "discount",
      "Descuento": "discount",
      "Total": "total",
      "Estado": "status",
      "Profesional": "doctor",
    },
  },
};

export default dentalink;
