/* ═══════════════════════════════════════════════════════════════════════
   EL MANIFIESTO DE LAS OCHO PLANTILLAS.

   Cada plantilla declara aquí QUÉ tiene: sus secciones, en qué orden, qué
   texto se puede reescribir en cada una y qué fotos admite. El editor de
   /barber/mi-web se dibuja LEYENDO esto y no conoce ninguna plantilla por
   su nombre.

   ── AGREGAR LA NOVENA PLANTILLA ───────────────────────────────────
   1. Añade su id a BARBER_WEB_TEMPLATE_IDS (src/lib/barber/landing.ts).
   2. Escribe su manifiesto aquí abajo.
   3. Escribe su componente en ./t-<id>.tsx.
   4. Regístralo en ./index.tsx (una línea en BARBER_WEB_TEMPLATES).
   5. Escribe su piel en ./skins.css bajo `.dcbw-<id>`.
   El editor NO se toca. Tampoco la API, ni el guardado, ni la página
   pública. La prueba de que sobra: este archivo no importa ni un solo
   componente.

   ── REGLAS DE LAS CLAVES ──────────────────────────────────────────
   · La clave de copia es SEMÁNTICA y se COMPARTE entre plantillas
     ("portada.cta"). Por eso quien reescribió su botón no lo pierde al
     cambiar de plantilla.
   · `porDefecto` es el literal REAL de ESTA plantilla. Es lo que la
     barbería ve en gris como "esto sale si lo dejas vacío": si no es el
     literal real, el editor miente. Por eso la misma clave trae defaults
     distintos en cada plantilla y NO se reusan los de otra.
   · El default NUNCA se guarda: vaciar el campo borra la clave y vuelve
     a salir el literal de la plantilla.

   Sin "use client": lo leen el editor (navegador) y la página pública
   (servidor). Los tipos vienen de @/lib/barber/landing con `import type`,
   así que en tiempo de ejecución el grafo es landing → manifest y no hay
   ciclo.
   ═══════════════════════════════════════════════════════════════════════ */

import type {
  BarberWebManifest,
  BarberWebManifestCopia,
  BarberWebManifestSeccion,
  BarberWebTemplateId,
} from "@/lib/barber/landing";

/* ── Ranuras de foto (vocabulario compartido) ────────────────────── */

const FOTO_LOGO = {
  id: "logo",
  nombre: "Logo",
  proporcion: "cuadrada",
  ayuda: "Con fondo transparente se ve mejor. Si no subes ninguno, usamos el logo de tu barbería.",
};

const FOTO_PORTADA = {
  id: "portada",
  nombre: "Foto de portada",
  proporcion: "16:9 apaisada",
  ayuda: "La foto grande de arriba. Se recorta a lo ancho: no dejes caras pegadas al borde.",
};

const FOTO_AMBIENTE = {
  id: "ambiente",
  nombre: "Foto del local",
  proporcion: "4:3",
  ayuda: "El interior de la barbería: sillones, espejos, la barra.",
};

const FOTO_EQUIPO = {
  id: "equipoFoto",
  nombre: "Foto de todo el equipo",
  proporcion: "3:2 apaisada",
  ayuda: "Todos juntos. Sale detrás del bloque de barberos.",
};

/* ── Copia que casi todas comparten ──────────────────────────────── */

function copiaPortada(cta: string, eslogan: string, whats = "WhatsApp"): BarberWebManifestCopia[] {
  return [
    { clave: "portada.eslogan", etiqueta: "Portada · frase", porDefecto: eslogan, maxLen: 120 },
    { clave: "portada.cta", etiqueta: "Portada · botón de reservar", porDefecto: cta, maxLen: 40 },
    { clave: "portada.whatsapp", etiqueta: "Portada · botón de WhatsApp", porDefecto: whats, maxLen: 40 },
  ];
}

