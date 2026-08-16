import { Document, Page, Text, View, Image, Svg, Path, StyleSheet } from "@react-pdf/renderer";
import type { SocialStyleId, SocialVariant } from "@/lib/affiliates/marketing-assets";

/**
 * Material IMPRIMIBLE del kit de marketing del afiliado: tarjetas de
 * presentación, volante de una plana y díptico de expo.
 *
 * Espeja el estilo de src/lib/pdf/affiliate-statement-document.tsx —
 * Helvetica/Helvetica-Bold built-in (SIN Font.register: registrar una fuente
 * que no se pueda descargar en el runtime tumba el render entero) y violeta
 * #7c3aed de marca.
 *
 * PENSADO PARA IMPRENTA:
 *  - Tintas planas, cero degradados: un degradado que se ve bien en pantalla
 *    se separa sucio en CMYK y sale bandeado en una láser de consultorio.
 *  - Contraste alto: texto casi negro sobre blanco o blanco sobre violeta
 *    sólido, nunca gris sobre gris.
 *  - Margen de seguridad de 5 mm (14.17 pt) en toda pieza: ninguna
 *    guillotina corta exacto.
 *  - Medidas en puntos, que es la unidad de @react-pdf (1 mm = 2.8346 pt).
 *  - El QR SIEMPRE sobre baldosa blanca (QrChip), aunque la pieza vaya en
 *    oscuro o en morado: un QR sin fondo claro no lo lee ninguna cámara.
 *
 * TRES ESTILOS (PRINT_PALETTES). El CLARO es el recomendado para imprenta —
 * pone tinta solo donde hay texto— y es el que el panel ofrece por defecto;
 * los otros dos existen porque el mismo volante en morado funciona mejor en un
 * stand de expo que en un mostrador.
 *
 * EL VOLANTE Y EL DÍPTICO LLEVAN EL TEMA que el afiliado eligió: su titular,
 * su entrada y —si el tema tiene tope de plan— su nota. La TARJETA no: en
 * 90 × 50 mm no cabe un titular de campaña con su nota, y una tarjeta se
 * entrega para presentarse.
 *
 * El contenido describe lo que el sistema hace HOY. Sin precios (cambian y el
 * papel no), sin "prueba gratis" (el registro cobra desde el primer mes), sin
 * certificaciones que no existen, sin lenguaje de diagnóstico sobre las
 * tomografías y sin garantías de resultado.
 */

export interface AffiliatePrintProps {
  /** "Martín R." — null si la cuenta no tiene nombre: la línea se omite. */
  affiliateName: string | null;
  /** Texto visible del link corto: "dalecontrol.com/r/AB12CD34". */
  shortUrl: string;
  /** PNG del QR en data URL, ya generado en el servidor. */
  qrDataUrl: string;
  /** Tratamiento visual: claro (recomendado para papel), oscuro o color. */
  style: SocialStyleId;
  /** Tema que encabeza volante y díptico. La tarjeta lo ignora. */
  variant: SocialVariant;
}

/* ── Medidas ──────────────────────────────────────────────────────────── */

const MM = 2.834645669;
/** Margen de seguridad de 5 mm — nada legible entra aquí. */
const SAFE = 5 * MM;

/* ── Paletas ──────────────────────────────────────────────────────────────
   Todo color de las piezas sale de aquí. Nada de constantes sueltas: si un
   tono se escribiera a mano en un estilo, ese estilo dejaría de ser un estilo
   terminado y pasaría a ser el claro con un parche encima. */

