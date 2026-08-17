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
 *    de texto sueltos en el mismo span;
 *  · ninguna clave de estilo se pone a `undefined` (satori la lee como cadena
 *    y truena): o se pasa un valor, o se omite la propiedad.
 *
 * TRES ESTILOS, no uno invertido tres veces (ver SOCIAL_PALETTES): cada uno
 * trae su propio contraste, su propio tratamiento del isotipo y su propio
 * color de QR. El claro NO es el oscuro con los colores volteados —el morado
 * baja a #6d28d9 para pasar contraste sobre blanco y el QR se pinta en negro
 * puro—, y el de color usa el isotipo sobre baldosa blanca, que es como está
 * dibujado en public/brand/icon-color.svg.
 */
import {
  COMBO_LAYOUT,
  FEATURE_ICONS,
  PLAN_FOOTNOTE,
  featureLabel,
  featuresForFormat,
  needsPlanFootnote,
  type FeatureIconId,
  type SocialFormat,
  type SocialStyleId,
  type SocialVariant,
  type VariantFeature,
} from "@/lib/affiliates/marketing-assets";

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

/* El tema "todo en uno" no se pinta con la escala de los demás: donde un tema
   suelto pone un titular grande y dos apoyos, este pone una rejilla de
   funciones. El titular baja (el peso lo lleva la lista) y aparecen tres
   medidas nuevas —el ícono, el cuerpo de la función y la nota al pie—, medidas
   contra la celda más angosta de cada formato. CUÁNTAS funciones entran lo
   decide el catálogo (COMBO_LAYOUT); aquí solo está de qué tamaño se pintan. */
interface ComboScale {
  /** Ícono ARRIBA del texto, no al lado: en las bandas horizontales la celda
   *  mide ~170 px y un ícono a la izquierda deja el texto en 120. */
  stack: boolean;
  /** Lado de la baldosa del ícono. */
  icon: number;
  text: number;
  headline: number;
  rowGap: number;
  colGap: number;
  foot: number;
}

const COMBOS: Record<string, ComboScale> = {
  post: { stack: false, icon: 54, text: 29, headline: 58, rowGap: 20, colGap: 26, foot: 21 },
  historia: { stack: false, icon: 58, text: 33, headline: 64, rowGap: 14, colGap: 0, foot: 25 },
  portada: { stack: true, icon: 40, text: 18, headline: 42, rowGap: 14, colGap: 12, foot: 15 },
  banner: { stack: true, icon: 42, text: 19, headline: 46, rowGap: 14, colGap: 14, foot: 16 },
};

// Ancho útil de los formatos horizontales. La portada de Facebook mide 1640 px
// pero el celular recorta a los lados: todo se compone dentro de una caja
// CENTRADA de 1080, que es lo que se ve en cualquier pantalla.
const SAFE_WIDE = 1080;

const FONT = "system-ui, sans-serif";

/* ── Paletas ───────────────────────────────────────────────────────────── */

export interface SocialPalette {
  bg: string;
  /** Baldosa del isotipo y trazos, para que el logo se lea en los tres fondos. */
  markTile: string;
  markStroke: string;
  markFill: string;
  markFaint: string;
  /** "Dale" y "Control" pueden ir en colores distintos (igual que el SVG). */
  wordA: string;
  wordB: string;
  eyebrow: string;
  headline: string;
  line: string;
  dot: string;
  /** Nota de plan: fondo, borde y tinta de la pastilla. */
  noteBg: string;
  noteLine: string;
  noteInk: string;
  /** Baldosa bajo el QR. En claro necesita borde o se pierde contra el fondo. */
  qrTile: string;
  qrTileLine: string;
  /**
   * Color de los MÓDULOS del QR. Lo consume la ruta al generar el PNG, no este
   * archivo: negro puro sobre el estilo claro, casi negro sobre los otros dos
   * (que llevan su baldosa blanca detrás). Nunca invertido — un QR en blanco
   * sobre fondo oscuro lo rechazan la mitad de las cámaras.
   */
  qrDark: string;
  scanTitle: string;
  scanUrl: string;
  badgeBg: string;
  badgeLine: string;
  badgeInk: string;
}

