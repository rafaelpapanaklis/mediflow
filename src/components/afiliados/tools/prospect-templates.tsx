"use client";

// Plantillas de prospección (email y WhatsApp) con variables
// {nombre_clinica} y {tu_link}. El afiliado escribe el nombre de la clínica
// una vez y copia cada plantilla ya personalizada. Estilo del panel.
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check, Mail, MessageCircle } from "lucide-react";
import {
  PROSPECT_TEMPLATES,
  fillTemplate,
  type ProspectTemplate,
} from "@/lib/affiliates-marketing-content";

const CHANNEL_TABS = [
  { key: "email" as const, label: "Email", icon: Mail },
  { key: "whatsapp" as const, label: "WhatsApp", icon: MessageCircle },
];

// Resalta {nombre_clinica} pendiente (sin reemplazar) dentro del texto ya
// procesado por fillTemplate.
function renderWithPendingVar(text: string) {
  const parts = text.split(/(\{nombre_clinica\})/g);
  return parts.map((part, i) =>
    part === "{nombre_clinica}" ? (
      <span
        key={i}
        style={{
          background: "var(--brand-soft)",
          color: "var(--violet-400)",
          borderRadius: 4,
          padding: "0 4px",
          fontWeight: 600,
        }}
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function ProspectTemplates({
  partnerUrl,
}: {
  partnerUrl: string;
}) {
  const [channel, setChannel] = useState<"email" | "whatsapp">("whatsapp");
  const [clinicName, setClinicName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Las variables no provistas (clínica vacía) se quedan literales.
  const vars = { tu_link: partnerUrl, nombre_clinica: clinicName.trim() };
  const templates = PROSPECT_TEMPLATES.filter((t) => t.channel === channel);

  async function copy(t: ProspectTemplate) {
    const body = fillTemplate(t.body, vars);
    const text =
      t.channel === "email" && t.subject
        ? `Asunto: ${fillTemplate(t.subject, vars)}\n\n${body}`
        : body;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(t.id);
      toast.success("Plantilla copiada");
      setTimeout(() => setCopiedId((id) => (id === t.id ? null : id)), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Nombre de la clínica */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label
          htmlFor="prospect-clinic-name"
          style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}
        >
          Nombre de la clínica a la que escribes
        </label>
        <input
          id="prospect-clinic-name"
          value={clinicName}
          onChange={(e) => setClinicName(e.target.value)}
          placeholder="Clínica Sonríe"
          style={{
            maxWidth: 380,
            height: 40,
            padding: "0 12px",
            borderRadius: 10,
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            color: "var(--text-1)",
            fontSize: 13,
            fontFamily: "inherit",
            outline: "none",
          }}
        />
        <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, lineHeight: 1.45 }}>
          Las plantillas se personalizan al instante. Si lo dejas vacío,{" "}
          <span className="mono">{"{nombre_clinica}"}</span> se copia tal cual para editarlo después.
        </p>
      </div>

      {/* Tabs Email / WhatsApp */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {CHANNEL_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = channel === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setChannel(tab.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 14px",
                borderRadius: 999,
                border: `1px solid ${active ? "var(--border-brand)" : "var(--border-soft)"}`,
                background: active ? "var(--brand-soft)" : "var(--bg-elev-2)",
                color: active ? "var(--violet-400)" : "var(--text-2)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all .15s",
              }}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tarjetas de plantillas */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
          gap: 14,
        }}
      >
        {templates.map((t) => {
          const copied = copiedId === t.id;
          const filledBody = fillTemplate(t.body, vars);
          const filledSubject = t.subject ? fillTemplate(t.subject, vars) : null;
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                padding: 14,
                borderRadius: 12,
                border: "1px solid var(--border-soft)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                  {t.title}
                </span>
                <button
                  type="button"
                  onClick={() => copy(t)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "0 12px",
                    height: 32,
                    flexShrink: 0,
                    borderRadius: 10,
                    border: "1px solid var(--border-brand)",
                    background: copied ? "var(--success-soft, rgba(52,211,153,0.12))" : "var(--brand-soft)",
                    color: copied ? "var(--success)" : "var(--violet-400)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    transition: "all .15s",
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              {filledSubject != null && (
                <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
                  <span style={{ fontWeight: 600, color: "var(--text-3)" }}>Asunto: </span>
                  {renderWithPendingVar(filledSubject)}
                </div>
              )}
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                  fontSize: 12.5,
                  lineHeight: 1.55,
                  color: "var(--text-2)",
                  background: "var(--bg-elev-2)",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 10,
                  padding: 12,
                  maxHeight: 260,
                  overflow: "auto",
                }}
              >
                {renderWithPendingVar(filledBody)}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
