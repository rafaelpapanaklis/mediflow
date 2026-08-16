/**
 * Arte de las imágenes para redes del kit de marketing del afiliado.
 *
 * Vive fuera de la ruta por lo mismo que los documentos de src/lib/pdf/: la
 * ruta se queda con la sesión, los parámetros y el QR, y el dibujo se puede
 * mirar (y probar) sin montar una petición autenticada.
 *
 * Lo pinta satori (ImageResponse), NO un navegador: solo entiende un
 * subconjunto de flexbox. De ahí las reglas que se respetan aquí —
 *  · todo contenedor con hijos lleva `display: "flex"` explícito;
 *  · nada de `gap` sin flex, ni grid, ni position absolute;
 *  · los textos se arman en JS (`Recomendado por ${name}`), no con dos hijos
 *    de texto sueltos en el mismo span.
 * La misma identidad de /og/blog: fondo casi negro con violeta, isotipo de
 * capas apiladas y titular grande.
 */
import type { SocialFormat, SocialVariant } from "@/lib/affiliates/marketing-assets";

/* Un solo juego de proporciones no sirve para 1080×1080 y para 1640×624: el
   titular que respira en el cuadrado se sale de la portada. Cada formato trae
   sus cuerpos, medidos contra el texto más largo del catálogo. */
interface Scale {
  pad: number;
  /**
   * Sangrado vertical propio. La historia lo necesita: Instagram le encima su
   * cabecera arriba y la barra de "enviar mensaje" abajo, así que el logo y el
   * QR tienen que entrar hacia el centro o quedan tapados justo en la pieza
   * donde el QR es lo único que importa.
   */
  padTop?: number;
  padBottom?: number;
  mark: number;
  brand: number;
  eyebrow: number;
  headline: number;
  line: number;
  qr: number;
  gap: number;
}

const SCALES: Record<string, Scale> = {
  post: { pad: 76, mark: 66, brand: 42, eyebrow: 24, headline: 68, line: 30, qr: 210, gap: 26 },
  historia: { pad: 92, padTop: 200, padBottom: 250, mark: 76, brand: 48, eyebrow: 28, headline: 84, line: 36, qr: 250, gap: 32 },
  portada: { pad: 56, mark: 48, brand: 30, eyebrow: 18, headline: 48, line: 23, qr: 156, gap: 18 },
  banner: { pad: 60, mark: 52, brand: 34, eyebrow: 20, headline: 52, line: 25, qr: 172, gap: 20 },
};

// Ancho útil de los formatos horizontales. La portada de Facebook mide 1640 px
// pero el celular recorta a los lados: todo se compone dentro de una caja
// CENTRADA de 1080, que es lo que se ve en cualquier pantalla.
const SAFE_WIDE = 1080;

const BG = "linear-gradient(135deg, #0B0815 0%, #1a0b2e 55%, #0B0815 100%)";
const FONT = "system-ui, sans-serif";

/** Isotipo de capas apiladas + palabra, igual que /og/blog. */
function Lockup({ s }: { s: Scale }) {
  const inner = Math.round(s.mark * 0.68);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(s.mark * 0.28) }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: s.mark,
          height: s.mark,
          borderRadius: Math.round(s.mark * 0.26),
          background: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
        }}
      >
        <svg width={inner} height={inner} viewBox="0 0 36 36" fill="none">
          <path d="M18 4 L31 11 L18 18 L5 11 Z" fill="rgba(255,255,255,.18)" stroke="#ffffff" strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M5.5 18.5 L18 25.2 L30.5 18.5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 24.5 L18 31.2 L30.5 24.5" fill="none" stroke="#ffffff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" opacity=".5" />
        </svg>
      </div>
      <span style={{ color: "#ffffff", fontSize: s.brand, fontWeight: 700, letterSpacing: "-0.02em" }}>
        DaleControl
      </span>
    </div>
  );
}

/**
 * `width` solo en los horizontales: apilado, el texto envuelve con la caja.
 *
 * OJO: la propiedad se OMITE cuando no hay ancho. Satori no tolera una clave
 * de estilo puesta a `undefined` —intenta leerla como cadena y truena con
 * "Cannot read properties of undefined (reading 'trim')"—, así que
 * `width: undefined` no es lo mismo que no pasar `width`.
 */
