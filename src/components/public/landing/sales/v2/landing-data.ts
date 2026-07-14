/**
 * DaleControl — Landing page: datos y copy (fuente de verdad).
 * Actualizado 2026-07-14. NO cambiar precios, límites ni textos sin aprobación de negocio.
 */

export interface Feature {
  text: string;
  included: boolean;
}

export interface CapacityRow {
  text: string;
  value: string;
  /** false → fila con ✗ gris y pill gris (ej. "Tokens IA · 0" en Básico) */
  included: boolean;
}

export interface Plan {
  key: 'basico' | 'profesional' | 'clinica';
  name: string;
  tagline: string;
  badge: string;          // etiqueta flotante sobre la tarjeta
  badgeColor: string;     // fondo del badge
  monthly: number;        // MXN/mes
  firstMonth: number;     // PROMO: precio del primer mes (solo en modo mensual)
  yearly: number;         // MXN/año (35% off)
  yearlyPerMonth: number; // equivalente mensual del anual
  yearlySavings: number;  // ahorro anual vs mensual
  recommended: boolean;   // tarjeta destacada (borde azul + sombra)
  addendum: string | null;
  capacity: CapacityRow[];
  features: Feature[];
}

export const PLANS: Plan[] = [
  {
    key: 'basico',
    name: 'Básico',
    tagline: 'Para ordenar tu clínica desde el día uno',
    badge: 'Clínica nueva', badgeColor: '#0d9488',
    monthly: 419, firstMonth: 19, yearly: 3264, yearlyPerMonth: 272, yearlySavings: 1764,
    recommended: false,
    addendum: null,
    capacity: [
      { text: 'Pacientes', value: '500', included: true },
      { text: 'Usuarios', value: '2', included: true },
      { text: 'Almacenamiento', value: '5 GB', included: true },
      { text: 'Tokens IA', value: '0 · Sin IA', included: false },
    ],
    features: [
      { text: 'Agenda + recordatorios por WhatsApp', included: true },
      { text: 'Expediente clínico + odontograma', included: true },
      { text: 'Presupuestos, cobros y factura automática', included: true },
      { text: 'Portal del paciente y recetas digitales', included: true },
      { text: 'Radiografías 3D en la nube con IA', included: false },
      { text: 'Modelos 3D y clínica virtual', included: false },
      { text: 'Varias sucursales', included: false },
    ],
  },
  {
    key: 'profesional',
    name: 'Profesional',
    tagline: 'La favorita de las clínicas dentales',
    badge: '★ Más popular', badgeColor: '#2563eb',
    monthly: 689, firstMonth: 29, yearly: 5376, yearlyPerMonth: 448, yearlySavings: 2892,
    recommended: true,
    addendum: 'Todo lo de Básico, y además:',
    capacity: [
      { text: 'Pacientes', value: 'Ilimitados', included: true },
      { text: 'Usuarios', value: '6', included: true },
      { text: 'Almacenamiento', value: '15 GB', included: true },
      { text: 'Tokens IA', value: '200 mil', included: true },
    ],
    features: [
      { text: 'Radiografías CBCT en la nube con IA', included: true },
      { text: 'Asistente clínico con IA · 200 mil tokens/mes', included: true },
      { text: 'Modelos 3D dentales y clínica virtual 3D', included: true },
      { text: 'Analytics, reportes y TV de sala de espera', included: true },
      { text: 'Varias sucursales en una cuenta', included: false },
      { text: 'Roles avanzados y soporte prioritario', included: false },
    ],
  },
  {
    key: 'clinica',
    name: 'Clínica',
    tagline: 'Para clínicas con varios consultorios',
    badge: 'Clínica Grande', badgeColor: '#1e3a8a',
    monthly: 1719, firstMonth: 39, yearly: 13404, yearlyPerMonth: 1117, yearlySavings: 7224,
    recommended: false,
    addendum: 'Todo lo de Profesional, y además:',
    capacity: [
      { text: 'Pacientes', value: 'Ilimitados', included: true },
      { text: 'Usuarios', value: 'Ilimitados', included: true },
      { text: 'Almacenamiento', value: '75 GB', included: true },
      { text: 'Tokens IA', value: '1 millón', included: true },
    ],
    features: [
      { text: 'Varias sucursales en una cuenta', included: true },
      { text: 'Roles y permisos avanzados', included: true },
      { text: 'IA ampliada · 1 millón de tokens/mes', included: true },
      { text: 'Soporte prioritario', included: true },
      { text: 'Onboarding y migración dedicados', included: true },
    ],
  },
];

