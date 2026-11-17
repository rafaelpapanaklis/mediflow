/* El dibujo del ícono de la tarjeta de estrellas (ws6-t2, punto 5).

   JSX para `ImageResponse` (next/og): solo flexbox y estilos en línea, que es
   lo que ese generador entiende. Sin "use client": se pinta en el servidor.

   Con logo: el logo dentro de un disco claro sobre el acento de la barbería.
   Sin logo: su inicial y una estrella. Todo cabe en el 80 % central (la zona
   segura de los íconos «maskable» de Android). */

export function IconoTarjeta({
  size,
  inicial,
  logo,
  fondo,
  tinta,
}: {
  size: number;
  /** Letra o número; cadena vacía = solo la estrella. */
  inicial: string;
  /** Data URL (PNG/JPEG) del logo, o null. */
  logo: string | null;
  fondo: string;
  tinta: string;
}) {
  const disco = Math.round(size * 0.66);
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: fondo,
      }}
    >
      {logo ? (
        <div
          style={{
            width: disco,
            height: disco,
            borderRadius: disco,
            background: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt="" width={Math.round(disco * 0.78)} height={Math.round(disco * 0.78)} style={{ objectFit: "contain" }} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          {inicial ? (
            <div style={{ display: "flex", fontSize: Math.round(size * 0.46), fontWeight: 700, lineHeight: 1, color: tinta }}>{inicial}</div>
          ) : null}
          <svg
            width={Math.round(size * (inicial ? 0.16 : 0.5))}
            height={Math.round(size * (inicial ? 0.16 : 0.5))}
            viewBox="0 0 24 24"
            style={{ marginTop: inicial ? Math.round(size * 0.03) : 0 }}
          >
            <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill={tinta} />
          </svg>
        </div>
      )}
    </div>
  );
}
