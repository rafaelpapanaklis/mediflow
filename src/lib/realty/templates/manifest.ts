/* ═══════════════════════════════════════════════════════════════════════
   EL MANIFIESTO DE LAS QUINCE PLANTILLAS — cinco por MODO de cuenta:
   tres de la ola 1 y dos PREMIUM de la segunda ola.

   Cada plantilla declara aquí QUÉ tiene: sus bloques, en qué orden, con qué
   maquetado, qué texto se puede reescribir en cada uno y qué fotos admite.
   El editor de /inmobiliaria/mi-web se dibuja LEYENDO esto y no conoce
   ninguna plantilla por su nombre. La prueba de que sobra: este archivo no
   importa ni un solo componente.

   ── LA DIMENSIÓN QUE NO EXISTE EN BARBER NI EN EL DENTAL: EL MODO ──
   Aquí la plantilla no cambia el estilo: cambia el SUJETO de la página.
     · AGENT  → habla LA PERSONA. Los inmuebles son la prueba de su trabajo.
     · AGENCY → habla LA EMPRESA. Los inmuebles son el catálogo.
     · OWNER  → habla EL INMUEBLE. El dueño no quiere ser famoso: quiere
                rentar, y su gancho es "trato directo, sin comisión".
   Por eso el editor solo ofrece las CINCO plantillas del modo de la cuenta y
   los bloques cuyo `modos` lo incluye. Una web AGENT con bloque "sucursales"
   sería una empresa fingida; una web OWNER con "sobre mí" es un rentista
   pidiendo protagonismo que nadie le pidió.

   ── DÓNDE VIVE CADA COSA ──────────────────────────────────────────
   · REALTY_WEB_BLOQUES  → el bloque, declarado UNA vez: nombre, modos, qué
     datos consume y qué PINTA. `pinta` va aquí y no en cada plantilla
     porque el JSX del bloque es UNO solo
     (src/components/realty/web/blocks/<id>.tsx) y es contra ESE archivo
     contra el que la prueba compara, con igualdad estricta en las dos
     direcciones.
   · REALTY_WEB_MANIFESTS → cada plantilla: qué bloques usa, en qué orden,
     con qué `variante` de maquetado y con qué textos por defecto.

   ── REGLAS DE LAS CLAVES ──────────────────────────────────────────
   · La clave de copia es SEMÁNTICA y se COMPARTE entre plantillas
     ("portada.cta"). Por eso quien reescribió su botón no lo pierde al
     cambiar de plantilla.
   · `porDefecto` es el literal REAL de ESTA plantilla. Es lo que la cuenta
     ve en gris como "esto sale si lo dejas vacío": si no es el literal
     real, el editor miente. Por eso la misma clave trae defaults distintos
     en cada plantilla y NO se reusan los de otra.
   · El default NUNCA se guarda: vaciar el campo borra la clave y vuelve a
     salir el literal de la plantilla.

   ── AGREGAR LA DECIMOSEXTA PLANTILLA ──────────────────────────────
   1. Añade su id a REALTY_WEB_TEMPLATE_IDS y su modo a
      REALTY_WEB_TEMPLATE_MODE (src/lib/realty/landing.ts).
   2. Escribe su manifiesto aquí abajo. Su FIRMA (el orden de bloques)
      tiene que ser distinta de las quince: una prueba lo exige.
   3. Escribe su piel en src/components/realty/web/skin.css bajo
      `.dcrw-p-<id>`. Si necesita un maquetado que no existe, la variante
      va en el bloque (blocks/<id>.tsx) con su CSS al lado; otra prueba
      exige que cada `variante` que pide un manifiesto exista de verdad.
   El editor NO se toca. Tampoco la API, ni el guardado, ni la página
   pública.

   Sin "use client": lo leen el editor (navegador) y la página pública
   (servidor). Los tipos vienen de @/lib/realty/landing con `import type`,
   así que en runtime el grafo es landing → manifest y no hay ciclo.
   ═══════════════════════════════════════════════════════════════════════ */

import type {
  RealtyWebBloqueDef,
  RealtyWebBloqueId,
  RealtyWebManifest,
  RealtyWebManifestBloque,
  RealtyWebManifestCopia,
  RealtyWebManifestFoto,
  RealtyWebTemplateId,
} from "@/lib/realty/landing";

/* ═══════════════════════════════════════════════════════════════════
   1 · EL CATÁLOGO DE BLOQUES

   `pinta` se verifica contra el JSX en
   src/lib/realty/templates/__tests__/manifiesto.test.ts. Las marcas que
   busca son EXPRESIONES DE CÓDIGO reales (`datos.credenciales`,
   `EmbedRecorrido`), no palabras sueltas, y la prueba borra los
   comentarios antes de buscar: así una mención en la prosa no la engaña.
   ═══════════════════════════════════════════════════════════════════ */

export const REALTY_WEB_BLOQUES: Record<RealtyWebBloqueId, RealtyWebBloqueDef> = {
  /* ── Comunes a los tres modos ────────────────────────────────── */
  portada: {
    id: "portada",
    nombre: "Portada",
    ayuda: "Lo primero que se ve al entrar: tu logo, la foto grande, el título y el botón de WhatsApp.",
    modos: ["AGENCY", "AGENT", "OWNER"],
    // Sin `consume`: la portada se pinta siempre, aunque la cartera esté
    // vacía. Es lo único que garantiza que una cuenta recién dada de alta
    // tenga página en vez de un 404. La plantilla "una-propiedad" SÍ lo
    // recorta a ["inmuebles"], porque ahí la portada ES la ficha del
    // inmueble — y por eso este bloque declara que sabe pintarlos.
    consume: [],
    pinta: ["whatsapp", "inmuebles", "recorrido"],
  },
  buscador: {
    id: "buscador",
    nombre: "Buscador de inmuebles",
    ayuda: "La barra para filtrar por operación, tipo, zona y recámaras sin salir de la página.",
    modos: ["AGENCY", "AGENT", "OWNER"],
    consume: ["inmuebles"],
    pinta: ["buscador", "inmuebles"],
  },
  inmuebles: {
    id: "inmuebles",
    nombre: "Inmuebles",
    ayuda: "La rejilla con tus inmuebles publicados: foto, precio, ubicación y el recorrido si lo tiene.",
    modos: ["AGENCY", "AGENT", "OWNER"],
    consume: ["inmuebles"],
    // "whatsapp" por la variante `vitrina` (OWNER): cada inmueble lleva su
    // propio botón con el mensaje ya escrito. Las demás variantes no lo
    // pintan, pero el catálogo se declara UNA vez contra el JSX entero.
    pinta: ["inmuebles", "recorrido", "whatsapp"],
  },
  mapa: {
    id: "mapa",
    nombre: "Dónde estamos",
    ayuda: "El mapa con tus sucursales y el botón de «cómo llegar». Se carga solo si lo abren.",
    modos: ["AGENCY", "AGENT", "OWNER"],
    consume: ["sucursales", "contacto"],
    pinta: ["mapa", "sucursales"],
  },
  contacto: {
    id: "contacto",
    nombre: "Contacto",
    ayuda: "El formulario y el WhatsApp: por aquí te entran los prospectos al CRM.",
    modos: ["AGENCY", "AGENT", "OWNER"],
    consume: ["contacto"],
    pinta: ["whatsapp"],
  },

  /* ── AGENT: el sujeto es la persona ──────────────────────────── */
  "sobre-mi": {
    id: "sobre-mi",
    nombre: "Sobre mí",
    ayuda: "Tu historia en unas líneas: quién eres, desde cuándo y por qué te compran a ti.",
    modos: ["AGENT"],
    consume: ["historia"],
    pinta: ["historia"],
  },
  credenciales: {
    id: "credenciales",
    nombre: "Credenciales y certificaciones",
    ayuda: "Tu cédula, AMPI, registro estatal y certificaciones. Es lo que da confianza.",
    // También AGENCY: una inmobiliaria con AMPI y registro estatal tiene
    // exactamente el mismo diferenciador que un asesor certificado.
    modos: ["AGENT", "AGENCY"],
    consume: ["credenciales"],
    pinta: ["credenciales"],
  },
  zonas: {
    id: "zonas",
    nombre: "Zonas que trabajo",
    ayuda: "Las colonias y ciudades donde trabajas, para que te encuentre quien busca ahí.",
    modos: ["AGENT"],
    consume: ["zonas"],
    pinta: ["zonas"],
  },
  testimonios: {
    id: "testimonios",
    nombre: "Lo que dicen mis clientes",
    ayuda: "Lo que dijeron tus clientes. Se pintan tal cual los escribas aquí.",
    modos: ["AGENT"],
    consume: ["testimonios"],
    pinta: ["testimonios"],
  },

  /* ── AGENCY: el sujeto es la empresa ─────────────────────────── */
  equipo: {
    id: "equipo",
    nombre: "Nuestro equipo",
    ayuda: "Las fichas de tus asesores, con su foto y su WhatsApp directo.",
    modos: ["AGENCY"],
    consume: ["agentes"],
    pinta: ["agentes", "whatsapp"],
  },
  sucursales: {
    id: "sucursales",
    nombre: "Sucursales",
    ayuda: "Las direcciones y teléfonos de tus oficinas, con su foto.",
    modos: ["AGENCY"],
    consume: ["sucursales"],
    pinta: ["sucursales"],
  },
  numeros: {
    id: "numeros",
    nombre: "Los números de la empresa",
    ayuda: "Tres o cuatro cifras que dicen el tamaño de la empresa: años, operaciones, clientes.",
    modos: ["AGENCY"],
    consume: ["numeros"],
    pinta: ["numeros"],
  },

  /* ── OWNER: el sujeto es el inmueble ─────────────────────────── */
  "disponibilidad-ahora": {
    id: "disponibilidad-ahora",
    nombre: "Qué está disponible ahora",
    ayuda: "El tablero de qué tienes libre, apartado y rentado ahora mismo.",
    modos: ["OWNER"],
    consume: ["inmuebles"],
    pinta: ["inmuebles"],
  },
  "requisitos-para-rentar": {
    id: "requisitos-para-rentar",
    nombre: "Requisitos para rentar",
    ayuda: "Lo que pides para rentar: aval, depósito y comprobantes. Ahorra llamadas.",
    modos: ["OWNER"],
    consume: ["requisitos"],
    pinta: ["requisitos"],
  },
  "trato-directo": {
    id: "trato-directo",
    nombre: "Trato directo con el dueño",
    ayuda: "La banda que aclara que no hay comisión de por medio: te escriben directo a ti.",
    modos: ["OWNER"],
    consume: ["contacto"],
    pinta: ["whatsapp"],
  },
};

