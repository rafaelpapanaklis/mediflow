import type { OriginProfile } from "./origin";

// Dentalink (software dental LATAM, UI en español; vocabulario chileno).
//
// FUENTES DEL MAPEO (26-sep-2026, ws1-t6) — y sus límites:
//  · Nombres de campo de la API pública: https://api.dentalink.healthatom.com/docs/
//    Paciente: id, nombre, apellidos, rut, celular, telefono, email, ciudad, comuna,
//    direccion. Cita: id_cita, id_paciente, nombre_paciente, apellidos_paciente, fecha
//    (AAAA-MM-DD), hora_inicio (HH:MM), hora_fin, duracion, id_dentista,
//    nombre_dentista, comentario, estado, nombre_sucursal.
//  · Reportes Excel: https://ayuda.softwaredentalink.com/es/articles/9493465-reportes-excel
//    (Reportes → Reportes Excel, planes Pro y Titanium): «Citas pacientes» (Agenda),
//    «Pacientes morosos» (Pacientes), «Pagos pacientes» (Finanzas).
//  · Lo que NO está publicado: los ENCABEZADOS exactos de esos Excel. Los de abajo son
//    los de la API pasados a la forma en que un Excel los suele titular («hora_inicio» →
//    «Hora inicio»). Por eso `verified` sigue en false: sin un export real delante no
//    se puede afirmar que casen. Si no casan, el paso de mapeo pide emparejar a mano y
//    nada se rompe; la interfaz avisa de que el perfil no está validado.
const dentalink: OriginProfile = {
  id: "dentalink",
  name: "Dentalink",
  hasProfile: true,
  verified: false,
  instructions: [
    { h: "Entra a Reportes Excel", p: "En Dentalink abre <code>Reportes</code> → <code>Reportes Excel</code>. Esa función viene en los planes Pro y Titanium; si tu plan no la incluye, pide a soporte de Dentalink los listados." },
    { h: "Descarga un reporte por tipo de dato", p: "Pacientes: el listado con su ID. Citas: <code>Citas pacientes</code> (Agenda), de hoy en adelante. Saldos: <code>Pacientes morosos</code> (Pacientes)." },
    { h: "Un archivo por tipo de dato", p: "Cada reporte se sube por separado, con su propia vista previa. Pide que todos traigan el ID del paciente." },
    { h: "Revisa antes de importar", p: "Los encabezados de estos reportes aún no están validados con un export real: comprueba en la vista previa que cada columna se reconoció." },
  ],
  mapping: {
    "Id": "externalId",
    "ID": "externalId",
    "Id paciente": "externalId",
    "ID Paciente": "externalId",
    "Nombre completo": "fullName",
    "Nombre": "firstName",
    "Nombres": "firstName",
    "Apellido": "lastName",
    "Apellidos": "lastName",
    "Celular": "phone",
    "Teléfono": "phone",
    "Correo": "email",
    "Email": "email",
    "E-mail": "email",
    "Fecha de nacimiento": "dob",
    "Fecha nacimiento": "dob",
    "Sexo": "gender",
    "Dirección": "address",
    "RFC": "rfc",
    "Rut": "rfc",
    "Saldo": "balance",
  },
  // Reportes clínicos (ws1-t4, 22-sep-2026). SIN export real delante: son los
  // nombres más probables en los reportes de Dentalink (vocabulario chileno:
  // «prestación», «profesional», «N° presupuesto»). Por eso `verified` sigue en
  // false: si no casan, el paso de mapeo pide emparejar a mano y nada se rompe.
  // La autodetección genérica (headerVariants de cada entidad) ya cubre las
  // variantes comunes («Fecha», «Alergias», «Precio»…); aquí va lo propio.
  sheetNames: {
    appointments: ["Citas pacientes"],
    balances: ["Pacientes morosos"],
  },
  entityMappings: {
    // «Citas pacientes» (Agenda). «Hora fin» NO se mapea: la duración sale de «Duración»
    // (o 30 min por omisión) y una hora de fin mapeada a «hora» la pisaría.
    appointments: {
      "Id paciente": "patientExternalId",
      "ID Paciente": "patientExternalId",
      "Paciente": "name",
      "Nombre paciente": "name",
      "Apellidos paciente": "lastName",
      "Celular": "phone",
      "Email": "email",
      "Fecha": "date",
      "Fecha cita": "date",
      "Hora": "time",
      "Hora inicio": "time",
      "Duración": "duration",
      "Dentista": "doctor",
      "Nombre dentista": "doctor",
      "Profesional": "doctor",
      "Estado": "status",
      "Estado cita": "status",
      "Comentario": "notes",
      "Comentarios": "notes",
      "Motivo": "type",
      "Tratamiento": "type",
    },
    // «Pacientes morosos» (Pacientes): una fila por paciente con su deuda.
    balances: {
      "Id paciente": "patientExternalId",
      "ID Paciente": "patientExternalId",
      "Paciente": "name",
      "Nombre paciente": "name",
      "Apellidos": "lastName",
      "Celular": "phone",
      "Email": "email",
      "Deuda": "amount",
      "Deuda total": "amount",
      "Monto adeudado": "amount",
      "Saldo": "amount",
      "Saldo pendiente": "amount",
    },
    medicalHistory: {
      "Id paciente": "patientExternalId",
      "ID Paciente": "patientExternalId",
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
      "Id paciente": "patientExternalId",
      "ID Paciente": "patientExternalId",
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
      "Id paciente": "patientExternalId",
      "ID Paciente": "patientExternalId",
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
