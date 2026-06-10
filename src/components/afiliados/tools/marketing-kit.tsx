"use client";

// Kit de marketing: logo descargable + copys listos para WhatsApp/redes con
// botón copiar + pitch de objeciones comunes. Contenido estático de
// src/lib/affiliates-marketing-content.ts ({tu_link} se reemplaza con el
// link real del afiliado al copiar/mostrar). Estilo del panel (CSS vars).
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check, ChevronDown, Download, MessageCircleQuestion, Palette, Share2 } from "lucide-react";
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

export function MarketingKit({
  partnerUrl, // link de la página de socio (el que conviene compartir)
}: {
  partnerUrl: string;
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
      toast.success(okMsg);
      setTimeout(() => setCopiedId((k) => (k === id ? null : k)), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {/* Logo DaleControl */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionTitle icon={<Palette size={14} />} text="Logo DaleControl" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 240px), 1fr))",
            gap: 12,
          }}
        >
          {LOGOS.map((logo) => {
            const darkTile = logo.file.includes("-dark");
            return (
              <div key={logo.file} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div
                  style={{
                    height: 72,
                    borderRadius: 10,
                    border: "1px solid var(--border-soft)",
                    background: darkTile ? "var(--bg-elev-2)" : "#fff",
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
                  }}
                >
                  <span style={{ fontSize: 12, color: "var(--text-3)" }}>{logo.label}</span>
                  <a
                    href={logo.file}
                    download
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      height: 30,
                      padding: "0 10px",
                      flexShrink: 0,
                      borderRadius: 8,
                      border: "1px solid var(--border-soft)",
                      color: "var(--text-2)",
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: "none",
                      transition: "all .15s",
                    }}
                  >
                    <Download size={13} />
                    Descargar SVG
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Copys listos para compartir */}
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionTitle icon={<Share2 size={14} />} text="Copys listos para compartir" />
        {MARKETING_COPYS.length === 0 ? (
          <EmptyHint text="Aún no hay copys disponibles. Muy pronto encontrarás aquí mensajes listos para compartir." />
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
                    style={{
                      height: 30,
                      padding: "0 12px",
                      borderRadius: 999,
                      border: active ? "1px solid var(--border-brand)" : "1px solid var(--border-soft)",
                      background: active ? "var(--brand-soft)" : "transparent",
                      color: active ? "var(--violet-400)" : "var(--text-3)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      transition: "all .15s",
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
            {copys.length === 0 ? (
              <EmptyHint text="No hay copys para esta categoría todavía." />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))",
                  gap: 12,
                }}
              >
                {copys.map((c) => {
                  const finalText = fillTemplate(c.text, { tu_link: partnerUrl });
                  const id = `copy-${c.id}`;
                  return (
                    <div
                      key={c.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        padding: 14,
                        borderRadius: 12,
                        border: "1px solid var(--border-soft)",
                        background: "var(--bg-elev-2)",
                      }}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{c.title}</span>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12.5,
                          color: "var(--text-2)",
                          lineHeight: 1.5,
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
      <section style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <SectionTitle icon={<MessageCircleQuestion size={14} />} text="Respuestas a objeciones comunes" />
        {OBJECTION_PITCHES.length === 0 ? (
          <EmptyHint text="Aún no hay respuestas a objeciones. Muy pronto tendrás argumentos listos para usar." />
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
                      i === OBJECTION_PITCHES.length - 1 ? "none" : "1px solid var(--border-soft)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setOpenPitch(open ? null : p.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      padding: "11px 2px",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      textAlign: "left",
                      color: "var(--text-1)",
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: "inherit",
                    }}
                  >
                    <span>{p.objection}</span>
                    <ChevronDown
                      size={15}
                      style={{
                        flexShrink: 0,
                        color: "var(--text-3)",
                        transform: open ? "rotate(180deg)" : "none",
                        transition: "transform .15s",
                      }}
                    />
                  </button>
                  {open && (
                    <div
                      style={{
                        padding: "0 2px 12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontSize: 12.5,
                          color: "var(--text-2)",
                          lineHeight: 1.5,
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

function SectionTitle({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--violet-400)" }}>
      {icon}
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{text}</span>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "14px 12px",
        borderRadius: 10,
        border: "1px dashed var(--border-soft)",
        color: "var(--text-3)",
        fontSize: 12.5,
        lineHeight: 1.5,
        textAlign: "center",
      }}
    >
      {text}
    </div>
  );
}

function CopyMiniButton({
  copied,
  onClick,
  label = "Copiar",
}: {
  copied: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 10px",
        flexShrink: 0,
        borderRadius: 8,
        border: "1px solid var(--border-brand)",
        background: copied ? "var(--success-soft, rgba(52,211,153,0.12))" : "var(--brand-soft)",
        color: copied ? "var(--success)" : "var(--violet-400)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all .15s",
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copiado" : label}
    </button>
  );
}