const COPIA_CONTACTO: BarberWebManifestCopia[] = [
  { clave: "contacto.etiquetaDireccion", etiqueta: "Contacto · rótulo de la dirección", porDefecto: "Dónde estamos", maxLen: 40 },
  { clave: "contacto.etiquetaHorario", etiqueta: "Contacto · rótulo del horario", porDefecto: "Horario", maxLen: 40 },
  { clave: "contacto.etiquetaTelefono", etiqueta: "Contacto · rótulo del teléfono", porDefecto: "Teléfono", maxLen: 40 },
  { clave: "contacto.comoLlegar", etiqueta: "Contacto · botón del mapa", porDefecto: "Cómo llegar", maxLen: 40 },
  { clave: "contacto.whatsapp", etiqueta: "Contacto · botón de WhatsApp", porDefecto: "Escríbenos por WhatsApp", maxLen: 60 },
];

const COPIA_EQUIPO_CTA: BarberWebManifestCopia = {
  clave: "equipo.cta",
  etiqueta: "Equipo · botón de cada barbero",
  porDefecto: "Reservar",
  maxLen: 40,
};

/* ── Secciones armadas (cada plantilla ajusta títulos y copia) ────── */

function secContacto(extra?: Partial<BarberWebManifestSeccion>): BarberWebManifestSeccion {
  return {
    id: "contacto",
    nombre: "Dónde estamos, horario y contacto",
    obligatoria: true,
    consume: [],
    textos: [
      { campo: "titulo", etiqueta: "Título de contacto", porDefecto: "Visítanos" },
      { campo: "subtitulo", etiqueta: "Bajada de contacto", porDefecto: "Te esperamos." },
    ],
    copia: COPIA_CONTACTO,
    ...extra,
  };
}

/* ═══════════════════════════════════════════════════════════════════
   LOS OCHO MANIFIESTOS
   ═══════════════════════════════════════════════════════════════════ */

