"use client";

// Plantillas de prospección (email y WhatsApp) con variables
// {nombre_clinica} y {tu_link}. El afiliado escribe el nombre de la clínica
// una vez y copia cada plantilla ya personalizada.
//
// Estilo: lenguaje del panel (src/app/afiliados/panel.css) — `dcafp-label` +
// `dcafp-input` para el campo, `dcafp-btn` para el conmutador de canal y para
// copiar, y superficies anidadas para cada plantilla. Confirmaciones con el
// toast del panel; los errores siguen en react-hot-toast.
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check, Mail, MessageCircle } from "lucide-react";
import { showPanelToast } from "@/components/afiliados/ui/panel-toast";
import {
  PROSPECT_TEMPLATES,
  fillTemplate,
  type ProspectTemplate,
} from "@/lib/affiliates-marketing-content";

const CHANNEL_TABS = [
  { key: "email" as const, label: "Email", icon: Mail },
  { key: "whatsapp" as const, label: "WhatsApp", icon: MessageCircle },
];

// Tinte verde de los 2 s de "Copiado": estado efímero, no patrón.
const copiedBtnStyle: React.CSSProperties = {
  background: "var(--dcafp-ok-bg)",
  borderColor: "var(--dcafp-ok-line)",
  color: "var(--dcafp-ok-ink)",
};

// Resalta {nombre_clinica} pendiente (sin reemplazar) dentro del texto ya
// procesado por fillTemplate.
function renderWithPendingVar(text: string) {
  const parts = text.split(/(\{nombre_clinica\})/g);
  return parts.map((part, i) =>
    part === "{nombre_clinica}" ? (
      <span
        key={i}
        style={{
          background: "var(--dcafp-brand-75)",
          color: "var(--dcafp-brand-deep)",
          borderRadius: 4,
          padding: "0 4px",
          fontWeight: 700,
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
      showPanelToast("Plantilla copiada");
      setTimeout(() => setCopiedId((id) => (id === t.id ? null : id)), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {/* Nombre de la clínica */}
      <div style={{ minWidth: 0 }}>
        <label htmlFor="prospect-clinic-name" className="dcafp-label">
          Nombre de la clínica a la que escribes
        </label>
        <input
          id="prospect-clinic-name"
          value={clinicName}
          onChange={(e) => setClinicName(e.target.value)}
          placeholder="Clínica Sonríe"
          className="dcafp-input"
          style={{ maxWidth: 380 }}
        />
        <p className="dcafp-hint" style={{ marginTop: 6 }}>
          Las plantillas se personalizan al instante. Si lo dejas vacío,{" "}
          <span className="dcafp-mono">{"{nombre_clinica}"}</span> se copia tal cual para editarlo
          después.
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
              aria-pressed={active}
              className={`dcafp-btn dcafp-btn--sm${active ? " dcafp-btn--outline" : ""}`}
            >
              <Icon size={15} aria-hidden />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tarjetas de plantillas */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))",
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
                minWidth: 0,
                padding: 14,
                borderRadius: "var(--dcafp-r-box)",
                border: "1px solid var(--dcafp-line)",
              }}
            >
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
                <span style={{ fontSize: 13.5, fontWeight: 750, color: "var(--dcafp-ink)", minWidth: 0 }}>
                  {t.title}
                </span>
                <button
                  type="button"
                  onClick={() => copy(t)}
                  className="dcafp-btn dcafp-btn--sm dcafp-btn--outline"
                  style={copied ? copiedBtnStyle : undefined}
                  aria-label={`Copiar la plantilla "${t.title}"`}
                >
                  {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
              {filledSubject != null && (
                <div style={{ fontSize: 12.5, color: "var(--dcafp-ink-2)", lineHeight: 1.5, overflowWrap: "anywhere" }}>
                  <span style={{ fontWeight: 700, color: "var(--dcafp-ink-3)" }}>Asunto: </span>
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
                  color: "var(--dcafp-ink-2)",
                  background: "var(--dcafp-surface-2)",
                  border: "1px solid var(--dcafp-line-nested)",
                  borderRadius: "var(--dcafp-r-el)",
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
