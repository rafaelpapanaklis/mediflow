import Link from "next/link";
import {
  EDU_BRAND,
  EDU_LANDING_ANCHORS,
  EDU_LANDING_COPY,
  EDU_LANDING_PATH,
  EDU_LOGIN_PATH,
  EDU_VERTICAL,
} from "@/lib/edu/marketing";
import { EduMark } from "./icons";
import { WhatsappManagerCta } from "./whatsapp";

/** "DaleControl" con el "Dale" destacado, como el wordmark del sitio. */
export function Wordmark() {
  const corte = EDU_BRAND.indexOf("Control");
  if (corte <= 0) return <>{EDU_BRAND}</>;
  return (
    <>
      <em>{EDU_BRAND.slice(0, corte)}</em>
      {EDU_BRAND.slice(corte)}
    </>
  );
}

export function EduBrand() {
  return (
    <span className="dcei-brand__text">
      <span className="dcei-brand__name">
        <Wordmark />
      </span>
      <span className="dcei-brand__tag">{EDU_VERTICAL}</span>
    </span>
  );
}

/**
 * Barra pegajosa. Server component salvo el botón de WhatsApp, que es
 * cliente solo por el evento de conversión.
 *
 * Sin menú de hamburguesa a propósito: en un teléfono quedan la marca y
 * las dos acciones que importan —entrar y escribir—, y las anclas
 * aparecen a partir de 940 px de ancho del contenedor. Un cajón desplegable
 * para cinco anclas es JavaScript y una trampa de foco a cambio de nada.
 *
 * Es `sticky` y no `fixed`: el contenedor de la página declara
 * `container-type`, que crea contención y atraparía a un elemento fijo
 * dentro de la columna en vez de dejarlo sobre la ventana.
 */
export function EduNav() {
  const a = EDU_LANDING_ANCHORS;
  const t = EDU_LANDING_COPY.nav;
  return (
    <header className="dcei-nav">
      <div className="dcei-wrap dcei-nav__in">
        {/* Sin aria-label: el nombre accesible es el TEXTO QUE SE VE
            ("DaleControl Institucional"). Con una etiqueta encima —aunque
            dijera lo mismo— y el texto escondido con aria-hidden, el nombre
            y lo visible dejaban de coincidir, que es un fallo real: quien
            navega por voz dice lo que lee. */}
        <Link href={EDU_LANDING_PATH} className="dcei-brand">
          <span className="dcei-brand__mark" aria-hidden="true">
            <EduMark size={19} />
          </span>
          <EduBrand />
        </Link>

        <nav className="dcei-nav__links" aria-label={t.ariaMain}>
          <a href={`#${a.flujo}`}>{t.flujo}</a>
          <a href={`#${a.roles}`}>{t.roles}</a>
          <a href={`#${a.expediente}`}>{t.expediente}</a>
          <a href={`#${a.plan}`}>{t.plan}</a>
          <a href={`#${a.faq}`}>{t.faq}</a>
        </nav>

        <div className="dcei-nav__right">
          <Link href={EDU_LOGIN_PATH} className="dcei-btn dcei-btn--ghost dcei-btn--sm dcei-nav__login">
            {t.entrar}
          </Link>
          <span className="dcei-nav__cta-largo">
            <WhatsappManagerCta label={t.cta} position="landing_nav" size="sm" />
          </span>
          <span className="dcei-nav__cta-corto">
            <WhatsappManagerCta
              label={t.ctaCorto}
              aria={t.ctaCortoAria}
              position="landing_nav"
              size="sm"
            />
          </span>
        </div>
      </div>
      <div className="dcei-regla" aria-hidden="true" />
    </header>
  );
}