export const BARBER_WEB_MANIFESTS: Record<BarberWebTemplateId, BarberWebManifest> = {
  /* ────────────────────────────────────────────────────────────────
     1 · CLÁSICA — barbería de toda la vida.
     Estructura: portada partida (texto a la izquierda, foto con poste a
     la derecha), servicios como carta con puntitos, equipo en fila de
     retratos redondos, portafolio en tres columnas, cierre con reserva.
     ──────────────────────────────────────────────────────────────── */
  clasica: {
    id: "clasica",
    nombre: "Clásica",
    para: "La barbería de toda la vida: negro, caramelo y letra fuerte.",
    estructura: "Portada partida en dos · carta de precios con puntitos · equipo en fila",
    acentoSugerido: "caramelo",
    secciones: [
      {
        id: "portada",
        nombre: "Portada",
        obligatoria: true,
        consume: [],
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        copia: copiaPortada("Reservar cita", "Corte, barba y navaja desde siempre."),
      },
      {
        id: "servicios",
        nombre: "Servicios y precios",
        consume: ["servicios"],
        textos: [
          { campo: "titulo", etiqueta: "Título de servicios", porDefecto: "La carta" },
          { campo: "subtitulo", etiqueta: "Bajada de servicios", porDefecto: "Precios claros. Sin sorpresas al pagar." },
        ],
        copia: [
          { clave: "servicios.kicker", etiqueta: "Servicios · etiqueta", porDefecto: "Servicios", maxLen: 40 },
          { clave: "servicios.cta", etiqueta: "Servicios · botón de cada corte", porDefecto: "Reservar", maxLen: 40 },
        ],
      },
      {
        id: "equipo",
        nombre: "Barberos",
        consume: ["barberos"],
        fotos: [FOTO_EQUIPO],
        textos: [
          { campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Quién te atiende" },
          { campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "Elige con quién te sientas." },
        ],
        copia: [
          { clave: "equipo.kicker", etiqueta: "Equipo · etiqueta", porDefecto: "El equipo", maxLen: 40 },
          COPIA_EQUIPO_CTA,
        ],
      },
      {
        id: "portafolio",
        nombre: "Portafolio de cortes",
        consume: ["galeria"],
        textos: [
          { campo: "titulo", etiqueta: "Título del portafolio", porDefecto: "Nuestro trabajo" },
        ],
        copia: [{ clave: "portafolio.kicker", etiqueta: "Portafolio · etiqueta", porDefecto: "Galería", maxLen: 40 }],
      },
      {
        id: "resenas",
        nombre: "Reseñas de clientes",
        consume: ["resenas"],
        textos: [{ campo: "titulo", etiqueta: "Título de reseñas", porDefecto: "Lo que dicen" }],
        copia: [{ clave: "resenas.kicker", etiqueta: "Reseñas · etiqueta", porDefecto: "Clientes", maxLen: 40 }],
      },
      secContacto({ fotos: [FOTO_AMBIENTE] }),
      {
        id: "reservar",
        nombre: "Cierre con reserva",
        consume: [],
        textos: [
          { campo: "titulo", etiqueta: "Título del cierre", porDefecto: "Tu silla te espera" },
          { campo: "subtitulo", etiqueta: "Bajada del cierre", porDefecto: "Aparta tu lugar en menos de un minuto." },
        ],
        copia: [{ clave: "reservar.cta", etiqueta: "Cierre · botón", porDefecto: "Reservar mi cita", maxLen: 40 }],
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     2 · EQUIPO — los barberos mandan.
     Estructura: portada mínima de una franja y, DE INMEDIATO, retratos
     verticales grandes con la liga de reserva de cada uno. Los servicios
     bajan a fichas compactas. Es la única con el equipo arriba de todo.
     ──────────────────────────────────────────────────────────────── */
  equipo: {
    id: "equipo",
    nombre: "Equipo",
    para: "Cuando la gente viene por un barbero concreto, no por la barbería.",
    estructura: "Retratos verticales grandes ARRIBA de todo · una liga de reserva por barbero",
    acentoSugerido: "cobre",
    secciones: [
      {
        id: "portada",
        nombre: "Portada",
        obligatoria: true,
        consume: [],
        fotos: [FOTO_LOGO],
        copia: copiaPortada("Reservar", "Elige a tu barbero."),
      },
      {
        id: "equipo",
        nombre: "Barberos",
        consume: ["barberos"],
        textos: [
          { campo: "titulo", etiqueta: "Título del equipo", porDefecto: "El equipo" },
          { campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "Cada quien con su estilo. Reserva directo con el tuyo." },
        ],
        copia: [
          { clave: "equipo.kicker", etiqueta: "Equipo · etiqueta", porDefecto: "Quién te atiende", maxLen: 40 },
          { ...COPIA_EQUIPO_CTA, porDefecto: "Reservar con él" },
        ],
      },
      {
        id: "servicios",
        nombre: "Servicios y precios",
        consume: ["servicios"],
        textos: [
          { campo: "titulo", etiqueta: "Título de servicios", porDefecto: "Lo que hacemos" },
          { campo: "subtitulo", etiqueta: "Bajada de servicios", porDefecto: "Mismo precio con cualquiera del equipo." },
        ],
        copia: [{ clave: "servicios.cta", etiqueta: "Servicios · botón de cada corte", porDefecto: "Reservar", maxLen: 40 }],
      },
      {
        id: "portafolio",
        nombre: "Portafolio de cortes",
        consume: ["galeria"],
        textos: [{ campo: "titulo", etiqueta: "Título del portafolio", porDefecto: "Su trabajo" }],
      },
      {
        id: "resenas",
        nombre: "Reseñas de clientes",
        consume: ["resenas"],
        textos: [{ campo: "titulo", etiqueta: "Título de reseñas", porDefecto: "Clientes de siempre" }],
      },
      secContacto({
        textos: [
          { campo: "titulo", etiqueta: "Título de contacto", porDefecto: "Pásate" },
          { campo: "subtitulo", etiqueta: "Bajada de contacto", porDefecto: "Aquí nos encuentras." },
        ],
      }),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     3 · PORTAFOLIO — la galería es la portada.
     Estructura: mosaico a sangre ocupando la primera pantalla con el
     nombre encima, barra de reserva pegada abajo en el móvil y los
     precios reducidos a una tira. Para quien vive de Instagram.
     ──────────────────────────────────────────────────────────────── */
  portafolio: {
    id: "portafolio",
    nombre: "Portafolio",
    para: "Para quien vende con fotos: el trabajo entra por los ojos antes que nada.",
    estructura: "Mosaico de cortes A SANGRE como portada · barra de reserva fija · precios en una tira",
    acentoSugerido: "acero",
    oscura: true,
    secciones: [
      {
        id: "portada",
        nombre: "Portada (el mosaico)",
        obligatoria: true,
        consume: [],
        fotos: [FOTO_LOGO],
        copia: copiaPortada("Reservar", "Cada corte, una firma."),
      },
      {
        id: "portafolio",
        nombre: "Portafolio de cortes",
        consume: ["galeria"],
        textos: [
          { campo: "titulo", etiqueta: "Título del portafolio", porDefecto: "El trabajo" },
          { campo: "subtitulo", etiqueta: "Bajada del portafolio", porDefecto: "Fades, diseños y barbas. Todo hecho aquí." },
        ],
      },
      {
        id: "servicios",
        nombre: "Servicios y precios",
        consume: ["servicios"],
        textos: [{ campo: "titulo", etiqueta: "Título de servicios", porDefecto: "Precios" }],
        copia: [{ clave: "servicios.cta", etiqueta: "Servicios · botón de cada corte", porDefecto: "Reservar", maxLen: 40 }],
      },
      {
        id: "equipo",
        nombre: "Barberos",
        consume: ["barberos"],
        textos: [{ campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Quién lo hace" }],
        copia: [COPIA_EQUIPO_CTA],
      },
      {
        id: "resenas",
        nombre: "Reseñas de clientes",
        consume: ["resenas"],
        textos: [{ campo: "titulo", etiqueta: "Título de reseñas", porDefecto: "Reseñas" }],
      },
      secContacto({
        textos: [
          { campo: "titulo", etiqueta: "Título de contacto", porDefecto: "Dónde" },
          { campo: "subtitulo", etiqueta: "Bajada de contacto", porDefecto: "" },
        ],
      }),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     4 · MINIMAL — una sola pantalla.
     Estructura: TODO centrado en un viewport: logo, nombre, dirección,
     horario agrupado, teléfono y UN botón enorme. Sin galería, sin
     equipo. Es la única sin scroll obligatorio; para el barbero solo.
     ──────────────────────────────────────────────────────────────── */
  minimal: {
    id: "minimal",
    nombre: "Minimal",
    para: "Una sola pantalla: nombre, dirección, horario y un botón. Para el barbero solo.",
    estructura: "UNA pantalla centrada, sin scroll · sin galería ni equipo · un botón enorme",
    acentoSugerido: "caramelo",
    secciones: [
      {
        id: "portada",
        nombre: "La pantalla",
        obligatoria: true,
        consume: [],
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        copia: [
          ...copiaPortada("Reservar cita", "Corte y barba, con cita."),
          { clave: "portada.nota", etiqueta: "Portada · nota de abajo", porDefecto: "Solo con cita", maxLen: 60 },
        ],
      },
      secContacto({
        nombre: "Dirección, horario y contacto",
        textos: [
          { campo: "titulo", etiqueta: "Título de contacto", porDefecto: "" },
          { campo: "subtitulo", etiqueta: "Bajada de contacto", porDefecto: "" },
        ],
      }),
      {
        id: "servicios",
        nombre: "Lista de precios (debajo del botón)",
        consume: ["servicios"],
        textos: [{ campo: "titulo", etiqueta: "Título de servicios", porDefecto: "Precios" }],
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     5 · PREMIUM — barbería de lujo.
     Estructura: negro casi total, muchísimo aire, tipografía fina con
     serifa, portada a sangre y servicios en lista editorial con
     numeración grande. Densidad BAJA a propósito.
     ──────────────────────────────────────────────────────────────── */
  premium: {
    id: "premium",
    nombre: "Premium",
    para: "Barbería de lujo: negro, mucho aire, fotografía grande y letra fina.",
    estructura: "Negro editorial · portada a sangre · servicios numerados con líneas de pelo · densidad baja",
    acentoSugerido: "whisky",
    oscura: true,
    secciones: [
      {
        id: "portada",
        nombre: "Portada",
        obligatoria: true,
        consume: [],
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        copia: copiaPortada("Reservar", "El oficio, sin prisa.", "Escríbenos"),
      },
      {
        id: "servicios",
        nombre: "Servicios y precios",
        consume: ["servicios"],
        textos: [
          { campo: "titulo", etiqueta: "Título de servicios", porDefecto: "Servicios" },
          { campo: "subtitulo", etiqueta: "Bajada de servicios", porDefecto: "Cada cita, el tiempo que necesita." },
        ],
        copia: [{ clave: "servicios.kicker", etiqueta: "Servicios · etiqueta", porDefecto: "La carta", maxLen: 40 }],
      },
      {
        id: "portafolio",
        nombre: "Portafolio de cortes",
        consume: ["galeria"],
        textos: [
          { campo: "titulo", etiqueta: "Título del portafolio", porDefecto: "Trabajos" },
          { campo: "subtitulo", etiqueta: "Bajada del portafolio", porDefecto: "" },
        ],
      },
      {
        id: "equipo",
        nombre: "Barberos",
        consume: ["barberos"],
        fotos: [FOTO_EQUIPO],
        textos: [
          { campo: "titulo", etiqueta: "Título del equipo", porDefecto: "El equipo" },
          { campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "" },
        ],
        copia: [COPIA_EQUIPO_CTA],
      },
      {
        id: "resenas",
        nombre: "Reseñas de clientes",
        consume: ["resenas"],
        textos: [{ campo: "titulo", etiqueta: "Título de reseñas", porDefecto: "" }],
      },
      secContacto({
        fotos: [FOTO_AMBIENTE],
        textos: [
          { campo: "titulo", etiqueta: "Título de contacto", porDefecto: "La casa" },
          { campo: "subtitulo", etiqueta: "Bajada de contacto", porDefecto: "" },
        ],
      }),
      {
        id: "reservar",
        nombre: "Cierre con reserva",
        consume: [],
        textos: [
          { campo: "titulo", etiqueta: "Título del cierre", porDefecto: "Reserva tu lugar" },
          { campo: "subtitulo", etiqueta: "Bajada del cierre", porDefecto: "Atendemos con cita para no hacerte esperar." },
        ],
        copia: [{ clave: "reservar.cta", etiqueta: "Cierre · botón", porDefecto: "Reservar", maxLen: 40 }],
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     6 · URBANA — street / fade.
     Estructura: bloques de alto contraste sin aire, tipografía
     condensada en mayúsculas, cinta corredera con los servicios,
     rejilla densa de fotos. Densidad ALTA, lo contrario de premium.
     ──────────────────────────────────────────────────────────────── */
  urbana: {
    id: "urbana",
    nombre: "Urbana",
    para: "Street y fades: alto contraste, bloques y letra condensada.",
    estructura: "Bloques a tope sin aire · cinta corredera de servicios · rejilla densa de fotos · densidad alta",
    acentoSugerido: "vino",
    oscura: true,
    secciones: [
      {
        id: "portada",
        nombre: "Portada",
        obligatoria: true,
        consume: [],
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        copia: [
          ...copiaPortada("RESERVAR", "FADES · DISEÑOS · BARBA", "WHATSAPP"),
          { clave: "portada.cinta", etiqueta: "Portada · texto de la cinta", porDefecto: "SIN FILA · CON CITA", maxLen: 60 },
        ],
      },
      {
        id: "servicios",
        nombre: "Servicios y precios",
        consume: ["servicios"],
        textos: [
          { campo: "titulo", etiqueta: "Título de servicios", porDefecto: "PRECIOS" },
          { campo: "subtitulo", etiqueta: "Bajada de servicios", porDefecto: "Lo que ves es lo que pagas." },
        ],
        copia: [{ clave: "servicios.cta", etiqueta: "Servicios · botón de cada corte", porDefecto: "RESERVAR", maxLen: 40 }],
      },
      {
        id: "portafolio",
        nombre: "Portafolio de cortes",
        consume: ["galeria"],
        textos: [{ campo: "titulo", etiqueta: "Título del portafolio", porDefecto: "EL TRABAJO" }],
      },
      {
        id: "equipo",
        nombre: "Barberos",
        consume: ["barberos"],
        textos: [{ campo: "titulo", etiqueta: "Título del equipo", porDefecto: "LA BANDA" }],
        copia: [{ ...COPIA_EQUIPO_CTA, porDefecto: "RESERVAR" }],
      },
      {
        id: "resenas",
        nombre: "Reseñas de clientes",
        consume: ["resenas"],
        textos: [{ campo: "titulo", etiqueta: "Título de reseñas", porDefecto: "LO QUE DICEN" }],
      },
      {
        id: "reservar",
        nombre: "Cierre con reserva",
        consume: [],
        textos: [
          { campo: "titulo", etiqueta: "Título del cierre", porDefecto: "AGARRA TU LUGAR" },
          { campo: "subtitulo", etiqueta: "Bajada del cierre", porDefecto: "" },
        ],
        copia: [{ clave: "reservar.cta", etiqueta: "Cierre · botón", porDefecto: "RESERVAR AHORA", maxLen: 40 }],
      },
      secContacto({
        textos: [
          { campo: "titulo", etiqueta: "Título de contacto", porDefecto: "DÓNDE" },
          { campo: "subtitulo", etiqueta: "Bajada de contacto", porDefecto: "" },
        ],
      }),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     7 · VINTAGE — americana de los 50.
     Estructura: crema con textura, marcos dobles con ornamento, sello
     "EST.", carta de servicios con filete y retratos en óvalo. Es la
     única con ornamentos y la única que usa el año de fundación.
     ──────────────────────────────────────────────────────────────── */
  vintage: {
    id: "vintage",
    nombre: "Vintage",
    para: "Americana clásica de los 50: crema, ornamentos, insignias y serifa.",
    estructura: "Crema con textura · marcos dobles y sello EST. · retratos en óvalo · carta con filete",
    acentoSugerido: "tabaco",
    secciones: [
      {
        id: "portada",
        nombre: "Portada",
        obligatoria: true,
        consume: [],
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        copia: [
          ...copiaPortada("Reservar cita", "Corte, afeitado y toalla caliente."),
          { clave: "portada.sello", etiqueta: "Portada · sello (año o lema)", porDefecto: "EST.", maxLen: 24 },
          { clave: "portada.lema", etiqueta: "Portada · lema del sello", porDefecto: "Barbería tradicional", maxLen: 60 },
        ],
      },
      {
        id: "servicios",
        nombre: "Servicios y precios",
        consume: ["servicios"],
        textos: [
          { campo: "titulo", etiqueta: "Título de servicios", porDefecto: "Nuestra carta" },
          { campo: "subtitulo", etiqueta: "Bajada de servicios", porDefecto: "El oficio de siempre, al precio de siempre." },
        ],
        copia: [{ clave: "servicios.cta", etiqueta: "Servicios · botón de cada corte", porDefecto: "Reservar", maxLen: 40 }],
      },
      {
        id: "equipo",
        nombre: "Barberos",
        consume: ["barberos"],
        fotos: [FOTO_EQUIPO],
        textos: [
          { campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Los maestros" },
          { campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "Manos con oficio." },
        ],
        copia: [COPIA_EQUIPO_CTA],
      },
      /* El libro de visitas va ANTES del álbum, y ese orden es lo que
         separa a `vintage` de `clasica`: en una barbería de 1955 el libro
         estaba en el mostrador y el álbum de fotos, al fondo. */
      {
        id: "resenas",
        nombre: "Reseñas de clientes",
        consume: ["resenas"],
        textos: [{ campo: "titulo", etiqueta: "Título de reseñas", porDefecto: "Del libro de visitas" }],
      },
      {
        id: "portafolio",
        nombre: "Portafolio de cortes",
        consume: ["galeria"],
        textos: [{ campo: "titulo", etiqueta: "Título del portafolio", porDefecto: "Del álbum" }],
      },
      secContacto({
        fotos: [FOTO_AMBIENTE],
        textos: [
          { campo: "titulo", etiqueta: "Título de contacto", porDefecto: "La barbería" },
          { campo: "subtitulo", etiqueta: "Bajada de contacto", porDefecto: "Pásate cuando quieras." },
        ],
      }),
      {
        id: "reservar",
        nombre: "Cierre con reserva",
        consume: [],
        textos: [
          { campo: "titulo", etiqueta: "Título del cierre", porDefecto: "Aparta tu silla" },
          { campo: "subtitulo", etiqueta: "Bajada del cierre", porDefecto: "" },
        ],
        copia: [{ clave: "reservar.cta", etiqueta: "Cierre · botón", porDefecto: "Reservar", maxLen: 40 }],
      },
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     8 · PRECIOS — el menú manda.
     Estructura: la tabla de precios ARRIBA de todo, agrupada por
     categoría, con números enormes. La portada se reduce a una franja.
     Para la barbería que compite por precio.
     ──────────────────────────────────────────────────────────────── */
  precios: {
    id: "precios",
    nombre: "Precios",
    para: "Para la barbería que compite por precio: la tabla arriba y bien grande.",
    estructura: "Tabla de precios ARRIBA de todo, agrupada por categoría, con números enormes",
    acentoSugerido: "caramelo",
    secciones: [
      {
        id: "portada",
        nombre: "Franja de portada",
        obligatoria: true,
        consume: [],
        fotos: [FOTO_LOGO],
        copia: copiaPortada("Reservar", "Precios de barrio, trabajo de estudio."),
      },
      {
        id: "servicios",
        nombre: "Tabla de precios",
        consume: ["servicios"],
        textos: [
          { campo: "titulo", etiqueta: "Título de la tabla", porDefecto: "Lista de precios" },
          { campo: "subtitulo", etiqueta: "Bajada de la tabla", porDefecto: "Sin letras chiquitas." },
        ],
        copia: [
          { clave: "servicios.columnaServicio", etiqueta: "Tabla · encabezado del servicio", porDefecto: "Servicio", maxLen: 30 },
          { clave: "servicios.columnaDuracion", etiqueta: "Tabla · encabezado de duración", porDefecto: "Dura", maxLen: 30 },
          { clave: "servicios.columnaPrecio", etiqueta: "Tabla · encabezado del precio", porDefecto: "Precio", maxLen: 30 },
          { clave: "servicios.cta", etiqueta: "Tabla · botón de cada renglón", porDefecto: "Reservar", maxLen: 40 },
        ],
      },
      /* Las opiniones suben JUSTO debajo de la tabla, y ahí está la
         diferencia con `clasica`: quien compite por precio necesita que
         la prueba social llegue antes de que el visitante piense "tan
         barato, algo tendrá". El equipo y las fotos son contexto. */
      {
        id: "resenas",
        nombre: "Reseñas de clientes",
        consume: ["resenas"],
        textos: [{ campo: "titulo", etiqueta: "Título de reseñas", porDefecto: "Opiniones" }],
      },
      {
        id: "equipo",
        nombre: "Barberos",
        consume: ["barberos"],
        textos: [
          { campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Quién te atiende" },
          { campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "Mismo precio con cualquiera." },
        ],
        copia: [COPIA_EQUIPO_CTA],
      },
      {
        id: "portafolio",
        nombre: "Portafolio de cortes",
        consume: ["galeria"],
        textos: [{ campo: "titulo", etiqueta: "Título del portafolio", porDefecto: "Así quedan" }],
      },
      secContacto({ fotos: [FOTO_AMBIENTE] }),
    ],
  },
};

/** La lista para el selector del editor, en el orden en que se presentan. */
export const BARBER_WEB_MANIFEST_LIST: BarberWebManifest[] = [
  BARBER_WEB_MANIFESTS.clasica,
  BARBER_WEB_MANIFESTS.equipo,
  BARBER_WEB_MANIFESTS.portafolio,
  BARBER_WEB_MANIFESTS.minimal,
  BARBER_WEB_MANIFESTS.premium,
  BARBER_WEB_MANIFESTS.urbana,
  BARBER_WEB_MANIFESTS.vintage,
  BARBER_WEB_MANIFESTS.precios,
];

/** El manifiesto de una plantilla, cayendo a la clásica si el id no existe. */
export function manifiestoBarberWeb(id: string | null | undefined): BarberWebManifest {
  return BARBER_WEB_MANIFESTS[(id ?? "") as BarberWebTemplateId] ?? BARBER_WEB_MANIFESTS.clasica;
}