export interface PrintPalette {
  page: string;
  ink: string;
  ink2: string;
  ink3: string;
  /** Violeta (o su equivalente legible) para eyebrows, viñetas y filetes. */
  accent: string;
  /** Tinta del link corto: la que más contraste tiene sobre `page`. */
  link: string;
  /** Relleno de la viñeta numerada y tinta del número que va dentro. */
  bulletBg: string;
  bulletInk: string;
  /** Banda superior del volante. */
  band: string;
  bandInk: string;
  bandSub: string;
  /** Superficie de las cajas (CTA del volante, caja de QR del díptico). */
  tint: string;
  tintLine: string;
  line: string;
  /** Marcas de corte y de doblez. */
  mark: string;
  /** Panel portada del díptico. */
  cover: string;
  coverInk: string;
  coverSub: string;
  coverFoot: string;
  /** Nota de plan. */
  noteBg: string;
  noteLine: string;
  noteInk: string;
  /** El isotipo va en su versión clara (trazo blanco) sobre fondos oscuros. */
  lockupOnDark: boolean;
  /** …y sobre la banda / la portada, que pueden ser oscuras aunque la página no. */
  lockupOnBandDark: boolean;
}

const VIOLET = "#7c3aed";
const VIOLET_DEEP = "#5b21b6";

export const PRINT_PALETTES: Record<SocialStyleId, PrintPalette> = {
  // El de siempre: blanco con violeta. Menos tóner, mejor separación a CMYK.
  claro: {
    page: "#ffffff",
    ink: "#14101f",
    ink2: "#4a4857",
    ink3: "#6b6b78",
    accent: VIOLET,
    link: VIOLET_DEEP,
    bulletBg: VIOLET,
    bulletInk: "#ffffff",
    band: VIOLET,
    bandInk: "#ffffff",
    bandSub: "#ede9fe",
    tint: "#f4f2f8",
    tintLine: "#e4e0ef",
    line: "#d9d6e4",
    mark: "#8e8c9b",
    cover: VIOLET,
    coverInk: "#ffffff",
    coverSub: "#ede9fe",
    coverFoot: "#ddd6fe",
    noteBg: "#f5f3ff",
    noteLine: "#c4b5fd",
    noteInk: VIOLET_DEEP,
    lockupOnDark: false,
    lockupOnBandDark: true,
  },
  // Tinta plana en toda la hoja: para stand o para papel de mayor gramaje.
  // El violeta sube a #a78bfa porque #7c3aed sobre casi negro no se lee.
  oscuro: {
    page: "#141126",
    ink: "#ffffff",
    ink2: "#cfcbdf",
    ink3: "#9a95ad",
    accent: "#a78bfa",
    link: "#c4b5fd",
    bulletBg: "#8b5cf6",
    bulletInk: "#ffffff",
    band: "#0b0a14",
    bandInk: "#ffffff",
    bandSub: "#c4b5fd",
    tint: "#1f1b38",
    tintLine: "#332d52",
    line: "#332d52",
    mark: "#6f6a88",
    cover: "#0b0a14",
    coverInk: "#ffffff",
    coverSub: "#d5d0e6",
    coverFoot: "#a78bfa",
    noteBg: "#241f42",
    noteLine: "#4c4275",
    noteInk: "#ddd6fe",
    lockupOnDark: true,
    lockupOnBandDark: true,
  },
  // Morado de marca a toda página. Las viñetas se vuelven blancas con el
  // número en violeta: un cuadro violeta sobre fondo violeta no se ve.
  color: {
    page: "#4c1d95",
    ink: "#ffffff",
    ink2: "#ede9fe",
    ink3: "#ddd6fe",
    accent: "#ddd6fe",
    link: "#ffffff",
    bulletBg: "#ffffff",
    bulletInk: VIOLET_DEEP,
    band: "#371a7e",
    bandInk: "#ffffff",
    bandSub: "#ddd6fe",
    tint: "#3d1580",
    tintLine: "#6d34c4",
    line: "#6d34c4",
    mark: "#9a6fe0",
    cover: "#371a7e",
    coverInk: "#ffffff",
    coverSub: "#ede9fe",
    coverFoot: "#ddd6fe",
    noteBg: "#3d1580",
    noteLine: "#a78bfa",
    noteInk: "#ffffff",
    lockupOnDark: true,
    lockupOnBandDark: true,
  },
};

/* ── Marca ────────────────────────────────────────────────────────────── */

