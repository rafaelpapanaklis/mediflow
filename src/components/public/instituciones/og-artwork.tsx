/**
 * Arte de la imagen social (Open Graph / X) de /instituciones.
 *
 * Se renderiza con satori (next/og) en el Edge, así que este módulo NO
 * importa nada del vertical ni de lucide: satori exige `display: flex` en
 * toda caja con varios hijos y no acepta una clave de estilo en undefined.
 * El birrete va como SVG a mano por lo mismo.
 *
 * Misma identidad que la página: índigo universitario, regla dorada y una
 * romana en el titular.
 */
export function EduOgArtwork({
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
        padding: "62px 64px",
        background: "linear-gradient(155deg, #1e2b4a 0%, #23345a 52%, #121a2e 100%)",
        color: "#e6ecf7",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
        <div
          style={{
            width: "62px",
            height: "62px",
            borderRadius: "17px",
            background: "linear-gradient(140deg, #344e8c, #23345a)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid rgba(216,174,94,0.45)",
          }}
        >
          <svg
            width="34"
            height="34"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#e8c98a"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 10 12 5 2 10l10 5 10-5Z" />
            <path d="M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5" />
          </svg>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: "27px", fontWeight: 700, letterSpacing: "-0.01em" }}>
            {brand}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "16px",
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#d8ae5e",
            }}
          >
            {vertical}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            fontSize: "62px",
            lineHeight: 1.08,
            fontWeight: 700,
            letterSpacing: "-0.022em",
            color: "#ffffff",
            maxWidth: "980px",
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: "flex",
            marginTop: "24px",
            fontSize: "27px",
            lineHeight: 1.4,
            color: "#b9c3d6",
            maxWidth: "880px",
          }}
        >
          {sub}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            display: "flex",
            height: "3px",
            width: "100%",
            background: "linear-gradient(90deg, #d8ae5e, #f2e0bb 45%, rgba(216,174,94,0))",
          }}
        />
        <div
          style={{
            display: "flex",
            marginTop: "18px",
            fontSize: "21px",
            color: "#9bb0dc",
          }}
        >
          dalecontrol.com/instituciones
        </div>
      </div>
    </div>
  );
}
