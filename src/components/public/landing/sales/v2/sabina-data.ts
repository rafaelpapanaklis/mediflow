/**
 * Sabina en la landing: las 7 preguntas de ejemplo y sus respuestas.
 *
 * TODO lo de aquí sale de material/sabina-y-whatsapp.md (datos de la clínica
 * de prueba, coherentes entre sí y comprobados contra src/lib/sabina/). No se
 * inventa ninguna cifra ni ninguna capacidad: si no está en el material, no
 * está aquí. El «Miré: …» es la traza real de herramientas que enseña el panel.
 */

export interface SabinaFila {
  label: string;
  value: string;
}

export type SabinaRespuesta =
  | {
      kind: "lista";
      /** Frase de arriba, con la cifra total. */
      lead: string;
      rows: SabinaFila[];
      /** Frase corta debajo de las filas, opcional. */
      foot?: string;
    }
  | {
      kind: "propuesta";
      frase: string;
      detalles: SabinaFila[];
      confirmar: string;
      cancelar: string;
      nota: string;
      /** Frase del servidor cuando la acción se confirmó. */
      hecha: string;
    };

export interface SabinaEjemplo {
  id: string;
  /** Lo que teclea el doctor. */
  q: string;
  /** Etiqueta corta para la píldora. */
  chip: string;
  a: SabinaRespuesta;
  /** Traza real: qué herramientas corrió el servidor. */
  mire: string;
}

export const SABINA_EJEMPLOS: SabinaEjemplo[] = [
  {
    id: "deben",
    q: "¿Cuánto me deben este mes?",
    chip: "¿Cuánto me deben?",
    a: {
      kind: "lista",
      lead: "Te deben $13,650 entre 4 pacientes, sin vencidos:",
      rows: [
        { label: "Camila Sánchez Rubio", value: "$9,000" },
        { label: "Arturo Reyes Pérez", value: "$2,250" },
        { label: "Alejandra Cruz Reyes", value: "$1,500" },
        { label: "Roberto Sánchez Domínguez", value: "$900" },
      ],
    },
    mire: "pacientes con deuda",
  },
  {
    id: "huecos",
    q: "¿Qué días tengo huecos la próxima semana?",
    chip: "¿Qué días tengo huecos?",
    a: {
      kind: "lista",
      lead: "La agenda de la próxima semana va al 61 %:",
      rows: [
        { label: "Lunes", value: "72 %" },
        { label: "Martes", value: "34 %" },
        { label: "Miércoles", value: "58 %" },
        { label: "Jueves", value: "94 %" },
        { label: "Viernes", value: "47 %" },
      ],
      foot: "Martes y viernes son los días con más espacio.",
    },
    mire: "ocupación de la agenda",
  },
  {
    id: "llamar",
    q: "¿A quién debería llamar hoy?",
    chip: "¿A quién llamo hoy?",
    a: {
      kind: "lista",
      lead: "Tienes $47,400 en el aire:",
      rows: [
        { label: "8 facturas emitidas sin cobrar", value: "$22,100" },
        { label: "5 tratamientos aceptados sin agendar", value: "$18,300" },
        { label: "3 presupuestos sin respuesta", value: "$7,000" },
        { label: "2 pidieron cita y nadie contestó", value: "—" },
      ],
    },
    mire: "oportunidades perdidas",
  },
  {
    id: "tratamiento",
    q: "¿Qué tratamiento me deja más dinero?",
    chip: "¿Qué me deja más dinero?",
    a: {
      kind: "lista",
      lead: "Por ingreso, este es el orden:",
      rows: [
        { label: "Endodoncia", value: "$31,200 · 31 %" },
        { label: "Ortodoncia", value: "$24,800 · 25 %" },
        { label: "Resina", value: "$16,400 · 16 %" },
        { label: "Limpieza", value: "$11,900 · 12 %" },
      ],
    },
    mire: "tratamientos por ingreso",
  },
  {
    id: "fallos",
    q: "¿Cuánta gente me falló este mes?",
    chip: "¿Cuánta gente me falló?",
    a: {
      kind: "lista",
      lead: "14 de 182 citas no llegaron (7.7 %). Quienes más faltan:",
      rows: [
        { label: "Jorge Medina Cano", value: "3 faltas" },
        { label: "Lucía Fernández Gil", value: "2 faltas" },
        { label: "Marco Antonio Ruiz", value: "2 faltas" },
      ],
    },
    mire: "ausencias",
  },
  {
    id: "cumple",
    q: "¿Quién cumple años esta semana?",
    chip: "¿Quién cumple años?",
    a: {
      kind: "lista",
      lead: "Cuatro pacientes cumplen años esta semana:",
      rows: [
        { label: "Sofía Cruz Rubio", value: "jue · 34" },
        { label: "Pedro Almazán Ruiz", value: "vie · 51" },
        { label: "Ana Lilia Torres", value: "sáb · 28" },
        { label: "Diego Herrera Paz", value: "dom · 9" },
      ],
    },
    mire: "cumpleaños",
  },
  {
    id: "agendar",
    q: "Agéndame a Ana Pérez el jueves a las 10 con el Dr. Salas",
    chip: "Agéndame a Ana Pérez el jueves…",
    a: {
      kind: "propuesta",
      frase: "Agendar a Ana Pérez Solís el jueves 26 a las 10:00 con el Dr. Salas",
      detalles: [
        { label: "Paciente", value: "Ana Pérez Solís · P0117" },
        { label: "Doctor", value: "Dr. Salas" },
        { label: "Cuándo", value: "jueves 26 · 10:00" },
        { label: "Duración", value: "45 min" },
        { label: "Sillón", value: "Sillón 2" },
      ],
      confirmar: "Sí, agendar",
      cancelar: "Cancelar",
      nota: "Se puede cancelar después desde la agenda.",
      hecha: "Cita agendada: Ana Pérez Solís, jueves 26 · 10:00, Dr. Salas, Sillón 2.",
    },
    mire: "búsqueda de paciente, equipo de la clínica, horas libres",
  },
];

/** Lo que Sabina es de verdad (material verificado). */
export const SABINA_COPY = {
  eyebrow: "Sabina · dentro del panel",
  title: "Pregúntale a tu clínica como le preguntarías a tu recepcionista",
  subtitle:
    "Sabina lee los datos reales de tu clínica y contesta en unos dos segundos, con cifras y con la lista de lo que miró para llegar ahí. Vive en el panel, junto a la agenda y la caja.",
  facts: [
    { t: "26 consultas de solo lectura", d: "Deudas, huecos, ausencias, ingresos por tratamiento, cumpleaños, oportunidades perdidas…" },
    { t: "7 acciones que propone, nunca ejecuta", d: "Agendar, reagendar, cancelar, registrar paciente, cobrar o crear factura, avisar saldo por WhatsApp. Siempre con tarjeta y botón." },
    { t: "«Miré: …» debajo de cada respuesta", d: "No lo escribe el modelo: es la traza real de lo que consultó el servidor." },
    { t: "No puede más que tú", d: "Hereda los permisos de quien le escribe. El administrador se los recorta o la apaga." },
    { t: "No inventa cifras", d: "Si no tiene herramienta para saberlo, lo dice. No receta, no timbra, no reembolsa." },
    { t: "En todos los planes", d: "Se paga con Saldo de IA, también en el plan Básico." },
  ],
  pie: "Sabina propone; nada se hace hasta que tú lo confirmas en la tarjeta.",
};
