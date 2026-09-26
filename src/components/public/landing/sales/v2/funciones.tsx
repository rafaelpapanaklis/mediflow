import type { ReactNode } from "react";
import { instrumentSans, materialSymbols } from "@/fonts/menu";
import { BENTO, FUNCIONES_V3_HEADER, LINEA, NOTA_IA, PAGINA_WEB, REJILLA, REJILLA_TITULO } from "./funciones-v3-data";
import { IluAgenda, IluCbct, IluFinanzas, IluPaginaWeb, IluWhatsapp } from "./funciones-ilustraciones";
import { IconoPanel } from "./icono-panel";
import "./funciones-v3.css";

/**
 * Sección «Funciones» v3 (rediseño 25-sep-2026, ws1-t4).
 *
 * Antes: 6 tarjetas grandes alternas claro/oscuro con un mockup completo del
 * panel cada una (2.474 px de alto a 1440). Ahora: un BENTO de 5 tarjetas
 * blancas —título, una frase y UNA ilustración de interfaz limpia sobre un
 * lavado de color— y debajo una REJILLA de íconos con el resto de funciones.
 * La primera tarjeta, la más grande, es «Tu página web gratuita» (pedido de
 * Rafael).
 *
 * Todo es server component: las ilustraciones son marcado puro y pesan una
 * fracción de los mockups de antes, así que ya no hace falta diferirlas
 * (mockups.tsx / lazy-mockup.tsx quedan en el repo sin montar desde aquí).
 *
 * Las fuentes del panel (Instrument Sans + Material Symbols) van sin
 * precarga: el navegador las pide cuando la sección entra en pantalla.
 *
 * Ajuste 1 (25-sep-2026): mucho menos texto. Sin subtítulo ni párrafos; la
 * web gratuita dice sus cuatro hechos como píldoras con ícono; las cuatro
 * estrella llevan la ilustración ARRIBA, protagonista, y debajo título +
 * una línea; la rejilla vuelve a 4 × 2 como la referencia A.
 *
 * Ajuste 2 (Rafael): SIN enlaces a páginas secundarias. Fuera los cuatro
 * «Más información» a las páginas de módulo; el único CTA es «Ver planes»,
 * al ancla #precios de esta misma página. Las páginas de módulo siguen
 * existiendo; solo dejan de enlazarse desde aquí.
 */

const ILUSTRACION: Record<(typeof BENTO)[number]["ilustracion"], ReactNode> = {
  whatsapp: <IluWhatsapp />,
  agenda: <IluAgenda />,
  cbct: <IluCbct />,
  finanzas: <IluFinanzas />,
};

export function Funciones() {
  return (
    <section id="funciones" className={`dcf3-sec ${instrumentSans.variable} ${materialSymbols.variable}`}>
      <div className="dcf3-wrap">
        <div data-reveal="" className="dcf3-head">
          <span className="dcf3-eyebrow">{FUNCIONES_V3_HEADER.eyebrow}</span>
          <h2 className="dcv4-balance dcv4-h2">{FUNCIONES_V3_HEADER.title}</h2>
        </div>

        <div className="dcf3-bento">
          {/* ★ 1 · Tu página web gratuita — la primera y la más destacada */}
          <article data-reveal="" className="dcf3-card dcf3-card--web">
            <div className="dcf3-card__tx">
              <span className="dcf3-gratis"><IconoPanel nombre="redeem" size={15} /> Incluida en cualquier plan</span>
              <h3 className="dcv4-balance dcf3-card__h3">{PAGINA_WEB.title}</h3>
              <p className="dcv4-pretty dcf3-card__p">{PAGINA_WEB.linea}</p>
              <ul className="dcf3-hechos">
                {PAGINA_WEB.hechos.map((h) => (
                  <li key={h.label} className="dcf3-hecho">
                    <span className="dcf3-hecho__ico" aria-hidden="true"><IconoPanel nombre={h.icono} size={20} /></span>
                    {h.label}
                  </li>
                ))}
              </ul>
              <a href={PAGINA_WEB.href} className="dcf3-card__cta">{PAGINA_WEB.cta}</a>
            </div>
            <div className="dcf3-card__ilu" aria-hidden="true">
              <IluPaginaWeb />
            </div>
          </article>

          {/* 2–5 · Las funciones estrella, con sus textos de siempre */}
          {BENTO.map(({ funcion: f, ilustracion }) => (
            <article key={f.id} data-reveal="" className={`dcf3-card dcf3-card--${ilustracion} dcf3-card--ilu-arriba`}>
              <div className="dcf3-card__ilu" aria-hidden="true">
                {ILUSTRACION[ilustracion]}
              </div>
              <div className="dcf3-card__tx">
                <h3 className="dcv4-balance dcf3-card__h3">{f.title}</h3>
                <p className="dcf3-card__p">{LINEA[f.id] ?? f.desc}</p>
              </div>
            </article>
          ))}
        </div>
        <p className="dcf3-nota">{NOTA_IA}</p>

        {/* Rejilla de íconos: el resto, de un vistazo */}
        <div data-reveal="" className="dcf3-grid">
          <h3 className="dcv4-balance dcf3-grid__h3">{REJILLA_TITULO}</h3>
          <ul className="dcf3-grid__list">
            {REJILLA.map((it) => (
              <li key={it.label} className="dcf3-grid__it">
                <span className="dcf3-grid__ico" aria-hidden="true"><IconoPanel nombre={it.icono} size={28} /></span>
                <span className="dcf3-grid__label">{it.label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