export const PRICING_COPY = {
  eyebrow: 'Precios',
  // El título va en UNA sola línea centrada (white-space:nowrap + font clamp)
  title: 'Un precio transparente y sin contratos',
  subtitle: 'Regístrate hoy: tu primer mes cuesta desde $19 y no hay permanencia.',
  toggleMonthly: 'Mensual',
  toggleYearly: 'Anual',
  yearlyBadge: '35% de descuento',
  perMonth: 'MXN /mes',
  noContract: 'Sin permanencia · cancela cuando quieras',
  // Caja promo sutil (solo modo mensual): fondo #f6fdf8, borde #d9f3e1
  promo: (first: string, save: string) => `Tu primer mes: solo ${first} · ahorras ${save}`,
  billedYearly: (total: string) => `Facturado anualmente: ${total}`,
  savings: (amount: string) => `ahorras ${amount}`,
  // CTA de 2 líneas — los 3 planes usan el MISMO botón azul sólido (#2563eb)
  cta: 'Contratar Ahora!',
  ctaSub: (first: string) => `Empieza hoy por solo ${first} MXN`, // pill blanca translúcida dentro del botón
  trustChips: [
    'Sin permanencia ni contratos anuales',
    'Precios en MXN + IVA',
    'Soporte en español e inglés',
    'Página web gratuita incluida en cualquier plan',
    'Última tecnología de software en IA',
    'Datos respaldados con alta seguridad',
    'CRM incluido de tus clientes',
    'Facturación directa desde DaleControl',
  ], // 8 chips compactos (13px) que caben en 2 líneas en desktop
};

export const HERO = {
  badge: 'Datos cifrados y respaldos diarios',
  title: 'El control total de tu clínica dental, en un solo lugar',
  subtitle: 'Agenda, cobros, radiografías 3D con IA y WhatsApp — todo desde tu navegador, en español y en pesos.',
  ctaPrimary: 'Empieza hoy',    // → registro
  ctaSecondary: 'Ver Precios!', // botón AZUL SÓLIDO (igual que el primario) → #precios
  bullets: ['Tu primer mes desde $19', 'Sin permanencia', 'Sin instalar nada'], // el 1º en verde #15803d
};

export const NAV = {
  links: [
    { label: 'Funciones', href: '#funciones' },
    { label: 'Precios', href: '#precios' },
    { label: 'Comparativa', href: '#comparativa' },
    { label: 'FAQ', href: '#faq' },
  ],
  login: 'Iniciar sesión',
  signup: 'Crear cuenta',
};

/** Banda azul degradada (#1e3a8a→#2563eb), números blancos gigantes */
export const STATS = [
  { value: '350+', label: 'clínicas nuevas en solo este mes' },
  { value: '+500,000', label: 'pacientes gestionados', trend: '▲ 35% este año' },
  { value: '+10M', label: 'tokens de IA utilizados' },
];

export const SPOTLIGHTS_HEADER = {
  eyebrow: 'Funciones',
  title: 'El software de clínicas más completo del mundo',
  subtitle: 'No te lo contamos: míralo. Así se ve el panel real de DaleControl por dentro.',
};