/* ═══════════════════════════════════════════════════════════════════
   2 · VOCABULARIO COMPARTIDO — ranuras de foto y copia repetida
   ═══════════════════════════════════════════════════════════════════ */

const FOTO_LOGO: RealtyWebManifestFoto = {
  id: "logo",
  nombre: "Logo",
  proporcion: "cuadrada",
  ayuda: "Con fondo transparente se ve mejor. Si no subes ninguno, usamos el de tu cuenta.",
};

const FOTO_PORTADA: RealtyWebManifestFoto = {
  id: "portada",
  nombre: "Foto de portada",
  proporcion: "16:9 apaisada",
  ayuda: "La foto grande de arriba. Se recorta a lo ancho: no dejes nada pegado al borde.",
};

const FOTO_RETRATO: RealtyWebManifestFoto = {
  id: "retrato",
  nombre: "Tu foto",
  proporcion: "3:4 vertical",
  ayuda: "De frente y con buena luz. Es lo primero que mira quien va a confiarte una casa.",
};

const FOTO_EQUIPO: RealtyWebManifestFoto = {
  id: "equipoFoto",
  nombre: "Foto de todo el equipo",
  proporcion: "3:2 apaisada",
  ayuda: "Todos juntos. Sale detrás del bloque de asesores.",
};

const FOTO_OFICINA: RealtyWebManifestFoto = {
  id: "oficina",
  nombre: "Foto de la oficina",
  proporcion: "4:3",
  ayuda: "La recepción o la fachada. Da confianza saber que existe un lugar físico.",
};

/** Los botones de la portada. Cambian de literal en cada plantilla. */
function copiaPortada(
  cta: string,
  whats: string,
  kicker?: string,
): RealtyWebManifestCopia[] {
  const out: RealtyWebManifestCopia[] = [
    { clave: "portada.cta", etiqueta: "Portada · botón principal", porDefecto: cta, maxLen: 40 },
    { clave: "portada.whatsapp", etiqueta: "Portada · botón de WhatsApp", porDefecto: whats, maxLen: 40 },
  ];
  if (kicker) {
    out.unshift({ clave: "portada.kicker", etiqueta: "Portada · etiqueta de arriba", porDefecto: kicker, maxLen: 40 });
  }
  return out;
}

const COPIA_INMUEBLES: RealtyWebManifestCopia[] = [
  { clave: "inmuebles.cta", etiqueta: "Inmuebles · botón de cada tarjeta", porDefecto: "Ver inmueble", maxLen: 40 },
  { clave: "inmuebles.todos", etiqueta: "Inmuebles · botón de ver todos", porDefecto: "Ver todos los inmuebles", maxLen: 48 },
  { clave: "inmuebles.recorrido", etiqueta: "Inmuebles · insignia de recorrido", porDefecto: "Recorrido virtual", maxLen: 30 },
];

const COPIA_CONTACTO: RealtyWebManifestCopia[] = [
  { clave: "contacto.nombre", etiqueta: "Contacto · campo del nombre", porDefecto: "Tu nombre", maxLen: 40 },
  { clave: "contacto.telefono", etiqueta: "Contacto · campo del WhatsApp", porDefecto: "Tu WhatsApp", maxLen: 40 },
  { clave: "contacto.mensaje", etiqueta: "Contacto · campo del mensaje", porDefecto: "¿Qué estás buscando?", maxLen: 60 },
  { clave: "contacto.enviar", etiqueta: "Contacto · botón de enviar", porDefecto: "Enviar", maxLen: 30 },
  { clave: "contacto.whatsapp", etiqueta: "Contacto · botón de WhatsApp", porDefecto: "Mejor por WhatsApp", maxLen: 40 },
  { clave: "contacto.aviso", etiqueta: "Contacto · aviso de privacidad", porDefecto: "Usamos tus datos solo para contactarte sobre este inmueble.", maxLen: 140 },
];

/** El bloque de contacto: obligatorio en las nueve. */
function bContacto(titulo: string, subtitulo: string, variante: string): RealtyWebManifestBloque {
  return {
    id: "contacto",
    obligatoria: true,
    variante,
    textos: [
      { campo: "titulo", etiqueta: "Título de contacto", porDefecto: titulo },
      { campo: "subtitulo", etiqueta: "Bajada de contacto", porDefecto: subtitulo },
    ],
    copia: COPIA_CONTACTO,
  };
}

/** El bloque de inmuebles con sus textos por plantilla. */
function bInmuebles(
  variante: string,
  titulo: string,
  subtitulo: string,
  kicker: string,
  /** Claves que solo pinta ESTE maquetado (la vitrina lleva WhatsApp por inmueble). */
  extra: RealtyWebManifestCopia[] = [],
): RealtyWebManifestBloque {
  return {
    id: "inmuebles",
    variante,
    textos: [
      { campo: "titulo", etiqueta: "Título de los inmuebles", porDefecto: titulo },
      { campo: "subtitulo", etiqueta: "Bajada de los inmuebles", porDefecto: subtitulo },
    ],
    copia: [
      { clave: "inmuebles.kicker", etiqueta: "Inmuebles · etiqueta", porDefecto: kicker, maxLen: 40 },
      ...COPIA_INMUEBLES,
      ...extra,
    ],
  };
}

/** Los rótulos del buscador. Los mismos siete en las tres plantillas que lo llevan. */
function copiaBuscador(
  tipo: string,
  zona: string,
  buscar: string,
  limpiar: string,
  vacio: string,
): RealtyWebManifestCopia[] {
  return [
    { clave: "buscador.operacion", etiqueta: "Buscador · rótulo de operación", porDefecto: "Operación", maxLen: 30 },
    { clave: "buscador.tipo", etiqueta: "Buscador · rótulo de tipo", porDefecto: tipo, maxLen: 30 },
    { clave: "buscador.zona", etiqueta: "Buscador · rótulo de zona", porDefecto: zona, maxLen: 30 },
    { clave: "buscador.recamaras", etiqueta: "Buscador · rótulo de recámaras", porDefecto: "Recámaras", maxLen: 30 },
    { clave: "buscador.buscar", etiqueta: "Buscador · botón", porDefecto: buscar, maxLen: 24 },
    { clave: "buscador.limpiar", etiqueta: "Buscador · botón de limpiar", porDefecto: limpiar, maxLen: 30 },
    { clave: "buscador.vacio", etiqueta: "Buscador · sin resultados", porDefecto: vacio, maxLen: 140 },
  ];
}