/** Isotipo de capas apiladas (public/brand/icon-color.svg) en trazo plano. */
function Mark({ size, onDark = false }: { size: number; onDark?: boolean }) {
  const stroke = onDark ? "#ffffff" : VIOLET;
  const fill = onDark ? "none" : "#efeafe";
  // Tercera capa en color más claro en vez de con opacidad: las tintas planas
  // se imprimen predecibles, las transparencias no siempre.
  const faint = onDark ? "#ddd6fe" : "#c4b5fd";
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36">
      <Path d="M18 4 L31 11 L18 18 L5 11 Z" fill={fill} stroke={stroke} strokeWidth={2.4} strokeLinejoin="round" />
      <Path d="M5.5 18.5 L18 25.2 L30.5 18.5" fill="none" stroke={stroke} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.5 24.5 L18 31.2 L30.5 24.5" fill="none" stroke={faint} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function Wordmark({ size, onDark = false, ink }: { size: number; onDark?: boolean; ink: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline" }}>
      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: size, color: onDark ? "#ffffff" : VIOLET }}>
        Dale
      </Text>
      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: size, color: onDark ? "#ffffff" : ink }}>
        Control
      </Text>
    </View>
  );
}

function Lockup({ size, onDark = false, ink }: { size: number; onDark?: boolean; ink: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Mark size={size * 1.45} onDark={onDark} />
      <View style={{ width: size * 0.4 }} />
      <Wordmark size={size} onDark={onDark} ink={ink} />
    </View>
  );
}

/**
 * QR sobre baldosa blanca SIEMPRE. Sobre el estilo claro la baldosa no se
 * nota; sobre el oscuro y el de color es lo único que hace que el código se
 * pueda escanear.
 */
function QrChip({ src, size }: { src: string; size: number }) {
  const pad = Math.round(size * 0.06);
  return (
    <View style={{ backgroundColor: "#ffffff", padding: pad, borderRadius: 4 }}>
      <Image src={src} style={{ width: size, height: size }} />
    </View>
  );
}

/** Pastilla con el plan que incluye el tema. Solo si el tema tiene tope. */
function PlanNote({ p, note, size = 9 }: { p: PrintPalette; note: string; size?: number }) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: p.noteBg,
        borderWidth: 0.7,
        borderColor: p.noteLine,
        borderRadius: 4,
        paddingVertical: 4,
        paddingHorizontal: 8,
      }}
    >
      <Text style={{ fontSize: size, fontFamily: "Helvetica-Bold", color: p.noteInk }}>{note}</Text>
    </View>
  );
}

/* ── Contenido de venta (compartido por volante y díptico) ─────────────────
   Listas GENÉRICAS: solo funciones que vienen en todos los planes. Lo que
   tiene tope (IA, multi-sucursal) entra únicamente como TEMA elegido, y
   entonces viaja con su nota de plan pegada. Así ninguna lista suelta promete
   algo que el Básico no trae. */

const FEATURES: { title: string; desc: string }[] = [
  {
    title: "Agenda con recordatorios por WhatsApp",
    desc: "El aviso de la cita sale en automático, a la hora que tú decidas, para que al paciente no se le olvide.",
  },
  {
    title: "Expediente clínico completo",
    desc: "Historial, notas de cada consulta y documentos de cada paciente, a un clic y sin carpetas sueltas.",
  },
  {
    title: "Odontograma digital",
    desc: "Registro por diente y por superficie, con el historial de tratamientos del paciente siempre a la mano.",
  },
  {
    title: "Facturación CFDI 4.0",
    desc: "Timbras desde la misma pantalla donde registras el cobro, sin capturar los mismos datos en otro portal.",
  },
  {
    title: "Tu página web y el portal del paciente",
    desc: "Una mini-web donde agendan en línea, y un enlace seguro donde cada paciente consulta lo suyo.",
  },
];

