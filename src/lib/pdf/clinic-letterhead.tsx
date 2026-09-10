import type { ReactNode } from "react";
import { Text, View, StyleSheet, Image as PdfImage } from "@react-pdf/renderer";

/**
 * ClinicLetterhead — la cabecera común de los PDF que se entregan a alguien.
 *
 * Logo ARRIBA A LA IZQUIERDA y, al lado, el nombre de la clínica y sus datos
 * (dirección, teléfono, correo, y el RFC donde corresponde). A la derecha, lo
 * propio de cada documento (folio, fecha, sello…) vía `right`.
 *
 * Sale de lo que ya hacían bien `consent-document`, `prescription-document` y
 * `quote-document`: misma composición (logo + nombre + dos renglones grises),
 * mismo tamaño de letra, mismo borde de acento abajo. Aquí solo se extrae a un
 * sitio y se le cierran los cuatro agujeros que tenían sueltos:
 *
 *   1. SIN LOGO no queda un hueco: el nombre de la clínica pasa a mandar en ese
 *      sitio, en grande (decisión de Rafael). Nunca un recuadro vacío ni un
 *      icono roto.
 *   2. PROPORCIONES: el logo se encaja en una caja calculada a partir de su
 *      proporción real (`clinicLogoAspect`), así que un logo apaisado sale
 *      apaisado y uno vertical sale vertical, sin deformarse ni desbordar.
 *      Si la proporción no llega, se asume cuadrado — que es exactamente el
 *      comportamiento de hoy — y `objectFit: contain` impide la deformación.
 *   3. NOMBRES LARGOS: la letra del nombre baja de tamaño por tramos y el
 *      bloque tiene tope de ancho, así que parte en dos renglones en vez de
 *      montarse encima del folio.
 *   4. FORMATOS QUE @react-pdf NO SABE PINTAR (webp, gif, svg) se descartan al
 *      descargar, no al pintar. Medido en este repo: `<Image>` con un webp no
 *      lanza — escribe "Base64 image invalid format" y deja el hueco en blanco,
 *      que es justo lo que no queremos. Ver `fetchClinicLogo`.
 *
 * La cabecera NO se repite en las páginas siguientes (no lleva `fixed`): el
 * logo es un mapa de bits y repetirlo engorda el PDF y se come ~90 pt de cada
 * página. La identidad en una hoja suelta la sostiene el pie, que sí es `fixed`
 * y lleva el nombre de la clínica y "Página N de M" — el mismo criterio que ya
 * seguía `consent-document`, el único de la familia que hoy pagina de verdad.
 */

/** Columnas de `Clinic` que alimentan la cabecera. Para el `select` de Prisma. */
export const CLINIC_LETTERHEAD_SELECT = {
  name: true,
  address: true,
  city: true,
  state: true,
  phone: true,
  email: true,
  logoUrl: true,
} as const;

/**
 * La fila de `Clinic` tal como la devuelve `CLINIC_LETTERHEAD_SELECT`.
 *
 * Los campos son obligatorios (aunque su valor pueda ser null) A PROPÓSITO: así
 * un `select` que se quede corto —por ejemplo volver a `{ name: true }`— no
 * compila, en vez de compilar y dejar el membrete mudo sin que nadie se entere.
 */
export interface ClinicLetterheadFields {
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  logoUrl: string | null;
}

/**
 * Props de clínica que consume la cabecera. Se declaran planas y con estos
 * nombres a propósito: los documentos las reciben tal cual entre las suyas y
 * pueden hacer `<ClinicLetterhead {...props} … />` sin mapear nada.
 */
export interface ClinicLetterheadClinic {
  clinicName: string;
  clinicAddress?: string | null;
  clinicCity?: string | null;
  clinicState?: string | null;
  clinicPhone?: string | null;
  clinicEmail?: string | null;
  /** RFC del emisor. Solo se pinta si llega: no todos los documentos son fiscales. */
  clinicTaxId?: string | null;
  /** Logo ya descargado como data URL. null = sin logo → manda el nombre. */
  clinicLogoDataUrl?: string | null;
  /** Ancho/alto reales del logo. Sin esto se asume cuadrado. */
  clinicLogoAspect?: number | null;
}

