/**
 * Arte de la imagen social (Open Graph / Twitter) de /barberias.
 *
 * Se renderiza con satori (next/og) en el Edge, así que este módulo NO
 * importa nada del vertical: satori exige `display: flex` en cada caja con
 * varios hijos y no acepta claves de estilo en undefined. Los textos los
 * pasa la ruta de la imagen leyendo landing.es.json.
 *
 * Misma identidad que el registro: caramelo sobre negro cálido.
 */
export function BarberOgArtwork({
  brand,
  vertical,
  title,
  sub,
}: {
  brand: string;
  vertical: string;
  title: string;
  sub: string;
}) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "64px",
        background: "linear-gradient(160deg, #121010 0%, #241410 60%, #3D2417 100%)",
        color: "#FAF5EE",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "18px",
            background: "linear-gradient(135deg, #A2612F, #BE7A3C)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="3" />
            <path d="M8.12 8.12 12 12" />
            <path d="M20 4 8.12 15.88" />
            <circle cx="6" cy="18" r="3" />
            <path d="M14.8 14.8 20 20" />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.5px" }}>{brand}</span>
          <span style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "5px", color: "#DDB587" }}>
            {vertical.toUpperCase()}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "22px", maxWidth: "980px" }}>
        <div style={{ display: "flex", fontSize: "68px", fontWeight: 700, lineHeight: 1.05, letterSpacing: "-2px" }}>
          {title}
        </div>
        <div style={{ display: "flex", fontSize: "30px", color: "#DDB587", fontWeight: 600 }}>{sub}</div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: "22px",
          color: "rgba(250,245,238,0.72)",
        }}
      >
        <span>dalecontrol.com/barberias</span>
        <span>✂️ 💈</span>
      </div>
    </div>
  );
}
