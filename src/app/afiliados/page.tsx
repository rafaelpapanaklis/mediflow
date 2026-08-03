import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/blog/json-ld";
import { CalculadoraAfiliados } from "@/components/afiliados/landing/calculadora";
import {
  EscenaAnillos,
  EscenaPila,
  EscenaPrisma,
  type CaraDato,
  type CaraPrisma,
  type TarjetaPila,
} from "@/components/afiliados/landing/escenas";
import { fmtMxn, getPublicOffer } from "@/lib/affiliates/public-offer";
import type { PlanKey } from "@/lib/affiliates/payout-core";
import "./afiliados.css";

// Mismos pesos que la landing v4 (400–800): al coincidir la configuración,
// next/font sirve EL MISMO archivo que ya cachea la home. Ni una fuente extra.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const TITLE = "Programa de afiliados: gana comisiones recomendando DaleControl";
const DESCRIPTION =
  "Gana una comisión recurrente cada mes por cada clínica dental que recomiendes a DaleControl, mientras siga suscrita. Entrar es gratis, sin exclusividad, con pagos por SPEI o PayPal.";

export const metadata: Metadata = buildMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/afiliados",
  // Misma OG dinámica que el blog, los casos de uso y las herramientas.
  ogImage: `${SITE_URL}/og/blog?title=${encodeURIComponent(TITLE)}`,
  keywords: [
    "programa de afiliados software dental México",
    "ganar dinero recomendando software médico",
    "programa de socios para clínicas",
    "comisión recurrente software dental",
    "afiliados software para consultorios dentales",
  ],
});

// ─────────────────────────────────────────────────────────────────────────────
// /afiliados — landing pública del programa de afiliados.
//
// NINGÚN monto está escrito en este archivo. Todo sale de `getPublicOffer()`:
// los precios de los planes de plan_configs y las seis comisiones de
// affiliate_payout_config, así que si el admin mueve un monto la página lo
// refleja sin deploy. Eso incluye las cifras que aparecen DENTRO de las
// escenas 3D, la prosa de la comparación a 3 años y los tres perfiles de
// ejemplo: todos se calculan, ninguno se teclea. `getPublicOffer()` nunca
// lanza: sin BD cae a los defaults del motor.
//
// CACHÉ: la página es estática con ISR, y quien de verdad la mantiene al día es
// la revalidación BAJO DEMANDA — guardar en /admin/affiliates dispara
// `revalidateAffiliateLanding()` (ver @/lib/cache/public-pricing) y esta página
// se regenera en la siguiente visita. Lo mismo hace el editor de planes cuando
// cambia un precio.
//
// El temporizador de 60 s es sólo la RED DE SEGURIDAD para los cambios que NO
// pasan por el admin (un UPDATE directo en Supabase). Bajarlo de 300 a 60 no
// cuesta rendimiento: la regeneración son dos SELECT (payout config + planes) y
// las visitas siguen sirviéndose siempre desde el caché.
// ─────────────────────────────────────────────────────────────────────────────
export const revalidate = 60;

/**
 * "El cobro en el que arranca la comisión", en palabras. El ordinal se deriva
 * de la config (`startAtInvoiceNo`), nunca se escribe: si el admin lo mueve a
 * 3, la página dice "tercer cobro" sola.
 */
function cobroOrdinal(n: number): string {
  if (n === 1) return "primer cobro";
  if (n === 2) return "segundo cobro";
  if (n === 3) return "tercer cobro";
  return `cobro número ${n}`;
}

// ── Estilos compartidos ──────────────────────────────────────────────────────
const WRAP: React.CSSProperties = { maxWidth: 1140, margin: "0 auto", padding: "clamp(52px,7vw,88px) 20px" };
const KICKER: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#2563eb" };
const H2: React.CSSProperties = { marginTop: 10, fontSize: "clamp(26px,3.6vw,38px)", lineHeight: 1.15, letterSpacing: "-0.02em", fontWeight: 800 };
const LEDE: React.CSSProperties = { marginTop: 12, fontSize: 16, color: "#475569" };
const CTA_AZUL: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 50, padding: "13px 28px", background: "#2563eb", color: "#ffffff", fontWeight: 700, fontSize: 16, borderRadius: 12, boxShadow: "0 6px 16px rgba(37,99,235,.25)" };
const CHIP: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #dbeafe", padding: "2px 9px", borderRadius: 999 };
const TARJETA: React.CSSProperties = { border: "1px solid #e2e8f0", borderRadius: 18, padding: 24, background: "#ffffff", boxShadow: "0 1px 3px rgba(15,23,42,.05)", minWidth: 0 };

function Encabezado({ kicker, titulo, lede, ancho = 640 }: { kicker: string; titulo: string; lede?: string; ancho?: number }) {
  return (
    <div style={{ textAlign: "center", maxWidth: ancho, margin: "0 auto" }}>
      <span style={KICKER}>{kicker}</span>
      <h2 className="dcaf-balance" style={H2}>{titulo}</h2>
      {lede && <p style={LEDE}>{lede}</p>}
    </div>
  );
}

