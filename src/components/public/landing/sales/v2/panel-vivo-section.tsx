import { materialSymbols } from "@/fonts/menu";
import { PanelVivo } from "./panel-vivo";
import { PANEL_VIVO_COPY } from "./panel-vivo-data";
import { CineFondo } from "./cine-fondo";

/**
 * Sección «El panel, en vivo» (sustituye a la demo de Sabina). Nace clara y,
 * al entrar en pantalla, se oscurece ligada al scroll (cine-fondo.tsx) para
 * volver a blanco al ir hacia WhatsApp + Mercado Pago, que ahora es clara.
 *
 * Los íconos de las tarjetas son los del menú real del panel (Material
 * Symbols Rounded recortado, `src/fonts/menu.ts`, sin precarga). El recuadro
 * con las secciones de Administración se quitó en el ajuste 3 (Rafael).
 */
export function PanelVivoSection() {
  return (
    <section id="panel" className={`dcv4-pvsec ${materialSymbols.variable}`} aria-label="El panel de DaleControl en vivo" style={{ scrollMarginTop: 72 }}>
      <CineFondo />
      <div className="dcv4-pvsec__in" style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,100px) 20px" }}>
        <div data-reveal="" style={{ textAlign: "center", maxWidth: 760, margin: "0 auto" }}>
          <span className="dcv4-eyebrow dcv4-eyebrow--violet">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10" opacity=".18" /><circle cx="12" cy="12" r="4" /></svg>
            {PANEL_VIVO_COPY.eyebrow}
          </span>
          <h2 className="dcv4-balance dcv4-h2">{PANEL_VIVO_COPY.title}</h2>
          <p className="dcv4-pretty dcv4-lead">{PANEL_VIVO_COPY.subtitle}</p>
        </div>

        <div data-reveal="" style={{ marginTop: "clamp(30px,4vw,52px)" }}>
          <PanelVivo />
        </div>

      </div>
    </section>
  );
}