export interface ClinicLetterheadProps extends ClinicLetterheadClinic {
  /** Color de acento del documento (borde inferior y nombre de la clínica). */
  accent: string;
  /** Renglón bajo el nombre: "Orden de laboratorio", "Hoja de referencia"… */
  subtitle?: string | null;
  /** Bloque derecho del documento: folio, fecha, sello de estado… */
  right?: ReactNode;
}

// ── Medidas ────────────────────────────────────────────────────────────
//
// Carta son 612 pt; con los 40 de margen a cada lado quedan 532 de ancho útil.
// Se reparten 340 (izquierda) + 14 (separación) + 178 (derecha) = 532 justos.
// De los 340 de la izquierda, el logo se lleva 132 como mucho y 10 de hueco,
// así que al nombre y a los datos les quedan ~198.

/** Alto máximo del logo. Lo marca la altura del nombre + dos renglones grises. */
export const LOGO_MAX_H = 44;
/** Ancho máximo del logo, para que un logo muy apaisado no aplaste el nombre. */
export const LOGO_MAX_W = 132;
/** Tope del bloque izquierdo (logo + nombre + datos) y del derecho (folio…). */
const LEFT_MAX_W = 340;
const RIGHT_MAX_W = 178;
/** Hueco entre el logo y el nombre. */
const LOGO_GAP = 10;

/**
 * Caja del logo a partir de su proporción real (ancho/alto).
 *
 * Se fija el alto y el ancho sale de la proporción; si ese ancho se pasa del
 * tope, manda el ancho y el que cede es el alto. Nunca se deforma porque los
 * dos lados salen de la MISMA proporción.
 *
 * Sin proporción (`null`) se asume 1:1 → 44×44, que es la caja que usan hoy
 * consentimiento, receta y presupuesto.
 */
