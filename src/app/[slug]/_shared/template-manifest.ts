/* ============================================================
   MANIFIESTO DE LAS PLANTILLAS.

   Cada plantilla declara aquí qué tiene: secciones, ranuras de
   foto y textos editables. El editor de Configuración se dibuja
   LEYENDO esto — no conoce ninguna plantilla por su nombre.

   Añadir una novena plantilla = escribir su manifiesto y
   registrarla en el switch de clinic-landing-server. El editor
   no se toca.

   Sin "use client": lo leen el editor (cliente) y las rutas
   públicas (servidor).
   ============================================================ */

export interface ManifestSection {
  id: string;
  /** Nombre visible en el editor, en español. */
  nombre: string;
  /** No se puede apagar ni mover (contacto y reservar). */
  obligatoria?: boolean;
  /** Qué datos consume: si no hay ninguno, la sección no se pinta. */
  consume: Array<
    | "servicios" | "doctores" | "galeria" | "testimonios" | "faqs"
    | "horarios" | "mapa" | "msi" | "urgencias" | "fotos" | "resenas"
  >;
}

/** Dónde cae la foto dentro de su sección (para el diagrama del editor). */
export type ZonaFoto = "completa" | "izquierda" | "derecha" | "franja";

export interface ManifestPhotoSlot {
  id: string;
  /** "Portada", "Foto del equipo", "Caso 1 · antes". */
  nombre: string;
  /** Proporción recomendada, tal como se la decimos a la clínica. */
  proporcion: string;
  /** Id de la sección donde sale. */
  seccion: string;
  zona: ZonaFoto;
  /** Nota corta para que sepa qué foto subir. */
  ayuda?: string;
}

export interface ManifestText {
  /** Sección a la que pertenece: se guarda dentro de landingSections. */
  seccion: string;
  campo: "titulo" | "subtitulo";
  etiqueta: string;
  porDefecto: string;
}

/**
 * UN TEXTO SUELTO DE LA PLANTILLA.
 *
 * `textos` cubre el título y la bajada de cada sección, que caben dentro de
 * `landingSections`. Todo lo DEMÁS que lee un paciente —el kicker de cada
 * bloque, la etiqueta de cada botón, la leyenda de cada cifra, los avisos— no
 * tenía dónde vivir y estaba clavado en el JSX. Se declara aquí y se guarda en
 * la columna `landingCopy` (mapa plano `{clave: texto}`).
 *
 * REGLAS
 *  · La clave es SEMÁNTICA y se comparte entre plantillas ("hero.cta"). Así,
 *    quien reescribió su botón no lo pierde al cambiar de plantilla.
 *  · `porDefecto` es el literal REAL de ESTA plantilla. Es lo que la clínica ve
 *    en gris como "esto sale si lo dejas vacío": si no es el literal real,
 *    miente. Por eso el mismo `clave` puede traer defaults distintos en cada
 *    plantilla, y por eso NO se reusan los de otra.
 *  · El default NUNCA se materializa: vaciar el campo borra la clave.
 *  · Un texto que se CONSTRUYE (con variables, partido por una coma o con un
 *    emoji pegado a un dato) no se declara aquí. Ver `noEditables`.
 */
export interface ManifestCopy {
  /** Clave del mapa `landingCopy`. Semántica, en minúsculas, con puntos. */
  clave: string;
  /** Nombre visible en el editor, en español. */
  etiqueta: string;
  /** El literal REAL que pinta esta plantilla si la clínica no escribe nada. */
  porDefecto: string;
  /** Tope de caracteres. 160 si no se dice. */
  maxLen?: number;
  /** false = admite varias líneas (los "\n" se pintan como <br/>). */
  linea?: boolean;
  /**
   * Por qué este texto NO sale en el render de prueba.
   *
   * La prueba de instrumentación exige un nodo por cada clave declarada: es lo
   * que evita que una plantilla nazca medio editable en silencio. Un texto que
   * solo aparece en un estado que la clínica de prueba no puede tener (las
   * reseñas de Google llegan por fetch, y en el servidor los efectos no corren)
   * se marca aquí, CON EL MOTIVO. Sin motivo no se salta.
   */
  variante?: string;
}

/**
 * Lo que esta plantilla NO deja editar, y por qué.
 *
 * Se declara para que quede escrito en el mismo sitio que lo editable: si un
 * texto no está ni en `textos`, ni en `copia`, ni aquí, es un olvido.
 */
export interface ManifestNoEditable {
  donde: string;
  porque: string;
}

export interface TemplateManifest {
  id: string;
  nombre: string;
  /** Una línea que explica para quién es. */
  para: string;
  /** true = la plantilla NO usa fotos (consultorio). */
  sinFotos?: boolean;
  /**
   * ¿La plantilla LEE de verdad este manifiesto al pintar?
   *
   * Las cuatro primeras (classic, futurista, healthtech, calido) son
   * anteriores al manifiesto: su lista de secciones y sus títulos están
   * escritos a mano en el JSX y no consultan `landingSections` ni
   * `landingPhotos` (ver _shared/landing-data.ts: sectionMap, photoOf).
   * Enseñarles el editor de secciones era prometer interruptores que no
   * hacen nada — y `classic` es la plantilla por defecto del schema, o sea
   * lo que ve la mayoría.
   *
   * La bandera vive AQUÍ y no en la pantalla: el editor la lee y no conoce
   * ninguna plantilla por su nombre. Cuando classic/futurista/healthtech/
   * calido aprendan a leer el manifiesto, se pone en true y el editor
   * aparece solo.
   */
  leeManifiesto?: boolean;
  /**
   * ¿La plantilla está INSTRUMENTADA para el editor visual?
   *
   * `leeManifiesto` dice que obedece al formulario de secciones. Esto dice
   * algo distinto y más fuerte: que sus textos van envueltos en <Txt> y sus
   * fotos en <Foto> (_shared/edit-context.tsx), o sea que se puede editar
   * haciendo clic encima de lo que se ve.
   *
   * Las dos banderas son independientes a propósito: una plantilla puede
   * leer el manifiesto sin estar instrumentada todavía. Del set de las
   * instrumentadas salen dos cosas: el botón "Editar mi sitio" y la prueba
   * de __tests__/instrumentacion.test.tsx, que exige un nodo por cada texto
   * y una ranura por cada foto declarados aquí abajo.
   */
  instrumentada?: boolean;
  secciones: ManifestSection[];
  fotos: ManifestPhotoSlot[];
  textos: ManifestText[];
  /**
   * Todo el texto suelto de la plantilla (kickers, botones, leyendas, avisos).
   * Vive en la columna `landingCopy`. Sin declarar = no editable y no guardable.
   */
  copia?: ManifestCopy[];
  /** Lo que se deja fuera a propósito, con el motivo. Documentación viva. */
  noEditables?: ManifestNoEditable[];
  /**
   * Qué datos SUELTOS pinta de verdad esta plantilla.
   *
   * El formulario avisa "«X» no pinta este aviso; se guarda y aparece en cuanto
   * cambies de plantilla" para el aviso de urgencias y los meses sin intereses.
   * Ese aviso se decidía por `leeManifiesto`, que servía de proxy mientras solo
   * cuatro plantillas lo leían; ahora lo leen las ocho y el proxy diría que
   * todas los pintan. Esto es la lista real, leída del JSX de cada una.
   */
  pinta?: Array<"urgencias" | "msi">;
}

/* ---------- piezas que se repiten entre plantillas ---------- */

const SEC_CONTACTO: ManifestSection = { id: "contacto", nombre: "Contacto, horarios y mapa", obligatoria: true, consume: ["horarios", "mapa"] };
const SEC_RESERVAR: ManifestSection = { id: "reservar", nombre: "Bloque de reserva", obligatoria: true, consume: [] };
const SEC_SERVICIOS: ManifestSection = { id: "servicios", nombre: "Servicios y precios", consume: ["servicios"] };
const SEC_EQUIPO: ManifestSection = { id: "equipo", nombre: "Equipo / quién te atiende", consume: ["doctores"] };
const SEC_GALERIA: ManifestSection = { id: "galeria", nombre: "Galería de fotos", consume: ["galeria"] };
const SEC_OPINIONES: ManifestSection = { id: "opiniones", nombre: "Opiniones y reseñas", consume: ["testimonios", "resenas"] };
const SEC_FAQ: ManifestSection = { id: "faq", nombre: "Preguntas frecuentes", consume: ["faqs"] };

const FOTO_PORTADA: ManifestPhotoSlot = {
  id: "portada", nombre: "Portada", proporcion: "16:9 apaisada", seccion: "hero", zona: "completa",
  ayuda: "La foto grande de arriba. Se recorta a lo ancho: evita caras muy pegadas al borde.",
};
const FOTOS_CASO: ManifestPhotoSlot[] = [
  { id: "caso1_antes", nombre: "Caso 1 · antes", proporcion: "4:3", seccion: "casos", zona: "izquierda", ayuda: "La misma toma que la de después: mismo encuadre y misma luz." },
  { id: "caso1_despues", nombre: "Caso 1 · después", proporcion: "4:3", seccion: "casos", zona: "izquierda", ayuda: "El resultado, con el mismo encuadre que la de antes." },
];


/* ============================================================
   LOS OCHO MANIFIESTOS
   ============================================================ */

