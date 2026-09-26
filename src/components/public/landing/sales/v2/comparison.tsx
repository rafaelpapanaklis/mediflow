import { materialSymbols } from "@/fonts/menu";
import { COMPARISON, COMPARISON_CLOSING, SWITCH_REASONS } from "./landing-data";
import { IconoPanel } from "./icono-panel";

/**
 * «¿Por qué cambiarte a DaleControl?» — ajuste 11 (Rafael): mejor diseño y
 * cuatro razones nuevas (SWITCH_REASONS, con ícono del panel, título corto y
 * una línea) sobre la tabla comparativa de siempre, que conserva sus filas.
 *
 * La tabla va en una rejilla CSS con `min-width:640px` dentro de un
 * contenedor con scroll horizontal PROPIO, así que nunca empuja el ancho de la
 * página. Hasta 640 px (landing-v2.css, `.dcv4-cmp__*`) la rejilla se ajusta
 * al ancho. Los estilos viven en landing-v2.css («Comparativa (ajuste 11)»);
 * las clases `dcv4-cmp__inner/row/head/label/cell` se mantienen porque las
 * reglas de móvil ya existentes las esperan.
 *
 * `firstMonthFrom` (precio del primer mes) viene de plan_configs vía page.tsx:
 * aquí no se escribe ninguna cifra.
 *
 * La fuente de íconos del panel (`materialSymbols`, subconjunto recortado a
 * los íconos del menú) se aplica en la sección como hacen Funciones y «Todo el
 * panel»: sin la variable, `IconoPanel` pinta la palabra en vez del ícono.
 */

/**
 * "✗" y "—" del diseño, en slate-500 y no slate-400: sobre blanco el #94a3b8
 * se queda en 2.8:1 y no pasa AA.
 */
function Cell({ value }: { value: string }) {
  if (value === "✗") return <span className="dcv4-cmp__cell dcv4-cmp__cell--no" aria-label="No">✗</span>;
  if (value === "—") return <span className="dcv4-cmp__cell dcv4-cmp__cell--na" aria-label="No aplica">—</span>;
  return <span className="dcv4-cmp__cell">{value}</span>;
}

export function Comparison({ firstMonthFrom }: { firstMonthFrom: string }) {
  return (
    <section id="comparativa" className={`dcv4-cmp ${materialSymbols.variable}`} style={{ scrollMarginTop: 72 }}>
      <div aria-hidden="true" className="dcv4-cmp__bg" />
      <div className="dcv4-cmp__wrap" style={{ maxWidth: 1120, margin: "0 auto", padding: "clamp(56px,7vw,92px) 20px" }}>
        <div data-reveal="" className="dcv4-cmp__headblock">
          <span className="dcv4-eyebrow">{COMPARISON.eyebrow}</span>
          <h2 className="dcv4-balance dcv4-h2">{COMPARISON.title}</h2>
          <p className="dcv4-pretty dcv4-lead">{COMPARISON.subtitle}</p>
        </div>

        {/* Razones nuevas (ajuste 11): ícono del panel + título corto + una línea. */}
        <ul data-reveal="" className="dcv4-cmp__reasons">
          {SWITCH_REASONS.map((r) => (
            <li key={r.title} className={`dcv4-cmp__reason dcv4-cmp__reason--${r.tono}`}>
              <span className="dcv4-cmp__ico"><IconoPanel nombre={r.icono} size={24} /></span>
              <h3 className="dcv4-cmp__rtitle">{r.title}</h3>
              <p className="dcv4-cmp__rline">{r.line}</p>
            </li>
          ))}
        </ul>

        {/* Tabla comparativa (filas de siempre). */}
        <div data-reveal="" className="dcv4-cmp__table">
          <div className="dcv4-cmp__scroll" style={{ overflowX: "auto", scrollbarWidth: "thin" }}>
            <div className="dcv4-cmp__inner" style={{ minWidth: 640 }}>
              <div className="dcv4-cmp__row dcv4-cmp__row--head">
                <span className="dcv4-cmp__label dcv4-cmp__label--head" />
                <span className="dcv4-cmp__head">{COMPARISON.columns[0]}</span>
                <span className="dcv4-cmp__head">{COMPARISON.columns[1]}</span>
                <span className="dcv4-cmp__head dcv4-cmp__head--dc"><span>{COMPARISON.columns[2]}</span></span>
              </div>
              {COMPARISON.rows.map((r) => (
                <div key={r.label} className="dcv4-cmp__row">
                  <span className="dcv4-cmp__label">{r.label}</span>
                  <Cell value={r.paper} />
                  <Cell value={r.traditional} />
                  <span className="dcv4-cmp__dc">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7" /></svg>
                    <span className="dcv4-sr">Sí</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Cierre: el precio del primer mes viene de plan_configs. */}
        <ul data-reveal="" className="dcv4-cmp__closing">
          <li><strong>{COMPARISON_CLOSING.firstMonthPrefix}{firstMonthFrom}</strong></li>
          {COMPARISON_CLOSING.chips.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