/** Los textos del bloque de equipo. */
function copiaEquipo(kicker: string, cta: string): RealtyWebManifestCopia[] {
  return [
    { clave: "equipo.kicker", etiqueta: "Equipo · etiqueta", porDefecto: kicker, maxLen: 40 },
    { clave: "equipo.cta", etiqueta: "Equipo · botón de cada asesor", porDefecto: cta, maxLen: 40 },
    { clave: "equipo.whatsapp", etiqueta: "Equipo · botón de WhatsApp", porDefecto: "WhatsApp", maxLen: 30 },
  ];
}

/** Los textos del bloque de trato directo. La nota va vacía a propósito (ver "mis-rentas"). */
function copiaTratoDirecto(cta: string): RealtyWebManifestCopia[] {
  return [
    { clave: "tratoDirecto.cta", etiqueta: "Trato directo · botón", porDefecto: cta, maxLen: 44 },
    { clave: "tratoDirecto.nota", etiqueta: "Trato directo · nota", porDefecto: "", maxLen: 90 },
  ];
}

const COPIA_CREDENCIALES: RealtyWebManifestCopia[] = [
  { clave: "credenciales.licencia", etiqueta: "Credenciales · rótulo de la licencia", porDefecto: "Licencia inmobiliaria", maxLen: 40 },
  { clave: "credenciales.folio", etiqueta: "Credenciales · rótulo del folio", porDefecto: "Folio", maxLen: 24 },
];

/* ═══════════════════════════════════════════════════════════════════
   3 · LAS QUINCE PLANTILLAS (nueve de la ola 1 + seis premium al final)

   El ORDEN de los bloques es la firma de la plantilla. Una prueba exige
   que las quince firmas sean distintas: dos plantillas con la misma firma
   son la misma con otro color, que es exactamente lo que este vertical NO
   quiere vender.
   ═══════════════════════════════════════════════════════════════════ */