export const TEMPLATE_MANIFESTS: Record<string, TemplateManifest> = {

  classic: {
    id: "classic",
    nombre: "Clásico",
    para: "El estándar: limpio, profesional y sirve para cualquier especialidad.",
    leeManifiesto: true,
    instrumentada: true,
    secciones: [SEC_SERVICIOS, SEC_EQUIPO, SEC_GALERIA, SEC_OPINIONES, SEC_FAQ, SEC_CONTACTO, SEC_RESERVAR],
    fotos: [FOTO_PORTADA],
    /* NO usa TEXTOS_BASE: esos `porDefecto` son los de las plantillas nuevas y
       classic pinta otros literales desde antes de que el manifiesto existiera.
       El `porDefecto` es lo que la clínica ve en gris como "esto sale si lo
       dejas vacío": si no es el literal REAL de la plantilla, miente.

       El titular del cierre ("Tu salud, nuestra<br/>prioridad") tampoco está
       aquí, pero YA SE EDITA: lleva un salto de línea dentro, así que no cabe
       en `textos` como cadena. Va en `copia` con `linea:false`, el salto viaja
       como "\n" y <Txt multilinea> lo vuelve a pintar como <br/>. El HTML
       público sale byte a byte igual que antes. */
    textos: [
      { seccion: "servicios", campo: "titulo",    etiqueta: "Título de servicios",   porDefecto: "Lo que ofrecemos" },
      { seccion: "servicios", campo: "subtitulo", etiqueta: "Bajada de servicios",   porDefecto: "Tratamientos con tecnología de vanguardia para tu salud y bienestar" },
      { seccion: "equipo",    campo: "titulo",    etiqueta: "Título del equipo",     porDefecto: "Nuestros especialistas" },
      { seccion: "equipo",    campo: "subtitulo", etiqueta: "Bajada del equipo",     porDefecto: "Profesionales certificados comprometidos con tu salud" },
      { seccion: "galeria",   campo: "titulo",    etiqueta: "Título de la galería",  porDefecto: "Nuestra clínica" },
      { seccion: "opiniones", campo: "titulo",    etiqueta: "Título de opiniones",   porDefecto: "Lo que dicen nuestros pacientes" },
      { seccion: "faq",       campo: "titulo",    etiqueta: "Título de preguntas",   porDefecto: "Preguntas frecuentes" },
      { seccion: "contacto",  campo: "titulo",    etiqueta: "Título de contacto",    porDefecto: "Visítanos" },
      { seccion: "contacto",  campo: "subtitulo", etiqueta: "Bajada de contacto",    porDefecto: "Estamos aquí para atenderte con gusto" },
      { seccion: "reservar",  campo: "subtitulo", etiqueta: "Bajada del cierre",     porDefecto: "Agenda en menos de 2 minutos. Sin llamadas, sin esperas, sin complicaciones." },
    ],
    copia: [
      /* Barra de arriba. El MENÚ no se edita (los enlaces siguen a las
         secciones); el botón de reservar sí, que es una llamada a la acción. */
      { clave: "nav.whatsapp",  etiqueta: "Barra · botón de WhatsApp", porDefecto: "WhatsApp", maxLen: 40, linea: true },
      { clave: "nav.cta",       etiqueta: "Barra · botón de reservar", porDefecto: "Agendar",  maxLen: 40, linea: true },

      /* Portada */
      { clave: "hero.cta",              etiqueta: "Portada · botón principal",   porDefecto: "Agendar cita", maxLen: 60, linea: true },
      { clave: "hero.whatsapp",         etiqueta: "Portada · botón de WhatsApp", porDefecto: "WhatsApp",     maxLen: 60, linea: true },
      { clave: "hero.statEspecialistas", etiqueta: "Portada · leyenda «especialistas»", porDefecto: "Especialistas", maxLen: 60, linea: true },
      { clave: "hero.statCalificacion",  etiqueta: "Portada · leyenda «calificación»",  porDefecto: "Calificación",  maxLen: 60, linea: true },
      { clave: "hero.statCita",          etiqueta: "Portada · leyenda «cita en línea»", porDefecto: "Cita en línea", maxLen: 60, linea: true },

      /* Etiquetas de bloque (el pastillita de arriba de cada sección) */
      { clave: "servicios.kicker",     etiqueta: "Servicios · etiqueta",   porDefecto: "Servicios",         maxLen: 60, linea: true },
      { clave: "equipo.kicker",        etiqueta: "Equipo · etiqueta",      porDefecto: "Equipo médico",     maxLen: 60, linea: true },
      { clave: "galeria.kicker",       etiqueta: "Galería · etiqueta",     porDefecto: "Instalaciones",     maxLen: 60, linea: true },
      { clave: "opiniones.kicker",     etiqueta: "Opiniones · etiqueta",   porDefecto: "Testimonios",       maxLen: 60, linea: true },
      { clave: "opiniones.kickerGoogle", etiqueta: "Reseñas de Google · etiqueta", porDefecto: "Reseñas de Google", maxLen: 60, linea: true,
        variante: "El bloque solo existe con reseñas de Google, que llegan por fetch en un efecto; en el render de servidor los efectos no corren." },
      { clave: "faq.kicker",           etiqueta: "Preguntas · etiqueta",   porDefecto: "FAQ",               maxLen: 60, linea: true },
      { clave: "contacto.kicker",      etiqueta: "Contacto · etiqueta",    porDefecto: "Contacto",          maxLen: 60, linea: true },

      /* Botones de las tarjetas */
      { clave: "servicios.cta", etiqueta: "Servicios · botón de cada tarjeta", porDefecto: "Agendar",          maxLen: 40, linea: true },
      { clave: "equipo.cta",    etiqueta: "Equipo · botón de cada doctor",     porDefecto: "Agendar consulta", maxLen: 60, linea: true },

      /* Bloque de contacto */
      { clave: "contacto.etiquetaDireccion", etiqueta: "Contacto · rótulo de la dirección", porDefecto: "Dirección", maxLen: 60, linea: true },
      { clave: "contacto.etiquetaTelefono",  etiqueta: "Contacto · rótulo del teléfono",    porDefecto: "Teléfono",  maxLen: 60, linea: true },
      { clave: "contacto.etiquetaHorarios",  etiqueta: "Contacto · rótulo de los horarios", porDefecto: "Horarios",  maxLen: 60, linea: true },
      { clave: "contacto.whatsapp",  etiqueta: "Contacto · botón de WhatsApp",  porDefecto: "Escribir por WhatsApp", maxLen: 60, linea: true },
      { clave: "contacto.instagram", etiqueta: "Contacto · botón de Instagram", porDefecto: "Instagram",             maxLen: 40, linea: true },
      { clave: "contacto.facebook",  etiqueta: "Contacto · botón de Facebook",  porDefecto: "Facebook",              maxLen: 40, linea: true },

      /* Cierre. El titular lleva DOS líneas: el salto se guarda como "\n". */
      { clave: "reservar.titulo",   etiqueta: "Cierre · titular (dos líneas)", porDefecto: "Tu salud, nuestra\nprioridad", maxLen: 160 },
      { clave: "reservar.cta",      etiqueta: "Cierre · botón principal",      porDefecto: "Agendar mi cita", maxLen: 60, linea: true },
      { clave: "reservar.whatsapp", etiqueta: "Cierre · botón de WhatsApp",    porDefecto: "WhatsApp",        maxLen: 60, linea: true },
    ],
    noEditables: [
      { donde: "Menú de navegación (escritorio y móvil)", porque: "Los enlaces siguen a las secciones que estén encendidas; renombrarlos los desacoplaría de su destino." },
      { donde: "Pie de página, incluido «Powered by DaleControl»", porque: "El pie es nuestro, no de la clínica." },
      { donde: "Portada · pastilla «{especialidad} · {ciudad}»", porque: "Se construye con dos datos de la clínica; como texto plano se guardaría la mezcla ya montada." },
      { donde: "Portada · las cifras (número de especialistas, calificación, «✓»)", porque: "Son datos calculados, no copy. Sus leyendas SÍ se editan." },
      { donde: "Portada · las etiquetas de especialidad", porque: "Vienen del catálogo de la categoría clínica, no de la clínica." },
      { donde: "«Dr/a. {nombre} {apellido}» y las especialidades de cada doctor", porque: "Se arman con datos del equipo; se cambian en la ficha del doctor." },
      { donde: "«({n} reseñas en Google)» y «Ver {n} reseñas en Google · {nota} ⭐»", porque: "Se construyen con lo que devuelve Google." },
      { donde: "El texto del mapa cuando no hay mapa configurado", porque: "Es una expresión con respaldo: o la dirección de la clínica, o un aviso." },
      { donde: "Las reseñas de Google", porque: "Son de Google. No hay dónde guardarlas si alguien las reescribe." },
    ],
  },

  futurista: {
    id: "futurista",
    nombre: "Futurista",
    para: "Moderna, oscura, con acentos de neón. Para clínicas que venden tecnología.",
    leeManifiesto: true,
    instrumentada: true,
    secciones: [SEC_SERVICIOS, SEC_EQUIPO, SEC_GALERIA, SEC_OPINIONES, SEC_FAQ, SEC_CONTACTO, SEC_RESERVAR],
    fotos: [FOTO_PORTADA],
    /* NO usa TEXTOS_BASE, y es el motivo de leerlos uno por uno: los SEIS
       mentían. TEXTOS_BASE son los literales de las plantillas nuevas, y
       futurista pinta otros desde antes de que el manifiesto existiera:
       "Lo que cuesta, antes de sentarte" → "Tratamientos de nueva generación";
       "Quién te va a atender" → "Especialistas detrás de la pantalla";
       "Lo que todos preguntan antes de venir" → "Resolvemos tus dudas";
       "Dónde estamos" → "Estamos cerca de ti". Y faltaban cuatro que la
       plantilla sí pinta (galería, bajada del equipo y el cierre entero).

       El título de opiniones es el kicker mono: en esta plantilla el bloque de
       testimonios no tiene <h2>, solo esa línea. El "// " que lo precede es
       decoración de la plantilla y va pegado FUERA de lo editable. */
    textos: [
      { seccion: "servicios", campo: "titulo",    etiqueta: "Título de servicios",  porDefecto: "Tratamientos de nueva generación" },
      { seccion: "servicios", campo: "subtitulo", etiqueta: "Bajada de servicios",  porDefecto: "Precios transparentes y resultados predecibles." },
      { seccion: "equipo",    campo: "titulo",    etiqueta: "Título del equipo",    porDefecto: "Especialistas detrás de la pantalla" },
      { seccion: "equipo",    campo: "subtitulo", etiqueta: "Bajada del equipo",    porDefecto: "Ciencia, tecnología y calidez en un mismo lugar." },
      { seccion: "galeria",   campo: "titulo",    etiqueta: "Título de la galería", porDefecto: "Un entorno clínico de otro nivel" },
      { seccion: "opiniones", campo: "titulo",    etiqueta: "Título de opiniones",  porDefecto: "Lo que dicen nuestros pacientes" },
      { seccion: "faq",       campo: "titulo",    etiqueta: "Título de preguntas",  porDefecto: "Resolvemos tus dudas" },
      { seccion: "contacto",  campo: "titulo",    etiqueta: "Título de contacto",   porDefecto: "Estamos cerca de ti" },
      { seccion: "reservar",  campo: "titulo",    etiqueta: "Título del cierre",    porDefecto: "¿List@ para tu cita?" },
      { seccion: "reservar",  campo: "subtitulo", etiqueta: "Bajada del cierre",    porDefecto: "Agenda tu valoración. Te confirmamos por WhatsApp en minutos." },
    ],
    copia: [
      { clave: "nav.cta",  etiqueta: "Barra · botón de reservar", porDefecto: "Agendar Cita", maxLen: 40, linea: true },

      { clave: "hero.cta",      etiqueta: "Portada · botón principal",   porDefecto: "Agendar Cita", maxLen: 60, linea: true },
      { clave: "hero.whatsapp", etiqueta: "Portada · botón de WhatsApp", porDefecto: "WhatsApp",     maxLen: 60, linea: true },
      { clave: "hero.cta2",     etiqueta: "Portada · botón alterno (sin WhatsApp)", porDefecto: "Conoce más", maxLen: 60, linea: true },

      /* Las tres cifras del hero son literales; lo interpolado es el valor. */
      { clave: "stats.google",    etiqueta: "Portada · leyenda de la nota de Google", porDefecto: "rating google", maxLen: 60, linea: true,
        variante: "Solo sale con ficha de Google, y las reseñas llegan por fetch: en el render de servidor los efectos no corren." },
      { clave: "stats.anios",     etiqueta: "Portada · leyenda de años",     porDefecto: "años exp.",  maxLen: 60, linea: true },
      { clave: "stats.pacientes", etiqueta: "Portada · leyenda de pacientes", porDefecto: "pacientes", maxLen: 60, linea: true },

      { clave: "servicios.kicker", etiqueta: "Servicios · etiqueta",              porDefecto: "Servicios", maxLen: 60, linea: true },
      { clave: "servicios.cta",    etiqueta: "Servicios · botón de cada tarjeta", porDefecto: "Agendar",   maxLen: 40, linea: true },
      { clave: "equipo.kicker",    etiqueta: "Equipo · etiqueta",                 porDefecto: "Equipo",    maxLen: 60, linea: true },
      { clave: "equipo.cta",       etiqueta: "Equipo · botón de cada doctor",     porDefecto: "Agendar consulta", maxLen: 60, linea: true },
      { clave: "galeria.kicker",   etiqueta: "Galería · etiqueta",                porDefecto: "Galería",   maxLen: 60, linea: true },
      { clave: "galeria.cta",      etiqueta: "Galería · botón",                   porDefecto: "Conoce el espacio · Agendar Cita", maxLen: 80, linea: true },
      { clave: "opiniones.tituloGoogle", etiqueta: "Reseñas de Google · título", porDefecto: "Reseñas de Google", maxLen: 60, linea: true,
        variante: "El bloque solo existe con reseñas de Google, que llegan por fetch." },
      { clave: "opiniones.cta", etiqueta: "Reseñas de Google · botón", porDefecto: "Agendar Cita", maxLen: 60, linea: true,
        variante: "Mismo bloque de Google." },

      { clave: "faq.kicker", etiqueta: "Preguntas · etiqueta", porDefecto: "Preguntas frecuentes", maxLen: 60, linea: true },
      { clave: "faq.nota",   etiqueta: "Preguntas · texto de cierre", porDefecto: "¿Te quedó otra duda? Con gusto te ayudamos.", maxLen: 160, linea: true },
      { clave: "faq.cta",    etiqueta: "Preguntas · botón", porDefecto: "Agendar Cita", maxLen: 60, linea: true },

      { clave: "reservar.kicker", etiqueta: "Cierre · etiqueta", porDefecto: "Tu próxima cita", maxLen: 60, linea: true },
      { clave: "reservar.cta",    etiqueta: "Cierre · botón",    porDefecto: "Agendar Cita",    maxLen: 60, linea: true },
      { clave: "flotante.cta",    etiqueta: "Botón flotante de reservar", porDefecto: "Agendar Cita", maxLen: 40, linea: true },

      { clave: "contacto.kicker",            etiqueta: "Contacto · etiqueta",               porDefecto: "Visítanos",   maxLen: 60, linea: true },
      { clave: "contacto.etiquetaDireccion", etiqueta: "Contacto · rótulo de la dirección", porDefecto: "Dirección",   maxLen: 60, linea: true },
      { clave: "contacto.etiquetaTelefono",  etiqueta: "Contacto · rótulo del teléfono",    porDefecto: "Teléfono",    maxLen: 60, linea: true },
      { clave: "contacto.etiquetaWhatsapp",  etiqueta: "Contacto · rótulo de WhatsApp",     porDefecto: "WhatsApp",    maxLen: 60, linea: true },
      { clave: "contacto.etiquetaHorarios",  etiqueta: "Contacto · rótulo de los horarios", porDefecto: "Horarios",    maxLen: 60, linea: true },
      { clave: "contacto.cerrado",           etiqueta: "Contacto · cómo se dice «cerrado»", porDefecto: "Cerrado",     maxLen: 40, linea: true },
      { clave: "contacto.cta",               etiqueta: "Contacto · botón de reservar",      porDefecto: "Agendar Cita", maxLen: 60, linea: true },
    ],
    noEditables: [
      { donde: "Menú de navegación (y su versión móvil, con el rótulo «Menú»)", porque: "Los enlaces siguen a las secciones que estén encendidas." },
      { donde: "Pie de página, incluido «Hecho con DaleControl»", porque: "El pie es nuestro, no de la clínica." },
      { donde: "Portada · pastilla «// {especialidad} · {ciudad}» y el chip de especialidad", porque: "Son datos de la clínica; se cambian en Configuración." },
      { donde: "Portada · «{n} reseñas verificadas»", porque: "Se construye con lo que devuelve Google." },
      { donde: "«Dr/a. {nombre} {apellido}» y las especialidades del equipo", porque: "Se arman con datos del equipo." },
      { donde: "La numeración de las tarjetas de servicio («01/04»)", porque: "Es la posición en la lista, no copy." },
      { donde: "El texto del mapa cuando no hay mapa configurado", porque: "Es una expresión con respaldo: o la dirección, o un aviso." },
      { donde: "Las reseñas de Google", porque: "Son de Google. No hay dónde guardarlas si alguien las reescribe." },
    ],
  },

  healthtech: {
    id: "healthtech",
    nombre: "Healthtech",
    para: "Clara y confiable, con aire de clínica moderna.",
    leeManifiesto: true,
    instrumentada: true,
    secciones: [SEC_SERVICIOS, SEC_EQUIPO, SEC_GALERIA, SEC_OPINIONES, SEC_FAQ, SEC_CONTACTO, SEC_RESERVAR],
    fotos: [FOTO_PORTADA],
    /* Tampoco usa TEXTOS_BASE: los seis mentían, como en futurista. Esta
       plantilla pinta "Todo lo que tu salud necesita", "Especialistas en
       quienes confiar", "Resolvemos tus dudas" y "Estamos cerca de ti". */
    textos: [
      { seccion: "servicios", campo: "titulo",    etiqueta: "Título de servicios",  porDefecto: "Todo lo que tu salud necesita" },
      { seccion: "servicios", campo: "subtitulo", etiqueta: "Bajada de servicios",  porDefecto: "Tratamientos con tecnología de punta y precios claros." },
      { seccion: "equipo",    campo: "titulo",    etiqueta: "Título del equipo",    porDefecto: "Especialistas en quienes confiar" },
      { seccion: "equipo",    campo: "subtitulo", etiqueta: "Bajada del equipo",    porDefecto: "Profesionales certificados, comprometidos con tu bienestar." },
      { seccion: "galeria",   campo: "titulo",    etiqueta: "Título de la galería", porDefecto: "Conoce nuestras instalaciones" },
      { seccion: "opiniones", campo: "titulo",    etiqueta: "Título de opiniones",  porDefecto: "Lo que dicen nuestros pacientes" },
      { seccion: "faq",       campo: "titulo",    etiqueta: "Título de preguntas",  porDefecto: "Resolvemos tus dudas" },
      { seccion: "contacto",  campo: "titulo",    etiqueta: "Título de contacto",   porDefecto: "Estamos cerca de ti" },
      { seccion: "reservar",  campo: "titulo",    etiqueta: "Título del cierre",    porDefecto: "¿Listo para tu cita?" },
      { seccion: "reservar",  campo: "subtitulo", etiqueta: "Bajada del cierre",    porDefecto: "Agenda en menos de un minuto. Te confirmamos por WhatsApp." },
    ],
    copia: [
      { clave: "nav.cta",       etiqueta: "Barra · botón de reservar",   porDefecto: "Agendar Cita", maxLen: 40, linea: true },
      { clave: "hero.cta",      etiqueta: "Portada · botón principal",   porDefecto: "Agendar Cita", maxLen: 60, linea: true },
      { clave: "hero.whatsapp", etiqueta: "Portada · botón de WhatsApp", porDefecto: "WhatsApp",     maxLen: 60, linea: true },
      { clave: "hero.cta2",     etiqueta: "Portada · botón alterno (sin WhatsApp)", porDefecto: "Conoce más", maxLen: 60, linea: true },

      /* Los tres sellos del hero. La leyenda de la calificación cambia sola a
         "Google" cuando hay ficha conectada, así que ahí solo se edita la
         versión sin Google. */
      { clave: "sellos.calificacion", etiqueta: "Portada · leyenda de la calificación", porDefecto: "calificación", maxLen: 40, linea: true },
      { clave: "sellos.anios",        etiqueta: "Portada · leyenda de años",            porDefecto: "años",         maxLen: 40, linea: true },
      { clave: "sellos.pacientes",    etiqueta: "Portada · leyenda de pacientes",       porDefecto: "pacientes",    maxLen: 40, linea: true },
      { clave: "sellos.tarjeta",      etiqueta: "Portada · rótulo de la tarjeta de calificación", porDefecto: "Calificación", maxLen: 40, linea: true },

      { clave: "servicios.kicker", etiqueta: "Servicios · etiqueta",              porDefecto: "Servicios",     maxLen: 60, linea: true },
      { clave: "servicios.cta",    etiqueta: "Servicios · botón de cada tarjeta", porDefecto: "Agendar",       maxLen: 40, linea: true },
      { clave: "equipo.kicker",    etiqueta: "Equipo · etiqueta",                 porDefecto: "Equipo médico", maxLen: 60, linea: true },
      { clave: "equipo.cta",       etiqueta: "Equipo · botón de cada doctor",     porDefecto: "Agendar consulta", maxLen: 60, linea: true },
      { clave: "galeria.kicker",   etiqueta: "Galería · etiqueta",                porDefecto: "Galería",       maxLen: 60, linea: true },
      { clave: "galeria.cta",      etiqueta: "Galería · botón",                   porDefecto: "Visítanos · Agendar Cita", maxLen: 80, linea: true },
      { clave: "opiniones.kicker", etiqueta: "Opiniones · etiqueta",              porDefecto: "Testimonios",   maxLen: 60, linea: true },

      { clave: "opiniones.tituloGoogle", etiqueta: "Reseñas de Google · rótulo", porDefecto: "Google",           maxLen: 40, linea: true,
        variante: "El bloque solo existe con reseñas de Google, que llegan por fetch: en el render de servidor los efectos no corren." },
      { clave: "opiniones.cta",          etiqueta: "Reseñas de Google · botón",  porDefecto: "Agendar mi cita",  maxLen: 60, linea: true,
        variante: "Mismo bloque de Google." },

      { clave: "faq.kicker", etiqueta: "Preguntas · etiqueta",      porDefecto: "Preguntas frecuentes", maxLen: 60, linea: true },
      { clave: "faq.nota",   etiqueta: "Preguntas · texto de cierre", porDefecto: "¿Te quedó otra duda? Con gusto te ayudamos.", maxLen: 160, linea: true },
      { clave: "faq.cta",    etiqueta: "Preguntas · botón",         porDefecto: "Agendar Cita",         maxLen: 60, linea: true },

      { clave: "reservar.cta", etiqueta: "Cierre · botón", porDefecto: "Agendar Cita", maxLen: 60, linea: true },
      { clave: "flotante.cta", etiqueta: "Botón flotante de reservar", porDefecto: "Agendar Cita", maxLen: 40, linea: true },

      { clave: "contacto.kicker",            etiqueta: "Contacto · etiqueta",               porDefecto: "Visítanos",    maxLen: 60, linea: true },
      { clave: "contacto.etiquetaDireccion", etiqueta: "Contacto · rótulo de la dirección", porDefecto: "Dirección",    maxLen: 60, linea: true },
      { clave: "contacto.etiquetaTelefono",  etiqueta: "Contacto · rótulo del teléfono",    porDefecto: "Teléfono",     maxLen: 60, linea: true },
      { clave: "contacto.etiquetaWhatsapp",  etiqueta: "Contacto · rótulo de WhatsApp",     porDefecto: "WhatsApp",     maxLen: 60, linea: true },
      { clave: "contacto.etiquetaHorarios",  etiqueta: "Contacto · rótulo de los horarios", porDefecto: "Horarios",     maxLen: 60, linea: true },
      { clave: "contacto.cerrado",           etiqueta: "Contacto · cómo se dice «cerrado»", porDefecto: "Cerrado",      maxLen: 40, linea: true },
      { clave: "contacto.cta",               etiqueta: "Contacto · botón de reservar",      porDefecto: "Agendar Cita", maxLen: 60, linea: true },
    ],
    noEditables: [
      { donde: "Menú de navegación (y su versión móvil, con el rótulo «Menú»)", porque: "Los enlaces siguen a las secciones que estén encendidas." },
      { donde: "Pie de página, incluido «Aviso de privacidad» y «Hecho con DaleControl»", porque: "El pie es nuestro, no de la clínica." },
      { donde: "Portada · pastilla «{especialidad} · {ciudad}» y las etiquetas de especialidad", porque: "Son datos de la clínica y del catálogo de su categoría." },
      { donde: "Portada · «{nota} de 5» de la tarjeta de calificación", porque: "Se construye con la nota." },
      { donde: "Portada · la leyenda «Google» del sello de calificación", porque: "Sustituye a «calificación» sola cuando hay ficha de Google conectada: es una condición, no un literal. La versión sin Google SÍ se edita." },
      { donde: "«Dr(a). {nombre} {apellido}» y las especialidades del equipo", porque: "Se arman con datos del equipo." },
      { donde: "«{n} reseñas verificadas»", porque: "Se construye con lo que devuelve Google." },
      { donde: "El texto del mapa cuando no hay mapa configurado", porque: "Es una expresión con respaldo." },
      { donde: "Las reseñas de Google", porque: "Son de Google. No hay dónde guardarlas si alguien las reescribe." },
    ],
  },

  calido: {
    id: "calido",
    nombre: "Cálido",
    para: "Tonos suaves y formas redondeadas. Familiar y cercana.",
    leeManifiesto: true,
    instrumentada: true,
    secciones: [SEC_SERVICIOS, SEC_EQUIPO, SEC_GALERIA, SEC_OPINIONES, SEC_FAQ, SEC_CONTACTO, SEC_RESERVAR],
    fotos: [FOTO_PORTADA],
    /* Tampoco usa TEXTOS_BASE. Y aquí NO hay bajadas de sección: el
       encabezado de esta plantilla es emoji + kicker + título, sin más, así
       que declarar `subtitulo` habría sido ofrecer un campo que no se pinta
       en ninguna parte. */
    textos: [
      { seccion: "servicios", campo: "titulo",    etiqueta: "Título de servicios",  porDefecto: "Cuidamos cada sonrisa con cariño" },
      { seccion: "equipo",    campo: "titulo",    etiqueta: "Título del equipo",    porDefecto: "Doctores que te hacen sentir en casa" },
      { seccion: "galeria",   campo: "titulo",    etiqueta: "Título de la galería", porDefecto: "Un lugar pensado para tu sonrisa" },
      { seccion: "opiniones", campo: "titulo",    etiqueta: "Título de opiniones",  porDefecto: "Familias que ya confían en nosotros" },
      { seccion: "faq",       campo: "titulo",    etiqueta: "Título de preguntas",  porDefecto: "Resolvemos tus dudas" },
      { seccion: "contacto",  campo: "titulo",    etiqueta: "Título de contacto",   porDefecto: "Estamos cerca de ti" },
      { seccion: "reservar",  campo: "titulo",    etiqueta: "Título del cierre",    porDefecto: "¿Listos para sonreír juntos?" },
      { seccion: "reservar",  campo: "subtitulo", etiqueta: "Bajada del cierre",    porDefecto: "Agenda tu cita en línea. Te escribimos por WhatsApp para confirmar." },
    ],
    copia: [
      { clave: "nav.cta",   etiqueta: "Barra · botón de reservar", porDefecto: "Agendar Cita",  maxLen: 40, linea: true },
      { clave: "hero.cta",  etiqueta: "Portada · botón principal", porDefecto: "Agendar Cita",  maxLen: 60, linea: true },
      { clave: "hero.cta2", etiqueta: "Portada · botón de servicios", porDefecto: "Ver servicios", maxLen: 60, linea: true },

      { clave: "chips.pacientes", etiqueta: "Portada · leyenda de pacientes", porDefecto: "pacientes felices",   maxLen: 60, linea: true },
      { clave: "chips.anios",     etiqueta: "Portada · leyenda de años",      porDefecto: "años de experiencia", maxLen: 60, linea: true },
      { clave: "chips.tarjeta.titulo", etiqueta: "Portada · tarjeta flotante · título", porDefecto: "Sin miedo al dentista",              maxLen: 60,  linea: true },
      { clave: "chips.tarjeta.texto",  etiqueta: "Portada · tarjeta flotante · texto",  porDefecto: "Trato amable para toda la familia", maxLen: 120, linea: true },

      { clave: "servicios.kicker", etiqueta: "Servicios · etiqueta",              porDefecto: "Nuestros servicios", maxLen: 60, linea: true },
      { clave: "servicios.cta",    etiqueta: "Servicios · botón de cada tarjeta", porDefecto: "Agendar",            maxLen: 40, linea: true },
      { clave: "equipo.kicker",    etiqueta: "Equipo · etiqueta",                 porDefecto: "Nuestro equipo",     maxLen: 60, linea: true },
      { clave: "equipo.cta",       etiqueta: "Equipo · botón de cada doctor",     porDefecto: "Agendar consulta",   maxLen: 60, linea: true },
      { clave: "galeria.kicker",   etiqueta: "Galería · etiqueta",                porDefecto: "Galería",            maxLen: 60, linea: true },
      { clave: "galeria.cta",      etiqueta: "Galería · botón",                   porDefecto: "Ven a conocernos · Agendar Cita", maxLen: 80, linea: true },
      { clave: "opiniones.kicker", etiqueta: "Opiniones · etiqueta",              porDefecto: "Testimonios",        maxLen: 60, linea: true },

      { clave: "faq.kicker", etiqueta: "Preguntas · etiqueta",       porDefecto: "Preguntas frecuentes", maxLen: 60, linea: true },
      { clave: "faq.nota",   etiqueta: "Preguntas · texto de cierre", porDefecto: "¿Te quedó otra duda? Con gusto te ayudamos.", maxLen: 160, linea: true },
      { clave: "faq.cta",    etiqueta: "Preguntas · botón",          porDefecto: "Agendar Cita",         maxLen: 60, linea: true },

      { clave: "reservar.cta", etiqueta: "Cierre · botón", porDefecto: "Agendar Cita", maxLen: 60, linea: true },
      { clave: "flotante.cta", etiqueta: "Botón flotante de reservar", porDefecto: "Agendar Cita", maxLen: 40, linea: true },

      { clave: "contacto.kicker",            etiqueta: "Contacto · etiqueta",               porDefecto: "Visítanos",    maxLen: 60, linea: true },
      { clave: "contacto.etiquetaDireccion", etiqueta: "Contacto · rótulo de la dirección", porDefecto: "Dirección",    maxLen: 60, linea: true },
      { clave: "contacto.etiquetaTelefono",  etiqueta: "Contacto · rótulo del teléfono",    porDefecto: "Teléfono",     maxLen: 60, linea: true },
      { clave: "contacto.etiquetaWhatsapp",  etiqueta: "Contacto · rótulo de WhatsApp",     porDefecto: "WhatsApp",     maxLen: 60, linea: true },
      { clave: "contacto.etiquetaHorarios",  etiqueta: "Contacto · rótulo de los horarios", porDefecto: "Horarios",     maxLen: 60, linea: true },
      { clave: "contacto.cerrado",           etiqueta: "Contacto · cómo se dice «cerrado»", porDefecto: "Cerrado",      maxLen: 40, linea: true },
      { clave: "contacto.cta",               etiqueta: "Contacto · botón de reservar",      porDefecto: "Agendar Cita", maxLen: 60, linea: true },
    ],
    noEditables: [
      { donde: "Menú de navegación (y su versión móvil, con el rótulo «Menú»)", porque: "Los enlaces siguen a las secciones que estén encendidas." },
      { donde: "Pie de página, incluido «Hecho con DaleControl»", porque: "El pie es nuestro, no de la clínica." },
      { donde: "EL TITULAR DE LA PORTADA", porque: "Es el caso que el plan marcó como no instrumentable: se parte el eslogan por la PRIMERA COMA, se pinta la segunda mitad en color y se le pega « 🦷✨». No es una cadena, así que como texto plano se guardaría la mezcla ya montada. El eslogan se sigue editando desde el formulario y desde las otras siete plantillas." },
      { donde: "Portada · pastilla «👋 {especialidad}»", porque: "Es el dato de especialidad de la clínica." },
      { donde: "Portada · «{nota} · {n} reseñas»", porque: "Se construye con lo que devuelve Google." },
      { donde: "Los emojis de los encabezados de sección y del cierre", porque: "Son decoración de la plantilla, no copy: van pegados fuera de lo editable para que la clínica no los pierda al reescribir el texto." },
      { donde: "«Dr(a). {nombre} {apellido}» y las especialidades del equipo", porque: "Se arman con datos del equipo." },
      { donde: "El texto del mapa cuando no hay mapa configurado", porque: "Es una expresión con respaldo: o la dirección, o un aviso." },
      { donde: "Las reseñas de Google", porque: "Son de Google. No hay dónde guardarlas si alguien las reescribe." },
    ],
  },

  equipo: {
    id: "equipo",
    pinta: ["urgencias", "msi"],
    nombre: "Equipo",
    para: "Varias personas atendiendo: el argumento es quién te atiende.",
    leeManifiesto: true,
    instrumentada: true,
    secciones: [
      SEC_SERVICIOS,
      SEC_EQUIPO,
      { id: "casos", nombre: "Casos antes / después", consume: ["fotos"] },
      { id: "tecnologia1", nombre: "Tecnología · bloque 1", consume: ["fotos"] },
      { id: "tecnologia2", nombre: "Tecnología · bloque 2", consume: ["fotos"] },
      SEC_OPINIONES,
      SEC_GALERIA,
      SEC_FAQ,
      SEC_CONTACTO,
      /* SIN SEC_RESERVAR: esta plantilla NO pinta bloque de cierre —va de FAQ a
         Ubicación y al pie—, y declararlo ponía en la pestaña Diseño un
         interruptor bloqueado para una sección que no existe. */
    ],
    fotos: [
      FOTO_PORTADA,
      ...FOTOS_CASO,
      { id: "tecnologia1", nombre: "Tecnología 1", proporcion: "16:11", seccion: "tecnologia1", zona: "derecha", ayuda: "El aparato o el consultorio del que quieres presumir." },
      { id: "tecnologia2", nombre: "Tecnología 2", proporcion: "16:11", seccion: "tecnologia2", zona: "izquierda", ayuda: "Segunda foto de equipo o instalaciones." },
    ],
    /* Escritos uno por uno contra templates/template-equipo.tsx. Hasta la
       auditoría de la etapa D esta lista empezaba con `...TEXTOS_BASE`, una
       constante compartida que era el ÚLTIMO sitio del que salían defaults
       falsos: prometía seis literales que solo pintan las plantillas nuevas.
       Se borró la constante y aquí queda lo que esta plantilla pinta de verdad.
       Ocho mentían y están corregidas: las dos tarjetas de tecnología pintan
       las dos "Equipo del consultorio" (salen del MISMO bucle), y cinco bajadas
       anunciaban un texto que la plantilla no pinta si el campo va vacío. */
    textos: [
      { seccion: "servicios", campo: "titulo", etiqueta: "Título de servicios", porDefecto: "Lo que cuesta, antes de sentarte" },
      { seccion: "servicios", campo: "subtitulo", etiqueta: "Bajada de servicios", porDefecto: "" },
      /* Con VARIOS doctores —el caso que da nombre a la plantilla— el título es
         "Especialistas, no rotación de pasantes"; con uno solo, "Quién te va a
         atender". Aquí va el mayoritario. */
      { seccion: "equipo", campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Especialistas, no rotación de pasantes" },
      { seccion: "equipo", campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "" },
      { seccion: "galeria", campo: "titulo", etiqueta: "Título de la galería", porDefecto: "Así se ve por dentro" },
      /* Con ficha de Google conectada el título es "Lo que dicen en Google".
         Aquí va el caso por defecto, que es no tenerla. */
      { seccion: "opiniones", campo: "titulo", etiqueta: "Título de opiniones", porDefecto: "Lo que dicen nuestros pacientes" },
      { seccion: "faq", campo: "titulo", etiqueta: "Título de preguntas", porDefecto: "Lo que todos preguntan antes de venir" },
      { seccion: "contacto", campo: "titulo", etiqueta: "Título de contacto", porDefecto: "Dónde estamos" },
      { seccion: "casos", campo: "titulo", etiqueta: "Título de casos", porDefecto: "Arrastra y mira la diferencia" },
      { seccion: "casos", campo: "subtitulo", etiqueta: "Descripción del caso", porDefecto: "" },
      { seccion: "tecnologia", campo: "titulo", etiqueta: "Título de tecnología", porDefecto: "Lo que hay detrás del sillón" },
      { seccion: "tecnologia1", campo: "titulo", etiqueta: "Tecnología 1 · nombre", porDefecto: "Equipo del consultorio" },
      { seccion: "tecnologia1", campo: "subtitulo", etiqueta: "Tecnología 1 · texto", porDefecto: "" },
      { seccion: "tecnologia2", campo: "titulo", etiqueta: "Tecnología 2 · nombre", porDefecto: "Equipo del consultorio" },
      { seccion: "tecnologia2", campo: "subtitulo", etiqueta: "Tecnología 2 · texto", porDefecto: "" },
    ],
    copia: [
      /* Barra de arriba. Los enlaces del menú no; el botón de reservar sí. */
      { clave: "nav.cta", etiqueta: "Barra · botón de reservar", porDefecto: "Agenda tu cita", maxLen: 40, linea: true },

      /* Portada */
      { clave: "hero.cta",             etiqueta: "Portada · botón principal",   porDefecto: "Agendar cita", maxLen: 60, linea: true },
      { clave: "hero.whatsapp",        etiqueta: "Portada · botón de WhatsApp", porDefecto: "WhatsApp",     maxLen: 60, linea: true },
      { clave: "hero.cifraPacientes",  etiqueta: "Portada · leyenda de «pacientes atendidos»", porDefecto: "pacientes atendidos", maxLen: 60, linea: true },

      /* Los tres accesos rápidos que cuelgan del hero */
      { clave: "accesos.servicios.titulo",  etiqueta: "Acceso 1 · título", porDefecto: "Servicios y precios",           maxLen: 60,  linea: true },
      { clave: "accesos.servicios.texto",   etiqueta: "Acceso 1 · texto",  porDefecto: "Costos claros antes de sentarte", maxLen: 120, linea: true },
      { clave: "accesos.agenda.titulo",     etiqueta: "Acceso 2 · título", porDefecto: "Agenda tu cita",                maxLen: 60,  linea: true },
      { clave: "accesos.agenda.texto",      etiqueta: "Acceso 2 · texto",  porDefecto: "En línea, sin llamar",            maxLen: 120, linea: true },
      { clave: "accesos.equipo.titulo",     etiqueta: "Acceso 3 · título (con equipo)",  porDefecto: "Conócenos",   maxLen: 60, linea: true },
      { clave: "accesos.ubicacion.titulo",  etiqueta: "Acceso 3 · título (sin equipo)",  porDefecto: "Cómo llegar", maxLen: 60, linea: true },

      /* Los cuatro "valores". Solo se pintan si la clínica tiene el dato. */
      { clave: "valores.urgencias.titulo", etiqueta: "Valor · título de urgencias",        porDefecto: "Urgencias",            maxLen: 60, linea: true },
      { clave: "valores.msi.titulo",       etiqueta: "Valor · título de meses sin intereses", porDefecto: "Meses sin intereses", maxLen: 60, linea: true },
      { clave: "valores.precios.titulo",   etiqueta: "Valor · título de precios",          porDefecto: "Precios a la vista",   maxLen: 60, linea: true },
      { clave: "valores.precios.texto",    etiqueta: "Valor · texto de precios",           porDefecto: "El costo de cada tratamiento está publicado antes de que agendes.", maxLen: 240 },
      { clave: "valores.doctor.titulo",    etiqueta: "Valor · título de elegir doctor",    porDefecto: "Elige a tu doctor",    maxLen: 60, linea: true },
      { clave: "valores.doctor.texto",     etiqueta: "Valor · texto de elegir doctor",     porDefecto: "Agenda directo con el especialista que prefieras.", maxLen: 240 },

      /* Etiquetas de bloque */
      { clave: "servicios.kicker",  etiqueta: "Servicios · etiqueta",   porDefecto: "Servicios y precios",   maxLen: 60, linea: true },
      { clave: "equipo.kicker",     etiqueta: "Equipo · etiqueta",      porDefecto: "Quién te atiende",      maxLen: 60, linea: true },
      { clave: "casos.kicker",      etiqueta: "Casos · etiqueta",       porDefecto: "Casos reales",          maxLen: 60, linea: true },
      { clave: "casos.antes",   etiqueta: "Antes y después · pastilla izquierda", porDefecto: "Antes",   maxLen: 40, linea: true },
      { clave: "casos.despues", etiqueta: "Antes y después · pastilla derecha",   porDefecto: "Después", maxLen: 40, linea: true },
      { clave: "tecnologia.kicker", etiqueta: "Tecnología · etiqueta",  porDefecto: "Tecnología",            maxLen: 60, linea: true },
      { clave: "opiniones.kicker",  etiqueta: "Opiniones · etiqueta",   porDefecto: "Opiniones",             maxLen: 60, linea: true },
      { clave: "galeria.kicker",    etiqueta: "Galería · etiqueta",     porDefecto: "La clínica",            maxLen: 60, linea: true },
      { clave: "faq.kicker",        etiqueta: "Preguntas · etiqueta",   porDefecto: "Preguntas frecuentes",  maxLen: 60, linea: true },
      { clave: "contacto.kicker",   etiqueta: "Contacto · etiqueta",    porDefecto: "Ubicación y horarios",  maxLen: 60, linea: true },

      /* Botones repartidos por la página */
      { clave: "servicios.cta",  etiqueta: "Servicios · botón de cada tarjeta", porDefecto: "Agendar",              maxLen: 40, linea: true },
      { clave: "casos.cta",      etiqueta: "Casos · botón",                     porDefecto: "Quiero mi valoración", maxLen: 60, linea: true },
      { clave: "tecnologia.cta", etiqueta: "Tecnología · botón",                porDefecto: "Agendar cita",         maxLen: 60, linea: true },

      /* Bloque de ubicación */
      { clave: "contacto.etiquetaHorarios", etiqueta: "Ubicación · rótulo de los horarios", porDefecto: "Horarios",    maxLen: 60, linea: true },
      { clave: "contacto.cerrado",          etiqueta: "Ubicación · cómo se dice «cerrado»", porDefecto: "Cerrado",     maxLen: 40, linea: true },
      { clave: "contacto.comoLlegar",       etiqueta: "Ubicación · botón del mapa",         porDefecto: "Cómo llegar", maxLen: 60, linea: true },
      { clave: "contacto.cta",              etiqueta: "Ubicación · botón de reservar",      porDefecto: "Agendar cita", maxLen: 60, linea: true },
    ],
    noEditables: [
      { donde: "Menú de navegación", porque: "Los enlaces siguen a las secciones encendidas; renombrarlos los desacoplaría de su destino." },
      { donde: "Pie de página, incluido «Hecho con DaleControl»", porque: "El pie es nuestro, no de la clínica." },
      { donde: "Barra superior (teléfono y dirección)", porque: "Son datos de la clínica con un emoji pegado; se cambian en Configuración." },
      { donde: "Portada · kicker «{especialidad} · desde hace {n} años»", porque: "Se construye con dos datos; como texto plano se guardaría la mezcla ya montada." },
      { donde: "Portada · leyendas de reseñas, años y especialistas", porque: "Las tres se construyen con datos («{n} reseñas en Google», «años atendiendo {ciudad}», singular/plural de especialista). La de «pacientes atendidos» SÍ se edita: es la única que es un literal." },
      { donde: "Acceso 3 · texto («{n} especialistas» / la ciudad)", porque: "Es una expresión con respaldo, no una cadena." },
      { donde: "Valor de meses sin intereses · texto", porque: "Lleva los plazos dentro («a 3, 6, 12 meses sin intereses»)." },
      { donde: "«{duración} min» de cada servicio", porque: "Es el dato de duración del servicio." },
      { donde: "El « · hoy» que se pega al día de la semana en los horarios", porque: "Se construye sobre el nombre del día, que sale del calendario." },
      { donde: "«Dr/a. {nombre} {apellido}» y «Agendar con {nombre}»", porque: "Se arman con datos del equipo." },
      { donde: "«{n} reseñas verificadas en Google»", porque: "Se construye con lo que devuelve Google." },
      { donde: "Etiqueta de accesibilidad del botón flotante de WhatsApp", porque: "No es contenido: es texto para lectores de pantalla." },
      { donde: "Las reseñas de Google", porque: "Son de Google. No hay dónde guardarlas si alguien las reescribe." },
    ],
  },

  sonrisa: {
    id: "sonrisa",
    pinta: ["msi"],
    nombre: "Sonrisa",
    para: "Estética dental: la transformación manda y las fotos son enormes.",
    leeManifiesto: true,
    instrumentada: true,
    secciones: [
      { id: "casos", nombre: "Antes y después (protagonista)", consume: ["fotos"] },
      SEC_SERVICIOS,
      SEC_GALERIA,
      SEC_EQUIPO,
      SEC_OPINIONES,
      { id: "pagos", nombre: "Meses sin intereses", consume: ["msi", "servicios"] },
      SEC_FAQ,
      SEC_CONTACTO,
      SEC_RESERVAR,
    ],
    fotos: [
      FOTO_PORTADA,
      ...FOTOS_CASO,
      { id: "doctor", nombre: "Foto del doctor o doctora", proporcion: "4:5 vertical", seccion: "equipo", zona: "izquierda", ayuda: "Retrato vertical. Si no la subes se usa la del perfil del doctor." },
      { id: "servicio1", nombre: "Foto del servicio 1", proporcion: "4:5 vertical", seccion: "servicios", zona: "izquierda" },
      { id: "servicio2", nombre: "Foto del servicio 2", proporcion: "4:5 vertical", seccion: "servicios", zona: "completa" },
      { id: "servicio3", nombre: "Foto del servicio 3", proporcion: "4:5 vertical", seccion: "servicios", zona: "derecha" },
    ],
    /* Los `porDefecto` están verificados contra ESTE archivo
       (templates/template-sonrisa.tsx), uno por uno. Tres estaban mal y se
       corrigieron al instrumentar: "equipo.titulo" decía "Quién te atiende" y
       la plantilla pinta "El equipo"; "casos.subtitulo" anunciaba un texto por
       defecto que la plantilla NO pinta (sin nada escrito, ahí no sale nada); y
       "pagos.subtitulo" no tiene default fijo — se construye con los plazos de
       MSI de cada clínica, así que aquí va vacío y el literal real (interpolado)
       se lo pasa la plantilla al <Txt>. Un `porDefecto` que no es el literal
       real le miente a la clínica sobre lo que verá si deja el campo en blanco. */
    textos: [
      { seccion: "casos", campo: "titulo", etiqueta: "Título del antes y después", porDefecto: "Arrastra para ver el cambio" },
      { seccion: "casos", campo: "subtitulo", etiqueta: "Descripción del caso", porDefecto: "" },
      { seccion: "servicios", campo: "titulo", etiqueta: "Título de tratamientos", porDefecto: "Lo que hacemos y lo que cuesta" },
      { seccion: "servicios", campo: "subtitulo", etiqueta: "Bajada de tratamientos", porDefecto: "" },
      { seccion: "galeria", campo: "titulo", etiqueta: "Título de la galería", porDefecto: "Así quedan nuestros pacientes" },
      { seccion: "equipo", campo: "titulo", etiqueta: "Título del equipo", porDefecto: "El equipo" },
      { seccion: "opiniones", campo: "titulo", etiqueta: "Título de opiniones", porDefecto: "Lo que dicen nuestros pacientes" },
      { seccion: "pagos", campo: "titulo", etiqueta: "Título de pagos", porDefecto: "Tu tratamiento, en mensualidades" },
      { seccion: "pagos", campo: "subtitulo", etiqueta: "Bajada de pagos", porDefecto: "" },
      { seccion: "faq", campo: "titulo", etiqueta: "Título de preguntas", porDefecto: "Antes de agendar" },
      { seccion: "reservar", campo: "titulo", etiqueta: "Título del cierre", porDefecto: "Empieza por tu valoración" },
      { seccion: "reservar", campo: "subtitulo", etiqueta: "Bajada del cierre", porDefecto: "Agenda en línea, sin llamar. Te confirmamos por WhatsApp." },
    ],
    copia: [
      { clave: "nav.cta",   etiqueta: "Barra · botón de reservar",  porDefecto: "Agenda tu valoración", maxLen: 60, linea: true },
      { clave: "hero.cta",  etiqueta: "Portada · botón principal",  porDefecto: "Agenda tu valoración", maxLen: 60, linea: true },
      { clave: "hero.cta2", etiqueta: "Portada · botón secundario", porDefecto: "Ver transformaciones", maxLen: 60, linea: true },

      /* La tira de cifras. Aquí las CUATRO leyendas son literales (en `equipo`
         tres de ellas se construyen), así que aquí sí se editan las cuatro. */
      { clave: "cifras.anios",     etiqueta: "Cifras · leyenda de años",      porDefecto: "años de experiencia", maxLen: 60, linea: true },
      { clave: "cifras.pacientes", etiqueta: "Cifras · leyenda de pacientes", porDefecto: "pacientes atendidos", maxLen: 60, linea: true },
      { clave: "cifras.msi",       etiqueta: "Cifras · leyenda de meses",     porDefecto: "meses sin intereses", maxLen: 60, linea: true },
      { clave: "cifras.google",    etiqueta: "Cifras · leyenda de reseñas",   porDefecto: "reseñas en Google",   maxLen: 60, linea: true,
        variante: "Solo sale con ficha de Google conectada, y las reseñas llegan por fetch: en el render de servidor los efectos no corren." },

      { clave: "casos.kicker",     etiqueta: "Antes y después · etiqueta",           porDefecto: "Casos reales",         maxLen: 60, linea: true },
      { clave: "casos.antes",   etiqueta: "Antes y después · pastilla izquierda", porDefecto: "Antes",   maxLen: 40, linea: true },
      { clave: "casos.despues", etiqueta: "Antes y después · pastilla derecha",   porDefecto: "Después", maxLen: 40, linea: true },
      { clave: "pagos.rotuloTratamiento", etiqueta: "Simulador · rótulo del tratamiento", porDefecto: "Tratamiento",     maxLen: 60, linea: true },
      { clave: "pagos.rotuloPlazo",       etiqueta: "Simulador · rótulo del plazo",       porDefecto: "Plazo",           maxLen: 60, linea: true },
      { clave: "pagos.rotuloMensual",     etiqueta: "Simulador · rótulo del pago",        porDefecto: "Tu pago mensual", maxLen: 60, linea: true },
      { clave: "servicios.kicker", etiqueta: "Tratamientos · etiqueta",              porDefecto: "Tratamientos",         maxLen: 60, linea: true },
      { clave: "servicios.cta",    etiqueta: "Tratamientos · botón de cada tarjeta", porDefecto: "Agendar",              maxLen: 40, linea: true },
      { clave: "galeria.kicker",   etiqueta: "Galería · etiqueta",                   porDefecto: "Nuestras sonrisas",    maxLen: 60, linea: true },
      { clave: "equipo.kicker",    etiqueta: "Equipo · etiqueta",                    porDefecto: "Quién te atiende",     maxLen: 60, linea: true },
      { clave: "equipo.etiquetaAtiende", etiqueta: "Equipo · rótulo de cada tratamiento", porDefecto: "Atiende",         maxLen: 40, linea: true },
      { clave: "equipo.cta",       etiqueta: "Equipo · botón de cada doctor",        porDefecto: "Agendar",              maxLen: 40, linea: true },
      { clave: "opiniones.kicker", etiqueta: "Opiniones · etiqueta",                 porDefecto: "Opiniones",            maxLen: 60, linea: true },
      { clave: "pagos.kicker",     etiqueta: "Pagos · etiqueta",                     porDefecto: "Formas de pago",       maxLen: 60, linea: true },
      { clave: "faq.kicker",       etiqueta: "Preguntas · etiqueta",                 porDefecto: "Preguntas frecuentes", maxLen: 60, linea: true },
      { clave: "reservar.cta",     etiqueta: "Cierre · botón",                       porDefecto: "Agenda tu valoración", maxLen: 60, linea: true },
    ],
    noEditables: [
      { donde: "Menú de navegación", porque: "Los enlaces siguen a las secciones encendidas." },
      { donde: "Pie de página, incluido «Hecho con DaleControl»", porque: "El pie es nuestro, no de la clínica." },
      { donde: "Portada · kicker «{especialidad} · {ciudad}»", porque: "Se construye con dos datos de la clínica." },
      { donde: "Portada · tarjeta de Google («{n} reseñas en Google»)", porque: "Se construye con lo que devuelve Google." },
      { donde: "Opiniones · titular cuando hay ficha de Google («{nota} de {n} reseñas»)", porque: "Es una cadena construida. El titular SIN Google sí se edita." },
      { donde: "Equipo · «Dr/a. {nombre} {apellido}» y «Agenda con {nombre}»", porque: "Se arman con datos del equipo." },
      { donde: "«{duración} min» de cada tratamiento", porque: "Es el dato de duración del servicio." },
      { donde: "Etiqueta de accesibilidad del botón flotante de WhatsApp", porque: "No es contenido: es texto para lectores de pantalla." },
      { donde: "Las reseñas de Google", porque: "Son de Google. No hay dónde guardarlas si alguien las reescribe." },
    ],
  },

  consultorio: {
    id: "consultorio",
    pinta: ["urgencias", "msi"],
    nombre: "Consultorio",
    para: "Para la clínica que no tiene fotos: color, precios y horarios.",
    // NO tiene ranuras de foto y es a propósito: es su razón de existir.
    sinFotos: true,
    leeManifiesto: true,
    instrumentada: true,
    secciones: [
      { id: "urgencias", nombre: "Aviso de urgencias", consume: ["urgencias"] },
      SEC_SERVICIOS,
      SEC_CONTACTO,
      SEC_EQUIPO,
      SEC_OPINIONES,
      SEC_FAQ,
      SEC_RESERVAR,
    ],
    fotos: [],
    /* `porDefecto` verificados contra templates/template-consultorio.tsx. Dos
       estaban mal: "servicios.subtitulo" anunciaba una nota que la plantilla NO
       pinta si la clínica no escribe nada, y "equipo.titulo" decía "Quién te
       atiende" —que es el KICKER de esa sección, no su título—. El título real
       es "Tu dentista" con un solo doctor, y con varios se CONSTRUYE
       ("3 dentistas, siempre los mismos"), así que aquí va el literal y la
       plantilla le pasa al <Txt> el que toque. */
    textos: [
      { seccion: "servicios", campo: "titulo", etiqueta: "Título de la lista de precios", porDefecto: "Lo que cuesta cada cosa" },
      { seccion: "servicios", campo: "subtitulo", etiqueta: "Nota bajo los precios", porDefecto: "" },
      { seccion: "contacto", campo: "titulo", etiqueta: "Título de horarios", porDefecto: "Cuándo y dónde" },
      { seccion: "equipo", campo: "titulo", etiqueta: "Título de dentistas", porDefecto: "Tu dentista" },
      { seccion: "opiniones", campo: "titulo", etiqueta: "Título de opiniones", porDefecto: "Lo que dicen nuestros pacientes" },
      { seccion: "faq", campo: "titulo", etiqueta: "Título de preguntas", porDefecto: "Lo que más nos preguntan" },
      { seccion: "reservar", campo: "titulo", etiqueta: "Título del cierre", porDefecto: "Agenda en dos minutos, sin llamar" },
      { seccion: "reservar", campo: "subtitulo", etiqueta: "Bajada del cierre", porDefecto: "Eliges día y hora y te confirmamos por WhatsApp." },
    ],
    copia: [
      { clave: "nav.cta",   etiqueta: "Barra · botón de reservar",  porDefecto: "Agendar",              maxLen: 40, linea: true },
      { clave: "hero.cta",  etiqueta: "Portada · botón principal",  porDefecto: "Agendar cita",       maxLen: 60, linea: true },
      { clave: "hero.cta2", etiqueta: "Portada · botón de precios", porDefecto: "Ver lista de precios", maxLen: 60, linea: true },

      /* De los cuatro datos del hero, solo DOS son literales; los otros dos se
         construyen (el nombre del tratamiento más barato, los años con la
         ciudad, las reseñas de Google). */
      { clave: "datos.hoyCierra", etiqueta: "Portada · leyenda de la hora de cierre", porDefecto: "hoy cerramos a las", maxLen: 60, linea: true },
      { clave: "datos.pacientes", etiqueta: "Portada · leyenda de pacientes",         porDefecto: "pacientes atendidos", maxLen: 60, linea: true },

      { clave: "urgencias.titulo", etiqueta: "Urgencias · titular", porDefecto: "¿Traes dolor ahorita?", maxLen: 80, linea: true },
      { clave: "urgencias.cta",    etiqueta: "Urgencias · botón",   porDefecto: "Llamar ahora",          maxLen: 40, linea: true },

      { clave: "servicios.kicker",         etiqueta: "Precios · etiqueta",              porDefecto: "Lista de precios", maxLen: 60, linea: true },
      { clave: "servicios.colTratamiento", etiqueta: "Precios · columna «tratamiento»", porDefecto: "Tratamiento",      maxLen: 40, linea: true },
      { clave: "servicios.colDuracion",    etiqueta: "Precios · columna «duración»",    porDefecto: "Duración",         maxLen: 40, linea: true },
      { clave: "servicios.colPrecio",      etiqueta: "Precios · columna «precio»",      porDefecto: "Precio",           maxLen: 40, linea: true },
      { clave: "servicios.cta",            etiqueta: "Precios · botón de cada fila",    porDefecto: "Agendar",          maxLen: 40, linea: true },

      { clave: "contacto.kicker",     etiqueta: "Horarios · etiqueta",                porDefecto: "Horarios y ubicación", maxLen: 60, linea: true },
      { clave: "contacto.cerrado",    etiqueta: "Horarios · cómo se dice «cerrado»",  porDefecto: "Cerrado",              maxLen: 40, linea: true },
      { clave: "contacto.comoLlegar", etiqueta: "Horarios · botón del mapa",          porDefecto: "Cómo llegar",          maxLen: 60, linea: true },
      { clave: "contacto.llamar",     etiqueta: "Horarios · botón de llamar",         porDefecto: "Llamar",               maxLen: 40, linea: true },

      { clave: "equipo.kicker",    etiqueta: "Dentistas · etiqueta",             porDefecto: "Quién te atiende",     maxLen: 60, linea: true },
      { clave: "equipo.cta",       etiqueta: "Dentistas · botón de cada doctor", porDefecto: "Agendar",              maxLen: 40, linea: true },
      { clave: "opiniones.kicker", etiqueta: "Opiniones · etiqueta",             porDefecto: "Opiniones",            maxLen: 60, linea: true },
      { clave: "faq.kicker",       etiqueta: "Preguntas · etiqueta",             porDefecto: "Preguntas frecuentes", maxLen: 60, linea: true },
      { clave: "reservar.cta",     etiqueta: "Cierre · botón",                   porDefecto: "Agendar mi cita",    maxLen: 60, linea: true },
      { clave: "flotante.whatsapp", etiqueta: "Botón flotante de WhatsApp",      porDefecto: "WhatsApp",           maxLen: 40, linea: true },
    ],
    noEditables: [
      { donde: "Menú de navegación", porque: "Los enlaces siguen a las secciones encendidas." },
      { donde: "Pie de página, incluido «Hecho con DaleControl»", porque: "El pie es nuestro, no de la clínica." },
      { donde: "Barra superior (teléfono, dirección, «Hoy {hora}»)", porque: "Son datos de la clínica, con emoji o con la hora pegada." },
      { donde: "Portada · «{especialidad} · desde hace {n} años» del logotipo", porque: "Se construye con dos datos." },
      { donde: "Portada · leyenda del precio más barato y la de los años («años en {ciudad}»)", porque: "La primera es el nombre del tratamiento en minúsculas y la segunda lleva la ciudad dentro. Las otras dos leyendas SÍ se editan." },
      { donde: "Opiniones · titular con ficha de Google («{nota} en Google, {n} reseñas»)", porque: "Es una cadena construida. El titular SIN Google sí se edita." },
      { donde: "Dentistas · «Dr/a. {nombre} {apellido}» y sus especialidades", porque: "Se arman con datos del equipo." },
      { donde: "«{duración} min» y el precio de cada fila", porque: "El precio SÍ se edita (es del servicio); la duración es el dato de agenda." },
      { donde: "La nota «Meses sin intereses disponibles: {plazos} pagos…» bajo la lista de precios", porque: "Lleva los plazos de la clínica dentro." },
      { donde: "El « · hoy» que se pega al día de la semana", porque: "Se construye sobre el nombre del día." },
      { donde: "El texto del mapa cuando no hay mapa configurado", porque: "Es una expresión con respaldo: o la ciudad, o un aviso." },
      { donde: "Las reseñas de Google", porque: "Son de Google. No hay dónde guardarlas si alguien las reescribe." },
    ],
  },

  especialistas: {
    id: "especialistas",
    pinta: ["msi"],
    nombre: "Especialistas",
    para: "Alta especialidad y ticket alto: tecnología, credenciales y financiamiento.",
    leeManifiesto: true,
    instrumentada: true,
    secciones: [
      SEC_SERVICIOS,
      { id: "tecnologia", nombre: "Tecnología (3 tarjetas)", consume: ["fotos"] },
      { id: "casos", nombre: "Caso documentado", consume: ["fotos"] },
      SEC_EQUIPO,
      { id: "pagos", nombre: "Financiamiento", consume: ["msi", "servicios"] },
      SEC_OPINIONES,
      SEC_FAQ,
      SEC_CONTACTO,
      /* SIN SEC_RESERVAR: igual que `equipo`, esta plantilla no pinta bloque de
         cierre y declararlo ofrecía un interruptor para nada. */
    ],
    fotos: [
      FOTO_PORTADA,
      ...FOTOS_CASO,
      { id: "tecnologia1", nombre: "Tecnología 1", proporcion: "16:11", seccion: "tecnologia", zona: "izquierda" },
      { id: "tecnologia2", nombre: "Tecnología 2", proporcion: "16:11", seccion: "tecnologia", zona: "completa" },
      { id: "tecnologia3", nombre: "Tecnología 3", proporcion: "16:11", seccion: "tecnologia", zona: "derecha" },
      { id: "doctor", nombre: "Foto del especialista", proporcion: "4:5 vertical", seccion: "equipo", zona: "izquierda", ayuda: "Retrato vertical. Si no la subes se usa la del perfil del doctor." },
    ],
    /* `porDefecto` verificados contra templates/template-especialistas.tsx, uno
       por uno. Siete estaban mal, y es el motivo de que esta lista se revise
       plantilla por plantilla en vez de copiarla:
         · Las tres tarjetas de tecnología anunciaban "Tomografía 3D",
           "Escáner intraoral" y "Guía quirúrgica"; la plantilla pinta "Equipo"
           en las tres.
         · Cuatro bajadas (servicios, las tres de tecnología, casos) anunciaban
           un texto que la plantilla NO pinta: sin nada escrito, ahí no sale nada.
         · "contacto.titulo" decía "Dónde estamos", que es el KICKER de esa
           sección. El título real es la ciudad de la clínica y, si no la tiene,
           "Ubicación y horarios".
         · "pagos.subtitulo" no tiene default fijo: se construye con los plazos.
       Un `porDefecto` que no es el literal real le miente a la clínica sobre lo
       que verá si deja el campo en blanco. */
    textos: [
      { seccion: "servicios", campo: "titulo", etiqueta: "Título de tratamientos", porDefecto: "Alta especialidad, precio cerrado" },
      { seccion: "servicios", campo: "subtitulo", etiqueta: "Bajada de tratamientos", porDefecto: "" },
      { seccion: "tecnologia", campo: "titulo", etiqueta: "Título de tecnología", porDefecto: "Nada se improvisa en el sillón" },
      { seccion: "tecnologia1", campo: "titulo", etiqueta: "Tecnología 1 · nombre", porDefecto: "Equipo" },
      { seccion: "tecnologia1", campo: "subtitulo", etiqueta: "Tecnología 1 · texto", porDefecto: "" },
      { seccion: "tecnologia2", campo: "titulo", etiqueta: "Tecnología 2 · nombre", porDefecto: "Equipo" },
      { seccion: "tecnologia2", campo: "subtitulo", etiqueta: "Tecnología 2 · texto", porDefecto: "" },
      { seccion: "tecnologia3", campo: "titulo", etiqueta: "Tecnología 3 · nombre", porDefecto: "Equipo" },
      { seccion: "tecnologia3", campo: "subtitulo", etiqueta: "Tecnología 3 · texto", porDefecto: "" },
      { seccion: "casos", campo: "titulo", etiqueta: "Título del caso", porDefecto: "Antes y después" },
      { seccion: "casos", campo: "subtitulo", etiqueta: "Descripción del caso", porDefecto: "" },
      { seccion: "equipo", campo: "titulo", etiqueta: "Título del especialista", porDefecto: "Quién te va a operar" },
      { seccion: "pagos", campo: "titulo", etiqueta: "Título de financiamiento", porDefecto: "Tu tratamiento cabe en tu mes" },
      { seccion: "pagos", campo: "subtitulo", etiqueta: "Bajada de financiamiento", porDefecto: "" },
      { seccion: "opiniones", campo: "titulo", etiqueta: "Título de opiniones", porDefecto: "Lo que dicen nuestros pacientes" },
      { seccion: "faq", campo: "titulo", etiqueta: "Título de preguntas", porDefecto: "Antes de decidir" },
      { seccion: "contacto", campo: "titulo", etiqueta: "Título de contacto", porDefecto: "Ubicación y horarios" },
    ],
    copia: [
      { clave: "nav.cta",   etiqueta: "Barra · botón de reservar",  porDefecto: "Valoración",           maxLen: 40, linea: true },
      { clave: "hero.cta",  etiqueta: "Portada · botón principal",  porDefecto: "Agenda tu valoración", maxLen: 60, linea: true },
      { clave: "hero.cta2", etiqueta: "Portada · botón de casos",   porDefecto: "Ver casos",            maxLen: 60, linea: true },

      /* De las cuatro cifras de la franja, tres son literales; la de Google se
         construye con el número de reseñas. */
      { clave: "franja.pacientes", etiqueta: "Franja · leyenda de pacientes", porDefecto: "pacientes atendidos",  maxLen: 60, linea: true },
      { clave: "franja.anios",     etiqueta: "Franja · leyenda de años",      porDefecto: "años de especialidad", maxLen: 60, linea: true },
      { clave: "franja.msi",       etiqueta: "Franja · leyenda de meses",     porDefecto: "meses sin intereses",  maxLen: 60, linea: true },

      { clave: "servicios.kicker", etiqueta: "Tratamientos · etiqueta",           porDefecto: "Tratamientos", maxLen: 60, linea: true },
      { clave: "servicios.cta",    etiqueta: "Tratamientos · botón de cada fila", porDefecto: "Valoración",   maxLen: 40, linea: true },
      { clave: "tecnologia.kicker", etiqueta: "Tecnología · etiqueta",            porDefecto: "Tecnología",   maxLen: 60, linea: true },

      { clave: "casos.kicker", etiqueta: "Caso · etiqueta", porDefecto: "Caso documentado",     maxLen: 60, linea: true },
      { clave: "casos.antes",   etiqueta: "Antes y después · pastilla izquierda", porDefecto: "Antes",   maxLen: 40, linea: true },
      { clave: "casos.despues", etiqueta: "Antes y después · pastilla derecha",   porDefecto: "Después", maxLen: 40, linea: true },
      { clave: "pagos.rotuloTratamiento", etiqueta: "Simulador · rótulo del tratamiento", porDefecto: "Tratamiento",     maxLen: 60, linea: true },
      { clave: "pagos.rotuloPlazo",       etiqueta: "Simulador · rótulo del plazo",       porDefecto: "Plazo",           maxLen: 60, linea: true },
      { clave: "pagos.rotuloMensual",     etiqueta: "Simulador · rótulo del pago",        porDefecto: "Tu pago mensual", maxLen: 60, linea: true },
      { clave: "casos.cta",    etiqueta: "Caso · botón",    porDefecto: "Agenda tu valoración", maxLen: 60, linea: true },

      { clave: "equipo.kickerUno",       etiqueta: "Especialista · etiqueta (uno solo)", porDefecto: "El especialista",   maxLen: 60, linea: true },
      { clave: "equipo.kickerVarios",    etiqueta: "Especialistas · etiqueta (varios)",  porDefecto: "Los especialistas", maxLen: 60, linea: true },
      { clave: "equipo.etiquetaAtiende", etiqueta: "Especialista · rótulo de cada tratamiento", porDefecto: "Atiende",    maxLen: 40, linea: true },
      { clave: "equipo.cta",             etiqueta: "Especialistas · botón de cada doctor", porDefecto: "Valoración",      maxLen: 40, linea: true },

      { clave: "pagos.kicker",     etiqueta: "Financiamiento · etiqueta", porDefecto: "Financiamiento",      maxLen: 60, linea: true },
      { clave: "opiniones.kicker", etiqueta: "Opiniones · etiqueta",      porDefecto: "Opiniones",           maxLen: 60, linea: true },
      { clave: "faq.kicker",       etiqueta: "Preguntas · etiqueta",      porDefecto: "Preguntas frecuentes", maxLen: 60, linea: true },

      { clave: "contacto.kicker",     etiqueta: "Ubicación · etiqueta",               porDefecto: "Dónde estamos",      maxLen: 60, linea: true },
      { clave: "contacto.cerrado",    etiqueta: "Ubicación · cómo se dice «cerrado»", porDefecto: "Cerrado",            maxLen: 40, linea: true },
      { clave: "contacto.cta",        etiqueta: "Ubicación · botón de reservar",      porDefecto: "Agendar valoración", maxLen: 60, linea: true },
      { clave: "contacto.comoLlegar", etiqueta: "Ubicación · botón del mapa",         porDefecto: "Cómo llegar",        maxLen: 60, linea: true },
    ],
    noEditables: [
      { donde: "Menú de navegación", porque: "Los enlaces siguen a las secciones encendidas." },
      { donde: "Pie de página, incluido «Hecho con DaleControl»", porque: "El pie es nuestro, no de la clínica." },
      { donde: "Portada · el kicker de especialidad", porque: "Es el dato de especialidad de la clínica; se cambia en Configuración." },
      { donde: "Franja · leyenda de las reseñas («{n} reseñas en Google»)", porque: "Se construye con lo que devuelve Google. Las otras tres SÍ se editan." },
      { donde: "Opiniones · titular con ficha de Google", porque: "Es una cadena construida y además va partida en dos elementos." },
      { donde: "Especialista · «Dr/a. {nombre} {apellido}», su especialidad y «Agenda con {nombre}»", porque: "Se arman con datos del equipo." },
      { donde: "«{duración} min» y la numeración de cada tratamiento", porque: "La duración es el dato de agenda y el número es la posición en la lista." },
      { donde: "El « · hoy» que se pega al día de la semana", porque: "Se construye sobre el nombre del día." },
      { donde: "El texto del mapa cuando no hay mapa configurado", porque: "Es la ciudad de la clínica, o nada." },
      { donde: "Las reseñas de Google", porque: "Son de Google. No hay dónde guardarlas si alguien las reescribe." },
    ],
  },
};

/** El manifiesto de una plantilla; si el id no existe, el de classic. */
export function manifestOf(templateId: string | null | undefined): TemplateManifest {
  return TEMPLATE_MANIFESTS[templateId ?? "classic"] ?? TEMPLATE_MANIFESTS.classic;
}

/** Ids de ranura válidos para subir foto (los usa /api/landing-upload). */
export function allPhotoSlotIds(): string[] {
  const ids = new Set<string>();
  for (const m of Object.values(TEMPLATE_MANIFESTS)) {
    for (const f of m.fotos) ids.add(f.id);
  }
  return Array.from(ids);
}

/**
 * Ids de sección que alguna plantilla declara.
 *
 * Los usa el editor visual para no dejar que el lienzo escriba en una
 * sección inventada: `landingSections` es JSON libre, y una entrada que
 * ninguna plantilla pinta se quedaría ahí para siempre sin que nadie la vea.
 * Se incluyen también las secciones que solo aportan TEXTO (la cabecera de
 * "tecnologia" en equipo, p. ej.), que no están en `secciones` pero sí en
 * `textos`.
 */
export function allSectionIds(): string[] {
  const ids = new Set<string>();
  for (const m of Object.values(TEMPLATE_MANIFESTS)) {
    for (const s of m.secciones) ids.add(s.id);
    for (const t of m.textos) ids.add(t.seccion);
  }
  return Array.from(ids);
}

/**
 * ¿Esta plantilla obedece al editor de secciones, textos y ranuras de foto?
 *
 * Fuente ÚNICA: la bandera del manifiesto. La pantalla de Configuración
 * pregunta aquí en vez de llevar su propia lista de nombres, que se
 * desincronizaría en cuanto una plantilla aprendiera a leerlo.
 */
export function plantillaLeeManifiesto(templateId: string | null | undefined): boolean {
  return manifestOf(templateId).leeManifiesto === true;
}

/** Las plantillas que SÍ obedecen al editor — para poder ofrecerlas por su nombre. */
export function plantillasQueLeenManifiesto(): TemplateManifest[] {
  return Object.values(TEMPLATE_MANIFESTS).filter(m => m.leeManifiesto);
}

/**
 * ¿Se puede abrir el editor visual con esta plantilla?
 *
 * Fuente ÚNICA, igual que `plantillaLeeManifiesto`: el botón "Editar mi
 * sitio", el lienzo y la prueba de instrumentación preguntan aquí, y ninguno
 * lleva su propia lista de nombres.
 */
export function plantillaInstrumentada(templateId: string | null | undefined): boolean {
  return manifestOf(templateId).instrumentada === true;
}

/**
 * ¿Esta plantilla pinta de verdad ese dato suelto?
 *
 * Lo pregunta el formulario para avisar de que el aviso de urgencias o los
 * meses sin intereses se guardan pero no se ven con la plantilla activa.
 */
export function plantillaPinta(templateId: string | null | undefined, que: "urgencias" | "msi"): boolean {
  return (manifestOf(templateId).pinta ?? []).includes(que);
}

/** Los ids de las plantillas instrumentadas, en el orden del manifiesto. */
export function plantillasInstrumentadas(): string[] {
  return Object.values(TEMPLATE_MANIFESTS).filter(m => m.instrumentada).map(m => m.id);
}

/* ------------------------------------------------------------------
   `landingCopy`: el texto suelto
   ------------------------------------------------------------------ */

/** Tope por defecto de un texto suelto, si el manifiesto no dice otro. */
export const COPY_MAX_LEN_POR_DEFECTO = 160;

/**
 * Tope de cada clave declarada, EN TODAS las plantillas.
 *
 * El validador del PATCH no sabe con qué plantilla se está escribiendo (la
 * clínica puede cambiarla en el mismo guardado), así que se queda con el tope
 * MÁS GRANDE de los declarados para esa clave. El tope fino lo pone el campo
 * del lienzo, que sí sabe en qué plantilla está.
 */
let TOPES: Map<string, number> | null = null;
function topes(): Map<string, number> {
  if (TOPES) return TOPES;
  const m = new Map<string, number>();
  for (const tpl of Object.values(TEMPLATE_MANIFESTS)) {
    for (const c of tpl.copia ?? []) {
      const max = c.maxLen ?? COPY_MAX_LEN_POR_DEFECTO;
      m.set(c.clave, Math.max(m.get(c.clave) ?? 0, max));
    }
  }
  TOPES = m;
  return m;
}

/** ¿Alguna plantilla declara esta clave de texto suelto? */
export function esClaveDeCopia(clave: string): boolean {
  return topes().has(clave);
}

/** Cuántos caracteres admite esa clave (el mayor de los declarados). */
export function topeDeCopia(clave: string): number {
  return topes().get(clave) ?? COPY_MAX_LEN_POR_DEFECTO;
}

/** Todas las claves declaradas por alguna plantilla. */
export function allCopyKeys(): string[] {
  return Array.from(topes().keys());
}

/** La declaración de una clave EN ESTA plantilla (para su default real). */
export function copyOfManifest(templateId: string | null | undefined, clave: string): ManifestCopy | null {
  return manifestOf(templateId).copia?.find(c => c.clave === clave) ?? null;
}
