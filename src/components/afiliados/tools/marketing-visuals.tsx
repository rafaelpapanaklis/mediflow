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
// Estilo: primitivas de panel-ui + clases `dcafp` de src/app/afiliados/panel.css,
// igual que el resto del kit.
import { useState } from "react";
import { Download, Images, Printer, QrCode } from "lucide-react";
import { SectionEyebrow } from "@/components/afiliados/ui/panel-ui";
import {
  SOCIAL_FORMATS,
  SOCIAL_VARIANTS,
  PRINT_PIECES,
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

function imageUrl(opts: {
  formato: string;
  variante: string;
  link: string;
  descarga?: boolean;
}): string {
  const p = new URLSearchParams({ formato: opts.formato, variante: opts.variante });
  if (opts.link !== BASE_OPTION_ID) p.set("link", opts.link);
  if (opts.descarga) p.set("descarga", "1");
  return `/api/afiliados/marketing/imagen?${p.toString()}`;
}

function printUrl(pieza: string, link: string): string {
  const p = new URLSearchParams({ pieza });
  if (link !== BASE_OPTION_ID) p.set("link", link);
  return `/api/afiliados/marketing/imprimible?${p.toString()}`;
}

export function MarketingVisuals({ qrLinks }: { qrLinks: QrLinkOption[] }) {
  const [variant, setVariant] = useState<SocialVariantId>(SOCIAL_VARIANTS[0].id);
  const [link, setLink] = useState<string>(BASE_OPTION_ID);

  const activeVariant = SOCIAL_VARIANTS.find((v) => v.id === variant) ?? SOCIAL_VARIANTS[0];

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
      <section style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <SectionEyebrow icon={<Images size={14} />} text="Imágenes para redes" />
        <p className="dcafp-hint" style={{ margin: 0 }}>
          Cada imagen ya trae el logo, tu nombre y tu QR. Elige de qué quieres hablar y descarga el
          tamaño que necesites.
        </p>

        {/* Ángulo del mensaje */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {SOCIAL_VARIANTS.map((v) => {
            const active = v.id === variant;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setVariant(v.id)}
                aria-pressed={active}
                className={`dcafp-btn dcafp-btn--sm${active ? " dcafp-btn--outline" : ""}`}
              >
                {v.label}
              </button>
            );
          })}
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--dcafp-ink-2)", lineHeight: 1.5 }}>
          Dice: <strong style={{ color: "var(--dcafp-ink)" }}>“{activeVariant.headline}”</strong>
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))",
            gap: 12,
          }}
        >
          {SOCIAL_FORMATS.map((f) => {
            const preview = imageUrl({ formato: f.id, variante: variant, link });
            return (
              <div key={f.id} style={tileStyle}>
                <div
                  style={{
                    height: 168,
                    display: "grid",
                    placeItems: "center",
                    padding: 10,
                    borderRadius: "var(--dcafp-r-el)",
                    background: "var(--dcafp-ink)",
                    border: "1px solid var(--dcafp-line)",
                    overflow: "hidden",
                  }}
                >
                  {/* La vista previa ES la imagen final, generada al vuelo: lo
                      que se ve aquí es exactamente lo que se descarga.
                      `loading="lazy"` para no disparar cuatro renders del
                      servidor en cuanto carga la página. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={preview}
                    src={preview}
                    alt={`Vista previa: ${f.label} — ${activeVariant.headline}`}
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
                    href={imageUrl({ formato: f.id, variante: variant, link, descarga: true })}
                    download
                    aria-label={`Descargar ${f.label} en PNG`}
                  >
                    <Download size={14} aria-hidden />
                    Descargar PNG
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Para imprimir ──────────────────────────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <SectionEyebrow icon={<Printer size={14} />} text="Para imprimir" />
        <p className="dcafp-hint" style={{ margin: 0 }}>
          PDF listos para mandar a la imprenta o sacar en una láser: llevan tu nombre, tu QR y
          márgenes de seguridad. Imprímelos al 100%, sin “ajustar a la página”.
        </p>

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
              <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
                <a
                  className="dcafp-btn dcafp-btn--sm"
                  href={printUrl(p.id, link)}
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