export function logoBox(aspect?: number | null): { width: number; height: number } {
  const a = typeof aspect === "number" && Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  let height = LOGO_MAX_H;
  let width = height * a;
  if (width > LOGO_MAX_W) {
    width = LOGO_MAX_W;
    height = width / a;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { width: r(width), height: r(height) };
}

/**
 * Ancho disponible para el nombre y los datos: lo que sobra a la izquierda
 * después de descontar la caja del logo y su hueco.
 *
 * Va como `maxWidth` de esa columna, y NO es opcional. Medido con
 * "Clínica Dental y Especialidades del Valle de Guadalupe": con solo
 * `flexShrink: 1` el nombre se pinta en un renglón y se monta ENCIMA del
 * folio; con este tope parte limpio en dos renglones. Comprobado también que
 * `flexBasis: 0 + flexGrow: 1` no vale — parte palabra por palabra.
 */
export function brandColumnWidth(logoWidth: number | null): number {
  if (logoWidth == null || logoWidth <= 0) return LEFT_MAX_W;
  return Math.max(120, LEFT_MAX_W - logoWidth - LOGO_GAP);
}

/**
 * Tamaño de letra del nombre de la clínica.
 *
 * Sin logo el nombre ocupa su sitio y sale en grande; con logo va al lado y es
 * más discreto. En los dos casos baja por tramos según lo largo que sea, para
 * que "Clínica Dental y Especialidades del Valle de Guadalupe" parta en dos
 * renglones en vez de empujar el folio fuera de la hoja.
 */
export function clinicNameFontSize(name: string, hasLogo: boolean): number {
  const n = (name ?? "").trim().length;
  if (hasLogo) {
    if (n > 52) return 11.5;
    if (n > 36) return 13;
    return 15;
  }
  if (n > 52) return 15;
  if (n > 36) return 17;
  return 20;
}

/**
 * Renglones grises bajo el nombre: dónde está la clínica, cómo se le llama, y
 * el fiscal cuando el documento lo pide.
 *
 * La calle va en su renglón y la ciudad con el estado en el siguiente, en vez
 * de todo junto como hacen consentimiento/receta/presupuesto. Es por lo que se
 * vio al mirar las muestras: en la columna que queda al lado de un logo ancho
 * (198 pt) el renglón junto no cabe y @react-pdf lo parte con guion —
 * "Guadalajara, Jalis-co". Partido por comas cabe y no hace falta guion.
 */
export function clinicLetterheadLines(c: ClinicLetterheadClinic): string[] {
  const lines: string[] = [];
  if (c.clinicAddress) lines.push(c.clinicAddress);
  const donde = [c.clinicCity, c.clinicState].filter(Boolean).join(", ");
  if (donde) lines.push(donde);
  const contacto = [c.clinicPhone ? `Tel: ${c.clinicPhone}` : null, c.clinicEmail]
    .filter(Boolean)
    .join(" · ");
  if (contacto) lines.push(contacto);
  if (c.clinicTaxId) lines.push(`RFC: ${c.clinicTaxId}`);
  return lines;
}

// ── Descarga del logo ──────────────────────────────────────────────────

/** Se corta a los 4 s: un bucket lento no puede dejar sin comprobante al paciente. */
export const LOGO_TIMEOUT_MS = 4000;
/** Tope de bytes, igual que en quote-pdf/consent-pdf. */
export const LOGO_MAX_BYTES = 2_000_000;

/**
 * Proporción (ancho/alto) leyendo la cabecera del archivo, y de paso la prueba
 * de que el archivo es de verdad un PNG o un JPEG.
 *
 * Devuelve null para cualquier otra cosa: webp, gif, svg, un HTML de error del
 * bucket… Es EL filtro que evita el hueco en blanco, porque @react-pdf no lanza
 * con esos formatos, simplemente no pinta nada.
 */
export function imageAspect(buf: Buffer): number | null {
  // PNG: firma de 8 bytes y IHDR con ancho y alto en 16..24.
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return w > 0 && h > 0 ? w / h : null;
  }

  // JPEG: recorrer marcadores hasta el SOFn, que trae alto y ancho.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      // Relleno (0xff) y marcadores sin carga útil: se saltan de uno en uno.
      if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null;
      const esSOF =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (esSOF) {
        const h = buf.readUInt16BE(i + 5);
        const w = buf.readUInt16BE(i + 7);
        return w > 0 && h > 0 ? w / h : null;
      }
      i += 2 + len;
    }
  }

  return null;
}

/**
 * Baja el logo de la clínica y lo devuelve como data URL, con su proporción.
 *
 * Falla SIEMPRE en suave (devuelve null) y nunca lanza: el PDF tiene que salir
 * aunque el bucket esté caído, devuelva 404, tarde, o guarde un formato que
 * @react-pdf no sabe pintar. Sin logo la cabecera enseña el nombre en grande,
 * que es infinitamente mejor que un documento que no se genera.
 *
 * Mismo patrón que `fetchImageDataUrl` de quote-pdf/consent-pdf (4 s, 2 MB,
 * catch a null) con dos apreturas: el formato se comprueba mirando los BYTES y
 * no el content-type (un bucket que sirva `application/octet-stream` sigue
 * valiendo, y un HTML de error que se anuncie como imagen ya no cuela), y solo
 * pasan PNG y JPEG, que es lo que @react-pdf sabe pintar.
 */
export async function fetchClinicLogo(
  url: string | null | undefined,
  /** Solo para las pruebas, que no pueden esperar 4 s a un servidor mudo. */
  timeoutMs: number = LOGO_TIMEOUT_MS,
): Promise<{ dataUrl: string; aspect: number } | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const declarado = Number(res.headers.get("content-length"));
    if (Number.isFinite(declarado) && declarado > LOGO_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > LOGO_MAX_BYTES) return null;
    const aspect = imageAspect(buf);
    if (aspect == null) return null;
    const mime = buf[0] === 0x89 ? "image/png" : "image/jpeg";
    return { dataUrl: `data:${mime};base64,${buf.toString("base64")}`, aspect };
  } catch {
    return null;
  }
}