const PROBLEMS: { title: string; desc: string }[] = [
  {
    title: "La agenda en papel",
    desc: "Los cambios de última hora no se avisan solos y las confirmaciones se hacen a mano, una por una.",
  },
  {
    title: "El expediente repartido",
    desc: "Las radiografías en una carpeta, las notas en otra y los datos del paciente en la libreta de recepción.",
  },
  {
    title: "La facturación aparte",
    desc: "Volver a capturar los mismos datos en otro portal cada vez que un paciente pide su factura.",
  },
  {
    title: "El WhatsApp de la clínica",
    desc: "Alguien tiene que contestar a qué hora era la cita y qué sigue en el tratamiento, mensaje por mensaje.",
  },
  {
    title: "Los números del mes",
    desc: "Cuánto entró, cuántas citas se cayeron y qué tratamiento se hace más: hoy solo salen si alguien se sienta a sacarlos.",
  },
];

const INCLUDES: string[] = [
  "Agenda con confirmación y recordatorios por WhatsApp",
  "Bot que contesta el WhatsApp y agenda citas",
  "Expediente clínico y odontograma digital",
  "Tomografías CBCT y modelos 3D en el navegador",
  "Facturación CFDI 4.0 y control de cobros",
  "Mini-web propia con reserva en línea",
  "Portal del paciente con acceso por enlace seguro",
];

const TAGLINE = "Software mexicano para clínicas y consultorios";
const FOOTER_LINE = "DaleControl · En español, en pesos y con soporte en español";
/** Pitch de la tarjeta: no lleva tema, así que describe el producto entero. */
const CARD_PITCH =
  "Agenda, expediente clínico y facturación CFDI para tu clínica, en un solo sistema.";

/* ══════════════════════════════════════════════════════════════════════
   1) TARJETAS DE PRESENTACIÓN — carta con 10 tarjetas de 90 × 50 mm
   ══════════════════════════════════════════════════════════════════════ */

const CARD_W = 90 * MM; // 255.12 pt
const CARD_H = 50 * MM; // 141.73 pt
const CARD_COLS = 2;
const CARD_ROWS = 5;
const LETTER_W = 612;
const LETTER_H = 792;
const GRID_W = CARD_W * CARD_COLS; // 510.24
const GRID_H = CARD_H * CARD_ROWS; // 708.66
// Rejilla centrada: quedan ~50.9 pt a los lados y ~41.7 arriba y abajo, aire
// de sobra para las marcas de corte sin que ninguna caiga fuera de la hoja.
const GRID_X = (LETTER_W - GRID_W) / 2;
const GRID_Y = (LETTER_H - GRID_H) / 2;
const TICK_LEN = 9;
const TICK_GAP = 4;

const cardStyles = (p: PrintPalette) =>
  StyleSheet.create({
    page: { fontFamily: "Helvetica", color: p.ink, backgroundColor: p.page },
    grid: {
      position: "absolute",
      left: GRID_X,
      top: GRID_Y,
      width: GRID_W,
      height: GRID_H,
      flexDirection: "row",
      flexWrap: "wrap",
    },
    card: {
      width: CARD_W,
      height: CARD_H,
      padding: SAFE,
      flexDirection: "row",
    },
    cardLeft: { flex: 1, paddingRight: 8, justifyContent: "space-between" },
    cardPitch: { fontSize: 7.5, color: p.ink2, lineHeight: 1.4 },
    cardName: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: p.link },
    cardUrl: { fontSize: 7, color: p.ink3, marginTop: 2 },
    cardRight: { width: 72, alignItems: "center" },
    cardScan: { fontSize: 5.5, color: p.ink3, marginTop: 3, textAlign: "center" },
    tick: { position: "absolute", backgroundColor: p.mark },
    sheetNote: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 14,
      textAlign: "center",
      fontSize: 6.5,
      color: p.mark,
    },
  });

