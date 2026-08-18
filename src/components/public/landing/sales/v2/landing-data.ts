/**
 * DaleControl — Landing page (v4): copy y datos estáticos.
 *
 * ⚠️ AQUÍ NO VIVE NINGÚN PRECIO. Los importes, cupos y límites de plan salen de
 * `plan_configs` (editable en /admin sin redeploy) vía `getResolvedPlans()` y se
 * arman en `buildPlanCards()` (plan-cards.ts). Si vuelves a escribir "$419" o
 * "500 pacientes" a mano en un .tsx de la landing, está mal.
 *
 * Fuente de verdad del diseño: disenos-landing/Landing-DaleControl.dc.html.
 */

import { PRODUCTO_MODULES, PRODUCTO_SLUGS } from '@/lib/producto/data';
import type { ProductoSlug } from '@/lib/producto/types';

export const NAV = {
  links: [
    { label: 'Funciones', href: '#funciones' },
    { label: 'Precios', href: '#precios' },
    { label: 'Comparativa', href: '#comparativa' },
    { label: 'FAQ', href: '#faq' },
    // Ruta real, no ancla: los consumidores normalizan con navHref().
    { label: 'Blog', href: '/blog' },
  ],
  login: 'Iniciar sesión',
  signup: 'Crear cuenta',
};

/**
 * NAV.links mezcla anclas de la landing ("#precios") con rutas ("/blog").
 * Las anclas se sirven desde cualquier ruta como "/#precios"; las rutas van tal
 * cual — prefijarlas daría "//blog", que el navegador lee como URL
 * protocol-relative y manda a otro host.
 */
