import { PanelMarco } from "./panel-marco";
import { SabinaDemo } from "./sabina-demo";
import { SABINA_COPY } from "./sabina-data";
import { Tilt3D } from "./tilt-3d";

/**
 * Sección «Sabina, dentro del panel»: el marco real del panel (menú lateral,
 * cabecera, buscador) con Sabina seleccionada y su conversación en el centro.
 * Sección clara (#ffffff) entre la banda oscura de cifras y el bloque oscuro
 * de WhatsApp: conserva la alternancia de la portada.
 */
export function SabinaSection() {
  return (
    <section id="sabina" className="dcv4-sabsec" aria-label="Sabina, la asistente dentro del panel" style={{ scrollMarginTop: 72 }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(56px,7vw,100px) 20px" }}>
        <div data-reveal="" style={{ textAlign: "center", maxWidth: 780, margin: "0 auto" }}>
          <span className="dcv4-eyebrow dcv4-eyebrow--violet">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.7L19.5 9.5l-5.7 1.8L12 17l-1.8-5.7L4.5 9.5l5.7-1.8L12 2zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9L19 14zM5 15l.7 1.8 1.8.7-1.8.7L5 20l-.7-1.8-1.8-.7 1.8-.7L5 15z" /></svg>
            {SABINA_COPY.eyebrow}
          </span>
          <h2 className="dcv4-balance dcv4-h2">{SABINA_COPY.title}</h2>
          <p className="dcv4-pretty dcv4-lead">{SABINA_COPY.subtitle}</p>
        </div>

        <div data-reveal="" style={{ marginTop: "clamp(30px,4vw,52px)" }}>
          <Tilt3D max={3} className="dcv4-tilt--panel">
            <div className="dcv4-panelwrap">
              <PanelMarco clinica="Clínica Altabrisa" miga="Sabina">
                <SabinaDemo />
              </PanelMarco>
            </div>
          </Tilt3D>
        </div>

        <ul className="dcv4-facts" style={{ marginTop: "clamp(34px,4.5vw,60px)" }}>
          {SABINA_COPY.facts.map((f) => (
            <li key={f.t} data-reveal="" className="dcv4-fact">
              <span className="dcv4-fact__t">{f.t}</span>
              <span className="dcv4-fact__d">{f.d}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
