import { Document, Page, Text, View, Image, Svg, Path, StyleSheet } from "@react-pdf/renderer";

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
 *
 * El contenido describe lo que el sistema hace HOY. Sin precios (cambian y el
 * papel no), sin "prueba gratis" (el registro cobra desde el primer mes), sin
 * certificaciones que no existen y sin garantías de resultado.
 */

export interface AffiliatePrintProps {
  /** "Martín R." — null si la cuenta no tiene nombre: la línea se omite. */
  affiliateName: string | null;
  /** Texto visible del link corto: "dalecontrol.com/r/AB12CD34". */
  shortUrl: string;
  /** PNG del QR en data URL, ya generado en el servidor. */
  qrDataUrl: string;
}

/* ── Medidas y paleta ─────────────────────────────────────────────────── */

const MM = 2.834645669;
/** Margen de seguridad de 5 mm — nada legible entra aquí. */
const SAFE = 5 * MM;

const VIOLET = "#7c3aed";
const VIOLET_DEEP = "#5b21b6";
const VIOLET_TINT = "#efeafe";
const INK = "#14101f";
const INK_2 = "#4a4857";
const INK_3 = "#6b6b78";
const TINT = "#f4f2f8";
const LINE = "#d9d6e4";
const MARK_GREY = "#8e8c9b";

/* ── Marca ────────────────────────────────────────────────────────────── */

/** Isotipo de capas apiladas (public/brand/icon-color.svg) en trazo plano. */
function Mark({ size, onViolet = false }: { size: number; onViolet?: boolean }) {
  const stroke = onViolet ? "#ffffff" : VIOLET;
  const fill = onViolet ? "none" : VIOLET_TINT;
  // Tercera capa en color más claro en vez de con opacidad: las tintas planas
  // se imprimen predecibles, las transparencias no siempre.
  const faint = onViolet ? "#ddd6fe" : "#c4b5fd";
  return (
    <Svg width={size} height={size} viewBox="0 0 36 36">
      <Path d="M18 4 L31 11 L18 18 L5 11 Z" fill={fill} stroke={stroke} strokeWidth={2.4} strokeLinejoin="round" />
      <Path d="M5.5 18.5 L18 25.2 L30.5 18.5" fill="none" stroke={stroke} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.5 24.5 L18 31.2 L30.5 24.5" fill="none" stroke={faint} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function Wordmark({ size, onViolet = false }: { size: number; onViolet?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline" }}>
      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: size, color: onViolet ? "#ffffff" : VIOLET }}>
        Dale
      </Text>
      <Text style={{ fontFamily: "Helvetica-Bold", fontSize: size, color: onViolet ? "#ffffff" : INK }}>
        Control
      </Text>
    </View>
  );
}

function Lockup({ size, onViolet = false }: { size: number; onViolet?: boolean }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Mark size={size * 1.45} onViolet={onViolet} />
      <View style={{ width: size * 0.4 }} />
      <Wordmark size={size} onViolet={onViolet} />
    </View>
  );
}

/* ── Contenido de venta (compartido por volante y díptico) ────────────── */

const FEATURES: { title: string; desc: string }[] = [
  {
    title: "Agenda con recordatorios por WhatsApp",
    desc: "La confirmación y el recordatorio de la cita salen en automático, para que al paciente no se le olvide.",
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
    title: "Portal del paciente",
    desc: "Tus pacientes consultan sus citas, su historial y sus pagos con un enlace seguro, sin llamar a recepción.",
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
  "Expediente clínico con las notas de cada consulta",
  "Odontograma digital e historial de tratamientos",
  "Facturación CFDI 4.0 y control de cobros",
  "Portal del paciente con acceso por enlace seguro",
  "Reportes de ocupación, ingresos y pacientes",
];

const TAGLINE = "Software mexicano para clínicas y consultorios";
const FOOTER_LINE = "DaleControl · En español, en pesos y con soporte en español";

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

const cardStyles = StyleSheet.create({
  page: { fontFamily: "Helvetica", color: INK, backgroundColor: "#ffffff" },
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
  cardPitch: { fontSize: 7.5, color: INK_2, lineHeight: 1.4 },
  cardName: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: VIOLET_DEEP },
  cardUrl: { fontSize: 7, color: INK_3, marginTop: 2 },
  cardRight: { width: 68, alignItems: "center" },
  cardScan: { fontSize: 5.5, color: INK_3, marginTop: 3, textAlign: "center" },
  tick: { position: "absolute", backgroundColor: MARK_GREY },
  sheetNote: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 14,
    textAlign: "center",
    fontSize: 6.5,
    color: MARK_GREY,
  },
});

