import { instrumentSans, materialSymbols } from "@/fonts/menu";
import { IconoPanel } from "./icono-panel";
import { LaptopVideo } from "./laptop-video";
import { PortalPacienteMock } from "./portal-paciente-mock";
import { Tilt3D } from "./tilt-3d";
import { CINTA, TARJETAS, TODO_PANEL_COPY } from "./todo-el-panel-data";
import "./todo-el-panel.css";

/**
 * «Todo el panel» (ajuste 1, ws1-t4). Sustituye a tres secciones que iban
 * seguidas debajo del CTA de WhatsApp —el trío oscuro, «Y todo lo demás,
 * incluido» y «Conoce cada módulo a fondo»— por UNA sola, oscura:
 *
 *   · en el centro, una LAPTOP en 3D (CSS, sin librerías) cuya pantalla
 *     alterna dos grabaciones reales del panel (panel-recorrido.mp4 y
 *     panel-recorrido-2.mp4, grabadas con el arnés de t1 contra panel.108:
 *     Página web con «Especialistas», Equipo y sus permisos, Finanzas; Mi
 *     Clínica Visual en 3D y el portal del paciente);
 *   · alrededor, 8 tarjetitas del panel (ícono del menú + dos o tres palabras)
 *     que flotan; desde el ajuste 2 NO enlazan a nada (Rafael no quiere
 *     enlaces a páginas secundarias);
 *   · asomando por la esquina, un teléfono con el PORTAL DEL PACIENTE
 *     reconstruido en código (portal-paciente-mock.tsx);
 *   · debajo, la cinta con el resto de funciones, en bucle.
 *
 * Server component; el único JS es el observador del vídeo (laptop-video.tsx)
 * y el paralaje del ratón (tilt-3d.tsx). Sin emojis: el Chromium del servidor
 * no tiene fuente de emoji.
 */
export function TodoElPanel() {
  const izq = TARJETAS.filter((t) => t.lado === "izq");
  const der = TARJETAS.filter((t) => t.lado === "der");
  const tarjeta = (t: (typeof TARJETAS)[number], i: number) => (
    <span key={t.label} className="dctp-card" style={{ animationDelay: `${(i * 0.7).toFixed(1)}s` }}>
      <span className="dctp-card__ico" aria-hidden="true"><IconoPanel nombre={t.icono} size={22} /></span>
      <span className="dctp-card__label">{t.label}</span>
    </span>
  );

  return (
    <section id="todo-el-panel" className={`dctp ${instrumentSans.variable} ${materialSymbols.variable}`} aria-label="Todo el panel" style={{ scrollMarginTop: 72 }}>
      <div className="dctp__wrap">
        <div data-reveal="" className="dctp__head">
          <span className="dctp__eyebrow">{TODO_PANEL_COPY.eyebrow}</span>
          <h2 className="dcv4-balance dcv4-h2 dcv4-h2--light">{TODO_PANEL_COPY.title}</h2>
        </div>

        <div data-reveal="" className="dctp__stage">
          <div className="dctp__col dctp__col--izq">{izq.map(tarjeta)}</div>

          <div className="dctp__center">
            <span className="dctp__glow" aria-hidden="true" />
            <Tilt3D max={4} className="dctp__tilt">
              <div className="dctp-laptop">
                <div className="dctp-laptop__lid">
                  <span className="dctp-laptop__cam" aria-hidden="true" />
                  <div className="dctp-laptop__screen">
                    <LaptopVideo videos={TODO_PANEL_COPY.videos} label={TODO_PANEL_COPY.ve} />
                  </div>
                </div>
                <div className="dctp-laptop__base" aria-hidden="true"><span /></div>
              </div>
            </Tilt3D>
            <div className="dctp__phone" aria-hidden="true">
              <PortalPacienteMock />
            </div>
          </div>

          <div className="dctp__col dctp__col--der">{der.map((t, i) => tarjeta(t, i + 4))}</div>
        </div>

        {/* La cinta: el resto, en bucle (se duplica para que no tenga costura). */}
        <div className="dctp-cinta" aria-label="Más funciones incluidas">
          <div className="dctp-cinta__track">
            {[0, 1].map((k) => (
              <ul key={k} className="dctp-cinta__list" aria-hidden={k === 1 ? "true" : undefined}>
                {CINTA.map((c) => (
                  <li key={c.label} className="dctp-chip">
                    <IconoPanel nombre={c.icono} size={16} />
                    {c.label}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