export function navHref(href: string): string {
  if (href.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  return `/${href}`;
}

export const HERO = {
  badge: 'Datos cifrados y respaldos diarios',
  titleLead: 'El control total de tu clínica dental,',
  titleAccent: 'en un solo lugar',
  // La IA analiza radiografías 2D; el CBCT 3D es visor. No volver a juntarlos.
  subtitle:
    'Agenda, cobros, WhatsApp, CBCT 3D y análisis de radiografías con IA — todo desde tu navegador, en español y en pesos.',
  ctaPrimary: 'Empieza hoy',
  ctaSecondary: 'Ver precios',
  /** El 1.º lleva el precio del primer mes y se inyecta en el componente. */
  bullets: ['Sin permanencia', 'Sin instalar nada'],
  /**
   * Pie del prisma. Cabe SIEMPRE en una línea (antes eran 2-3), así que el <p>
   * de hero.tsx ya no reserva alto para varias — ver el comentario de ahí.
   */
  caption: 'El mejor y más avanzado ',
  captionAccent: 'panel en 2026',
};

/** Banda de prueba social: contadores que suben al entrar en pantalla. */
export const STATS: { to: number; format: 'plus-suffix' | 'plus-thousands' | 'plus-millions'; label: string }[] = [
  { to: 350, format: 'plus-suffix', label: 'clínicas nuevas en solo este mes' },
  { to: 500_000, format: 'plus-thousands', label: 'pacientes gestionados' },
  { to: 10, format: 'plus-millions', label: 'tokens de IA utilizados' },
];

export const FUNCIONES_HEADER = {
  eyebrow: 'Funciones',
  title: 'El software de clínicas más completo del mundo',
  subtitle: 'No te lo contamos: míralo. Así se ve el panel real de DaleControl por dentro.',
};

export type FuncionMockup =
  | 'agenda'
  | 'pacientes'
  | 'presupuesto'
  | 'cbct'
  | 'importar'
  | 'inbox';

export interface Funcion {
  id: string;
  /** Tarjeta con fondo oscuro (#0b1220) en vez del degradado claro. */
  dark: boolean;
  title: string;
  desc: string;
  /** Página de producto por módulo (las 8 rutas reales). */
  href: string;
  note?: string;
  mockup: FuncionMockup;
}

export const FUNCIONES: Funcion[] = [
  {
    id: 'agenda',
    dark: false,
    title: 'Agenda inteligente',
    desc: 'Llena tu agenda y olvídate de las citas perdidas: recordatorios por WhatsApp que tus pacientes sí leen.',
    href: '/software-agenda-dental',
    mockup: 'agenda',
  },
  {
    id: 'pacientes',
    dark: true,
    title: 'Pacientes y expedientes',
    desc: 'Todos tus pacientes, con su saldo a la vista y filtros listos para cobrar lo olvidado.',
    href: '/expediente-clinico-dental',
    mockup: 'pacientes',
  },
  {
    id: 'finanzas',
    dark: false,
    title: 'Finanzas completas',
    desc: 'Del presupuesto a la factura en un clic, con la firma del paciente y su estado de cuenta al día.',
    href: '/caja-y-cobros-clinica-dental',
    mockup: 'presupuesto',
  },
  {
    id: 'cbct',
    dark: true,
    title: 'Radiografías CBCT y modelos 3D',
    desc: 'Sube el DICOM de tu tomógrafo o el STL de tu escáner y míralos desde cualquier dispositivo.',
    href: '/radiografias-3d-cbct-dental',
    note: 'La IA asiste; la lectura y el diagnóstico los decide el doctor.',
    mockup: 'cbct',
  },
  {
    id: 'importar',
    dark: false,
    title: 'Importa tu clínica en 1 clic',
    desc: 'Desde Excel o tu panel anterior, con migración asistida gratis por nuestro equipo.',
    href: '/expediente-clinico-dental',
    mockup: 'importar',
  },
  {
    id: 'whatsapp-ia',
    dark: true,
    title: 'WhatsApp + Asistente IA',
    desc: 'Un bot que agenda citas 24/7 y una IA que redacta notas mientras tú atiendes.',
    href: '/software-agenda-dental',
    note: 'Las sugerencias de la IA no reemplazan el criterio clínico.',
    mockup: 'inbox',
  },
];

export const PRICING_COPY = {
  eyebrow: 'Precios',
  title: 'Un precio transparente y sin contratos',
  toggleMonthly: 'Mensual',
  toggleYearly: 'Anual',
  noContract: 'Sin permanencia · cancela cuando quieras',
  cta: '¡Contratar ahora!',
  trustChips: [
    'Sin permanencia ni contratos anuales',
    'Precios en MXN + IVA',
    'Soporte en español e inglés',
    'Página web gratuita incluida en cualquier plan',
    'Última tecnología de software en IA',
    'Datos respaldados con alta seguridad',
    'CRM incluido de tus clientes',
    'Facturación directa desde DaleControl',
  ],
};

/**
 * Banda de contacto entre precios y el trío oscuro (whatsapp-cta.tsx).
 *
 * `numberE164` va SIN "+" porque es lo que espera wa.me (misma convención que
 * account-manager-card.tsx y los templates de mini-web); `numberDisplay` es el
 * mismo número ya formateado para leerlo. Los dos salen de aquí, así que el
 * footer y el CTA no pueden desincronizarse.
 *
 * El copy no promete tiempos de respuesta: del otro lado contesta una persona
 * en horario de oficina, no un bot.
 */
export const WHATSAPP_CTA = {
  eyebrow: 'Habla con nosotros',
  title: '¿Tienes dudas? Escríbenos por WhatsApp',
  subtitle: 'Cuéntanos de tu clínica y te ayudamos a decidir si DaleControl es para ti. Sin compromiso.',
  button: 'Chatear por WhatsApp',
  numberDisplay: '+52 999 260 2093',
  numberE164: '529992602093',
  prefilledText: 'Hola, me interesa DaleControl para mi clínica dental. ¿Me pueden dar más información?',
};

export const MODULES_TRIO = {
  title: 'Y también dominas los números, tu equipo y tu presencia en línea',
  subtitle: 'Tres módulos más, directo del panel.',
  items: [
    {
      id: 'analytics',
      title: 'Analytics que hablan claro',
      desc: 'Ocupación, doctores, procedimientos, no-shows, costos y margen — por día, mes, trimestre o año.',
    },
    {
      id: 'equipo',
      title: 'Tu equipo, con roles y permisos',
      desc: 'Invita doctores y admins, controla qué ve cada quien y mide citas e ingresos por doctor.',
    },
    {
      id: 'web',
      title: 'Tu página web, lista en minutos',
      desc: 'Elige entre 4 plantillas, publica con un clic y capta pacientes con tu link propio y reseñas post-cita.',
    },
  ],
};

export const GRID_TITLE = 'Y todo lo demás, incluido';

export const GRID_FEATURES: { glyph: string; title: string; desc: string; warm?: boolean }[] = [
  { glyph: '♯', title: 'Expediente + odontograma', desc: 'Historia clínica completa con odontograma interactivo.' },
  { glyph: '▥', title: 'Portal del paciente', desc: 'Agenda, paga, chatea y descarga sus documentos.' },
  { glyph: '℞', title: 'Recetas digitales', desc: 'Recetas listas para imprimir o enviar al paciente.' },
  { glyph: '✎', title: 'Consentimientos firmados', desc: 'Firma digital de consentimientos informados.' },
  { glyph: '◈', title: 'Módulos por especialidad', desc: 'Ortodoncia, endodoncia, periodoncia, implantes y pediatría.' },
  { glyph: '★', title: 'Directorio + reseñas', desc: 'Perfil público para captar pacientes y reseñas post-cita.' },
  { glyph: '▶', title: 'TV para sala de espera', desc: 'Pantalla con turnos y contenido de tu clínica.' },
  { glyph: '⧉', title: 'Multi-sucursal', desc: 'Varias clínicas administradas desde una sola cuenta.' },
  { glyph: '⇅', title: 'Importa tus datos', desc: 'Migración asistida desde tu sistema anterior o Excel.' },
  { glyph: '🔒', title: 'Seguridad de verdad', desc: '2FA para tu staff, bitácora de auditoría y respaldos diarios.', warm: true },
  { glyph: '¢', title: 'Pagos en línea', desc: 'Tus pacientes pagan desde su celular, tú lo ves al momento.' },
  { glyph: '▣', title: 'Inventario e insumos', desc: 'Controla existencias y recibe alertas de stock bajo.' },
  { glyph: '⇄', title: 'Proveedores y compras', desc: 'Proveedores, órdenes y compras de tu clínica en un solo módulo.' },
  { glyph: '⚗', title: 'Laboratorios y órdenes', desc: 'Envía y da seguimiento a tus órdenes de laboratorio.' },
  { glyph: '⌘', title: 'Rápido de usar', desc: 'Búsqueda global Ctrl+K para ejecutar todo al instante. Con modo oscuro.' },
  { glyph: '◷', title: 'Reservas en línea 24/7', desc: 'Tus pacientes agendan solos desde tu página, a cualquier hora.' },
];

export const MODULE_PAGES_HEADER = {
  eyebrow: 'Módulos',
  title: 'Conoce cada módulo a fondo',
  subtitle: 'Cada función tiene su propia página con el detalle completo, capturas y preguntas frecuentes.',
};

/**
 * Las 8 páginas de producto por módulo. Los slugs van tipados como
 * `ProductoSlug`, así que el type-check revienta si alguien inventa una ruta
 * que no existe en src/lib/producto/data.ts.
 */
export const MODULE_PAGES: { slug: ProductoSlug; glyph: string; color: string; title: string; desc: string }[] = [
  { slug: 'software-agenda-dental', glyph: '▦', color: '#7c3aed', title: 'Agenda y recordatorios por WhatsApp', desc: 'Citas, confirmaciones y lista de espera' },
  { slug: 'expediente-clinico-dental', glyph: '♯', color: '#1d4ed8', title: 'Expediente clínico y odontograma', desc: 'Historia completa, diente por diente' },
  { slug: 'portal-del-paciente-dental', glyph: '▥', color: '#6d28d9', title: 'Portal del paciente', desc: 'Sus citas, presupuestos y estado de cuenta' },
  { slug: 'caja-y-cobros-clinica-dental', glyph: '$', color: '#047857', title: 'Caja y cobros', desc: 'Caja con PIN, pagos y corte diario' },
  { slug: 'facturacion-dental-cfdi', glyph: '▤', color: '#4338ca', title: 'Facturación', desc: 'CFDI ligado al tratamiento y al paciente' },
  { slug: 'radiografias-3d-cbct-dental', glyph: '3D', color: '#0e7490', title: 'Radiografías y estudios 3D/CBCT', desc: 'Visor en el navegador con apoyo de IA' },
  { slug: 'reportes-clinica-dental', glyph: '▲', color: '#b45309', title: 'Reportes e indicadores', desc: 'Ingresos, ocupación y productividad' },
  { slug: 'software-multiclinica-dental', glyph: '⧉', color: '#1e3a8a', title: 'Multi-sede, roles y permisos', desc: 'Varias sucursales en una sola cuenta' },
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

/** Marquee infinito (46s). Las 6 tarjetas se duplican en el componente. */
export const TESTIMONIALS = {
  title: 'Doctores que ya tomaron el control',
  items: [
    { initials: 'AS', bg: '#ede9fe', fg: '#6d28d9', role: 'Dentista general', place: 'Clínica en Puebla', quote: 'El bot de WhatsApp me agenda citas hasta en domingo por la noche. Es como tener recepcionista 24/7.' },
    { initials: 'FO', bg: '#dbeafe', fg: '#1e40af', role: 'Odontóloga', place: 'Consultorio en CDMX', quote: 'La migración era lo que más miedo me daba y tardó una tarde. Mis pacientes llegaron desde Excel sin perder nada.' },
    { initials: 'RP', bg: '#dcfce7', fg: '#15803d', role: 'Dueño de clínica', place: 'Querétaro', quote: 'Con los saldos a la vista recuperé cuentas que tenía olvidadas. Solo eso ya pagó el año completo.' },
    { initials: 'PC', bg: '#fef3c7', fg: '#b45309', role: 'Ortodoncista', place: 'Tijuana', quote: 'Mis pacientes de brackets ven su avance en el portal y pagan en línea. Los no-shows bajaron a la mitad en dos meses.' },
    { initials: 'ER', bg: '#cffafe', fg: '#0e7490', role: 'Director de clínica', place: 'Mérida', quote: 'Tengo dos sucursales y por fin veo todo en una sola cuenta: ingresos por doctor, ocupación y no-shows en tiempo real.' },
    { initials: 'SI', bg: '#fce7f3', fg: '#9d174d', role: 'Odontóloga', place: 'León', quote: 'La IA me redacta las notas SOAP mientras termino con el paciente. Me ahorro una hora de papeleo todos los días.' },
  ],
};

export const FAQ_HEADER = {
  eyebrow: 'Preguntas frecuentes',
  title: 'Lo que todos preguntan antes de empezar',
};

/**
 * El texto de la 4.ª respuesta lleva el precio del primer mes: se compone en el
 * componente con `firstMonthFrom` (plan_configs), NO escrito a mano.
 * `a` puede ser función para eso.
 */
export const FAQ_ITEMS: { q: string; a: string | ((firstMonthFrom: string) => string) }[] = [
  {
    q: '¿Mis datos y los de mis pacientes están seguros?',
    a: 'Sí. Tus datos viajan y se guardan cifrados, con respaldos diarios automáticos, verificación en dos pasos (2FA) para tu equipo y bitácora de auditoría para saber quién hizo qué.',
  },
  {
    q: 'Hoy llevo todo en libreta o Excel, ¿es difícil migrar?',
    a: 'No. Con "Importar mi clínica" subes tu Excel, revisas cómo se acomodan las columnas y confirmas; también hay migración asistida desde tu sistema anterior. En el plan Clínica el onboarding y la migración son dedicados.',
  },
  {
    q: '¿Necesito instalar algo o comprar equipo especial?',
    a: 'No. Todo funciona desde el navegador de cualquier computadora, tablet o celular — incluido el visor de radiografías CBCT y los modelos 3D. Sin instalaciones ni servidores propios.',
  },
  {
    q: '¿Hay permanencia o contrato forzoso?',
    a: (first) =>
      `No. Pagas mes a mes en pesos y cancelas cuando quieras. Tu primer mes cuesta desde ${first} según el plan que elijas, y el plan anual tiene 35% de descuento si te conviene.`,
  },
  {
    q: '¿Cómo funciona el bot de WhatsApp?',
    a: 'Conectas el WhatsApp de tu clínica y el bot atiende 24/7: agenda citas en los espacios realmente libres, manda recordatorios, registra confirmaciones y hace recall de pacientes inactivos. Tú ves todo en el inbox del panel.',
  },
  {
    q: '¿La IA hace diagnósticos por mí?',
    a: 'No. La IA asiste: resalta hallazgos en radiografías, propone diagnósticos diferenciales y redacta notas para que tú las revises. La decisión clínica siempre es del doctor.',
  },
];

export const FINAL_CTA = {
  title: 'Toma el control de tu clínica hoy mismo',
  /** El "$19" lo inyecta el componente desde plan_configs. */
  subtitleLead: 'Crea tu cuenta en minutos, importa tus pacientes y empieza a llenar tu agenda. Tu primer mes desde ',
  ctaPrimary: 'Crear mi cuenta',
  ctaSecondary: 'Ver funciones',
  bullets: '✓ Datos cifrados · ✓ Respaldos diarios · ✓ Soporte en español',
};

export const FOOTER = {
  blurb: 'El software dental más completo de México. Agenda, expediente, WhatsApp y facturación CFDI 4.0 en una sola plataforma.',
  // El footer es un superconjunto del nav, no un espejo: arranca de NAV.links
  // (anclas + Blog) y añade las rutas de SEO que a propósito NO están en el
  // menú para no alargarlo. Ambos consumidores normalizan con navHref().
  product: [
    ...NAV.links,
    { label: 'Casos de uso', href: '/casos-de-uso' },
    { label: 'Herramientas gratuitas', href: '/herramientas' },
    { label: 'Programa de afiliados', href: '/afiliados' },
  ],
  // Grupo "Funciones": las 8 páginas de producto por módulo. El nombre y el
  // slug salen de src/lib/producto/data.ts, así que no hay copia que se
  // desincronice.
  funciones: PRODUCTO_SLUGS.map((slug) => ({
    label: PRODUCTO_MODULES[slug].name,
    href: `/${slug}`,
  })),
  legal: [
    { label: 'Aviso de privacidad', href: '/privacidad' },
    { label: 'Términos y condiciones', href: '/terminos' },
    { label: 'Términos del programa de afiliados', href: '/terminos-afiliados' },
  ],
  // Sólo canales que existen de verdad, nunca href="#": un ancla vacía deja al
  // usuario dando un salto al inicio de la página. Por eso Facebook sigue
  // fuera. WhatsApp SÍ entra desde que hay número real: el mismo de
  // WHATSAPP_CTA, para que el footer y la banda de contacto no se
  // desincronicen. El handle de Instagram es el mismo que ya declara
  // landing/footer.tsx.
  contact: [
    { label: `WhatsApp ${WHATSAPP_CTA.numberDisplay}`, href: `https://wa.me/${WHATSAPP_CTA.numberE164}` },
    { label: 'hola@dalecontrol.com', href: 'mailto:hola@dalecontrol.com' },
    { label: 'soporte@dalecontrol.com', href: 'mailto:soporte@dalecontrol.com' },
    { label: 'Instagram', href: 'https://instagram.com/dalecontrol.mx' },
  ],
  copyright: '© 2026 DaleControl. Todos los derechos reservados.',
  madeIn: 'Hecho en México 🇲🇽',
};

export const fmtMXN = (n: number) => '$' + n.toLocaleString('es-MX');
