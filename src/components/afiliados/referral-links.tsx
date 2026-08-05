"use client";

// Tres enlaces, del más corto al más específico. El corto (/r/<código>) es el
// principal a compartir; los dos históricos SIGUEN aquí porque no son
// duplicados suyos: /socio/<slug> es una landing de venta con contenido propio
// (la que reparten el kit de marketing y las plantillas) y /signup?ref= entra
// directo al alta. Además muchos afiliados ya los tienen impresos o pegados en
// su bio: quitarlos de la pantalla no los desactivaría, solo dejaría al
// afiliado sin saber qué está circulando.
//
// El corto llega YA ARMADO por prop: link-url.ts —la fuente única de estas
// URLs— importa prisma y crypto, así que no puede cruzar al cliente.
import { useState } from "react";
import toast from "react-hot-toast";
import { Copy, Check, Link2, Globe, UserPlus } from "lucide-react";

type LinkRow = {
  key: string;
  label: string;
  hint: string;
  url: string;
  icon: React.ComponentType<{ size?: number | string }>;
  badge?: string; // etiqueta corta junto al nombre ("Recomendado")
};

export function ReferralLinks({
  siteUrl,
  slug,
  referralCode,
  shortUrl,
}: {
  siteUrl: string;
  slug: string;
  referralCode: string;
  shortUrl: string; // /r/<referralCode>, resuelto en el servidor
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const base = siteUrl.replace(/\/$/, "");
  const rows: LinkRow[] = [
    {
      key: "short",
      label: "Tu link corto",
      hint: "El más fácil de compartir y de dictar. Lleva a DaleControl y deja tu referido guardado 90 días, aunque la clínica se registre días después.",
      url: shortUrl,
      icon: Link2,
      badge: "Recomendado",
    },
    {
      key: "page",
      label: "Tu página de socio",
      hint: "Una landing de venta de DaleControl lista para compartir. Cada botón ya incluye tu código.",
      url: `${base}/socio/${slug}`,
      icon: Globe,
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Icon size={14} />
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{row.label}</span>
              {row.badge && (
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: "var(--brand-soft)",
                    border: "1px solid var(--border-brand)",
                    color: "var(--violet-400)",
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.badge}
                </span>
              )}
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
