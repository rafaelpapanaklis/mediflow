import type { Metadata } from "next";
import Link from "next/link";
import { Inter } from "next/font/google";
import {
  ArrowRight,
  Briefcase,
  Check,
  CircleDollarSign,
  ClipboardCheck,
  FlaskConical,
  Handshake,
  Info,
  Megaphone,
  Repeat,
  Share2,
  Stethoscope,
  Store,
  UserPlus,
  Wallet,
} from "lucide-react";
import { SalesNavSession } from "@/components/public/landing/nav-session";
import { SalesFooter } from "@/components/public/landing/sales";
import { buildMetadata, SITE_URL } from "@/lib/seo";
import { JsonLd } from "@/components/blog/json-ld";
import { CalculadoraAfiliados } from "@/components/afiliados/landing/calculadora";
import { FaqAfiliados, type FaqItem } from "@/components/afiliados/landing/faq-afiliados";
import { fmtMxn, getPublicOffer } from "@/lib/affiliates/public-offer";
import "@/components/public/landing/sales/sales.css";
import "./afiliados.css";

// Misma fuente y shell que /herramientas, /blog y la home: todo vive bajo `.mfh`.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
// refleja sin deploy. `getPublicOffer()` nunca lanza: sin BD cae a los
// defaults del motor.
//
// ISR de 5 minutos: los montos cambian poquísimo, pero cuando cambian no
// queremos esperar un deploy para publicarlos.
// ─────────────────────────────────────────────────────────────────────────────
export const revalidate = 300;

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

const PASOS = [
  {
    icon: UserPlus,
    t: "Regístrate gratis",
    d: "Llenas el formulario con tus datos y cómo quieres cobrar. Entrar al programa no cuesta nada.",
  },
  {
    icon: ClipboardCheck,
    t: "Revisamos tu solicitud",
    d: "La aprobación es manual: revisamos cada alta antes de activar la cuenta y te avisamos por correo.",
  },
  {
    icon: Share2,
    t: "Compartes tu link o tu cupón",
    d: "Tu panel te da un link con tu nombre y un cupón con tu código para repartir entre las clínicas.",
  },
  {
    icon: Wallet,
    t: "Cobras cada mes",
    d: "Las comisiones del mes se pagan dentro de los primeros 10 días del mes siguiente, por SPEI o PayPal.",
  },
];

const HERRAMIENTAS_PANEL = [
  { b: "Tu link propio", d: "con tu nombre en la dirección, listo para compartir." },
  { b: "Links por campaña", d: "para medir qué canal te está funcionando de verdad." },
  { b: "Tu cupón", d: "con tu código, para las clínicas que prefieren teclearlo." },
  { b: "Panel con estadísticas en vivo", d: "clics, altas y comisiones, actualizados al momento." },
  { b: "Estado de cuenta en PDF", d: "descargable cuando quieras, para tu propia contabilidad." },
  { b: "Equipo de vendedores", d: "cada uno con su porcentaje sobre lo que traiga." },
];

const PERFILES = [
  {
    icon: Store,
    t: "Distribuidores de insumos dentales",
    d: "Ya visitas consultorios cada semana. Recomendar el sistema no te cambia la ruta.",
  },
  {
    icon: Briefcase,
    t: "Consultores y contadores de clínicas",
    d: "Tus clientes te preguntan por facturación y control administrativo. Aquí tienes la respuesta.",
  },
  {
    icon: FlaskConical,
    t: "Laboratorios dentales",
    d: "Trabajas con decenas de clínicas al mismo tiempo: esa es tu red natural de recomendación.",
  },
  {
    icon: Stethoscope,
    t: "Dentistas con red de colegas",
    d: "Si ya usas DaleControl en tu consultorio, recomendarlo entre colegas es lo más natural.",
  },
  {
    icon: Megaphone,
    t: "Agencias de marketing médico",
    d: "Ya llevas la presencia digital de las clínicas: súmale la herramienta que les ordena la operación.",
  },
];

