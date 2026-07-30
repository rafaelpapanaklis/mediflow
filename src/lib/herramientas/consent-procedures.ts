// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de procedimientos del generador de consentimiento informado.
//
// PRUDENCIA DELIBERADA: la descripción está en términos generales y los riesgos
// son los frecuentes y ampliamente documentados de cada procedimiento, no una
// lista clínica exhaustiva. El formato que sale de aquí es una BASE que el doctor
// tratante tiene que revisar, completar y validar para el caso concreto — y así
// lo dice el disclaimer en la página, en la herramienta y en el propio documento.
//
// Data estática y pura: la importa el componente cliente, no toca BD ni API.
// ─────────────────────────────────────────────────────────────────────────────

export type ConsentProcedure = {
  key: string;
  /** Etiqueta del <select> y nombre que se imprime en el documento. */
  label: string;
  /** En qué consiste, en términos generales y sin tecnicismos. */
  description: string;
  /** Molestias y riesgos FRECUENTES, genéricos del procedimiento. */
  risks: string[];
  /** Alternativas al procedimiento (la de no tratar se agrega aparte, siempre). */
  alternatives: string[];
  /** Qué se espera del paciente para que el resultado sea el previsto. */
  care: string[];
};

export const CONSENT_PROCEDURES: ConsentProcedure[] = [
  {
    key: "extraccion-simple",
    label: "Extracción dental simple",
    description:
      "La extracción consiste en retirar por completo un diente o una raíz del hueso donde está alojado. Se realiza con anestesia local: el diente se afloja con instrumentos y se retira, y en algunos casos se colocan puntos de sutura para ayudar a que la encía cierre.",
    risks: [
      "Dolor, inflamación y moretón en la zona durante los primeros días.",
      "Sangrado del sitio, que puede requerir volver al consultorio si no cede con las indicaciones dadas.",
      "Inflamación o infección del hueco del diente (alveolitis), que suele aparecer entre el segundo y el cuarto día.",
      "Molestia al masticar o dificultad para abrir la boca por completo durante algunos días.",
      "Necesidad de una visita adicional para revisión o para retirar los puntos.",
    ],
    alternatives: [
      "Intentar conservar el diente cuando todavía es viable, por ejemplo con endodoncia y una restauración.",
      "Rehabilitar el espacio después de la extracción con prótesis, puente o implante.",
    ],
    care: [
      "Seguir las indicaciones de reposo, alimentación y medicamentos que se te entreguen.",
      "Evitar fumar, enjuagarse con fuerza y usar popote los primeros días.",
      "Avisar al consultorio si el sangrado, el dolor o la inflamación aumentan en lugar de disminuir.",
    ],
  },
  {
    key: "extraccion-tercer-molar",
    label: "Extracción de tercer molar (muela del juicio)",
    description:
      "El tercer molar puede estar cubierto total o parcialmente por encía y hueso. Para retirarlo se separa la encía y, según el caso, se retira algo de hueso y se divide la muela en fragmentos para sacarla con el menor esfuerzo posible. Casi siempre se colocan puntos de sutura.",
    risks: [
      "Inflamación de la cara y dificultad para abrir la boca durante los primeros días, en general más marcadas que en una extracción simple.",
      "Dolor y sangrado en la zona operada.",
      "Inflamación o infección del sitio (alveolitis), que puede requerir tratamiento adicional.",
      "Alteración temporal de la sensibilidad del labio, el mentón, la lengua o las encías por la cercanía de los nervios de la zona; en casos poco frecuentes puede prolongarse o ser permanente.",
      "En molares superiores, comunicación con el seno maxilar, que puede requerir cuidados o tratamiento adicionales.",
      "Cuando una raíz está muy cerca de un nervio, en ocasiones es más seguro dejar un fragmento en su lugar y vigilarlo que retirarlo.",
    ],
    alternatives: [
      "Mantener la muela en observación con revisiones y radiografías periódicas, cuando no está dando síntomas ni daño a los dientes vecinos.",
      "Tratar únicamente la causa de la molestia (por ejemplo, la inflamación de la encía) y reevaluar después.",
    ],
    care: [
      "Aplicar frío, reposo y los medicamentos indicados durante los primeros días.",
      "Mantener una dieta blanda y fría mientras haya inflamación.",
      "Acudir a la revisión posterior y avisar de inmediato si aparece fiebre, mal sabor persistente o el dolor aumenta después del tercer día.",
    ],
  },
  {
    key: "endodoncia",
    label: "Endodoncia (tratamiento de conductos)",
    description:
      "La endodoncia retira el tejido inflamado o infectado del interior del diente, limpia y desinfecta los conductos y los rellena con un material sellador. El objetivo es conservar el diente en la boca; puede realizarse en una o en varias sesiones.",
    risks: [
      "Sensibilidad o molestia al morder durante algunos días después de cada sesión.",
      "Necesidad de más sesiones de las previstas si la anatomía del diente es compleja o la infección es extensa.",
      "Posibilidad de que un instrumento se fracture dentro del conducto, o de que un conducto muy calcificado no pueda recorrerse por completo.",
      "Persistencia de la infección, que puede requerir un retratamiento o una cirugía apical.",
      "El diente queda más frágil: puede fracturarse si no se restaura a tiempo, y en algunos casos la fractura obliga a extraerlo.",
      "Cambio de color del diente con el paso del tiempo.",
    ],
    alternatives: [
      "Extraer el diente y rehabilitar después el espacio con prótesis, puente o implante.",
      "En casos seleccionados, tratamientos para conservar la vitalidad del diente cuando el daño aún es limitado.",
    ],
    care: [
      "Acudir a todas las sesiones programadas y no dejar el tratamiento a medias.",
      "Completar la restauración definitiva (con frecuencia una corona) en el plazo que te indique el doctor.",
      "Evitar masticar del lado tratado mientras el diente esté con relleno provisional.",
    ],
  },
  {
    key: "resina",
    label: "Resina (obturación)",
    description:
      "La resina restaura un diente afectado por caries o desgaste. Se retira el tejido dañado, se prepara la cavidad y se coloca el material por capas, se endurece con luz y se pule para ajustar la forma y la mordida.",
    risks: [
      "Sensibilidad al frío, al calor o al morder durante los primeros días o semanas.",
      "Necesidad de ajustar la mordida en una visita posterior.",
      "Cambio de color, desgaste o desprendimiento del material con el paso del tiempo, según el uso y la higiene.",
      "Si la caries resulta más profunda de lo que mostraba la radiografía, puede ser necesario un tratamiento adicional como una endodoncia o una restauración más amplia.",
      "En dientes muy destruidos, la resina puede no ser suficiente y requerirse una incrustación o una corona.",
    ],
    alternatives: [
      "Incrustación o corona cuando la pérdida de estructura del diente es grande.",
      "En lesiones muy iniciales, medidas preventivas y vigilancia con revisiones periódicas.",
    ],
    care: [
      "Mantener la higiene diaria y el uso de hilo dental en la zona restaurada.",
      "Evitar morder objetos duros con el diente tratado.",
      "Acudir a revisiones periódicas para detectar desgaste o filtraciones a tiempo.",
    ],
  },
  {
    key: "corona",
    label: "Corona dental",
    description:
      "La corona es una cubierta que envuelve el diente para devolverle forma, función y resistencia. El diente se prepara reduciendo parte de su superficie, se toma un registro o escaneo, se coloca una corona provisional y en una segunda cita se cementa la definitiva.",
    risks: [
      "Sensibilidad del diente preparado, sobre todo al frío, mientras se usa la corona provisional.",
      "Desprendimiento o fractura de la corona provisional, que requiere volver al consultorio.",
      "Necesidad de ajustes de color, forma o mordida antes o después del cementado.",
      "Posibilidad de que el diente requiera endodoncia si presenta inflamación tras la preparación.",
      "Descementado o fractura de la corona definitiva con el uso, en especial si se mastican objetos duros o hay bruxismo.",
      "Inflamación de la encía alrededor de la corona si no se mantiene una buena higiene.",
    ],
    alternatives: [
      "Restauración parcial (resina o incrustación) cuando queda suficiente estructura sana.",
      "Extracción y rehabilitación posterior del espacio, si el diente no es recuperable.",
    ],
    care: [
      "Cuidar la corona provisional y evitar alimentos pegajosos mientras la traes.",
      "Usar hilo dental o cepillos interdentales alrededor de la corona todos los días.",
      "Usar guarda oclusal si el doctor la indica por bruxismo.",
    ],
  },
  {
    key: "implante",
    label: "Implante dental",
    description:
      "El implante es un tornillo de titanio que se coloca en el hueso para sustituir la raíz de un diente perdido. Después de un periodo de espera, para que el hueso se una al implante, se coloca sobre él la corona o la prótesis definitiva. El tratamiento se realiza en varias etapas y a lo largo de varios meses.",
    risks: [
      "Inflamación, dolor y moretón en la zona durante los primeros días.",
      "Infección del sitio quirúrgico.",
      "Que el implante no llegue a unirse al hueso y deba retirarse, esperar y volver a intentarlo.",
      "Necesidad de un injerto de hueso o de encía, en la misma cirugía o en una posterior, si el volumen disponible no es suficiente.",
      "Alteración temporal de la sensibilidad del labio, el mentón o la lengua por la cercanía de los nervios; en casos poco frecuentes puede prolongarse.",
      "Tiempos de espera de varios meses antes de la corona definitiva, durante los cuales puede usarse una solución provisional.",
      "Pérdida del implante a mediano o largo plazo si hay tabaquismo, higiene deficiente, bruxismo o enfermedades sistémicas sin control.",
    ],
    alternatives: [
      "Prótesis fija sobre los dientes vecinos (puente).",
      "Prótesis removible, parcial o total.",
      "Mantener el espacio sin rehabilitar, asumiendo el movimiento de los dientes vecinos y la pérdida de hueso de la zona.",
    ],
    care: [
      "No fumar durante el periodo de cicatrización: el tabaco es uno de los factores que más comprometen el resultado.",
      "Seguir las indicaciones de higiene, dieta y medicamentos, y acudir a todas las citas de control.",
      "Mantener bajo control las enfermedades generales (por ejemplo la diabetes) e informar de cualquier cambio en tus medicamentos.",
    ],
  },
  {
    key: "limpieza-profunda",
    label: "Limpieza profunda (raspado y alisado radicular)",
    description:
      "La limpieza profunda retira el sarro y la placa que se acumularon por debajo de la encía, en la superficie de la raíz. Suele realizarse por zonas y en más de una sesión, con anestesia local cuando hace falta, para tratar la inflamación de las encías y detener la pérdida de soporte.",
    risks: [
      "Sensibilidad de los dientes al frío durante días o semanas después del tratamiento.",
      "Encías adoloridas y sangrado leve los primeros días.",
      "Sensación de que los dientes se ven más largos o de que aparecen espacios entre ellos: es la encía que se desinflama y recupera su posición real.",
      "Ligera movilidad temporal de algunos dientes mientras la inflamación cede.",
      "Necesidad de varias sesiones, de mantenimiento periódico y, en algunos casos, de tratamiento periodontal adicional o cirugía.",
    ],
    alternatives: [
      "Limpieza superficial únicamente, con el riesgo de que la enfermedad de las encías siga avanzando por debajo.",
      "Derivación con el periodoncista para valorar un tratamiento más especializado.",
    ],
    care: [
      "Cepillado y uso diario de hilo dental o cepillos interdentales, que es lo que sostiene el resultado.",
      "Acudir a las sesiones de mantenimiento en el intervalo que te indique el doctor.",
      "Evitar el tabaco, que empeora el pronóstico de las encías.",
    ],
  },
  {
    key: "ortodoncia",
    label: "Ortodoncia (brackets o alineadores)",
    description:
      "La ortodoncia mueve los dientes de forma gradual con aparatos fijos o removibles para corregir su posición y la mordida. Requiere visitas periódicas de ajuste durante un tiempo estimado que puede variar según la respuesta de cada paciente, y termina con una fase de retención.",
    risks: [
      "Molestia y sensibilidad de los dientes durante los días siguientes a la colocación y a cada ajuste.",
      "Llagas o irritación de labios, carrillos y lengua al inicio.",
      "Manchas blancas, descalcificación o caries si la higiene no es cuidadosa durante el tratamiento.",
      "Inflamación o retracción de las encías.",
      "Acortamiento de la raíz de algunos dientes (reabsorción radicular), en general sin consecuencias clínicas.",
      "Duración mayor a la estimada si no se acude a las citas o no se usan los aditamentos indicados.",
      "Movimiento de los dientes después de terminar (recidiva) si no se usan los retenedores como se indica.",
    ],
    alternatives: [
      "Tratamiento con otro tipo de aparato (fijo, removible o alineadores), según lo que el caso permita.",
      "Corrección parcial, enfocada sólo en la zona que más preocupa al paciente.",
      "Tratamiento con enfoque quirúrgico en casos con alteración de la forma o el tamaño de los huesos, valorado con el especialista.",
    ],
    care: [
      "Extremar la higiene: cepillado después de cada comida y limpieza alrededor de los aparatos.",
      "Acudir puntualmente a las citas de ajuste y usar ligas o aditamentos el tiempo indicado.",
      "Usar los retenedores al terminar el tratamiento, durante todo el periodo que indique el doctor.",
    ],
  },
  {
    key: "blanqueamiento",
    label: "Blanqueamiento dental",
    description:
      "El blanqueamiento aclara el color de los dientes aplicando un gel blanqueador, en el consultorio o en casa con férulas hechas a medida, o combinando ambos. El resultado depende del tipo y la causa de la pigmentación, y del color inicial de cada diente.",
    risks: [
      "Sensibilidad dental durante y después del tratamiento, en general temporal.",
      "Irritación de las encías o de los labios por contacto con el gel.",
      "Resultado variable: algunas manchas —por medicamentos, traumatismos o manchas internas— aclaran poco o de forma irregular.",
      "Las resinas, coronas y otras restauraciones no cambian de color, por lo que pueden quedar visibles y necesitar sustituirse después.",
      "El efecto no es permanente: el color se va recuperando con el tiempo según hábitos como café, té, tabaco o vino.",
    ],
    alternatives: [
      "Limpieza y pulido para retirar pigmentaciones externas, cuando eso es suficiente.",
      "Restauraciones estéticas (resinas o carillas) para casos en los que el blanqueamiento no logra el resultado buscado.",
      "No realizar ningún cambio de color.",
    ],
    care: [
      "Seguir los tiempos de uso indicados y no aumentarlos por cuenta propia.",
      "Cuidar la dieta las primeras horas o días, evitando alimentos y bebidas con mucho pigmento.",
      "Avisar al consultorio si la sensibilidad es intensa o no cede.",
    ],
  },
];

export function getConsentProcedure(key: string): ConsentProcedure {
  return CONSENT_PROCEDURES.find((p) => p.key === key) ?? CONSENT_PROCEDURES[0];
}