/** Marcas de corte en los bordes de la hoja, fuera de la rejilla. */
function CropMarks() {
  const xs = Array.from({ length: CARD_COLS + 1 }, (_, i) => GRID_X + i * CARD_W);
  const ys = Array.from({ length: CARD_ROWS + 1 }, (_, i) => GRID_Y + i * CARD_H);
  return (
    <>
      {xs.map((x) => (
        <View key={`v${x}`}>
          <View style={[cardStyles.tick, { left: x, top: GRID_Y - TICK_GAP - TICK_LEN, width: 0.5, height: TICK_LEN }]} />
          <View style={[cardStyles.tick, { left: x, top: GRID_Y + GRID_H + TICK_GAP, width: 0.5, height: TICK_LEN }]} />
        </View>
      ))}
      {ys.map((y) => (
        <View key={`h${y}`}>
          <View style={[cardStyles.tick, { top: y, left: GRID_X - TICK_GAP - TICK_LEN, width: TICK_LEN, height: 0.5 }]} />
          <View style={[cardStyles.tick, { top: y, left: GRID_X + GRID_W + TICK_GAP, width: TICK_LEN, height: 0.5 }]} />
        </View>
      ))}
    </>
  );
}

function BusinessCard({ affiliateName, shortUrl, qrDataUrl }: AffiliatePrintProps) {
  return (
    <View style={cardStyles.card}>
      <View style={cardStyles.cardLeft}>
        <View>
          <Lockup size={10.5} />
          <Text style={[cardStyles.cardPitch, { marginTop: 6 }]}>
            Agenda, expediente clínico y facturación CFDI para tu clínica, en un solo sistema.
          </Text>
        </View>
        <View>
          {affiliateName ? (
            <Text style={cardStyles.cardName}>{`Recomendado por ${affiliateName}`}</Text>
          ) : null}
          <Text style={cardStyles.cardUrl}>{shortUrl}</Text>
        </View>
      </View>
      <View style={cardStyles.cardRight}>
        <Image src={qrDataUrl} style={{ width: 68, height: 68 }} />
        <Text style={cardStyles.cardScan}>Escanea para conocerlo</Text>
      </View>
    </View>
  );
}