export const SOCIAL_PALETTES: Record<SocialStyleId, SocialPalette> = {
  oscuro: {
    bg: "linear-gradient(135deg, #0b0a14 0%, #121035 55%, #0b0a14 100%)",
    markTile: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
    markStroke: "#ffffff",
    markFill: "rgba(255,255,255,.18)",
    markFaint: "rgba(255,255,255,.5)",
    wordA: "#ffffff",
    wordB: "#ffffff",
    eyebrow: "#a78bfa",
    headline: "#ffffff",
    line: "#d5d0e6",
    dot: "#8b5cf6",
    noteBg: "rgba(167,139,250,.16)",
    noteLine: "rgba(167,139,250,.45)",
    noteInk: "#ddd6fe",
    qrTile: "#ffffff",
    qrTileLine: "rgba(255,255,255,0)",
    qrDark: "#0f172a",
    scanTitle: "#ffffff",
    scanUrl: "#a78bfa",
    badgeBg: "rgba(255,255,255,.10)",
    badgeLine: "rgba(255,255,255,.22)",
    badgeInk: "#ffffff",
  },
  // El morado de marca (#7c3aed) sobre blanco da 5.0:1: pasa para texto
  // grande, no para el cuerpo. Por eso el eyebrow y el link bajan a #6d28d9 y
  // los apoyos van en pizarra, no en morado claro.
  claro: {
    bg: "linear-gradient(135deg, #ffffff 0%, #f8fafc 60%, #f1f5f9 100%)",
    markTile: "linear-gradient(135deg, #8b5cf6, #6d28d9)",
    markStroke: "#ffffff",
    markFill: "rgba(255,255,255,.22)",
    markFaint: "rgba(255,255,255,.55)",
    wordA: "#7c3aed",
    wordB: "#0f172a",
    eyebrow: "#6d28d9",
    headline: "#0f172a",
    line: "#475569",
    dot: "#7c3aed",
    noteBg: "#f5f3ff",
    noteLine: "#c4b5fd",
    noteInk: "#5b21b6",
    qrTile: "#ffffff",
    qrTileLine: "#e2e8f0",
    qrDark: "#000000",
    scanTitle: "#0f172a",
    scanUrl: "#6d28d9",
    badgeBg: "#f1f5f9",
    badgeLine: "#cbd5e1",
    badgeInk: "#334155",
  },
  color: {
    bg: "linear-gradient(135deg, #371a7e 0%, #5b21b6 55%, #4c1d95 100%)",
    markTile: "#ffffff",
    markStroke: "#7c3aed",
    markFill: "#efeafe",
    markFaint: "#c4b5fd",
    wordA: "#ffffff",
    wordB: "#ffffff",
    eyebrow: "#ddd6fe",
    headline: "#ffffff",
    line: "#ede9fe",
    dot: "#c4b5fd",
    noteBg: "rgba(255,255,255,.15)",
    noteLine: "rgba(255,255,255,.42)",
    noteInk: "#ffffff",
    qrTile: "#ffffff",
    qrTileLine: "rgba(255,255,255,0)",
    qrDark: "#0f172a",
    scanTitle: "#ffffff",
    scanUrl: "#ddd6fe",
    badgeBg: "rgba(255,255,255,.16)",
    badgeLine: "rgba(255,255,255,.38)",
    badgeInk: "#ffffff",
  },
};