function Message({ s, v, width }: { s: Scale; v: SocialVariant; width?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        ...(width ? { width } : {}),
        gap: Math.round(s.gap * 0.62),
      }}
    >
      <span style={{ color: "#a78bfa", fontSize: s.eyebrow, fontWeight: 700, letterSpacing: "0.14em" }}>
        {v.eyebrow}
      </span>
      <span
        style={{
          color: "#ffffff",
          fontSize: s.headline,
          fontWeight: 800,
          lineHeight: 1.12,
          letterSpacing: "-0.02em",
        }}
      >
        {v.headline}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: Math.round(s.line * 0.42) }}>
        {v.lines.map((l) => (
          <div key={l} style={{ display: "flex", alignItems: "flex-start", gap: Math.round(s.line * 0.5) }}>
            <div
              style={{
                display: "flex",
                width: Math.round(s.line * 0.34),
                height: Math.round(s.line * 0.34),
                borderRadius: 999,
                background: "#8b5cf6",
                marginTop: Math.round(s.line * 0.42),
              }}
            />
            <span style={{ color: "#d5d0e6", fontSize: s.line, lineHeight: 1.35 }}>{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Baldosa blanca: el QR necesita fondo claro para que lo lea un celular. */
function QrTile({ s, src }: { s: Scale; src: string }) {
  return (
    <div
      style={{
        display: "flex",
        padding: Math.round(s.qr * 0.07),
        background: "#ffffff",
        borderRadius: Math.round(s.qr * 0.09),
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={s.qr} height={s.qr} />
    </div>
  );
}

function ScanCopy({
  s,
  urlText,
  name,
  align,
}: {
  s: Scale;
  urlText: string;
  name: string | null;
  align: "flex-start" | "center";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align, gap: Math.round(s.line * 0.3) }}>
      <span style={{ color: "#ffffff", fontSize: Math.round(s.line * 1.05), fontWeight: 700 }}>
        Escanea para conocerlo
      </span>
      <span style={{ color: "#a78bfa", fontSize: Math.round(s.line * 0.88), fontWeight: 600 }}>
        {urlText}
      </span>
      {/* Sin nombre en la cuenta la línea se OMITE: la pieza sale igual, con su
          QR, en vez de con un "Recomendado por" colgando. */}
      {name ? (
        <div style={{ display: "flex", marginTop: Math.round(s.line * 0.28) }}>
          <span
            style={{
              padding: `${Math.round(s.line * 0.3)}px ${Math.round(s.line * 0.6)}px`,
              borderRadius: 999,
              background: "rgba(255,255,255,.10)",
              border: "1px solid rgba(255,255,255,.22)",
              color: "#ffffff",
              fontSize: Math.round(s.line * 0.85),
              fontWeight: 600,
            }}
          >
            {`Recomendado por ${name}`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function AffiliateMarketingArtwork({
  format,
  variant,
  qrDataUrl,
  urlText,
  affiliateName,
}: {
  format: SocialFormat;
  variant: SocialVariant;
  qrDataUrl: string;
  /** Link corto sin protocolo: lo que el ojo lee bajo el QR. */
  urlText: string;
  /** "Martín R." — null si la cuenta no tiene nombre. */
  affiliateName: string | null;
}) {
  const s = SCALES[format.id];
  const wide = format.layout === "wide";
  // Columnas de los horizontales. La del QR NO se mide por el código sino por
  // lo que va DEBAJO: con solo la baldosa + holgura, el link corto se partía a
  // media palabra ("dalecontrol.com/r/ ⏎ AB12CD34"). El sobrante de 170 px
  // cabe el link de una tirada y el mensaje se queda el resto de la caja.
  const rightW = s.qr + 170;
  const leftW = SAFE_WIDE - rightW - 48;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: `${s.padTop ?? s.pad}px ${s.pad}px ${s.padBottom ?? s.pad}px`,
        background: BG,
        fontFamily: FONT,
      }}
    >
      {wide ? (
        <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
          <div
            style={{
              display: "flex",
              width: SAFE_WIDE,
              alignItems: "center",
              justifyContent: "space-between",
              gap: 48,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: s.gap, width: leftW }}>
              <Lockup s={s} />
              <Message s={s} v={variant} width={leftW} />
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                width: rightW,
                gap: Math.round(s.gap * 0.7),
              }}
            >
              <QrTile s={s} src={qrDataUrl} />
              <ScanCopy s={s} urlText={urlText} name={affiliateName} align="center" />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
          <Lockup s={s} />
          {/* El mensaje va CENTRADO en el hueco que sobra, no repartido con
              `space-between`: en la historia (1920 px de alto) el reparto
              dejaba un vacío enorme entre el logo y el titular. */}
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
            <Message s={s} v={variant} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: s.gap }}>
            <QrTile s={s} src={qrDataUrl} />
            <ScanCopy s={s} urlText={urlText} name={affiliateName} align="flex-start" />
          </div>
        </div>
      )}
    </div>
  );
}
