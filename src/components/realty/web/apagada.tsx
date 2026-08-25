/* ═══════════════════════════════════════════════════════════════════════
   LA WEB APAGADA A PROPÓSITO.

   No es un 404: el slug existe y la cuenta la vuelve a encender en un
   clic. Un 404 le diría a Google que la página desapareció y le costaría
   la indexación que tanto trabajo cuesta ganar; además dejaría sin salida
   a quien llegó por un letrero o por una tarjeta impresa.

   Sin dependencias del motor de plantillas a propósito (estilos en línea):
   si la web está apagada es porque algo se está tocando, y esta pantalla
   no puede depender de lo que se esté tocando.
   ═══════════════════════════════════════════════════════════════════════ */

import { ligaWhatsApp, type RealtyWebData } from "@/lib/realty/landing";

export function WebApagada({ data }: { data: RealtyWebData }) {
  const tel = data.config.telefono || data.cuenta.telefono;
  const wa = ligaWhatsApp(
    data.config.whatsapp || data.cuenta.telefono || "",
    `Hola, quiero información de ${data.cuenta.nombre}.`,
  );

  return (
    <main
      style={{
        minHeight: "80vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        textAlign: "center",
        background: "#F5F1E8",
        color: "#14201A",
        fontFamily: "var(--font-sans, system-ui), system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 460 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: "0 0 8px" }}>{data.cuenta.nombre}</h1>
        <p style={{ opacity: 0.72, margin: "0 0 22px", lineHeight: 1.55 }}>
          Nuestra página estará disponible muy pronto.
        </p>
        {wa ? (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              // 6.04:1 con texto blanco. El #128C7E "oficial" se queda en
              // 4.14 y no pasa AA en texto normal.
              background: "#0E6F64",
              color: "#fff",
              padding: "13px 26px",
              borderRadius: 999,
              fontWeight: 650,
            }}
          >
            Escríbenos por WhatsApp
          </a>
        ) : tel ? (
          <a
            href={`tel:${tel}`}
            style={{
              display: "inline-block",
              background: "#2F6B4D",
              color: "#fff",
              padding: "13px 26px",
              borderRadius: 999,
              fontWeight: 650,
            }}
          >
            Llámanos
          </a>
        ) : null}
      </div>
    </main>
  );
}
