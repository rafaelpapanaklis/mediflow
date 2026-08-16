"use client";

// Kit de marketing: logo descargable + material visual con la marca del
// afiliado (imágenes para redes y PDF para imprimir, en marketing-visuals.tsx)
// + copys listos para WhatsApp/redes con botón copiar + pitch de objeciones
// comunes. El contenido de texto es estático y sale de
// src/lib/affiliates-marketing-content.ts ({tu_link} se reemplaza con el
// link real del afiliado al copiar/mostrar); lo visual se genera en el
// servidor, que es donde vive la sesión.
//
// Estilo: lenguaje del panel (src/app/afiliados/panel.css). Cada bloque abre
// con un `Eyebrow` (el "COMISIÓN MENSUAL" del diseño), los copys viven en
// superficies anidadas y todo lo que se pulsa es `dcafp-btn`. Confirmaciones
// con el toast del panel; los errores siguen en react-hot-toast.
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check, ChevronDown, Download, MessageCircleQuestion, Palette, Share2 } from "lucide-react";
import { EmptyState, SectionEyebrow } from "@/components/afiliados/ui/panel-ui";
import { showPanelToast } from "@/components/afiliados/ui/panel-toast";
import { MarketingVisuals, type QrLinkOption } from "@/components/afiliados/tools/marketing-visuals";
import {
  MARKETING_COPYS,
  OBJECTION_PITCHES,
  VERTICAL_LABELS,
  fillTemplate,
  type MarketingVertical,
} from "@/lib/affiliates-marketing-content";

const LOGOS = [
  { file: "/brand/dalecontrol-logo-dark.svg", label: "Logo para fondos oscuros" },
  { file: "/brand/dalecontrol-logo-light.svg", label: "Logo para fondos claros" },
];

// Superficie anidada de cada copy: el mismo gris de .dcafp-planbox.
const copyCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
  padding: 14,
  borderRadius: "var(--dcafp-r-box)",
  background: "var(--dcafp-surface-2)",
  border: "1px solid var(--dcafp-line-nested)",
};

