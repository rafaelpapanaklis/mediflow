/**
 * DaleControl — Landing page: datos y copy (fuente de verdad).
 * NO cambiar precios, límites ni textos sin aprobación de negocio.
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
  monthly: number;        // MXN/mes
  yearly: number;         // MXN/año (30% off)
  yearlyPerMonth: number; // equivalente mensual del anual
  yearlySavings: number;  // ahorro anual vs mensual
  recommended: boolean;
  addendum: string | null; // "Todo lo de X, y además:"
  capacity: CapacityRow[];
  features: Feature[];
}

export const PLANS: Plan[] = [
  {
    key: 'basico',
    name: 'Básico',
    tagline: 'Para ordenar tu clínica desde el día uno',
    monthly: 499, yearly: 4192, yearlyPerMonth: 349, yearlySavings: 1796,
    recommended: false,
    addendum: null,
    capacity: [
      { text: 'Pacientes', value: '200', included: true },
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
    monthly: 999, yearly: 8392, yearlyPerMonth: 699, yearlySavings: 3596,
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
    monthly: 1999, yearly: 16792, yearlyPerMonth: 1399, yearlySavings: 7196,
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
  title: 'Un precio claro, en pesos y sin contratos',
  subtitle: 'Elige tu plan, regístrate y paga desde el panel. Sin permanencia: cancela cuando quieras.',
  toggleMonthly: 'Mensual',
  toggleYearly: 'Anual',
  yearlyBadge: '30% de descuento',
  perMonth: 'MXN /mes',
  noContract: 'Sin permanencia · cancela cuando quieras',
  billedYearly: (total: string) => `Facturado anualmente: ${total}`,
  savings: (amount: string) => `ahorras ${amount}`,
  popularBadge: '★ Más popular',
  cta: '¡Empieza ya!',
  trustChips: ['Sin permanencia ni contratos anuales', 'Precios en MXN + IVA', 'Soporte en español'],
};

export const HERO = {
  badge: 'Datos cifrados y respaldos diarios',
  title: 'El control total de tu clínica dental, en un solo lugar',
  subtitle: 'Agenda, cobros, radiografías 3D con IA y WhatsApp — todo desde tu navegador, en español y en pesos.',
  ctaPrimary: 'Empieza hoy',      // → registro
  ctaSecondary: 'Ver Precios!',   // botón azul sólido → #precios
  bullets: ['Sin permanencia', 'Sin instalar nada', 'Precios en MXN'],
};

export const NAV = {
  links: [
    { label: 'Funciones', href: '#funciones' },
    { label: 'Comparativa', href: '#comparativa' },
    { label: 'Precios', href: '#precios' },
    { label: 'FAQ', href: '#faq' },
  ],
  login: 'Iniciar sesión',
  signup: 'Crear cuenta',
};

export const STATS = [
  { value: '+2,000', label: 'clínicas confían en DaleControl' },
  { value: '+250,000', label: 'pacientes gestionados', trend: '▲ 35% este año' },
  { value: '+10M', label: 'tokens de IA utilizados' },
];

export const SPOTLIGHTS_HEADER = {
  eyebrow: 'Funciones',
  title: 'El software de clínicas más completo del mundo',
  subtitle: 'No te lo contamos: míralo. Así se ve el panel real de DaleControl por dentro.',
};

/** 8 spotlights; el campo mockup indica qué mockup del reference se porta. */
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
    id: 'radiografias', badge: 'Radiografías con IA en la nube',
    title: 'Tu CBCT en el navegador, sin instalar nada',
    desc: 'Sube el DICOM y míralo desde cualquier dispositivo: en el consultorio, en casa o en el celular.',
    bullets: [
      'Reconstrucción 3D y cortes axial / coronal / sagital',
      'Panorámica generada automáticamente',
      'Análisis con IA que resalta hallazgos',
    ],
    mockup: 'visor-dicom', // usa las 4 imágenes reales public/landing/cbct/*
  },
  {
    id: 'modelos3d', badge: 'Modelos 3D dentales en vivo',
    title: 'Muéstrale al paciente su boca en 3D',
    desc: 'Sube archivos STL, PLY u OBJ de tu escáner intraoral y gíralos directo en el expediente del paciente.',
    bullets: [
      'Visor 3D en el navegador, sin programas extra',
      'Vive dentro del expediente: odontograma, radiografías y plan de tratamiento juntos',
      'Compártelos con el paciente para cerrar tratamientos',
    ],
    mockup: 'visor-stl', // arcada gris con raíces + toolbar Rotar/Medir/Marcar
  },
  {
    id: 'clinica3d', badge: 'Tu clínica en 3D',
    title: 'Un recorrido virtual que convierte curiosos en pacientes',
    desc: 'Los pacientes recorren tu clínica desde su celular antes de agendar. Confianza que se nota.',
    bullets: [
      'Diséñala tú mismo: arrastra paredes, sillones, rayos X y mobiliario',
      'Modo "En Vivo" con el estado real de cada consultorio',
      'Compártela en redes y en tu página pública',
    ],
    mockup: 'clinica-visual', // plano con "● Ana Torres · En silla", "● J. Medina · Esperando"
  },
  {
    id: 'whatsapp', badge: 'WhatsApp integrado',
    title: 'Un bot que agenda citas mientras tú atiendes',
    desc: 'Todo el WhatsApp de tu clínica en un inbox dentro del panel, en tiempo real.',
    bullets: [
      'Bot que agenda citas solo, 24/7',
      'Recordatorios y confirmaciones automáticas',
      'Recall automático de pacientes inactivos',
    ],
    mockup: 'inbox-whatsapp',
  },
  {
    id: 'ia', badge: 'Asistente IA clínico',
    title: 'Una IA que conoce tu clínica y trabaja contigo',
    desc: 'Pregúntale por pacientes, agenda o cualquier dato de tu clínica — dentro del panel, sin salir a otra app.',
    bullets: [
      'Diagnóstico diferencial y dosis de medicamentos',
      'Redacta notas SOAP y recetas con /comandos',
      'Resume historias clínicas y sugiere estudios a pedir',
    ],
    disclaimer: 'Sus sugerencias no reemplazan el criterio clínico.',
    mockup: 'asistente-ia',
  },
];

