// ─────────────────────────────────────────────────────────────────────────────
// Casos de uso — contenido ESTÁTICO de /casos-de-uso.
//
// A diferencia del blog (BD + admin), esta sección vive en el repo: son 20
// escenarios ilustrativos que cambian poco y que queremos poder generar en
// build sin depender de DATABASE_URL. Por eso este módulo NO importa nada:
// es data pura + helpers síncronos, así lo puede consumir tanto un server
// component como el sitemap o un script de validación.
//
// REGLA EDITORIAL, no negociable: son ESCENARIOS ILUSTRATIVOS, no testimonios.
// Nada de nombres de clínicas o doctores, nada de frases entrecomilladas
// atribuidas a alguien, y ninguna cifra presentada como resultado real de un
// cliente — los números van siempre en condicional y como estimación. La página
// imprime CASOS_DISCLAIMER debajo del hero para que quede explícito.
// ─────────────────────────────────────────────────────────────────────────────

export const CASO_SPECIALTIES = [
  "ortodoncia",
  "implantes",
  "odontopediatria",
  "endodoncia",
  "estetica",
  "general",
  "periodoncia",
  "protesis",
  "multisede",
] as const;

export type CasoSpecialty = (typeof CASO_SPECIALTIES)[number];

/** Etiqueta visible de la especialidad (la clave es la que va en la data). */
export const CASO_SPECIALTY_LABELS: Record<CasoSpecialty, string> = {
  ortodoncia: "Ortodoncia",
  implantes: "Implantología",
  odontopediatria: "Odontopediatría",
  endodoncia: "Endodoncia",
  estetica: "Odontología estética",
  general: "Clínica general",
  periodoncia: "Periodoncia",
  protesis: "Prótesis",
  multisede: "Multi-sede",
};

export function casoSpecialtyLabel(key: string): string {
  return (CASO_SPECIALTY_LABELS as Record<string, string>)[key] ?? "Clínica dental";
}

export interface CasoFaqItem {
  q: string;
  a: string;
}

export interface CasoDeUso {
  slug: string;
  /** Titular en condicional o gerundio — nunca en pasado testimonial. */
  title: string;
  metaTitle: string;
  metaDescription: string;
  city: string;
  specialty: CasoSpecialty;
  /** El dolor operativo en una frase, para la tarjeta del índice. */
  problem: string;
  /** Módulos reales de DaleControl que intervienen (chips de la ficha). */
  modules: string[];
  excerpt: string;
  /** Markdown puro, mismo renderer que el blog (BlogMarkdown). */
  contentMd: string;
  faq: CasoFaqItem[];
  /** Slugs REALES de /blog — verificados contra el sitemap público. */
  relatedBlogSlugs: string[];
}

/**
 * Línea obligatoria bajo el hero de cada caso. Es la que evita que un escenario
 * ilustrativo se lea como el testimonio de un cliente.
 */
export const CASOS_DISCLAIMER =
  "Escenario ilustrativo basado en el uso típico de DaleControl. Los resultados varían según cada clínica.";

/**
 * Fecha de publicación de la sección — va al JSON-LD de Article y al sitemap.
 * Es una constante y no `new Date()` a propósito: así el HTML prerenderizado no
 * cambia entre builds. Al reescribir los casos, actualízala a mano.
 */
export const CASOS_PUBLISHED_AT = "2026-07-29";