export default async function AfiliadosPage() {
  const offer = await getPublicOffer();

  const hasTopRecurring = offer.topRecurringMxn > 0;
  const arranque = cobroOrdinal(offer.startAtInvoiceNo);
  const hayMesPromocional = offer.startAtInvoiceNo > 1;

  // Una sola frase para el aviso destacado y para el FAQ: si algún día cambia,
  // cambia en los dos lugares a la vez.
  const arranqueTexto = hayMesPromocional
    ? `Desde el ${arranque} de la clínica: su primer mes entra con precio promocional, así que ese cobro no genera comisión.`
    : `Desde el ${arranque} de la clínica.`;

  // El FAQ vive aquí (server) y alimenta al MISMO tiempo el acordeón y el
  // JSON-LD de FAQPage: imposible que lo que ve Google y lo que ve el visitante
  // se desincronicen.
  const faq: FaqItem[] = [
    {
      q: "¿Cuándo me pagan?",
      a: "Las comisiones generadas en un mes se pagan dentro de los primeros 10 días del mes siguiente.",
    },
    {
      q: "¿Por cuánto tiempo cobro por una clínica?",
      a: "Mientras siga pagando su suscripción. No hay límite de meses.",
    },
    {
      q: "¿Qué pasa si la clínica cancela?",
      a: "Dejas de cobrar por esa clínica a partir de ese momento. No se te cobra nada de vuelta.",
    },
    {
      q: "¿Cuánto cuesta entrar al programa?",
      a: "Nada. Registrarte y usar el panel es gratis.",
    },
    {
      q: "¿Necesito ser dentista?",
      a: "No. Cualquier persona o empresa que pueda recomendar el sistema a clínicas puede participar.",
    },
    {
      q: "¿Puedo tener un equipo de vendedores?",
      a: "Sí. Desde tu panel das de alta a tus vendedores y le asignas a cada uno su propio porcentaje sobre lo que traiga.",
    },
    {
      q: "¿Cómo sé que se me está contando bien?",
      a: "Tu panel muestra clics, altas y comisiones en tiempo real, y puedes descargar tu estado de cuenta en PDF cuando quieras.",
    },
    {
      q: "¿Puedo referirme a mí mismo?",
      a: "No. El sistema bloquea el autorreferido y esa comisión no se genera.",
    },
    {
      q: "¿Cómo me pagan?",
      a: "Por transferencia SPEI o por PayPal. Tú eliges el método desde tu panel.",
    },
    {
      q: "¿Cuándo empieza a contar la comisión?",
      a: arranqueTexto,
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
      {
        "@type": "ListItem",
        position: 2,
        name: "Programa de afiliados",
        item: `${SITE_URL}/afiliados`,
      },
    ],
  };

  return (
    <div className={`mfh ${inter.variable}`} style={{ minHeight: "100dvh" }}>
      <SalesNavSession />

      <main>
        {/* ── 1. Hero ─────────────────────────────────────────────────── */}
        <section className="mfh-section--tight mfh-band--violet">
          <div className="mfh-container">
            <div className="mfh-head mfh-center" style={{ alignItems: "center", gap: 18 }}>
              <span className="mfh-eyebrow">
                <Handshake /> Programa de afiliados
              </span>

              <h1 className="mfh-h1 mfh-balance">
                {hasTopRecurring ? (
                  <>
                    Gana hasta{" "}
                    <span className="mfh-grad">{fmtMxn(offer.topRecurringMxn)} al mes</span> por
                    cada clínica que recomiendes
                  </>
                ) : (
                  <>
                    Gana una <span className="mfh-grad">comisión recurrente</span> por cada clínica
                    que recomiendes
                  </>
                )}
              </h1>

              <p className="mfh-lede" style={{ maxWidth: 680 }}>
                No es una comisión de una sola vez: te la pagamos <b>mes tras mes</b> mientras la
                clínica siga pagando su suscripción a DaleControl, sin límite de tiempo. Y si
                prefieres el dinero de golpe, también puedes cobrar un pago único por clínica.
              </p>

              <div className="afi-cta-row">
                <Link href="/afiliados/registro" className="mfh-btn mfh-btn--primary mfh-btn--lg">
                  Registrarme gratis <ArrowRight />
                </Link>
                <a href="#calculadora" className="mfh-btn mfh-btn--soft mfh-btn--lg">
                  Calcular cuánto ganaría
                </a>
              </div>

              <div className="afi-trust">
                <span>
                  <Check /> Entrar es gratis
                </span>
                <span>
                  <Check /> Sin exclusividad
                </span>
                <span>
                  <Check /> Pagos por SPEI o PayPal
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ── 2. Tabla de comisiones ──────────────────────────────────── */}
        <section className="mfh-section--tight">
          <div className="mfh-container">
            <div className="mfh-head mfh-center">
              <span className="mfh-kicker">Comisiones</span>
              <h2 className="mfh-h2 mfh-balance">Tú eliges cómo cobrar por cada clínica</h2>
              <p className="mfh-lede">
                El programa paga un monto fijo por plan —no un porcentaje que se diluye— y tú
                decides en qué formato lo quieres.
              </p>
            </div>

            <div className="afi-modes">
              <div className="afi-mode">
                <span className="afi-mode__icon">
                  <Repeat />
                </span>
                <div className="afi-mode__body">
                  <h3 className="afi-mode__t">Fijo recurrente</h3>
                  <p className="afi-mode__d">
                    Cobras el mismo monto <b>cada mes</b>, mes tras mes, mientras esa clínica siga
                    pagando su suscripción. No hay límite de meses: es un ingreso que se acumula
                    con cada clínica nueva.
                  </p>
                </div>
              </div>

              <div className="afi-mode">
                <span className="afi-mode__icon">
                  <CircleDollarSign />
                </span>
                <div className="afi-mode__body">
                  <h3 className="afi-mode__t">Pago único</h3>
                  <p className="afi-mode__d">
                    Cobras <b>un solo pago</b>, más grande, por esa misma clínica. Es todo lo que
                    recibes por ella, pero llega de golpe y por adelantado en vez de repartido a lo
                    largo de los meses.
                  </p>
                </div>
              </div>
            </div>

            <p className="afi-honest">
              La modalidad se fija <b>por clínica</b> en el momento del alta: si más adelante la
              cambias desde tu panel, sólo aplica a las clínicas que traigas de ahí en adelante —
              las que ya diste de alta siguen con las condiciones con las que entraron.
            </p>

            <div className="afi-plans">
              {offer.plans.map((plan) => {
                const hasRecurring = plan.recurringMxn > 0;
                const hasOneTime = plan.oneTimeMxn > 0;
                // Plan apagado en la config: mejor no listarlo que imprimir "$0".
                if (!hasRecurring && !hasOneTime) return null;

                return (
                  <article key={plan.key} className="afi-plan">
                    <div>
                      <h3 className="afi-plan__name">Plan {plan.label}</h3>
                      {plan.priceMxn > 0 && (
                        <p className="afi-plan__price">
                          Precio del plan: <b>{fmtMxn(plan.priceMxn)}/mes</b>
                        </p>
                      )}
                    </div>

                    {hasRecurring && (
                      <div className="afi-plan__box afi-plan__box--main">
                        <span className="afi-plan__kicker">Fijo recurrente</span>
                        <p className="afi-plan__amount">
                          {fmtMxn(plan.recurringMxn)} <small>al mes</small>
                        </p>
                        <p className="afi-plan__note">
                          Cada mes, mientras siga suscrita.
                        </p>
                      </div>
                    )}

                    {hasRecurring && hasOneTime && <div className="afi-plan__or">o</div>}

                    {hasOneTime && (
                      <div className="afi-plan__box">
                        <span className="afi-plan__kicker">Pago único</span>
                        <p className="afi-plan__amount">
                          {fmtMxn(plan.oneTimeMxn)} <small>una sola vez</small>
                        </p>
                        {plan.oneTimeAsMonths !== null && plan.oneTimeAsMonths > 0 && (
                          <p className="afi-plan__note">
                            Equivale a ~{plan.oneTimeAsMonths.toLocaleString("es-MX")} meses del
                            fijo recurrente.
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            {/* Aviso honesto: bien visible, no en letra chica. */}
            <div className="afi-notice">
              <Info aria-hidden="true" />
              <div className="afi-notice__body">
                <h3 className="afi-notice__t">
                  La comisión arranca en el {arranque} de la clínica
                </h3>
                <p className="afi-notice__p">
                  {arranqueTexto}
                  {hayMesPromocional && (
                    <>
                      {" "}
                      A partir de ahí ya cuenta, y si la clínica contrata el plan anual comisiona
                      desde su primera factura, porque en el pago anual no hay mes promocional.
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 3. Calculadora ──────────────────────────────────────────── */}
        <section id="calculadora" className="mfh-section--tight mfh-band afi-calc-section">
          <div className="mfh-container">
            <div className="mfh-head mfh-center">
              <span className="mfh-kicker">Calculadora</span>
              <h2 className="mfh-h2 mfh-balance">¿Cuánto sería en tu caso?</h2>
              <p className="mfh-lede">
                Pon las clínicas que crees que puedes recomendar y compara las dos modalidades con
                los montos que están vigentes hoy.
              </p>
            </div>

            <CalculadoraAfiliados
              plans={offer.plans}
              cfg={offer.cfg}
              pricesMxn={offer.pricesMxn}
              startAtInvoiceNo={offer.startAtInvoiceNo}
            />
          </div>
        </section>

        {/* ── 4. Cómo funciona ────────────────────────────────────────── */}
        <section className="mfh-section--tight">
          <div className="mfh-container">
            <div className="mfh-head mfh-center">
              <span className="mfh-kicker">Cómo funciona</span>
              <h2 className="mfh-h2 mfh-balance">Cuatro pasos, sin letras chiquitas</h2>
            </div>

            <div className="mfh-fgrid afi-steps">
              {PASOS.map((paso, i) => {
                const Icon = paso.icon;
                return (
                  <div key={paso.t} className="mfh-feature">
                    <span className="afi-step__n" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="mfh-feature__icon">
                      <Icon />
                    </span>
                    <h3 className="mfh-feature__t">{paso.t}</h3>
                    <p className="mfh-feature__d">{paso.d}</p>
                    <span className="mfh-feature__glow" aria-hidden="true" />
                  </div>
                );
              })}
            </div>

            <ul className="afi-list">
              {HERRAMIENTAS_PANEL.map((item) => (
                <li key={item.b}>
                  <Check aria-hidden="true" />
                  <span>
                    <b>{item.b}</b>: {item.d}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 5. Para quién es ────────────────────────────────────────── */}
        <section className="mfh-section--tight mfh-band--soft">
          <div className="mfh-container">
            <div className="mfh-head mfh-center">
              <span className="mfh-kicker">Para quién es</span>
              <h2 className="mfh-h2 mfh-balance">
                Funciona mejor si ya tratas con clínicas dentales
              </h2>
            </div>

            <div className="afi-who">
              {PERFILES.map((perfil) => {
                const Icon = perfil.icon;
                return (
                  <div key={perfil.t} className="afi-who__item">
                    <span className="afi-who__icon">
                      <Icon />
                    </span>
                    <div className="afi-who__body">
                      <h3 className="afi-who__t">{perfil.t}</h3>
                      <p className="afi-who__d">{perfil.d}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="afi-honest">
              No garantizamos ingresos: lo que ganas depende de cuántas clínicas recomiendes y de
              que sigan suscritas.
            </p>
          </div>
        </section>

        {/* ── 6. FAQ ──────────────────────────────────────────────────── */}
        <section className="mfh-section--tight mfh-band">
          <div className="mfh-container">
            <div className="mfh-head mfh-center">
              <span className="mfh-kicker">Preguntas frecuentes</span>
              <h2 className="mfh-h2 mfh-balance">Lo que todo el mundo pregunta antes de entrar</h2>
            </div>

            <FaqAfiliados items={faq} />
          </div>
        </section>

        {/* ── 7. CTA final ────────────────────────────────────────────── */}
        <section className="mfh-section--tight">
          <div className="mfh-container">
            <div className="mfh-cta">
              <div className="mfh-cta__glow" aria-hidden="true" />
              <div className="mfh-cta__grid" aria-hidden="true" />
              <div className="mfh-cta__inner">
                <h2 className="mfh-cta__h mfh-balance">Empieza a recomendar hoy</h2>
                <p className="mfh-cta__p">
                  Registrarte no cuesta nada y no te amarra a nada. Revisamos tu solicitud, te
                  damos tu link y tu cupón, y a partir de ahí cobras cada mes.
                </p>
                <div className="mfh-cta__row">
                  <Link href="/afiliados/registro" className="mfh-btn mfh-btn--white mfh-btn--lg">
                    Registrarme gratis <ArrowRight />
                  </Link>
                  <Link href="/afiliados/login" className="mfh-btn mfh-btn--glass mfh-btn--lg">
                    Ya soy afiliado
                  </Link>
                </div>
                <div className="mfh-cta__note">
                  <span>
                    <Check /> Sin costo de entrada
                  </span>
                  <span>
                    <Check /> Sin exclusividad
                  </span>
                  <span>
                    <Check /> Pagos por SPEI o PayPal
                  </span>
                </div>
              </div>
            </div>

            <p className="afi-terms">
              <Link href="/terminos-afiliados">
                Consulta los términos del programa de afiliados.
              </Link>
            </p>
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
