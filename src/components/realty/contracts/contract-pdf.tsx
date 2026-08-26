// ═══════════════════════════════════════════════════════════════════════
// EL PDF DEL CONTRATO — el documento y su evidencia, en el mismo papel.
//
// ⚠️ ESTE ARCHIVO ES DE SERVIDOR. Importa @react-pdf/renderer y solo lo usa
// la ruta del PDF. Ningún componente "use client" puede importarlo: hacerlo
// arrastra el renderizador entero al navegador. Los tipos vienen de
// shared.ts, que sí es puro.
//
// ── POR QUÉ EL PDF NO ES LA PRUEBA ─────────────────────────────────────
// El PDF NO es determinista (@react-pdf incrusta fecha de creación y
// subconjuntos de fuentes), así que dos renders del MISMO contrato dan
// bytes distintos. Por eso lo que se hashea y se guarda es el TEXTO
// canónico, y el PDF solo lo imprime junto con su huella. Quien quiera
// comprobar el documento compara el sha256 impreso aquí contra el que
// devuelve el módulo — no los bytes del archivo.
//
// ── LO QUE ESTE PAPEL NUNCA HACE ───────────────────────────────────────
// Parecer firmado sin estarlo. Un contrato sin todas las firmas sale con
// una banda arriba que lo dice, y uno anulado sale con la suya y el motivo.
// Un PDF que se ve igual firmado y sin firmar es un documento que alguien
// va a enseñar como si valiera.
//
// ⚠️ El TEXTO de las cláusulas lo escribió un programa. Antes de que un
// cliente firme con estas plantillas, las tiene que revisar un abogado.
// ═══════════════════════════════════════════════════════════════════════

