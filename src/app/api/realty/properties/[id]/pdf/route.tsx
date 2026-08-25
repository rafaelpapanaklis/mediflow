import { NextResponse } from "next/server";
import QRCode from "qrcode";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import {
  REALTY_OPERATION_LABELS,
  REALTY_PROPERTY_KIND_LABELS,
  REALTY_PROPERTY_STATUS_UI,
  realtyAmenityLabel,
  type RealtyCurrency,
} from "@/lib/realty/types";
import { activeAmenityKeys, levelsFrom } from "@/lib/realty/properties";
import { downloadRealtyFile, loadAccountLogo } from "@/lib/realty/media";
import { realtyTourProviderLabel } from "@/lib/realty/tours";
import { gateRealty, notFound, realtyApiError } from "../../_helpers";

// @react-pdf/renderer NO corre en edge: necesita Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * FICHA PDF DE UNA PÁGINA — lo que el asesor manda por WhatsApp veinte
 * veces al día.
 *
 * ── QUE PESE POCO, DE VERDAD ───────────────────────────────────────────
 * Es lo único que importa aquí: se manda por WhatsApp, muchas veces al día,
 * a gente con datos móviles. Por eso:
 *   · máximo 5 fotos (portada + 4), que es lo que cabe sin apretujarse;
 *   · cada foto se REDUCE con sharp antes de incrustarla (900 px la
 *     portada, 460 las chicas, JPEG 68) — la original de 1920 px pesaría
 *     diez veces más y en una hoja A4 no se nota;
 *   · Helvetica de las built-in, sin Font.register: registrar una fuente
 *     añade descargas en tiempo de ejecución.
 *
 * ── QUÉ NO SALE ────────────────────────────────────────────────────────
 * Notas internas, documentos (escrituras, predial) y la comisión pactada.
 * Esta hoja se le manda a un desconocido por WhatsApp: lo que no debería
 * ver un desconocido, no se imprime. Y la dirección EXACTA solo si el
 * inmueble tiene encendido showExactAddress.
 *
 * Los datos de contacto salen según el MODO de la cuenta: una inmobiliaria
 * pone los suyos, un asesor independiente los suyos.
 */

const PINE = "#2F6B4D";
const PINE_DARK = "#27543E";
const INK = "#14201A";
const MUTED = "#6B776F";
const SAND = "#F5F1E8";

const styles = StyleSheet.create({
  page: {
    paddingTop: 26,
    paddingBottom: 22,
    paddingHorizontal: 28,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: INK,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: PINE,
    paddingBottom: 8,
    marginBottom: 12,
  },
  brandBox: { flexDirection: "row", alignItems: "center" },
  logo: { width: 34, height: 34, objectFit: "contain", marginRight: 8 },
  brand: { fontSize: 14, fontFamily: "Helvetica-Bold", color: PINE_DARK },
  brandSub: { fontSize: 8, color: MUTED, marginTop: 1 },
  folioBox: { alignItems: "flex-end" },
  folio: { fontSize: 8, color: MUTED },
  statusPill: {
    marginTop: 3,
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 8,
    backgroundColor: SAND,
    color: PINE_DARK,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
  },

  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", maxWidth: 340, lineHeight: 1.2 },
  where: { fontSize: 9, color: MUTED, marginTop: 3 },
  priceBox: { alignItems: "flex-end" },
  price: { fontSize: 17, fontFamily: "Helvetica-Bold", color: PINE_DARK },
  priceAlt: { fontSize: 8.5, color: MUTED, marginTop: 1 },
  operation: { fontSize: 8, color: PINE, fontFamily: "Helvetica-Bold", marginTop: 2 },

  gallery: { flexDirection: "row", marginTop: 12, gap: 5 },
  cover: { width: 320, height: 210, objectFit: "cover", borderRadius: 5 },
  sideCol: { flexDirection: "column", gap: 5 },
  sideImg: { width: 214, height: 100, objectFit: "cover", borderRadius: 5 },
  noPhoto: {
    width: 539,
    height: 120,
    borderRadius: 5,
    backgroundColor: SAND,
    alignItems: "center",
    justifyContent: "center",
    color: MUTED,
    fontSize: 9,
  },

  sectionTitle: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: PINE_DARK,
    marginTop: 13,
    marginBottom: 5,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  specGrid: { flexDirection: "row", flexWrap: "wrap" },
  spec: {
    width: "20%",
    paddingVertical: 4,
    paddingRight: 6,
  },
  specLabel: { fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 0.4 },
  specValue: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 1 },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  chip: {
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: 9,
    backgroundColor: SAND,
    fontSize: 7.5,
    color: PINE_DARK,
    marginRight: 4,
    marginBottom: 4,
  },

  desc: { fontSize: 8.5, lineHeight: 1.45, color: "#3B453E", marginTop: 2 },

  bottom: { flexDirection: "row", marginTop: 14, alignItems: "flex-end" },
  contactBox: { flex: 1 },
  contactName: { fontSize: 11, fontFamily: "Helvetica-Bold" },
  contactLine: { fontSize: 8.5, color: MUTED, marginTop: 2 },
  qrBox: { alignItems: "center", marginLeft: 14 },
  qr: { width: 66, height: 66 },
  qrLabel: { fontSize: 6.5, color: MUTED, marginTop: 3, maxWidth: 76, textAlign: "center" },

  footer: {
    position: "absolute",
    bottom: 12,
    left: 28,
    right: 28,
    borderTopWidth: 0.5,
    borderTopColor: "#D8D2C4",
    paddingTop: 5,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 6.5,
    color: MUTED,
  },
});

