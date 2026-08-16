"use client";

// Material VISUAL del kit de marketing: imágenes para redes y piezas para
// imprimir, las dos con el nombre del afiliado y su QR.
//
// El componente NO dibuja nada: pide las piezas a
// /api/afiliados/marketing/{imagen,imprimible}, que las generan en el
// servidor con la sesión del afiliado. Por eso aquí no viaja ningún código de
// referido: si el navegador pudiera elegirlo, cualquiera generaría material
// con el de otro. Lo único que manda es QUÉ pieza quiere.
//
// EL CATÁLOGO NO SE PINTA ENTERO. 10 temas × 3 estilos × 4 formatos son 120
// imágenes: una rejilla con todas sería una pared imposible de mirar (y 120
// renders de satori al cargar la página). Por eso la elección va en dos
// pasos —primero el tema y el estilo, después aparecen los cuatro formatos de
// ESA combinación—, todo con useState: cambiar de tema o de estilo no navega,
// no recarga y no mueve el scroll. Las cajas de vista previa tienen altura
// fija, así que tampoco hay salto de layout mientras carga la imagen nueva.
//
// Estilo: primitivas de panel-ui + clases `dcafp` de src/app/afiliados/panel.css,
// igual que el resto del kit.
import { useState } from "react";
import { Download, Images, Printer, QrCode } from "lucide-react";
import { SectionEyebrow } from "@/components/afiliados/ui/panel-ui";
import {
  SOCIAL_FORMATS,
  SOCIAL_VARIANTS,
  SOCIAL_STYLES,
  PRINT_PIECES,
  PRINT_DEFAULT_STYLE,
  type SocialStyleId,
  type SocialVariantId,
} from "@/lib/affiliates/marketing-assets";

/** Un destino posible para el QR: el link base o una campaña del afiliado. */
export type QrLinkOption = { id: string; label: string };

const BASE_OPTION_ID = "base";

const tileStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  minWidth: 0,
  padding: 14,
  borderRadius: "var(--dcafp-r-box)",
  background: "var(--dcafp-surface-2)",
  border: "1px solid var(--dcafp-line-nested)",
};

/** Numerito del paso: "1 Elige el tema". Ordena la elección sin abrir tarjetas. */
function StepLabel({ n, text, htmlFor }: { n: number; text: string; htmlFor?: string }) {
  const body = (
    <>
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          width: 20,
          height: 20,
          borderRadius: 999,
          background: "var(--dcafp-brand)",
          color: "#fff",
          fontSize: 11.5,
          fontWeight: 800,
        }}
      >
        {n}
      </span>
      <span style={{ fontSize: 13.5, fontWeight: 750, color: "var(--dcafp-ink)" }}>{text}</span>
    </>
  );
  const style: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, minWidth: 0 };
  return htmlFor ? (
    <label htmlFor={htmlFor} style={style}>
      {body}
    </label>
  ) : (
    <div style={style}>{body}</div>
  );
}

/**
 * Fila de estilos. Los botones miden los 44 px del objetivo táctil del panel
 * (`dcafp-btn` sin `--sm`): a 375 px son tres piezas que se pulsan con el
 * pulgar sin apuntar.
 */
