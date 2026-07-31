import type { ProductoModule, ProductoSlug } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Contenido de las 8 páginas de producto por módulo.
//
// FUENTE DE VERDAD: los diseños aprobados de Claude Design (variante "B - Viva")
// en C:\Users\Rafael\ClauCode\MediFlow\disenos-modulos\*.dc.html. Los textos,
// las preguntas del FAQ y los datos de ejemplo de los mockups salen de ahí tal
// cual; los colores del acento también.
//
// REGLAS DE NEGOCIO QUE ESTE ARCHIVO YA RESPETA — no romperlas al editar:
//   · Sin cifras de precio en el copy ("Consulta los planes"). Las cifras que
//     viven DENTRO de los mockups son datos de ejemplo de la interfaz y sí se
//     conservan.
//   · El módulo de facturación NO promete timbrado ante el SAT: la primera
//     pregunta del FAQ de /facturacion-dental-cfdi responde "No" a propósito.
//   · La IA asiste, el doctor decide. Nunca "la IA diagnostica".
//   · Sin número de clientes, sin testimonios con nombre, sin "NOM-024
//     certificado", sin Marketplace.
//   · Los slugs de `blog.posts` son artículos REALES (verificados contra
//     https://www.dalecontrol.com/sitemap.xml). Cero enlaces inventados.
// ─────────────────────────────────────────────────────────────────────────────

export const PRODUCTO_SLUGS: ProductoSlug[] = [
  "software-agenda-dental",
  "expediente-clinico-dental",
  "portal-del-paciente-dental",
  "caja-y-cobros-clinica-dental",
  "facturacion-dental-cfdi",
  "radiografias-3d-cbct-dental",
  "reportes-clinica-dental",
  "software-multiclinica-dental",
];

const DARK = "#0f172a";