import {
  Document,
  Image as PdfImage,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import type { RealtyContractKind, RealtyContractStatus } from "./shared";

export interface ContractPdfSignature {
  role: string;
  name: string;
  /** data URL del trazo. null = línea en blanco para firmar a mano. */
  dataUrl: string | null;
  /** ISO. null = todavía no firma. */
  signedAt: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Hash del documento EN EL MOMENTO de esa firma. */
  documentHash: string | null;
  /** false = el documento cambió después de esta firma. */
  matchesCurrent: boolean;
}

export interface ContractPdfProps {
  accountName: string;
  accountLegalName: string | null;
  accountAddress: string | null;
  accountPhone: string | null;
  accountEmail: string | null;

  kind: RealtyContractKind;
  status: RealtyContractStatus;
  folio: string;
  title: string;
  body: string;
  documentHash: string;

  /** Zona horaria de la cuenta. Obligatoria: el servidor corre en UTC. */
  timeZone: string;
  /** ISO de cuándo se generó el contrato. */
  createdAt: string;
  /** ISO. null = todavía no lo firman todos. */
  signedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;

  signatures: ContractPdfSignature[];
  /** Cuántas firmas se esperan y cuántas hay. */
  signed: number;
  required: number;
}

const VERDE = "#14532d";
const TINTA = "#17181a";
const GRIS = "#63666b";
const LINEA = "#e3e5e8";

const styles = StyleSheet.create({
  page: {
    padding: 42,
    paddingBottom: 72,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: TINTA,
    lineHeight: 1.5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: VERDE,
    paddingBottom: 10,
    marginBottom: 14,
  },
  headerLeft: { maxWidth: 320 },
  brand: { fontSize: 15, color: VERDE, fontFamily: "Helvetica-Bold" },
  brandSub: { fontSize: 8.5, color: GRIS, marginTop: 1 },
  docTitle: {
    fontSize: 11,
    color: VERDE,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
    maxWidth: 175,
  },
  metaLabel: { fontSize: 7.5, color: GRIS, textAlign: "right", marginTop: 4 },
  metaValue: { fontSize: 10, color: TINTA, fontFamily: "Helvetica-Bold", textAlign: "right" },

  banner: { borderWidth: 1, borderRadius: 6, padding: 8, marginBottom: 12 },
  bannerWarn: { borderColor: "#b45309", backgroundColor: "#fffbeb" },
  bannerDanger: { borderColor: "#b91c1c", backgroundColor: "#fef2f2" },
  bannerTitleWarn: { fontSize: 9.5, color: "#92400e", fontFamily: "Helvetica-Bold" },
  bannerTitleDanger: { fontSize: 9.5, color: "#991b1b", fontFamily: "Helvetica-Bold" },
  bannerText: { fontSize: 8.5, color: GRIS, marginTop: 2 },

  bodyLine: { fontSize: 9.5, color: TINTA, lineHeight: 1.5 },
  bodyGap: { height: 6 },

  sectionTitle: {
    fontSize: 9.5,
    color: VERDE,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 6,
  },

  sigRow: { flexDirection: "row", gap: 20, marginTop: 10 },
  sigBox: { flex: 1 },
  sigImg: { width: 150, height: 46, objectFit: "contain", marginBottom: 2 },
  sigImgEmpty: { height: 46 },
  sigLine: { borderTopWidth: 0.7, borderTopColor: TINTA, paddingTop: 4 },
  sigRole: {
    fontSize: 7.5,
    color: GRIS,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: "Helvetica-Bold",
  },
  sigName: { fontSize: 9.5, color: TINTA, fontFamily: "Helvetica-Bold", marginTop: 1 },
  sigMeta: { fontSize: 7.5, color: GRIS, marginTop: 1 },
  sigAlert: { fontSize: 7.5, color: "#991b1b", fontFamily: "Helvetica-Bold", marginTop: 1 },

  evidence: { marginTop: 18, borderTopWidth: 0.5, borderTopColor: LINEA, paddingTop: 8 },
  evidenceLine: { fontSize: 7.5, color: GRIS },
  evidenceMono: { fontSize: 7, color: GRIS, marginTop: 2 },

  footer: {
    position: "absolute",
    bottom: 30,
    left: 42,
    right: 42,
    fontSize: 7.5,
    color: "#9aa0a6",
    textAlign: "center",
    borderTopWidth: 0.5,
    borderTopColor: LINEA,
    paddingTop: 6,
  },
  pageNum: { fontSize: 7, color: "#9aa0a6", textAlign: "center", marginTop: 2 },
});

const KIND_LABEL: Record<RealtyContractKind, string> = {
  ARRENDAMIENTO: "CONTRATO DE ARRENDAMIENTO",
  EXCLUSIVA: "CONTRATO DE EXCLUSIVA",
  PROMESA: "PROMESA DE COMPRAVENTA",
  COMISION: "CONVENIO DE COMISIÓN",
};

/**
 * Fecha y hora en la zona de la inmobiliaria.
 *
 * Va con `timeZone` explícito y no con la local: este componente se
 * renderiza en el servidor, donde la zona es UTC, y una evidencia fechada
 * seis horas adelante contradice la pantalla que la persona acaba de ver.
 */
function fechaHora(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(d);
  } catch {
    return d.toISOString().replace("T", " ").slice(0, 16);
  }
}

function enParejas(list: ContractPdfSignature[]): ContractPdfSignature[][] {
  const rows: ContractPdfSignature[][] = [];
  for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
  return rows;
}