function StyleChips({
  value,
  onChange,
  idPrefix,
  markRecommended,
}: {
  value: SocialStyleId;
  onChange: (id: SocialStyleId) => void;
  idPrefix: string;
  /** Marca el estilo recomendado para imprenta. Solo en la sección de papel. */
  markRecommended?: boolean;
}) {
  return (
    <div role="group" aria-label="Estilo visual" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {SOCIAL_STYLES.map((s) => {
        const active = s.id === value;
        return (
          <button
            key={`${idPrefix}-${s.id}`}
            type="button"
            onClick={() => onChange(s.id)}
            aria-pressed={active}
            className={`dcafp-btn${active ? " dcafp-btn--outline" : ""}`}
          >
            {s.label}
            {markRecommended && s.printRecommended ? (
              <span
                style={{
                  marginLeft: 6,
                  fontSize: 10.5,
                  fontWeight: 800,
                  letterSpacing: 0.3,
                  color: "var(--dcafp-ok-ink)",
                  background: "var(--dcafp-ok-bg)",
                  borderRadius: 999,
                  padding: "2px 7px",
                }}
              >
                Recomendado
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function imageUrl(opts: {
  formato: string;
  variante: string;
  estilo: string;
  link: string;
  descarga?: boolean;
}): string {
  const p = new URLSearchParams({
    formato: opts.formato,
    variante: opts.variante,
    estilo: opts.estilo,
  });
  if (opts.link !== BASE_OPTION_ID) p.set("link", opts.link);
  if (opts.descarga) p.set("descarga", "1");
  return `/api/afiliados/marketing/imagen?${p.toString()}`;
}

function printUrl(opts: { pieza: string; estilo: string; tema: string; link: string }): string {
  const p = new URLSearchParams({ pieza: opts.pieza, estilo: opts.estilo, tema: opts.tema });
  if (opts.link !== BASE_OPTION_ID) p.set("link", opts.link);
  return `/api/afiliados/marketing/imprimible?${p.toString()}`;
}

export function MarketingVisuals({ qrLinks }: { qrLinks: QrLinkOption[] }) {
  const [variant, setVariant] = useState<SocialVariantId>(SOCIAL_VARIANTS[0].id);
  const [style, setStyle] = useState<SocialStyleId>(SOCIAL_STYLES[0].id);
  // El papel arranca en el estilo recomendado para imprenta, no en el que se
  // eligió para redes: son dos decisiones distintas (lo que luce en un feed
  // oscuro se come el tóner de una láser).
  const [printStyle, setPrintStyle] = useState<SocialStyleId>(PRINT_DEFAULT_STYLE);
  const [link, setLink] = useState<string>(BASE_OPTION_ID);

  const activeVariant = SOCIAL_VARIANTS.find((v) => v.id === variant) ?? SOCIAL_VARIANTS[0];
  const activeStyle = SOCIAL_STYLES.find((s) => s.id === style) ?? SOCIAL_STYLES[0];

  return (
    <>
      {/* ── A dónde apunta el QR ───────────────────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <SectionEyebrow icon={<QrCode size={14} />} text="El QR de tus piezas" />
        {qrLinks.length > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
            <label htmlFor="mkt-qr-link" className="dcafp-hint">
              Todo el material lleva un QR que apunta a:
            </label>
            <select
              id="mkt-qr-link"
              className="dcafp-select"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              style={{ maxWidth: "100%" }}
            >
              <option value={BASE_OPTION_ID}>Mi link principal</option>
              {qrLinks.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="dcafp-hint" style={{ margin: 0 }}>
            Todo el material lleva un QR con tu link principal: quien lo escanee queda registrado
            como referido tuyo. Si creas links por campaña, aquí vas a poder elegir cuál usar.
          </p>
        )}
      </section>

      {/* ── Imágenes para redes ────────────────────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <SectionEyebrow icon={<Images size={14} />} text="Imágenes para redes" />
        <p className="dcafp-hint" style={{ margin: 0 }}>
          Cada imagen ya trae el logo, tu nombre y tu QR. Elige de qué quieres hablar y con qué
          aspecto; abajo aparecen los cuatro tamaños listos para descargar.
        </p>

        {/* Paso 1 — tema. Un <select> y no diez botones: con diez ángulos, la
            fila de chips se vuelve un muro de tres renglones en el celular, y
            el selector nativo se maneja con el pulgar. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <StepLabel n={1} text="Elige el tema" htmlFor="mkt-tema" />
          <select
            id="mkt-tema"
            className="dcafp-select"
            value={variant}
            onChange={(e) => setVariant(e.target.value as SocialVariantId)}
            style={{ maxWidth: "100%" }}
          >
            {SOCIAL_VARIANTS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>

          {/* Qué va a decir la pieza, en texto, antes de mirar la imagen. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              minWidth: 0,
              padding: "12px 14px",
              borderRadius: "var(--dcafp-r-box)",
              background: "var(--dcafp-surface-2)",
              border: "1px solid var(--dcafp-line-nested)",
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 800,
                letterSpacing: 1,
                color: "var(--dcafp-brand)",
              }}
            >
              {activeVariant.eyebrow}
            </span>
            <span style={{ fontSize: 14.5, fontWeight: 750, color: "var(--dcafp-ink)", lineHeight: 1.35 }}>
              “{activeVariant.headline}”
            </span>
            {/* `listStyle` explícito: el reset de panel.css apaga los
                marcadores con :where(), y sin ellos los dos apoyos se leen
                como un párrafo partido en vez de como la lista que son. */}
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                listStyle: "disc outside",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              {activeVariant.lines.map((l) => (
                <li key={l} style={{ fontSize: 12.5, color: "var(--dcafp-ink-2)", lineHeight: 1.5 }}>
                  {l}
                </li>
              ))}
            </ul>
            {/* La nota de plan también se ve AQUÍ, no solo impresa: el afiliado
                tiene que saber qué está prometiendo antes de publicarlo. */}
            {activeVariant.planNote ? (
              <span
                style={{
                  alignSelf: "flex-start",
                  marginTop: 2,
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: "var(--dcafp-brand-deep)",
                  background: "var(--dcafp-brand-50)",
                  border: "1px solid var(--dcafp-brand-100)",
                  borderRadius: 999,
                  padding: "3px 10px",
                }}
              >
                {activeVariant.planNote}
              </span>
            ) : null}
          </div>
        </div>

        {/* Paso 2 — estilo */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <StepLabel n={2} text="Elige el estilo" />
          <StyleChips value={style} onChange={setStyle} idPrefix="social" />
          <p className="dcafp-hint" style={{ margin: 0 }}>
            {activeStyle.hint}
          </p>
        </div>

        {/* Paso 3 — los cuatro formatos de esa combinación */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <StepLabel n={3} text="Descarga el tamaño que necesites" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))",
              gap: 12,
            }}
          >
            {SOCIAL_FORMATS.map((f) => {
              const preview = imageUrl({ formato: f.id, variante: variant, estilo: style, link });
              return (
                <div key={f.id} style={tileStyle}>
                  <div
                    style={{
                      height: 168,
                      display: "grid",
                      placeItems: "center",
                      padding: 10,
                      borderRadius: "var(--dcafp-r-el)",
                      // Tablero neutro (no hay token para este gris: la caja
                      // antes iba en tinta y solo tenía que lucir el estilo
                      // oscuro). El estilo claro sobre fondo tinta se vería
                      // como un recorte flotando, y el oscuro sobre blanco
                      // igual: el gris de en medio deja ver el borde real de
                      // las tres piezas.
                      background: "#e9e7f0",
                      border: "1px solid var(--dcafp-line)",
                      overflow: "hidden",
                    }}
                  >
                    {/* La vista previa ES la imagen final, generada al vuelo: lo
                        que se ve aquí es exactamente lo que se descarga.
                        SIN `key`: al cambiar de tema o de estilo solo cambia el
                        `src` y el navegador deja la imagen anterior hasta que
                        llega la nueva. Con `key` el <img> se remonta y la caja
                        parpadea en vacío en cada clic.
                        `loading="lazy"` para no disparar cuatro renders del
                        servidor en cuanto carga la página. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview}
                      alt={`Vista previa: ${f.label}, estilo ${activeStyle.label.toLowerCase()} — ${activeVariant.headline}`}
                      loading="lazy"
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 4 }}
                    />
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 750, color: "var(--dcafp-ink)" }}>
                      {f.label}
                    </span>
                    <span className="dcafp-hint">
                      {f.where} · {f.width} × {f.height} px
                    </span>
                    <span style={{ fontSize: 12, color: "var(--dcafp-ink-3)", lineHeight: 1.45 }}>
                      {f.hint}
                    </span>
                  </div>

                  <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
                    <a
                      className="dcafp-btn dcafp-btn--sm"
                      href={imageUrl({
                        formato: f.id,
                        variante: variant,
                        estilo: style,
                        link,
                        descarga: true,
                      })}
                      download
                      aria-label={`Descargar ${f.label} en PNG, estilo ${activeStyle.label.toLowerCase()}`}
                    >
                      <Download size={14} aria-hidden />
                      Descargar PNG
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Para imprimir ──────────────────────────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <SectionEyebrow icon={<Printer size={14} />} text="Para imprimir" />
        <p className="dcafp-hint" style={{ margin: 0 }}>
          PDF listos para mandar a la imprenta o sacar en una láser: llevan tu nombre, tu QR y
          márgenes de seguridad. Imprímelos al 100%, sin “ajustar a la página”.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <StepLabel n={1} text="Elige el estilo del papel" />
          <StyleChips value={printStyle} onChange={setPrintStyle} idPrefix="print" markRecommended />
          <p className="dcafp-hint" style={{ margin: 0 }}>
            El estilo claro es el que conviene para imprenta: pone tinta solo donde hay texto, así
            que gasta menos tóner y sale más limpio en una impresora láser.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
            gap: 12,
          }}
        >
          {PRINT_PIECES.map((p) => (
            <div key={p.id} style={tileStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, color: "var(--dcafp-brand)" }}>
                <Printer size={16} aria-hidden />
                <span style={{ fontSize: 13.5, fontWeight: 750, color: "var(--dcafp-ink)" }}>
                  {p.label}
                </span>
              </div>
              <span className="dcafp-hint">{p.size}</span>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--dcafp-ink-2)", lineHeight: 1.5 }}>
                {p.hint}
              </p>
              {/* Qué se va a llevar la pieza: el tema de arriba, o el pitch
                  general si la pieza no lleva tema. Dicho antes de descargar,
                  no descubierto al abrir el PDF. */}
              <span style={{ fontSize: 12, color: "var(--dcafp-ink-3)", lineHeight: 1.45 }}>
                {p.usesVariant
                  ? `Se descarga con el tema “${activeVariant.label}”.`
                  : "Lleva tu nombre y tu QR; no cambia con el tema."}
              </span>
              <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
                <a
                  className="dcafp-btn dcafp-btn--sm"
                  href={printUrl({ pieza: p.id, estilo: printStyle, tema: variant, link })}
                  download
                  aria-label={`Descargar ${p.label} en PDF`}
                >
                  <Download size={14} aria-hidden />
                  Descargar PDF
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