function Ico({ size = 21, color = "#2563eb", children }: { size?: number; color?: string; children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** Trazos de los iconos del diseño (SVG inline: cero JS, cero dependencias). */
const P = {
  caja: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5" /><path d="M12 12v9" /></>),
  maletin: (<><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M3 12h18" /></>),
  diente: (<path d="M7 3C4.8 3 3 4.9 3 7.3c0 4.2 1.9 5.2 2.4 8.2l.7 4.1c.1.6 1 .6 1.2 0L9 13.5h6l1.7 6.1c.2.6 1.1.6 1.2 0l.7-4.1c.5-3 2.4-4 2.4-8.2C21 4.9 19.2 3 17 3c-2 0-2.6 1-5 1s-3-1-5-1z" />),
  enlace: (<><path d="M10 14a5 5 0 0 0 7.07 0l2.86-2.86a5 5 0 0 0-7.07-7.07L11.2 5.73" /><path d="M14 10a5 5 0 0 0-7.07 0l-2.86 2.86a5 5 0 0 0 7.07 7.07l1.66-1.66" /></>),
  red: (<><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="5.5" r="2.6" /><circle cx="18" cy="18.5" r="2.6" /><path d="M8.4 10.8l7.2-4.1" /><path d="M8.4 13.2l7.2 4.1" /></>),
  cupon: (<><path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.5a2.5 2.5 0 0 0 0 5V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.5a2.5 2.5 0 0 0 0-5z" /><path d="M14 6v12" strokeDasharray="2.5 3" /></>),
  barras: (<><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M2 20h20" /></>),
  carpeta: (<path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />),
  personas: (<><circle cx="9" cy="8" r="3.4" /><path d="M2.8 19a6.4 6.4 0 0 1 12.4 0" /><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6" /><path d="M17.6 13.4A6.4 6.4 0 0 1 21.4 19" /></>),
  matraz: (<><path d="M9 3h6" /><path d="M10 3v5.2L4.6 17.8A2 2 0 0 0 6.4 21h11.2a2 2 0 0 0 1.8-3.2L14 8.2V3" /><path d="M7.5 14h9" /></>),
  edificio: (<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 7h7" /><path d="M8.5 11.5h.01" /><path d="M12 11.5h.01" /><path d="M15.5 11.5h.01" /><path d="M8.5 15h.01" /><path d="M12 15h.01" /><path d="M15.5 15h.01" /></>),
  megafono: (<><path d="M3 11v2a1 1 0 0 0 1 1h3l11 5V5L7 10H4a1 1 0 0 0-1 1z" /><path d="M8 14v5a1 1 0 0 0 1 1h2v-5.5" /></>),
};

function Palomita({ color = "#4ade80", size = 16 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 13l4 4 10-10" />
    </svg>
  );
}

// ── Contenido estático (sin una sola cifra) ─────────────────────────────────
const HERRAMIENTAS = [
  { icono: P.enlace, t: "Link personal", d: "Con tu nombre, listo para compartir donde sea." },
  { icono: P.red, t: "Links por campaña", d: "Uno por canal, para saber qué te funciona mejor." },
  { icono: P.cupon, t: "Cupón propio", d: "Al activarlo, tu código acredita la venta aunque no usen tu link." },
  { icono: P.barras, t: "Panel con tus números", d: "Clics, altas, clínicas activas y comisiones." },
  { icono: P.carpeta, t: "Kit de materiales listos", d: "Copys para WhatsApp y redes, plantillas de correo y respuestas a objeciones." },
  { icono: P.personas, t: "Equipo de vendedores", d: "Registra a tu propia gente y asígnale su porcentaje." },
];

const AUDIENCIA = [
  { icono: P.caja, t: "Distribuidores de insumos", d: "Convierte cada visita de rutina en un ingreso extra." },
  { icono: P.matraz, t: "Laboratorios dentales", d: "Recomienda a las clínicas que ya te mandan trabajo." },
  { icono: P.edificio, t: "Consultores y contadores", d: "Suma valor a las clínicas que ya asesoras." },
  { icono: P.diente, t: "Dentistas con red de colegas", d: "Tu recomendación pesa más que cualquier anuncio." },
  { icono: P.megafono, t: "Agencias de marketing médico", d: "Ofrece el software como parte de tu servicio." },
];

interface PerfilCtx {
  total: number;
  desglose: string;
  primerLabel: string;
}

/**
 * Escenarios ILUSTRATIVOS — no testimonios, no clientes reales. De ahí la
 * etiqueta visible en cada tarjeta y los verbos en condicional. Las cifras se
 * CALCULAN con `mix` y los montos de la config: si el admin sube el fijo del
 * plan Profesional, estos totales suben solos.
 */
const PERFILES: {
  titulo: string;
  lugar: string;
  icono: React.ReactNode;
  mix: { key: PlanKey; n: number }[];
  frase: (c: PerfilCtx) => string;
}[] = [
  {
    titulo: "Distribuidor de insumos dentales",
    lugar: "Guadalajara, Jalisco",
    icono: P.caja,
    mix: [{ key: "PRO", n: 8 }, { key: "BASIC", n: 4 }],
    frase: (c) => `Visita consultorios todos los días. Si en 6 meses colocara ${c.total} clínicas — ${c.desglose} —`,
  },
  {
    titulo: "Consultora de administración de consultorios",
    lugar: "Monterrey, Nuevo León",
    icono: P.maletin,
    mix: [{ key: "CLINIC", n: 5 }],
    frase: (c) => `Trabaja con pocas cuentas, pero grandes. Si en 6 meses sumara ${c.total} clínicas del plan ${c.primerLabel} —`,
  },
  {
    titulo: "Dentista con red de colegas",
    lugar: "Puebla, Puebla",
    icono: P.diente,
    mix: [{ key: "PRO", n: 6 }],
    frase: (c) => `Recomienda a compañeros de generación. Si en 6 meses convenciera a ${c.total} clínicas del plan ${c.primerLabel} —`,
  },
];

/** Nombres de la escena 2 (mock decorativo, `aria-hidden`). */
const PILA_MIX: PlanKey[] = ["PRO", "BASIC", "CLINIC", "PRO"];
const PILA_NOMBRES = ["Dental Río Lerma", "Clínica Sonrisa Norte", "Odonto Integral", "Consultorio Vega"];

export default async function AfiliadosPage() {
  const offer = await getPublicOffer();

  // Índice por plan. Con un `new Map(arr.map(...))` TS infiere el literal como
  // array y no como tupla, y el Map cae a <unknown, unknown>.
  const byKey: Partial<Record<PlanKey, (typeof offer.plans)[number]>> = {};
  for (const p of offer.plans) byKey[p.key] = p;

  // Un plan apagado en la config (sin fijo NI pago único) no se lista: mejor
  // omitirlo que imprimir "$0".
  const visibles = offer.plans.filter((p) => p.recurringMxn > 0 || p.oneTimeMxn > 0);

  const arranque = cobroOrdinal(offer.startAtInvoiceNo);
  // Cobros de cada clínica que NO comisionan: el "−1" de todas las fórmulas
  // de la página sale de aquí, jamás de un literal.
  const skip = Math.max(0, offer.startAtInvoiceNo - 1);
  const hayMesPromocional = skip > 0;
  const puedeElegirModalidad = offer.cfg.allowAffiliateChoice !== false;

  const arranqueTexto = hayMesPromocional
    ? `Desde el ${arranque} de la clínica: su primer mes entra con precio promocional, así que ese cobro no genera comisión. Si contrata el plan anual, comisiona desde su primera factura —ahí no hay mes promocional— y esos 12 meses te llegan en un solo pago.`
    : `Desde el ${arranque} de la clínica.`;

  // ── Escena 1: las seis caras del prisma ────────────────────────────────
  const conRecurrente = offer.plans.filter((p) => p.recurringMxn > 0);
  const CARAS_DATO: CaraDato[] = [
    { tipo: "dato", icono: "link", titulo: "Link personal", nota: "con tu nombre" },
    { tipo: "dato", icono: "panel", titulo: "Tu panel", nota: "clics, altas y comisiones" },
    { tipo: "dato", icono: "cupon", titulo: "Cupón propio", nota: "cuenta aunque no usen tu link" },
  ];
  const caras: CaraPrisma[] = [];
  for (let i = 0; i < 3; i++) {
    const plan = conRecurrente[i];
    if (plan) {
      caras.push({
        tipo: "monto",
        monto: fmtMxn(plan.recurringMxn),
        unidad: "al mes",
        nota: `por clínica del plan ${plan.label}`,
      });
    }
    caras.push(CARAS_DATO[i]);
  }
  // El prisma es hexagonal: con menos de seis caras quedaría abierto.
  while (caras.length < 6) caras.push(CARAS_DATO[caras.length % 3]);

  // ── La idea en una frase: una clínica, las dos modalidades, a 3 años ────
  const ANIOS_REF = 3;
  const mesesRef = Math.max(0, 12 * ANIOS_REF - skip);
  const ref =
    offer.plans.find((p) => p.key === "PRO" && p.recurringMxn > 0 && p.oneTimeMxn > 0) ??
    offer.plans.find((p) => p.recurringMxn > 0 && p.oneTimeMxn > 0);
  const refAcum = ref ? ref.recurringMxn * mesesRef : 0;
  const refUnico = ref ? ref.oneTimeMxn : 0;
  const refMax = Math.max(refAcum, refUnico, 1);
  const ALTO_BARRA = 150;
  const altoAcum = Math.max(6, Math.round((refAcum / refMax) * ALTO_BARRA));
  const altoUnico = Math.max(6, Math.round((refUnico / refMax) * ALTO_BARRA));
  const formulaRef = hayMesPromocional
    ? `${mesesRef} cobros = 12 × ${ANIOS_REF} − ${skip}. El primer mes de la clínica tiene precio promocional y no comisiona.`
    : `${mesesRef} cobros = 12 × ${ANIOS_REF}: cada cobro de la clínica comisiona.`;

  // ── Escena 2: la pila de clínicas y su fijo mensual ─────────────────────
  const tarjetasPila: TarjetaPila[] = [];
  let totalPila = 0;
  PILA_MIX.forEach((key, i) => {
    const plan = byKey[key];
    if (!plan || plan.recurringMxn <= 0) return;
    tarjetasPila.push({
      nombre: PILA_NOMBRES[i],
      detalle: `${plan.label} · fijo de ${fmtMxn(plan.recurringMxn)}/mes`,
    });
    totalPila += plan.recurringMxn;
  });

  // ── Los tres perfiles de ejemplo, calculados ───────────────────────────
  const perfiles = PERFILES.map((perfil) => {
    const partes = perfil.mix
      .map((m) => ({ n: m.n, plan: byKey[m.key] }))
      .filter((x) => x.plan && x.plan.recurringMxn > 0);
    let mensual = 0;
    let total = 0;
    for (const parte of partes) {
      mensual += parte.n * parte.plan!.recurringMxn;
      total += parte.n;
    }
    return {
      ...perfil,
      mensual,
      acumulado: mensual * mesesRef,
      chips: partes.map((x) => `${x.n} × ${x.plan!.label} (${fmtMxn(x.n * x.plan!.recurringMxn)})`),
      ctx: {
        total,
        desglose: partes.map((x) => `${x.n} ${x.plan!.label}`).join(" y "),
        primerLabel: partes[0]?.plan?.label ?? "",
      } as PerfilCtx,
    };
  }).filter((p) => p.mensual > 0);

  // ── Cómo funciona: los seis pasos ──────────────────────────────────────
  const PASOS = [
    {
      t: "Regístrate gratis",
      chip: "2 minutos",
      d: "Formulario corto: nombre, correo, contraseña y cómo quieres cobrar —SPEI o PayPal, o lo defines después—. No se pide tarjeta ni ningún pago de entrada.",
    },
    {
      t: "Revisamos tu solicitud",
      chip: "Aprobación manual",
      d: "Revisamos cada alta, una por una, para cuidar la calidad del programa. Te avisamos por correo en cuanto tu cuenta esté lista; no tienes que hacer nada mientras tanto.",
    },
    {
      t: "Recibes tus herramientas",
      chip: "Al aprobarte",
      d: "Un link personal con tu nombre y links separados por canal, para saber si te funciona mejor WhatsApp o Facebook. También pides tu cupón: al activarlo, tu código acredita la venta aunque la clínica no pase por tu link.",
      cta: true,
    },
    {
      t: "Compartes con clínicas",
      chip: "A tu ritmo",
      d: "Con materiales listos para usar: copys para WhatsApp y redes, plantillas de correo y respuestas a las objeciones más comunes. No tienes que redactar nada desde cero.",
    },
    {
      t: "Sigues todo desde tu panel",
      chip: "Sin preguntar por correo",
      d: "Clics, altas, clínicas activas y clínicas pagando, más tu estado de cuenta descargable en PDF y tu proyección mensual. Nada queda a ciegas.",
    },
    {
      t: "Cobras",
      chip: "Días 1–10 de cada mes",
      chipVerde: true,
      d: "Las comisiones de un mes se pagan dentro de los primeros 10 días del mes siguiente, por SPEI o PayPal, según lo que hayas elegido.",
      ctaFinal: true,
    },
  ];

  // ── FAQ ────────────────────────────────────────────────────────────────
  // Vive aquí (server) y alimenta al MISMO tiempo el acordeón y el JSON-LD de
  // FAQPage: imposible que lo que ve Google y lo que ve el visitante se
  // desincronicen. Un FAQPage que no corresponde al contenido visible es una
  // violación de las guías de Google.
  const faq: { q: string; a: string }[] = [
    {
      q: "¿Cuándo me pagan?",
      a: "Las comisiones de un mes se pagan dentro de los primeros 10 días del mes siguiente, por SPEI o PayPal.",
    },
    {
      q: "¿Por cuánto tiempo cobro?",
      a: "Con la modalidad de fijo recurrente, mientras la clínica siga pagando su plan. No hay límite de tiempo ni tope de meses.",
    },
    {
      q: "¿Cuándo empieza a contar la comisión?",
      a: arranqueTexto,
    },
    {
      q: "¿Qué pasa si la clínica cancela?",
      a: "Dejas de cobrar por esa clínica desde ese momento. Lo ya pagado es tuyo y tus demás clínicas no se afectan.",
    },
    {
      q: "¿Cuánto cuesta entrar?",
      a: "Nada. El registro es gratis, sin exclusividad y sin compromisos de venta mínima.",
    },
    {
      q: "¿Necesito ser dentista?",
      a: "No. Cualquier persona o empresa que ya trate con clínicas —distribuidores, consultores, contadores, laboratorios o agencias— puede participar.",
    },
    {
      q: "¿Puedo tener un equipo de vendedores?",
      a: "Sí. Desde tu panel das de alta a tu propia gente y le asignas a cada quien su porcentaje de la comisión.",
    },
    {
      q: "¿Cómo sé que se me cuenta bien?",
      a: "Tu panel muestra clics, altas, clínicas activas y comisiones, y puedes descargar tu estado de cuenta en PDF cuando quieras.",
    },
    {
      q: "¿Puedo referirme a mí mismo?",
      a: "No. Si el alta usa tu propio correo, el sistema anula la atribución y esa venta no genera comisión: el programa es para traer clínicas nuevas.",
    },
    {
      q: "¿Cómo me pagan?",
      a: "Por transferencia SPEI o por PayPal. Eliges cómo cobrar al registrarte —o después— y puedes cambiarlo cuando quieras desde tu panel.",
    },
    {
      q: "¿Puedo cambiar de modalidad?",
      a: puedeElegirModalidad
        ? "Sí, desde tu panel. El cambio aplica solo a las clínicas que des de alta después: las ya registradas conservan la modalidad con la que entraron."
        : "La modalidad la define el programa y se congela por clínica al darla de alta: las que ya registraste conservan la que tenían.",
    },
  ];

  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  const webPageLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: TITLE,
    description: DESCRIPTION,
    url: `${SITE_URL}/afiliados`,
    inLanguage: "es-MX",
    isPartOf: { "@type": "WebSite", name: "DaleControl", url: `${SITE_URL}/` },
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Programa de afiliados", item: `${SITE_URL}/afiliados` },
    ],
  };

  return (
    <div
      className={`dcaf-root ${inter.variable}`}
      style={{
        minHeight: "100dvh",
        fontFamily: "var(--font-inter), Inter, system-ui, -apple-system, sans-serif",
        color: "#0f172a",
        background: "#ffffff",
        fontSize: 16,
        lineHeight: 1.6,
      }}
    >
      <a href="#dcaf-main" className="mf-skip-link">Saltar al contenido</a>
      <SalesNavSession affiliate />

      <main id="dcaf-main" className="dcaf-main">
        {/* ── 1. Hero ──────────────────────────────────────────────────── */}
        <section
          className="dcaf-dark"
          style={{
            overflow: "hidden",
            backgroundColor: "#080d1a",
            backgroundImage:
              "radial-gradient(circle at 10% 6%,rgba(37,99,235,.3) 0%,rgba(37,99,235,0) 42%),radial-gradient(circle at 90% 10%,rgba(109,40,217,.32) 0%,rgba(109,40,217,0) 44%),radial-gradient(rgba(148,163,184,.13) 1px,transparent 1.4px)",
            backgroundSize: "auto,auto,26px 26px",
          }}
        >
          <div className="dcaf-herogrid" style={{ ...WRAP, padding: "clamp(44px,7vw,84px) 20px clamp(40px,6vw,72px)" }}>
            <div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(109,40,217,.16)", border: "1px solid rgba(139,92,246,.4)", color: "#c4b5fd", fontSize: 13, fontWeight: 700, padding: "6px 12px", borderRadius: 999 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#8b5cf6", display: "inline-block" }} />
                Programa de afiliados de DaleControl
              </span>

              <h1 className="dcaf-balance" style={{ marginTop: 18, fontSize: "clamp(33px,5.2vw,54px)", lineHeight: 1.08, letterSpacing: "-0.02em", fontWeight: 800, color: "#ffffff" }}>
                Recomienda DaleControl y cobra{" "}
                <span style={{ background: "linear-gradient(90deg,#60a5fa,#a78bfa)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                  cada mes
                </span>
                , no una sola vez
              </h1>

              <p className="dcaf-pretty" style={{ marginTop: 18, fontSize: "clamp(16px,2vw,18px)", lineHeight: 1.6, color: "#94a3b8", maxWidth: 560 }}>
                Por cada clínica dental que traes, recibes un fijo mensual que se paga{" "}
                <strong style={{ color: "#ffffff" }}>mientras esa clínica siga siendo cliente</strong> — sin
                límite de tiempo ni tope de meses. O, si lo prefieres, un pago único por venta.
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 28 }}>
                <Link href="/afiliados/registro" className="dcaf-btn-blue" style={CTA_AZUL}>
                  Registrarme gratis
                </Link>
                <a href="#calculadora" className="dcaf-btn-ghostdark" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 50, padding: "13px 24px", background: "rgba(15,23,42,.55)", border: "1.5px solid rgba(148,163,184,.35)", color: "#e2e8f0", fontWeight: 700, fontSize: 16, borderRadius: 12 }}>
                  Ver cuánto ganaría
                </a>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 22px", marginTop: 24 }}>
                {["Entrar es gratis", "Sin exclusividad", "Pagos por SPEI o PayPal"].map((t) => (
                  <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 14, color: "#94a3b8", fontWeight: 600 }}>
                    <Palomita /> {t}
                  </span>
                ))}
              </div>
            </div>

            <EscenaPrisma caras={caras} />
          </div>
        </section>

        {/* ── 2. La idea en una frase ──────────────────────────────────── */}
        {ref && (
          <section style={{ background: "#eff6ff", borderTop: "1px solid #dbeafe", borderBottom: "1px solid #dbeafe" }}>
            <div style={{ ...WRAP, padding: "clamp(48px,7vw,80px) 20px" }}>
              <Encabezado
                kicker="La idea en una frase"
                titulo="No es cuánto pagamos: es que se repite"
                lede={`El mismo ejemplo — una clínica del plan ${ref.label} — visto a ${ANIOS_REF} años.`}
              />

              <div style={{ maxWidth: 820, margin: "36px auto 0", background: "#ffffff", border: "1px solid #dbeafe", borderRadius: 20, padding: "clamp(22px,4vw,36px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 28 }}>
                <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 12, textAlign: "center", minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em" }}>
                    Comisión de una sola vez
                  </span>
                  <span style={{ fontSize: "clamp(34px,4.5vw,46px)", fontWeight: 800, letterSpacing: "-0.02em", color: "#64748b", overflowWrap: "anywhere" }}>
                    {fmtMxn(refUnico)}
                  </span>
                  <div style={{ height: ALTO_BARRA, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                    <div style={{ width: "min(160px,70%)", height: altoUnico, background: "#cbd5e1", borderRadius: "8px 8px 3px 3px" }} />
                  </div>
                  <span style={{ fontSize: 14, color: "#64748b" }}>
                    A los {ANIOS_REF} años… sigue siendo <strong style={{ color: "#475569" }}>{fmtMxn(refUnico)}</strong>.
                  </span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 12, textAlign: "center", minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: ".05em" }}>
                    Fijo recurrente de {fmtMxn(ref.recurringMxn)} al mes
                  </span>
                  <span style={{ fontSize: "clamp(34px,4.5vw,46px)", fontWeight: 800, letterSpacing: "-0.02em", color: "#1d4ed8", overflowWrap: "anywhere" }}>
                    {fmtMxn(refAcum)}
                  </span>
                  <div style={{ height: ALTO_BARRA, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
                    <div style={{ width: "min(160px,70%)", height: altoAcum, background: "linear-gradient(180deg,#60a5fa,#2563eb)", borderRadius: "8px 8px 3px 3px", boxShadow: "0 8px 20px rgba(37,99,235,.25)" }} />
                  </div>
                  <span style={{ fontSize: 14, color: "#475569" }}>
                    A los {ANIOS_REF} años ya llevas <strong style={{ color: "#1d4ed8" }}>{fmtMxn(refAcum)}</strong> — y
                    sigue corriendo.
                  </span>
                </div>
              </div>

              <p style={{ textAlign: "center", fontSize: 13, color: "#64748b", marginTop: 16 }}>{formulaRef}</p>
            </div>
          </section>
        )}

        {/* ── 3. Comisiones ────────────────────────────────────────────── */}
        <section id="comisiones" className="dcaf-anchor" style={{ background: "#ffffff" }}>
          <div style={WRAP}>
            <Encabezado
              kicker="Comisiones"
              titulo="Lo que ganas por cada clínica"
              lede="Dos modalidades. Eliges una por cada clínica al darla de alta."
            />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,272px),1fr))", gap: 20, marginTop: 44 }}>
              {visibles.map((plan) => (
                <div key={plan.key} style={{ ...TARJETA, position: "relative", padding: "26px 24px" }}>
                  {plan.key === "PRO" && (
                    <span style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: "#dbeafe", color: "#1d4ed8", fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 999, whiteSpace: "nowrap" }}>
                      La más común
                    </span>
                  )}

                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                    <h3 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.01em" }}>{plan.label}</h3>
                    {plan.priceMxn > 0 && (
                      <span style={{ fontSize: 13, color: "#64748b" }}>
                        plan de <strong style={{ color: "#475569" }}>{fmtMxn(plan.priceMxn)}/mes</strong>
                      </span>
                    )}
                  </div>

                  {plan.recurringMxn > 0 && (
                    <div style={{ marginTop: 18, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 13, padding: 16, textAlign: "center" }}>
                      <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#1d4ed8" }}>
                        Fijo recurrente
                      </span>
                      <span style={{ display: "block", marginTop: 4, fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", color: "#1d4ed8", overflowWrap: "anywhere" }}>
                        {fmtMxn(plan.recurringMxn)}{" "}
                        <span style={{ fontSize: 15, fontWeight: 700, color: "#475569" }}>al mes</span>
                      </span>
                      <span style={{ display: "block", fontSize: 12.5, color: "#475569", marginTop: 2 }}>
                        mientras la clínica siga activa
                      </span>
                    </div>
                  )}

                  {plan.recurringMxn > 0 && plan.oneTimeMxn > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "12px 0" }}>
                      <span style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
                      <span style={{ width: 30, height: 30, borderRadius: "50%", border: "1px solid #e2e8f0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#94a3b8", background: "#ffffff" }}>
                        o
                      </span>
                      <span style={{ flex: 1, height: 1, background: "#e2e8f0" }} />
                    </div>
                  )}

                  {plan.oneTimeMxn > 0 && (
                    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 13, padding: 16, textAlign: "center", marginTop: plan.recurringMxn > 0 ? 0 : 18 }}>
                      <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "#64748b" }}>
                        Pago único
                      </span>
                      <span style={{ display: "block", marginTop: 4, fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", color: "#0f172a", overflowWrap: "anywhere" }}>
                        {fmtMxn(plan.oneTimeMxn)}{" "}
                        <span style={{ fontSize: 15, fontWeight: 700, color: "#64748b" }}>una vez</span>
                      </span>
                      <span style={{ display: "block", fontSize: 12.5, color: "#64748b", marginTop: 2 }}>no se repite</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Aviso honesto: bien visible, no en letra chica. */}
            <div style={{ maxWidth: 820, margin: "28px auto 0", background: "#f8fafc", border: "1px solid #e8edf4", borderRadius: 14, padding: "18px 22px", display: "flex", gap: 14, alignItems: "flex-start" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 3 }} aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v5" />
                <path d="M12 8h.01" />
              </svg>
              <div style={{ fontSize: 14, color: "#475569", lineHeight: 1.6, minWidth: 0 }}>
                <p>
                  <strong style={{ color: "#0f172a" }}>La comisión arranca en el {arranque} de la clínica.</strong>{" "}
                  {hayMesPromocional ? (
                    <>
                      Su primer mes tiene precio promocional y por eso no comisiona. Si contrata el plan
                      anual, comisionas desde su primera factura —ahí no hay mes promocional— y recibes
                      los 12 meses en un solo pago.
                    </>
                  ) : (
                    <>Cada cobro de la clínica genera comisión desde el arranque.</>
                  )}
                </p>
                <p style={{ marginTop: 8 }}>
                  {puedeElegirModalidad
                    ? "La modalidad se fija por clínica al darla de alta. Si la cambias después, aplica solo a tus clínicas nuevas."
                    : "La modalidad la define el programa y se fija por clínica al darla de alta."}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 4. Calculadora ───────────────────────────────────────────── */}
        <section id="calculadora" className="dcaf-anchor" style={{ background: "#f8fafc", borderTop: "1px solid #e8edf4", borderBottom: "1px solid #e8edf4" }}>
          <div style={WRAP}>
            <Encabezado
              kicker="Calculadora"
              titulo="Saca tus propias cuentas"
              lede="Ajusta las clínicas y el horizonte. Todo se recalcula en vivo."
            />
            <CalculadoraAfiliados plans={offer.plans} cobrosSinComision={skip} aniosIniciales={5} />
          </div>
        </section>

        {/* ── 5. Perfiles de ejemplo ───────────────────────────────────── */}
        {perfiles.length > 0 && (
          <section style={{ background: "#ffffff" }}>
            <div style={WRAP}>
              <Encabezado
                kicker="Escenarios"
                titulo="Tres perfiles, tres cuentas claras"
                lede="Ejemplos ilustrativos con las comisiones reales de la tabla. No son testimonios ni clientes reales."
                ancho={660}
              />

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,280px),1fr))", gap: 20, marginTop: 40 }}>
                {perfiles.map((perfil) => (
                  <div key={perfil.titulo} style={{ ...TARJETA, display: "flex", flexDirection: "column", gap: 14 }}>
                    <span style={{ alignSelf: "flex-start", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".07em", color: "#64748b", background: "#f1f5f9", border: "1px solid #e2e8f0", padding: "4px 10px", borderRadius: 999 }}>
                      Ejemplo ilustrativo
                    </span>

                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 46, height: 46, borderRadius: "50%", background: "#eff6ff", border: "1px solid #dbeafe", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Ico size={22}>{perfil.icono}</Ico>
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{perfil.titulo}</div>
                        <div style={{ fontSize: 13, color: "#64748b" }}>{perfil.lugar}</div>
                      </div>
                    </div>

                    <p style={{ fontSize: 14.5, color: "#475569", lineHeight: 1.6 }}>{perfil.frase(perfil.ctx)}</p>

                    <div>
                      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.02em", color: "#1d4ed8", overflowWrap: "anywhere" }}>
                        {fmtMxn(perfil.mensual)}{" "}
                        <span style={{ fontSize: 16, color: "#475569", fontWeight: 700 }}>al mes</span>
                      </div>
                      <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
                        estaría cobrando, mientras esas clínicas sigan activas
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {perfil.chips.map((chip) => (
                        <span key={chip} style={{ fontSize: 12, fontWeight: 600, color: "#475569", background: "#f8fafc", border: "1px solid #e2e8f0", padding: "3px 10px", borderRadius: 999 }}>
                          {chip}
                        </span>
                      ))}
                    </div>

                    <div style={{ marginTop: "auto", borderTop: "1px solid #f1f5f9", paddingTop: 12, display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontSize: 13, color: "#64748b" }}>Acumulado a {ANIOS_REF} años</span>
                      <span style={{ fontSize: 17, fontWeight: 800, color: "#15803d" }}>{fmtMxn(perfil.acumulado)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <p style={{ textAlign: "center", fontSize: 12.5, color: "#94a3b8", marginTop: 18 }}>
                Acumulados a {ANIOS_REF} años con la fórmula de la calculadora: fijo mensual ×{" "}
                {mesesRef} cobros {hayMesPromocional ? `(12 × ${ANIOS_REF} − ${skip})` : `(12 × ${ANIOS_REF})`}.
              </p>
            </div>
          </section>
        )}

        {/* ── 6. Cómo funciona ─────────────────────────────────────────── */}
        <section id="como-funciona" className="dcaf-anchor" style={{ background: "#f8fafc", borderTop: "1px solid #e8edf4", borderBottom: "1px solid #e8edf4" }}>
          <div style={WRAP}>
            <div className="dcaf-howgrid">
              <div style={{ minWidth: 0 }}>
                <span style={KICKER}>El proceso</span>
                <h2 className="dcaf-balance" style={H2}>Cómo funciona, paso a paso</h2>
                <p style={{ ...LEDE, maxWidth: 560 }}>
                  Sin letras chiquitas. Esto es exactamente lo que pasa desde que te registras hasta
                  que cobras.
                </p>

                <div style={{ marginTop: 32, display: "flex", flexDirection: "column" }}>
                  {PASOS.map((paso, i) => {
                    const ultimo = i === PASOS.length - 1;
                    return (
                      <div key={paso.t} style={{ display: "flex", gap: 16 }}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                          <span style={{ width: 42, height: 42, borderRadius: "50%", background: ultimo ? "#2563eb" : "#eff6ff", border: ultimo ? "1.5px solid #2563eb" : "1.5px solid #bfdbfe", color: ultimo ? "#ffffff" : "#1d4ed8", fontWeight: 800, fontSize: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {i + 1}
                          </span>
                          {!ultimo && <span style={{ width: 2, flex: 1, background: "#e2e8f0", margin: "6px 0" }} />}
                        </div>

                        <div style={{ paddingBottom: ultimo ? 0 : 26, minWidth: 0 }}>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                            <h3 style={{ fontSize: 16.5, fontWeight: 800, letterSpacing: "-0.01em" }}>{paso.t}</h3>
                            <span style={paso.chipVerde ? { ...CHIP, color: "#15803d", background: "#dcfce7", borderColor: "#bbf7d0" } : CHIP}>
                              {paso.chip}
                            </span>
                          </div>
                          <p style={{ marginTop: 6, fontSize: 15, color: "#475569", lineHeight: 1.65, maxWidth: 540 }}>
                            {paso.d}
                          </p>

                          {paso.cta && (
                            <Link href="/afiliados/registro" className="dcaf-btn-outline" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 44, marginTop: 14, padding: "10px 20px", background: "#ffffff", border: "1.5px solid #bfdbfe", color: "#1d4ed8", fontWeight: 700, fontSize: 14.5, borderRadius: 11 }}>
                              Registrarme gratis
                            </Link>
                          )}
                          {paso.ctaFinal && (
                            <Link href="/afiliados/registro" className="dcaf-btn-blue" style={{ ...CTA_AZUL, marginTop: 18 }}>
                              Registrarme gratis
                            </Link>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {tarjetasPila.length >= 2 && (
                <div style={{ position: "sticky", top: 96, alignSelf: "start", minWidth: 0 }}>
                  <EscenaPila tarjetas={tarjetasPila} total={`Tu fijo mensual: ${fmtMxn(totalPila)}`} />
                  <p style={{ textAlign: "center", fontSize: 12.5, color: "#64748b", marginTop: 8 }}>
                    Cada clínica activa suma a tu fijo mensual.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── 7. Qué recibes ───────────────────────────────────────────── */}
        <section style={{ background: "#ffffff" }}>
          <div style={WRAP}>
            <Encabezado kicker="Herramientas" titulo="Qué recibes al entrar" />

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,250px),1fr))", gap: 16, marginTop: 40 }}>
              {HERRAMIENTAS.map((h) => (
                <div key={h.t} style={{ background: "#f8fafc", border: "1px solid #e8edf4", borderRadius: 15, padding: 22, minWidth: 0 }}>
                  <span style={{ width: 42, height: 42, borderRadius: 12, background: "#eff6ff", border: "1px solid #dbeafe", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Ico>{h.icono}</Ico>
                  </span>
                  <h3 style={{ fontSize: 15.5, fontWeight: 700, marginTop: 14 }}>{h.t}</h3>
                  <p style={{ fontSize: 13.5, color: "#64748b", marginTop: 4, lineHeight: 1.55 }}>{h.d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── 8. Para quién es ─────────────────────────────────────────── */}
        <section style={{ background: "#f8fafc", borderTop: "1px solid #e8edf4", borderBottom: "1px solid #e8edf4" }}>
          <div style={WRAP}>
            <Encabezado kicker="Perfiles" titulo="Hecho para quien ya habla con clínicas" />

            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 14, marginTop: 40 }}>
              {AUDIENCIA.map((a) => (
                <div key={a.t} style={{ flex: "1 1 190px", maxWidth: 230, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 15, padding: 20, textAlign: "center", minWidth: 0 }}>
                  <span style={{ width: 44, height: 44, borderRadius: "50%", background: "#eff6ff", border: "1px solid #dbeafe", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <Ico>{a.icono}</Ico>
                  </span>
                  <h3 style={{ fontSize: 14.5, fontWeight: 700, marginTop: 12 }}>{a.t}</h3>
                  <p style={{ fontSize: 13, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>{a.d}</p>
                </div>
              ))}
            </div>

            <p style={{ textAlign: "center", fontSize: 13, color: "#94a3b8", marginTop: 26, maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}>
              No garantizamos ingresos: lo que ganas depende de cuántas clínicas recomiendes y de que
              sigan suscritas.
            </p>
          </div>
        </section>

        {/* ── 9. FAQ ───────────────────────────────────────────────────── */}
        <section id="faq" className="dcaf-anchor" style={{ background: "#ffffff" }}>
          <div style={{ maxWidth: 760, margin: "0 auto", padding: "clamp(52px,7vw,88px) 20px" }}>
            <div style={{ textAlign: "center" }}>
              <span style={KICKER}>Dudas</span>
              <h2 style={H2}>Preguntas frecuentes</h2>
            </div>

            <div style={{ marginTop: 36, background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 18, padding: "6px 24px" }}>
              {faq.map((item, i) => (
                <details key={item.q} style={{ borderBottom: i < faq.length - 1 ? "1px solid #f1f5f9" : undefined, padding: "16px 0" }}>
                  <summary className="dcaf-summary" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, minHeight: 44 }}>
                    <span style={{ fontWeight: 600, fontSize: 15.5 }}>{item.q}</span>
                    <span className="dcaf-chev">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                    </span>
                  </summary>
                  <p style={{ marginTop: 10, fontSize: 15, color: "#475569", lineHeight: 1.65 }}>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ── 10. Cierre ───────────────────────────────────────────────── */}
        <section className="dcaf-dark" style={{ position: "relative", background: "#080d1a", overflow: "hidden" }}>
          <EscenaAnillos />

          <div style={{ position: "relative", zIndex: 1, maxWidth: 760, margin: "0 auto", padding: "clamp(72px,10vw,116px) 20px", textAlign: "center" }}>
            <span style={{ ...KICKER, color: "#60a5fa" }}>Programa de afiliados</span>
            <h2 className="dcaf-balance" style={{ marginTop: 12, fontSize: "clamp(30px,4.6vw,46px)", lineHeight: 1.12, letterSpacing: "-0.02em", fontWeight: 800, color: "#ffffff" }}>
              Tu recomendación vale cada mes, no una sola vez
            </h2>
            <p style={{ marginTop: 16, fontSize: 16.5, color: "#94a3b8", maxWidth: 540, marginLeft: "auto", marginRight: "auto" }}>
              Entrar es gratis, sin exclusividad, y cada solicitud se revisa a mano. Las cuentas
              claras ya las viste.
            </p>

            <div style={{ marginTop: 30 }}>
              <Link href="/afiliados/registro" className="dcaf-btn-white" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minHeight: 54, padding: "15px 36px", background: "#ffffff", color: "#1d4ed8", fontWeight: 800, fontSize: 17, borderRadius: 13, boxShadow: "0 10px 30px rgba(37,99,235,.3)" }}>
                Registrarme gratis
              </Link>
            </div>

            <p style={{ marginTop: 14, fontSize: 13.5, color: "#64748b" }}>
              Gratis · Sin exclusividad · Pagos por SPEI o PayPal
            </p>
            <p style={{ marginTop: 22 }}>
              <Link href="/terminos-afiliados" className="dcaf-linkdim" style={{ color: "#64748b", fontSize: 13, textDecoration: "underline" }}>
                Términos del programa de afiliados
              </Link>
            </p>

            <div style={{ marginTop: 64, borderTop: "1px solid rgba(148,163,184,.16)", paddingTop: 20, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "10px 18px", fontSize: 13, color: "#64748b" }}>
              <Link href="/afiliados/login" className="dcaf-linkdim" style={{ color: "#64748b" }}>
                Ya soy afiliado
              </Link>
              <Link href="/terminos-afiliados" className="dcaf-linkdim" style={{ color: "#64748b" }}>
                Términos
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SalesFooter />

      <JsonLd data={faqLd} />
      <JsonLd data={webPageLd} />
      <JsonLd data={breadcrumbLd} />
    </div>
  );
}
