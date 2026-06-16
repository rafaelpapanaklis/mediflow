"use client";

// Galería de la Biblioteca de Marketing (WS-MKT-T6). Fusiona el set integrado
// (SEED_TEMPLATES) con las plantillas que la clínica guardó en DB y deja
// filtrar por tipo (ideas/captions/campañas/briefs), por especialidad y por
// texto. Cada plantilla se puede Copiar o llevar al Composer con ?caption=.

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  Copy,
  Check,
  ArrowRight,
  Lightbulb,
  Type,
  Megaphone,
  Image as ImageIcon,
  Library,
  BadgeCheck,
  X,
  type LucideIcon,
} from "lucide-react";
import { EmptyStateNew } from "@/components/dashboard/empty-state";
import {
  SEED_TEMPLATES,
  TEMPLATE_KINDS,
  templateKindMeta,
  type TemplateKind,
} from "@/lib/marketing/seed-templates";
import { DIRECTORY_CATEGORIES, getCategoryByEnum } from "@/lib/directory/types";

export interface ClinicTemplate {
  id: string;
  kind: string;
  specialty: string | null;
  title: string;
  body: string;
  tags: string[];
}

interface LibTemplate extends ClinicTemplate {
  source: "seed" | "clinic";
}

const KIND_ICONS: Record<string, LucideIcon> = {
  IDEA: Lightbulb,
  CAPTION: Type,
  CAMPAIGN: Megaphone,
  IMAGE_BRIEF: ImageIcon,
};

const ALL = "ALL";
const UNIVERSAL = "UNIVERSAL";

