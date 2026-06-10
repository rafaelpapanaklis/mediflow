"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check, Link2, UserPlus } from "lucide-react";

type LinkRow = {
  key: string;
  label: string;
  hint: string;
  url: string;
  icon: React.ComponentType<{ size?: number | string }>;
};

export function ReferralLinks({
  siteUrl,
  slug,
  referralCode,
}: {
  siteUrl: string;
  slug: string;
  referralCode: string;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const base = siteUrl.replace(/\/$/, "");
  const rows: LinkRow[] = [
    {
      key: "page",
      label: "Tu página de socio",
      hint: "Una landing de venta de DaleControl lista para compartir. Cada botón ya incluye tu código.",
      url: `${base}/socio/${slug}`,
      icon: Link2,
    },
    {
      key: "direct",
      label: "Enlace directo de registro",
      hint: "Lleva al alta de cuenta con tu referido ya aplicado.",
      url: `${base}/signup?ref=${referralCode}`,
      icon: UserPlus,
    },
  ];

  async function copy(row: LinkRow) {
    try {
      await navigator.clipboard.writeText(row.url);
      setCopiedKey(row.key);
      toast.success("Enlace copiado");
      setTimeout(() => setCopiedKey((k) => (k === row.key ? null : k)), 2000);
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {rows.map((row) => {
        const Icon = row.icon;
        const copied = copiedKey === row.key;
        return (
          <div key={row.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon size={14} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{row.label}</span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                readOnly
                value={row.url}
                onFocus={(e) => e.currentTarget.select()}
                className="mono"
                style={{
                  flex: 1,
                  minWidth: 0,
                  height: 40,
                  padding: "0 12px",
                  borderRadius: 10,
                  background: "var(--bg-elev-2)",
                  border: "1px solid var(--border-soft)",
                  color: "var(--text-2)",
                  fontSize: 12.5,
                  outline: "none",
                }}
              />
              <button
                type="button"
                onClick={() => copy(row)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 14px",
                  height: 40,
                  flexShrink: 0,
                  borderRadius: 10,
                  border: "1px solid var(--border-brand)",
                  background: copied ? "var(--success-soft, rgba(52,211,153,0.12))" : "var(--brand-soft)",
                  color: copied ? "var(--success)" : "var(--violet-400)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "all .15s",
                }}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, lineHeight: 1.45 }}>{row.hint}</p>
          </div>
        );
      })}
    </div>
  );
}