/** Isotipo de capas apiladas + palabra, igual que public/brand/icon-color.svg. */
function Lockup({ s, p }: { s: Scale; p: SocialPalette }) {
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
          background: p.markTile,
        }}
      >
        <svg width={inner} height={inner} viewBox="0 0 36 36" fill="none">
          <path d="M18 4 L31 11 L18 18 L5 11 Z" fill={p.markFill} stroke={p.markStroke} strokeWidth="2.4" strokeLinejoin="round" />
          <path d="M5.5 18.5 L18 25.2 L30.5 18.5" fill="none" stroke={p.markStroke} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5.5 24.5 L18 31.2 L30.5 24.5" fill="none" stroke={p.markFaint} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      {/* Dos spans HERMANOS dentro de un flex, no dos textos sueltos en el
          mismo span: así el estilo claro puede llevar "Dale" en morado y
          "Control" en tinta, como el logo de public/brand/. */}
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <span style={{ color: p.wordA, fontSize: s.brand, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Dale
        </span>
        <span style={{ color: p.wordB, fontSize: s.brand, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Control
        </span>
      </div>
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
function Message({ s, p, v, width }: { s: Scale; p: SocialPalette; v: SocialVariant; width?: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        ...(width ? { width } : {}),
        gap: Math.round(s.gap * 0.62),
      }}
    >
      <span style={{ color: p.eyebrow, fontSize: s.eyebrow, fontWeight: 700, letterSpacing: "0.14em" }}>
        {v.eyebrow}
      </span>
      <span
        style={{
          color: p.headline,
          fontSize: s.headline,
          fontWeight: 800,
          lineHeight: 1.12,
          letterSpacing: "-0.02em",
        }}
      >
        {v.headline}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: Math.round(s.line * 0.42) }}>
        {/* `?? []` y no `v.lines` a secas: el tema "todo en uno" no trae apoyos
            —lleva funciones— y aunque hoy no pasa por aquí, un tema sin apoyos
            no puede tumbar el render de una pieza. */}
        {(v.lines ?? []).map((l) => (
          <div key={l} style={{ display: "flex", alignItems: "flex-start", gap: Math.round(s.line * 0.5) }}>
            <div
              style={{
                display: "flex",
                width: Math.round(s.line * 0.34),
                height: Math.round(s.line * 0.34),
                borderRadius: 999,
                background: p.dot,
                marginTop: Math.round(s.line * 0.42),
              }}
            />
            <span style={{ color: p.line, fontSize: s.line, lineHeight: 1.35 }}>{l}</span>
          </div>
        ))}
      </div>
      {/* Nota de plan. Va DENTRO del mensaje y no en el pie: quien recorta la
          imagen para una historia se lleva el titular y la nota juntos, que es
          justo lo que no puede viajar separado. */}
      {v.planNote ? (
        <div style={{ display: "flex", marginTop: Math.round(s.line * 0.18) }}>
          <span
            style={{
              padding: `${Math.round(s.line * 0.26)}px ${Math.round(s.line * 0.58)}px`,
              borderRadius: Math.round(s.line * 0.34),
              background: p.noteBg,
              border: `1px solid ${p.noteLine}`,
              color: p.noteInk,
              fontSize: Math.round(s.line * 0.84),
              fontWeight: 700,
            }}
          >
            {v.planNote}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ícono de una función, sobre la misma baldosa que usa la nota de plan. El
 * trazo sale de FEATURE_ICONS (el catálogo), no de un SVG local: el mismo
 * dibujo lo pintan también el PDF y la vista previa del panel.
 */
function FeatureIcon({ id, box, p }: { id: FeatureIconId; box: number; p: SocialPalette }) {
  const inner = Math.round(box * 0.6);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        width: box,
        height: box,
        borderRadius: Math.round(box * 0.28),
        background: p.noteBg,
        border: `1px solid ${p.noteLine}`,
      }}
    >
      <svg width={inner} height={inner} viewBox="0 0 24 24" fill="none">
        {FEATURE_ICONS[id].map((d) => (
          <path
            key={d}
            d={d}
            fill="none"
            stroke={p.eyebrow}
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}

/**
 * El tema "todo en uno": titular corto + rejilla de funciones + nota al pie.
 *
 * La rejilla se arma A MANO por filas. Satori no tiene CSS grid, así que las
 * columnas son flex con ancho CALCULADO: sin un `width` explícito por celda,
 * la función de texto más largo se quedaría con media fila y las demás
 * quedarían apretadas contra el borde.
 *
 * La nota al pie aparece solo si en ESTA pieza salió alguna función con tope
 * (`needsPlanFootnote` sobre la lista ya recortada): la portada muestra cuatro
 * funciones sin tope y no arrastra una nota que no le toca.
 */
function ComboBlock({
  s,
  c,
  p,
  v,
  features,
  cols,
  width,
}: {
  s: Scale;
  c: ComboScale;
  p: SocialPalette;
  v: SocialVariant;
  features: VariantFeature[];
  cols: number;
  width: number;
}) {
  const rows: VariantFeature[][] = [];
  for (let i = 0; i < features.length; i += cols) rows.push(features.slice(i, i + cols));

  const cellW = Math.floor((width - c.colGap * (cols - 1)) / cols);
  const iconGap = Math.round(c.icon * 0.3);
  const textW = c.stack ? cellW : cellW - c.icon - iconGap;

  return (
    <div style={{ display: "flex", flexDirection: "column", width, gap: Math.round(s.gap * 0.62) }}>
      <span style={{ color: p.eyebrow, fontSize: s.eyebrow, fontWeight: 700, letterSpacing: "0.14em" }}>
        {v.eyebrow}
      </span>
      <span
        style={{
          color: p.headline,
          fontSize: c.headline,
          fontWeight: 800,
          lineHeight: 1.12,
          letterSpacing: "-0.02em",
        }}
      >
        {v.headline}
      </span>

      <div style={{ display: "flex", flexDirection: "column", gap: c.rowGap, marginTop: Math.round(c.rowGap * 0.3) }}>
        {rows.map((row) => (
          <div key={row[0].text} style={{ display: "flex", gap: c.colGap }}>
            {row.map((f) => (
              <div
                key={f.text}
                style={{
                  display: "flex",
                  width: cellW,
                  flexDirection: c.stack ? "column" : "row",
                  alignItems: c.stack ? "flex-start" : "center",
                  gap: iconGap,
                }}
              >
                <FeatureIcon id={f.icon} box={c.icon} p={p} />
                <span style={{ width: textW, color: p.line, fontSize: c.text, lineHeight: 1.3, fontWeight: 600 }}>
                  {featureLabel(f)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {needsPlanFootnote(features) ? (
        <span style={{ color: p.line, fontSize: c.foot, fontWeight: 600, marginTop: Math.round(c.foot * 0.3) }}>
          {PLAN_FOOTNOTE}
        </span>
      ) : null}
    </div>
  );
}

/** Baldosa blanca: el QR necesita fondo claro para que lo lea un celular. */
function QrTile({ s, p, src }: { s: Scale; p: SocialPalette; src: string }) {
  return (
    <div
      style={{
        display: "flex",
        padding: Math.round(s.qr * 0.07),
        background: p.qrTile,
        border: `1px solid ${p.qrTileLine}`,
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
  p,
  urlText,
  name,
  align,
}: {
  s: Scale;
  p: SocialPalette;
  urlText: string;
  name: string | null;
  align: "flex-start" | "center";
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: align, gap: Math.round(s.line * 0.3) }}>
      <span style={{ color: p.scanTitle, fontSize: Math.round(s.line * 1.05), fontWeight: 700 }}>
        Escanea para conocerlo
      </span>
      <span style={{ color: p.scanUrl, fontSize: Math.round(s.line * 0.88), fontWeight: 600 }}>
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
              background: p.badgeBg,
              border: `1px solid ${p.badgeLine}`,
              color: p.badgeInk,
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
  style,
  qrDataUrl,
  urlText,
  affiliateName,
}: {
  format: SocialFormat;
  variant: SocialVariant;
  /** Tratamiento visual elegido: oscuro, claro o color. */
  style: SocialStyleId;
  qrDataUrl: string;
  /** Link corto sin protocolo: lo que el ojo lee bajo el QR. */
  urlText: string;
  /** "Martín R." — null si la cuenta no tiene nombre. */
  affiliateName: string | null;
}) {
  const s = SCALES[format.id];
  const p = SOCIAL_PALETTES[style];
  const wide = format.layout === "wide";
  // Columnas de los horizontales. La del QR NO se mide por el código sino por
  // lo que va DEBAJO: con solo la baldosa + holgura, el link corto se partía a
  // media palabra ("dalecontrol.com/r/ ⏎ AB12CD34"). El sobrante de 170 px
  // cabe el link de una tirada y el mensaje se queda el resto de la caja.
  const rightW = s.qr + 170;
  const leftW = SAFE_WIDE - rightW - 48;

  // Un tema que lista funciones se pinta como rejilla; los demás, con titular
  // y apoyos. Es la MISMA pieza (mismo logo, mismo QR, mismos tres estilos):
  // lo único que cambia es el bloque de en medio.
  const features = featuresForFormat(variant, format.id);
  const body =
    features.length > 0 ? (
      <ComboBlock
        s={s}
        c={COMBOS[format.id]}
        p={p}
        v={variant}
        features={features}
        cols={COMBO_LAYOUT[format.id].cols}
        // Apilado, el bloque ocupa el ancho de la página menos los márgenes;
        // en los horizontales, la columna que le deja el QR.
        width={wide ? leftW : format.width - 2 * s.pad}
      />
    ) : wide ? (
      <Message s={s} p={p} v={variant} width={leftW} />
    ) : (
      <Message s={s} p={p} v={variant} />
    );

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        padding: `${s.padTop ?? s.pad}px ${s.pad}px ${s.padBottom ?? s.pad}px`,
        background: p.bg,
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
              <Lockup s={s} p={p} />
              {body}
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
              <QrTile s={s} p={p} src={qrDataUrl} />
              <ScanCopy s={s} p={p} urlText={urlText} name={affiliateName} align="center" />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
          <Lockup s={s} p={p} />
          {/* El mensaje va CENTRADO en el hueco que sobra, no repartido con
              `space-between`: en la historia (1920 px de alto) el reparto
              dejaba un vacío enorme entre el logo y el titular. */}
          <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, justifyContent: "center" }}>
            {body}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: s.gap }}>
            <QrTile s={s} p={p} src={qrDataUrl} />
            <ScanCopy s={s} p={p} urlText={urlText} name={affiliateName} align="flex-start" />
          </div>
        </div>
      )}
    </div>
  );
}
