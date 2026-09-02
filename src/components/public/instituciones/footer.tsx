import Link from "next/link";
import {
  EDU_LANDING_ANCHORS,
  EDU_LANDING_COPY,
  EDU_LOGIN_PATH,
} from "@/lib/edu/marketing";
import { EduBrand, Wordmark } from "./nav";
import { EduMark } from "./icons";

/**
 * El pie. `year` lo pasa la página: aquí no se llama a `new Date()` para
 * que el componente siga siendo determinista y la sección se pueda
 * pre-renderizar sin sorpresas.
 *
 * El enlace al final lleva a la landing del dental, que es el otro
 * producto de la casa. Y solo en esa dirección: la landing dental NO
 * enlaza aquí — es una superficie viva en producción y no se toca.
 */
export function EduFooter({ year }: { year: number }) {
  const a = EDU_LANDING_ANCHORS;
  const t = EDU_LANDING_COPY.footer;
  const nav = EDU_LANDING_COPY.nav;
  return (
    <footer className="dcei-footer">
      <div className="dcei-wrap">
        <div className="dcei-footer__grid">
          <div>
            <div className="dcei-brand dcei-brand--pie">
              <span className="dcei-brand__mark" aria-hidden="true">
                <EduMark size={19} />
              </span>
              <EduBrand />
            </div>
            <p className="dcei-footer__lema dcei-pretty">{t.lema}</p>
          </div>

          <div className="dcei-footer__col">
            <h3>{t.producto}</h3>
            <ul>
              <li>
                <a href={`#${a.flujo}`}>{nav.flujo}</a>
              </li>
              <li>
                <a href={`#${a.roles}`}>{nav.roles}</a>
              </li>
              <li>
                <a href={`#${a.expediente}`}>{nav.expediente}</a>
              </li>
              <li>
                <a href={`#${a.plan}`}>{nav.plan}</a>
              </li>
              <li>
                <a href={`#${a.faq}`}>{nav.faq}</a>
              </li>
            </ul>
          </div>

          <div className="dcei-footer__col">
            <h3>{t.legal}</h3>
            <ul>
              <li>
                <Link href="/terminos">{t.terminos}</Link>
              </li>
              <li>
                <Link href="/privacidad">{t.privacidad}</Link>
              </li>
              <li>
                <Link href={EDU_LOGIN_PATH}>{t.entrar}</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="dcei-footer__bajo">
          <span>
            © {year} <Wordmark />. {t.derechos}
          </span>
          <Link href="/">{t.dental}</Link>
        </div>
      </div>
    </footer>
  );
}