/** 6 spotlights (radiografías+modelos3D fusionados; whatsapp+IA fusionados) */
export const SPOTLIGHTS = [
  {
    id: 'agenda', badge: 'Agenda inteligente',
    title: 'Llena tu agenda y olvídate de las citas perdidas',
    desc: 'Citas por doctor, sillón y consultorio, con recordatorios automáticos que tus pacientes sí leen.',
    bullets: [
      'Vista por día, semana, mes o lista — filtra por doctor, sillón y estado',
      'Recordatorios automáticos por WhatsApp; el paciente confirma con un toque',
      'Reservas en línea 24/7 y alerta de sala de espera (">20 min")',
    ],
    mockup: 'agenda-semanal',
  },
  {
    id: 'pacientes', badge: 'Pacientes y expedientes',
    title: 'Todos tus pacientes, con su saldo a la vista',
    desc: 'Encuentra a cualquiera en segundos y deja de perder dinero en cuentas olvidadas.',
    bullets: [
      'Filtros listos: con deuda, VIP, cumpleaños, sin contacto en 6 meses',
      'Saldo pendiente visible en la lista — nada se te escapa',
      '"Importar mi clínica": trae tus pacientes de Excel o tu sistema anterior',
    ],
    mockup: 'tabla-pacientes',
  },
  {
    id: 'finanzas', badge: 'Finanzas completas',
    title: 'Cobra más rápido, sin perseguir pagos',
    desc: 'Del presupuesto a la factura en un clic, con la firma del paciente y su estado de cuenta siempre al día.',
    bullets: [
      'Presupuestos con firma digital del paciente',
      'Factura automática al crear el presupuesto',
      'Pagos parciales y descuentos por línea o globales (% o $)',
      'KPIs de ingresos en vivo y reglas automáticas de cobro',
    ],
    mockup: 'presupuesto',
  },
  {
    id: 'imagenes3d', badge: 'Radiografías + Modelos 3D con IA',
    title: 'Radiografías CBCT y modelos 3D, en tu navegador',
    desc: 'Sube el DICOM de tu tomógrafo o el STL de tu escáner y míralos desde cualquier dispositivo — sin instalar nada.',
    bullets: [
      'Cortes axial, coronal y sagital + panorámica automática',
      'IA que resalta hallazgos en el estudio',
      'Modelos STL, PLY u OBJ girables dentro del expediente',
      'Compártelos con el paciente para cerrar el tratamiento',
    ],
    mockup: 'visor-dicom-stl', // 4 imágenes reales public/landing/cbct/* (142px, object-fit:contain) + tira STL animada
  },
  {
    id: 'clinica3d', badge: 'Tu clínica en 3D',
    title: 'Un recorrido virtual que convierte curiosos en pacientes',
    desc: 'Tu clínica en tercera dimensión, con cada sillón y consultorio en vivo. Los pacientes la recorren desde su celular antes de agendar.',
    bullets: [
      'Recórrela como si estuvieras adentro: sillones, consultorios y recepción',
      'Modo "En Vivo": qué silla está ocupada y quién espera, en tiempo real',
      'Compártela en redes y en tu página pública',
    ],
    mockup: 'clinica-isometrica', // escena SVG isométrica: 3 sillones dentales, recepción, sala de espera, chips de estado
  },
  {
    id: 'whatsapp-ia', badge: 'WhatsApp + Asistente IA',
    title: 'Un bot que agenda citas y una IA que trabaja contigo',
    desc: 'El WhatsApp de tu clínica y tu asistente clínico viven dentro del panel — atienden mientras tú trabajas.',
    bullets: [
      'Bot que agenda citas solo, 24/7, con recordatorios y confirmaciones',
      'Recall automático de pacientes inactivos',
      'Diagnóstico diferencial, dosis y notas SOAP con /comandos',
    ],
    disclaimer: 'Las sugerencias de la IA no reemplazan el criterio clínico.',
    mockup: 'inbox-ia-split', // ventana dividida: chat WhatsApp | tarjetas IA + /comandos
  },
];

export const MODULES_TRIO = {
  title: 'Y también dominas los números, tu equipo y tu presencia en línea',
  subtitle: 'Tres módulos más, directo del panel.',
  // Los 3 mockups se estiran a la MISMA altura (flex column + flex:1)
  items: [
    { id: 'analytics', title: 'Analytics que hablan claro', desc: 'Ocupación, doctores, procedimientos, no-shows, costos y margen — por día, mes, trimestre o año.', mockup: 'analytics' },
    { id: 'equipo', title: 'Tu equipo, con roles y permisos', desc: 'Invita doctores y admins, controla qué ve cada quien y mide citas e ingresos por doctor.', mockup: 'equipo' }, // usuario "Rafael Martinez"
    { id: 'web', title: 'Tu página web, lista en minutos', desc: 'Elige entre 4 plantillas, publica con un clic y capta pacientes con tu link propio y reseñas post-cita.', mockup: 'pagina-web' },
  ],
};

