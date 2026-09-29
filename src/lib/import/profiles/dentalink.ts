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
//  · CONFIRMADO con exports REALES de BEVADENT (28-sep-2026, ws1-t12), 4 archivos —
//    lo que cita cada mapeo marcado «BEVADENT» de abajo: 01_Pacientes (22 columnas),
//    05_Citas (38), 04_Saldos «Mora» (18), 06_Presupuestos_Detalle (41, UNA FILA POR
//    PRESTACIÓN). Todavía SIN export real: doctores, bloqueos, historial de citas,
//    odontograma, evoluciones, casos de ortodoncia, laboratorio, cuotas y aranceles.
//    Por eso `verified` sigue en false: el perfil es un solo interruptor y la mayor
//    parte de sus entidades no se ha visto con un archivo real.
//  · Lo que el perfil NO puede arreglar (necesita motor/handler, no mapeo):
//    el doctor de «05_Citas» viene PARTIDO en «Nombre Profesional Cita» + «Apellidos
//    Profesional Cita» (aquí no se mapea a `doctor`: solo el nombre no empareja con
//    «Nombre Apellido» de un usuario, y sería peor un error por fila que parar en el
//    mapeo); la duración sale de «Hora Fin Cita», que no se lee; y «Arancel» («Arancel
//    Base» en todas las filas) lo toma la autodetección genérica como `price`.
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
    // BEVADENT «01_Pacientes»: el ID que enlazan citas, saldos y presupuestos es «# Paciente».
    "# Paciente": "externalId",
    "Nombre completo": "fullName",
    "Nombre": "firstName",
    "Nombres": "firstName",
    "Apellido": "lastName",
    "Apellidos": "lastName",
    // Celular = principal (el que usa el WhatsApp); «Teléfono» (fijo) es el segundo: si no hay celular ocupa su
    // lugar y, si es otro número, va a las notas. Antes los dos iban a `phone` y ganaba el primero del archivo.
    "Celular": "phone",
    "Teléfono": "phoneAlt",
    "Correo": "email",
    "Email": "email",
    "E-mail": "email",
    "Fecha de nacimiento": "dob",
    "Fecha nacimiento": "dob",
    // BEVADENT: «Fecha de nac.» (197 de 296 con fecha; el resto trae «-» o va vacío).
    "Fecha de nac.": "dob",
    "Sexo": "gender",
    "Dirección": "address",
    "RFC": "rfc",
    // «Rut» / «Cédula identidad / DNI» (BEVADENT: 15 de 18 son CURP): el documento de identidad. Si es un CURP va a
    // curp, si es un RFC a rfcPaciente y si no, a las notas.
    "Rut": "nationalId",
    "Cédula identidad / DNI": "nationalId",
    // Resto de la ficha de BEVADENT «01_Pacientes» (las columnas sin campo en Patient NO se pierden: van a notas).
    "Tipo Paciente": "tags",
    "Convenio": "insuranceProvider",
    "Referencia": "source",
    "Alertas": "patientAlerts",
    "Ciudad": "city",
    "Comuna": "colonia",
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
    // «Tratamientos activos» (ws1-t6, 27-sep-2026): sin export real delante,
    // igual que el resto de sheetNames de este archivo — solo PROPONE.
    treatmentPlans: ["Tratamientos activos", "Presupuestos activos"],
    // Doctores/bloqueos/historial de citas (ws1-t12, 28-sep-2026): nombres de
    // archivo probables de BEVADENT (10_Usuarios_Profesionales,
    // 13_Horas_Bloqueadas, 05b_Citas_Estados_Historico). Sin export real
    // delante — solo PROPONE, igual que el resto.
    doctors: ["Usuarios Profesionales", "Profesionales", "Dentistas"],
    blockedHours: ["Horas Bloqueadas", "Bloqueos de Agenda"],
    appointmentHistory: ["Citas Estados Historico", "Historial de Citas"],
  },
  entityMappings: {
    // «Citas pacientes» (Agenda). «Hora fin» NO se mapea: la duración sale de «Duración»
    // (o 30 min por omisión) y una hora de fin mapeada a «hora» la pisaría.
    appointments: {
      "Id paciente": "patientExternalId",
      "ID Paciente": "patientExternalId",
      // BEVADENT «05_Citas» (CSV): «# Paciente» es el ID; hora en «Hora Inicio Cita»
      // (HH:MM:SS); motivo en «Motivo de Atención»; texto libre en «Comentario Cita».
      // «Nombre/Apellidos Profesional Cita» NO se mapea a `doctor` (ver arriba).
      "# Paciente": "patientExternalId",
      "Hora Inicio Cita": "time",
      "Motivo de Atención": "type",
      "Comentario Cita": "notes",
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
      // BEVADENT «04_Saldos» (reporte «Mora»): «Paciente» es un NÚMERO (el ID, el mismo
      // «# Paciente» de 01_Pacientes), no el nombre — antes se mapeaba a `name` por
      // suposición. El nombre viene en «Nombre Paciente» + «Apellidos Paciente»; la
      // deuda en «Mora».
      "Paciente": "patientExternalId",
      "Nombre paciente": "name",
      "Apellidos": "lastName",
      "Apellidos Paciente": "lastName",
      "Mora": "amount",
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
      // BEVADENT «06_Presupuestos_Detalle»: una fila por PRESTACIÓN; el presupuesto es
      // «# Tratamiento» (folio) y se genera en «Fecha de generación del tratamiento».
      // «Precio Paciente» es lo que de verdad se cobra (ya con descuento; sumado por
      // tratamiento da «Total Presupuesto» en los 157 tratamientos). «Total Presupuesto»
      // y «Total Pagos Tratamiento» se REPITEN en cada fila del tratamiento: no se mapean.
      "# Paciente": "patientExternalId",
      "Apellidos Paciente": "lastName",
      "# Tratamiento": "folio",
      "Fecha de generación del tratamiento": "date",
      "Nombre Prestación": "procedure",
      "Precio Paciente": "price",
      "Nombre Profesional Tratamiento": "doctor",
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
    // «Tratamientos activos» (ws1-t6, 27-sep-2026): mismas columnas que
    // «Prestaciones/presupuestos» arriba, más lo que distingue un tratamiento
    // EN CURSO de la historia: quién lo hizo, si ya se hizo y cuándo, y lo ya
    // abonado. Sin export real delante — igual que el resto del archivo:
    // `verified` sigue en false, y si no casan el paso de mapeo se corrige a mano.
    treatmentPlans: {
      "Id paciente": "patientExternalId",
      "ID Paciente": "patientExternalId",
      "Paciente": "name",
      "Nombre paciente": "name",
      "Celular": "phone",
      // BEVADENT «06_Presupuestos_Detalle»: mismas columnas que `quotes` (ver arriba) más
      // «Pagado Prestación» (abonado por línea). Ojo: en 8 de 157 tratamientos la suma de
      // «Pagado Prestación» NO da «Total Pagos Tratamiento» (pagos sin línea asignada).
      "# Paciente": "patientExternalId",
      "Apellidos Paciente": "lastName",
      "# Tratamiento": "folio",
      "Fecha de generación del tratamiento": "date",
      "Nombre Prestación": "procedure",
      "Precio Paciente": "price",
      "Nombre Profesional Tratamiento": "doctor",
      "Pagado Prestación": "abonado",
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
      "Profesional": "doctor",
      "Dentista": "doctor",
      "Estado prestación": "estado",
      "Estado de la prestación": "estado",
      "Fecha realización": "fechaRealizado",
      "Fecha de realización": "fechaRealizado",
      "Abonado": "abonado",
      "Monto abonado": "abonado",
      "Fecha abono": "fechaAbono",
      "Fecha de abono": "fechaAbono",
      "Próxima cita": "proximaVisita",
      "Próxima visita": "proximaVisita",
    },
    // Odontograma (ws1-t12, 28-sep-2026): Dentalink NO documenta un export de
    // odontograma en Reportes Excel ni en su API pública — no hay columnas que
    // citar. Lo de abajo son los nombres más probables si BEVADENT logra sacar
    // un listado plano (uno por pieza/cara); `verified` sigue en false y, sin
    // columna reconocida, el paso de mapeo pide emparejar a mano.
    odontogram: {
      "Id paciente": "patientExternalId",
      "ID Paciente": "patientExternalId",
      "Paciente": "name",
      "Nombre paciente": "name",
      "Celular": "phone",
      "Pieza": "tooth",
      "Diente": "tooth",
      "N° Diente": "tooth",
      "Cara": "surface",
      "Superficie": "surface",
      "Hallazgo": "condition",
      "Diagnóstico": "condition",
      "Condición": "condition",
      "Observación": "notes",
      "Notas": "notes",
    },
    // Notas de evolución de TRATAMIENTO (ws1-t12): igual que clinicalNotes,
    // más el folio del presupuesto/tratamiento al que pertenece la evolución
    // — mismo campo que treatmentPlans, para que un archivo de evoluciones
    // pueda ligar con un tratamiento activo ya importado.
    treatmentNotes: {
      "Id paciente": "patientExternalId",
      "ID Paciente": "patientExternalId",
      "Paciente": "name",
      "Nombre paciente": "name",
      "Celular": "phone",
      "N° Presupuesto": "folio",
      "Nº Presupuesto": "folio",
      "N° Tratamiento": "folio",
      "Fecha evolución": "date",
      "Fecha de evolución": "date",
      "Fecha atención": "date",
      "Profesional": "doctor",
      "Dentista": "doctor",
      "Tratamiento": "title",
      "Evolución": "text",
      "Detalle evolución": "text",
    },
    // Doctores/profesionales (ws1-t12, 28-sep-2026). FUENTE: campos del
    // endpoint /dentistas de la API pública (https://api.dentalink.
    // healthatom.com/docs/): id, rut, nombre, apellidos, celular, telefono,
    // email, id_especialidad, especialidad, habilitado. "Rut" es vocabulario
    // chileno; BEVADENT (México) probablemente exporte "Cédula" — por eso el
    // headerVariants del handler ya cubre las dos (ver doctores/handler.ts).
    // Sin export real delante: `verified` sigue en false.
    doctors: {
      "Nombre": "name",
      "Nombres": "name",
      "Apellido": "lastName",
      "Apellidos": "lastName",
      "Email": "email",
      "Correo": "email",
      "Celular": "phone",
      "Teléfono": "phone",
      "Rut": "license",
      "Cédula": "license",
      "Cédula profesional": "license",
      "Especialidad": "specialty",
      "Habilitado": "active",
    },
    // Bloqueos de agenda (ws1-t12, 28-sep-2026). FUENTE: endpoint
    // /horariosbloqueados de la API pública (mismo docs de arriba): fecha,
    // hora_inicio/inicio, hora_fin/fin, tipo ("Bloqueo"), comentario. Sin
    // export real delante: `verified` sigue en false.
    blockedHours: {
      "Dentista": "doctor",
      "Profesional": "doctor",
      "Fecha": "dateFrom",
      "Fecha inicio": "dateFrom",
      "Fecha fin": "dateTo",
      "Hora inicio": "timeFrom",
      "Hora fin": "timeTo",
      "Comentario": "reason",
      "Tipo": "reason",
    },
    // Historial de citas pasadas (ws1-t12, 28-sep-2026). FUENTE: endpoint
    // /citas/estados de la API pública (mismo docs de arriba): valores
    // confirmada/no show/anulada/atendida. Sin export real delante:
    // `verified` sigue en false.
    appointmentHistory: {
      "Id paciente": "patientExternalId",
      "ID Paciente": "patientExternalId",
      "Paciente": "name",
      "Nombre paciente": "name",
      "Celular": "phone",
      "Dentista": "doctor",
      "Nombre dentista": "doctor",
      "Fecha": "date",
      "Hora": "time",
      "Estado": "status",
      "Motivo": "type",
      "Comentario": "notes",
    },
  },
};

export default dentalink;
