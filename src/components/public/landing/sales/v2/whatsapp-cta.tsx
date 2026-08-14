"use client";

import { GA4_MEASUREMENT_ID } from "@/lib/analytics/ga4";
import { WHATSAPP_CTA } from "./landing-data";

type GtagFn = (...args: unknown[]) => void;

/**
 * Banda de contacto entre precios y el trío oscuro: quien acaba de ver los
 * planes y le queda una duda no tiene que buscar el chat.
 *
 * Es una sección DENTRO del flujo, no un botón flotante: la esquina inferior
 * derecha ya la ocupa el widget de Tawk.to (tawk-chat.tsx) y dos burbujas
 * flotantes se pisarían.
 *
 * El componente es "use client" sólo por el evento de GA4 del click; el resto
 * del marcado sigue siendo estático y viaja en el HTML inicial.
 */

/** Link con mensaje pre-escrito (convención del repo: E.164 SIN "+" en wa.me). */
const WA_HREF = `https://wa.me/${WHATSAPP_CTA.numberE164}?text=${encodeURIComponent(WHATSAPP_CTA.prefilledText)}`;

/**
 * Glifo oficial de WhatsApp (viewBox 24, `fill: currentColor`) inline: la
 * landing no carga iconos remotos ni añade dependencias por un solo path.
 */
function WhatsappGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

/**
 * `send_to` es OBLIGATORIO: gtag.js sirve a GA4 y al tag de Google Ads a la
 * vez, así que un evento sin destino explícito se duplicaría en Ads.
 * No se bloquea la navegación (el link abre en pestaña nueva, no hace falta
 * event_callback) y si gtag no cargó, el click sigue funcionando igual.
 */
function trackWhatsappClick() {
  if (typeof window === "undefined") return;
  const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
  if (typeof gtag !== "function") return;
  gtag("event", "whatsapp_click", {
    send_to: GA4_MEASUREMENT_ID,
    position: "landing_pricing",
  });
}

export function WhatsappCta() {
  return (
    <section aria-label="Contacto por WhatsApp" style={{ background: "#f8fafc" }}>
      {/* Banda, no sección grande: el padding vertical es la mitad del de sus
          vecinas para que sea un puente entre precios y el bloque oscuro. */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "clamp(40px,5vw,64px) 20px" }}>
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
                <h2 className="dcv4-balance" style={{ marginTop: 6, fontSize: "clamp(22px,3vw,30px)", lineHeight: 1.2, letterSpacing: "-0.028em", fontWeight: 800, color: "#0f172a" }}>
                  {WHATSAPP_CTA.title}
                </h2>
                <p className="dcv4-pretty" style={{ marginTop: 8, fontSize: 15.5, lineHeight: 1.55, color: "#475569" }}>
                  {WHATSAPP_CTA.subtitle}
                </p>
              </div>
            </div>

            <div className="dcv4-wa-action" style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <a
                className="dcv2-btn-wa dcv4-wa-btn"
                href={WA_HREF}
                target="_blank"
                rel="noopener noreferrer"
                onClick={trackWhatsappClick}
                // El padding lateral (28px, el de los CTA del repo) vive en el
                // CSS por la misma razón que el `flex` de arriba: en móvil el
                // botón ocupa la tarjeta entera y ahí se relaja a 16px para que
                // la etiqueta no se parta en dos líneas a 360px.
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9, minHeight: 50, fontWeight: 700, fontSize: 16, borderRadius: 12 }}
              >
                <WhatsappGlyph size={18} />
                {WHATSAPP_CTA.button}
              </a>
              {/* El número a la vista: desde desktop, sin WhatsApp Web, el link
                  no lleva a ningún lado — pero el teléfono se puede copiar. */}
              <p style={{ fontSize: 13, color: "#64748b" }}>{WHATSAPP_CTA.numberDisplay}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
