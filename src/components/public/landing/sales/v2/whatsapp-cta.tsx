import { WHATSAPP_CTA } from "./landing-data";
import { BotonWhatsapp } from "./cta-embudo";
import { WhatsappGlyph } from "./whatsapp-glyph";

/**
 * Banda de contacto entre precios y la franja de seguridad (7-oct-2026, pedido
 * de Rafael: antes iba después de la franja): quien acaba de ver los planes y
 * le queda una duda no tiene que buscar el chat.
 *
 * El número NO se enseña (7-oct-2026, pedido de Rafael): el botón abre el chat
 * y el teléfono solo vive en `landing-data.ts` (`WHATSAPP_CTA.numberE164`).
 *
 * Es una sección DENTRO del flujo, no un botón flotante: la esquina inferior
 * derecha ya la ocupa el widget de LiveChat (livechat.tsx) y dos burbujas
 * flotantes se pisarían.
 *
 * 11-oct-2026 (ws1-t4, encargo de ws7): el botón es `BotonWhatsapp` con origen
 * `banda` (mensaje precargado propio + `registrarPaso("whatsapp_clic")`, que
 * ya manda GA4/Meta/Ads por embudo.ts). Antes mandaba a mano a GA4 un evento
 * con otro nombre (con «k»); se quitó para no contar el clic dos veces con
 * dos nombres. Con eso la sección vuelve a ser de servidor: solo el botón es
 * de cliente.
 */
export function WhatsappCta() {
  return (
    <section aria-label="Contacto por WhatsApp" style={{ background: "#f8fafc" }}>
      {/* Ritmo igual (8-oct-2026, pedido de Rafael): sin padding arriba —el
          hueco con «Incluido en todos los planes» lo pone el padding inferior
          de Precios, clamp(56px,7vw,92px)— y ese MISMO valor abajo, hacia la
          franja de seguridad, que repite la cuenta por debajo (franja-seguridad.css). */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 20px clamp(56px,7vw,92px)" }}>
        <div
          data-reveal=""
          className="dcv4-wa-card"
          style={{
            maxWidth: 760,
            margin: "0 auto",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: 18,
            boxShadow: "0 18px 40px -24px rgba(2,6,23,0.18)",
            padding: "clamp(24px,3.5vw,36px)",
          }}
        >
          <div
            className="dcv4-wa-row"
            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "clamp(20px,3vw,32px)" }}
          >
            {/* El `flex` de este bloque vive en el CSS, no aquí: es lo único
                que cambia entre los dos modos y una base inline no se puede
                sobreescribir desde la container query. */}
            <div className="dcv4-wa-lead" style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
              <span
                aria-hidden="true"
                style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 54, height: 54, borderRadius: 999, background: "#dcfce7", color: "#128C7E" }}
              >
                <WhatsappGlyph size={26} />
              </span>
              <div style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#128C7E", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                  {WHATSAPP_CTA.eyebrow}
                </span>
                <h2 className="dcv4-balance" style={{ marginTop: 6, fontSize: "clamp(22px,3vw,30px)", lineHeight: 1.2, letterSpacing: "-0.028em", fontWeight: 700, color: "#0f172a" }}>
                  {WHATSAPP_CTA.title}
                </h2>
                <p className="dcv4-pretty" style={{ marginTop: 8, fontSize: 15.5, lineHeight: 1.55, color: "#475569" }}>
                  {WHATSAPP_CTA.subtitle}
                </p>
              </div>
            </div>

            {/* Solo el botón, centrado a media altura del bloque (`alignItems:
                center` de la fila); en móvil ocupa el ancho de la tarjeta. */}
            <div className="dcv4-wa-action" style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", alignSelf: "center" }}>
              <BotonWhatsapp
                origen="banda"
                className="dcv2-btn-wa dcv4-wa-btn"
                // El padding lateral (28px, el de los CTA del repo) vive en el
                // CSS por la misma razón que el `flex` de arriba: en móvil el
                // botón ocupa la tarjeta entera y ahí se relaja a 16px para que
                // la etiqueta no se parta en dos líneas a 360px.
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, minHeight: 50, fontWeight: 700, fontSize: 16, borderRadius: 12 }}
              >
                {WHATSAPP_CTA.button}
              </BotonWhatsapp>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