function money(amount: number, currency: RealtyCurrency): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString("es-MX")}`;
  }
}

/** Reduce e incrusta como data URL. Null si la foto no se pudo leer. */
async function embedPhoto(path: string, width: number): Promise<string | null> {
  const raw = await downloadRealtyFile(path);
  if (!raw) return null;
  try {
    const sharp = (await import("sharp")).default;
    const out = await sharp(raw, { failOn: "none" })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .jpeg({ quality: 68, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await gateRealty("properties.view");
  if ("response" in gate) return gate.response;
  const { ctx } = gate;

  try {
    const p = await prisma.realtyProperty.findFirst({
      where: { id: params.id, accountId: ctx.accountId },
      include: {
        assignedUser: { select: { firstName: true, lastName: true, email: true } },
        photos: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], take: 5 },
        tours: { where: { externalUrl: { not: null } }, orderBy: { sortOrder: "asc" }, take: 1 },
      },
    });
    if (!p) return notFound();

    const account = ctx.account;
    const amenities = activeAmenityKeys(p.amenities).slice(0, 12);
    const levels = levelsFrom(p.amenities);

    // Las fotos y el QR se preparan en paralelo: son lo que tarda.
    const [coverSrc, sideSrcs, logoSrc, qrDataUrl] = await Promise.all([
      p.photos[0] ? embedPhoto(p.photos[0].url, 900) : Promise.resolve(null),
      Promise.all(p.photos.slice(1, 5).map((f) => embedPhoto(f.url, 460))),
      loadAccountLogo(account.logoUrl, ctx.accountId).then(async (buf) => {
        if (!buf) return null;
        try {
          const sharp = (await import("sharp")).default;
          const out = await sharp(buf, { failOn: "none" })
            .resize({ width: 140, withoutEnlargement: true })
            .png()
            .toBuffer();
          return `data:image/png;base64,${out.toString("base64")}`;
        } catch {
          return null;
        }
      }),
      (async () => {
        const tourUrl = p.tours[0]?.externalUrl;
        if (!tourUrl) return null;
        try {
          return await QRCode.toDataURL(tourUrl, { margin: 0, width: 240 });
        } catch (e) {
          // Best-effort: sin QR la ficha sale igual, solo sin ese cuadrito.
          console.warn("[realty pdf] QR falló:", (e as Error).message);
          return null;
        }
      })(),
    ]);

    const side = sideSrcs.filter((x): x is string => !!x);

    // Ubicación: el número exacto SOLO si el inmueble lo permite.
    const wherePublic = [p.colonia, p.city, p.state].filter(Boolean).join(", ");
    const whereLine = p.showExactAddress && p.address ? `${p.address}, ${wherePublic}` : wherePublic;

    // Contacto: la agencia manda si la cuenta es AGENCY; si es un asesor
    // independiente o el inmueble tiene asesor asignado, el suyo.
    const agentName = p.assignedUser
      ? `${p.assignedUser.firstName} ${p.assignedUser.lastName}`.trim()
      : "";
    const showAgentFirst = ctx.mode === "AGENT" || (ctx.mode === "AGENCY" && !!agentName);
    const contactName = showAgentFirst && agentName ? agentName : account.name;
    const contactSub = showAgentFirst && agentName ? account.name : "";
    const contactPhone = account.phone ?? "";
    const contactEmail = account.email ?? p.assignedUser?.email ?? "";

    const statusUi = REALTY_PROPERTY_STATUS_UI[p.status];
    const saleAmount = Number(p.price);
    const rentAmount = p.rentPrice !== null ? Number(p.rentPrice) : null;
    const currency = p.currency as RealtyCurrency;

    const specs: { label: string; value: string }[] = [];
    if (p.bedrooms !== null) specs.push({ label: "Recámaras", value: String(p.bedrooms) });
    if (p.bathrooms !== null) specs.push({ label: "Baños", value: String(p.bathrooms) });
    if (p.halfBathrooms !== null && p.halfBathrooms > 0) {
      specs.push({ label: "Medios baños", value: String(p.halfBathrooms) });
    }
    if (p.parking !== null) specs.push({ label: "Cochera", value: String(p.parking) });
    if (p.builtM2 !== null) {
      specs.push({ label: "Construcción", value: `${Number(p.builtM2)} m²` });
    }
    if (p.landM2 !== null) {
      specs.push({ label: "Terreno", value: `${Number(p.landM2)} m²` });
    }
    if (levels !== null) specs.push({ label: "Niveles", value: String(levels) });
    if (p.ageYears !== null) {
      specs.push({ label: "Antigüedad", value: `${p.ageYears} años` });
    }
    if (p.maintenanceFee !== null) {
      specs.push({
        label: "Mantenimiento",
        value: money(Number(p.maintenanceFee), currency),
      });
    }

    const description = (p.description ?? "").trim().slice(0, 520);
    const tourLabel = p.tours[0] ? realtyTourProviderLabel(p.tours[0].provider) : "";

    const doc = (
      <Document
        title={p.title}
        author={account.name}
        subject={`${REALTY_PROPERTY_KIND_LABELS[p.kind]} · ${REALTY_OPERATION_LABELS[p.operation]}`}
      >
        <Page size="A4" style={styles.page}>
          <View style={styles.header}>
            <View style={styles.brandBox}>
              {logoSrc ? <Image src={logoSrc} style={styles.logo} /> : null}
              <View>
                <Text style={styles.brand}>{account.name}</Text>
                {account.licenseNumber ? (
                  <Text style={styles.brandSub}>
                    Licencia {account.licenseNumber}
                    {account.licenseState ? ` · ${account.licenseState}` : ""}
                  </Text>
                ) : null}
              </View>
            </View>
            <View style={styles.folioBox}>
              {p.shortTermFolio ? (
                <Text style={styles.folio}>Folio {p.shortTermFolio}</Text>
              ) : null}
              <Text style={styles.statusPill}>{statusUi.label}</Text>
            </View>
          </View>

          <View style={styles.titleRow}>
            <View>
              <Text style={styles.title}>{p.title}</Text>
              <Text style={styles.where}>
                {whereLine || "Ubicación por confirmar"}
              </Text>
            </View>
            <View style={styles.priceBox}>
              {p.operation === "RENTA" ? (
                <>
                  <Text style={styles.price}>
                    {rentAmount !== null ? money(rentAmount, currency) : "A tratar"}
                  </Text>
                  <Text style={styles.priceAlt}>al mes</Text>
                </>
              ) : (
                <>
                  <Text style={styles.price}>
                    {saleAmount > 0 ? money(saleAmount, currency) : "A tratar"}
                  </Text>
                  {p.operation === "AMBAS" && rentAmount !== null ? (
                    <Text style={styles.priceAlt}>
                      {money(rentAmount, currency)} al mes en renta
                    </Text>
                  ) : null}
                </>
              )}
              <Text style={styles.operation}>
                {REALTY_OPERATION_LABELS[p.operation].toUpperCase()} ·{" "}
                {REALTY_PROPERTY_KIND_LABELS[p.kind].toUpperCase()}
              </Text>
            </View>
          </View>

          {coverSrc ? (
            <View style={styles.gallery}>
              <Image src={coverSrc} style={styles.cover} />
              {side.length > 0 ? (
                <View style={styles.sideCol}>
                  {side.slice(0, 2).map((src, i) => (
                    <Image key={i} src={src} style={styles.sideImg} />
                  ))}
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.noPhoto}>
              <Text>Este inmueble todavía no tiene fotos</Text>
            </View>
          )}

          {specs.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Características</Text>
              <View style={styles.specGrid}>
                {specs.map((sp) => (
                  <View key={sp.label} style={styles.spec}>
                    <Text style={styles.specLabel}>{sp.label}</Text>
                    <Text style={styles.specValue}>{sp.value}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          {amenities.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Amenidades</Text>
              <View style={styles.chips}>
                {amenities.map((key) => (
                  <Text key={key} style={styles.chip}>
                    {realtyAmenityLabel(key)}
                  </Text>
                ))}
              </View>
            </>
          ) : null}

          {description ? (
            <>
              <Text style={styles.sectionTitle}>Descripción</Text>
              <Text style={styles.desc}>{description}</Text>
            </>
          ) : null}

          <View style={styles.bottom}>
            <View style={styles.contactBox}>
              <Text style={styles.sectionTitle}>Contacto</Text>
              <Text style={styles.contactName}>{contactName}</Text>
              {contactSub ? <Text style={styles.contactLine}>{contactSub}</Text> : null}
              {contactPhone ? <Text style={styles.contactLine}>{contactPhone}</Text> : null}
              {contactEmail ? <Text style={styles.contactLine}>{contactEmail}</Text> : null}
            </View>
            {qrDataUrl ? (
              <View style={styles.qrBox}>
                <Image src={qrDataUrl} style={styles.qr} />
                <Text style={styles.qrLabel}>
                  Escanea para el recorrido virtual{tourLabel ? ` (${tourLabel})` : ""}
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.footer} fixed>
            <Text>
              {/* La dirección exacta se omite a propósito cuando el
                  inmueble no la publica: esta hoja circula por WhatsApp. */}
              {p.showExactAddress
                ? "Ficha informativa. Precios sujetos a cambio sin previo aviso."
                : "Ubicación aproximada. Precios sujetos a cambio sin previo aviso."}
            </Text>
            <Text>{account.name}</Text>
          </View>
        </Page>
      </Document>
    );

    const buffer = await renderToBuffer(doc);
    const safeName =
      (p.shortTermFolio ?? p.title)
        .toLowerCase()
        .normalize("NFD")
        // Rango de marcas diacríticas ESCAPADO, como en makeRealtySlug: con
        // los caracteres crudos dentro de la clase, cualquier editor que
        // normalice el archivo lo mutila sin que nadie lo note.
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 50) || "inmueble";

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeName}.pdf"`,
        // Lleva datos de un inquilino concreto: ninguna caché intermedia
        // debe quedarse con esta hoja.
        "Cache-Control": "private, no-cache, no-store, must-revalidate",
      },
    });
  } catch (e) {
    return realtyApiError("properties/[id]/pdf:GET", e);
  }
}