export const MODULES_TRIO = {
  title: 'Y también dominas los números, tu equipo y tu presencia en línea',
  subtitle: 'Tres módulos más, directo del panel.',
  items: [
    { id: 'analytics', title: 'Analytics que hablan claro', desc: 'Ocupación, doctores, procedimientos, no-shows, sala de espera, costos y margen — por día, mes, trimestre o año.', mockup: 'analytics' },
    { id: 'equipo', title: 'Tu equipo, con roles y permisos', desc: 'Invita doctores y admins, controla qué ve cada quien y mide citas e ingresos por doctor.', mockup: 'equipo' },
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

export const TESTIMONIALS = {
  title: 'Doctores que ya tomaron el control',
  items: [
    { initials: 'MG', name: 'Dra. Mariana Gutiérrez', role: 'Ortodoncia · Guadalajara', quote: 'Antes perdía 3 o 4 citas por semana. Con los recordatorios de WhatsApp mis pacientes confirman solos y mi agenda está llena.' },
    { initials: 'LH', name: 'Dr. Luis Hernández', role: 'Implantología · Monterrey', quote: 'Ver el CBCT desde el navegador, sin instalar nada, me cambió la consulta. Se lo muestro al paciente en 3D y el tratamiento se vende solo.' },
    { initials: 'KR', name: 'Dra. Karla Ríos', role: 'Odontopediatría · CDMX', quote: 'Dejé el Excel en una semana. Presupuesto, firma y factura salen juntos, y por fin sé cuánto ingresa mi clínica cada día.' },
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
    { q: '¿Hay permanencia o contrato anual?', a: 'No. Los planes son mes a mes y puedes cancelar cuando quieras. Si eliges el plan anual solo es para obtener el 30% de descuento, no por obligación contractual.' },
    { q: '¿Cómo funciona el pago?', a: 'Creas tu cuenta, eliges tu plan y pagas directamente desde el panel con tarjeta. Los precios están en pesos mexicanos y recibes tu factura. No manejamos periodo de prueba: eliges tu plan y empiezas a trabajar el mismo día.' },
    { q: '¿Qué pasa si necesito ayuda?', a: 'Tienes soporte en español por chat y WhatsApp. En el plan Clínica además cuentas con soporte prioritario y un onboarding dedicado para tu equipo.' },
  ],
};

export const FINAL_CTA = {
  title: 'Toma el control de tu clínica hoy mismo',
  subtitle: 'Crea tu cuenta en minutos, importa tus pacientes y empieza a llenar tu agenda. Sin permanencia.',
  ctaPrimary: 'Crear mi cuenta',   // → registro
  ctaSecondary: 'Ver funciones',   // → #funciones
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