/** Marcas de corte en los bordes de la hoja, fuera de la rejilla. */
function CropMarks({ st }: { st: ReturnType<typeof cardStyles> }) {
  const xs = Array.from({ length: CARD_COLS + 1 }, (_, i) => GRID_X + i * CARD_W);
  const ys = Array.from({ length: CARD_ROWS + 1 }, (_, i) => GRID_Y + i * CARD_H);
  return (
    <>
      {xs.map((x) => (
        <View key={`v${x}`}>
          <View style={[st.tick, { left: x, top: GRID_Y - TICK_GAP - TICK_LEN, width: 0.5, height: TICK_LEN }]} />
          <View style={[st.tick, { left: x, top: GRID_Y + GRID_H + TICK_GAP, width: 0.5, height: TICK_LEN }]} />
        </View>
      ))}
      {ys.map((y) => (
        <View key={`h${y}`}>
          <View style={[st.tick, { top: y, left: GRID_X - TICK_GAP - TICK_LEN, width: TICK_LEN, height: 0.5 }]} />
          <View style={[st.tick, { top: y, left: GRID_X + GRID_W + TICK_GAP, width: TICK_LEN, height: 0.5 }]} />
        </View>
      ))}
    </>
  );
}

function BusinessCard({
  st,
  p,
  affiliateName,
  shortUrl,
  qrDataUrl,
}: {
  st: ReturnType<typeof cardStyles>;
  p: PrintPalette;
} & Pick<AffiliatePrintProps, "affiliateName" | "shortUrl" | "qrDataUrl">) {
  return (
    <View style={st.card}>
      <View style={st.cardLeft}>
        <View>
          <Lockup size={10.5} onDark={p.lockupOnDark} ink={p.ink} />
          <Text style={[st.cardPitch, { marginTop: 6 }]}>{CARD_PITCH}</Text>
        </View>
        <View>
          {affiliateName ? (
            <Text style={st.cardName}>{`Recomendado por ${affiliateName}`}</Text>
          ) : null}
          <Text style={st.cardUrl}>{shortUrl}</Text>
        </View>
      </View>
      <View style={st.cardRight}>
        <QrChip src={qrDataUrl} size={64} />
        <Text style={st.cardScan}>Escanea para conocerlo</Text>
      </View>
    </View>
  );
}

