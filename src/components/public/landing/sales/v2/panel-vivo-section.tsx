import { materialSymbols } from "@/fonts/menu";
import { PanelVivo } from "./panel-vivo";
import { Tilt3D } from "./tilt-3d";
import { ADMIN_SECCIONES, ADMIN_TOTAL, PANEL_VIVO_COPY } from "./panel-vivo-data";
import { IconoPanel } from "./icono-panel";

/**
 * Sección «El panel, en vivo» (sustituye a la demo de Sabina). Sección CLARA
 * entre la banda oscura de cifras y el bloque oscuro de WhatsApp.
 *
 * Los íconos de las tarjetas y de los chips son los del menú real del panel
 * (Material Symbols Rounded recortado, `src/fonts/menu.ts`, sin precarga).
 */
export function PanelVivoSection() {
  return (
    <section id="panel" className={`dcv4-pvsec ${materialSymbols.variable}`} aria-label="El panel de DaleControl en vivo" style={{ scrollMarginTop: 72 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,100px) 20px" }}>
        <div data-reveal="" style={{ textAlign: "center", maxWidth: 760, margin: "0 auto" }}>
          <span className="dcv4-eyebrow dcv4-eyebrow--violet">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="12" r="10" opacity=".18" /><circle cx="12" cy="12" r="4" /></svg>
            {PANEL_VIVO_COPY.eyebrow}
          </span>
          <h2 className="dcv4-balance dcv4-h2">{PANEL_VIVO_COPY.title}</h2>
          <p className="dcv4-pretty dcv4-lead">{PANEL_VIVO_COPY.subtitle}</p>
        </div>

        <div data-reveal="" style={{ marginTop: "clamp(30px,4vw,52px)" }}>
          <Tilt3D max={3} className="dcv4-tilt--panel">
            <PanelVivo />
          </Tilt3D>
        </div>

        {/* Administración: las secciones reales, de un vistazo */}
        <div data-reveal="" className="dcv4-admin">
          <div className="dcv4-admin__head">
            <span className="dcv4-admin__ico"><IconoPanel nombre="apps" size={20} /></span>
            <span>
              <span className="dcv4-admin__t">{PANEL_VIVO_COPY.adminTitle}</span>
              <span className="dcv4-admin__s">{PANEL_VIVO_COPY.adminSub}</span>
            </span>
            <span className="dcv4-admin__n">{ADMIN_TOTAL}</span>
          </div>
          <div className="dcv4-admin__grupos">
            {ADMIN_SECCIONES.map((g) => (
              <div key={g.grupo} className="dcv4-admin__grupo">
                <span className="dcv4-admin__g">{g.grupo}</span>
                <span className="dcv4-admin__chips">
                  {g.items.map((it) => (
                    <span key={it} className="dcv4-admin__chip">{it}</span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