export function MarketingKit({
  partnerUrl, // link de la página de socio (el que conviene compartir)
  qrLinks = [], // campañas del afiliado que pueden ir en el QR del material
}: {
  partnerUrl: string;
  qrLinks?: QrLinkOption[];
}) {
  const [vertical, setVertical] = useState<MarketingVertical | "all">("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openPitch, setOpenPitch] = useState<string | null>(null);

  const chips: { key: MarketingVertical | "all"; label: string }[] = [
    { key: "all", label: "Todos" },
    ...(Object.keys(VERTICAL_LABELS) as MarketingVertical[]).map((k) => ({
      key: k,
      label: VERTICAL_LABELS[k],
    })),
  ];

  const copys =
    vertical === "all" ? MARKETING_COPYS : MARKETING_COPYS.filter((c) => c.vertical === vertical);

  async function copyText(id: string, text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      showPanelToast(okMsg);
      setTimeout(() => setCopiedId((k) => (k === id ? null : k)), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
      {/* Logo DaleControl */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <SectionEyebrow icon={<Palette size={14} />} text="Logo DaleControl" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
            gap: 12,
          }}
        >
          {LOGOS.map((logo) => {
            // El SVG "-dark" es el logo BLANCO (para fondos oscuros): sobre el
            // gris claro del panel sería invisible, así que su mosaico va en
            // tinta. El "-light" es el de color y va sobre blanco.
            const darkTile = logo.file.includes("-dark");
            return (
              <div key={logo.file} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <div
                  style={{
                    height: 76,
                    borderRadius: "var(--dcafp-r-box)",
                    border: "1px solid var(--dcafp-line)",
                    background: darkTile ? "var(--dcafp-ink)" : "var(--dcafp-surface)",
                    display: "grid",
                    placeItems: "center",
                    padding: 12,
                  }}
                >
                  <img
                    src={logo.file}
                    alt={logo.label}
                    style={{ height: 36, maxWidth: "100%", objectFit: "contain" }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                    minWidth: 0,
                  }}
                >
                  <span className="dcafp-hint">{logo.label}</span>
                  <a
                    href={logo.file}
                    download
                    className="dcafp-btn dcafp-btn--sm"
                    aria-label={`Descargar el ${logo.label.toLowerCase()} en SVG`}
                  >
                    <Download size={14} aria-hidden />
                    Descargar SVG
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Material visual con su marca (imágenes para redes + PDF imprimibles) */}
      <MarketingVisuals qrLinks={qrLinks} />

      {/* Copys listos para compartir */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        <SectionEyebrow icon={<Share2 size={14} />} text="Copys listos para compartir" />
        {MARKETING_COPYS.length === 0 ? (
          <EmptyState icon={<Share2 size={22} />} title="Aún no hay copys disponibles">
            Muy pronto encontrarás aquí mensajes listos para compartir.
          </EmptyState>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {chips.map((chip) => {
                const active = vertical === chip.key;
                return (
                  <button
                    key={chip.key}
                    type="button"
                    onClick={() => setVertical(chip.key)}
                    aria-pressed={active}
                    className={`dcafp-btn dcafp-btn--sm${active ? " dcafp-btn--outline" : ""}`}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
            {copys.length === 0 ? (
              <EmptyState icon={<Share2 size={22} />} title="No hay copys para esta categoría todavía" />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
                  gap: 12,
                }}
              >
                {copys.map((c) => {
                  const finalText = fillTemplate(c.text, { tu_link: partnerUrl });
                  const id = `copy-${c.id}`;
                  return (
                    <div key={c.id} style={copyCardStyle}>
                      <span style={{ fontSize: 13.5, fontWeight: 750, color: "var(--dcafp-ink)" }}>
                        {c.title}
                      </span>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12.5,
                          color: "var(--dcafp-ink-2)",
                          lineHeight: 1.55,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {finalText}
                      </p>
                      <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end" }}>
                        <CopyMiniButton
                          copied={copiedId === id}
                          onClick={() => copyText(id, finalText, "Texto copiado")}
                          ariaLabel={`Copiar el copy "${c.title}"`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>

      {/* Respuestas a objeciones comunes */}
      <section style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <SectionEyebrow icon={<MessageCircleQuestion size={14} />} text="Respuestas a objeciones comunes" />
        {OBJECTION_PITCHES.length === 0 ? (
          <EmptyState icon={<MessageCircleQuestion size={22} />} title="Aún no hay respuestas a objeciones">
            Muy pronto tendrás argumentos listos para usar.
          </EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {OBJECTION_PITCHES.map((p, i) => {
              const open = openPitch === p.id;
              const id = `pitch-${p.id}`;
              const answer = fillTemplate(p.answer, { tu_link: partnerUrl });
              return (
                <div
                  key={p.id}
                  style={{
                    borderBottom:
                      i === OBJECTION_PITCHES.length - 1
                        ? "none"
                        : "1px solid var(--dcafp-line-soft)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenPitch(open ? null : p.id)}
                    aria-expanded={open}
                    aria-controls={`${id}-panel`}
                    style={{
                      width: "100%",
                      minHeight: "var(--dcafp-tap)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "10px 2px",
                      background: "none",
                      border: "none",
                      textAlign: "left",
                      color: "var(--dcafp-ink)",
                      fontSize: 13.5,
                      fontWeight: 700,
                    }}
                  >
                    <span style={{ minWidth: 0 }}>{p.objection}</span>
                    <ChevronDown
                      size={16}
                      aria-hidden
                      style={{
                        flexShrink: 0,
                        color: "var(--dcafp-ink-3)",
                        transform: open ? "rotate(180deg)" : "none",
                        transition: "transform .15s",
                      }}
                    />
                  </button>
                  {open && (
                    <div
                      id={`${id}-panel`}
                      style={{
                        padding: "0 2px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12.5,
                          color: "var(--dcafp-ink-2)",
                          lineHeight: 1.55,
                          overflowWrap: "anywhere",
                        }}
                      >
                        {answer}
                      </p>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <CopyMiniButton
                          copied={copiedId === id}
                          onClick={() => copyText(id, answer, "Respuesta copiada")}
                          label="Copiar respuesta"
                          ariaLabel={`Copiar la respuesta a "${p.objection}"`}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// Tinte verde de los 2 s de "Copiado": estado efímero, no patrón.
const copiedBtnStyle: React.CSSProperties = {
  background: "var(--dcafp-ok-bg)",
  borderColor: "var(--dcafp-ok-line)",
  color: "var(--dcafp-ok-ink)",
};

function CopyMiniButton({
  copied,
  onClick,
  label = "Copiar",
  ariaLabel,
}: {
  copied: boolean;
  onClick: () => void;
  label?: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="dcafp-btn dcafp-btn--sm dcafp-btn--outline"
      style={copied ? copiedBtnStyle : undefined}
      aria-label={ariaLabel}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? "Copiado" : label}
    </button>
  );
}