export const GRID_FEATURES = [
  { glyph: '⌗', title: 'Expediente + odontograma', desc: 'Historia clínica completa con odontograma interactivo.' },
  { glyph: '◫', title: 'Portal del paciente', desc: 'Agenda, paga, chatea y descarga sus documentos.' },
  { glyph: '℞', title: 'Recetas digitales', desc: 'Recetas listas para imprimir o enviar al paciente.' },
  { glyph: '✎', title: 'Consentimientos firmados', desc: 'Firma digital de consentimientos informados.' },
  { glyph: '◈', title: 'Módulos por especialidad', desc: 'Ortodoncia, endodoncia, periodoncia, implantes y pediatría.' },
  { glyph: '☆', title: 'Directorio + reseñas', desc: 'Perfil público para captar pacientes y reseñas post-cita.' },
  { glyph: '▶', title: 'TV para sala de espera', desc: 'Pantalla con turnos y contenido de tu clínica.' },
  { glyph: '⧉', title: 'Multi-sucursal', desc: 'Varias clínicas administradas desde una sola cuenta.' },
  { glyph: '⇅', title: 'Importa tus datos', desc: 'Migración asistida desde tu sistema anterior o Excel.' },
  { glyph: '🔒', title: 'Seguridad de verdad', desc: '2FA para tu staff, bitácora de auditoría y respaldos diarios.' },
  { glyph: '¢', title: 'Pagos en línea', desc: 'Tus pacientes pagan desde su celular, tú lo ves al momento.' },
  { glyph: '▣', title: 'Inventario e insumos', desc: 'Controla existencias y recibe alertas de stock bajo.' },
  { glyph: '⇄', title: 'Proveedores y compras', desc: 'Proveedores, órdenes y compras de tu clínica en un solo módulo.' },
  { glyph: '⚗', title: 'Laboratorios y órdenes', desc: 'Envía y da seguimiento a tus órdenes de laboratorio.' },
  { glyph: '⌘', title: 'Rápido de usar', desc: 'Búsqueda global Ctrl+K para ejecutar todo al instante. Con modo oscuro.' },
];

export const COMPARISON = {
  eyebrow: 'Comparativa',
  title: '¿Por qué cambiarte a DaleControl?',
  subtitle: 'Compara tu forma de trabajar hoy con lo que podrías tener mañana.',
  columns: ['Papel / Excel', 'Software dental tradicional', 'DaleControl'],
  rows: [
    { label: 'Agenda con recordatorios por WhatsApp', paper: '✗', traditional: 'Con costo extra' },
    { label: 'Radiografías 3D en la nube, sin instalar', paper: '✗', traditional: 'Requiere programa local' },
    { label: 'Análisis con inteligencia artificial', paper: '✗', traditional: '✗' },
    { label: 'Modelos 3D (STL/PLY/OBJ) en el navegador', paper: '✗', traditional: 'A veces' },
    { label: 'Portal del paciente', paper: '✗', traditional: 'Limitado' },
    { label: 'Tu clínica en 3D (recorrido virtual)', paper: '✗', traditional: '✗' },
    { label: 'Facturación ligada a presupuestos', paper: 'Manual', traditional: 'Módulo aparte' },
    { label: 'Precio en MXN, sin contratos anuales', paper: '—', traditional: 'USD o anualidad' },
    { label: 'Actualizaciones constantes incluidas', paper: '✗', traditional: 'Versiones de pago' },
    { label: 'Soporte en español', paper: '—', traditional: 'Variable' },
  ],
};

/** Carrusel infinito derecha→izquierda (55s, pausa al hover, respeta prefers-reduced-motion).
 *  Fotos: usar assets propios o un servicio de avatares licenciado. En el reference se usan
 *  retratos de randomuser.me SOLO como placeholder — reemplazar por fotos reales/licenciadas
 *  antes de producción. Van como background-image (no <img>). */
export const TESTIMONIALS = {
  title: 'Doctores que ya tomaron el control',
  items: [
    { photo: 'women/44', name: 'Dra. Mariana Gutiérrez', role: 'Clínica Dental Sonría · Guadalajara', quote: 'Antes perdía 3 o 4 citas por semana. Con los recordatorios de WhatsApp mis pacientes confirman solos y mi agenda está llena.' },
    { photo: 'men/32', name: 'Dr. Luis Hernández', role: 'Dental Vega Implantes · Monterrey', quote: 'Ver el CBCT desde el navegador, sin instalar nada, me cambió la consulta. Se lo muestro al paciente en 3D y el tratamiento se vende solo.' },
    { photo: 'women/65', name: 'Dra. Karla Ríos', role: 'Sonrisitas Kids · CDMX', quote: 'Dejé el Excel en una semana. Presupuesto, firma y factura salen juntos, y por fin sé cuánto ingresa mi clínica cada día.' },
    { photo: 'men/52', name: 'Dr. Andrés Salazar', role: 'Centro Dental Alameda · Puebla', quote: 'El bot de WhatsApp me agendó 14 citas el primer mes, varias en domingo por la noche. Es como tener recepcionista 24/7.' },
    { photo: 'women/21', name: 'Dra. Fernanda Olvera', role: 'Odontología Integral Roma · CDMX', quote: 'La migración fue lo que más miedo me daba y tardó una tarde. Importaron mis 1,800 pacientes desde Excel sin perder nada.' },
    { photo: 'men/76', name: 'Dr. Ricardo Peña', role: 'Dental Care Del Valle · Querétaro', quote: 'Con los saldos a la vista recuperé más de $40,000 en cuentas que tenía olvidadas. Solo eso ya pagó el año completo.' },
    { photo: 'women/58', name: 'Dra. Paulina Cervantes', role: 'Ortodoncia Cervantes · Tijuana', quote: 'Mis pacientes de brackets ven su avance en el portal y pagan en línea. Bajé los no-shows a la mitad en dos meses.' },
    { photo: 'men/18', name: 'Dr. Emilio Ramos', role: 'Clínica Ramos & Asociados · Mérida', quote: 'Tengo dos sucursales y por fin veo todo en una sola cuenta: ingresos por doctor, ocupación y no-shows en tiempo real.' },
    { photo: 'women/33', name: 'Dra. Sofía Ibarra', role: 'Dental Boutique Ibarra · León', quote: 'La IA me redacta las notas SOAP mientras termino con el paciente. Me ahorro una hora de papeleo todos los días.' },
    { photo: 'men/61', name: 'Dr. Héctor Fuentes', role: 'Odontología Fuentes · Toluca', quote: 'Publiqué mi página con el recorrido 3D de la clínica y ahora llegan pacientes diciendo "quiero atenderme ahí". Impresiona de verdad.' },
  ],
};