export const REALTY_WEB_MANIFESTS: Record<RealtyWebTemplateId, RealtyWebManifest> = {
  /* ────────────────────────────────────────────────────────────────
     AGENT · 1 — ASESOR
     El retrato manda: foto vertical a la derecha, nombre y promesa a la
     izquierda, y las CREDENCIALES en una tira inmediatamente debajo, antes
     que nada más. Es a propósito: el 70% de los compradores mira la
     reputación del asesor antes de decidir, y solo el 10% de los asesores
     mexicanos está capacitado. Enseñarlo arriba es el argumento.
     ──────────────────────────────────────────────────────────────── */
  asesor: {
    id: "asesor",
    nombre: "Asesor",
    modo: "AGENT",
    para: "Tu foto, tu nombre y tus certificaciones al frente.",
    estructura: "Retrato partido en dos · credenciales en tira · inmuebles en rejilla · testimonios",
    acentoSugerido: "pino",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "retrato",
        fotos: [FOTO_LOGO, FOTO_RETRATO],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Te ayudo a encontrar tu casa" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Asesor inmobiliario. Acompaño la operación completa, del primer recorrido a la firma." },
        ],
        copia: copiaPortada("Ver inmuebles", "Escríbeme por WhatsApp", "Asesor inmobiliario"),
      },
      {
        id: "credenciales",
        variante: "tira",
        textos: [
          { campo: "titulo", etiqueta: "Título de credenciales", porDefecto: "Con qué respaldo trabajo" },
          { campo: "subtitulo", etiqueta: "Bajada de credenciales", porDefecto: "" },
        ],
        copia: COPIA_CREDENCIALES,
      },
      bInmuebles(
        "rejilla",
        "Inmuebles que estoy manejando",
        "Cada uno con su recorrido, sus medidas y su colonia.",
        "Mi cartera",
      ),
      {
        id: "zonas",
        variante: "pastillas",
        textos: [
          { campo: "titulo", etiqueta: "Título de zonas", porDefecto: "Dónde me muevo" },
          { campo: "subtitulo", etiqueta: "Bajada de zonas", porDefecto: "Conozco estas colonias de caminarlas, no de verlas en un mapa." },
        ],
      },
      {
        id: "testimonios",
        variante: "tarjetas",
        textos: [
          { campo: "titulo", etiqueta: "Título de testimonios", porDefecto: "Lo que dicen quienes ya compraron" },
          { campo: "subtitulo", etiqueta: "Bajada de testimonios", porDefecto: "" },
        ],
      },
      {
        id: "sobre-mi",
        variante: "columna",
        fotos: [FOTO_PORTADA],
        textos: [
          { campo: "titulo", etiqueta: "Título de sobre mí", porDefecto: "Un poco de mí" },
          { campo: "subtitulo", etiqueta: "Bajada de sobre mí", porDefecto: "" },
        ],
      },
      bContacto("Hablemos", "Cuéntame qué buscas y te mando opciones el mismo día.", "formulario"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     AGENT · 2 — MINIMAL
     Sin foto grande, sin testimonios, sin historia. Un titular, la lista de
     inmuebles en filas horizontales y el contacto. Para el asesor que
     quiere una página que cargue en un parpadeo y no le da pena no tener
     todavía veinte propiedades.
     ──────────────────────────────────────────────────────────────── */
  minimal: {
    id: "minimal",
    nombre: "Minimal",
    modo: "AGENT",
    para: "Sobria y rapidísima. Solo tu nombre, tus inmuebles y cómo contactarte.",
    estructura: "Titular sin foto · inmuebles en filas · zonas en una línea",
    acentoSugerido: "carbon",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "sobria",
        fotos: [FOTO_LOGO],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Casas y departamentos, sin vueltas" },
          // Sin "contesto el mismo día": es un compromiso de respuesta que
          // se publicaría SOLO, sin que nadie lo escriba, el día del alta.
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Selección corta y actualizada. Escríbeme por WhatsApp y lo vemos." },
        ],
        copia: copiaPortada("Ver la lista", "WhatsApp"),
      },
      bInmuebles(
        "filas",
        "Disponibles",
        "",
        "Inventario",
      ),
      {
        id: "zonas",
        variante: "linea",
        textos: [
          { campo: "titulo", etiqueta: "Título de zonas", porDefecto: "Zonas" },
          { campo: "subtitulo", etiqueta: "Bajada de zonas", porDefecto: "" },
        ],
      },
      bContacto("Contacto", "", "compacto"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     AGENT · 3 — HISTORIA
     Editorial, para lujo. La portada es una foto a sangre con el titular
     encima; luego una columna de texto largo (la historia), las
     credenciales en una línea fina, y los inmuebles como ESCAPARATE: pocos,
     enormes, uno por fila. Aquí la casa se vende contándola.
     ──────────────────────────────────────────────────────────────── */
  historia: {
    id: "historia",
    nombre: "Historia",
    modo: "AGENT",
    para: "Editorial y de lujo: texto largo y fotos grandes. Para propiedades que se cuentan.",
    estructura: "Portada a sangre · columna editorial · inmuebles en escaparate · cita",
    acentoSugerido: "tinta",
    oscura: true,
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "editorial",
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Propiedades con historia" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Asesoría discreta para casas que no se anuncian en cualquier parte." },
        ],
        copia: copiaPortada("Ver la selección", "Agendar una llamada", "Selección privada"),
      },
      {
        id: "sobre-mi",
        variante: "editorial",
        fotos: [FOTO_RETRATO],
        textos: [
          { campo: "titulo", etiqueta: "Título de la historia", porDefecto: "Cómo trabajo" },
          { campo: "subtitulo", etiqueta: "Bajada de la historia", porDefecto: "" },
        ],
      },
      {
        id: "credenciales",
        variante: "linea",
        textos: [
          { campo: "titulo", etiqueta: "Título de credenciales", porDefecto: "Acreditaciones" },
          { campo: "subtitulo", etiqueta: "Bajada de credenciales", porDefecto: "" },
        ],
        copia: COPIA_CREDENCIALES,
      },
      bInmuebles(
        "escaparate",
        "La selección",
        "Pocas propiedades, todas visitadas.",
        "Portafolio",
      ),
      {
        id: "testimonios",
        variante: "cita",
        textos: [
          { campo: "titulo", etiqueta: "Título de testimonios", porDefecto: "" },
          { campo: "subtitulo", etiqueta: "Bajada de testimonios", porDefecto: "" },
        ],
      },
      {
        id: "zonas",
        variante: "pastillas",
        textos: [
          { campo: "titulo", etiqueta: "Título de zonas", porDefecto: "Dónde trabajo" },
          { campo: "subtitulo", etiqueta: "Bajada de zonas", porDefecto: "" },
        ],
      },
      bContacto("Conversemos", "Con una llamada breve entiendo qué buscas.", "editorial"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     AGENCY · 4 — CLÁSICA
     La estructura que espera quien busca casa: BUSCADOR arriba del todo,
     inventario en rejilla al centro, equipo abajo. Es la que trae de fábrica
     una inmobiliaria porque es la que menos sorprende y más convierte.
     ──────────────────────────────────────────────────────────────── */
  clasica: {
    id: "clasica",
    nombre: "Clásica",
    modo: "AGENCY",
    para: "La de toda la vida: buscas arriba, ves el inventario y conoces al equipo.",
    estructura: "Buscador sobre la portada · inventario en rejilla · equipo · sucursales",
    acentoSugerido: "pino",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "buscador",
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Encuentra tu próxima casa" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Casas, departamentos y terrenos con asesoría de principio a fin." },
        ],
        copia: copiaPortada("Buscar", "Escríbenos por WhatsApp"),
      },
      {
        id: "buscador",
        variante: "barra",
        textos: [
          { campo: "titulo", etiqueta: "Título del buscador", porDefecto: "¿Qué estás buscando?" },
          { campo: "subtitulo", etiqueta: "Bajada del buscador", porDefecto: "" },
        ],
        copia: [
          { clave: "buscador.operacion", etiqueta: "Buscador · rótulo de operación", porDefecto: "Operación", maxLen: 30 },
          { clave: "buscador.tipo", etiqueta: "Buscador · rótulo de tipo", porDefecto: "Tipo de inmueble", maxLen: 30 },
          { clave: "buscador.zona", etiqueta: "Buscador · rótulo de zona", porDefecto: "Ciudad o colonia", maxLen: 30 },
          { clave: "buscador.recamaras", etiqueta: "Buscador · rótulo de recámaras", porDefecto: "Recámaras", maxLen: 30 },
          { clave: "buscador.buscar", etiqueta: "Buscador · botón", porDefecto: "Buscar", maxLen: 24 },
          { clave: "buscador.limpiar", etiqueta: "Buscador · botón de limpiar", porDefecto: "Limpiar filtros", maxLen: 30 },
          { clave: "buscador.vacio", etiqueta: "Buscador · sin resultados", porDefecto: "No encontramos inmuebles con esos filtros. Prueba con menos.", maxLen: 140 },
        ],
      },
      bInmuebles(
        "rejilla",
        "Nuestro inventario",
        "Todo lo que tenemos disponible ahora mismo.",
        "Inmuebles",
      ),
      {
        id: "equipo",
        variante: "tarjetas",
        fotos: [FOTO_EQUIPO],
        textos: [
          { campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Quién te va a atender" },
          { campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "Cada asesor tiene su zona y su especialidad." },
        ],
        copia: [
          { clave: "equipo.kicker", etiqueta: "Equipo · etiqueta", porDefecto: "El equipo", maxLen: 40 },
          { clave: "equipo.cta", etiqueta: "Equipo · botón de cada asesor", porDefecto: "Ver su perfil", maxLen: 40 },
          { clave: "equipo.whatsapp", etiqueta: "Equipo · botón de WhatsApp", porDefecto: "WhatsApp", maxLen: 30 },
        ],
      },
      {
        id: "credenciales",
        variante: "tira",
        textos: [
          { campo: "titulo", etiqueta: "Título de credenciales", porDefecto: "Con qué respaldo trabajamos" },
          { campo: "subtitulo", etiqueta: "Bajada de credenciales", porDefecto: "" },
        ],
        copia: COPIA_CREDENCIALES,
      },
      {
        id: "sucursales",
        variante: "lista",
        fotos: [FOTO_OFICINA],
        textos: [
          { campo: "titulo", etiqueta: "Título de sucursales", porDefecto: "Dónde estamos" },
          { campo: "subtitulo", etiqueta: "Bajada de sucursales", porDefecto: "" },
        ],
        copia: [
          { clave: "sucursales.comoLlegar", etiqueta: "Sucursales · botón del mapa", porDefecto: "Cómo llegar", maxLen: 30 },
          { clave: "sucursales.matriz", etiqueta: "Sucursales · etiqueta de la matriz", porDefecto: "Matriz", maxLen: 24 },
        ],
      },
      bContacto("Déjanos tus datos", "Te contactamos hoy mismo con opciones que encajen.", "formulario"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     AGENCY · 5 — CORPORATIVA
     Para desarrolladoras y preventas. Empieza con los NÚMEROS de la
     empresa (años, entregas, unidades), luego los inmuebles con el estatus
     comercial muy visible, después las sucursales como tarjetas con foto y
     al final el equipo en versión compacta. La empresa manda; el asesor es
     el último renglón.
     ──────────────────────────────────────────────────────────────── */
  corporativa: {
    id: "corporativa",
    nombre: "Corporativa",
    modo: "AGENCY",
    para: "Desarrolladoras y preventas: los números de la empresa por delante.",
    estructura: "Portada de desarrollo · tira de números · inmuebles con estatus · sucursales con foto",
    acentoSugerido: "tinta",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "desarrollo",
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Desarrollos y preventas" },
          // Sin "una empresa que entrega": es una garantía de cumplimiento
          // sobre preventas, publicada por defecto, que nadie ha respaldado.
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Desarrollos en preventa. Planes de pago directos con el desarrollador." },
        ],
        copia: copiaPortada("Ver desarrollos", "Hablar con un asesor", "Grupo inmobiliario"),
      },
      {
        id: "numeros",
        variante: "tira",
        textos: [
          { campo: "titulo", etiqueta: "Título de los números", porDefecto: "" },
          { campo: "subtitulo", etiqueta: "Bajada de los números", porDefecto: "" },
        ],
      },
      bInmuebles(
        "preventa",
        "Nuestros desarrollos",
        "Estatus actualizado de cada unidad.",
        "Portafolio",
      ),
      {
        id: "sucursales",
        variante: "tarjetas",
        fotos: [FOTO_OFICINA],
        textos: [
          { campo: "titulo", etiqueta: "Título de sucursales", porDefecto: "Nuestras oficinas" },
          { campo: "subtitulo", etiqueta: "Bajada de sucursales", porDefecto: "Te atendemos en cualquiera de ellas." },
        ],
        copia: [
          { clave: "sucursales.comoLlegar", etiqueta: "Sucursales · botón del mapa", porDefecto: "Ver en el mapa", maxLen: 30 },
          { clave: "sucursales.matriz", etiqueta: "Sucursales · etiqueta de la matriz", porDefecto: "Corporativo", maxLen: 24 },
        ],
      },
      {
        id: "equipo",
        variante: "compacto",
        textos: [
          { campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Asesores certificados" },
          { campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "" },
        ],
        copia: [
          { clave: "equipo.kicker", etiqueta: "Equipo · etiqueta", porDefecto: "Equipo comercial", maxLen: 40 },
          { clave: "equipo.cta", etiqueta: "Equipo · botón de cada asesor", porDefecto: "Ver perfil", maxLen: 40 },
          { clave: "equipo.whatsapp", etiqueta: "Equipo · botón de WhatsApp", porDefecto: "WhatsApp", maxLen: 30 },
        ],
      },
      {
        id: "credenciales",
        variante: "tira",
        textos: [
          { campo: "titulo", etiqueta: "Título de credenciales", porDefecto: "Registros y afiliaciones" },
          { campo: "subtitulo", etiqueta: "Bajada de credenciales", porDefecto: "" },
        ],
        copia: COPIA_CREDENCIALES,
      },
      {
        id: "mapa",
        variante: "banda",
        textos: [
          { campo: "titulo", etiqueta: "Título del mapa", porDefecto: "Encuéntranos" },
          { campo: "subtitulo", etiqueta: "Bajada del mapa", porDefecto: "" },
        ],
        copia: [
          { clave: "mapa.abrir", etiqueta: "Mapa · botón para cargarlo", porDefecto: "Ver el mapa", maxLen: 30 },
          { clave: "mapa.comoLlegar", etiqueta: "Mapa · botón de cómo llegar", porDefecto: "Cómo llegar", maxLen: 30 },
        ],
      },
      bContacto("Agenda una cita", "Un asesor te contacta para explicarte planes de pago.", "formulario"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     AGENCY · 6 — BOUTIQUE
     Pocas propiedades, muy cuidadas. El inventario va como ESCAPARATE (una
     por fila, foto enorme) inmediatamente después de la portada, antes que
     cualquier cosa de la empresa: aquí el producto es la casa. Las
     credenciales van como un sello discreto y el equipo son retratos.
     ──────────────────────────────────────────────────────────────── */
  boutique: {
    id: "boutique",
    nombre: "Boutique",
    modo: "AGENCY",
    para: "Pocas propiedades y muy cuidadas: la foto grande manda.",
    estructura: "Portada calmada · escaparate a fila completa · sello de credenciales · retratos",
    acentoSugerido: "arena",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "boutique",
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Casas escogidas una por una" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Trabajamos con pocas propiedades para poder conocerlas de verdad." },
        ],
        copia: copiaPortada("Ver las propiedades", "Escríbenos", "Inmobiliaria boutique"),
      },
      bInmuebles(
        "escaparate",
        "En este momento",
        "",
        "Propiedades",
      ),
      {
        id: "credenciales",
        variante: "sello",
        textos: [
          { campo: "titulo", etiqueta: "Título de credenciales", porDefecto: "Quiénes respaldan esto" },
          { campo: "subtitulo", etiqueta: "Bajada de credenciales", porDefecto: "" },
        ],
        copia: COPIA_CREDENCIALES,
      },
      {
        id: "equipo",
        variante: "retratos",
        fotos: [FOTO_EQUIPO],
        textos: [
          { campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Las personas detrás" },
          { campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "" },
        ],
        copia: [
          { clave: "equipo.kicker", etiqueta: "Equipo · etiqueta", porDefecto: "Nosotros", maxLen: 40 },
          { clave: "equipo.cta", etiqueta: "Equipo · botón de cada asesor", porDefecto: "Conocer más", maxLen: 40 },
          { clave: "equipo.whatsapp", etiqueta: "Equipo · botón de WhatsApp", porDefecto: "WhatsApp", maxLen: 30 },
        ],
      },
      {
        id: "sucursales",
        variante: "minima",
        textos: [
          { campo: "titulo", etiqueta: "Título de sucursales", porDefecto: "La oficina" },
          { campo: "subtitulo", etiqueta: "Bajada de sucursales", porDefecto: "" },
        ],
        copia: [
          { clave: "sucursales.comoLlegar", etiqueta: "Sucursales · botón del mapa", porDefecto: "Cómo llegar", maxLen: 30 },
          { clave: "sucursales.matriz", etiqueta: "Sucursales · etiqueta de la matriz", porDefecto: "Principal", maxLen: 24 },
        ],
      },
      bContacto("Escríbenos", "Cuéntanos qué buscas y te decimos con franqueza si lo tenemos.", "formulario"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     OWNER · 7 — MIS RENTAS
     Un TABLERO de disponibilidad: lo primero que ve el inquilino es qué
     está libre y desde cuándo, no quién es el dueño. Después los requisitos
     (sin sorpresas al final) y la banda de "trato directo".
     ──────────────────────────────────────────────────────────────── */
  "mis-rentas": {
    id: "mis-rentas",
    nombre: "Mis rentas",
    modo: "OWNER",
    para: "Un tablero con lo que está libre ahora y los requisitos claros.",
    estructura: "Tablero de disponibilidad arriba · requisitos · banda de trato directo",
    acentoSugerido: "pino",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "tablero",
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Rento directo, sin comisión" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Trato directo conmigo. Te ahorras el mes que cobra la inmobiliaria." },
        ],
        copia: copiaPortada("Ver qué hay libre", "Preguntar por WhatsApp", "Trato directo"),
      },
      {
        id: "disponibilidad-ahora",
        variante: "tablero",
        textos: [
          { campo: "titulo", etiqueta: "Título de disponibilidad", porDefecto: "Disponible ahora" },
          { campo: "subtitulo", etiqueta: "Bajada de disponibilidad", porDefecto: "Actualizo esta lista en cuanto se desocupa algo." },
        ],
        copia: [
          { clave: "disponibilidad.libre", etiqueta: "Disponibilidad · etiqueta de libre", porDefecto: "Libre", maxLen: 24 },
          { clave: "disponibilidad.apartado", etiqueta: "Disponibilidad · etiqueta de apartado", porDefecto: "Apartado", maxLen: 24 },
          { clave: "disponibilidad.rentado", etiqueta: "Disponibilidad · etiqueta de rentado", porDefecto: "Rentado", maxLen: 24 },
          { clave: "disponibilidad.cta", etiqueta: "Disponibilidad · botón", porDefecto: "Ver detalles", maxLen: 30 },
        ],
      },
      bInmuebles(
        "rejilla",
        "Todos mis inmuebles",
        "",
        "En renta",
      ),
      {
        id: "requisitos-para-rentar",
        variante: "lista",
        textos: [
          { campo: "titulo", etiqueta: "Título de requisitos", porDefecto: "Qué necesitas para rentar" },
          { campo: "subtitulo", etiqueta: "Bajada de requisitos", porDefecto: "Te los digo desde ahorita para que no pierdas el viaje." },
        ],
      },
      {
        id: "trato-directo",
        variante: "banda",
        textos: [
          { campo: "titulo", etiqueta: "Título de trato directo", porDefecto: "Trato directo con el dueño" },
          { campo: "subtitulo", etiqueta: "Bajada de trato directo", porDefecto: "Sin intermediarios y sin comisión: hablas conmigo desde el primer mensaje." },
        ],
        copia: [
          { clave: "tratoDirecto.cta", etiqueta: "Trato directo · botón", porDefecto: "Escríbeme por WhatsApp", maxLen: 44 },
          // Vacío a propósito, como en las otras dos plantillas OWNER: un
          // horario por defecto afirma algo que la cuenta no ha configurado
          // (y "de 9 a 8" ni siquiera dice si es de la mañana o de la noche).
          // El editor sugiere el formato con el placeholder.
          { clave: "tratoDirecto.nota", etiqueta: "Trato directo · nota", porDefecto: "", maxLen: 90 },
        ],
      },
      bContacto("Déjame tus datos", "Te aviso en cuanto se desocupe algo que encaje contigo.", "formulario"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     OWNER · 8 — UNA PROPIEDAD
     Landing de UN SOLO inmueble: portada con su galería y su ficha, la
     banda de trato directo enseguida, los requisitos, el mapa y el
     formulario. No hay bloque de "inmuebles" porque no hay listado que ver.
     El destacado se elige en el editor (config.inmuebleDestacado).
     ──────────────────────────────────────────────────────────────── */
  "una-propiedad": {
    id: "una-propiedad",
    nombre: "Una propiedad",
    modo: "OWNER",
    para: "Tienes un solo inmueble en renta y quieres una página dedicada.",
    estructura: "Ficha del inmueble como portada · trato directo · requisitos · mapa",
    acentoSugerido: "terracota",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "unaPropiedad",
        // Recorte del catálogo: ESTA portada sí necesita un inmueble, porque
        // la landing entera habla de él. Sin inmuebles publicados no hay
        // nada que enseñar y el bloque se cae solo.
        consume: ["inmuebles"],
        fotos: [FOTO_LOGO],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "En renta, trato directo" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "" },
        ],
        copia: [
          ...copiaPortada("Agendar visita", "Preguntar por WhatsApp", "Disponible"),
          { clave: "portada.recorrido", etiqueta: "Portada · botón del recorrido", porDefecto: "Ver recorrido virtual", maxLen: 40 },
        ],
      },
      {
        id: "trato-directo",
        variante: "banda",
        textos: [
          { campo: "titulo", etiqueta: "Título de trato directo", porDefecto: "Hablas con el dueño, no con una inmobiliaria" },
          { campo: "subtitulo", etiqueta: "Bajada de trato directo", porDefecto: "Sin comisión de por medio: ese mes te lo quedas tú." },
        ],
        copia: [
          { clave: "tratoDirecto.cta", etiqueta: "Trato directo · botón", porDefecto: "Escríbeme", maxLen: 44 },
          { clave: "tratoDirecto.nota", etiqueta: "Trato directo · nota", porDefecto: "", maxLen: 90 },
        ],
      },
      {
        id: "requisitos-para-rentar",
        variante: "tarjeta",
        textos: [
          { campo: "titulo", etiqueta: "Título de requisitos", porDefecto: "Requisitos" },
          { campo: "subtitulo", etiqueta: "Bajada de requisitos", porDefecto: "" },
        ],
      },
      {
        id: "mapa",
        variante: "recuadro",
        textos: [
          { campo: "titulo", etiqueta: "Título del mapa", porDefecto: "Dónde está" },
          { campo: "subtitulo", etiqueta: "Bajada del mapa", porDefecto: "" },
        ],
        copia: [
          { clave: "mapa.abrir", etiqueta: "Mapa · botón para cargarlo", porDefecto: "Ver la ubicación", maxLen: 30 },
          { clave: "mapa.comoLlegar", etiqueta: "Mapa · botón de cómo llegar", porDefecto: "Cómo llegar", maxLen: 30 },
          { clave: "mapa.aproximado", etiqueta: "Mapa · aviso de ubicación aproximada", porDefecto: "Ubicación aproximada. La dirección exacta se comparte al coordinar la visita.", maxLen: 140 },
        ],
      },
      bContacto("¿Te interesa?", "Déjame tus datos y te contacto para agendar la visita.", "formulario"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     OWNER · 9 — CATÁLOGO
     Lista limpia, SIN biografía y SIN historia: el rentista que administra
     ocho departamentos y solo quiere una liga que mandar por WhatsApp. Los
     requisitos van arriba del listado a propósito: filtra antes de que
     alguien se ilusione.
     ──────────────────────────────────────────────────────────────── */
  catalogo: {
    id: "catalogo",
    nombre: "Catálogo",
    modo: "OWNER",
    para: "Solo la lista, sin biografía. Una liga para mandar por WhatsApp.",
    estructura: "Encabezado corto · requisitos antes del listado · filas con precio",
    acentoSugerido: "carbon",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "sobria",
        fotos: [FOTO_LOGO],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Departamentos en renta" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Trato directo con el dueño. Sin comisión." },
        ],
        copia: copiaPortada("Ver la lista", "WhatsApp"),
      },
      {
        id: "requisitos-para-rentar",
        variante: "linea",
        textos: [
          { campo: "titulo", etiqueta: "Título de requisitos", porDefecto: "Requisitos" },
          { campo: "subtitulo", etiqueta: "Bajada de requisitos", porDefecto: "" },
        ],
      },
      {
        id: "buscador",
        variante: "compacto",
        textos: [
          { campo: "titulo", etiqueta: "Título del buscador", porDefecto: "" },
          { campo: "subtitulo", etiqueta: "Bajada del buscador", porDefecto: "" },
        ],
        copia: [
          { clave: "buscador.operacion", etiqueta: "Buscador · rótulo de operación", porDefecto: "Operación", maxLen: 30 },
          { clave: "buscador.tipo", etiqueta: "Buscador · rótulo de tipo", porDefecto: "Tipo", maxLen: 30 },
          { clave: "buscador.zona", etiqueta: "Buscador · rótulo de zona", porDefecto: "Colonia", maxLen: 30 },
          { clave: "buscador.recamaras", etiqueta: "Buscador · rótulo de recámaras", porDefecto: "Recámaras", maxLen: 30 },
          { clave: "buscador.buscar", etiqueta: "Buscador · botón", porDefecto: "Filtrar", maxLen: 24 },
          { clave: "buscador.limpiar", etiqueta: "Buscador · botón de limpiar", porDefecto: "Quitar filtros", maxLen: 30 },
          { clave: "buscador.vacio", etiqueta: "Buscador · sin resultados", porDefecto: "Nada con esos filtros. Prueba con menos.", maxLen: 140 },
        ],
      },
      bInmuebles(
        "filas",
        "Lo que tengo",
        "",
        "Disponibles",
      ),
      {
        id: "trato-directo",
        variante: "nota",
        textos: [
          { campo: "titulo", etiqueta: "Título de trato directo", porDefecto: "Sin comisión" },
          { campo: "subtitulo", etiqueta: "Bajada de trato directo", porDefecto: "Rentas directo conmigo: no pagas el mes de la inmobiliaria." },
        ],
        copia: [
          { clave: "tratoDirecto.cta", etiqueta: "Trato directo · botón", porDefecto: "Escríbeme", maxLen: 44 },
          { clave: "tratoDirecto.nota", etiqueta: "Trato directo · nota", porDefecto: "", maxLen: 90 },
        ],
      },
      bContacto("Contacto", "", "compacto"),
    ],
  },

  /* ═══════════════════════════════════════════════════════════════
     LAS SEIS PREMIUM — dos por modo.

     El encargo no fue "seis más": fue que se vean CARAS, como las webs
     de las inmobiliarias de alto nivel. Lo que las hace caras está
     investigado y es lo contrario del exceso: paleta terrosa (el verde
     pino y la arena del vertical, sin inventar otra), portada a sangre
     que ocupa todo lo visible, titulares editoriales grandes con texto
     de apoyo pequeño, aire generoso entre secciones y el listado como
     revista (fotos grandes, pocas por fila). Y adaptado a México, no
     copiado de Estados Unidos: el PRECIO y la COLONIA se leen al
     instante y el botón de WhatsApp está siempre a la vista.

     Cada una se distingue de las otras catorce por ESTRUCTURA (la firma
     de orden), no por color; las variantes nuevas de maquetado viven en
     blocks/*.tsx con su CSS al lado (portada.css, inmuebles.css,
     secundarios.css).
     ═══════════════════════════════════════════════════════════════ */

  /* ────────────────────────────────────────────────────────────────
     AGENCY · 10 — GALERÍA
     Portada de cine: la mejor foto del inventario a sangre y a toda la
     altura visible, el titular encima y casi nada más. El BUSCADOR flota
     sobre el borde inferior de la foto —es lo primero que se puede tocar
     sin que estorbe a la foto— y el inventario va como REVISTA: dos por
     fila, foto grande, precio y colonia legibles al instante. Las
     credenciales van en una línea fina y el equipo en retratos sobrios
     al final: la inmobiliaria que quiere verse seria sin gritar.
     ──────────────────────────────────────────────────────────────── */
  galeria: {
    id: "galeria",
    nombre: "Galería",
    modo: "AGENCY",
    para: "Foto a toda pantalla, buscador flotando encima y el inventario como revista.",
    estructura: "Portada de cine · buscador flotante · inmuebles en revista · credenciales en línea · retratos sobrios",
    acentoSugerido: "pino",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "cine",
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Casas que se eligen con calma" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Residencial en las colonias que conocemos casa por casa." },
        ],
        copia: copiaPortada("Ver el inventario", "Escríbenos por WhatsApp", "Inmobiliaria"),
      },
      {
        id: "buscador",
        variante: "flotante",
        // Sin título ni bajada: flota sobre la foto y un encabezado ahí
        // encima rompería la portada. Los rótulos de los campos bastan.
        textos: [
          { campo: "titulo", etiqueta: "Título del buscador", porDefecto: "" },
          { campo: "subtitulo", etiqueta: "Bajada del buscador", porDefecto: "" },
        ],
        copia: copiaBuscador(
          "Tipo de inmueble",
          "Colonia o ciudad",
          "Buscar",
          "Limpiar",
          "No hay inmuebles con esos filtros. Prueba con menos.",
        ),
      },
      bInmuebles(
        "revista",
        "Selección",
        "Cada inmueble con su precio, su colonia y sus medidas. Sin letra chica.",
        "Inventario",
      ),
      {
        id: "credenciales",
        variante: "linea",
        textos: [
          { campo: "titulo", etiqueta: "Título de credenciales", porDefecto: "Respaldo" },
          { campo: "subtitulo", etiqueta: "Bajada de credenciales", porDefecto: "" },
        ],
        copia: COPIA_CREDENCIALES,
      },
      {
        id: "equipo",
        variante: "sobrio",
        fotos: [FOTO_EQUIPO],
        textos: [
          { campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Quiénes te atienden" },
          { campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "" },
        ],
        copia: copiaEquipo("El equipo", "Ver perfil"),
      },
      bContacto("Cuéntanos qué buscas", "Te respondemos con opciones concretas, no con un catálogo entero.", "editorial"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     AGENCY · 11 — TORRE
     Para desarrolladoras y preventas: UN desarrollo manda la portada
     (foto a sangre, "desde" tal precio, colonia, amenidades y galería de
     renders), después los NÚMEROS del avance —% de obra, entrega,
     unidades: texto libre, como todo lo que solo la empresa puede
     afirmar— y el resto del inventario abajo, DISCRETO, sin competir con
     el protagonista. Es la más distinta de las quince: casi una landing
     de producto. El destacado se elige en el editor
     (config.inmuebleDestacado); sin elegirlo, es el más reciente.
     ──────────────────────────────────────────────────────────────── */
  torre: {
    id: "torre",
    nombre: "Torre",
    modo: "AGENCY",
    para: "Un desarrollo en preventa manda la página: avance, amenidades y planes de pago.",
    estructura: "Un desarrollo a sangre · avance de obra en números · amenidades y galería · resto del inventario discreto",
    acentoSugerido: "tinta",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "torre",
        // Como "una-propiedad": ESTA portada habla de UN inmueble y sin
        // inmuebles publicados no hay desarrollo que enseñar.
        consume: ["inmuebles"],
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        textos: [
          // Vacío: el titular ES el nombre del desarrollo (inm.titulo). Si
          // se escribe algo aquí, lo sustituye.
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Preventa con planes de pago directos con el desarrollador." },
        ],
        copia: [
          ...copiaPortada("Ver el desarrollo", "Hablar con un asesor", "Preventa"),
          { clave: "portada.precioRotulo", etiqueta: "Portada · rótulo del precio", porDefecto: "Desde", maxLen: 20 },
          { clave: "portada.recorrido", etiqueta: "Portada · botón del recorrido", porDefecto: "Ver recorrido virtual", maxLen: 40 },
          { clave: "portada.amenidades", etiqueta: "Portada · rótulo de amenidades", porDefecto: "Amenidades", maxLen: 30 },
          { clave: "portada.galeria", etiqueta: "Portada · rótulo de la galería", porDefecto: "Renders y avance", maxLen: 30 },
        ],
      },
      {
        id: "numeros",
        variante: "avance",
        textos: [
          { campo: "titulo", etiqueta: "Título de los números", porDefecto: "Avance de obra" },
          { campo: "subtitulo", etiqueta: "Bajada de los números", porDefecto: "" },
        ],
      },
      bInmuebles(
        "discreta",
        "Otros desarrollos",
        "",
        "También en venta",
      ),
      {
        id: "equipo",
        variante: "compacto",
        textos: [
          { campo: "titulo", etiqueta: "Título del equipo", porDefecto: "Asesores del desarrollo" },
          { campo: "subtitulo", etiqueta: "Bajada del equipo", porDefecto: "" },
        ],
        copia: copiaEquipo("Equipo comercial", "Ver perfil"),
      },
      {
        id: "mapa",
        variante: "banda",
        textos: [
          { campo: "titulo", etiqueta: "Título del mapa", porDefecto: "Oficina de ventas" },
          { campo: "subtitulo", etiqueta: "Bajada del mapa", porDefecto: "" },
        ],
        copia: [
          { clave: "mapa.abrir", etiqueta: "Mapa · botón para cargarlo", porDefecto: "Ver el mapa", maxLen: 30 },
          { clave: "mapa.comoLlegar", etiqueta: "Mapa · botón de cómo llegar", porDefecto: "Cómo llegar", maxLen: 30 },
          { clave: "mapa.aproximado", etiqueta: "Mapa · aviso de ubicación aproximada", porDefecto: "Ubicación aproximada. La dirección exacta se comparte al agendar.", maxLen: 140 },
        ],
      },
      bContacto("Agenda tu visita", "Un asesor te explica el avance, las plantas y los planes de pago.", "formulario"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     AGENT · 12 — EDITORIAL
     El asesor contado como reportaje. Retrato A SANGRE (pegado al borde,
     a toda la altura de la portada), titular editorial y, enseguida, la
     historia como texto largo que SÍ se lee: el primer párrafo grande,
     los demás en columna. Las credenciales van integradas al texto como
     una frase en cursiva —no como una tira de tarjetas— y las zonas como
     una oración. Los inmuebles son piezas de PORTAFOLIO: pocos, numerados,
     foto grande. Para quien vende residencial alto y cuya marca personal
     ES el producto.
     ──────────────────────────────────────────────────────────────── */
  editorial: {
    id: "editorial",
    nombre: "Editorial",
    modo: "AGENT",
    para: "Tú contado como reportaje: retrato a sangre, texto que se lee, inmuebles de portafolio.",
    estructura: "Retrato a sangre · historia en reportaje · credenciales en prosa · zonas en una frase · portafolio numerado · cita",
    acentoSugerido: "arena",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "reportaje",
        fotos: [FOTO_LOGO, FOTO_RETRATO],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Casas que se venden contándolas" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Asesoría residencial de alto nivel. Pocas operaciones al año, cada una acompañada de principio a fin." },
        ],
        copia: copiaPortada("Ver el portafolio", "Escríbeme", "Asesor inmobiliario"),
      },
      {
        id: "sobre-mi",
        variante: "reportaje",
        textos: [
          { campo: "titulo", etiqueta: "Título de la historia", porDefecto: "Cómo trabajo" },
          { campo: "subtitulo", etiqueta: "Bajada de la historia", porDefecto: "" },
        ],
      },
      {
        id: "credenciales",
        variante: "prosa",
        textos: [
          { campo: "titulo", etiqueta: "Título de credenciales", porDefecto: "Acreditaciones" },
          { campo: "subtitulo", etiqueta: "Bajada de credenciales", porDefecto: "" },
        ],
        copia: COPIA_CREDENCIALES,
      },
      {
        id: "zonas",
        variante: "frase",
        textos: [
          { campo: "titulo", etiqueta: "Título de zonas", porDefecto: "Trabajo en" },
          { campo: "subtitulo", etiqueta: "Bajada de zonas", porDefecto: "" },
        ],
      },
      bInmuebles(
        "portafolio",
        "Portafolio",
        "",
        "Selección",
      ),
      {
        id: "testimonios",
        variante: "cita",
        textos: [
          { campo: "titulo", etiqueta: "Título de testimonios", porDefecto: "" },
          { campo: "subtitulo", etiqueta: "Bajada de testimonios", porDefecto: "" },
        ],
      },
      bContacto("Conversemos", "Una llamada corta me basta para saber si puedo ayudarte.", "editorial"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     AGENT · 13 — TARJETA
     Vertical y móvil PRIMERO, no móvil adaptado: está pensada para
     abrirse desde la bio de Instagram. Una columna angosta incluso en
     escritorio (la piel recorta el ancho), foto redonda, nombre, el
     WhatsApp ENORME —es el único botón que importa en un teléfono— y
     los inmuebles en una sola columna que se recorre con el pulgar. Las
     zonas van antes que los inmuebles: "¿trabaja mi colonia?" es lo
     primero que pregunta quien llega desde una historia.
     ──────────────────────────────────────────────────────────────── */
  tarjeta: {
    id: "tarjeta",
    nombre: "Tarjeta",
    modo: "AGENT",
    para: "Para la bio de Instagram: una columna, tu WhatsApp enorme y los inmuebles con el pulgar.",
    estructura: "Tarjeta vertical · zonas · inmuebles en una columna · cita · contacto corto",
    acentoSugerido: "pino",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "tarjeta",
        fotos: [FOTO_LOGO, FOTO_RETRATO],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Te ayudo a encontrar casa" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Asesor inmobiliario. Escríbeme y te mando opciones hoy." },
        ],
        copia: copiaPortada("Ver inmuebles", "Escríbeme por WhatsApp", "Asesor inmobiliario"),
      },
      {
        id: "zonas",
        variante: "pastillas",
        textos: [
          { campo: "titulo", etiqueta: "Título de zonas", porDefecto: "Mis zonas" },
          { campo: "subtitulo", etiqueta: "Bajada de zonas", porDefecto: "" },
        ],
      },
      bInmuebles(
        "columna",
        "Disponibles",
        "",
        "Inmuebles",
      ),
      {
        id: "testimonios",
        variante: "cita",
        textos: [
          { campo: "titulo", etiqueta: "Título de testimonios", porDefecto: "" },
          { campo: "subtitulo", etiqueta: "Bajada de testimonios", porDefecto: "" },
        ],
      },
      bContacto("Contacto", "", "compacto"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     OWNER · 14 — DISPONIBILIDAD
     El gancho "trato directo, sin comisión" va ARRIBA, como cinta pegada
     a la portada, no escondido al final. Después el tablero de lo que
     está libre AHORA como fichas con foto, precio, colonia y desde
     cuándo está en línea; luego los requisitos en columnas, visibles sin
     buscarlos. Cero biografía: el dueño no quiere ser famoso, quiere
     rentar. Se diferencia de "mis-rentas" en que no hay listado
     completo aparte: las fichas SON el listado.
     ──────────────────────────────────────────────────────────────── */
  disponibilidad: {
    id: "disponibilidad",
    nombre: "Disponibilidad",
    modo: "OWNER",
    para: "Lo que está libre ahora, con precio y colonia, y el «sin comisión» arriba.",
    estructura: "Aviso de trato directo · cinta sin comisión · fichas de lo libre · requisitos en columnas",
    acentoSugerido: "pino",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "aviso",
        fotos: [FOTO_LOGO],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "Departamentos en renta, directo con el dueño" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Sin inmobiliaria de por medio: el mes de comisión te lo quedas tú." },
        ],
        copia: [
          ...copiaPortada("Ver lo disponible", "Preguntar por WhatsApp", "Trato directo · sin comisión"),
          { clave: "portada.libre", etiqueta: "Portada · contador (uno)", porDefecto: "disponible ahora", maxLen: 40 },
          { clave: "portada.libres", etiqueta: "Portada · contador (varios)", porDefecto: "disponibles ahora", maxLen: 40 },
        ],
      },
      {
        id: "trato-directo",
        variante: "cinta",
        textos: [
          { campo: "titulo", etiqueta: "Título de trato directo", porDefecto: "Hablas conmigo, no con una inmobiliaria" },
          { campo: "subtitulo", etiqueta: "Bajada de trato directo", porDefecto: "" },
        ],
        copia: copiaTratoDirecto("Escríbeme"),
      },
      {
        id: "disponibilidad-ahora",
        variante: "fichas",
        textos: [
          { campo: "titulo", etiqueta: "Título de disponibilidad", porDefecto: "Libre ahora" },
          { campo: "subtitulo", etiqueta: "Bajada de disponibilidad", porDefecto: "Lo actualizo en cuanto se desocupa algo." },
        ],
        copia: [
          { clave: "disponibilidad.libre", etiqueta: "Disponibilidad · etiqueta de libre", porDefecto: "Libre", maxLen: 24 },
          { clave: "disponibilidad.apartado", etiqueta: "Disponibilidad · etiqueta de apartado", porDefecto: "Apartado", maxLen: 24 },
          { clave: "disponibilidad.rentado", etiqueta: "Disponibilidad · etiqueta de rentado", porDefecto: "Rentado", maxLen: 24 },
          { clave: "disponibilidad.cta", etiqueta: "Disponibilidad · botón", porDefecto: "Ver detalles", maxLen: 30 },
          // "En línea desde" y no "disponible desde": la fecha que existe
          // es la de publicación. Prometer una fecha de disponibilidad que
          // nadie capturó sería mentir en el dato que más importa.
          { clave: "disponibilidad.desde", etiqueta: "Disponibilidad · rótulo de la fecha", porDefecto: "En línea desde", maxLen: 30 },
        ],
      },
      {
        id: "requisitos-para-rentar",
        variante: "columnas",
        textos: [
          { campo: "titulo", etiqueta: "Título de requisitos", porDefecto: "Lo que necesitas para rentar" },
          { campo: "subtitulo", etiqueta: "Bajada de requisitos", porDefecto: "Te lo digo desde ahorita para que no pierdas el viaje." },
        ],
      },
      bContacto("Déjame tus datos", "Te aviso en cuanto se desocupe algo que encaje contigo.", "formulario"),
    ],
  },

  /* ────────────────────────────────────────────────────────────────
     OWNER · 15 — VITRINA
     Para quien tiene POCAS propiedades pero bonitas. Portada a sangre
     con la mejor foto y, enseguida, cada inmueble con su propio espacio:
     foto grande, galería de miniaturas, recorrido virtual si lo tiene,
     precio, colonia, amenidades y su propio botón de WhatsApp. Se navega
     como catálogo, no como lista. El "sin comisión" va como nota después
     de ver las casas (aquí lo que enamora es la casa; el precio sin
     comisión es el remate) y los requisitos en una línea.
     ──────────────────────────────────────────────────────────────── */
  vitrina: {
    id: "vitrina",
    nombre: "Vitrina",
    modo: "OWNER",
    para: "Pocas propiedades y bonitas: cada una con su espacio, sus fotos y su recorrido.",
    estructura: "Portada a sangre · cada inmueble con su galería y recorrido · nota sin comisión · requisitos en línea",
    acentoSugerido: "arena",
    bloques: [
      {
        id: "portada",
        obligatoria: true,
        variante: "vitrina",
        fotos: [FOTO_LOGO, FOTO_PORTADA],
        textos: [
          { campo: "titulo", etiqueta: "Titular de la portada", porDefecto: "En renta, trato directo" },
          { campo: "subtitulo", etiqueta: "Bajada de la portada", porDefecto: "Pocas propiedades, cuidadas una por una. Sin comisión de por medio." },
        ],
        copia: copiaPortada("Ver las propiedades", "Preguntar por WhatsApp", "Trato directo con el dueño"),
      },
      bInmuebles(
        "vitrina",
        "Las propiedades",
        "",
        "Disponibles",
        [{ clave: "inmuebles.whatsapp", etiqueta: "Inmuebles · botón de WhatsApp de cada inmueble", porDefecto: "Preguntar por WhatsApp", maxLen: 40 }],
      ),
      {
        id: "trato-directo",
        variante: "nota",
        textos: [
          { campo: "titulo", etiqueta: "Título de trato directo", porDefecto: "Sin comisión" },
          { campo: "subtitulo", etiqueta: "Bajada de trato directo", porDefecto: "Rentas directo conmigo: el mes de la inmobiliaria te lo ahorras." },
        ],
        copia: copiaTratoDirecto("Escríbeme"),
      },
      {
        id: "requisitos-para-rentar",
        variante: "linea",
        textos: [
          { campo: "titulo", etiqueta: "Título de requisitos", porDefecto: "Requisitos" },
          { campo: "subtitulo", etiqueta: "Bajada de requisitos", porDefecto: "" },
        ],
      },
      bContacto("¿Te interesa alguna?", "Déjame tus datos y coordinamos la visita.", "formulario"),
    ],
  },
};

/** La lista para el selector del editor, en el orden en que se presentan. */
export const REALTY_WEB_MANIFEST_LIST: RealtyWebManifest[] = [
  REALTY_WEB_MANIFESTS.asesor,
  REALTY_WEB_MANIFESTS.minimal,
  REALTY_WEB_MANIFESTS.historia,
  REALTY_WEB_MANIFESTS.editorial,
  REALTY_WEB_MANIFESTS.tarjeta,
  REALTY_WEB_MANIFESTS.clasica,
  REALTY_WEB_MANIFESTS.corporativa,
  REALTY_WEB_MANIFESTS.boutique,
  REALTY_WEB_MANIFESTS.galeria,
  REALTY_WEB_MANIFESTS.torre,
  REALTY_WEB_MANIFESTS["mis-rentas"],
  REALTY_WEB_MANIFESTS["una-propiedad"],
  REALTY_WEB_MANIFESTS.catalogo,
  REALTY_WEB_MANIFESTS.disponibilidad,
  REALTY_WEB_MANIFESTS.vitrina,
];