export const CASOS_DE_USO: CasoDeUso[] = [
{
    slug: "ortodoncia-guadalajara-reducir-no-shows",
    title: "Cómo una clínica de ortodoncia en Guadalajara puede reducir las citas de ajuste que se caen sin aviso",
    metaTitle: "Ortodoncia en Guadalajara: menos citas de ajuste perdidas",
    metaDescription: "Si tu clínica de ortodoncia en Guadalajara pierde citas de ajuste sin aviso, Agenda, recordatorios por WhatsApp y reportes pueden ordenar mejor tu operación.",
    city: "Guadalajara",
    specialty: "ortodoncia",
    problem: "Citas de ajuste que se caen sin avisar",
    modules: ["Agenda", "Recordatorios por WhatsApp", "Inbox", "Reportes", "Analytics"],
    excerpt: "Una clínica de ortodoncia con tratamientos activos de meses puede usar confirmación por WhatsApp, lista de espera y reportes de asistencia para que un hueco en la agenda no se quede vacío.",
    contentMd: `## Cómo trabaja hoy una clínica de ortodoncia en Guadalajara

Una clínica de ortodoncia típica en Guadalajara mantiene una base de pacientes en tratamiento activo, cada uno con brackets, alineadores o algún aparato que necesita revisión cada cuatro a seis semanas. La agenda del día no se llena con consultas nuevas: se llena con ajustes de pacientes que ya conoces, que llevan meses en tratamiento y que, en teoría, ya tienen el hábito de venir. El problema es que ese hábito falla más seguido de lo que parece. Un adolescente al que se le olvida, un papá que tenía la cita apuntada en un papel que ya tiró, alguien que asume que puede moverse una semana sin avisar porque total ya casi termina el tratamiento — cualquiera de esos casos deja un espacio de veinte o treinta minutos que nadie ocupa.

Ese hueco no es solo un ingreso que no entra ese día. Es tiempo del sillón, de la asistente y del ortodoncista que ya estaba reservado y que no se puede recuperar por la tarde porque la agenda de la tarde ya tiene su propia lista de pacientes. Cuando esto pasa varias veces por semana, el consultorio termina con una sensación de estar lleno en el papel y medio vacío en la práctica, sin que nadie tenga claro cuánto está pasando en realidad ni en qué días se concentra más.

A la larga esto también desordena el plan de tratamiento: si un paciente se salta dos o tres ajustes seguidos sin avisar, el movimiento dental planeado se atrasa, y cuando por fin llega hay que revisar de nuevo el caso completo en vez de simplemente continuar donde se había quedado.

## Cómo se configura DaleControl

### Agenda con las etapas del tratamiento

Lo primero es cargar en Agenda el tipo de cita de cada paciente en tratamiento: ajuste de brackets, cambio de alineador, revisión de retenedor. Cada tipo puede tener su propia duración, así que un ajuste corto no ocupa el mismo bloque que una cita de banding o de retiro de aparato. Esto también sirve para ver, de un vistazo, qué huecos del día son cortos y cuáles podrían recibir a alguien que llame pidiendo espacio esa misma semana.

### Confirmación y recordatorio por WhatsApp

Con Recordatorios por WhatsApp la clínica manda un aviso unos días antes de la cita y otro la víspera, pidiendo que el paciente confirme o avise si no va a poder llegar. La ganancia real no es el mensaje en sí, sino el tiempo que le queda al equipo para reaccionar cuando alguien contesta que no va a poder: ese hueco se puede ofrecer a otra persona en vez de descubrirlo hasta la hora exacta en que el paciente no llegó.

### Inbox para mover pacientes hacia el hueco que se abre

Cuando se libera un espacio, Inbox concentra las conversaciones de WhatsApp de los pacientes que ya han pedido mover su cita o que preguntaron si había algo más pronto. En vez de buscar entre mensajes sueltos en un teléfono personal, el equipo puede revisar quién está esperando turno y ofrecerle el espacio que se acaba de abrir, ya sea ese mismo día o esa semana.

### Reportes y Analytics de asistencia

Con Reportes la clínica puede ver, por semana o por mes, cuántas citas se confirmaron, cuántas se cancelaron con tiempo y cuántas simplemente no se presentaron. Analytics ayuda a mirar esa tendencia a lo largo de varios meses: si los martes en la tarde concentran más ausencias, o si un tipo de cita en particular se cae más seguido que otras, ese patrón queda visible en vez de quedarse como una intuición suelta del equipo.

## Qué cambia en la operación

En un escenario típico, una clínica de ortodoncia que agenda alrededor de veinte citas de ajuste al día podría estar perdiendo, solo por ausencias sin aviso, el equivalente a una o dos citas diarias. Eso, sumado a lo largo de un mes de trabajo, podría representar varias horas de sillón que no generaron ingreso ni avance de tratamiento para ningún paciente.

Con confirmación y recordatorio activos, y con una forma más ordenada de saber quién está esperando turno, ese número podría bajar de forma notable: parte de las ausencias se convertirían en cancelaciones avisadas con el tiempo suficiente para ofrecerle el espacio a otra persona en tratamiento. Esta es una estimación ilustrativa y no un resultado garantizado para ninguna clínica en particular — cada consultorio tiene su propia mezcla de pacientes y hábitos, pero la lógica operativa de avisar antes, tener a quién ofrecerle el hueco y medir lo que está pasando de verdad es la misma sin importar el tamaño del consultorio.

Si quieres ver cómo se vería esto aplicado a tu propia agenda, puedes revisar cómo funciona la [confirmación de citas por WhatsApp](/blog/confirmacion-citas-whatsapp) y cómo se organiza [una lista de espera que rellene huecos en vez de dejarlos vacíos](/blog/lista-espera-pacientes-dental).

Crea tu cuenta en DaleControl y pruébalo con tu equipo: puedes cargar tu agenda de ajustes, activar los recordatorios y ver durante unas semanas para ver cómo se comporta tu propia lista de pacientes en tratamiento.
`,
    faq: [
      { q: "¿Los recordatorios por WhatsApp los tengo que escribir yo cada vez?", a: "No, se configuran una vez desde Agenda y Recordatorios por WhatsApp los manda solo antes de cada cita; el equipo entra a Inbox cuando un paciente contesta y hay que reaccionar." },
      { q: "¿Cómo sabe el equipo a quién ofrecerle un espacio que se acaba de liberar?", a: "Las conversaciones de los pacientes que han pedido adelantar su cita quedan concentradas en Inbox, así que el equipo puede revisar quién está esperando turno antes de ofrecer el hueco." },
      { q: "¿Puedo ver si las ausencias se concentran en algún día o tipo de cita?", a: "Sí, Reportes y Analytics muestran la asistencia por semana, por mes y por tipo de cita, para que el patrón se vea con datos y no solo por percepción del equipo." },
    ],
    relatedBlogSlugs: ["confirmacion-citas-whatsapp", "lista-espera-pacientes-dental", "reducir-no-shows-clinica-dental"],
  },
  {
    slug: "implantes-cdmx-seguimiento-por-etapas",
    title: "Cómo una clínica de implantes en Ciudad de México puede seguir el hilo de un tratamiento por etapas",
    metaTitle: "Implantes en CDMX: seguir el hilo del tratamiento por etapas",
    metaDescription: "Si tu clínica de implantes en la Ciudad de México pierde el hilo entre cirugía, cicatrización y prótesis, Expediente clínico y Agenda pueden ordenar cada etapa.",
    city: "Ciudad de México",
    specialty: "implantes",
    problem: "Tratamientos por etapas que pierden el hilo entre visitas",
    modules: ["Expediente clínico", "Agenda", "Portal del paciente", "Órdenes de laboratorio"],
    excerpt: "Un implante pasa por cirugía, cicatrización y prótesis a lo largo de varios meses. Expediente clínico, agenda con la siguiente cita amarrada y portal del paciente ayudan a que ninguna etapa se quede sin seguimiento.",
    contentMd: `## Cómo se pierde el hilo en un tratamiento de implantes en la Ciudad de México

Un tratamiento de implantes casi nunca es una sola visita. Empieza con la valoración y el plan quirúrgico, sigue con la cirugía de colocación, pasa por varios meses de cicatrización y osteointegración, y termina con la fase prostodóncica: toma de impresión, prueba de la prótesis y entrega final. Entre una etapa y la siguiente pueden pasar dos, tres o hasta seis meses, dependiendo del caso y de la zona de la boca.

En una clínica que atiende varios casos de implantes al mismo tiempo, cada uno en una etapa distinta, es fácil que el hilo se pierda. El expediente en papel o las notas sueltas en un documento no dejan claro, con solo abrir el caso, si ese paciente ya está listo para la siguiente fase o todavía le faltan semanas de cicatrización. El resultado típico es que alguien debe revisar caso por caso, a veces llamando al paciente para preguntar cómo se siente, en vez de que el sistema ya tenga registrado en qué momento del tratamiento va cada persona.

También pasa que nadie tiene claro quién debe darle seguimiento a cada paciente en esta etapa: si ya se le debió llamar para agendar la siguiente cita, si el laboratorio ya mandó la prótesis, o si el caso simplemente quedó esperando sin que nadie lo note hasta que el propio paciente pregunta qué sigue.

## Cómo se configura DaleControl

### Expediente clínico con una nota por cada etapa

Cada visita del tratamiento —valoración, cirugía, revisiones de cicatrización, toma de impresión, entrega— se registra como una nota dentro del mismo Expediente clínico del paciente. Así, con solo abrir el expediente, el equipo puede ver en qué etapa quedó el caso la última vez y qué se decidió hacer a continuación, sin depender de la memoria de quien atendió esa visita.

### Agenda con la siguiente cita ya amarrada

Al cerrar una visita, Agenda permite dejar programada la siguiente cita de control o de avance de etapa, en vez de dejar que el paciente sea quien decida cuándo volver. Esto reduce la posibilidad de que un caso se quede varios meses sin una fecha concreta de seguimiento.

### Portal del paciente con las indicaciones de cada etapa

El Portal del paciente le permite a la persona en tratamiento ver sus próximas citas y las indicaciones que le tocan en la etapa en la que va: cuidados después de la cirugía, señales de alarma durante la cicatrización, o qué esperar en la cita de prueba de la prótesis. Esto ayuda a que la información no dependa solo de lo que se dijo de palabra el día de la cirugía.

### Órdenes de laboratorio para la fase prostodóncica

Cuando el caso llega a la parte de la prótesis, Órdenes de laboratorio deja un registro de qué se le pidió al laboratorio, en qué fecha y en qué estatus va: en proceso, lista para prueba o entregada. Así se puede saber si un caso está detenido porque falta una cita del paciente o porque el laboratorio todavía no entrega su parte.

## Qué cambia en la operación

En un escenario típico, una clínica que lleva quince o veinte casos de implantes activos al mismo tiempo, repartidos entre distintas etapas, podría estar dedicando varias horas a la semana solo a revisar en qué va cada caso y a recordarle al equipo a quién hay que llamarle. Con las notas por etapa y la siguiente cita ya amarrada desde la visita anterior, ese tiempo de revisión podría reducirse de forma considerable, porque la pregunta de en qué etapa va un paciente deja de depender de la memoria de alguien del equipo.

Esto también podría significar menos casos que se quedan varados sin que nadie lo note durante semanas, simplemente porque la siguiente cita ya quedó agendada y el portal le recuerda al paciente lo que le toca hacer mientras tanto. Estas son estimaciones ilustrativas de cómo podría comportarse la operación y no una cifra prometida para cada clínica en particular.

Para profundizar en cómo se organiza esta información puedes revisar [cómo funciona un expediente clínico electrónico](/blog/expediente-clinico-electronico-dental) y [qué esperan los pacientes en cada etapa de su tratamiento](/blog/experiencia-paciente-dental).

Si quieres probar cómo se vería tu propia lista de casos de implantes organizada por etapas, puedes crear una cuenta en DaleControl y cargar tus tratamientos activos junto con tu equipo, sin ningún compromiso de por medio.
`,
    faq: [
      { q: "¿Cómo queda registrada la etapa en la que va cada paciente?", a: "Cada visita se guarda como una nota dentro del Expediente clínico del paciente, así que basta con abrir el caso para ver en qué etapa quedó y qué sigue." },
      { q: "¿La siguiente cita se agenda sola?", a: "No es automático; lo que hace Agenda es dejar la siguiente cita ya programada desde que se cierra la visita anterior, en vez de esperar a que el paciente la pida." },
      { q: "¿Qué ve el paciente en el portal durante la cicatrización?", a: "Puede ver sus próximas citas y las indicaciones de cuidado que le corresponden en la etapa en la que va, en vez de depender solo de lo que recuerde de la consulta." },
    ],
    relatedBlogSlugs: ["expediente-clinico-electronico-dental", "experiencia-paciente-dental", "gestion-especialidades-dentales"],
  },
  {
    slug: "odontopediatria-monterrey-comunicacion-con-papas",
    title: "Cómo una clínica de odontopediatría en Monterrey puede mejorar la comunicación con los papás",
    metaTitle: "Odontopediatría en Monterrey: comunicación clara con papás",
    metaDescription: "Si en tu clínica de odontopediatría en Monterrey los papás olvidan las indicaciones al salir, Portal del paciente y WhatsApp pueden dejarlas listas por escrito.",
    city: "Monterrey",
    specialty: "odontopediatria",
    problem: "Papás que no reciben información clara después de la consulta",
    modules: ["Portal del paciente", "Recordatorios por WhatsApp", "Expediente clínico", "Odontograma", "Encuestas de satisfacción"],
    excerpt: "Un papá sale de la consulta con varias indicaciones dichas de voz y al día siguiente no recuerda ninguna. Portal del paciente y recordatorios por WhatsApp pueden dejar esa información por escrito.",
    contentMd: `## Lo que pasa después de una consulta de odontopediatría en Monterrey

Una consulta de odontopediatría rara vez es solo del niño. La mamá o el papá entra al consultorio, a veces con un niño inquieto o asustado, y sale con varias indicaciones dichas de viva voz en cinco minutos: qué dieta seguir esta semana, cómo cepillar si hay una resina nueva, cuándo aplicar el flúor en casa, cuándo volver. Entre calmar al niño, escuchar al dentista y guardar el siguiente juguete de la sala de espera, es normal que al día siguiente no recuerde ni la mitad de lo que se dijo.

Cuando eso pasa, la familia suele resolverlo por su cuenta: le llama al consultorio para preguntar de nuevo, busca en internet algo parecido a lo que recuerda, o simplemente no sigue la indicación porque ya se le olvidó. Ninguna de esas tres opciones es buena para el tratamiento del niño ni para la carga de llamadas que recibe la recepción de la clínica.

También está el tema del odontograma: a un papá le cuesta imaginar qué diente es cuál solo por el número que se menciona en la consulta. Si no hay algo visual que acompañe la explicación, es fácil que la familia se quede con una idea vaga de qué se hizo y qué sigue pendiente.

En una ciudad como Monterrey, donde muchos papás trabajan jornadas largas y llevan al niño al dentista entre una junta y otra, el margen para volver a llamar o para leer con calma un papel que se perdió en la mochila es todavía más corto. Si la indicación no queda accesible desde el teléfono, en la práctica no queda accesible en ningún lado.

## Cómo se configura DaleControl

### Expediente clínico y Odontograma como apoyo visual

Durante la consulta, el Odontograma dentro del Expediente clínico marca qué diente se trató y qué queda pendiente. En vez de que el papá solo escuche un número de diente, puede ver el dibujo y entender de qué parte de la boca se está hablando, lo cual ayuda a que la explicación quede más clara desde el primer momento.

### Portal del paciente con las indicaciones por escrito

Al terminar la consulta, las indicaciones —dieta, cepillado, cuidados de una resina o un sellador, fecha de la siguiente cita— quedan registradas en el Portal del paciente, donde la familia puede entrar desde su teléfono cuando quiera repasarlas, en vez de depender solo de lo que se recuerda de la plática en el consultorio.

### Recordatorios por WhatsApp para reforzar lo importante

Además del portal, Recordatorios por WhatsApp puede mandar un aviso puntual antes de la siguiente cita o un recordatorio de algún cuidado específico, como no dar de comer nada duro el mismo día de una extracción. Es un refuerzo corto que llega directo al teléfono de quien lleva al niño.

### Encuestas de satisfacción para saber si el mensaje llegó

Después de la visita, Encuestas de satisfacción permite preguntarle a la familia, de forma breve, cómo le pareció la consulta y si le quedó clara la explicación. Esa respuesta le da a la clínica una señal concreta de si la comunicación está funcionando o si conviene ajustar cómo se explican las cosas.

## Qué cambia en la operación

En un escenario típico, una clínica de odontopediatría que atiende varias consultas al día podría estar recibiendo un número considerable de llamadas solo para repetir indicaciones que ya se dieron en el consultorio. Si esa información queda disponible por escrito en el portal y se refuerza por WhatsApp, esas llamadas podrían bajar de forma notable, liberando tiempo de recepción para otras tareas.

Esto también podría representar menos confusión en casa: menos dietas mal seguidas, menos dudas de última hora antes de una cita de control, y menos casos de un tratamiento que se atrasa porque el cuidado en casa no se siguió como se explicó. Con el tiempo, las respuestas de las encuestas también podrían servirle al equipo para detectar qué parte de la explicación se queda menos clara y ajustar cómo se cuenta la próxima vez. Son estimaciones ilustrativas de cómo podría comportarse la operación en un consultorio de este tipo, no una cifra garantizada para cualquier clínica.

Para profundizar en el tema puedes revisar [qué esperan los papás de la experiencia en el consultorio](/blog/experiencia-paciente-dental) y [cómo usar WhatsApp de forma ordenada con las familias](/blog/whatsapp-clinicas-dentales-guia).

Si quieres ver cómo se acomodaría esto en tu propia clínica, puedes crear una cuenta en DaleControl y probar con tu equipo cómo quedan las indicaciones de la próxima consulta en el portal del paciente.
`,
    faq: [
      { q: "¿El portal reemplaza la explicación que le doy al papá en el consultorio?", a: "No, la complementa. La explicación sigue siendo del dentista; el portal deja esas mismas indicaciones por escrito para que la familia las pueda repasar después." },
      { q: "¿Cómo explico qué diente se trató sin que el papá se pierda con los números?", a: "El Odontograma dentro del Expediente clínico muestra el diente de forma visual, así que puedes señalarlo directamente en vez de solo mencionar un número." },
      { q: "¿Para qué sirve la encuesta de satisfacción si ya hablé con la familia en consulta?", a: "Da una señal concreta de si la explicación quedó clara o no, algo difícil de medir solo por percepción del equipo en el día a día." },
    ],
    relatedBlogSlugs: ["experiencia-paciente-dental", "whatsapp-clinicas-dentales-guia", "expediente-clinico-electronico-dental"],
  },
  {
    slug: "endodoncia-puebla-atender-urgencias",
    title: "Cómo una clínica de endodoncia en Puebla puede encontrar espacio para atender urgencias",
    metaTitle: "Endodoncia en Puebla: encontrar espacio para urgencias",
    metaDescription: "Si tu clínica de endodoncia en Puebla recibe urgencias de dolor sin espacio en la agenda, Agenda, Inbox y dictado por voz pueden ordenar mejor el día.",
    city: "Puebla",
    specialty: "endodoncia",
    problem: "Urgencias que llegan sin espacio en la agenda",
    modules: ["Agenda", "Inbox", "Expediente clínico", "Dictado por voz"],
    excerpt: "Una clínica de endodoncia recibe referencias y urgencias de dolor el mismo día, con la agenda llena y el teléfono sonando. Agenda con huecos visibles, Inbox para triage y dictado por voz pueden ordenar la respuesta.",
    contentMd: `## Cómo llegan las urgencias a una clínica de endodoncia en Puebla

Una clínica de endodoncia en Puebla rara vez llena su agenda solo con citas programadas con anticipación. Buena parte de la semana llega por dos vías distintas: la referencia de otro dentista que manda a un paciente para un conducto, y la urgencia de dolor que llama el mismo día pidiendo que la atiendan lo antes posible. Las dos son citas que no estaban planeadas la semana anterior, y las dos suelen llegar con el mismo mensaje de fondo: se necesita hoy, no la próxima semana.

El problema es que la agenda ya tiene su propia carga de tratamientos en curso, y el teléfono no deja de sonar con esa misma pregunta: si hay espacio hoy o mañana. Sin una vista clara de qué huecos existen en el día, contestar esa pregunta implica revisar la agenda completa cada vez, o peor, prometer un espacio que en realidad ya está ocupado.

A esto se suma que cada paciente de urgencia trae su propia historia clínica incompleta: quién lo refiere, qué diente le duele, si ya le sacaron una radiografía en otro consultorio. Y al final del día, con varias urgencias atendidas entre las citas programadas, la nota clínica de cada una se va atrasando porque no hay tiempo de escribirla entre un paciente y el siguiente.

Puebla, además, concentra consultorios generales que no hacen endodoncia y que dependen de mandar sus casos de conducto a un especialista de confianza. Esa relación se sostiene con comunicación constante: el generalista quiere saber qué pasó con su paciente, y el endodoncista necesita la información del caso antes de que el paciente se siente en el sillón, no mientras ya está ahí con dolor.

## Cómo se configura DaleControl

### Agenda con bloques y huecos visibles

En Agenda se puede reservar un bloque fijo del día, o varios espacios cortos repartidos en la jornada, pensados específicamente para urgencias. Así, cuando alguien pregunta si hay espacio, el equipo puede ver de un vistazo qué huecos quedan disponibles hoy en vez de reacomodar toda la agenda para encontrar uno.

### Inbox y WhatsApp para hacer triage antes de contestar

Con Inbox, los mensajes de WhatsApp de pacientes con dolor quedan concentrados en un solo lugar, en vez de perderse entre llamadas y mensajes sueltos. El equipo puede pedir una foto o una breve descripción del dolor antes de decidir si es una urgencia real que necesita el bloque del día o algo que puede esperar a mañana.

### Expediente clínico compartido con quien refiere

Cuando un dentista refiere a un paciente, el Expediente clínico permite dejar la nota, la radiografía y el motivo de la referencia en el mismo lugar donde el especialista va a trabajar el caso, en vez de depender de un mensaje de WhatsApp con la información suelta.

### Dictado por voz para no atrasarse con la nota

Entre una urgencia y la siguiente cita programada, Dictado por voz permite registrar la nota clínica hablando en vez de escribiendo, para que el expediente quede al día sin que el endodoncista tenga que quedarse después de la última cita a redactar lo que pasó en el día.

## Qué cambia en la operación

En un escenario típico, una clínica de endodoncia que recibe varias urgencias a la semana además de sus citas programadas podría estar perdiendo tiempo considerable solo en decidir, llamada por llamada, si hay dónde meter a un paciente con dolor. Con bloques de urgencia visibles en la agenda, esa decisión podría tomar un par de minutos en vez de convertirse en una revisión completa del día.

El triage por Inbox también podría reducir las urgencias que en realidad no eran urgentes y que terminaban ocupando un espacio que otro paciente con más dolor necesitaba ese mismo día. Y si la nota clínica queda al día gracias al dictado por voz, el expediente de cada caso referido podría estar listo para compartirse con quien lo mandó, en vez de quedar pendiente para cuando haya un momento libre. Estas son estimaciones ilustrativas de cómo podría comportarse la operación de un consultorio con este perfil de urgencias, no un resultado garantizado.

Para profundizar puedes revisar [cómo organizar una agenda dental que de verdad refleje los huecos del día](/blog/agenda-dental-organizar-citas) y [cómo se maneja la relación con quien refiere pacientes entre especialidades](/blog/gestion-especialidades-dentales).

Si quieres ver cómo se comportaría tu propia agenda de urgencias, puedes crear una cuenta en DaleControl y probar con tu equipo el manejo de bloques y el triage por WhatsApp durante unas semanas.
`,
    faq: [
      { q: "¿Cómo sé qué huecos hay disponibles hoy para meter una urgencia?", a: "Agenda muestra los bloques reservados para urgencias y los espacios libres del día, así que no hay que revisar toda la agenda para contestar esa pregunta." },
      { q: "¿El triage por WhatsApp decide solo si es una urgencia real?", a: "No decide solo; concentra los mensajes en Inbox para que el equipo pida una foto o una descripción del dolor y decida con más información antes de ofrecer un espacio." },
      { q: "¿El dictado por voz reemplaza la nota clínica que yo redacto?", a: "No, transcribe lo que dictas para que quede registrado en el Expediente clínico; la decisión clínica y la redacción final siguen siendo tuyas." },
    ],
    relatedBlogSlugs: ["agenda-dental-organizar-citas", "gestion-especialidades-dentales", "whatsapp-clinicas-dentales-guia"],
  },
{
    slug: "estetica-dental-cdmx-presupuestos-aceptados",
    title: "Cómo una clínica de estética dental en Ciudad de México puede dar seguimiento a sus presupuestos altos",
    metaTitle: "Presupuestos de estética dental en CDMX: seguimiento",
    metaDescription: "En Ciudad de México, una clínica de estética dental puede ordenar sus presupuestos altos, dar seguimiento por WhatsApp y mostrar sus propios casos.",
    city: "Ciudad de México",
    specialty: "estetica",
    problem: "Presupuestos altos que se quedan sin respuesta",
    modules: ["Expediente clínico", "Antes/Después", "Recordatorios por WhatsApp", "Reportes", "Paquetes"],
    excerpt: "Cuando el paciente de estética dice que lo va a pensar, el presupuesto se puede perder. Así se puede dar seguimiento con expediente, Antes/Después, WhatsApp y reportes.",
    contentMd: `En Ciudad de México, una clínica de estética dental suele vivir del plan de tratamiento grande: diseño de sonrisa, carillas, blanqueamiento combinado con ortodoncia previa, a veces implantes estéticos. El paciente llega por una consulta de valoración, se emociona con el antes y después que ve en el consultorio, y luego pide el presupuesto por escrito. Ahí empieza el problema: dice que lo va a pensar, se despide, y la clínica no vuelve a saber de él hasta que, si acaso, regresa meses después con la misma duda de siempre. A veces el mismo paciente vuelve a preguntar en la siguiente cita de limpieza, como quien no quiere la cosa, y ahí es donde se nota que nadie llevó un registro de qué se le había presentado la primera vez.

Sin un lugar donde ese presupuesto quede registrado con fecha, monto y estatus, se pierde entre agendas de papel, notas sueltas o una libreta de la recepción. Nadie sabe a quién le toca llamar, ni cuándo, ni qué se le prometió al paciente en la valoración. Con el tiempo se acumulan decenas de presupuestos abiertos sin dueño, y la clínica termina compitiendo solo por pacientes nuevos en vez de cerrar los que ya estuvieron sentados en el sillón.

El otro punto flaco es mostrar resultados propios. Enseñar fotos de un caso ajeno bajado de internet no convence tanto como enseñar el trabajo real de la misma clínica, con pacientes de condiciones parecidas a las del paciente que está decidiendo. También ayuda cuando el paciente compara precios entre clínicas: ver un caso terminado de la misma clínica, con una persona de edad y condición parecida, pesa más que cualquier explicación verbal sobre lo que puede llegar a verse el tratamiento.

## Cómo se configura DaleControl

### Expediente con el plan de tratamiento y su estatus

Cada plan de estética queda dentro del expediente clínico del paciente, con las fases propuestas, el estatus de cada una (propuesto, aceptado, en proceso, terminado) y quién lo presentó. Cuando el paciente dice que lo va a pensar, el plan no desaparece: queda visible para todo el equipo con su estatus real. Esto sirve también cuando el paciente cambia de opinión sobre una fase, por ejemplo decide posponer los implantes pero seguir con las carillas: el plan se ajusta sin perder el registro de lo que ya se había hablado.

### Antes/Después con casos propios

La clínica sube a Antes/Después las fotos de sus propios casos de diseño de sonrisa y carillas, organizadas por tipo de tratamiento. En la siguiente valoración, en vez de mostrar imágenes genéricas, el doctor enseña resultados de pacientes que pasaron por el mismo consultorio.

### Seguimiento por WhatsApp

Los presupuestos que quedan en propuesto se pueden seguir con recordatorios por WhatsApp: un mensaje de seguimiento a los pocos días, y otro más si no hay respuesta, sin que alguien tenga que acordarse manualmente de cada paciente pendiente.

### Reportes y paquetes

Reportes muestra los presupuestos pendientes ordenados por antigüedad y por monto, para priorizar las llamadas de la semana. Cuando el tratamiento se arma como paquete, por ejemplo carillas superiores más blanqueamiento, Paquetes deja ese conjunto listado como una sola propuesta, más fácil de presentar y de dar seguimiento que varias líneas sueltas. Armar el paquete también ayuda a que el paciente entienda de un vistazo qué incluye el precio final, en vez de tratar de sumar mentalmente varias líneas sueltas del presupuesto.

## Qué cambia en la operación

En un escenario típico, si la clínica presenta entre 15 y 20 presupuestos de estética al mes y hoy solo dos o tres reciben una llamada de seguimiento real, tener el listado ordenado por Reportes podría ayudar a que ese seguimiento llegue a la mayoría, no solo a los que alguien recuerda por casualidad. Esto no garantiza que el paciente acepte, pero sí que nadie se quede sin una segunda conversación. Con el tiempo, esto también deja ver qué proporción de los presupuestos presentados se queda en propuesto por más de un mes, información que hoy simplemente no existe en ningún lado.

De forma parecida, mostrar Antes/Después con casos propios en la misma valoración podría acortar el tiempo que el paciente tarda en decidir, porque la duda deja de ser «¿esto realmente se ve así de bien?» para muchos casos. Son estimaciones ilustrativas: el resultado exacto depende del tipo de tratamiento, del precio y de cómo cada clínica hace su propia valoración.

Si te interesa entender por qué los pacientes se van con el «lo voy a pensar» y no vuelven, este artículo sobre [por qué no aceptan un presupuesto dental](/blog/por-que-no-aceptan-presupuesto-dental) revisa las razones más comunes. Y si ya tienes una lista larga de propuestas abiertas, este otro sobre [seguimiento de presupuestos pendientes](/blog/seguimiento-presupuestos-pendientes-dental) entra en el detalle de cómo priorizarla.

Crea tu cuenta en DaleControl y sube el expediente de tu clínica, las fotos de tus casos y el seguimiento de tus presupuestos abiertos. Pruébalo con tu equipo de recepción y con el doctor que arma los planes, y ve cómo se ve tu propia lista de pendientes ya ordenada.
`,
    faq: [
      { q: "¿Los mensajes de seguimiento por WhatsApp se envían solos?", a: "Se envían por WhatsApp desde la clínica, igual que se usan para confirmar citas; el mensaje y el momento de enviarlo los define tu equipo, no es una secuencia automática que decide todo por sí sola." },
      { q: "¿Qué pasa si el paciente acepta solo una parte del plan?", a: "El plan puede quedar dividido por fases dentro del expediente, cada una con su propio estatus, así que puedes marcar como aceptada la parte que el paciente sí confirmó y dejar el resto en propuesto para seguir dándole seguimiento." },
      { q: "¿Las fotos de Antes/Después son de mi clínica o son ejemplos genéricos?", a: "Son las fotos que tu propia clínica sube de sus casos reales; no hay un banco de imágenes genérico incluido, la idea es mostrar pacientes que sí pasaron por tu consultorio." },
    ],
    relatedBlogSlugs: ["seguimiento-presupuestos-pendientes-dental", "por-que-no-aceptan-presupuesto-dental", "precios-tratamientos-dentales-rentables"],
  },
  {
    slug: "clinica-general-queretaro-migrar-de-excel",
    title: "Cómo una clínica general en Querétaro puede migrar de varios Excel a un solo sistema",
    metaTitle: "Migrar de Excel a un sistema: clínica general en Querétaro",
    metaDescription: "Una clínica general en Querétaro que lleva pacientes, cobros y agenda en varios Excel puede importar, verificar y ordenar todo en un solo sistema.",
    city: "Querétaro",
    specialty: "general",
    problem: "Toda la clínica vive en hojas de Excel",
    modules: ["Importación desde Excel", "Expediente clínico", "Agenda", "Caja", "Roles y permisos"],
    excerpt: "Cuando cada Excel de la clínica lo entiende solo quien lo hizo, algo se pierde. Así se puede importar, verificar y migrar a un solo sistema sin perder el historial.",
    contentMd: `En Querétaro es común que una clínica general lleve años operando con un Excel para pacientes, otro para cobros, y a veces uno más para la agenda de la semana, cada uno hecho por la persona que en su momento se encargaba de la recepción. Cuando esa persona cambia de puesto o se va, el archivo se vuelve un misterio: fórmulas que nadie recuerda, columnas renombradas, una pestaña por mes que ya nadie actualiza igual. A veces hasta el número de teléfono de un paciente varía entre un archivo y otro, porque alguien lo actualizó en una copia y se le olvidó replicarlo en la otra.

El problema se agrava cuando el mismo archivo vive en dos computadoras distintas, la de la recepción y la de la doctora en su casa, y cada quien le mete cambios por su lado. Al final de la semana nadie sabe cuál versión es la buena, y es normal encontrar un paciente registrado dos veces con datos distintos, o un cobro capturado en un archivo pero no en el otro. Ese mismo problema se repite con la agenda: si la recepcionista de la mañana y la de la tarde trabajan cada una su propia copia del Excel de citas, es cuestión de tiempo antes de que dos pacientes queden agendados a la misma hora sin que nadie se entere hasta que ambos llegan al consultorio.

Mudarse de golpe a otro sistema da miedo precisamente por eso: la clínica no quiere perder el historial de años de pacientes ni descubrir a medio camino que faltó importar algo. Por eso conviene seguir un orden claro antes de tocar nada.

## Cómo se configura DaleControl

### Limpiar la hoja antes de importar

Antes de subir cualquier archivo conviene dejar un solo Excel por tipo de dato, uno de pacientes, por ejemplo, con una fila por paciente, sin celdas combinadas ni columnas duplicadas, y con los nombres de columna simples: nombre, teléfono, fecha de nacimiento. Es el paso que más tiempo ahorra después. Conviene también decidir de una vez qué hacer con los pacientes que ya no son activos, para no importar contactos que llevan años sin volver junto con los que sí siguen en tratamiento.

### Importación desde Excel

Con la hoja ya limpia, Importación desde Excel sube el listado de pacientes a la clínica en un solo lote, en vez de capturarlos uno por uno a mano. Es el momento de decidir qué columnas del Excel corresponden a qué campo del expediente.

### Expediente, agenda y caja

Cada paciente importado ya tiene su propio expediente clínico, donde a partir de ese día se registra la nota de consulta en vez de en una hoja de cálculo aparte. La agenda sustituye al Excel de citas de la semana, y Caja concentra los cobros del día en un solo lugar, con su corte, en vez de vivir repartidos entre dos archivos. El historial de cobros de cada paciente queda ligado a su propio expediente, así que ya no hace falta abrir un archivo aparte para saber cuánto debe o cuánto ha pagado.

### Roles y permisos

Antes de dejar el Excel por completo conviene definir qué ve cada quien: recepción registra citas y cobros, la doctora ve el expediente clínico completo, y solo alguien de confianza tiene acceso a los reportes de caja. Roles y permisos evita que cualquiera con la computadora abierta pueda editar todo.

## Qué cambia en la operación

En un escenario típico, si la clínica tiene alrededor de 300 pacientes activos repartidos en dos o tres archivos, concentrarlos en un solo expediente podría evitar buena parte de los duplicados y de las llamadas para confirmar cuál versión del Excel es la vigente. Es una estimación ilustrativa: el número real depende de qué tan desordenados estén los archivos de origen. Ese mismo orden ayuda cuando alguien nuevo se integra al equipo de recepción, porque ya no depende de que la persona anterior le explique de memoria cómo estaba armado cada Excel.

El orden sensato es primero importar y verificar contra la hoja original, ¿coinciden los teléfonos, las fechas, los saldos?, antes de anunciarle al equipo que ya no se debe tocar el Excel viejo. Mantener las dos cosas corriendo en paralelo una semana ayuda a detectar errores de importación sin arriesgar información de un paciente real. Cuando la verificación queda tranquila, ese es el momento de archivar el Excel y no volver a capturar nada ahí.

Si quieres profundizar en cómo se organiza una clínica que apenas está saliendo del papel y las hojas sueltas, este artículo sobre [cómo administrar una clínica dental](/blog/como-administrar-clinica-dental) cubre el resto de la operación más allá de la migración. Y si la agenda es de las partes que más dolores de cabeza da hoy, [organizar la agenda de la clínica](/blog/agenda-dental-organizar-citas) entra en ese tema con más detalle.

Crea tu cuenta en DaleControl y sube tu Excel de pacientes para ver cómo queda importado. Pruébalo primero con un grupo pequeño y con tu equipo de recepción antes de migrar todo, así llegas al día en que apagas el Excel con la confianza de que nada se quedó atrás.
`,
    faq: [
      { q: "¿Qué pasa si mi Excel de pacientes tiene columnas distintas a las que pide el sistema?", a: "Al importar puedes indicar qué columna de tu archivo corresponde a qué campo del expediente, así que no necesitas que tu Excel ya venga con los nombres exactos, solo que cada columna tenga datos consistentes." },
      { q: "¿Puedo seguir usando el Excel mientras me acostumbro al sistema?", a: "Sí, conviene mantenerlo unos días como respaldo mientras verificas que la importación quedó completa, pero la idea es dejar de capturar información nueva ahí en cuanto confirmes que todo pasó correctamente." },
      { q: "¿Quién puede ver los cobros de caja una vez que dejamos el Excel?", a: "Eso lo defines con roles y permisos: puedes dar acceso a caja solo a quien haga los cortes, y dejar el expediente clínico visible únicamente para el personal clínico." },
    ],
    relatedBlogSlugs: ["como-administrar-clinica-dental", "agenda-dental-organizar-citas", "software-consultorio-dental-guia"],
  },
  {
    slug: "multisede-guadalajara-caja-y-cortes",
    title: "Cómo una clínica multisede en Guadalajara puede cuadrar sus cortes de caja entre sucursales",
    metaTitle: "Cortes de caja entre sucursales en Guadalajara",
    metaDescription: "Una clínica con varias sucursales en Guadalajara puede cuadrar sus cortes de caja con PIN, bitácora y reportes, en vez de comparar fotos de WhatsApp.",
    city: "Guadalajara",
    specialty: "multisede",
    problem: "Cortes de caja que no cuadran entre sucursales",
    modules: ["Caja", "Corte de caja con PIN", "Multi-sede", "Finanzas", "Bitácora", "Reportes"],
    excerpt: "Cuando el corte llega por foto de WhatsApp y las diferencias aparecen días después, cuesta rastrearlas. Así se puede ordenar la caja entre varias sucursales.",
    contentMd: `Una clínica dental con tres sucursales en Guadalajara, digamos una por Providencia, otra por Zapopan y una tercera en el centro, suele operar cada consultorio como si fuera una isla aparte. Cada recepción cobra a su manera: una anota todo en una libreta, otra usa una calculadora y una nota de voz, la tercera tiene su propio Excel. Al final del día alguien toma foto del corte con su celular y lo manda por WhatsApp a quien lleva las finanzas. En una consulta muy concurrida el viernes, por ejemplo, la recepción de la sucursal del centro puede recibir el doble de pagos en efectivo que un martes cualquiera, y ese tipo de variación hace más difícil detectar a simple vista si algo realmente no cuadra.

El problema no es la falta de esfuerzo, es que no hay un formato común. Cuando dos sucursales reportan un faltante el mismo día, nadie puede comparar ambos cortes con el mismo criterio porque cada quien clasificó los pagos distinto: una metió un cobro en efectivo, la otra el mismo tipo de cobro pero mezclado con tarjeta. Las diferencias suelen aparecer dos o tres días después, cuando ya nadie recuerda con exactitud qué paciente pagó qué ese día ni quién estaba en la caja a esa hora. Cuando la administradora general por fin junta los tres reportes, ya pasaron varios días y cada recepción atendió decenas de pacientes más, así que reconstruir de memoria un cobro puntual del lunes pasado es prácticamente imposible.

Sin un registro por usuario, tampoco hay manera de saber quién hizo cada cobro cuando hace falta revisar un movimiento puntual. La conciliación se vuelve una tarea de detective con capturas de pantalla de WhatsApp en vez de un reporte confiable.

## Cómo se configura DaleControl

### Multi-sede con datos por sucursal

Cada una de las tres sucursales opera con su propia información dentro de Multi-sede: sus citas, sus cobros y su inventario quedan separados, pero visibles para quien necesita ver el conjunto de la clínica completa. Esto también evita que un cobro registrado en la sucursal equivocada se mezcle con las cifras de otra, algo que pasa seguido cuando el mismo formato de Excel se comparte entre las tres recepciones.

### Caja y corte con PIN por usuario

Caja concentra los cobros del día con el mismo formato en las tres sucursales, sin importar quién esté en recepción. Corte de caja con PIN pide que cada persona cierre su turno con su propio PIN, así el corte queda asociado a quien realmente cobró, no a la sucursal en general. Si una recepcionista cubre un turno en una sucursal distinta a la habitual, su PIN la sigue identificando ahí, así que el corte de ese día no se le atribuye a la sucursal por error.

### Bitácora

Bitácora registra qué usuario hizo cada movimiento y a qué hora, así que si un corte no cuadra ya no depende de la memoria de nadie: se puede revisar el registro exacto de esa caja ese día.

### Finanzas y reportes

Finanzas junta la información de las tres sucursales en un solo panel, y Reportes permite comparar cortes entre sucursales bajo el mismo formato, en vez de comparar una libreta contra una nota de voz.

## Qué cambia en la operación

En un escenario típico, si la clínica maneja tres sucursales con cortes diarios y hoy tarda dos o tres días en detectar una diferencia, tener el corte con PIN y la bitácora del mismo día podría acortar ese tiempo a horas, porque ya no depende de reconstruir la foto de WhatsApp de la sucursal correspondiente. De forma parecida, si una diferencia de unos cuantos cientos de pesos en el corte de una sucursal hoy tarda días en explicarse, tener el mismo formato de caja en las tres podría ayudar a ubicarla dentro del mismo corte, aunque no elimina por sí sola los errores al momento de cobrar. Son estimaciones ilustrativas: el tiempo real depende de qué tan seguido revise finanzas los reportes y de cómo capture cada sucursal sus cobros. Además, cuando finanzas revisa los reportes cada semana en vez de cada mes, hay más oportunidad de notar un patrón que se repite en una sucursal en particular, en vez de descubrirlo hasta el corte trimestral.

Si te interesa ver cómo se organiza la parte financiera de una clínica con varias sucursales, este artículo sobre [finanzas de la clínica dental](/blog/finanzas-clinica-dental-guia) entra en más detalle sobre reportes y control. Y si administrar más de un consultorio a la vez es un tema nuevo para tu operación, [cómo administrar una clínica dental](/blog/como-administrar-clinica-dental) cubre los puntos generales antes de llegar a lo multisede.

Crea tu cuenta en DaleControl y da de alta tus sucursales para ver cómo se ve el corte de caja con PIN desde el primer día. Pruébalo con tu equipo de recepción de las tres sucursales a la vez, así comparas los primeros cortes bajo el mismo formato y le das seguimiento real a cualquier diferencia.
`,
    faq: [
      { q: "¿Cada sucursal necesita su propia cuenta o es la misma clínica?", a: "Es la misma clínica dentro de Multi-sede: cada sucursal tiene sus propios datos de agenda y caja, pero quien administra puede ver el conjunto de las tres." },
      { q: "¿El PIN del corte de caja es por sucursal o por persona?", a: "Es por persona, así que el corte queda asociado a quien realmente estuvo cobrando ese turno, sin importar en cuál de las sucursales haya trabajado ese día." },
      { q: "¿La bitácora se puede revisar días después de un movimiento?", a: "Sí, la bitácora queda guardada y se puede consultar cuando haga falta revisar un movimiento anterior, no solo el mismo día en que ocurrió." },
    ],
    relatedBlogSlugs: ["finanzas-clinica-dental-guia", "como-administrar-clinica-dental", "punto-equilibrio-consultorio-dental"],
  },
  {
    slug: "clinica-general-tijuana-whatsapp-saturado",
    title: "Cómo una clínica general en Tijuana puede ordenar un WhatsApp saturado de mensajes",
    metaTitle: "WhatsApp saturado en la clínica: ordenarlo en Tijuana",
    metaDescription: "Una clínica general en Tijuana con un WhatsApp saturado puede ordenar su Inbox, ligar la agenda a la conversación y saber quién ya respondió.",
    city: "Tijuana",
    specialty: "general",
    problem: "Un WhatsApp saturado de mensajes sin orden",
    modules: ["Inbox", "Recordatorios por WhatsApp", "Agenda", "Roles y permisos"],
    excerpt: "Cuando todos contestan el mismo WhatsApp sin orden, los pacientes preguntan dos veces. Así se puede ordenar el Inbox y ligarlo a la agenda de la clínica.",
    contentMd: `En muchas clínicas generales de Tijuana el número de WhatsApp del consultorio es también el número personal de alguien del equipo, o un número compartido que contesta quien tenga el celular a la mano en ese momento. Un paciente pregunta por un horario disponible, otro manda una radiografía que le pidieron, otro más solo quiere confirmar su cita de mañana. Todo llega al mismo chat, sin más orden que la hora en que entró el mensaje. Un mismo paciente puede escribir por la mañana para preguntar un precio, y por la tarde volver a escribir porque nadie le contestó, sin saber que su primer mensaje sigue ahí, sin abrir, varios lugares más arriba en la lista de chats.

Cuando hay varias conversaciones abiertas a la vez, los mensajes viejos se van al fondo y ahí se quedan. El paciente que no recibe respuesta en un par de horas vuelve a escribir, a veces desde otro número, y ahora hay dos hilos de la misma persona preguntando lo mismo. Nadie en el equipo sabe con certeza quién ya contestó y quién no, así que es común que dos personas le respondan al mismo paciente cosas distintas, o que nadie le responda porque cada quien asume que ya lo hizo otro. En temporada alta, cuando llegan más consultas de las habituales, el chat se vuelve prácticamente inmanejable: alguien del equipo abre la conversación equivocada, contesta con el nombre de otro paciente, y la confusión se nota justo frente a quien está esperando una respuesta.

La agenda vive aparte de esa conversación: cuando alguien por fin confirma una cita por WhatsApp, hay que ir a anotarla a mano en otro lado, y ese paso extra es justo el que se salta cuando el chat está saturado.

## Cómo se configura DaleControl

### Inbox para ordenar la conversación

Inbox concentra los mensajes de WhatsApp de la clínica en un solo lugar, donde se puede ver qué conversación ya se atendió y cuál sigue pendiente, en vez de un chat único donde todo se mezcla por orden de llegada. También queda claro cuánto tiempo lleva un mensaje sin respuesta, así que ya no depende de desplazarse hacia arriba en el chat para notar que alguien lleva horas esperando.

### Agenda ligada a la conversación

Cuando un paciente confirma, cambia o pide una cita dentro de la misma conversación, Agenda queda ligada a ese intercambio, así que no hace falta copiar el dato a mano a otro lado ni arriesgarse a que la cita se quede solo en el chat.

### Recordatorios y confirmación por WhatsApp

Las citas del día siguiente pueden salir con un recordatorio y una confirmación por WhatsApp sin que alguien del equipo tenga que escribirle uno por uno a cada paciente agendado.

### Roles y permisos por persona

Con Roles y permisos, cada quien ve la parte de Inbox y de agenda que le corresponde, y queda más claro quién es responsable de qué conversación, en vez de que todo el equipo comparta el mismo chat sin división de tareas. Esto es útil sobre todo cuando el equipo crece: una recepcionista nueva puede encargarse de agendar sin tener que revisar primero todo el historial de conversaciones de años atrás.

## Qué cambia en la operación

En un escenario típico, si la clínica recibe alrededor de 40 o 50 mensajes de WhatsApp al día repartidos entre citas nuevas, dudas y confirmaciones, tener Inbox ordenado por conversación podría evitar buena parte de las preguntas duplicadas de un paciente que ya había escrito antes. Es una estimación ilustrativa: el número real de mensajes y de duplicados depende del tamaño de la clínica y de la temporada.

De forma parecida, si hoy una parte de las confirmaciones de cita se pierde por quedarse en un mensaje sin leer, ligar la agenda a la misma conversación podría reducir cuántas citas del día siguiente llegan sin confirmar. El resultado exacto depende de cuánta disciplina tenga el equipo para revisar el Inbox, no solo de tener la herramienta. Con el tiempo, tener esa misma conversación ligada a la agenda también deja un registro de qué se le prometió a cada paciente, útil cuando alguien pregunta semanas después por algo que ya había hablado con otra persona del equipo.

Si quieres profundizar en cómo usar WhatsApp de forma ordenada en la operación diaria, este artículo sobre [WhatsApp para clínicas dentales](/blog/whatsapp-clinicas-dentales-guia) entra en el resto de los usos posibles. Y si el problema de fondo son las confirmaciones de cita, [confirmación de citas por WhatsApp](/blog/confirmacion-citas-whatsapp) revisa ese tema con más detalle.

Crea tu cuenta en DaleControl y conecta tu número de WhatsApp para ver cómo se ordena tu Inbox desde el primer día. Pruébalo con todo tu equipo de recepción a la vez, así cada quien ve de una vez cuáles conversaciones son suyas y cuáles ya quedaron atendidas por alguien más.
`,
    faq: [
      { q: "¿El Inbox reemplaza mi WhatsApp o uso el mismo número?", a: "Se conecta tu mismo número de WhatsApp de la clínica; el Inbox es la manera de ver y organizar esas conversaciones, no un número aparte." },
      { q: "¿Cómo sabemos quién ya respondió a un paciente?", a: "Dentro de Inbox se puede ver el estado de cada conversación, así que el equipo deja de depender de la memoria de cada quien para saber si un mensaje ya se atendió." },
      { q: "¿Los recordatorios por WhatsApp los tiene que escribir alguien cada día?", a: "No uno por uno: los recordatorios y la confirmación de las citas del día siguiente salen ligados a la agenda, sin que alguien tenga que escribirle a cada paciente por separado." },
    ],
    relatedBlogSlugs: ["whatsapp-clinicas-dentales-guia", "confirmacion-citas-whatsapp", "reducir-no-shows-clinica-dental"],
  },
{
    slug: "periodoncia-merida-recalls-de-mantenimiento",
    title: "Cómo una clínica de periodoncia en Mérida puede ordenar el recall de mantenimiento",
    metaTitle: "Periodoncia en Mérida: ordenar los recalls de mantenimiento",
    metaDescription: "Cómo una clínica de periodoncia en Mérida puede usar el periodontograma, la agenda y WhatsApp para dar seguimiento a los recalls de mantenimiento periodontal.",
    city: "Mérida",
    specialty: "periodoncia",
    problem: "Pacientes de mantenimiento que no regresan a su recall",
    modules: ["Periodontograma", "Agenda", "Recordatorios por WhatsApp", "Reportes", "Portal del paciente"],
    excerpt: "En periodoncia el tratamiento no termina en el alta: el paciente necesita mantenimiento cada 3 a 6 meses o pierde lo ganado. Así se puede ordenar ese seguimiento con DaleControl.",
    contentMd: `En periodoncia el alta no existe de la misma forma que en otras especialidades. El paciente termina la fase activa —raspado y alisado radicular, a veces cirugía— y entra a una fase de mantenimiento que dura años: control cada 3, 4 o 6 meses según el caso, con un periodontograma nuevo en cada visita para comparar bolsas, sangrado y recesión contra la medición anterior. Si esa cita de mantenimiento no se agenda de una vez y nadie vuelve a darle seguimiento, el paciente simplemente no regresa.

En una clínica de periodoncia en Mérida el patrón se repite mes con mes: el paciente sale de la fase activa contento, sin dolor, y sin dolor no hay urgencia de volver. Pasan los 4, los 6, los 9 meses. Cuando por fin regresa —muchas veces porque ya sangra al cepillarse otra vez— parte del hueso y la inserción que se habían estabilizado ya se perdieron. El profesional lo sabe: sin recall no hay periodoncia exitosa a largo plazo. El problema no es clínico, es de agenda y seguimiento: nadie en el consultorio tiene una lista clara de quién debería haber vuelto ya y no ha vuelto.

A esto se suma que comparar periodontogramas de visitas distintas a mano —hojas sueltas o PDF guardados en carpetas distintas— toma un tiempo que casi nunca hay entre un paciente y el siguiente, así que la comparación se vuelve superficial o se salta por completo.

## Cómo se configura DaleControl en una clínica de periodoncia

### Periodontograma con historial comparable
Cada visita de mantenimiento se registra en el Periodontograma dentro del expediente del paciente, con profundidades de sondaje, sangrado y recesión por diente y por cara. Al abrir el expediente en la siguiente cita, la medición anterior queda ahí mismo, lista para comparar sitio por sitio sin buscar en otra carpeta ni en otro sistema.

### La cita de mantenimiento se agenda antes de que el paciente se vaya
En vez de dejar el siguiente control a la memoria del paciente, la Agenda permite dejar programada la próxima cita de mantenimiento desde el mismo día de la consulta, con el intervalo que el profesional defina para ese caso —3, 4 o 6 meses según la evolución.

### Recordatorios por WhatsApp para la fecha ya agendada
Como la cita ya existe en el sistema, los Recordatorios por WhatsApp se disparan conforme se acerca la fecha, con opción de confirmar asistencia. El paciente deja de depender de acordarse por su cuenta de cuándo le toca su revisión periodontal.

### Reportes y Portal del paciente para los que se quedan sin cita futura
Para los pacientes que de todos modos se quedan sin una próxima cita —porque cancelaron, porque nunca se agendó o porque ya pasó la fecha— los Reportes arman la lista de pacientes de mantenimiento sin cita futura, para que recepción llame antes de que se conviertan en un caso perdido. El Portal del paciente suma otro canal: ahí el paciente puede ver su próxima cita de mantenimiento y confirmarla sin tener que llamar al consultorio.

## Qué cambia en la operación

Sirve como referencia de tamaño del problema, aunque es una estimación ilustrativa y no un dato de ninguna clínica en particular: si una clínica de periodoncia en Mérida tiene alrededor de 150 pacientes activos en fase de mantenimiento y una tercera parte no tiene hoy una cita futura agendada, son unos 50 pacientes que dependen de que alguien se acuerde de llamarlos. Con la cita de mantenimiento agendada desde el día uno y el recordatorio por WhatsApp saliendo solo, ese número de pacientes sin fecha futura debería ir bajando semana con semana, y el reporte de pendientes deja de depender de la memoria de alguien en particular.

También puede cambiar la calidad de la revisión misma: al tener el periodontograma anterior a la vista, comparar bolsa por bolsa toma minutos en vez de convertirse en una revisión superficial, y el profesional puede mostrarle al paciente, con números concretos, qué sitios mejoraron y cuáles todavía necesitan más atención.

Si quieres ver cómo aplicar esto a tu clínica, puedes revisar cómo funciona la [reactivación de pacientes inactivos](/blog/reactivacion-pacientes-inactivos) y cómo dejar bien configurada la [confirmación de citas por WhatsApp](/blog/confirmacion-citas-whatsapp), para que el recall de mantenimiento no dependa de la buena memoria de nadie.

Crea tu cuenta en DaleControl y prueba con tu equipo cómo se ven el periodontograma, la agenda de mantenimiento y el reporte de pacientes sin cita futura trabajando juntos, con los datos reales de tu clínica.
`,
    faq: [
      { q: "¿El periodontograma compara automáticamente las mediciones contra la visita anterior?", a: "El periodontograma guarda cada medición por diente y cara dentro del expediente, así que al abrir la ficha del paciente el profesional tiene la medición previa a la vista para compararla; la lectura clínica de esa comparación la sigue haciendo el profesional." },
      { q: "¿Qué pasa si el paciente cancela su cita de mantenimiento?", a: "La cita puede reprogramarse desde la Agenda; si el paciente se queda sin una próxima cita, aparece en el reporte de pacientes de mantenimiento sin cita futura para que recepción le dé seguimiento." },
      { q: "¿El recordatorio de la cita de mantenimiento se envía solo?", a: "Sí, el recordatorio por WhatsApp se dispara conforme se acerca la fecha de la cita de mantenimiento ya agendada, sin que alguien tenga que enviarlo a mano cada vez." },
    ],
    relatedBlogSlugs: ["reactivacion-pacientes-inactivos", "confirmacion-citas-whatsapp", "gestion-especialidades-dentales"],
  },
  {
    slug: "protesis-leon-coordinacion-con-laboratorio",
    title: "Cómo una clínica de prótesis en León puede coordinar sus tiempos con el laboratorio dental",
    metaTitle: "Prótesis dental en León: coordinación con el laboratorio",
    metaDescription: "Cómo una clínica de prótesis en León puede dar seguimiento al trabajo de laboratorio con estatus, agenda ligada a la fecha de entrega y aviso al paciente.",
    city: "León",
    specialty: "protesis",
    problem: "Trabajos de laboratorio sin fecha ni estatus claro",
    modules: ["Órdenes de laboratorio", "Agenda", "Expediente clínico", "Recordatorios por WhatsApp"],
    excerpt: "Cuando el trabajo protésico va y viene del laboratorio sin fecha clara, la cita de prueba se agenda a ciegas. Así se puede ordenar ese seguimiento con DaleControl.",
    contentMd: `En una clínica de prótesis en León buena parte del trabajo no ocurre dentro del consultorio: la impresión o el escaneo se toman ahí, pero la corona, el puente o la prótesis parcial o total se fabrican en un laboratorio externo, y ese tramo del proceso suele vivir fuera de cualquier sistema. El estatus del trabajo se entera por llamada telefónica o por algún mensaje de WhatsApp con el técnico, y esa información casi nunca queda escrita en un lugar que el resto del consultorio pueda consultar. Esto se complica todavía más cuando la clínica tiene más de un consultorio o más de un doctor atendiendo casos de prótesis al mismo tiempo, porque el estatus real de cada trabajo termina viviendo solo en la cabeza de quien hizo la última llamada al laboratorio.

El resultado típico: se agenda la cita de prueba de metal o de prueba estética con una fecha que parece razonable, pero nadie confirmó antes con el laboratorio que el trabajo va a estar listo ese día. El paciente llega, la pieza no llegó o llegó incompleta, y la cita se reagenda —con el tiempo de sillón ya perdido y el paciente incómodo por haber pedido permiso en su trabajo para nada. En el sentido contrario también pasa: el trabajo ya está listo en el laboratorio, pero la clínica todavía no lo sabe y el paciente sigue esperando una llamada que no llega.

A esto se suma que las indicaciones de cada caso —color, tipo de material, ajuste de oclusión, alguna observación del técnico— quedan repartidas entre notas de la primera cita, mensajes de WhatsApp sueltos y lo que alguien recuerda, en vez de estar juntas en un solo lugar que cualquiera en el consultorio pueda revisar antes de la siguiente cita del paciente.

## Cómo se configura DaleControl para coordinar al laboratorio

### Órdenes de laboratorio con estatus visible
Cada trabajo que sale a laboratorio se registra como una orden dentro de Órdenes de laboratorio, con el tipo de trabajo, el material y el estatus —enviado, en proceso, listo— visible para todo el consultorio, sin depender de quién contestó la última llamada al técnico.

### Expediente clínico con las indicaciones del caso
Las indicaciones de cada trabajo —color, guía de ajuste, observaciones para la prueba— se registran en el Expediente clínico del paciente, junto con el resto de su historia, así que quien atienda la cita de prueba las tiene a la mano sin buscar en otro lado.

### La Agenda se amarra a la fecha real de entrega
En vez de agendar la cita de prueba a ciegas, la Agenda permite ligar esa cita a la fecha de entrega registrada en la orden de laboratorio, para que la cita se mueva si la fecha de entrega cambia, en vez de quedar fija sobre una fecha que ya no aplica.

### Recordatorios por WhatsApp cuando cambia el estatus
Cuando el estatus de la orden avanza a listo, los Recordatorios por WhatsApp permiten avisar al paciente para confirmar su cita de prueba, en vez de dejar esa llamada pendiente en la lista de cosas por hacer de recepción.

## Qué cambia en la operación

Como referencia de tamaño del problema —una estimación ilustrativa, no un dato real de ninguna clínica—: si una clínica de prótesis en León maneja unos 25 trabajos de laboratorio activos al mismo tiempo y una cuarta parte llega a su cita de prueba sin que el estatus se haya confirmado antes, son varias citas al mes que terminan reagendadas por una pieza que no llegó a tiempo. Con la orden de laboratorio ligada a la agenda, ese tipo de reagendas debería reducirse, porque la cita de prueba solo quedaría confirmada cuando el estatus de la orden lo respalde.

También puede cambiar lo que el paciente percibe: en vez de enterarse de que la pieza no llegó estando ya en la sala de espera, recibiría el aviso por WhatsApp antes de salir de su casa, y el consultorio dejaría de perder tiempo de sillón en citas que de todas formas no se podían atender ese día.

Puertas adentro, la coordinación entre asistentes también puede mejorar: cualquiera que conteste el teléfono tendría forma de revisar el estatus de la orden sin necesidad de buscar al doctor o de esperar a que alguien recuerde de memoria en qué va ese caso en particular.

Para seguir ordenando la agenda alrededor de estos tiempos de espera puedes revisar [cómo organizar la agenda dental](/blog/agenda-dental-organizar-citas) y, si tu clínica maneja varias especialidades restaurativas a la vez, [cómo gestionar varias especialidades dentro del mismo consultorio](/blog/gestion-especialidades-dentales).

Crea tu cuenta en DaleControl y revisa con tu equipo cómo se vería una orden de laboratorio moviéndose junto con la agenda y el expediente del paciente, con los tiempos reales de tu laboratorio.
`,
    faq: [
      { q: "¿DaleControl se conecta directamente con el sistema del laboratorio?", a: "No; la clínica registra el estatus de cada orden —enviado, en proceso, listo— según lo que confirma con el laboratorio, y ese estatus es el que mueve la agenda y el aviso al paciente." },
      { q: "¿Qué pasa si el laboratorio se atrasa?", a: "Se actualiza la fecha de entrega en la orden y la cita ligada a esa orden puede reagendarse desde ahí mismo, sin borrar ni volver a capturar la cita del paciente." },
      { q: "¿Se puede llevar el control de varios laboratorios distintos?", a: "Sí, cada orden se registra con sus propios datos de trabajo y fecha de entrega, sin importar con cuántos laboratorios trabaje la clínica." },
    ],
    relatedBlogSlugs: ["agenda-dental-organizar-citas", "gestion-especialidades-dentales", "experiencia-paciente-dental"],
  },
  {
    slug: "clinica-general-cancun-expediente-en-papel",
    title: "Cómo una clínica general en Cancún puede dejar atrás el expediente de papel",
    metaTitle: "Clínica general en Cancún: del papel al expediente digital",
    metaDescription: "Cómo una clínica general en Cancún puede pasar del expediente en papel al expediente clínico electrónico, con odontograma y datos resguardados.",
    city: "Cancún",
    specialty: "general",
    problem: "Expedientes en papel que se pierden o se mojan",
    modules: ["Expediente clínico", "Odontograma", "Importación desde Excel", "Bitácora", "Verificación en dos pasos", "Portal del paciente"],
    excerpt: "Archiveros llenos, hojas que se humedecen y expedientes que no aparecen cuando el paciente regresa dos años después. Así se puede pasar al expediente clínico electrónico con DaleControl.",
    contentMd: `En una clínica general en Cancún el clima hace su parte: humedad, temporada de lluvias, la cercanía con el mar en varias zonas de la ciudad. Los expedientes en papel guardados en archiveros metálicos o carpetas de cartón se maltratan más rápido que en otras ciudades del país —hojas que se ondulan, tinta que se corre, carpetas que empiezan a oler a humedad. En temporada alta, cuando la clínica atiende tanto a pacientes locales como a quienes solo están de visita, el archivero crece rápido y encontrar un expediente específico entre cientos de carpetas deja de ser cosa de un minuto.

El caso típico: un paciente que se atendió hace dos años vuelve por una urgencia y nadie encuentra su expediente. Puede estar mal archivado, prestado entre consultorios de la misma clínica, o de plano perdido entre la humedad de una gaveta. Sin ese expediente no hay forma rápida de saber qué tratamientos tiene, qué alergias reportó o qué quedó pendiente de la última visita, y el profesional termina reconstruyendo la historia clínica de memoria o repitiendo preguntas que el paciente ya había contestado antes.

En temporada alta, cuando la agenda del día ya está llena de principio a fin, cada minuto que el personal de recepción pasa buscando una carpeta perdida en el archivero es un minuto que no dedica a la fila de pacientes que sí llegaron puntuales a su cita.

A esto se suma que muchas clínicas en esta situación ya tienen un padrón de pacientes armado en una hoja de Excel con los años, pero migrarlo a mano expediente por expediente parece una tarea tan grande que nunca se empieza, y la clínica sigue operando con papel y una hoja de cálculo que tampoco está del todo al día.

## Cómo se configura DaleControl para dejar el papel atrás

### Importación desde Excel del padrón existente
El primer paso no es capturar todo desde cero: la Importación desde Excel permite subir el padrón de pacientes que la clínica ya tiene armado —nombre, contacto, datos básicos— y crear ahí mismo el registro de cada paciente en el sistema, en vez de transcribirlo uno por uno a mano.

### Expediente clínico con odontograma
A partir de ahí, cada consulta se registra en el Expediente clínico, con el Odontograma para dejar constancia diente por diente del estado y los tratamientos realizados, disponible para cualquier profesional de la clínica que atienda después a ese paciente, sin buscar una carpeta física en el archivero.

### Bitácora, verificación en dos pasos y datos cifrados
Como el expediente ahora vive en el sistema y no en un archivero, los datos se guardan cifrados, la Bitácora deja registro de quién abrió cada expediente y cuándo, y la Verificación en dos pasos añade un paso extra al inicio de sesión de cada usuario. Es una forma concreta de resguardar la información de los pacientes, sin que esto sea una certificación oficial de ningún tipo.

### Portal del paciente
El paciente, por su parte, puede entrar al Portal del paciente para ver sus propias citas y documentos, en vez de depender de que la clínica le imprima una copia de algo que ya está en su expediente.

## Qué cambia en la operación

Como referencia de tamaño del problema —una estimación ilustrativa, no un dato de ninguna clínica en particular—: si una clínica general en Cancún tiene alrededor de 2 mil expedientes en papel acumulados a lo largo de varios años y solo importa de golpe los datos básicos de contacto, el resto de la historia clínica se iría completando conforme cada paciente regrese a consulta, sin necesidad de detener la operación para hacer una migración completa de un día para otro. Con el expediente ya en el sistema, encontrar la historia de un paciente que vuelve después de dos años dejaría de depender de qué tan bien archivada quedó su carpeta ese año.

También cambiaría el riesgo físico: un expediente que vive en el sistema no se moja, no se traspapela entre consultorios y no depende de que el archivero aguante otra temporada de humedad. El tiempo que antes se iba en buscar carpetas puede dedicarse a atender pacientes, y dejar de depender de un solo archivero físico quita presión sobre dónde y cómo se resguarda la información de años de historia clínica.

Para profundizar en este cambio puedes revisar [qué es el expediente clínico electrónico](/blog/expediente-clinico-electronico-dental) y [cómo se ve una clínica dental cuando suma más tecnología a su día a día](/blog/clinica-dental-digital-tecnologia).

Crea tu cuenta en DaleControl y prueba con tu equipo cómo se importa un padrón desde Excel y cómo queda el expediente con odontograma de un paciente real de tu clínica.
`,
    faq: [
      { q: "¿Qué tan difícil es pasar el padrón de Excel al sistema?", a: "La Importación desde Excel toma el archivo que la clínica ya tiene armado y crea el registro base de cada paciente; el resto de la historia clínica se va completando conforme cada paciente regresa a consulta." },
      { q: "¿El expediente electrónico tiene alguna certificación oficial?", a: "DaleControl no ofrece ni promete una certificación oficial; sí ofrece expediente clínico electrónico, datos cifrados, bitácora de accesos y verificación en dos pasos como parte del resguardo de la información." },
      { q: "¿Qué pasa con los expedientes en papel que ya existen?", a: "Pueden conservarse como respaldo mientras la clínica hace la transición; no es necesario destruirlos ni migrarlos todos de golpe para empezar a usar el expediente electrónico con los pacientes que van llegando." },
    ],
    relatedBlogSlugs: ["expediente-clinico-electronico-dental", "clinica-dental-digital-tecnologia", "normativas-clinicas-dentales-mexico"],
  },
  {
    slug: "ortodoncia-cdmx-control-de-mensualidades",
    title: "Cómo una clínica de ortodoncia en Ciudad de México puede llevar el control de las mensualidades",
    metaTitle: "Ortodoncia en CDMX: control de mensualidades al día",
    metaDescription: "Cómo una clínica de ortodoncia en Ciudad de México puede llevar el control de las mensualidades, con el saldo del paciente visible en caja y en agenda.",
    city: "Ciudad de México",
    specialty: "ortodoncia",
    problem: "Mensualidades de ortodoncia que nadie sabe si están pagadas",
    modules: ["Caja", "Finanzas", "Reportes", "Agenda", "Facturación"],
    excerpt: "Un tratamiento de ortodoncia se cobra en mensualidades durante año y medio o más. Así se puede llevar el control de quién viene al corriente con DaleControl.",
    contentMd: `Un tratamiento de ortodoncia en Ciudad de México se cobra casi siempre en mensualidades, a lo largo de 18 a 24 meses o más si el caso se extiende. Eso significa que, a diferencia de un tratamiento que se paga una sola vez, la clínica tiene que llevar el control de decenas o cientos de pacientes con pagos parciales al mismo tiempo, cada uno en un punto distinto de su plan de pagos.

En la práctica, recepción suele enterarse de si un paciente viene al corriente hasta que revisa un cuaderno, una hoja de Excel aparte o pregunta directamente al área de cobranza, y eso casi nunca ocurre antes de que el paciente ya esté sentado en el sillón. El resultado típico: el ortodoncista ajusta el arco o cambia las ligas de un paciente que debe dos o tres mensualidades, porque en el momento de la cita nadie tenía el saldo a la vista para decidir si convenía hablar del tema antes de continuar con el ajuste.

Preguntar directamente por el pago pendiente también resulta incómodo para el personal de recepción, sobre todo si el paciente lleva mucho tiempo con la clínica o si es un tratamiento familiar con varios hermanos atendiéndose al mismo tiempo; sin un saldo claro a la vista, esa conversación se evita en vez de tenerla a tiempo, y la deuda sigue creciendo mes con mes sin que nadie la nombre.

Con el tiempo esto se vuelve un patrón: los pacientes que se atrasan una vez tienden a atrasarse de nuevo si nadie les muestra su saldo de forma clara y constante, y la clínica termina financiando tratamientos completos sin haberlo decidido así, simplemente porque el control de pagos vive separado del control de citas.

## Cómo se configura DaleControl para ordenar las mensualidades

### Caja con el saldo del paciente a la vista
Cada pago de mensualidad se registra en Caja, y el saldo pendiente del plan de ortodoncia queda visible ahí mismo al buscar al paciente, en vez de tener que cruzar esa información con una hoja aparte.

### Agenda que muestra el estado de cuenta al recibir
Al abrir la cita del día, la Agenda permite ver el estado de cuenta del paciente que está por pasar, así que recepción sabe antes de que se siente en el sillón si viene al corriente o si arrastra mensualidades pendientes.

### Finanzas y Reportes de saldos por paciente
Finanzas concentra el panorama de cobros del mes, mientras que los Reportes arman el listado de pacientes con saldo pendiente y cuántas mensualidades deben, para que el área de cobranza tenga una lista concreta de a quién contactar en vez de revisar cuenta por cuenta. Ese mismo reporte puede revisarse antes de la junta semanal del equipo, para decidir a quién llamar primero y con qué prioridad, en vez de improvisar la lista de cobranza cada mes.

### Facturación de los pagos registrados
Cada mensualidad cobrada puede facturarse desde el mismo registro del pago, así que al cierre de mes la clínica tiene organizado qué se facturó y qué sigue pendiente de facturar, sin reconstruir la información desde cero.

## Qué cambia en la operación

Como referencia de tamaño del problema —una estimación ilustrativa, no un dato de ninguna clínica en particular—: si una clínica de ortodoncia en Ciudad de México lleva unos 120 tratamientos activos en mensualidades y una quinta parte trae algún atraso en un momento dado, son alrededor de 24 pacientes cuyo saldo alguien tendría que estar revisando manualmente cada mes. Con el saldo visible desde la Agenda y desde Caja, la conversación sobre el pago pendiente podría darse antes del ajuste y no después, y la clínica decidiría con información, no por omisión, si de todas formas continúa el tratamiento.

También cambiaría el trabajo de cobranza: en vez de perseguir pago por pago sin un orden claro, el reporte de saldos pendientes daría una lista priorizada de a quién contactar primero, según cuánto debe y desde cuándo.

Para el paciente también cambia la experiencia: en vez de enterarse de su atraso frente a otras personas en la sala de espera, podría resolver su saldo con recepción de forma directa, sin sorpresas incómodas justo antes de sentarse en el sillón. Y al ortodoncista le quitaría la parte más incómoda del proceso: decidir, sillón por sillón y caso por caso, si vale la pena mencionar un pago atrasado en medio de la consulta.

Para seguir ordenando este tema puedes revisar [cómo dar seguimiento a los presupuestos pendientes](/blog/seguimiento-presupuestos-pendientes-dental) y esta [guía de finanzas para clínicas dentales](/blog/finanzas-clinica-dental-guia).

Crea tu cuenta en DaleControl y prueba con tu equipo cómo se ve el saldo de un paciente en caja, en agenda y en el reporte de mensualidades pendientes, con los datos reales de tu clínica.
`,
    faq: [
      { q: "¿El sistema bloquea la cita de un paciente que debe mensualidades?", a: "No; DaleControl muestra el saldo pendiente en la agenda y en caja para que la clínica decida cómo manejar cada caso, no bloquea citas ni decide en automático." },
      { q: "¿Cómo se entera recepción de que un paciente debe mensualidades?", a: "Al abrir la cita del día en la Agenda, el estado de cuenta del paciente aparece junto con el resto de su información, sin tener que consultar otra hoja ni preguntar a cobranza." },
      { q: "¿La facturación se hace mensualidad por mensualidad?", a: "Cada pago registrado en Caja puede facturarse desde ese mismo registro, así que la clínica lleva el control de qué mensualidades ya se facturaron." },
    ],
    relatedBlogSlugs: ["seguimiento-presupuestos-pendientes-dental", "finanzas-clinica-dental-guia", "facturacion-dentistas-mexico-cfdi"],
  },
{
    slug: "clinica-general-toluca-control-de-inventario",
    title: "Cómo una clínica general en Toluca puede dejar de quedarse sin material a media consulta",
    metaTitle: "Control de inventario dental para clínicas en Toluca",
    metaDescription: "Cómo una clínica general en Toluca puede organizar su inventario dental para no quedarse sin material clave ni inmovilizar dinero en insumos que casi no usa.",
    city: "Toluca",
    specialty: "general",
    problem: "Material que se acaba justo el día que se necesita",
    modules: ["Inventario", "Procedimientos", "Agenda", "Reportes", "Analytics"],
    excerpt: "Cuando falta la resina del tono correcto a media consulta o sobra material que nadie usa, el inventario dejó de ser un tema menor para la clínica.",
    contentMd: `## Cuando el sillón se queda a medias por falta de material

En una clínica general de Toluca con agenda llena, el día suele avanzar sin sobresaltos hasta que, a media consulta, la asistente abre el cajón de resinas y no encuentra el tono que necesita el doctor para esa restauración. El paciente sigue sentado, la anestesia ya hizo efecto, y ahora hay que decidir entre usar un tono que no es el ideal o reagendar. Lo mismo pasa con agujas, cementos o material de impresión: nadie se da cuenta de que se acabó hasta el momento exacto en que se necesita.

El otro lado del mismo problema es menos visible pero igual de caro: en la bodega o el clóset de la clínica hay cajas de un material que se compró en promoción hace meses y que casi no se usa, dinero de la clínica guardado en un anaquel en vez de circulando. Sin un registro claro, es difícil saber qué tanto hay de cada cosa, qué se mueve rápido y qué lleva ahí desde el semestre pasado. La única fuente de verdad suele ser la memoria de quien surte, o una libreta que no siempre se actualiza.

Para una clínica general, donde el consumo de material cambia según cuántas resinas, limpiezas o extracciones caigan en la semana, esta doble cara del problema —faltantes justo cuando se necesitan, sobrantes que no se mueven— es de las cosas que más tiempo roba sin que se note en ningún reporte financiero directo.

## Cómo se configura DaleControl

### Dar de alta los artículos por categoría

El primer paso es cargar en Inventario los artículos que la clínica realmente usa, agrupados por categoría —anestesia, resinas, materiales de impresión, insumos de bioseguridad— con su cantidad actual. No hace falta capturar todo el consultorio el primer día: conviene empezar por lo que más problemas ha dado en los últimos meses e ir sumando el resto poco a poco.

### Definir el mínimo de cada artículo

Cada artículo tiene su propio mínimo, no uno general para todo el inventario. Una resina de uso diario puede necesitar un mínimo más alto que un material que se usa una vez al mes. En cuanto la cantidad cae por debajo de ese número, el artículo cambia de disponible a stock bajo, y si llega a cero, a agotado.

### Revisar los KPIs antes de surtir

Antes de hacer un pedido al proveedor, tiene sentido revisar los KPIs de Inventario: total de artículos, cuántos están en stock bajo, cuántos agotados y el valor total de lo que hay guardado. Con eso a la vista, decidir qué comprar deja de ser una corazonada y se vuelve una revisión de cinco minutos.

### Cruzar el consumo con Procedimientos, Agenda y Reportes

El catálogo de Procedimientos ayuda a tener claro qué tratamientos se agendaron para la semana, y la Agenda muestra cuántas citas de cada tipo vienen. Cruzando eso con lo que marca Inventario como bajo o agotado, la clínica puede anticipar si el material alcanza antes de que el paciente esté sentado en el sillón. Reportes, revisado cada cierto tiempo, ayuda a ver si esos faltantes se repiten siempre en el mismo artículo, señal de que su mínimo está mal calculado.

Vale la pena aclarar el alcance real: Inventario no genera pedidos de compra automáticos ni calcula caducidades, es la clínica quien decide cuánto y cuándo comprar con la información que el módulo le da.

## Qué cambia en la operación

En un escenario típico, si la clínica revisa el estado del inventario una vez por semana en vez de descubrir los faltantes sobre la marcha, podría reducir el número de veces que una consulta se interrumpe para salir a comprar algo. Si la clínica hace, por decir un número ilustrativo, unas 15 restauraciones a la semana, tener claro qué tonos de resina están en stock bajo antes del lunes podría evitar más de una sorpresa. Del otro lado, ver el valor total del inventario ayuda a notar cuando hay capital inmovilizado en algo que casi no se usa, y decidir con calma si conviene seguir comprándolo en esa cantidad.

Nada de esto sustituye el criterio de quien surte la clínica: el sistema ordena la información para que decidir sea más rápido, no decide por nadie.

## Prueba cómo se vería en tu clínica

Si en tu clínica el material se acaba justo cuando el paciente ya está en el sillón, o hay cajas de algo caro que nadie recuerda por qué se compró, vale la pena [ver cómo organizar mejor la administración de la clínica](/blog/como-administrar-clinica-dental) y [entender qué tanto pesa esto en las finanzas del consultorio](/blog/finanzas-clinica-dental-guia). Crea tu cuenta en DaleControl y pruébalo con tu equipo para ver si el orden en el inventario cambia el día a día.
`,
    faq: [
      { q: "¿Tengo que dar de alta cada insumo, hasta el algodón?", a: "No es necesario empezar por todo. Conviene cargar primero lo que más problemas ha dado —lo que se agota seguido o lo que cuesta caro— e ir sumando el resto del inventario poco a poco." },
      { q: "¿El inventario hace pedidos de compra solo cuando algo se agota?", a: "No. El módulo marca el estado de cada artículo como disponible, stock bajo o agotado, pero la decisión de comprar y el pedido al proveedor los sigue haciendo la clínica." },
      { q: "¿Cómo sé qué tanto material voy a necesitar la próxima semana?", a: "Cruzando la Agenda y el catálogo de Procedimientos de la semana con lo que Inventario marca como bajo o agotado, antes de que el paciente esté sentado en el sillón." },
    ],
    relatedBlogSlugs: ["como-administrar-clinica-dental", "finanzas-clinica-dental-guia", "punto-equilibrio-consultorio-dental"],
  },
  {
    slug: "estetica-dental-monterrey-fotografia-clinica",
    title: "Cómo una clínica de estética dental en Monterrey puede dejar de perder las fotos de antes y después",
    metaTitle: "Fotos de antes y después en clínicas de estética Monterrey",
    metaDescription: "Cómo una clínica de estética dental en Monterrey puede guardar sus fotos de antes y después en el expediente del paciente en vez de perderlas entre celulares.",
    city: "Monterrey",
    specialty: "estetica",
    problem: "Fotos clínicas perdidas en el celular de cada quien",
    modules: ["Antes/Después", "Expediente clínico", "Portal del paciente", "Reseñas"],
    excerpt: "Cuando la foto del antes vive en un celular y la del después en otro, mostrar el resultado real de un caso de estética se vuelve cuestión de suerte.",
    contentMd: `## Las fotos del caso, repartidas en el celular de cada quien

En una clínica de estética dental en Monterrey, buena parte del trabajo se demuestra con fotos: el antes de un diseño de sonrisa, el después de unas carillas recién cementadas, el contraste de un blanqueamiento. El problema es dónde terminan viviendo esas fotos. La asistente toma la del antes con su propio celular porque es la que está más cerca en ese momento, el doctor toma la del después con el suyo al terminar la cirugía o la cementación, y cada quien las guarda donde puede: la galería del teléfono, un chat de WhatsApp, una carpeta que alguien prometió subir a la computadora y nunca subió.

El problema aparece cuando se necesitan esas fotos: un paciente nuevo pregunta cómo se ve un resultado parecido al que busca, o la clínica quiere mostrar un caso en sus redes, o simplemente se quiere comparar cómo avanzó un tratamiento de varias sesiones. Buscar la foto correcta implica preguntar quién la tomó, en qué celular quedó, si ese celular sigue siendo el mismo o ya se cambió. Cuando la asistente que tomó la foto original ya no trabaja ahí, el caso completo puede perderse.

Para una especialidad donde el resultado visual es la mitad de la conversación con el paciente, no tener esas fotos organizadas y a la mano es perder una de las herramientas más convincentes que tiene la clínica.

## Cómo se configura DaleControl

### Guardar la foto en el expediente, no en el celular

En lugar de que la foto quede en un dispositivo personal, se sube al Expediente clínico del paciente en el momento en que se toma, ya sea la del antes en la primera cita o la del después al terminar el tratamiento. Desde ahí queda ligada a ese paciente y a ese caso, disponible para quien tenga acceso al expediente, sin depender de a quién le tocó tomarla.

### Organizar el antes y el después dentro del mismo caso

El módulo Antes/Después ordena esas fotos para verlas una junto a la otra, incluso cuando el tratamiento tomó varias sesiones —la prueba de las carillas, el ajuste, la cementación final— y las fotos se tomaron semanas aparte. Ver la evolución completa en un solo lugar es distinto a reconstruirla de memoria.

### Compartir el resultado con el paciente por el Portal

El Portal del paciente permite que el propio paciente vea sus fotos de antes y después cuando quiera, sin tener que pedirlas por WhatsApp. Para alguien que acaba de invertir en un tratamiento estético, poder entrar y ver su propio caso documentado suele reforzar que valió la pena.

### Invitar a dejar una Reseña en el momento correcto

Justo después de que el paciente ve su resultado en el portal suele ser el mejor momento para invitarlo a dejar una reseña a través del módulo correspondiente, mientras la satisfacción está fresca, en vez de esperar semanas y depender de que se acuerde por su cuenta.

Un punto aparte, pero importante: usar las fotos de un paciente para mostrar un caso a otro paciente o en redes sociales requiere su consentimiento. DaleControl te da un lugar ordenado para guardar y comparar las fotos; pedir permiso para usarlas fuera del expediente sigue siendo una responsabilidad de la clínica, no algo que el sistema resuelva por sí solo.

## Qué cambia en la operación

En un escenario ilustrativo, si la clínica atiende un puñado de casos de estética al mes —digamos, alrededor de 10 o 12 entre carillas, blanqueamientos y diseños de sonrisa— tener cada uno documentado en su expediente podría ahorrar el tiempo que hoy se va en buscar fotos dispersas cada vez que se quiere mostrar un caso. También podría facilitar reunir, con el consentimiento correspondiente, un grupo de casos reales para mostrar en el consultorio o en redes, en lugar de depender de lo que quedó guardado por casualidad en algún celular.

## Prueba cómo se vería en tu clínica

Si hoy el antes y el después de tus casos de estética viven repartidos entre celulares, vale la pena revisar [cómo armar un expediente clínico electrónico completo](/blog/expediente-clinico-electronico-dental) y [qué tanto influye la experiencia del paciente en que te recomiende](/blog/experiencia-paciente-dental). Crea tu cuenta en DaleControl y pruébalo con tu equipo para ver cómo se vería tu propio historial de casos ya ordenado.
`,
    faq: [
      { q: "¿Las fotos quedan visibles para el paciente de forma automática?", a: "Quedan guardadas en el expediente clínico; tú decides cuáles compartir con el paciente a través del portal." },
      { q: "¿Necesito pedir permiso al paciente para usar sus fotos en redes o con otros pacientes?", a: "Sí. DaleControl te da un lugar ordenado para guardarlas y compararlas, pero pedir el consentimiento del paciente para usarlas fuera de su expediente sigue siendo responsabilidad de la clínica." },
      { q: "¿Puedo comparar fotos de hace varios meses con las de ahora?", a: "Sí, siempre que se hayan subido al expediente en su momento. El módulo Antes/Después las organiza para verlas juntas aunque el tratamiento haya tomado varias sesiones." },
    ],
    relatedBlogSlugs: ["expediente-clinico-electronico-dental", "experiencia-paciente-dental", "branding-consultorio-dental"],
  },
  {
    slug: "clinica-general-san-luis-potosi-reportes",
    title: "Cómo una clínica general en San Luis Potosí puede dejar de decidir a ciegas y ver sus números reales",
    metaTitle: "Reportes financieros para clínicas en San Luis Potosí",
    metaDescription: "Cómo una clínica general en San Luis Potosí puede usar reportes, analytics y caja para saber cuánto entró, qué tratamiento deja más y dejar de decidir a ciegas.",
    city: "San Luis Potosí",
    specialty: "general",
    problem: "Decisiones a ciegas por falta de reportes",
    modules: ["Reportes", "Analytics", "Finanzas", "Caja", "Agenda"],
    excerpt: "Decidir con lo que muestra el banco al final del mes llega tarde: reportes, caja y analytics ayudan a ver la operación real antes de que el mes ya haya pasado.",
    contentMd: `## Decidir por intuición hasta que ya no alcanza

Quien dirige una clínica general en San Luis Potosí normalmente no tiene tiempo de sentarse a analizar números: entre atender pacientes, coordinar al equipo y resolver lo urgente del día, la administración se hace con lo que se puede. Al cierre de mes, alguien revisa cuánto hay en la cuenta del banco y de ahí se calcula, más o menos, si el mes estuvo bien o mal. Nadie sabría decir con precisión cuánto entró en marzo comparado con febrero, ni si ese ingreso vino más de limpiezas de rutina o de tratamientos de mayor valor.

Esa falta de información no se nota en el día a día, hasta que llega el momento de pagar nómina o renta y el dinero no alcanza como se esperaba. En ese punto ya es tarde para reaccionar: el mes flojo ya pasó, y lo único que queda es tratar de entender qué salió mal, casi siempre con explicaciones que suenan más a corazonada que a dato. La decisión de qué tratamiento impulsar, qué día de la semana reforzar con promoción o si conviene contratar a alguien más, termina basándose en impresión general y no en lo que de verdad muestra la operación.

Para una clínica que ya tiene varios años y varios dentistas atendiendo, seguir administrando así deja de alcanzar: el negocio creció, pero la manera de entenderlo se quedó del tamaño de un consultorio de un solo dentista.

## Cómo se configura DaleControl

### Registrar cada cobro en Caja

Todo empieza por registrar en Caja cada cobro, con su forma de pago y el corte correspondiente. Sin ese registro consistente del día a día, no hay información real de la que partir para cualquier reporte posterior.

### Dar seguimiento al dinero con Finanzas

Finanzas concentra la vista de ingresos y egresos de la clínica, de forma que no haga falta revisar el estado de cuenta del banco para tener una idea de cómo va el mes. Es el punto intermedio entre el cobro diario en Caja y la pregunta más grande de cómo va el negocio.

### Revisar Reportes por periodo

Reportes permite comparar un periodo contra otro —este mes contra el anterior, esta semana contra la misma semana del mes pasado— y ver la mezcla de tratamientos que se están cobrando, no solo el total. Ahí empieza a verse, por ejemplo, si lo que más ingresos deja no es necesariamente lo que más se agenda.

### Ver el panorama completo con Analytics y Agenda

Analytics suma la vista de mediano plazo: cómo se ha movido la ocupación de la agenda, qué proporción de pacientes son nuevos contra los que ya eran de la clínica, en qué momentos del mes o de la semana baja la actividad. Cruzado con la Agenda del día a día, ayuda a distinguir un bache pasajero de una tendencia que merece atención.

Preguntas como cuánto entró el mes pasado, qué tratamiento deja más margen, qué tan llena está realmente la agenda o cuántos pacientes nuevos llegaron contra cuántos son recurrentes, dejan de responderse por impresión general y empiezan a responderse con lo que la propia clínica ya registró.

## Qué cambia en la operación

En un escenario ilustrativo, si la clínica revisa estos reportes cada semana en lugar de una vez al cierre del año, podría notar un mes flojo con semanas de anticipación en vez de descubrirlo cuando ya no alcanza para cubrir un gasto fijo. Si, por dar un número de ejemplo, la agenda tiene unas 20 citas posibles al día pero solo se están llenando 14, verlo reflejado en un reporte facilita decidir si conviene ajustar horarios, reforzar recordatorios o revisar qué días quedan más vacíos, en lugar de sentir vagamente que algo anda mal sin poder señalar qué.

Los reportes no deciden por quien dirige la clínica; ordenan la información para que la decisión, sea cual sea, se tome con algo más sólido que una impresión.

## Prueba cómo se vería en tu clínica

Si hoy administras tu clínica revisando el banco al final del mes y esperando que alcance, vale la pena leer sobre [cómo llevar las finanzas de tu consultorio bajo control](/blog/finanzas-clinica-dental-guia) y [cómo calcular el punto de equilibrio real de tu clínica](/blog/punto-equilibrio-consultorio-dental). Crea tu cuenta en DaleControl y pruébalo con tu equipo para ver tus propios números en lugar de una corazonada.
`,
    faq: [
      { q: "¿Tengo que ser bueno con los números para entender los reportes?", a: "No. Se presentan a partir de lo que ya registras todos los días en Caja y Agenda, para que la lectura sea directa sin necesidad de análisis financiero avanzado." },
      { q: "¿Puedo ver qué tratamiento deja más dinero, no solo cuál se hace más seguido?", a: "Sí, Reportes y Analytics muestran la mezcla de tratamientos y los ingresos asociados a cada uno, no solo cuántas veces se agendó cada tipo de cita." },
      { q: "¿Necesito capturar información aparte para que esto funcione?", a: "No. Los reportes se alimentan de lo que ya registras en Caja, Finanzas y Agenda día a día, sin doble captura." },
    ],
    relatedBlogSlugs: ["finanzas-clinica-dental-guia", "punto-equilibrio-consultorio-dental", "como-administrar-clinica-dental"],
  },
  {
    slug: "implantes-guadalajara-cbct-y-estudios",
    title: "Cómo una clínica de implantes en Guadalajara puede tener sus tomografías siempre a la mano",
    metaTitle: "CBCT y estudios organizados para clínicas de implantes",
    metaDescription: "Cómo una clínica de implantes en Guadalajara puede guardar sus estudios de CBCT en el expediente del paciente en vez de perderlos entre USB y links vencidos.",
    city: "Guadalajara",
    specialty: "implantes",
    problem: "Tomografías y estudios repartidos en USB y correos",
    modules: ["Visor 3D CBCT", "Radiografías con IA", "Expediente clínico", "Agenda"],
    excerpt: "Cuando el estudio de CBCT llega por USB o por un link que caduca, planear la cirugía de implante puede volverse una búsqueda de último momento.",
    contentMd: `## El estudio que no aparece el día de la cirugía

Una clínica de implantes en Guadalajara casi nunca toma la tomografía en el propio consultorio: manda al paciente a un centro de imagen, y de ahí regresa con un USB o un link para descargar el estudio que, en muchos casos, caduca a los pocos días. Ese archivo pesado termina guardado donde alguien tuvo espacio en ese momento —la computadora del doctor, la de la recepción, a veces ambas con versiones distintas— y ahí se queda, sin ninguna relación clara con el expediente del paciente.

El problema se nota justo cuando más incomoda: al planear la cirugía. El doctor quiere revisar la posición del nervio dentario, el ancho de hueso disponible o la cercanía del seno maxilar antes de decidir dónde y cómo colocar el implante, y el estudio no aparece. Está en otra computadora, el link ya venció, o nadie recuerda en qué USB quedó. Lo que debería ser una revisión tranquila del caso se convierte en una búsqueda de último momento, o en reagendar la cirugía porque el estudio no está listo para consultarse.

Para una especialidad donde la planeación depende de ver bien la anatomía en tres dimensiones, no tener el estudio centralizado no es un detalle administrativo: es un riesgo directo sobre qué tan bien preparada llega la clínica al día de la cirugía.

## Cómo se configura DaleControl

### Subir el estudio al expediente en cuanto llega

En lugar de dejarlo en el USB o esperar a que alguien lo baje del link antes de que caduque, el estudio se sube al Expediente clínico del paciente apenas la clínica lo recibe. Desde ese momento queda ligado a ese caso de manera permanente, sin depender de en qué computadora se guardó ni de si el link del centro de imagen sigue activo.

### Revisar el caso en el Visor 3D CBCT

Con el estudio ya en el expediente, el doctor lo abre en el Visor 3D CBCT las veces que necesite antes de la cirugía, para recorrer los cortes y reconstrucciones y evaluar con calma la anatomía del paciente. Aquí conviene ser precisos: es un visor. Ayuda a ver el estudio con claridad, pero la planeación del caso —dónde colocar el implante, qué tan seguro es hacerlo, si hace falta un procedimiento adicional— la decide el doctor con su criterio clínico, no un algoritmo.

### Usar Radiografías con IA solo en el seguimiento 2D

Aparte del CBCT, el seguimiento del implante suele incluir radiografías periapicales o panorámicas en dos dimensiones, antes y después de la cirugía. Ahí sí entra Radiografías con IA, como apoyo asistivo que puede señalar algo que valga la pena revisar con más cuidado. Es importante no mezclar los dos módulos: el visor 3D no analiza con inteligencia artificial, y el análisis con IA no aplica al CBCT, son dos herramientas separadas para dos tipos de estudio distintos.

### Dejar todo agendado alrededor del mismo caso

La Agenda conecta la consulta de planeación, el día de la cirugía y las citas de seguimiento con ese mismo expediente, de forma que cualquiera del equipo que abra el caso encuentre el estudio, las radiografías de control y las próximas citas en un solo lugar.

## Qué cambia en la operación

En un escenario ilustrativo, si la clínica realiza un número reducido de cirugías de implante al mes —pongamos, entre 6 y 10— tener el estudio siempre disponible en el expediente en lugar de rastrearlo en un USB podría evitar más de una reprogramación por no tener la tomografía lista el día acordado. También ayudaría a que, si el paciente cambia de sede o lo atiende otro dentista de la misma clínica, el estudio siga ahí sin depender de quien lo recibió originalmente.

Ni el visor ni la IA reemplazan el criterio del cirujano: ordenan la información para que esté disponible en el momento exacto en que se necesita, que es justo lo que hoy suele fallar.

## Prueba cómo se vería en tu clínica

Si hoy tus estudios de CBCT viajan entre USB y links que caducan, vale la pena revisar [cómo mantener un expediente clínico electrónico centralizado](/blog/expediente-clinico-electronico-dental) y [qué tanto puede o no hacer la inteligencia artificial en odontología](/blog/inteligencia-artificial-odontologia). Crea tu cuenta en DaleControl y pruébalo con tu equipo para tener cada estudio en el lugar donde de verdad se necesita.
`,
    faq: [
      { q: "¿El visor 3D interpreta la tomografía por mí?", a: "No. Es un visor para recorrer cortes y reconstrucciones del CBCT con claridad; la planeación del caso y la decisión clínica siguen siendo del doctor." },
      { q: "¿La IA de radiografías también funciona con el CBCT?", a: "No. Radiografías con IA aplica solo a radiografías 2D, como periapicales o panorámicas, y siempre de forma asistiva. El CBCT se revisa aparte, en el Visor 3D CBCT." },
      { q: "¿Qué hago si el centro de imagen me entrega el estudio por USB?", a: "Subes el archivo al expediente del paciente en cuanto lo recibes, para que quede ligado a ese caso y ya no dependa de dónde quedó el USB o si el link sigue activo." },
    ],
    relatedBlogSlugs: ["expediente-clinico-electronico-dental", "inteligencia-artificial-odontologia", "gestion-especialidades-dentales"],
  },
{
    slug: "clinica-general-aguascalientes-portal-del-paciente",
    title: "Cómo una clínica general en Aguascalientes puede reducir las llamadas por dudas repetidas",
    metaTitle: "Portal del paciente para clínicas en Aguascalientes",
    metaDescription: "Cómo una clínica general en Aguascalientes puede usar el portal del paciente y WhatsApp para bajar las llamadas repetidas a recepción sin dejar de resolverlas.",
    city: "Aguascalientes",
    specialty: "general",
    problem: "El teléfono suena todo el día por dudas repetidas",
    modules: ["Agenda", "Recordatorios por WhatsApp", "Portal del paciente", "Expediente clínico", "Caja", "Inbox"],
    excerpt: "Cuando el teléfono no para de sonar por las mismas preguntas, la recepción pierde tiempo que podría dedicar a quien está en la clínica. Un portal del paciente ayuda a ordenar esto.",
    contentMd: `## Cuando la recepción vive contestando lo mismo

En una clínica general de Aguascalientes con dos o tres sillones y un flujo constante de pacientes, la recepción suele pasar buena parte del día contestando llamadas que se repiten: a qué hora es mi cita, cuánto es lo que debo, me puedes mandar otra vez la receta, ¿ya llegó mi radiografía? Ninguna de esas preguntas es complicada, pero cada una interrumpe lo que la persona en el mostrador está haciendo, que casi siempre es atender a alguien que sí está enfrente.

El problema no es que falte personal, es que buena parte de esas llamadas son evitables: son preguntas cuya respuesta ya existe en algún lugar del sistema, solo que el paciente no tiene forma de verla sin marcar. Si la clínica agenda alrededor de 20 citas al día, no es raro que la recepción reciba varias llamadas solo para confirmar horarios o pedir un documento que ya se generó antes. Eso se acumula en horas de trabajo que no suman a la atención directa, y en pacientes frustrados por no poder resolver algo tan simple sin esperar en la línea.

Esto se nota más los lunes y después de un puente, cuando se juntan los mensajes que quedaron pendientes del fin de semana y la agenda del día ya está llena desde temprano. La persona en recepción termina decidiendo, llamada tras llamada, entre resolver la duda de quien marca por teléfono y atender bien a quien ya está sentado esperando su turno.

## Cómo se configura DaleControl

### Agenda y recordatorios por WhatsApp

Lo primero es que la clínica pase su calendario a la Agenda de DaleControl, con horarios reales por sillón y por doctor. A partir de ahí, los Recordatorios por WhatsApp se encargan de avisar la cita con tiempo y de confirmar la asistencia, que es justo el tipo de pregunta (¿a qué hora era mi cita?) que más se repite por teléfono.

### Activar el portal del paciente

Con la agenda ya en orden, se activa el Portal del paciente para que cada persona entre a ver sus próximas citas, el saldo pendiente y los documentos que la clínica le haya dejado disponibles, como una receta o una indicación por escrito. Esto no depende de que alguien conteste el teléfono: el paciente lo revisa cuando quiere, a la hora que le acomode.

### Expediente y caja como fuente de lo que se muestra

El Portal del paciente muestra lo que ya vive en el Expediente clínico y en Caja, así que la clínica no duplica información: si el saldo se actualiza al registrar un pago, eso es lo que el paciente ve del otro lado. Conviene revisar [cómo suele fallar la confirmación de citas por WhatsApp](/blog/confirmacion-citas-whatsapp) para ajustar los tiempos de envío según el tipo de cita y reducir aún más las llamadas de último momento.

### Ordenar lo que llega por Inbox

Las dudas que sí necesitan a una persona, como una molestia después de un tratamiento o una reprogramación, llegan por el Inbox, donde quedan escritas y se pueden atender en orden, en vez de competir con el teléfono sonando al mismo tiempo que hay alguien esperando en recepción. Con el tiempo, esto también deja un historial de la conversación con cada paciente, útil cuando alguien retoma el tema días después y nadie recuerda con precisión en qué había quedado la respuesta.

## Qué cambia en la operación

Es honesto decir que el portal no elimina las llamadas: las reduce. Un paciente que ya revisó su cita y su saldo desde el celular deja de marcar por eso, pero sigue llamando cuando tiene una duda que de verdad necesita la opinión de alguien de la clínica. En un escenario típico, si una clínica recibe a diario una cantidad relevante de llamadas por horarios, saldos o documentos, una parte de esas podría dejar de llegar porque el paciente resuelve solo desde el portal, lo cual libera minutos de recepción que se notan a lo largo de la semana.

Lo que sí cambia de forma más clara es la sensación de control: la recepción deja de repetir la misma explicación diez veces al día y puede dedicarle más atención a quien está frente al mostrador o a las llamadas que de verdad requieren una decisión. Vale la pena revisar también [qué tanto pesa la experiencia del paciente fuera del consultorio](/blog/experiencia-paciente-dental) antes de decidir qué tan visible se hace el portal desde el primer contacto con cada paciente nuevo.

Si tu clínica ya siente que el teléfono compite con la atención en persona, vale la pena crear una cuenta en DaleControl y probar la Agenda, los recordatorios y el portal con tu equipo durante unas semanas, para ver cuánto de esa carga se puede mover del teléfono hacia algo que el paciente resuelve solo.
`,
    faq: [
      { q: "¿El portal del paciente elimina por completo las llamadas a recepción?", a: "No del todo. Reduce las llamadas por dudas que el paciente puede resolver solo, como su horario o su saldo, pero las consultas que requieren una decisión de la clínica van a seguir llegando por teléfono o por el Inbox." },
      { q: "¿Los pacientes necesitan instalar una aplicación para usar el portal?", a: "No, se accede desde el navegador con el acceso que la clínica comparte, sin depender de descargar nada adicional." },
      { q: "¿Qué tan seguido hay que actualizar la información para que el portal sirva?", a: "El portal muestra lo que ya está en el Expediente clínico y en Caja, así que se mantiene al día conforme el equipo registra citas, pagos y documentos en su operación normal." },
    ],
    relatedBlogSlugs: ["confirmacion-citas-whatsapp", "experiencia-paciente-dental", "agenda-dental-organizar-citas"],
  },
  {
    slug: "odontopediatria-cdmx-agenda-familiar",
    title: "Cómo una odontopediatría en Ciudad de México puede ordenar la agenda cuando varios hermanos necesitan cita el mismo día",
    metaTitle: "Agenda familiar para odontopediatría en CDMX",
    metaDescription: "Cómo una clínica de odontopediatría en Ciudad de México puede agendar a varios hermanos el mismo día sin que un imprevisto desordene toda la tarde.",
    city: "Ciudad de México",
    specialty: "odontopediatria",
    problem: "Hermanos que necesitan cita el mismo día y no cuadra",
    modules: ["Agenda", "Recursos", "Expediente clínico", "Odontograma", "Recordatorios por WhatsApp", "Portal del paciente"],
    excerpt: "Cuando una mamá lleva a tres hijos y quiere resolverlos en una sola visita, cuadrar los horarios a mano es un rompecabezas que se cae si alguno falta ese día.",
    contentMd: `## Tres hermanos, una sola tarde libre

En una clínica de odontopediatría en Ciudad de México es común que una mamá o un papá pida cita para dos o tres hijos el mismo día, porque solo tienen esa tarde libre entre escuela y trabajo. Para la clínica, eso significa acomodar varias citas seguidas, casi siempre con el mismo doctor y con distintos tiempos de silla según la edad y el tratamiento de cada niño.

Cuadrar eso a mano en una agenda de papel o en una app genérica es un rompecabezas: si el hermano menor se tarda más de lo previsto en el sillón porque no coopera, se recorre el horario del que sigue, y si uno de los tres falta ese día, el hueco que deja no siempre se puede rellenar a tiempo. La recepción termina llamando para confirmar uno por uno, y la mamá o el papá, que ya hizo el esfuerzo de sacar el permiso en el trabajo, se lleva una tarde más larga de lo que esperaba.

Para la clínica, el costo no es solo el tiempo perdido reacomodando: es también el desgaste de explicarle a una familia que ya hizo espacio en su semana que el horario cambió otra vez, o que dos de los tres niños sí pudieron atenderse pero el tercero va a tener que volver otro día porque ya no hubo dónde acomodarlo.

## Cómo se configura DaleControl

### Recursos y citas consecutivas en la Agenda

La clínica registra sus sillones como Recursos dentro de la Agenda, con la duración típica de una revisión, una profilaxis o una obturación en un niño. A partir de ahí, se puede agendar a los tres hermanos en bloques consecutivos sobre el mismo Recurso, o repartidos en Recursos distintos si hay más de un sillón libre, en vez de intentar acomodarlos de memoria. Si además hay dos sillones libres al mismo tiempo, dos de los hermanos pueden atenderse en paralelo con distintos doctores, y solo el tercero espera su turno en la sala, en vez de que los tres esperen sentados uno detrás del otro.

### Un expediente y un odontograma por niño

Cada hijo tiene su propio Expediente clínico y su propio Odontograma, aunque los tres compartan el mismo padre o tutor como contacto. Esto evita mezclar el historial de tratamientos de un niño con el de su hermano, algo fácil de confundir cuando se atiende a varios de la misma familia el mismo día. Cuando el niño crece y cambia de dentición, el odontograma refleja solo su propia evolución, sin arrastrar anotaciones que en realidad correspondían a su hermano.

### Recordatorios por WhatsApp a un solo responsable

Los Recordatorios por WhatsApp se configuran para llegar a un único número, el del papá o la mamá responsable, con la hora de cada uno de los tres bloques. Así la confirmación, o la cancelación, llega en un solo mensaje y no en tres avisos sueltos que se pueden perder o confundir. Conviene revisar [cómo construir una agenda dental que de verdad organice el día](/blog/agenda-dental-organizar-citas) para decidir cómo agrupar estos bloques familiares sin saturar al doctor.

### Portal del paciente para ver todo junto

El Portal del paciente le permite a ese mismo contacto ver las citas de sus tres hijos en un solo lugar, en vez de tener que preguntar por separado el horario de cada uno.

## Qué cambia en la operación

Si la clínica agenda a varias familias con más de un hijo por semana, ordenar estos bloques como citas consecutivas sobre un Recurso puede evitar buena parte de los reacomodos de último minuto que hoy se resuelven a ojo. En un escenario típico, cuando falta uno de los hermanos, la clínica sabe de inmediato qué bloque quedó libre y puede ofrecerlo a otra familia en espera, en vez de descubrirlo hasta que la recepcionista revisa la agenda completa del día. Esto es especialmente notorio en las semanas de vacaciones escolares, cuando varias familias piden la misma franja horaria y la clínica necesita ese margen para no perder ingresos por sillones vacíos.

Para las familias, el cambio más notorio es que ya no reciben tres mensajes distintos ni tienen que llamar para saber si le toca a las cuatro o a las cuatro y media a cada hijo. Vale la pena revisar también [qué esperar en la primera visita de un niño al dentista](/blog/primera-visita-paciente-dental) para ajustar cuánto tiempo dejar entre un hermano y otro según la edad de cada quien.

Si tu clínica atiende a varias familias con más de un hijo, vale la pena crear una cuenta en DaleControl y probar la Agenda con Recursos, el expediente por niño y los recordatorios a un solo contacto, para ver qué tanto se simplifica una tarde con tres hermanos en el sillón.
`,
    faq: [
      { q: "¿Se puede agendar a varios hermanos como una sola cita?", a: "No, cada niño tiene su propia cita y su propio expediente; lo que se ordena es que esas citas queden consecutivas sobre el mismo sillón para que la familia no tenga que ir y venir." },
      { q: "¿Qué pasa si uno de los hermanos falta el día de la cita?", a: "El bloque de ese niño queda libre en la Agenda y la clínica lo puede ofrecer a otra familia, en vez de que el hueco pase inadvertido hasta revisar el día completo." },
      { q: "¿Los recordatorios por WhatsApp llegan a cada niño por separado?", a: "Llegan al número del padre, madre o tutor que la clínica registre como responsable, con el horario de cada uno de sus hijos en el mismo aviso." },
    ],
    relatedBlogSlugs: ["agenda-dental-organizar-citas", "primera-visita-paciente-dental", "gestion-especialidades-dentales"],
  },
  {
    slug: "clinica-general-morelia-facturacion-ordenada",
    title: "Cómo una clínica general en Morelia puede ordenar sus facturas y el control de lo emitido",
    metaTitle: "Facturación ordenada para clínicas dentales en Morelia",
    metaDescription: "Cómo una clínica general en Morelia puede ligar la facturación al cobro en caja y llevar control de lo emitido, sin perseguir datos fiscales después.",
    city: "Morelia",
    specialty: "general",
    problem: "Facturas pedidas a destiempo y sin control de lo emitido",
    modules: ["Facturación", "Caja", "Finanzas", "Reportes", "Portal del paciente"],
    excerpt: "Cuando el paciente pide su factura semanas después y con datos incompletos, nadie tiene claro qué se facturó y qué sigue pendiente. Esto se puede ordenar desde el cobro.",
    contentMd: `## La factura que se pide tarde y a medias

En una clínica general de Morelia es común que el paciente pague su consulta o su tratamiento en el momento, pero pida la factura semanas después, cuando ya no trae a la mano su constancia de situación fiscal ni recuerda con qué régimen la necesita. Para el equipo administrativo, eso significa reconstruir un cobro viejo, buscar en qué fecha se hizo, y a veces descubrir que el monto o el concepto ya no coinciden con lo que quedó anotado en ese momento.

El otro problema, más silencioso, es que nadie en la clínica tiene una vista clara de qué se ha facturado y qué sigue pendiente. Si la facturación se maneja aparte del cobro del día, en notas sueltas o en un cuaderno, es fácil que una consulta quede cobrada pero nunca facturada, o que dos personas del equipo intenten facturar lo mismo por no saber que ya se hizo. Con el tiempo, eso se convierte en una lista de pendientes que nadie termina de cerrar.

A veces, además, el paciente ya olvidó el concepto exacto por el que pagó, y el equipo administrativo tiene que reconstruirlo revisando el expediente o preguntando al doctor, en vez de tomarlo de un registro que debería estar disponible desde el día del cobro.

## Cómo se configura DaleControl

### Datos fiscales desde el cobro en Caja

La clínica ajusta su flujo para pedir los datos fiscales del paciente al momento de registrar el cobro en Caja, no después. Esto no elimina que alguien pida su factura más tarde, pero deja los datos capturados desde el origen, en vez de tener que perseguirlos por teléfono o WhatsApp semanas después. Esto es particularmente útil cuando la clínica atiende a pacientes que facturan a nombre de una empresa, porque la razón social y el uso de CFDI casi nunca cambian de una visita a otra, y capturarlos una vez evita repetir la misma pregunta en cada cita.

### Facturación ligada al cobro

Con Facturación conectada al cobro registrado en Caja, cada pago queda asociado a lo que se facturó o a lo que sigue pendiente de facturar, en vez de llevar dos registros separados que hay que cuadrar a mano al final del mes. Vale la pena revisar [cómo se organiza el CFDI en consultorios dentales en México](/blog/facturacion-dentistas-mexico-cfdi) para entender qué información conviene tener lista antes de emitir cualquier comprobante.

### Finanzas y reportes para ver lo pendiente

Desde Finanzas y Reportes, la clínica puede revisar qué cobros ya tienen su factura emitida y cuáles siguen abiertos, por día, por semana o por el periodo que necesite, en vez de recorrer el cuaderno de pendientes buscando lo que falta. Esto también ayuda a detectar patrones, como qué días de la semana se concentran más facturas pendientes, algo que sirve para reforzar al equipo administrativo justo en esos momentos del mes.

### Portal del paciente para consultar después

El Portal del paciente le permite a quien ya facturó revisar su comprobante cuando lo necesite, sin tener que llamar o pasar a la clínica solo por eso.

## Qué cambia en la operación

Conviene acotar de qué se trata este escenario: el orden administrativo de la facturación —capturar los datos fiscales desde el cobro, emitir la factura junto al pago que le corresponde y saber en todo momento qué quedó facturado y qué no. Los detalles de la emisión fiscal dependen de la configuración de cada clínica y de su contabilidad, y eso no cambia con ningún sistema. Con los datos fiscales capturados desde el cobro, en un escenario típico se reduciría buena parte del tiempo que hoy se va en llamar al paciente para pedirle otra vez su información o en corregir una factura con datos incompletos.

Si la clínica emite, por decir un número ilustrativo, unas 150 facturas al mes, tener ese control ordenado en un solo lugar puede significar que a fin de mes el equipo sepa con certeza cuánto está pendiente de facturar, en vez de descubrirlo hasta que un paciente reclama. Además, al quedar todo en un mismo lugar, un cambio de encargado administrativo no significa perder el hilo de lo que ya se había facturado, algo que hoy depende de que la persona saliente le explique todo de memoria a quien la sustituye. Conviene revisar también [qué tanto pesan las finanzas ordenadas en una clínica dental](/blog/finanzas-clinica-dental-guia) para ver cómo se conecta esto con el resto de la operación administrativa de la clínica.

Si tu clínica sigue facturando por fuera del cobro del día, vale la pena crear una cuenta en DaleControl y probar con tu equipo cómo se ve tener la facturación, la caja y los reportes en un solo lugar, antes de que la próxima factura se pida tres semanas tarde.
`,
    faq: [
      { q: "¿Qué parte de la facturación cubre este escenario?", a: "La parte administrativa: pedir los datos fiscales al momento del cobro, emitir la factura ligada a ese pago y llevar el control de lo facturado y lo pendiente. La configuración fiscal de cada clínica y su contabilidad se revisan aparte, con tu contador." },
      { q: "¿Qué pasa si el paciente no trae sus datos fiscales el día del cobro?", a: "Se puede facturar después, pero conviene pedirlos desde ese momento para no tener que localizarlo por teléfono semanas más tarde." },
      { q: "¿Se puede saber qué cobros del mes ya tienen factura y cuáles no?", a: "Sí, al estar la Facturación ligada al cobro en Caja, Finanzas y Reportes muestran qué queda pendiente de facturar en el periodo que se revise." },
    ],
    relatedBlogSlugs: ["facturacion-dentistas-mexico-cfdi", "finanzas-clinica-dental-guia", "como-administrar-clinica-dental"],
  },
  {
    slug: "multisede-monterrey-permisos-y-roles",
    title: "Cómo un grupo dental de tres sucursales en Monterrey puede ordenar quién ve qué con roles y permisos",
    metaTitle: "Roles y permisos para clínicas multi-sede en Monterrey",
    metaDescription: "Cómo un grupo de tres sucursales dentales en Monterrey puede controlar quién ve finanzas y expedientes con roles, permisos y una bitácora de accesos.",
    city: "Monterrey",
    specialty: "multisede",
    problem: "Todo el equipo con acceso a todo, en tres sucursales",
    modules: ["Roles y permisos", "Multi-sede", "Verificación en dos pasos", "Bitácora", "Corte de caja con PIN"],
    excerpt: "Cuando todo el equipo entra con la misma cuenta y ve finanzas, expedientes y precios de las tres sucursales, ya no hay forma de saber quién hizo qué ni cuándo.",
    contentMd: `## Tres sucursales, una sola cuenta para todos

En un grupo dental con tres sucursales en Monterrey es frecuente que el crecimiento haya ido más rápido que el orden interno: se abrió la segunda sucursal, luego la tercera, y en el camino el equipo se acostumbró a compartir el mismo usuario y contraseña, o a que cuentas distintas terminen viendo, de todas formas, la información completa de las tres. Recepción, asistentes y hasta personal de reciente ingreso pueden terminar con acceso a finanzas, expedientes y precios que no necesitan para su trabajo del día a día.

Con la rotación normal de personal en una operación de este tamaño, eso se vuelve un riesgo concreto: alguien que ya no trabaja ahí pudo haberse llevado el acceso, y si algo se modifica o se borra en el sistema, nadie puede decir con certeza quién lo hizo, en qué sucursal ni a qué hora. La pregunta que se hacen los dueños cuando revisan esto no es si algo se sabe, sino si podrían demostrarlo si hiciera falta.

Esto se agrava en temporada de altas y bajas de personal, cuando una recepcionista nueva recibe el mismo usuario que ya usaba su antecesora, con meses de historial de otras personas detrás, y nadie se toma el tiempo de crear un acceso nuevo porque hay demasiadas cosas urgentes que resolver primero en el día a día de las tres sucursales.

## Cómo se configura DaleControl

### Roles y permisos por usuario

Lo primero es dejar de compartir cuentas: cada persona del equipo entra con su propio usuario, y desde Roles y permisos se define qué puede ver y qué puede hacer cada rol, ya sea recepción, asistente dental, doctor o administración. Finanzas y expedientes dejan de estar abiertos por defecto para quien no los necesita. Esto también simplifica la capacitación de personal nuevo: en vez de explicarle todo el sistema desde cero, la persona solo ve las pantallas que corresponden a su rol, lo cual reduce la curva de aprendizaje de la primera semana.

### Multi-sede con datos por sucursal

Con Multi-sede, cada una de las tres sucursales mantiene su propia agenda, su caja y sus reportes, y un usuario asignado a una sola sucursal no ve por defecto lo que pasa en las otras dos. Esto es particularmente útil cuando cada sucursal tiene su propio gerente y no todos necesitan ver el desempeño de las demás. Un director general, en cambio, sí puede tener acceso a las tres sucursales a la vez, para comparar entre ellas sin depender de que cada gerente le mande un reporte por separado. Conviene revisar [qué implica administrar más de un consultorio dental](/blog/como-administrar-clinica-dental) al definir qué tanto acceso cruzado sí tiene sentido entre sucursales.

### Verificación en dos pasos

Para las cuentas con acceso a información sensible, como administración o dirección general, se activa la Verificación en dos pasos, de modo que conocer la contraseña ya no es suficiente para entrar al sistema.

### Bitácora y corte de caja con PIN

La Bitácora deja registro de quién entró, qué modificó y en qué sucursal, mientras que el Corte de caja con PIN obliga a que cada cierre de caja quede asociado a la persona que lo hizo, y no a un usuario genérico de la sucursal.

## Qué cambia en la operación

El cambio más directo es que deja de ser una duda abierta quién puede ver qué: los permisos quedan definidos por rol y por sucursal, y ajustarlos cuando entra o sale alguien del equipo es cuestión de actualizar una cuenta, no de cambiar una contraseña compartida entre varias personas. En un escenario típico, un grupo de tres sucursales con rotación de personal podría reducir buena parte del tiempo que hoy dedica a rastrear accesos manualmente cuando algo no cuadra.

La Bitácora y el corte de caja con PIN, además, hacen posible responder con datos concretos preguntas como quién hizo determinado cambio en el expediente o quién cerró la caja de una sucursal en un día específico, algo que hoy depende de la memoria de quien estaba de turno. Con el tiempo, esto también facilita las auditorías internas del propio grupo: revisar un periodo específico ya no depende de reconstruir de memoria quién trabajaba esa semana en cada sucursal. Vale la pena revisar también [cómo se ordenan las finanzas de una clínica dental](/blog/finanzas-clinica-dental-guia) para ver cómo se conecta el control de caja por sucursal con el resto de la operación financiera del grupo.

Si tu grupo dental ya creció a varias sucursales pero los accesos y permisos no crecieron con él, vale la pena crear una cuenta en DaleControl y probar con tu equipo cómo se ve tener roles, multi-sede y bitácora ordenados desde el arranque.
`,
    faq: [
      { q: "¿Cada sucursal necesita su propia cuenta de DaleControl?", a: "No, las tres sucursales operan bajo el mismo grupo; lo que cambia es que Multi-sede separa los datos de cada una y Roles y permisos definen qué ve cada persona del equipo." },
      { q: "¿La bitácora registra en qué sucursal ocurrió cada acción?", a: "Sí, la Bitácora queda asociada al usuario y a la sucursal desde la que se hizo el cambio, no solo a la acción en sí." },
      { q: "¿La verificación en dos pasos aplica a todo el equipo por igual?", a: "Se puede activar para las cuentas que la clínica decida, normalmente las que tienen acceso a finanzas o a información de las tres sucursales." },
    ],
    relatedBlogSlugs: ["como-administrar-clinica-dental", "finanzas-clinica-dental-guia", "normativas-clinicas-dentales-mexico"],
  },
];

/** Slugs en el orden del índice — los consume generateStaticParams y el sitemap. */
export const CASOS_SLUGS: string[] = CASOS_DE_USO.map((c) => c.slug);

export function getCasoBySlug(slug: string): CasoDeUso | null {
  if (!slug) return null;
  return CASOS_DE_USO.find((c) => c.slug === slug) ?? null;
}

/**
 * Otros casos para el pie de la ficha: primero los de la misma especialidad,
 * luego los de la misma ciudad y al final se rellena con el resto en orden.
 * Siempre excluye el propio caso.
 */
export function getRelatedCasos(caso: CasoDeUso, limit = 3): CasoDeUso[] {
  const rest = CASOS_DE_USO.filter((c) => c.slug !== caso.slug);
  const score = (c: CasoDeUso) =>
    (c.specialty === caso.specialty ? 2 : 0) + (c.city === caso.city ? 1 : 0);
  const sorted = rest
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.c);
  return sorted.slice(0, limit);
}

/** palabras / 200, redondeado, mínimo 1 — misma regla que el blog. */
export function casoReadingMinutes(contentMd: string): number {
  const words = (contentMd ?? "").trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 1;
  return Math.max(1, Math.round(words / 200));
}