function Firma({ s, timeZone }: { s: ContractPdfSignature; timeZone: string }) {
  return (
    <View style={styles.sigBox}>
      {s.dataUrl ? (
        <PdfImage style={styles.sigImg} src={s.dataUrl} />
      ) : (
        <View style={styles.sigImgEmpty} />
      )}
      <View style={styles.sigLine}>
        <Text style={styles.sigRole}>{s.role}</Text>
        <Text style={styles.sigName}>{s.name || "—"}</Text>
        {s.signedAt ? (
          <Text style={styles.sigMeta}>Firmado el {fechaHora(s.signedAt, timeZone)}</Text>
        ) : (
          <Text style={styles.sigMeta}>Pendiente de firma</Text>
        )}
        {s.ip ? <Text style={styles.sigMeta}>IP {s.ip}</Text> : null}
        {s.userAgent ? (
          <Text style={styles.sigMeta}>{s.userAgent.slice(0, 90)}</Text>
        ) : null}
        {s.signedAt && !s.matchesCurrent ? (
          <Text style={styles.sigAlert}>
            AVISO: el texto del documento no coincide con el que se firmó.
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function ContractDocument(props: ContractPdfProps) {
  const encabezado = [props.accountAddress, props.accountPhone, props.accountEmail]
    .filter(Boolean)
    .join(" · ");
  // Línea a línea y no un solo <Text>: así el salto de página cae entre
  // renglones y nunca parte una cláusula por la mitad.
  const lineas = (props.body ?? "").split("\n");
  const completo = props.required > 0 && props.signed >= props.required;

  return (
    <Document>
      <Page size="LETTER" style={styles.page} wrap>
        <View style={styles.header} fixed>
          <View style={styles.headerLeft}>
            <Text style={styles.brand}>{props.accountLegalName || props.accountName}</Text>
            {props.accountLegalName && props.accountLegalName !== props.accountName ? (
              <Text style={styles.brandSub}>{props.accountName}</Text>
            ) : null}
            {encabezado ? <Text style={styles.brandSub}>{encabezado}</Text> : null}
          </View>
          <View>
            <Text style={styles.docTitle}>{KIND_LABEL[props.kind]}</Text>
            <Text style={styles.metaLabel}>Folio</Text>
            <Text style={styles.metaValue}>{props.folio}</Text>
          </View>
        </View>

        {props.voidedAt ? (
          <View style={[styles.banner, styles.bannerDanger]}>
            <Text style={styles.bannerTitleDanger}>
              CONTRATO ANULADO EL {fechaHora(props.voidedAt, props.timeZone)}
            </Text>
            <Text style={styles.bannerText}>
              Motivo: {props.voidReason || "No se registró motivo."} Este documento se conserva
              íntegro como parte del expediente y no surte efectos.
            </Text>
          </View>
        ) : !completo ? (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Text style={styles.bannerTitleWarn}>
              DOCUMENTO PENDIENTE DE FIRMA — {props.signed} de {props.required} firmas
            </Text>
            <Text style={styles.bannerText}>
              Esta copia todavía no está firmada por todas las partes. No surte efectos como
              contrato firmado hasta que aparezcan todas las firmas al pie.
            </Text>
          </View>
        ) : null}

        {lineas.map((linea, i) =>
          linea.trim() === "" ? (
            <View key={i} style={styles.bodyGap} />
          ) : (
            <Text key={i} style={styles.bodyLine}>
              {linea}
            </Text>
          ),
        )}

        <Text style={styles.sectionTitle}>Firmas</Text>
        {enParejas(props.signatures).map((row, i) => (
          <View key={i} style={styles.sigRow} wrap={false}>
            {row.map((s, j) => (
              <Firma key={j} s={s} timeZone={props.timeZone} />
            ))}
            {row.length === 1 ? <View style={styles.sigBox} /> : null}
          </View>
        ))}

        <View style={styles.evidence} wrap={false}>
          <Text style={styles.evidenceLine}>
            Documento firmado electrónicamente. La firma electrónica tiene la misma validez que la
            autógrafa conforme a los artículos 89 y 89 bis del Código de Comercio y 210-A del Código
            Federal de Procedimientos Civiles, siempre que sea atribuible al firmante y permita
            detectar cualquier alteración posterior del documento.
          </Text>
          <Text style={styles.evidenceMono}>
            Huella del documento (SHA-256): {props.documentHash}
          </Text>
          <Text style={styles.evidenceMono}>
            Generado el {fechaHora(props.createdAt, props.timeZone)}
            {props.signedAt ? ` · Firmado por todas las partes el ${fechaHora(props.signedAt, props.timeZone)}` : ""}
          </Text>
          <Text style={styles.evidenceMono}>
            La huella se calcula sobre el TEXTO del documento, no sobre este archivo: dos
            impresiones del mismo contrato pueden diferir en bytes y seguir siendo el mismo
            documento. Si una sola letra del texto cambiara, la huella dejaría de coincidir.
          </Text>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {props.title} · Folio {props.folio} · {props.accountName}
          </Text>
          <Text
            fixed
            style={styles.pageNum}
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
}