export const FAQ = {
  eyebrow: 'Preguntas frecuentes',
  title: 'Lo que todos preguntan antes de empezar',
  items: [
    { q: '¿Mis datos y los de mis pacientes están seguros?', a: 'Sí. Toda la información viaja y se guarda cifrada, hacemos respaldos diarios automáticos y cada movimiento del staff queda registrado en una bitácora de auditoría. Además puedes activar verificación en dos pasos (2FA) para tu equipo.' },
    { q: '¿Puedo migrar desde mi sistema anterior o desde Excel?', a: 'Sí. Con "Importar mi clínica" traes tus pacientes, citas e historiales desde tu software anterior o desde hojas de Excel, con nuestro acompañamiento durante la migración.' },
    { q: '¿Necesito instalar algo o comprar equipo?', a: 'No. DaleControl funciona 100% en el navegador — incluso el visor de radiografías CBCT y los modelos 3D. Solo necesitas internet y el equipo que ya tienes.' },
    { q: '¿Funciona en el celular?', a: 'Sí. El panel es completamente responsive: puedes revisar tu agenda, contestar WhatsApp y ver tus ingresos desde el celular o la tablet.' },
    { q: '¿Hay permanencia o contrato anual?', a: 'No. Los planes son mes a mes y puedes cancelar cuando quieras. Si eliges el plan anual solo es para obtener el 35% de descuento, no por obligación contractual.' },
    { q: '¿Cómo funciona el pago?', a: 'Creas tu cuenta, eliges tu plan y pagas directamente desde el panel con tarjeta. Tu primer mes cuesta desde $19 y después se cobra el precio normal de tu plan. Los precios están en pesos mexicanos y recibes tu factura.' },
    { q: '¿Qué pasa si necesito ayuda?', a: 'Tienes soporte en español por chat y WhatsApp. En el plan Clínica además cuentas con soporte prioritario y un onboarding dedicado para tu equipo.' },
  ],
};

export const FINAL_CTA = {
  title: 'Toma el control de tu clínica hoy mismo',
  subtitle: 'Crea tu cuenta en minutos, importa tus pacientes y empieza a llenar tu agenda. Tu primer mes desde $19.',
  ctaPrimary: 'Crear mi cuenta',
  ctaSecondary: 'Ver funciones',
  bullets: '✓ Datos cifrados · ✓ Respaldos diarios · ✓ Soporte en español',
};

export const FOOTER = {
  blurb: 'El software de gestión para clínicas dentales en México. Todo en un solo lugar, en español y en pesos.',
  product: NAV.links,
  legal: [
    { label: 'Aviso de privacidad', href: '/privacidad' },
    { label: 'Términos y condiciones', href: '/terminos' },
  ],
  contact: [
    { label: 'hola@dalecontrol.com', href: 'mailto:hola@dalecontrol.com' },
    { label: 'WhatsApp', href: '#' },
    { label: 'Facebook · Instagram', href: '#' },
  ],
  copyright: '© 2026 DaleControl. Todos los derechos reservados.',
  madeIn: 'Hecho en México 🇲🇽',
};

export const fmtMXN = (n: number) => '$' + n.toLocaleString('es-MX');