export function MarketingLibraryClient({
  clinicCategory,
  clinicTemplates,
}: {
  clinicCategory: string;
  clinicTemplates: ClinicTemplate[];
}) {
  const all: LibTemplate[] = useMemo(
    () => [
      ...SEED_TEMPLATES.map((t) => ({ ...t, source: "seed" as const })),
      ...clinicTemplates.map((t) => ({ ...t, source: "clinic" as const })),
    ],
    [clinicTemplates],
  );

  const knownCategory = DIRECTORY_CATEGORIES.some((c) => c.category === clinicCategory);

  const [activeKind, setActiveKind] = useState<string>(ALL);
  const [specialty, setSpecialty] = useState<string>(knownCategory ? clinicCategory : ALL);
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((t) => {
      if (activeKind !== ALL && t.kind !== activeKind) return false;
      if (specialty === UNIVERSAL) {
        if (t.specialty !== null) return false;
      } else if (specialty !== ALL) {
        // Una especialidad concreta incluye también las universales.
        if (t.specialty !== specialty && t.specialty !== null) return false;
      }
      if (q) {
        const hay = `${t.title} ${t.body} ${t.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [all, activeKind, specialty, query]);

  async function copy(t: LibTemplate) {
    const ok = await copyToClipboard(t.body);
    if (ok) {
      setCopiedId(t.id);
      setTimeout(() => setCopiedId((c) => (c === t.id ? null : c)), 1600);
    }
  }

  const hasFilters = activeKind !== ALL || specialty !== (knownCategory ? clinicCategory : ALL) || query.trim() !== "";

  function resetFilters() {
    setActiveKind(ALL);
    setSpecialty(knownCategory ? clinicCategory : ALL);
    setQuery("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-2)", maxWidth: 640 }}>
        Plantillas listas para inspirarte. Cópialas o llévalas al editor y publica en minutos. Las que
        guardes desde el Estudio IA aparecerán aquí, en tu clínica.
      </p>

      {/* Toolbar: tabs de tipo + especialidad + búsqueda */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {/* Tabs de tipo */}
        <div
          role="tablist"
          aria-label="Tipo de plantilla"
          style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
        >
          <KindTab label="Todas" active={activeKind === ALL} onClick={() => setActiveKind(ALL)} />
          {TEMPLATE_KINDS.map((k) => (
            <KindTab
              key={k.id}
              label={k.label}
              icon={KIND_ICONS[k.id]}
              active={activeKind === k.id}
              onClick={() => setActiveKind(k.id)}
            />
          ))}
        </div>

        {/* Especialidad + búsqueda */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <select
            aria-label="Filtrar por especialidad"
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            style={{
              height: 36,
              padding: "0 30px 0 12px",
              borderRadius: 9,
              border: "1px solid var(--border-strong, var(--border-soft))",
              background: "var(--bg-elev)",
              color: "var(--text-1)",
              fontSize: 13,
              fontFamily: "inherit",
              cursor: "pointer",
              maxWidth: "100%",
            }}
          >
            <option value={ALL}>Todas las especialidades</option>
            <option value={UNIVERSAL}>Generales (cualquier clínica)</option>
            {DIRECTORY_CATEGORIES.map((c) => (
              <option key={c.category} value={c.category}>
                {c.label}
              </option>
            ))}
          </select>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              height: 36,
              padding: "0 12px",
              borderRadius: 9,
              border: "1px solid var(--border-strong, var(--border-soft))",
              background: "var(--bg-elev)",
              flex: "1 1 200px",
              minWidth: 160,
            }}
          >
            <Search size={15} aria-hidden style={{ color: "var(--text-3)", flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por palabra o tema…"
              aria-label="Buscar plantillas"
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                color: "var(--text-1)",
                fontSize: 13,
                fontFamily: "inherit",
                width: "100%",
              }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Limpiar búsqueda"
                style={{ display: "grid", placeItems: "center", border: "none", background: "transparent", cursor: "pointer", color: "var(--text-3)", padding: 0, width: 28, height: 28, flexShrink: 0, marginRight: -4 }}
              >
                <X size={14} />
              </button>
            )}
          </div>

          <span style={{ fontSize: 12, color: "var(--text-3)", whiteSpace: "nowrap" }}>
            {filtered.length} {filtered.length === 1 ? "plantilla" : "plantillas"}
          </span>
        </div>
      </div>

      {/* Galería */}
      {filtered.length === 0 ? (
        <div style={{ border: "1px dashed var(--border-soft)", borderRadius: 14, background: "var(--bg-elev)" }}>
          <EmptyStateNew
            icon={Library}
            title="No hay plantillas con estos filtros"
            description="Prueba con otra especialidad, cambia el tipo o limpia la búsqueda."
            tone="neutral"
            size="md"
            primaryCta={hasFilters ? { label: "Quitar filtros", onClick: resetFilters, icon: X } : undefined}
          />
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(290px, 100%), 1fr))",
            gap: 14,
            alignItems: "start",
          }}
        >
          {filtered.map((t) => (
            <TemplateCard
              key={t.id}
              tpl={t}
              copied={copiedId === t.id}
              onCopy={() => copy(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────────────────────────────

function KindTab({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string;
  icon?: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 13px",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        whiteSpace: "nowrap",
        color: active ? "var(--brand)" : "var(--text-2)",
        background: active ? "var(--brand-softer)" : "var(--bg-elev)",
        border: `1px solid ${active ? "rgba(124,58,237,0.25)" : "var(--border-soft)"}`,
        borderRadius: 9,
        transition: "background 0.12s, color 0.12s, border-color 0.12s",
        fontFamily: "inherit",
      }}
    >
      {Icon && <Icon size={14} aria-hidden style={{ flexShrink: 0 }} />}
      {label}
    </button>
  );
}

function TemplateCard({
  tpl,
  copied,
  onCopy,
}: {
  tpl: LibTemplate;
  copied: boolean;
  onCopy: () => void;
}) {
  const KindIcon = KIND_ICONS[tpl.kind] ?? Lightbulb;
  const kindLabel = templateKindMeta(tpl.kind as TemplateKind).label;
  const specialtyLabel = tpl.specialty ? getCategoryByEnum(tpl.specialty)?.label ?? null : null;
  const composerHref = `/dashboard/marketing/composer?caption=${encodeURIComponent(tpl.body)}`;

  return (
    <article
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 16,
        borderRadius: 14,
        background: "var(--bg-elev)",
        border: "1px solid var(--border-soft)",
        minWidth: 0,
      }}
    >
      {/* Cabecera: tipo + badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            fontWeight: 600,
            color: "var(--brand)",
            background: "var(--brand-softer)",
            border: "1px solid rgba(124,58,237,0.18)",
            borderRadius: 999,
            padding: "3px 9px",
          }}
        >
          <KindIcon size={12} aria-hidden />
          {kindLabel}
        </span>
        {specialtyLabel && (
          <span style={{ fontSize: 11, color: "var(--text-3)", border: "1px solid var(--border-soft)", borderRadius: 999, padding: "3px 9px" }}>
            {specialtyLabel}
          </span>
        )}
        {tpl.source === "clinic" && (
          <span
            title="Plantilla guardada por tu clínica"
            style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--success)" }}
          >
            <BadgeCheck size={13} aria-hidden /> Tuya
          </span>
        )}
      </div>

      {/* Título */}
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em", overflowWrap: "anywhere" }}>
        {tpl.title}
      </h3>

      {/* Cuerpo */}
      <p
        style={{
          margin: 0,
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--text-2)",
          whiteSpace: "pre-wrap",
          maxHeight: 168,
          overflow: "auto",
          paddingRight: 4,
        }}
      >
        {tpl.body}
      </p>

      {/* Tags */}
      {tpl.tags.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {tpl.tags.map((tag) => (
            <span key={tag} style={{ fontSize: 10.5, color: "var(--text-3)", background: "var(--bg-elev-2, rgba(127,127,127,0.06))", borderRadius: 6, padding: "2px 7px", overflowWrap: "anywhere", maxWidth: "100%" }}>
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Acciones */}
      <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 4 }}>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? `Texto de "${tpl.title}" copiado` : `Copiar texto de "${tpl.title}"`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            flex: 1,
            height: 34,
            borderRadius: 9,
            fontSize: 12.5,
            fontWeight: 500,
            cursor: "pointer",
            fontFamily: "inherit",
            background: copied ? "var(--success-soft)" : "var(--bg-elev)",
            color: copied ? "var(--success)" : "var(--text-1)",
            border: `1px solid ${copied ? "var(--success)" : "var(--border-strong, var(--border-soft))"}`,
            transition: "background 0.15s, color 0.15s, border-color 0.15s",
          }}
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          {copied ? "¡Copiado!" : "Copiar"}
        </button>
        <Link
          href={composerHref}
          aria-label={`Usar "${tpl.title}" en el Composer`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            flex: 1,
            height: 34,
            borderRadius: 9,
            fontSize: 12.5,
            fontWeight: 500,
            textDecoration: "none",
            whiteSpace: "nowrap",
            background: "var(--brand)",
            color: "#fff",
            border: "1px solid transparent",
            boxShadow: "0 0 0 1px rgba(124,58,237,0.4), 0 4px 14px -4px rgba(124,58,237,0.5)",
          }}
        >
          Usar en Composer
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Clipboard con fallback para contextos sin navigator.clipboard.
// ─────────────────────────────────────────────────────────────────────
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // cae al fallback
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