/**
 * De una fila de `Clinic` a las props de cabecera, logo incluido. Un caller
 * nuevo se conecta con `...(await clinicLetterheadProps(x.clinic))`.
 */
export async function clinicLetterheadProps(
  clinic: ClinicLetterheadFields | null | undefined,
): Promise<ClinicLetterheadClinic> {
  const logo = await fetchClinicLogo(clinic?.logoUrl);
  return {
    clinicName: clinic?.name || "Clínica",
    clinicAddress: clinic?.address ?? null,
    clinicCity: clinic?.city ?? null,
    clinicState: clinic?.state ?? null,
    clinicPhone: clinic?.phone ?? null,
    clinicEmail: clinic?.email ?? null,
    clinicLogoDataUrl: logo?.dataUrl ?? null,
    clinicLogoAspect: logo?.aspect ?? null,
  };
}

// ── Pintado ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    paddingBottom: 12,
    marginBottom: 16,
  },
  // `maxWidth` NO es decorativo y no se puede cambiar por `flexShrink`: medido
  // con "Clínica Dental y Especialidades del Valle de Guadalupe", un bloque sin
  // tope no parte el nombre — lo pinta en un solo renglón y se monta ENCIMA del
  // folio. Con el tope, parte. Es el mismo 330-340 que ya usaban consentimiento,
  // receta y presupuesto, y por esto lo usaban.
  left: {
    flexDirection: "row",
    gap: LOGO_GAP,
    alignItems: "flex-start",
    maxWidth: LEFT_MAX_W,
    flexShrink: 1,
  },
  // El maxWidth real lo pone el componente: depende de lo ancho que sea el logo.
  brandCol: { flexShrink: 1 },
  // objectFit + objectPositionX: aunque la proporción no llegue o venga mal,
  // la imagen se encaja sin deformarse y pegada a la izquierda.
  logo: { objectFit: "contain", objectPositionX: 0 },
  // lineHeight explícito: hay documentos que ponen 1.5 en la página entera, y
  // con el nombre a 20 pt eso lo pega al subtítulo. Aquí manda la cabecera.
  brand: { fontFamily: "Helvetica-Bold", lineHeight: 1.2 },
  subtitle: { fontSize: 9, color: "#6b6b78", marginTop: 3, lineHeight: 1.25 },
  line: { fontSize: 8.5, color: "#6b6b78", marginTop: 1, lineHeight: 1.3 },
  right: { maxWidth: RIGHT_MAX_W, marginLeft: 14, flexShrink: 0 },
});

export function ClinicLetterhead(props: ClinicLetterheadProps) {
  const hasLogo = Boolean(props.clinicLogoDataUrl);
  const name = (props.clinicName ?? "").trim() || "Clínica";
  const lines = clinicLetterheadLines(props);
  const box = hasLogo ? logoBox(props.clinicLogoAspect) : null;

  return (
    <View style={[styles.header, { borderBottomColor: props.accent }]}>
      <View style={styles.left}>
        {/* Sin logo NO se pinta caja: el hueco desaparece y el nombre, más
            grande, hace de identidad. Nunca un recuadro vacío. */}
        {box ? (
          <PdfImage style={[styles.logo, box]} src={props.clinicLogoDataUrl as string} />
        ) : null}
        <View style={[styles.brandCol, { maxWidth: brandColumnWidth(box?.width ?? null) }]}>
          <Text
            style={[
              styles.brand,
              { fontSize: clinicNameFontSize(name, hasLogo), color: props.accent },
            ]}
          >
            {name}
          </Text>
          {props.subtitle ? <Text style={styles.subtitle}>{props.subtitle}</Text> : null}
          {lines.map((l, i) => (
            <Text key={i} style={styles.line}>
              {l}
            </Text>
          ))}
        </View>
      </View>
      {props.right ? <View style={styles.right}>{props.right}</View> : null}
    </View>
  );
}