export const PRODUCTO_MODULES: Record<ProductoSlug, ProductoModule> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // 1 · Agenda y recordatorios — verde
  // ═══════════════════════════════════════════════════════════════════════════
  "software-agenda-dental": {
    slug: "software-agenda-dental",
    name: "Agenda y recordatorios",
    tagline: "Recordatorios y confirmaciones por WhatsApp",
    theme: {
      glowA: "rgba(22,163,74,0.34)",
      glowB: "rgba(37,99,235,0.42)",
      heroBase: `linear-gradient(160deg,#0b1220 0%,${DARK} 58%,#131f38 100%)`,
      glowScene: "rgba(74,222,128,0.30)",
      pillBg: "rgba(34,197,94,0.14)",
      pillBorder: "rgba(74,222,128,0.42)",
      pillText: "#86efac",
      accent: "#4ade80",
      crumb: "#94a3b8",
      band: "linear-gradient(120deg,#1e3a8a 0%,#1d4ed8 55%,#3730a3 100%)",
      stepsBg: "rgba(96,165,250,0.16)",
      stepsBorder: "rgba(147,197,253,0.4)",
      stepsText: "#93c5fd",
      stepsDash: "rgba(147,197,253,0.45)",
      stepNums: ["#2563eb", "#16a34a", "#7c3aed", "#d97706"],
      cta: "linear-gradient(120deg,#1e3a8a 0%,#3730a3 55%,#5b21b6 100%)",
      ctaInk: "#4338ca",
      ctaNote: "#e0e7ff",
      link: "#7c3aed",
      linkBorder: "#c4b5fd",
      faqBg: "#eff6ff",
      faqText: "#1d4ed8",
      faqTone: "violet",
      blogTone: "blue",
    },
    metaTitle: "Software de agenda dental con recordatorios WhatsApp",
    metaDescription:
      "Agenda dental con recordatorios y confirmaciones por WhatsApp: reservas en línea, lista de espera y una vista por doctor, sillón y consultorio.",
    keywords: [
      "software de agenda dental",
      "recordatorios de citas por WhatsApp",
      "confirmación de citas dentales",
      "agenda para clínicas dentales México",
      "reservas en línea dentista",
    ],
    badge: "Módulo de agenda y recordatorios",
    h1a: "Software de agenda dental con ",
    h1accent: "recordatorios por WhatsApp",
    lede:
      "Cada cita se confirma sola por mensaje: el paciente responde con un toque y tu agenda se actualiza. Tú intervienes únicamente cuando algo cambia.",
    heroChecks: ["Conectas el WhatsApp de tu clínica", "Sin instalar nada", "Consulta los planes"],
    heroMock: "agenda-hero",
    benefits: [
      { glyph: "✓", title: "Menos citas perdidas", body: "El paciente recibe su recordatorio y confirma con un toque." },
      { glyph: "◷", title: "Sin llamadas de confirmación", body: "El seguimiento lo hace el sistema; tu recepción atiende a quien ya está ahí." },
      { glyph: "⟳", title: "Huecos que se recuperan", body: "Si alguien cancela, el lugar se ofrece a tu lista de espera." },
      { glyph: "▤", title: "Toda la clínica en una vista", body: "Por día, semana, mes o lista; por doctor, sillón y consultorio." },
    ],
    problem: {
      title: "Lo que pasa cuando la agenda depende de llamadas",
      sub: "Tres cosas que se repiten cada semana en una clínica dental.",
      cards: [
        {
          glyph: "✕", tone: "red",
          title: "Las citas se caen el mismo día",
          body: "Un paciente que nunca confirmó es un sillón vacío, y te enteras cuando ya no hay tiempo de reacomodar a nadie.",
        },
        {
          glyph: "☏", tone: "amber",
          title: "Confirmar por teléfono, una por una",
          body: "La recepción pierde la mañana marcando números y buena parte de los pacientes no contesta.",
        },
        {
          glyph: "◇", tone: "violet",
          title: "El hueco que quedó no lo llena nadie",
          body: "La cancelación llega por mensaje, no a la agenda, y ese espacio se queda sin ocupar.",
        },
      ],
    },
    capabilities: [
      {
        eyebrow: "Vista de agenda", tone: "blue",
        title: "Una agenda que se entiende de un solo golpe",
        body: "Cambia entre día, semana, mes y lista, y filtra por doctor, sillón, consultorio o estado de la cita. Mueve una cita arrastrándola y el paciente recibe el aviso del cambio.",
        bullets: [
          "Colores por tratamiento y por estado de la cita",
          "Filtros por doctor, sillón y consultorio",
          "Aviso de sala de espera cuando alguien lleva rato esperando",
        ],
        mock: "agenda-1",
      },
      {
        eyebrow: "Recordatorios", tone: "green", reverse: true,
        title: "Recordatorios por WhatsApp que el paciente sí lee",
        body: "Salen solos antes de la cita, con la hora, el doctor y la dirección de tu consultorio. El paciente responde con un toque y su respuesta cae directo en la agenda.",
        bullets: [
          "Plantillas editables por tipo de tratamiento",
          "Envío automático el día anterior y unas horas antes",
          "Confirmación o cancelación registrada en la cita",
        ],
        mock: "agenda-2",
      },
      {
        eyebrow: "Reservas en línea", tone: "violet",
        title: "Que agenden solos, también fuera de tu horario",
        body: "Comparte el link de tu clínica y el paciente elige entre los espacios realmente libres. La cita entra a tu agenda con sus datos y su recordatorio ya programado.",
        bullets: [
          "Solo muestra horarios disponibles reales",
          "Cada reserva llega con la ficha del paciente",
          "Puedes revisarla antes de aceptarla",
        ],
        mock: "agenda-3",
      },
      {
        eyebrow: "Cancelaciones", tone: "amber", reverse: true,
        title: "Cuando alguien cancela, el hueco no se pierde",
        body: "El espacio liberado se ofrece a tu lista de espera y el primero que responde se queda con él. Tú ves la agenda actualizada, sin llamar a nadie.",
        bullets: [
          "Lista de espera por tratamiento y por doctor",
          "Aviso automático del hueco liberado",
          "Historial de cancelaciones por paciente",
        ],
        mock: "agenda-4",
      },
    ],
    steps: {
      sub: "El flujo completo de una cita, desde que la agendas hasta que el paciente entra al consultorio.",
      items: [
        { title: "Agendas la cita", body: "Desde el panel o por reserva en línea. Queda con doctor, sillón, tratamiento y duración." },
        { title: "El recordatorio sale solo", body: "Un WhatsApp el día anterior y otro unas horas antes, con la hora y la dirección." },
        { title: "El paciente confirma", body: "Responde con un toque y la cita se marca como confirmada en tu agenda." },
        { title: "Si cancela, se libera", body: "El hueco se ofrece a la lista de espera y otro paciente lo toma." },
      ],
    },
    blog: {
      title: "Para sacarle más provecho a tu agenda",
      posts: [
        {
          slug: "reducir-no-shows-clinica-dental", kicker: "Operación", tone: "blue",
          title: "Cómo reducir los no-shows en tu clínica dental",
          excerpt: "Las causas reales del no-show, el costo por hora de sillón y la cadena de confirmación que sí funciona.",
        },
        {
          slug: "confirmacion-citas-whatsapp", kicker: "Plantillas", tone: "green",
          title: "Confirmación de citas por WhatsApp: guía práctica",
          excerpt: "Cadena de tres mensajes, ejemplos listos para copiar y qué hacer si el paciente no contesta.",
        },
        {
          slug: "lista-espera-pacientes-dental", kicker: "Agenda", tone: "violet",
          title: "Lista de espera dental: cómo implementarla bien",
          excerpt: "Qué registrar de cada paciente, el protocolo de 4 pasos y por qué conviene evitar el sobrecupo.",
        },
      ],
    },
    faq: [
      {
        q: "¿Necesito WhatsApp Business para mandar los recordatorios?",
        a: "Sí: tu clínica conecta su propio número y los mensajes salen a nombre de tu clínica. Te guiamos en la conexión desde el panel, no necesitas instalar nada en tu computadora.",
      },
      {
        q: "¿Puedo cambiar el texto de los recordatorios?",
        a: "Cada plantilla es editable y puedes tener una distinta por tratamiento. El sistema completa la hora, el doctor y la dirección del consultorio para que no tengas que escribirlos.",
      },
      {
        q: "¿Funciona con varios doctores, sillones y sucursales?",
        a: "Sí. Cada doctor tiene su vista y puedes filtrar por sillón o consultorio. Si tienes más de una sucursal, todas viven en la misma cuenta con su propia agenda.",
      },
      {
        q: "¿Este módulo viene incluido en el plan?",
        a: "La agenda con recordatorios por WhatsApp forma parte del módulo base de DaleControl. Consulta los planes para ver los límites y lo que trae cada uno.",
      },
    ],
    cta: {
      title: "Que tu agenda se confirme sola",
      body: "Crea tu cuenta, conecta el WhatsApp de tu clínica y manda tus primeros recordatorios el mismo día.",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 2 · Expediente clínico y odontograma — azul
  // ═══════════════════════════════════════════════════════════════════════════
  "expediente-clinico-dental": {
    slug: "expediente-clinico-dental",
    name: "Expediente clínico y odontograma",
    tagline: "Ficha, odontograma y periodontograma",
    theme: {
      glowA: "rgba(37,99,235,0.42)",
      glowB: "rgba(29,78,216,0.38)",
      heroBase: `linear-gradient(160deg,#0b1220 0%,${DARK} 58%,#101c33 100%)`,
      glowScene: "rgba(96,165,250,0.32)",
      pillBg: "rgba(37,99,235,0.18)",
      pillBorder: "rgba(96,165,250,0.45)",
      pillText: "#93c5fd",
      accent: "#60a5fa",
      crumb: "#94a3b8",
      band: "linear-gradient(120deg,#172554 0%,#1e3a8a 55%,#1d4ed8 100%)",
      stepsBg: "rgba(96,165,250,0.16)",
      stepsBorder: "rgba(147,197,253,0.4)",
      stepsText: "#93c5fd",
      stepsDash: "rgba(147,197,253,0.45)",
      stepNums: ["#2563eb", "#1d4ed8", "#7c3aed", "#0e7490"],
      cta: "linear-gradient(120deg,#172554 0%,#1e3a8a 55%,#1d4ed8 100%)",
      ctaInk: "#1d4ed8",
      ctaNote: "#dbeafe",
      link: "#1d4ed8",
      linkBorder: "#93c5fd",
      faqBg: "#eff6ff",
      faqText: "#1d4ed8",
      faqTone: "blue",
      blogTone: "blue",
    },
    metaTitle: "Expediente clínico dental digital con odontograma",
    metaDescription:
      "Expediente clínico dental digital: odontograma, periodontograma, notas dictadas por voz y tus estudios junto a la ficha. Importa tus pacientes desde Excel.",
    keywords: [
      "expediente clínico dental digital",
      "odontograma digital",
      "periodontograma",
      "historia clínica odontológica",
      "software expediente dental México",
    ],
    badge: "Módulo de expediente clínico",
    h1a: "Expediente clínico dental digital con ",
    h1accent: "odontograma diente por diente",
    lede:
      "Toda la historia de tu paciente en un solo lugar: odontograma, periodontograma, notas de evolución y estudios. Dictas la nota por voz y sigues atendiendo.",
    heroChecks: ["Dictado por voz", "Importa pacientes desde Excel", "Consulta los planes"],
    heroMock: "expediente-hero",
    benefits: [
      { glyph: "▤", title: "Toda la historia en un lugar", body: "Tratamientos, notas, estudios y presupuestos en la misma ficha." },
      { glyph: "◇", title: "Odontograma visual", body: "Marcas cada diente con un clic y se registra en el historial." },
      { glyph: "◉", title: "Notas sin teclear", body: "Dictas por voz mientras terminas de atender al paciente." },
      { glyph: "✓", title: "Acceso con control", body: "Roles, permisos y 2FA: cada quien ve lo que le toca." },
    ],
    problem: {
      title: "Cuando el expediente vive en papel y en varias computadoras",
      sub: "Tres cosas que se repiten cada semana en una clínica dental.",
      cards: [
        {
          glyph: "✕", tone: "red",
          title: "El historial está en una carpeta de papel",
          body: "Para saber qué se le hizo al paciente hay que buscar el folder, y si no aparece se empieza de cero.",
        },
        {
          glyph: "◷", tone: "amber",
          title: "Las notas se escriben mucho después",
          body: "Entre paciente y paciente no hay tiempo de teclear, y al final del día ya no recuerdas los detalles.",
        },
        {
          glyph: "◇", tone: "violet",
          title: "Los estudios están en otra computadora",
          body: "La radiografía está en la máquina del consultorio y el presupuesto en el correo de recepción.",
        },
      ],
    },
    capabilities: [
      {
        eyebrow: "Odontograma", tone: "blue",
        title: "Odontograma y periodontograma que se llenan con clics",
        body: "Marca cada diente y cada cara: lo tratado, lo que falta y lo que hay que vigilar. El periodontograma registra la revisión de encías visita por visita.",
        bullets: [
          "Estado por diente y por cara, con colores claros",
          "Periodontograma con el registro de cada revisión",
          "Lo que marcas queda ligado al historial del paciente",
        ],
        mock: "expediente-1",
      },
      {
        eyebrow: "Dictado por voz", tone: "violet", reverse: true,
        title: "Dicta la nota de evolución y sigue atendiendo",
        body: "Hablas, el sistema escribe y tú revisas antes de guardar. La nota queda fechada, firmada por quien la escribió y ligada al tratamiento del día.",
        bullets: [
          "Dictado por voz en español",
          "Revisas y corriges antes de guardar",
          "Cada nota queda con fecha y autor",
        ],
        mock: "expediente-2",
      },
      {
        eyebrow: "Estudios y archivos", tone: "cyan",
        title: "Radiografías, estudios 3D y documentos junto a la ficha",
        body: "Todo lo del paciente cuelga de su expediente: radiografías, estudios CBCT, presupuestos y consentimientos. Se abren desde el navegador, sin buscar en otra computadora.",
        bullets: [
          "Radiografías y estudios 3D en el visor del navegador",
          "Presupuestos y consentimientos en el mismo lugar",
          "Historial ordenado por fecha de cada visita",
        ],
        mock: "expediente-3",
      },
      {
        eyebrow: "Importación", tone: "green", reverse: true,
        title: "Trae tus pacientes desde Excel y empieza con tu historia",
        body: "Subes tu archivo, revisas cómo se acomodan las columnas y confirmas. Tus pacientes quedan con su ficha lista para seguir registrando desde hoy.",
        bullets: [
          "Revisas la relación de columnas antes de importar",
          "Detecta registros repetidos para que no dupliques",
          "Tus datos quedan cifrados y con respaldos",
        ],
        mock: "expediente-4",
      },
    ],
    steps: {
      sub: "Una consulta completa, desde que abres la ficha hasta que la nota queda guardada.",
      items: [
        { title: "Abres la ficha del paciente", body: "Desde la agenda del día ves su historial, sus estudios y su saldo." },
        { title: "Marcas en el odontograma", body: "Registras lo que encontraste y lo que vas a tratar, diente por diente." },
        { title: "Dictas la nota", body: "Hablas, revisas el texto y lo guardas con tu usuario y la fecha." },
        { title: "Todo queda en su historial", body: "La siguiente visita empieza con el contexto completo a la vista." },
      ],
    },
    blog: {
      title: "Para llevar mejor tu expediente",
      posts: [
        {
          slug: "expediente-clinico-electronico-dental", kicker: "Expediente", tone: "blue",
          title: "Expediente clínico electrónico dental: guía 2026",
          excerpt: "Qué debe contener según la NOM-004, cómo conservarlo y cómo digitalizar tus archivos en papel.",
        },
        {
          slug: "gestion-especialidades-dentales", kicker: "Especialidades", tone: "violet",
          title: "Gestión por especialidad dental: qué cambia en tu clínica",
          excerpt: "Qué cambia en agenda, cobros y expediente según la especialidad, con reglas concretas.",
        },
        {
          slug: "migrar-excel-software-dental", kicker: "Migración", tone: "green",
          title: "Migrar de Excel a un software dental sin perder datos",
          excerpt: "Cómo depurar tus datos, armar la plantilla de importación y evitar los errores más comunes.",
        },
      ],
    },
    faq: [
      {
        q: "¿Puedo pasar mis pacientes desde Excel?",
        a: "Sí. Subes tu archivo, revisas cómo se acomodan las columnas y confirmas. Puedes importar por etapas y revisamos los registros repetidos antes de crear las fichas.",
      },
      {
        q: "¿El odontograma incluye periodontograma?",
        a: "Sí. El expediente incluye odontograma y periodontograma, y cada revisión queda guardada con su fecha para que puedas comparar la evolución.",
      },
      {
        q: "¿Puedo dictar las notas en lugar de escribirlas?",
        a: "Sí, con el dictado por voz. El sistema escribe lo que dictas y tú revisas y corriges antes de guardar; la nota queda firmada con tu usuario.",
      },
      {
        q: "¿Quién puede ver el expediente de un paciente?",
        a: "Tú decides con roles y permisos: defines qué ve cada puesto y puedes activar verificación en dos pasos (2FA) para las cuentas de tu equipo.",
      },
    ],
    cta: {
      title: "Pon el historial de tu clínica en orden",
      body: "Crea tu cuenta, importa tus pacientes y abre el primer expediente digital hoy mismo.",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 3 · Portal del paciente — violeta
  // ═══════════════════════════════════════════════════════════════════════════
  "portal-del-paciente-dental": {
    slug: "portal-del-paciente-dental",
    name: "Portal del paciente",
    tagline: "Sus citas, presupuestos y estado de cuenta",
    theme: {
      glowA: "rgba(124,58,237,0.45)",
      glowB: "rgba(79,70,229,0.36)",
      heroBase: "linear-gradient(160deg,#0b1220 0%,#120f2a 58%,#160f33 100%)",
      glowScene: "rgba(167,139,250,0.34)",
      pillBg: "rgba(124,58,237,0.22)",
      pillBorder: "rgba(167,139,250,0.5)",
      pillText: "#c4b5fd",
      accent: "#a78bfa",
      crumb: "#c7d2fe",
      band: "linear-gradient(120deg,#3b0764 0%,#4c1d95 55%,#6d28d9 100%)",
      stepsBg: "rgba(167,139,250,0.18)",
      stepsBorder: "rgba(196,181,253,0.42)",
      stepsText: "#c4b5fd",
      stepsDash: "rgba(196,181,253,0.45)",
      stepNums: ["#7c3aed", "#6d28d9", "#2563eb", "#15803d"],
      cta: "linear-gradient(120deg,#3b0764 0%,#4c1d95 55%,#6d28d9 100%)",
      ctaInk: "#6d28d9",
      ctaNote: "#ede9fe",
      link: "#6d28d9",
      linkBorder: "#c4b5fd",
      faqBg: "#f5f3ff",
      faqText: "#6d28d9",
      faqTone: "violet",
      blogTone: "violet",
    },
    metaTitle: "Portal del paciente dental: citas, planes y saldo",
    metaDescription:
      "Portal del paciente dental: confirma su cita, revisa y firma su presupuesto y consulta su estado de cuenta desde el celular, sin descargar ninguna app.",
    keywords: [
      "portal del paciente dental",
      "presupuesto dental en línea",
      "consentimiento informado digital",
      "estado de cuenta del paciente",
      "encuestas post-cita dental",
    ],
    badge: "Módulo del portal del paciente",
    h1a: "Portal del paciente dental: ",
    h1accent: "sus citas, presupuestos y saldo",
    h1b: " en su celular",
    lede:
      "Cada paciente entra desde su teléfono, confirma su cita, revisa su presupuesto y firma su consentimiento. Recepción deja de contestar lo mismo todo el día.",
    heroChecks: ["Sin app que descargar", "Encuestas post-cita", "Consulta los planes"],
    heroMock: "portal-hero",
    benefits: [
      { glyph: "◷", title: "Menos llamadas a recepción", body: "El paciente consulta su cita y su saldo sin marcarte." },
      { glyph: "✓", title: "Presupuestos que avanzan", body: "Los revisa con calma, los acepta y los firma desde su teléfono." },
      { glyph: "✎", title: "Consentimientos sin papel", body: "Se firman en línea y quedan guardados en su expediente." },
      { glyph: "★", title: "Encuestas post-cita", body: "Sabes cómo se sintió la visita sin perseguir a nadie." },
    ],
    problem: {
      title: "Todo lo administrativo termina en el teléfono de recepción",
      sub: "Tres cosas que se repiten cada semana en una clínica dental.",
      cards: [
        {
          glyph: "☏", tone: "amber",
          title: "Las mismas tres preguntas todo el día",
          body: "«¿A qué hora era mi cita?», «¿cuánto debo?», «¿me mandas mi presupuesto?» — una por una, por teléfono.",
        },
        {
          glyph: "✕", tone: "red",
          title: "El presupuesto se queda en el aire",
          body: "Se entrega impreso, el paciente lo va a pensar y después nadie le da seguimiento.",
        },
        {
          glyph: "◇", tone: "violet",
          title: "Los consentimientos se pierden",
          body: "Se firman en la sala de espera y cuando los necesitas hay que buscar entre papeles.",
        },
      ],
    },
    capabilities: [
      {
        eyebrow: "Su cuenta", tone: "violet",
        title: "Su cita, su recordatorio y su historial, a la mano",
        body: "El acceso le llega con su recordatorio por WhatsApp y entra desde el navegador de su celular. Desde ahí confirma, pide reagendar y ve sus visitas anteriores.",
        bullets: [
          "Sin app: entra desde su navegador",
          "Confirma o pide reagendar sin llamar",
          "Ve sus visitas y los documentos que compartes",
        ],
        mock: "portal-1",
      },
      {
        eyebrow: "Presupuestos", tone: "blue", reverse: true,
        title: "Presupuestos que revisa, acepta y firma en línea",
        body: "Le compartes el plan de tratamiento por etapas y él lo revisa en casa. Cuando acepta, tú lo ves en el panel y la firma queda en su expediente.",
        bullets: [
          "Plan por etapas, explicado en su idioma",
          "Acepta y firma desde el celular",
          "Tú ves el estado de cada presupuesto en el panel",
        ],
        mock: "portal-2",
      },
      {
        eyebrow: "Estado de cuenta", tone: "green",
        title: "Su saldo, claro, sin llamar a recepción",
        body: "Ve qué ya pagó, qué queda pendiente y el recibo de cada pago. Las conversaciones de dinero empiezan con la misma información de los dos lados.",
        bullets: [
          "Pagos y pendientes por tratamiento",
          "Recibo de cada pago registrado en caja",
          "Puede solicitar su factura desde ahí",
        ],
        mock: "portal-3",
      },
      {
        eyebrow: "Encuestas post-cita", tone: "amber", reverse: true,
        title: "Pregunta cómo fue la visita, justo cuando terminó",
        body: "Después de la cita, el paciente recibe una encuesta corta en su portal. Sus respuestas quedan junto a su expediente para que tu equipo sepa qué mejorar.",
        bullets: [
          "Encuesta corta, enviada al terminar la cita",
          "Respuestas ligadas al paciente y al doctor",
          "Puedes revisarlas en tus reportes",
        ],
        mock: "portal-4",
      },
    ],
    steps: {
      sub: "Lo que hace el paciente desde que recibe su acceso hasta que firma su plan.",
      items: [
        { title: "Recibe su acceso", body: "Le llega con su recordatorio por WhatsApp; entra sin descargar nada." },
        { title: "Confirma su cita", body: "Desde el portal confirma o pide otra fecha, y tu agenda se actualiza." },
        { title: "Revisa y acepta su plan", body: "Lee el presupuesto por etapas, lo acepta y firma su consentimiento." },
        { title: "Todo cae en su expediente", body: "Lo que acepta y firma queda en su ficha, y su saldo se actualiza." },
      ],
    },
    blog: {
      title: "Para que tus pacientes se involucren",
      posts: [
        {
          slug: "experiencia-paciente-dental", kicker: "Experiencia", tone: "violet",
          title: "Experiencia del paciente dental: guía para fidelizar",
          excerpt: "Primer contacto, sala de espera, costos claros, seguimiento a 24 horas y encuestas para fidelizar.",
        },
        {
          slug: "primera-visita-paciente-dental", kicker: "Presupuestos", tone: "blue",
          title: "Primera visita dental: protocolo para convertir",
          excerpt: "Antes de la cita, los primeros segundos, la escucha en el sillón y el cierre con plan y cita agendada.",
        },
        {
          slug: "reactivacion-pacientes-inactivos", kicker: "Recall", tone: "amber",
          title: "Reactivación de pacientes inactivos: guía de recall",
          excerpt: "Cómo segmentar tu lista, mensajes personales de ejemplo y cómo medir resultados reales.",
        },
      ],
    },
    faq: [
      {
        q: "¿Mi paciente tiene que descargar una app?",
        a: "No. Entra desde el navegador de su celular con el link de tu clínica, que puede viajar junto con sus recordatorios por WhatsApp.",
      },
      {
        q: "¿Puede aceptar y firmar presupuestos desde ahí?",
        a: "Sí. Revisa el plan por etapas, lo acepta y firma su consentimiento en línea. La aceptación y la firma quedan guardadas en su expediente.",
      },
      {
        q: "¿El paciente ve todo su expediente clínico?",
        a: "Ve lo que tú decides compartir: sus citas, sus presupuestos, su estado de cuenta y los documentos que le publicas. Las notas clínicas se quedan del lado de la clínica, con roles y permisos.",
      },
      {
        q: "¿Está incluido en el plan?",
        a: "El portal del paciente es parte de DaleControl. Consulta los planes para ver los límites y lo que trae cada uno.",
      },
    ],
    cta: {
      title: "Dale a tus pacientes su propia cuenta",
      body: "Crea tu cuenta, activa el portal y comparte el acceso con tu siguiente paciente hoy mismo.",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 4 · Caja y cobros — esmeralda
  // ═══════════════════════════════════════════════════════════════════════════
  "caja-y-cobros-clinica-dental": {
    slug: "caja-y-cobros-clinica-dental",
    name: "Caja y cobros",
    tagline: "Caja con PIN, métodos de pago y corte diario",
    theme: {
      glowA: "rgba(5,150,105,0.42)",
      glowB: "rgba(13,148,136,0.32)",
      heroBase: "linear-gradient(160deg,#0b1220 0%,#0c1b1c 58%,#0b2225 100%)",
      glowScene: "rgba(52,211,153,0.32)",
      pillBg: "rgba(5,150,105,0.22)",
      pillBorder: "rgba(52,211,153,0.45)",
      pillText: "#6ee7b7",
      accent: "#34d399",
      crumb: "#a7f3d0",
      band: "linear-gradient(120deg,#064e3b 0%,#065f46 55%,#047857 100%)",
      stepsBg: "rgba(52,211,153,0.18)",
      stepsBorder: "rgba(110,231,183,0.42)",
      stepsText: "#6ee7b7",
      stepsDash: "rgba(110,231,183,0.45)",
      stepNums: ["#047857", "#059669", "#2563eb", "#b45309"],
      cta: "linear-gradient(120deg,#022c22 0%,#064e3b 55%,#047857 100%)",
      ctaInk: "#047857",
      ctaNote: "#d1fae5",
      link: "#047857",
      linkBorder: "#6ee7b7",
      faqBg: "#ecfdf5",
      faqText: "#047857",
      faqTone: "emerald",
      blogTone: "emerald",
    },
    metaTitle: "Control de caja para clínica dental con corte diario",
    metaDescription:
      "Control de caja para tu consultorio dental: cobros ligados al paciente, caja protegida con PIN, corte diario que cuadra y saldos pendientes a la vista.",
    keywords: [
      "control de caja clínica dental",
      "corte de caja diario dentista",
      "cobros consultorio dental",
      "saldos pendientes pacientes",
      "caja con PIN clínica",
    ],
    badge: "Módulo de caja y cobros",
    h1a: "Control de caja para tu consultorio dental, con ",
    h1accent: "corte diario que cuadra",
    lede:
      "Cobras en el mostrador, registras el método de pago y cierras el día con un corte que cuadra. Cada movimiento queda ligado al paciente y a su tratamiento.",
    heroChecks: ["Caja protegida con PIN", "Corte diario", "Consulta los planes"],
    heroMock: "caja-hero",
    benefits: [
      { glyph: "$", title: "Cada cobro con su paciente", body: "El movimiento queda ligado al tratamiento y a quien lo cobró." },
      { glyph: "✦", title: "Caja protegida con PIN", body: "Cada quien abre su sesión con su clave, sin cuentas compartidas." },
      { glyph: "✓", title: "Corte diario que cuadra", body: "Comparas lo esperado con lo contado y cierras el día tranquilo." },
      { glyph: "▤", title: "Saldos siempre al día", body: "Lo pendiente se ve en la ficha del paciente y en su portal." },
    ],
    problem: {
      title: "Cuando el dinero del día vive en una libreta",
      sub: "Tres cosas que se repiten cada semana en una clínica dental.",
      cards: [
        {
          glyph: "✕", tone: "red",
          title: "Los cobros se anotan a mano",
          body: "La libreta se queda corta: no dice qué tratamiento fue, quién cobró ni si quedó saldo pendiente.",
        },
        {
          glyph: "◷", tone: "amber",
          title: "El corte no cuadra al cerrar",
          body: "Falta o sobra dinero y hay que reconstruir el día de memoria, ticket por ticket.",
        },
        {
          glyph: "◇", tone: "teal",
          title: "Los saldos se olvidan",
          body: "El paciente abonó una parte, nadie lo registró y el pendiente aparece meses después.",
        },
      ],
    },
    capabilities: [
      {
        eyebrow: "Cobros", tone: "emerald",
        title: "Cobras en el mostrador y queda ligado al tratamiento",
        body: "Eliges al paciente, el tratamiento y el método de pago. Si paga una parte, el resto queda como saldo pendiente y se ve en su ficha y en su portal.",
        bullets: [
          "Efectivo, tarjeta o transferencia, incluso combinados",
          "Pagos parciales con saldo pendiente",
          "Cada movimiento guarda quién lo registró",
        ],
        mock: "caja-1",
      },
      {
        eyebrow: "Caja con PIN", tone: "blue", reverse: true,
        title: "Cada quien abre la caja con su propia clave",
        body: "La caja se abre con un PIN por persona, así que sabes quién estuvo a cargo en cada turno y quién registró cada movimiento del día.",
        bullets: [
          "Sesión de caja por usuario y por turno",
          "Roles y permisos: defines quién puede cobrar",
          "Verificación en dos pasos (2FA) para tu equipo",
        ],
        mock: "caja-2",
      },
      {
        eyebrow: "Corte diario", tone: "amber",
        title: "Cierra el día comparando lo esperado con lo contado",
        body: "El corte suma los movimientos por método de pago y tú capturas lo que hay en la caja. Si hay diferencia, la ves al momento y con el detalle de los movimientos.",
        bullets: [
          "Totales por efectivo, tarjeta y transferencia",
          "Diferencia visible antes de cerrar",
          "El corte queda guardado con la firma de quien lo cerró",
        ],
        mock: "caja-3",
      },
      {
        eyebrow: "Saldos", tone: "violet", reverse: true,
        title: "Los pendientes se ven antes de que el paciente llegue",
        body: "La lista de saldos te dice quién debe qué y desde cuándo. Como está ligada a la agenda, recepción lo ve en cuanto el paciente aparece en el día.",
        bullets: [
          "Saldo por paciente y por tratamiento",
          "Aviso en la ficha cuando tiene cita agendada",
          "El paciente ve lo mismo en su portal",
        ],
        mock: "caja-4",
      },
    ],
    steps: {
      sub: "Un día de caja completo, desde el primer cobro hasta el cierre.",
      items: [
        { title: "Abres la caja con tu PIN", body: "Queda registrado quién está a cargo del turno." },
        { title: "Cobras y eliges el método", body: "El movimiento se liga al paciente y a su tratamiento." },
        { title: "El saldo se actualiza solo", body: "En la ficha del paciente y en su portal, sin capturar dos veces." },
        { title: "Cierras con el corte del día", body: "Comparas lo contado con lo esperado y guardas el corte." },
      ],
    },
    blog: {
      title: "Para ordenar el dinero de tu clínica",
      posts: [
        {
          slug: "corte-caja-diario-clinica-dental", kicker: "Caja", tone: "emerald",
          title: "Corte de caja diario en tu clínica dental",
          excerpt: "Protocolo de 5 pasos: fondo fijo, arqueo, conciliación con la agenda y permisos por rol.",
        },
        {
          slug: "seguimiento-presupuestos-pendientes-dental", kicker: "Cobranza", tone: "blue",
          title: "Seguimiento de presupuestos pendientes dental",
          excerpt: "Cuándo y cómo dar seguimiento, qué tono usar y cuándo aceptar que un paciente dijo que no.",
        },
        {
          slug: "financiamiento-dental-pacientes-mexico", kicker: "Finanzas", tone: "amber",
          title: "Financiamiento dental: opciones para pacientes",
          excerpt: "Pago por fases, meses sin intereses, financieras de salud y crédito interno estructurado.",
        },
      ],
    },
    faq: [
      {
        q: "¿Puedo tener una caja por consultorio o por sucursal?",
        a: "Sí. Si tienes varias sedes, cada una lleva su caja y su corte, y todas viven en la misma cuenta con el módulo de multi-sede.",
      },
      {
        q: "¿Cada persona tiene su propio PIN?",
        a: "Sí. La caja se abre con el PIN de cada usuario y los permisos definen quién puede cobrar, quién solo consulta y quién puede cerrar el corte.",
      },
      {
        q: "¿El paciente ve sus pagos?",
        a: "Sí. Lo que registras en caja se refleja en su estado de cuenta dentro del portal del paciente, con lo pagado y lo pendiente.",
      },
      {
        q: "¿Este módulo viene incluido en el plan?",
        a: "La caja con PIN y el corte diario son parte de DaleControl. Consulta los planes para ver los límites y lo que trae cada uno.",
      },
    ],
    cta: {
      title: "Cierra tu próximo día con la caja cuadrada",
      body: "Crea tu cuenta, abre tu primera caja con PIN y haz tu corte hoy mismo.",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 5 · Facturación — índigo
  // ═══════════════════════════════════════════════════════════════════════════
  "facturacion-dental-cfdi": {
    slug: "facturacion-dental-cfdi",
    name: "Facturación",
    tagline: "Facturas ligadas al tratamiento y al paciente",
    theme: {
      glowA: "rgba(79,70,229,0.45)",
      glowB: "rgba(67,56,202,0.34)",
      heroBase: "linear-gradient(160deg,#0b1220 0%,#101132 58%,#141642 100%)",
      glowScene: "rgba(129,140,248,0.34)",
      pillBg: "rgba(79,70,229,0.24)",
      pillBorder: "rgba(129,140,248,0.5)",
      pillText: "#c7d2fe",
      accent: "#a5b4fc",
      crumb: "#c7d2fe",
      band: "linear-gradient(120deg,#1e1b4b 0%,#312e81 55%,#4338ca 100%)",
      stepsBg: "rgba(129,140,248,0.18)",
      stepsBorder: "rgba(165,180,252,0.42)",
      stepsText: "#c7d2fe",
      stepsDash: "rgba(165,180,252,0.45)",
      stepNums: ["#047857", "#4338ca", "#4f46e5", "#b45309"],
      cta: "linear-gradient(120deg,#1e1b4b 0%,#312e81 55%,#4338ca 100%)",
      ctaInk: "#4338ca",
      ctaNote: "#e0e7ff",
      link: "#4338ca",
      linkBorder: "#c7d2fe",
      faqBg: "#eef2ff",
      faqText: "#4338ca",
      faqTone: "indigo",
      blogTone: "indigo",
    },
    metaTitle: "Facturación dental: CFDI ligado al tratamiento",
    metaDescription:
      "Módulo de facturación dental: prepara el CFDI con los datos fiscales del paciente y el detalle del cobro. El timbrado corre por el proveedor de tu clínica.",
    keywords: [
      "facturación dental",
      "CFDI clínica dental",
      "datos fiscales del paciente",
      "solicitudes de factura dentista",
      "facturación consultorio dental México",
    ],
    badge: "Módulo de facturación",
    h1a: "Facturación dental: el ",
    h1accent: "CFDI ligado al tratamiento",
    h1b: " y al paciente",
    lede:
      "Prepara la factura desde el cobro, con los datos fiscales de tu paciente y el detalle de lo que se le hizo. El timbrado lo haces con el proveedor y el proceso que ya usa tu clínica.",
    heroChecks: ["Datos fiscales por paciente", "Solicitudes desde el portal", "Consulta los planes"],
    heroMock: "facturacion-hero",
    benefits: [
      { glyph: "▤", title: "Datos fiscales guardados", body: "Se capturan una vez y quedan en la ficha del paciente." },
      { glyph: "◇", title: "Cada factura con su tratamiento", body: "El detalle viene del cobro registrado en caja, sin recapturar." },
      { glyph: "◷", title: "Solicitudes en un solo lugar", body: "El paciente la pide desde su portal y tú la ves en el panel." },
      { glyph: "✓", title: "Historial ordenado", body: "Sabes qué se facturó, a quién y en qué periodo." },
    ],
    problem: {
      title: "Cuando facturar significa empezar de cero cada vez",
      sub: "Tres cosas que se repiten cada semana en una clínica dental.",
      cards: [
        {
          glyph: "☏", tone: "amber",
          title: "Los datos fiscales se piden a la carrera",
          body: "El paciente ya se fue, hay que escribirle, y el RFC llega mal escrito en un mensaje.",
        },
        {
          glyph: "◇", tone: "indigo",
          title: "La factura se arma aparte",
          body: "Se recaptura el concepto, el importe y la forma de pago en otro lado, con el riesgo de que no coincida con la caja.",
        },
        {
          glyph: "✕", tone: "red",
          title: "Nadie sabe qué quedó pendiente",
          body: "Al cierre del mes hay que revisar mensajes y correos para saber qué solicitudes de factura faltaron.",
        },
      ],
    },
    capabilities: [
      {
        eyebrow: "Desde el cobro", tone: "indigo",
        title: "Prepara la factura con el detalle que ya registró la caja",
        body: "El concepto, el importe y la forma de pago vienen del cobro. Tú revisas, ajustas lo que falte y la dejas lista para timbrarla con tu proveedor.",
        bullets: [
          "Conceptos tomados del tratamiento cobrado",
          "Uso de CFDI y forma de pago a la vista",
          "El timbrado corre por tu proveedor y tu proceso",
        ],
        mock: "facturacion-1",
      },
      {
        eyebrow: "Datos fiscales", tone: "blue", reverse: true,
        title: "Los datos del paciente se capturan una sola vez",
        body: "RFC, razón social, régimen, uso de CFDI y correo viven en su ficha. La próxima vez que pida factura, ya está todo capturado y tú solo confirmas.",
        bullets: [
          "Datos guardados en la ficha del paciente",
          "El paciente puede actualizarlos desde su portal",
          "Tú los revisas antes de usarlos",
        ],
        mock: "facturacion-2",
      },
      {
        eyebrow: "Solicitudes", tone: "emerald",
        title: "Las solicitudes llegan desde el portal, no por mensaje",
        body: "El paciente pide su factura desde su cuenta y la solicitud entra a una lista con su pago ya identificado. Nada se queda perdido entre chats y correos.",
        bullets: [
          "Cada solicitud trae el pago que la origina",
          "Estados claros: pendiente, preparada, entregada",
          "Puedes filtrar por periodo antes del cierre de mes",
        ],
        mock: "facturacion-3",
      },
      {
        eyebrow: "Historial", tone: "amber", reverse: true,
        title: "Qué se facturó, a quién y en qué periodo",
        body: "El historial se ordena por mes y por paciente, con el estado de cada documento. Cuando llega el cierre, ya sabes qué falta sin buscar en el chat.",
        bullets: [
          "Vista por periodo y por paciente",
          "Cada documento queda en el expediente",
          "Se conecta con tus reportes de ingresos",
        ],
        mock: "facturacion-4",
      },
    ],
    steps: {
      sub: "Del cobro en el mostrador a la factura lista para tu proceso de timbrado.",
      items: [
        { title: "Se registra el cobro", body: "En caja queda el tratamiento, el importe y la forma de pago." },
        { title: "El paciente pide su factura", body: "Desde su portal, con sus datos fiscales ya capturados." },
        { title: "Preparas el documento", body: "Revisas conceptos y datos; queda lista para timbrarla con tu proveedor." },
        { title: "Queda en el historial", body: "En el expediente del paciente y en tu registro del periodo." },
      ],
    },
    blog: {
      title: "Para que facturar deje de ser un pendiente",
      posts: [
        {
          slug: "facturacion-dentistas-mexico-cfdi", kicker: "CFDI", tone: "indigo",
          title: "Facturación para dentistas en México: guía CFDI 4.0",
          excerpt: "Regímenes fiscales, uso de CFDI, complemento de pago y errores que causan multas.",
        },
        {
          slug: "finanzas-clinica-dental-guia", kicker: "Finanzas", tone: "blue",
          title: "Finanzas para clínicas dentales: control y rentabilidad",
          excerpt: "Punto de equilibrio, precios rentables, corte de caja e indicadores clave para decidir.",
        },
        {
          slug: "normativas-clinicas-dentales-mexico", kicker: "Normativas", tone: "amber",
          title: "Normativas para clínicas dentales en México: guía 2026",
          excerpt: "NOM-004, COFEPRIS, privacidad, RPBI y consentimiento informado, en formato checklist.",
        },
      ],
    },
    faq: [
      {
        q: "¿DaleControl timbra mis facturas ante el SAT?",
        a: "No. El módulo prepara y organiza tus facturas: reúne los datos fiscales del paciente y el detalle de lo cobrado. El timbrado lo realizas con el proveedor y el proceso que ya usa tu clínica.",
      },
      {
        q: "¿Puedo guardar los datos fiscales de cada paciente?",
        a: "Sí. RFC, razón social, régimen, uso de CFDI y correo quedan en su ficha, y el paciente puede actualizarlos desde su portal para que tú solo los confirmes.",
      },
      {
        q: "¿El paciente puede solicitar su factura desde el portal?",
        a: "Sí. La solicitud entra a tu lista con el pago que la origina, así que no tienes que buscar en mensajes ni correos para saber a qué cobro corresponde.",
      },
      {
        q: "¿Este módulo viene incluido en el plan?",
        a: "El módulo de facturación es parte de DaleControl. Consulta los planes para ver los límites y lo que trae cada uno.",
      },
    ],
    cta: {
      title: "Que facturar no te robe el cierre de mes",
      body: "Crea tu cuenta, guarda los datos fiscales de tus pacientes y prepara tu primera factura desde el cobro.",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 6 · Radiografías y estudios 3D — cian
  // ═══════════════════════════════════════════════════════════════════════════
  "radiografias-3d-cbct-dental": {
    slug: "radiografias-3d-cbct-dental",
    name: "Radiografías y estudios 3D",
    tagline: "Visor CBCT con IA asistiva",
    theme: {
      glowA: "rgba(8,145,178,0.45)",
      glowB: "rgba(14,116,144,0.34)",
      heroBase: "linear-gradient(160deg,#0b1220 0%,#08202a 58%,#062a34 100%)",
      glowScene: "rgba(34,211,238,0.32)",
      pillBg: "rgba(8,145,178,0.24)",
      pillBorder: "rgba(34,211,238,0.45)",
      pillText: "#67e8f9",
      accent: "#22d3ee",
      crumb: "#a5f3fc",
      band: "linear-gradient(120deg,#083344 0%,#155e75 55%,#0e7490 100%)",
      stepsBg: "rgba(34,211,238,0.18)",
      stepsBorder: "rgba(103,232,249,0.42)",
      stepsText: "#a5f3fc",
      stepsDash: "rgba(103,232,249,0.45)",
      stepNums: ["#0e7490", "#0891b2", "#2563eb", "#15803d"],
      cta: "linear-gradient(120deg,#083344 0%,#155e75 55%,#0e7490 100%)",
      ctaInk: "#0e7490",
      ctaNote: "#cffafe",
      link: "#0e7490",
      linkBorder: "#a5f3fc",
      faqBg: "#ecfeff",
      faqText: "#0e7490",
      faqTone: "cyan",
      blogTone: "cyan",
    },
    metaTitle: "Visor CBCT dental con IA asistiva en el navegador",
    metaDescription:
      "Visor de radiografías y estudios CBCT 3D en el navegador, sin instalar nada. La IA marca zonas sugeridas para revisar; el diagnóstico lo decide el doctor.",
    keywords: [
      "visor CBCT dental",
      "radiografías dentales en la nube",
      "IA en radiografías dentales",
      "estudios 3D odontología",
      "visor DICOM navegador",
    ],
    badge: "Módulo de radiografías y estudios 3D",
    h1a: "Visor CBCT dental ",
    h1accent: "con apoyo de IA",
    h1b: ", desde tu navegador",
    lede:
      "Abre radiografías y estudios 3D sin instalar programas. La IA marca zonas sugeridas para revisar; la lectura y el diagnóstico los decides tú.",
    heroChecks: ["Sin instalar visores", "La IA asiste, el doctor decide", "Consulta los planes"],
    heroMock: "radiografias-hero",
    benefits: [
      { glyph: "◉", title: "Se abre en el navegador", body: "Sin instalar visores en cada computadora del consultorio." },
      { glyph: "◇", title: "Apoyo de IA en la revisión", body: "Marca zonas sugeridas; la decisión clínica siempre es tuya." },
      { glyph: "▤", title: "Junto al expediente", body: "Cada estudio queda en la ficha del paciente, con su fecha." },
      { glyph: "✓", title: "Fácil de explicar", body: "Muestras el estudio en pantalla y lo compartes en su portal." },
    ],
    problem: {
      title: "Cuando ver un estudio depende de una sola computadora",
      sub: "Tres cosas que se repiten cada semana en una clínica dental.",
      cards: [
        {
          glyph: "◇", tone: "cyan",
          title: "El visor está en una sola máquina",
          body: "Para revisar un estudio hay que ir a ese consultorio, o pasarlo en una memoria.",
        },
        {
          glyph: "◷", tone: "amber",
          title: "Los estudios se pierden del expediente",
          body: "Quedan en carpetas sueltas y cuesta saber cuál es el más reciente del paciente.",
        },
        {
          glyph: "✕", tone: "red",
          title: "Explicarlo toma más de lo necesario",
          body: "Sin poder señalar sobre el estudio, al paciente le cuesta entender por qué necesita el tratamiento.",
        },
      ],
    },
    capabilities: [
      {
        eyebrow: "Visor", tone: "cyan",
        title: "Abre radiografías y estudios 3D sin instalar nada",
        body: "Entras desde cualquier computadora de la clínica con tu usuario. Recorres los cortes del estudio, ajustas el brillo y haces zoom donde necesitas ver mejor.",
        bullets: [
          "Cortes del estudio CBCT en el navegador",
          "Zoom y ajuste de brillo para revisar detalles",
          "Acceso con roles y permisos de tu equipo",
        ],
        mock: "radiografias-1",
      },
      {
        eyebrow: "IA asistiva", tone: "blue", reverse: true,
        title: "La IA señala zonas para revisar; tú decides qué significan",
        body: "El análisis marca puntos que vale la pena mirar con calma y los enumera junto al estudio. No emite diagnósticos: es apoyo para tu lectura, y tú confirmas o descartas cada marca.",
        bullets: [
          "Marcas visibles sobre el estudio, que puedes ocultar",
          "Confirmas o descartas cada zona sugerida",
          "Tu lectura queda escrita en la nota de evolución",
        ],
        mock: "radiografias-2",
      },
      {
        eyebrow: "En el expediente", tone: "violet",
        title: "Cada estudio queda con su paciente y su fecha",
        body: "Subes el archivo y se guarda en la ficha, junto al odontograma y a las notas. En la siguiente visita comparas con el estudio anterior sin buscar en carpetas.",
        bullets: [
          "Historial de estudios por paciente",
          "Se abre desde la cita del día",
          "Datos cifrados y con respaldos",
        ],
        mock: "radiografias-3",
      },
      {
        eyebrow: "Compartir", tone: "green", reverse: true,
        title: "Enséñale el estudio al paciente y compártelo en su portal",
        body: "En el consultorio lo ves en pantalla con él; si quiere revisarlo en casa, lo publicas en su portal junto con el presupuesto del tratamiento.",
        bullets: [
          "Tú eliges qué estudios se comparten",
          "Se acompaña del presupuesto por etapas",
          "Puedes dejar de compartirlo cuando quieras",
        ],
        mock: "radiografias-4",
      },
    ],
    steps: {
      sub: "Del archivo del estudio a tu lectura escrita en el expediente.",
      items: [
        { title: "Subes el estudio", body: "Queda guardado en la ficha del paciente, con su fecha." },
        { title: "Lo abres en el visor", body: "Recorres los cortes desde el navegador, sin instalar nada." },
        { title: "La IA marca zonas sugeridas", body: "Son apoyo para tu revisión; puedes ocultarlas cuando quieras." },
        { title: "Tú decides y lo dejas escrito", body: "Confirmas o descartas cada marca y dictas tu nota de evolución." },
      ],
    },
    blog: {
      title: "Para sacarle provecho a tus estudios",
      posts: [
        {
          slug: "inteligencia-artificial-odontologia", kicker: "IA", tone: "cyan",
          title: "Inteligencia artificial en odontología: usos reales hoy",
          excerpt: "Apoyo en radiografías, dictado por voz y resúmenes: qué es real, qué es marketing y cómo empezar.",
        },
        {
          slug: "clinica-dental-digital-tecnologia", kicker: "Tecnología", tone: "blue",
          title: "Clínica dental digital: tecnología que sí vale la pena",
          excerpt: "Qué digitalizar primero, radiografía, CBCT, respaldos y qué compras pueden esperar.",
        },
        {
          slug: "software-dental-nube-vs-instalado", kicker: "Comparativa", tone: "violet",
          title: "Software dental en la nube vs instalado: guía honesta",
          excerpt: "Acceso, respaldos, costos, internet y seguridad, para elegir la opción que conviene a tu clínica.",
        },
      ],
    },
    faq: [
      {
        q: "¿La IA da un diagnóstico?",
        a: "No. La IA marca zonas sugeridas para que las revises y tú confirmas o descartas cada una. El diagnóstico y el plan de tratamiento los decide el doctor.",
      },
      {
        q: "¿Necesito instalar un visor en cada computadora?",
        a: "No. El visor abre en el navegador con tu usuario, así que puedes revisar el estudio desde cualquier equipo de la clínica.",
      },
      {
        q: "¿Quién puede ver los estudios?",
        a: "Los define tu configuración de roles y permisos. Además, tú eliges qué estudios se comparten con el paciente en su portal y puedes dejar de compartirlos cuando quieras.",
      },
      {
        q: "¿Este módulo viene incluido en el plan?",
        a: "El visor de radiografías y estudios 3D con IA asistiva es parte de DaleControl. Consulta los planes para ver los límites y lo que trae cada uno.",
      },
    ],
    cta: {
      title: "Abre tu próximo estudio desde el navegador",
      body: "Crea tu cuenta, sube un estudio y revísalo con el apoyo de la IA en tu propia lectura.",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 7 · Reportes e indicadores — ámbar
  // ═══════════════════════════════════════════════════════════════════════════
  "reportes-clinica-dental": {
    slug: "reportes-clinica-dental",
    name: "Reportes e indicadores",
    tagline: "Ingresos, ocupación y productividad",
    theme: {
      glowA: "rgba(217,119,6,0.42)",
      glowB: "rgba(180,83,9,0.34)",
      heroBase: "linear-gradient(160deg,#0b1220 0%,#1c1408 58%,#241a09 100%)",
      glowScene: "rgba(251,191,36,0.30)",
      pillBg: "rgba(217,119,6,0.24)",
      pillBorder: "rgba(251,191,36,0.45)",
      pillText: "#fcd34d",
      accent: "#fbbf24",
      crumb: "#fcd34d",
      band: "linear-gradient(120deg,#451a03 0%,#78350f 55%,#92400e 100%)",
      stepsBg: "rgba(251,191,36,0.18)",
      stepsBorder: "rgba(252,211,77,0.42)",
      stepsText: "#fcd34d",
      stepsDash: "rgba(252,211,77,0.45)",
      stepNums: ["#b45309", "#d97706", "#2563eb", "#15803d"],
      cta: "linear-gradient(120deg,#451a03 0%,#78350f 55%,#92400e 100%)",
      ctaInk: "#92400e",
      ctaNote: "#fef3c7",
      link: "#b45309",
      linkBorder: "#fcd34d",
      faqBg: "#fffbeb",
      faqText: "#b45309",
      faqTone: "amber",
      blogTone: "amber",
    },
    metaTitle: "Reportes para clínica dental: ingresos y ocupación",
    metaDescription:
      "Reportes para tu clínica dental: ingresos por periodo y método de pago, ocupación de la agenda y productividad por doctor, con los datos que ya registras.",
    keywords: [
      "reportes clínica dental",
      "indicadores consultorio dental",
      "ocupación de agenda dental",
      "productividad por doctor",
      "KPIs clínica dental",
    ],
    badge: "Módulo de reportes e indicadores",
    h1a: "Reportes para tu clínica dental: ",
    h1accent: "ingresos, agenda y productividad",
    lede:
      "Los números salen de lo que ya registras: caja, agenda y tratamientos. Abres el panel y ves cómo va el mes, sin armar hojas de cálculo.",
    heroChecks: ["Sin capturar dos veces", "Por día, mes o periodo", "Consulta los planes"],
    heroMock: "reportes-hero",
    benefits: [
      { glyph: "▤", title: "Salen de lo que ya registras", body: "Caja, agenda y tratamientos alimentan los reportes solos." },
      { glyph: "◷", title: "Ocupación de la agenda", body: "Ves qué tanto se están usando tus sillones y tus horarios." },
      { glyph: "◇", title: "Productividad por doctor", body: "Citas atendidas y tratamientos, con la misma regla para todos." },
      { glyph: "✓", title: "Comparas periodos", body: "Día, mes o trimestre, con el mismo tablero." },
    ],
    problem: {
      title: "Cuando saber cómo va la clínica cuesta media tarde",
      sub: "Tres cosas que se repiten cada mes en una clínica dental.",
      cards: [
        {
          glyph: "◷", tone: "amber",
          title: "Todo termina en una hoja de cálculo",
          body: "Alguien vacía los cobros a mano cada mes, y para cuando está lista la hoja, el mes ya pasó.",
        },
        {
          glyph: "✕", tone: "red",
          title: "No sabes cuánto se desperdicia de agenda",
          body: "Se siente lleno el día, pero nadie puede decir cuántas horas de sillón quedaron sin usar.",
        },
        {
          glyph: "◇", tone: "blue",
          title: "Cada quien mide distinto",
          body: "Recepción cuenta citas, el doctor cuenta tratamientos, y las conversaciones se vuelven de opiniones.",
        },
      ],
    },
    capabilities: [
      {
        eyebrow: "Ingresos", tone: "amber",
        title: "Cómo va el mes, con los cobros que ya registró la caja",
        body: "El reporte se arma con lo que cobraste, por método de pago y por tratamiento. Comparas contra el mes anterior sin capturar nada dos veces.",
        bullets: [
          "Ingresos por periodo y por método de pago",
          "Desglose por tipo de tratamiento",
          "Saldos pendientes a la vista",
        ],
        mock: "reportes-1",
      },
      {
        eyebrow: "Ocupación", tone: "blue", reverse: true,
        title: "Cuánta agenda se está aprovechando de verdad",
        body: "Compara las horas agendadas contra las horas disponibles por doctor y por sillón, y te muestra en qué días te sobran huecos.",
        bullets: [
          "Ocupación por doctor, sillón y día de la semana",
          "Ausencias y cancelaciones del periodo",
          "Te dice dónde conviene abrir más espacios",
        ],
        mock: "reportes-2",
      },
      {
        eyebrow: "Productividad", tone: "violet",
        title: "Qué se atendió, quién lo atendió y qué tratamientos pesan más",
        body: "Citas atendidas por doctor y mezcla de tratamientos del periodo. Todos ven el mismo tablero, así las conversaciones de equipo dejan de ser de percepciones.",
        bullets: [
          "Citas atendidas y ausencias por doctor",
          "Tratamientos más frecuentes del periodo",
          "Resultados de las encuestas post-cita",
        ],
        mock: "reportes-3",
      },
      {
        eyebrow: "Comparar", tone: "green", reverse: true,
        title: "Compara periodos y, si tienes varias sedes, compáralas entre sí",
        body: "Cambias el periodo y el tablero se recalcula. Con multi-sede puedes ver cada sucursal por separado o todas juntas, con los mismos indicadores.",
        bullets: [
          "Mismo tablero por día, mes, trimestre o año",
          "Vista por sede o consolidada",
          "Cada quien ve lo que sus permisos le autorizan",
        ],
        mock: "reportes-4",
      },
    ],
    steps: {
      sub: "De la operación diaria a una revisión de mes que dura minutos.",
      items: [
        { title: "Trabajas como siempre", body: "Agendas, atiendes y cobras: cada acción alimenta los reportes." },
        { title: "Abres el tablero", body: "Eliges el periodo y ves ingresos, ocupación y productividad." },
        { title: "Detectas dónde ajustar", body: "Los días flojos, los saldos pendientes y los tratamientos que pesan." },
        { title: "Lo platicas con tu equipo", body: "Todos miran el mismo tablero y acuerdan qué cambiar la semana que entra." },
      ],
    },
    blog: {
      title: "Para leer mejor los números de tu clínica",
      posts: [
        {
          slug: "punto-equilibrio-consultorio-dental", kicker: "Finanzas", tone: "amber",
          title: "Punto de equilibrio de tu consultorio dental",
          excerpt: "Fórmula, ejemplo completo en pesos, margen de seguridad y 3 palancas para mejorarlo.",
        },
        {
          slug: "comisiones-doctores-clinica-dental", kicker: "Equipo", tone: "violet",
          title: "Comisiones a doctores en clínicas dentales",
          excerpt: "Porcentaje, base fija, renta de sillón, descuento de laboratorio y tabulador por escrito.",
        },
        {
          slug: "precios-tratamientos-dentales-rentables", kicker: "Precios", tone: "blue",
          title: "Cuánto cobrar por tratamiento dental: precios rentables",
          excerpt: "Costo por hora de sillón, fórmula de precio mínimo con ejemplo y cuándo subir tarifas.",
        },
      ],
    },
    faq: [
      {
        q: "¿Tengo que capturar algo extra para tener reportes?",
        a: "No. Los reportes se arman con lo que ya registras en la agenda, en el expediente y en la caja. No hay que llenar una hoja aparte.",
      },
      {
        q: "¿Puedo ver los números por sede?",
        a: "Sí. Con multi-sede puedes revisar cada sucursal por separado o todas juntas, con los mismos indicadores y el mismo periodo.",
      },
      {
        q: "¿Todo mi equipo ve los mismos reportes?",
        a: "Depende de los permisos que les des. Puedes dejar los reportes de ingresos solo para administración y compartir los de agenda con el resto del equipo.",
      },
      {
        q: "¿Este módulo viene incluido en el plan?",
        a: "Los reportes son parte de DaleControl. Consulta los planes para ver los límites y lo que trae cada uno.",
      },
    ],
    cta: {
      title: "Deja de armar el reporte a mano",
      body: "Crea tu cuenta, registra tu operación en un solo lugar y abre tu primer tablero del mes.",
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // 8 · Multi-sede, roles y permisos — azul profundo
  // ═══════════════════════════════════════════════════════════════════════════
  "software-multiclinica-dental": {
    slug: "software-multiclinica-dental",
    name: "Multi-sede, roles y permisos",
    tagline: "Varias sucursales en una sola cuenta",
    theme: {
      glowA: "rgba(30,64,175,0.5)",
      glowB: "rgba(23,37,84,0.5)",
      heroBase: "linear-gradient(160deg,#080e1c 0%,#0d1730 58%,#111f43 100%)",
      glowScene: "rgba(96,165,250,0.32)",
      pillBg: "rgba(30,64,175,0.35)",
      pillBorder: "rgba(147,197,253,0.45)",
      pillText: "#bfdbfe",
      accent: "#93c5fd",
      crumb: "#93c5fd",
      band: "linear-gradient(120deg,#0f1d3d 0%,#172554 55%,#1e3a8a 100%)",
      stepsBg: "rgba(96,165,250,0.16)",
      stepsBorder: "rgba(147,197,253,0.4)",
      stepsText: "#93c5fd",
      stepsDash: "rgba(147,197,253,0.45)",
      stepNums: ["#1e40af", "#7c3aed", "#15803d", "#b45309"],
      cta: "linear-gradient(120deg,#0f1d3d 0%,#172554 55%,#1e3a8a 100%)",
      ctaInk: "#1e3a8a",
      ctaNote: "#dbeafe",
      link: "#1e40af",
      linkBorder: "#bfdbfe",
      faqBg: "#eff6ff",
      faqText: "#1e40af",
      faqTone: "navy",
      blogTone: "navy",
    },
    metaTitle: "Software multiclínica dental: sedes, roles y permisos",
    metaDescription:
      "Software para clínicas dentales con varias sucursales: cada sede con su agenda y su caja, roles y permisos por puesto y verificación en dos pasos (2FA).",
    keywords: [
      "software multiclínica dental",
      "clínica dental varias sucursales",
      "roles y permisos clínica",
      "2FA para clínicas dentales",
      "gestión multi-sede odontología",
    ],
    badge: "Módulo de multi-sede y permisos",
    h1a: "Software para clínicas dentales con ",
    h1accent: "varias sucursales",
    h1b: ", roles y permisos",
    lede:
      "Todas tus sedes en una sola cuenta, cada una con su agenda, su expediente y su caja. Cada puesto entra a lo suyo, y tú ves el conjunto cuando lo necesitas.",
    heroChecks: ["Cambias de sede en un clic", "Verificación en dos pasos", "Consulta los planes"],
    heroMock: "multisede-hero",
    benefits: [
      { glyph: "▤", title: "Una cuenta, todas tus sedes", body: "Cada sucursal con su agenda, su caja y su equipo, en el mismo lugar." },
      { glyph: "✦", title: "Cada puesto ve lo suyo", body: "Defines permisos por rol: agenda, expediente, caja y reportes." },
      { glyph: "◉", title: "Cuentas protegidas", body: "Verificación en dos pasos y accesos individuales, sin cuentas compartidas." },
      { glyph: "✓", title: "Reportes por sede", body: "Revisas una sucursal o todas juntas con los mismos indicadores." },
    ],
    problem: {
      title: "Cuando cada sucursal trabaja como si fuera otra clínica",
      sub: "Tres cosas que se repiten cuando creces de consultorio a varias sedes.",
      cards: [
        {
          glyph: "◇", tone: "navy",
          title: "Cada sede lleva su propio sistema",
          body: "Un paciente que va a la otra sucursal empieza de cero, y los números nunca se pueden sumar.",
        },
        {
          glyph: "✕", tone: "red",
          title: "Todos entran con la misma cuenta",
          body: "La contraseña la sabe medio equipo, y cualquiera puede ver lo que no le corresponde.",
        },
        {
          glyph: "◷", tone: "amber",
          title: "No sabes quién hizo qué",
          body: "Si algo se cambió o se canceló, no hay forma de saber desde qué sede ni con qué usuario.",
        },
      ],
    },
    capabilities: [
      {
        eyebrow: "Multi-sede", tone: "navy",
        title: "Cambia de sucursal sin cambiar de sistema",
        body: "Eliges la sede desde el mismo panel y ves su agenda, su caja y su equipo. El paciente que va a otra sucursal llega con su expediente completo.",
        bullets: [
          "Agenda, caja y equipo propios por sede",
          "El expediente del paciente viaja entre sucursales",
          "Vista consolidada cuando quieres el total",
        ],
        mock: "multisede-1",
      },
      {
        eyebrow: "Roles y permisos", tone: "violet", reverse: true,
        title: "Una matriz clara: qué puede hacer cada puesto",
        body: "Marcas por rol el acceso a agenda, expediente, caja, facturación y reportes. Cuando entra alguien nuevo, le asignas su rol y listo.",
        bullets: [
          "Roles para admin, doctor, higiene y recepción",
          "Permisos por módulo y por sede",
          "Cambios que aplican de inmediato",
        ],
        mock: "multisede-2",
      },
      {
        eyebrow: "Seguridad", tone: "green",
        title: "Cada quien con su cuenta y su segundo factor",
        body: "Invitas a cada persona con su correo y su rol, y activas la verificación en dos pasos. Se acabaron las contraseñas compartidas entre turnos.",
        bullets: [
          "Invitaciones por correo, una cuenta por persona",
          "Verificación en dos pasos (2FA)",
          "Das de baja un acceso cuando alguien sale del equipo",
        ],
        mock: "multisede-3",
      },
      {
        eyebrow: "Configuración por sede", tone: "amber", reverse: true,
        title: "Cada sucursal con sus horarios, sus sillones y su WhatsApp",
        body: "Defines por sede el horario de atención, cuántos sillones tiene y desde qué número salen sus recordatorios. Las reservas en línea respetan esa configuración.",
        bullets: [
          "Horario y días de atención por sucursal",
          "Sillones y doctores asignados a cada sede",
          "Número de WhatsApp propio para sus recordatorios",
        ],
        mock: "multisede-4",
      },
    ],
    steps: {
      sub: "De un consultorio a varias sedes, sin duplicar sistemas ni contraseñas.",
      items: [
        { title: "Das de alta la sede", body: "Con su horario, sus sillones y su número de WhatsApp." },
        { title: "Invitas a tu equipo con su rol", body: "Cada persona con su cuenta, su rol y su segundo factor." },
        { title: "Cada quien entra a lo suyo", body: "Ve la sede y los módulos que sus permisos le autorizan." },
        { title: "Revisas por sede o en conjunto", body: "Los mismos indicadores para una sucursal o para todas." },
      ],
    },
    blog: {
      title: "Para crecer sin perder el control",
      posts: [
        {
          slug: "como-administrar-clinica-dental", kicker: "Gestión", tone: "navy",
          title: "Cómo administrar una clínica dental: guía completa",
          excerpt: "Roles del equipo, protocolos escritos, juntas efectivas, indicadores y cuándo delegar.",
        },
        {
          slug: "senales-clinica-necesita-software", kicker: "Diagnóstico", tone: "violet",
          title: "Señales de que tu clínica necesita un sistema de gestión",
          excerpt: "Citas que se empalman, saldos en libreta y expedientes perdidos: cuándo dar el primer paso.",
        },
        {
          slug: "errores-implementar-software-clinica-dental", kicker: "Implementación", tone: "amber",
          title: "10 errores comunes al implementar software dental",
          excerpt: "El antídoto para cada uno, desde migrar datos hasta capacitar a tu equipo.",
        },
      ],
    },
    faq: [
      {
        q: "¿Todas mis sucursales viven en la misma cuenta?",
        a: "Sí. Cada sede tiene su agenda, su caja y su equipo, y tú cambias entre ellas desde el mismo panel o las revisas todas juntas.",
      },
      {
        q: "¿Puedo limitar qué ve cada puesto?",
        a: "Sí. Los permisos se definen por rol y por módulo: agenda, expediente, caja, facturación y reportes. Puedes dar acceso completo, solo lectura o ninguno.",
      },
      {
        q: "¿Un doctor puede atender en dos sedes?",
        a: "Sí. Le asignas las sedes donde atiende y su agenda se muestra en cada una, con los horarios y sillones de esa sucursal.",
      },
      {
        q: "¿Este módulo viene incluido en el plan?",
        a: "Multi-sede, roles y permisos forman parte de DaleControl. Consulta los planes para ver cuántas sedes y usuarios incluye cada uno.",
      },
    ],
    cta: {
      title: "Crece de consultorio a clínica sin perder el control",
      body: "Crea tu cuenta, da de alta tus sedes e invita a tu equipo con el rol que le toca.",
    },
  },
};

/** Las otras 7 rutas, para el bloque "Otros módulos de DaleControl". */
export function otherModules(current: ProductoSlug) {
  return PRODUCTO_SLUGS.filter((s) => s !== current).map((s) => {
    const m = PRODUCTO_MODULES[s];
    return { slug: m.slug, name: m.name, tagline: m.tagline };
  });
}
