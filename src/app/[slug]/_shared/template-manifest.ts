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

export interface TemplateManifest {
  id: string;
  nombre: string;
  /** Una línea que explica para quién es. */
  para: string;
  /** true = la plantilla NO usa fotos (consultorio). */
  sinFotos?: boolean;
  secciones: ManifestSection[];
  fotos: ManifestPhotoSlot[];
  textos: ManifestText[];
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

const TEXTOS_BASE: ManifestText[] = [
  { seccion: "servicios", campo: "titulo", etiqueta: "Título de servicios", porDefecto: "Lo que cuesta, antes de sentarte" },
  { seccion: "servicios", campo: "subtitulo", etiqueta: "Bajada de servicios", porDefecto: "Precios de lista. Tu plan puede ajustarse tras la valoración." },
  { seccion: "equipo", campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Quién te va a atender" },
  { seccion: "opiniones", campo: "titulo", etiqueta: "Título de opiniones", porDefecto: "Lo que dicen nuestros pacientes" },
  { seccion: "faq", campo: "titulo", etiqueta: "Título de preguntas", porDefecto: "Lo que todos preguntan antes de venir" },
  { seccion: "contacto", campo: "titulo", etiqueta: "Título de contacto", porDefecto: "Dónde estamos" },
];

/* ============================================================
   LOS OCHO MANIFIESTOS
   ============================================================ */

export const TEMPLATE_MANIFESTS: Record<string, TemplateManifest> = {

  classic: {
    id: "classic",
    nombre: "Clásico",
    para: "El estándar: limpio, profesional y sirve para cualquier especialidad.",
    secciones: [SEC_SERVICIOS, SEC_EQUIPO, SEC_GALERIA, SEC_OPINIONES, SEC_FAQ, SEC_CONTACTO, SEC_RESERVAR],
    fotos: [FOTO_PORTADA],
    textos: TEXTOS_BASE,
  },

  futurista: {
    id: "futurista",
    nombre: "Futurista",
    para: "Moderna, oscura, con acentos de neón. Para clínicas que venden tecnología.",
    secciones: [SEC_SERVICIOS, SEC_EQUIPO, SEC_GALERIA, SEC_OPINIONES, SEC_FAQ, SEC_CONTACTO, SEC_RESERVAR],
    fotos: [FOTO_PORTADA],
    textos: TEXTOS_BASE,
  },

  healthtech: {
    id: "healthtech",
    nombre: "Healthtech",
    para: "Clara y confiable, con aire de clínica moderna.",
    secciones: [SEC_SERVICIOS, SEC_EQUIPO, SEC_GALERIA, SEC_OPINIONES, SEC_FAQ, SEC_CONTACTO, SEC_RESERVAR],
    fotos: [FOTO_PORTADA],
    textos: TEXTOS_BASE,
  },

  calido: {
    id: "calido",
    nombre: "Cálido",
    para: "Tonos suaves y formas redondeadas. Familiar y cercana.",
    secciones: [SEC_SERVICIOS, SEC_EQUIPO, SEC_GALERIA, SEC_OPINIONES, SEC_FAQ, SEC_CONTACTO, SEC_RESERVAR],
    fotos: [FOTO_PORTADA],
    textos: TEXTOS_BASE,
  },

  equipo: {
    id: "equipo",
    nombre: "Equipo",
    para: "Varias personas atendiendo: el argumento es quién te atiende.",
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
      SEC_RESERVAR,
    ],
    fotos: [
      FOTO_PORTADA,
      ...FOTOS_CASO,
      { id: "tecnologia1", nombre: "Tecnología 1", proporcion: "16:11", seccion: "tecnologia1", zona: "derecha", ayuda: "El aparato o el consultorio del que quieres presumir." },
      { id: "tecnologia2", nombre: "Tecnología 2", proporcion: "16:11", seccion: "tecnologia2", zona: "izquierda", ayuda: "Segunda foto de equipo o instalaciones." },
    ],
    textos: [
      ...TEXTOS_BASE,
      { seccion: "casos", campo: "titulo", etiqueta: "Título de casos", porDefecto: "Arrastra y mira la diferencia" },
      { seccion: "casos", campo: "subtitulo", etiqueta: "Descripción del caso", porDefecto: "Cuenta en dos líneas qué se hizo y en cuántas citas." },
      { seccion: "tecnologia", campo: "titulo", etiqueta: "Título de tecnología", porDefecto: "Lo que hay detrás del sillón" },
      { seccion: "tecnologia1", campo: "titulo", etiqueta: "Tecnología 1 · nombre", porDefecto: "Escáner intraoral 3D" },
      { seccion: "tecnologia1", campo: "subtitulo", etiqueta: "Tecnología 1 · texto", porDefecto: "Qué es y por qué le conviene al paciente." },
      { seccion: "tecnologia2", campo: "titulo", etiqueta: "Tecnología 2 · nombre", porDefecto: "Esterilización certificada" },
      { seccion: "tecnologia2", campo: "subtitulo", etiqueta: "Tecnología 2 · texto", porDefecto: "Qué es y por qué le conviene al paciente." },
    ],
  },

  sonrisa: {
    id: "sonrisa",
    nombre: "Sonrisa",
    para: "Estética dental: la transformación manda y las fotos son enormes.",
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
    textos: [
      { seccion: "casos", campo: "titulo", etiqueta: "Título del antes y después", porDefecto: "Arrastra para ver el cambio" },
      { seccion: "casos", campo: "subtitulo", etiqueta: "Descripción del caso", porDefecto: "Tratamiento, número de citas e inversión." },
      { seccion: "servicios", campo: "titulo", etiqueta: "Título de tratamientos", porDefecto: "Lo que hacemos y lo que cuesta" },
      { seccion: "servicios", campo: "subtitulo", etiqueta: "Bajada de tratamientos", porDefecto: "" },
      { seccion: "galeria", campo: "titulo", etiqueta: "Título de la galería", porDefecto: "Así quedan nuestros pacientes" },
      { seccion: "equipo", campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Quién te atiende" },
      { seccion: "opiniones", campo: "titulo", etiqueta: "Título de opiniones", porDefecto: "Lo que dicen nuestros pacientes" },
      { seccion: "pagos", campo: "titulo", etiqueta: "Título de pagos", porDefecto: "Tu tratamiento, en mensualidades" },
      { seccion: "pagos", campo: "subtitulo", etiqueta: "Bajada de pagos", porDefecto: "Meses sin intereses con tarjetas participantes." },
      { seccion: "faq", campo: "titulo", etiqueta: "Título de preguntas", porDefecto: "Antes de agendar" },
      { seccion: "reservar", campo: "titulo", etiqueta: "Título del cierre", porDefecto: "Empieza por tu valoración" },
      { seccion: "reservar", campo: "subtitulo", etiqueta: "Bajada del cierre", porDefecto: "Agenda en línea, sin llamar. Te confirmamos por WhatsApp." },
    ],
  },

  consultorio: {
    id: "consultorio",
    nombre: "Consultorio",
    para: "Para la clínica que no tiene fotos: color, precios y horarios.",
    // NO tiene ranuras de foto y es a propósito: es su razón de existir.
    sinFotos: true,
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
    textos: [
      { seccion: "servicios", campo: "titulo", etiqueta: "Título de la lista de precios", porDefecto: "Lo que cuesta cada cosa" },
      { seccion: "servicios", campo: "subtitulo", etiqueta: "Nota bajo los precios", porDefecto: "Precios vigentes. Si tu caso necesita algo distinto te lo decimos antes de empezar." },
      { seccion: "contacto", campo: "titulo", etiqueta: "Título de horarios", porDefecto: "Cuándo y dónde" },
      { seccion: "equipo", campo: "titulo", etiqueta: "Título de dentistas", porDefecto: "Quién te atiende" },
      { seccion: "opiniones", campo: "titulo", etiqueta: "Título de opiniones", porDefecto: "Lo que dicen nuestros pacientes" },
      { seccion: "faq", campo: "titulo", etiqueta: "Título de preguntas", porDefecto: "Lo que más nos preguntan" },
      { seccion: "reservar", campo: "titulo", etiqueta: "Título del cierre", porDefecto: "Agenda en dos minutos, sin llamar" },
      { seccion: "reservar", campo: "subtitulo", etiqueta: "Bajada del cierre", porDefecto: "Eliges día y hora y te confirmamos por WhatsApp." },
    ],
  },

  especialistas: {
    id: "especialistas",
    nombre: "Especialistas",
    para: "Alta especialidad y ticket alto: tecnología, credenciales y financiamiento.",
    secciones: [
      SEC_SERVICIOS,
      { id: "tecnologia", nombre: "Tecnología (3 tarjetas)", consume: ["fotos"] },
      { id: "casos", nombre: "Caso documentado", consume: ["fotos"] },
      SEC_EQUIPO,
      { id: "pagos", nombre: "Financiamiento", consume: ["msi", "servicios"] },
      SEC_OPINIONES,
      SEC_FAQ,
      SEC_CONTACTO,
      SEC_RESERVAR,
    ],
    fotos: [
      FOTO_PORTADA,
      ...FOTOS_CASO,
      { id: "tecnologia1", nombre: "Tecnología 1", proporcion: "16:11", seccion: "tecnologia", zona: "izquierda" },
      { id: "tecnologia2", nombre: "Tecnología 2", proporcion: "16:11", seccion: "tecnologia", zona: "completa" },
      { id: "tecnologia3", nombre: "Tecnología 3", proporcion: "16:11", seccion: "tecnologia", zona: "derecha" },
      { id: "doctor", nombre: "Foto del especialista", proporcion: "4:5 vertical", seccion: "equipo", zona: "izquierda", ayuda: "Retrato vertical. Si no la subes se usa la del perfil del doctor." },
    ],
    textos: [
      { seccion: "servicios", campo: "titulo", etiqueta: "Título de tratamientos", porDefecto: "Alta especialidad, precio cerrado" },
      { seccion: "servicios", campo: "subtitulo", etiqueta: "Bajada de tratamientos", porDefecto: "Qué incluye cada precio." },
      { seccion: "tecnologia", campo: "titulo", etiqueta: "Título de tecnología", porDefecto: "Nada se improvisa en el sillón" },
      { seccion: "tecnologia1", campo: "titulo", etiqueta: "Tecnología 1 · nombre", porDefecto: "Tomografía 3D" },
      { seccion: "tecnologia1", campo: "subtitulo", etiqueta: "Tecnología 1 · texto", porDefecto: "Qué es y por qué le conviene al paciente." },
      { seccion: "tecnologia2", campo: "titulo", etiqueta: "Tecnología 2 · nombre", porDefecto: "Escáner intraoral" },
      { seccion: "tecnologia2", campo: "subtitulo", etiqueta: "Tecnología 2 · texto", porDefecto: "Qué es y por qué le conviene al paciente." },
      { seccion: "tecnologia3", campo: "titulo", etiqueta: "Tecnología 3 · nombre", porDefecto: "Guía quirúrgica" },
      { seccion: "tecnologia3", campo: "subtitulo", etiqueta: "Tecnología 3 · texto", porDefecto: "Qué es y por qué le conviene al paciente." },
      { seccion: "casos", campo: "titulo", etiqueta: "Título del caso", porDefecto: "Antes y después" },
      { seccion: "casos", campo: "subtitulo", etiqueta: "Descripción del caso", porDefecto: "Situación de partida, qué se hizo y en cuánto tiempo." },
      { seccion: "equipo", campo: "titulo", etiqueta: "Título del especialista", porDefecto: "Quién te va a operar" },
      { seccion: "pagos", campo: "titulo", etiqueta: "Título de financiamiento", porDefecto: "Tu tratamiento cabe en tu mes" },
      { seccion: "pagos", campo: "subtitulo", etiqueta: "Bajada de financiamiento", porDefecto: "Meses sin intereses con tarjetas participantes." },
      { seccion: "opiniones", campo: "titulo", etiqueta: "Título de opiniones", porDefecto: "Lo que dicen nuestros pacientes" },
      { seccion: "faq", campo: "titulo", etiqueta: "Título de preguntas", porDefecto: "Antes de decidir" },
      { seccion: "contacto", campo: "titulo", etiqueta: "Título de contacto", porDefecto: "Dónde estamos" },
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