export function AffiliateBusinessCardsDocument(props: AffiliatePrintProps) {
  const p = PRINT_PALETTES[props.style];
  const st = cardStyles(p);
  const cards = Array.from({ length: CARD_COLS * CARD_ROWS }, (_, i) => i);
  return (
    <Document>
      <Page size="LETTER" style={st.page}>
        <CropMarks st={st} />
        <View style={st.grid}>
          {cards.map((i) => (
            <BusinessCard
              key={i}
              st={st}
              p={p}
              affiliateName={props.affiliateName}
              shortUrl={props.shortUrl}
              qrDataUrl={props.qrDataUrl}
            />
          ))}
        </View>
        <Text style={st.sheetNote}>
          Imprime al 100% (sin ajustar a la página) en papel de 250–300 g y recorta siguiendo las
          marcas de las orillas.
        </Text>
      </Page>
    </Document>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   2) VOLANTE — una plana tamaño carta, encabezada por el TEMA elegido
   ══════════════════════════════════════════════════════════════════════ */

const flyerStyles = (p: PrintPalette) =>
  StyleSheet.create({
    page: { fontFamily: "Helvetica", color: p.ink, backgroundColor: p.page, paddingBottom: 34 },
    band: {
      backgroundColor: p.band,
      paddingVertical: 26,
      paddingHorizontal: 48,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    bandTag: { fontSize: 10, color: p.bandSub },
    // Los cuerpos están medidos para que la plana quede LLENA: con la escala
    // anterior el contenido se acababa a tres cuartos de la hoja y el volante
    // parecía un folio a medio imprimir. El titular ahora lo pone el tema, que
    // es más corto que el fijo de antes, y la nota de plan solo aparece en dos
    // de los diez: por eso los márgenes bajaron un punto, para que el más
    // largo de los diez temas siga cabiendo en UNA página.
    body: { paddingHorizontal: 48, paddingTop: 30 },
    eyebrow: {
      fontSize: 9.5,
      fontFamily: "Helvetica-Bold",
      color: p.accent,
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    headline: { fontSize: 26, fontFamily: "Helvetica-Bold", lineHeight: 1.2, color: p.ink },
    intro: { fontSize: 11.5, color: p.ink2, lineHeight: 1.55, marginTop: 12 },
    noteWrap: { marginTop: 12 },
    sectionTitle: {
      fontSize: 9,
      fontFamily: "Helvetica-Bold",
      color: p.ink3,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginTop: 22,
      marginBottom: 10,
    },
    feature: { flexDirection: "row", marginBottom: 12 },
    bullet: {
      width: 17,
      height: 17,
      borderRadius: 4,
      backgroundColor: p.bulletBg,
      marginRight: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    bulletNum: { fontSize: 9, fontFamily: "Helvetica-Bold", color: p.bulletInk },
    featureTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", color: p.ink },
    featureDesc: { fontSize: 9.8, color: p.ink2, lineHeight: 1.5, marginTop: 3 },
    cta: {
      marginTop: 20,
      backgroundColor: p.tint,
      borderRadius: 8,
      borderLeftWidth: 3,
      borderLeftColor: p.accent,
      padding: 20,
      flexDirection: "row",
      alignItems: "center",
    },
    ctaText: { flex: 1, paddingRight: 18 },
    ctaTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", color: p.ink },
    ctaUrl: { fontSize: 12.5, fontFamily: "Helvetica-Bold", color: p.link, marginTop: 7 },
    ctaName: { fontSize: 10.5, color: p.ink2, marginTop: 9 },
    footer: {
      position: "absolute",
      bottom: 16,
      left: 48,
      right: 48,
      borderTopWidth: 0.5,
      borderTopColor: p.line,
      paddingTop: 7,
      fontSize: 8,
      color: p.ink3,
      textAlign: "center",
    },
  });

export function AffiliateFlyerDocument({
  affiliateName,
  shortUrl,
  qrDataUrl,
  style,
  variant,
}: AffiliatePrintProps) {
  const p = PRINT_PALETTES[style];
  const st = flyerStyles(p);
  return (
    <Document>
      <Page size="LETTER" style={st.page}>
        <View style={st.band}>
          <Lockup size={17} onDark={p.lockupOnBandDark} ink={p.bandInk} />
          <Text style={st.bandTag}>{TAGLINE}</Text>
        </View>

        <View style={st.body}>
          <Text style={st.eyebrow}>{variant.eyebrow}</Text>
          <Text style={st.headline}>{variant.headline}</Text>
          <Text style={st.intro}>{variant.printIntro}</Text>
          {/* La nota de plan va JUNTO al titular del tema, no en el pie: quien
              lee "administra tus sedes" tiene que leer en el mismo golpe de
              vista en qué plan viene. */}
          {variant.planNote ? (
            <View style={st.noteWrap}>
              <PlanNote p={p} note={variant.planNote} size={9.5} />
            </View>
          ) : null}

          <Text style={st.sectionTitle}>Lo que vas a tener</Text>
          {FEATURES.map((f, i) => (
            <View key={f.title} style={st.feature} wrap={false}>
              <View style={st.bullet}>
                <Text style={st.bulletNum}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.featureTitle}>{f.title}</Text>
                <Text style={st.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}

          <View style={st.cta} wrap={false}>
            <View style={st.ctaText}>
              <Text style={st.ctaTitle}>Escanea para conocerlo</Text>
              <Text style={st.ctaUrl}>{shortUrl}</Text>
              {affiliateName ? (
                <Text style={st.ctaName}>{`Recomendado por ${affiliateName}`}</Text>
              ) : null}
            </View>
            <QrChip src={qrDataUrl} size={132} />
          </View>
        </View>

        <Text style={st.footer} fixed>
          {FOOTER_LINE}
        </Text>
      </Page>
    </Document>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   3) DÍPTICO DE EXPO — carta horizontal doblada a la mitad, 2 caras
   ══════════════════════════════════════════════════════════════════════
   Cara 1 (exterior): contraportada a la izquierda, PORTADA a la derecha —
   así, al doblar, la portada queda al frente. Cara 2 (interior): lo que
   resuelve | lo que incluye. La marca de doblez va en el margen, arriba y
   abajo del centro. Nada de contenido cruza el doblez.

   La PORTADA es la que lleva el tema elegido (titular + entrada + nota de
   plan): es la cara que se ve de pie en el stand. */

const PANEL_W = 396; // 792 / 2

const dipStyles = (p: PrintPalette) =>
  StyleSheet.create({
    page: { fontFamily: "Helvetica", color: p.ink, backgroundColor: p.page, flexDirection: "row" },
    panel: { width: PANEL_W, height: "100%", padding: 30 },
    panelCover: {
      width: PANEL_W,
      height: "100%",
      padding: 30,
      backgroundColor: p.cover,
      justifyContent: "space-between",
    },
    foldTick: { position: "absolute", left: PANEL_W, width: 0.5, backgroundColor: p.mark },
    coverEyebrow: {
      fontSize: 9.5,
      fontFamily: "Helvetica-Bold",
      color: p.coverFoot,
      letterSpacing: 0.8,
      marginBottom: 8,
    },
    coverTitle: { fontSize: 30, fontFamily: "Helvetica-Bold", color: p.coverInk, lineHeight: 1.16 },
    coverSub: { fontSize: 12.5, color: p.coverSub, lineHeight: 1.5, marginTop: 14 },
    coverFoot: { fontSize: 9.5, color: p.coverFoot },
    eyebrow: {
      fontSize: 9.5,
      fontFamily: "Helvetica-Bold",
      color: p.accent,
      textTransform: "uppercase",
      letterSpacing: 0.8,
    },
    h2: { fontSize: 21, fontFamily: "Helvetica-Bold", color: p.ink, marginTop: 8, lineHeight: 1.2 },
    block: { marginTop: 20 },
    blockTitle: { fontSize: 12.5, fontFamily: "Helvetica-Bold", color: p.ink },
    blockDesc: { fontSize: 10.5, color: p.ink2, lineHeight: 1.5, marginTop: 4 },
    item: { flexDirection: "row", marginTop: 12, alignItems: "flex-start" },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: p.accent, marginTop: 5, marginRight: 9 },
    itemText: { flex: 1, fontSize: 10.5, color: p.ink, lineHeight: 1.45 },
    step: { flexDirection: "row", marginTop: 15, alignItems: "flex-start" },
    stepNum: {
      width: 17,
      height: 17,
      borderRadius: 4,
      backgroundColor: p.bulletBg,
      marginRight: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    stepNumText: { fontSize: 9, fontFamily: "Helvetica-Bold", color: p.bulletInk },
    stepText: { flex: 1, fontSize: 10.5, color: p.ink2, lineHeight: 1.45 },
    qrBox: {
      marginTop: 22,
      backgroundColor: p.tint,
      borderWidth: 0.7,
      borderColor: p.tintLine,
      borderRadius: 8,
      padding: 18,
      alignItems: "center",
    },
    qrUrl: { fontSize: 11, fontFamily: "Helvetica-Bold", color: p.link, marginTop: 9 },
    qrName: { fontSize: 10, color: p.ink2, marginTop: 5 },
    // Sin `marginTop: auto`: el pie se empuja con un separador `flexGrow`, que
    // es el único reparto que @react-pdf resuelve igual en las dos caras.
    panelFoot: { fontSize: 7.5, color: p.ink3, paddingTop: 12 },
    spacer: { flexGrow: 1 },
  });

/** Marca de doblez: dos rayitas cortas en el margen de seguridad. */
function FoldMarks({ st }: { st: ReturnType<typeof dipStyles> }) {
  return (
    <>
      <View style={[st.foldTick, { top: SAFE * 0.35, height: SAFE * 0.9 }]} />
      <View style={[st.foldTick, { bottom: SAFE * 0.35, height: SAFE * 0.9 }]} />
    </>
  );
}

export function AffiliateExpoBrochureDocument({
  affiliateName,
  shortUrl,
  qrDataUrl,
  style,
  variant,
}: AffiliatePrintProps) {
  const p = PRINT_PALETTES[style];
  const st = dipStyles(p);
  return (
    <Document>
      {/* ── Cara exterior ── */}
      <Page size="LETTER" orientation="landscape" style={st.page}>
        <FoldMarks st={st} />

        {/* Contraportada (queda atrás al doblar) */}
        <View style={st.panel}>
          <Text style={st.eyebrow}>Cómo empezar</Text>
          <Text style={st.h2}>Tres pasos y tu clínica está adentro</Text>

          <View style={st.step}>
            <View style={st.stepNum}>
              <Text style={st.stepNumText}>1</Text>
            </View>
            <Text style={st.stepText}>
              Escanea el código o entra a {shortUrl} desde tu celular.
            </Text>
          </View>
          <View style={st.step}>
            <View style={st.stepNum}>
              <Text style={st.stepNumText}>2</Text>
            </View>
            <Text style={st.stepText}>
              Crea la cuenta de tu clínica, elige tu especialidad y tu plan.
            </Text>
          </View>
          <View style={st.step}>
            <View style={st.stepNum}>
              <Text style={st.stepNumText}>3</Text>
            </View>
            <Text style={st.stepText}>
              Configura tus horarios, importa a tus pacientes y agenda la primera cita.
            </Text>
          </View>

          <View style={st.qrBox}>
            <QrChip src={qrDataUrl} size={132} />
            <Text style={st.qrUrl}>{shortUrl}</Text>
            {affiliateName ? (
              <Text style={st.qrName}>{`Recomendado por ${affiliateName}`}</Text>
            ) : null}
          </View>

          <View style={st.spacer} />
          <Text style={st.panelFoot}>{FOOTER_LINE}</Text>
        </View>

        {/* Portada — la cara del tema elegido */}
        <View style={st.panelCover}>
          <Lockup size={19} onDark ink={p.coverInk} />
          <View>
            <Text style={st.coverEyebrow}>{variant.eyebrow}</Text>
            <Text style={st.coverTitle}>{variant.headline}</Text>
            <Text style={st.coverSub}>{variant.printIntro}</Text>
            {variant.planNote ? (
              <View style={{ marginTop: 14 }}>
                <PlanNote p={p} note={variant.planNote} size={9.5} />
              </View>
            ) : null}
          </View>
          <Text style={st.coverFoot}>{TAGLINE}</Text>
        </View>
      </Page>

      {/* ── Cara interior ── */}
      <Page size="LETTER" orientation="landscape" style={st.page}>
        <FoldMarks st={st} />

        <View style={st.panel}>
          <Text style={st.eyebrow}>Lo que resuelve</Text>
          <Text style={st.h2}>Lo que hoy te quita tiempo</Text>
          {PROBLEMS.map((pr) => (
            <View key={pr.title} style={st.block}>
              <Text style={st.blockTitle}>{pr.title}</Text>
              <Text style={st.blockDesc}>{pr.desc}</Text>
            </View>
          ))}
          <View style={st.spacer} />
          <Text style={st.panelFoot}>
            Hecho en México: en español, en pesos y con facturación CFDI 4.0.
          </Text>
        </View>

        <View style={st.panel}>
          <Text style={st.eyebrow}>Lo que incluye</Text>
          <Text style={st.h2}>Todo en la misma pantalla</Text>
          {INCLUDES.map((i) => (
            <View key={i} style={st.item}>
              <View style={st.dot} />
              <Text style={st.itemText}>{i}</Text>
            </View>
          ))}
          <View style={st.qrBox}>
            <QrChip src={qrDataUrl} size={110} />
            <Text style={st.qrUrl}>{shortUrl}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