export function AffiliateBusinessCardsDocument(props: AffiliatePrintProps) {
  const cards = Array.from({ length: CARD_COLS * CARD_ROWS }, (_, i) => i);
  return (
    <Document>
      <Page size="LETTER" style={cardStyles.page}>
        <CropMarks />
        <View style={cardStyles.grid}>
          {cards.map((i) => (
            <BusinessCard key={i} {...props} />
          ))}
        </View>
        <Text style={cardStyles.sheetNote}>
          Imprime al 100% (sin ajustar a la página) en papel de 250–300 g y recorta siguiendo las
          marcas de las orillas.
        </Text>
      </Page>
    </Document>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   2) VOLANTE — una plana tamaño carta
   ══════════════════════════════════════════════════════════════════════ */

const flyerStyles = StyleSheet.create({
  page: { fontFamily: "Helvetica", color: INK, backgroundColor: "#ffffff", paddingBottom: 34 },
  band: {
    backgroundColor: VIOLET,
    paddingVertical: 26,
    paddingHorizontal: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bandTag: { fontSize: 10, color: "#ede9fe" },
  // Los cuerpos están medidos para que la plana quede LLENA: con la escala
  // anterior el contenido se acababa a tres cuartos de la hoja y el volante
  // parecía un folio a medio imprimir. Si se toca un tamaño, hay que volver a
  // mirar el PDF: pasarse tira la pieza a una segunda página.
  body: { paddingHorizontal: 48, paddingTop: 32 },
  headline: { fontSize: 26, fontFamily: "Helvetica-Bold", lineHeight: 1.2, color: INK },
  intro: { fontSize: 11.5, color: INK_2, lineHeight: 1.55, marginTop: 12 },
  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: INK_3,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginTop: 26,
    marginBottom: 10,
  },
  feature: { flexDirection: "row", marginBottom: 14 },
  bullet: {
    width: 17,
    height: 17,
    borderRadius: 4,
    backgroundColor: VIOLET,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  bulletNum: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  featureTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", color: INK },
  featureDesc: { fontSize: 9.8, color: INK_2, lineHeight: 1.5, marginTop: 3 },
  cta: {
    marginTop: 22,
    backgroundColor: TINT,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: VIOLET,
    padding: 22,
    flexDirection: "row",
    alignItems: "center",
  },
  ctaText: { flex: 1, paddingRight: 18 },
  ctaTitle: { fontSize: 16, fontFamily: "Helvetica-Bold", color: INK },
  ctaUrl: { fontSize: 12.5, fontFamily: "Helvetica-Bold", color: VIOLET_DEEP, marginTop: 7 },
  ctaName: { fontSize: 10.5, color: INK_2, marginTop: 9 },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 48,
    right: 48,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 7,
    fontSize: 8,
    color: INK_3,
    textAlign: "center",
  },
});

export function AffiliateFlyerDocument({ affiliateName, shortUrl, qrDataUrl }: AffiliatePrintProps) {
  return (
    <Document>
      <Page size="LETTER" style={flyerStyles.page}>
        <View style={flyerStyles.band}>
          <Lockup size={17} onViolet />
          <Text style={flyerStyles.bandTag}>{TAGLINE}</Text>
        </View>

        <View style={flyerStyles.body}>
          <Text style={flyerStyles.headline}>
            La operación diaria de tu clínica, en un solo sistema
          </Text>
          <Text style={flyerStyles.intro}>
            La agenda en una libreta, el expediente en carpetas y la facturación en otro portal: tres
            lugares distintos para atender al mismo paciente. DaleControl los junta en una sola
            pantalla, hecha en México, en español y en pesos.
          </Text>

          <Text style={flyerStyles.sectionTitle}>Lo que vas a tener</Text>
          {FEATURES.map((f, i) => (
            <View key={f.title} style={flyerStyles.feature} wrap={false}>
              <View style={flyerStyles.bullet}>
                <Text style={flyerStyles.bulletNum}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={flyerStyles.featureTitle}>{f.title}</Text>
                <Text style={flyerStyles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}

          <View style={flyerStyles.cta} wrap={false}>
            <View style={flyerStyles.ctaText}>
              <Text style={flyerStyles.ctaTitle}>Escanea para conocerlo</Text>
              <Text style={flyerStyles.ctaUrl}>{shortUrl}</Text>
              {affiliateName ? (
                <Text style={flyerStyles.ctaName}>{`Recomendado por ${affiliateName}`}</Text>
              ) : null}
            </View>
            <Image src={qrDataUrl} style={{ width: 150, height: 150 }} />
          </View>
        </View>

        <Text style={flyerStyles.footer} fixed>
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
   abajo del centro. Nada de contenido cruza el doblez. */

const PANEL_W = 396; // 792 / 2
const dipStyles = StyleSheet.create({
  page: { fontFamily: "Helvetica", color: INK, backgroundColor: "#ffffff", flexDirection: "row" },
  panel: { width: PANEL_W, height: "100%", padding: 30 },
  panelCover: { width: PANEL_W, height: "100%", padding: 30, backgroundColor: VIOLET, justifyContent: "space-between" },
  foldTick: { position: "absolute", left: PANEL_W, width: 0.5, backgroundColor: MARK_GREY },
  coverTitle: { fontSize: 34, fontFamily: "Helvetica-Bold", color: "#ffffff", lineHeight: 1.16 },
  coverSub: { fontSize: 13, color: "#ede9fe", lineHeight: 1.5, marginTop: 14 },
  coverFoot: { fontSize: 9.5, color: "#ddd6fe" },
  eyebrow: {
    fontSize: 9.5,
    fontFamily: "Helvetica-Bold",
    color: VIOLET,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  h2: { fontSize: 21, fontFamily: "Helvetica-Bold", color: INK, marginTop: 8, lineHeight: 1.2 },
  block: { marginTop: 22 },
  blockTitle: { fontSize: 12.5, fontFamily: "Helvetica-Bold", color: INK },
  blockDesc: { fontSize: 10.5, color: INK_2, lineHeight: 1.5, marginTop: 4 },
  item: { flexDirection: "row", marginTop: 14, alignItems: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: VIOLET, marginTop: 5, marginRight: 9 },
  itemText: { flex: 1, fontSize: 11, color: INK, lineHeight: 1.45 },
  step: { flexDirection: "row", marginTop: 15, alignItems: "flex-start" },
  stepNum: {
    width: 17,
    height: 17,
    borderRadius: 4,
    backgroundColor: VIOLET,
    marginRight: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumText: { fontSize: 9, fontFamily: "Helvetica-Bold", color: "#ffffff" },
  stepText: { flex: 1, fontSize: 10.5, color: INK_2, lineHeight: 1.45 },
  qrBox: {
    marginTop: 26,
    backgroundColor: TINT,
    borderRadius: 8,
    padding: 20,
    alignItems: "center",
  },
  qrUrl: { fontSize: 11, fontFamily: "Helvetica-Bold", color: VIOLET_DEEP, marginTop: 9 },
  qrName: { fontSize: 10, color: INK_2, marginTop: 5 },
  // Sin `marginTop: auto`: el pie se empuja con un separador `flexGrow`, que
  // es el único reparto que @react-pdf resuelve igual en las dos caras.
  panelFoot: { fontSize: 7.5, color: INK_3, paddingTop: 12 },
  spacer: { flexGrow: 1 },
});

/** Marca de doblez: dos rayitas cortas en el margen de seguridad. */
function FoldMarks() {
  return (
    <>
      <View style={[dipStyles.foldTick, { top: SAFE * 0.35, height: SAFE * 0.9 }]} />
      <View style={[dipStyles.foldTick, { bottom: SAFE * 0.35, height: SAFE * 0.9 }]} />
    </>
  );
}

export function AffiliateExpoBrochureDocument({
  affiliateName,
  shortUrl,
  qrDataUrl,
}: AffiliatePrintProps) {
  return (
    <Document>
      {/* ── Cara exterior ── */}
      <Page size="LETTER" orientation="landscape" style={dipStyles.page}>
        <FoldMarks />

        {/* Contraportada (queda atrás al doblar) */}
        <View style={dipStyles.panel}>
          <Text style={dipStyles.eyebrow}>Cómo empezar</Text>
          <Text style={dipStyles.h2}>Tres pasos y tu clínica está adentro</Text>

          <View style={dipStyles.step}>
            <View style={dipStyles.stepNum}>
              <Text style={dipStyles.stepNumText}>1</Text>
            </View>
            <Text style={dipStyles.stepText}>
              Escanea el código o entra a {shortUrl} desde tu celular.
            </Text>
          </View>
          <View style={dipStyles.step}>
            <View style={dipStyles.stepNum}>
              <Text style={dipStyles.stepNumText}>2</Text>
            </View>
            <Text style={dipStyles.stepText}>
              Crea la cuenta de tu clínica, elige tu especialidad y tu plan.
            </Text>
          </View>
          <View style={dipStyles.step}>
            <View style={dipStyles.stepNum}>
              <Text style={dipStyles.stepNumText}>3</Text>
            </View>
            <Text style={dipStyles.stepText}>
              Configura tus horarios, importa a tus pacientes y agenda la primera cita.
            </Text>
          </View>

          <View style={dipStyles.qrBox}>
            <Image src={qrDataUrl} style={{ width: 140, height: 140 }} />
            <Text style={dipStyles.qrUrl}>{shortUrl}</Text>
            {affiliateName ? (
              <Text style={dipStyles.qrName}>{`Recomendado por ${affiliateName}`}</Text>
            ) : null}
          </View>

          <View style={dipStyles.spacer} />
          <Text style={dipStyles.panelFoot}>{FOOTER_LINE}</Text>
        </View>

        {/* Portada */}
        <View style={dipStyles.panelCover}>
          <Lockup size={19} onViolet />
          <View>
            <Text style={dipStyles.coverTitle}>Tu clínica, ordenada</Text>
            <Text style={dipStyles.coverSub}>
              Agenda, expediente clínico y facturación CFDI 4.0 en un solo sistema.
            </Text>
          </View>
          <Text style={dipStyles.coverFoot}>{TAGLINE}</Text>
        </View>
      </Page>

      {/* ── Cara interior ── */}
      <Page size="LETTER" orientation="landscape" style={dipStyles.page}>
        <FoldMarks />

        <View style={dipStyles.panel}>
          <Text style={dipStyles.eyebrow}>Lo que resuelve</Text>
          <Text style={dipStyles.h2}>Lo que hoy te quita tiempo</Text>
          {PROBLEMS.map((p) => (
            <View key={p.title} style={dipStyles.block}>
              <Text style={dipStyles.blockTitle}>{p.title}</Text>
              <Text style={dipStyles.blockDesc}>{p.desc}</Text>
            </View>
          ))}
          <View style={dipStyles.spacer} />
          <Text style={dipStyles.panelFoot}>
            Hecho en México: en español, en pesos y con facturación CFDI 4.0.
          </Text>
        </View>

        <View style={dipStyles.panel}>
          <Text style={dipStyles.eyebrow}>Lo que incluye</Text>
          <Text style={dipStyles.h2}>Todo en la misma pantalla</Text>
          {INCLUDES.map((i) => (
            <View key={i} style={dipStyles.item}>
              <View style={dipStyles.dot} />
              <Text style={dipStyles.itemText}>{i}</Text>
            </View>
          ))}
          <View style={dipStyles.qrBox}>
            <Image src={qrDataUrl} style={{ width: 120, height: 120 }} />
            <Text style={dipStyles.qrUrl}>{shortUrl}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
