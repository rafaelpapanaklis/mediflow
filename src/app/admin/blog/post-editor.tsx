"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import toast from "react-hot-toast";
import { ArrowLeft, Eye, EyeOff, Plus, Trash2, Wand2 } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { BlogMarkdown } from "@/components/blog/markdown";
import { BLOG_CATEGORIES } from "@/lib/blog/categories";
import {
  BLOG_LIMITS,
  BLOG_STATUSES,
  BLOG_STATUS_LABELS,
  isValidBlogSlug,
  readingMinutesFor,
  slugifyTitle,
  type BlogFaqItem,
  type BlogPostDTO,
  type BlogStatus,
} from "@/lib/blog/types";
import "@/app/blog/blog.css";

// ─────────────────────────────────────────────────────────────────────────────
// Editor de artículo del admin — se usa igual para "Nuevo" y para editar.
//
// La vista previa monta el MISMO <BlogMarkdown> que la ficha pública, así que
// lo que se ve aquí es literalmente lo que verá Google (incluido que el HTML
// crudo no se renderiza).
//
// Las validaciones de aquí son de conveniencia: la autoridad es
// src/lib/blog/validate.ts en el server. Se replican para que el error salga
// antes de perder un viaje al servidor, no para sustituirlo.
// ─────────────────────────────────────────────────────────────────────────────

type FormState = {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  contentMd: string;
  category: string;
  cluster: string;
  tags: string;
  relatedSlugs: string;
  status: BlogStatus;
  scheduledAt: string; // datetime-local (hora del navegador)
  author: string;
  faq: BlogFaqItem[];
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO (UTC) → valor de <input type="datetime-local"> en hora local. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local (hora local) → ISO UTC para el API. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function initialForm(post: BlogPostDTO | null): FormState {
  return {
    slug: post?.slug ?? "",
    title: post?.title ?? "",
    metaTitle: post?.metaTitle ?? "",
    metaDescription: post?.metaDescription ?? "",
    excerpt: post?.excerpt ?? "",
    contentMd: post?.contentMd ?? "",
    category: post?.category ?? BLOG_CATEGORIES[0].slug,
    cluster: post?.cluster ?? "",
    tags: (post?.tags ?? []).join(", "),
    relatedSlugs: (post?.relatedSlugs ?? []).join(", "),
    status: post?.status ?? "draft",
    scheduledAt: toLocalInput(post?.scheduledAt ?? null),
    author: post?.author ?? "Equipo DaleControl",
    faq: post?.faq ?? [],
  };
}

/** Contador de caracteres con semáforo contra un rango objetivo. */
function Counter({ value, min, max }: { value: number; min?: number; max: number }) {
  const tooShort = typeof min === "number" && value > 0 && value < min;
  const tooLong = value > max;
  const color = tooLong || tooShort ? "var(--danger, #dc2626)" : "var(--text-3)";
  return (
    <span style={{ fontSize: 11, color, fontVariantNumeric: "tabular-nums" }}>
      {value}
      {typeof min === "number" ? `/${min}–${max}` : `/${max}`}
    </span>
  );
}

export function PostEditor({ post }: { post: BlogPostDTO | null }) {
  const router = useRouter();
  const isNew = !post;
  const [form, setForm] = useState<FormState>(() => initialForm(post));
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const minutes = useMemo(() => readingMinutesFor(form.contentMd), [form.contentMd]);
  const slugOk = form.slug === "" || isValidBlogSlug(form.slug);

  function addFaq() {
    setForm((f) => ({ ...f, faq: f.faq.concat([{ q: "", a: "" }]) }));
  }
  function updateFaq(index: number, patch: Partial<BlogFaqItem>) {
    setForm((f) => ({
      ...f,
      faq: f.faq.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }
  function removeFaq(index: number) {
    setForm((f) => ({ ...f, faq: f.faq.filter((_, i) => i !== index) }));
  }

  /** Chequeos rápidos antes de pegarle al API (el server revalida todo). */
  function clientError(): string | null {
    if (!form.title.trim()) return "El título es obligatorio.";
    if (!form.slug.trim()) return "El slug es obligatorio.";
    if (!isValidBlogSlug(form.slug.trim())) {
      return `Slug inválido: sólo minúsculas, números y guiones simples (máx ${BLOG_LIMITS.slug}).`;
    }
    if (!form.metaTitle.trim()) return "El meta title es obligatorio.";
    if (form.metaTitle.trim().length > BLOG_LIMITS.metaTitle) {
      return `El meta title excede ${BLOG_LIMITS.metaTitle} caracteres.`;
    }
    const md = form.metaDescription.trim();
    if (!md) return "La meta description es obligatoria.";
    if (md.length < BLOG_LIMITS.metaDescriptionMin || md.length > BLOG_LIMITS.metaDescriptionMax) {
      return `La meta description tiene ${md.length} caracteres (debe ser ${BLOG_LIMITS.metaDescriptionMin}–${BLOG_LIMITS.metaDescriptionMax}).`;
    }
    if (!form.excerpt.trim()) return "El extracto es obligatorio.";
    if (!form.contentMd.trim()) return "El contenido en markdown es obligatorio.";
    if (form.status === "scheduled" && !form.scheduledAt) {
      return "Un artículo programado necesita fecha de programación.";
    }
    return null;
  }

  async function save() {
    const err = clientError();
    if (err) {
      toast.error(err);
      return;
    }

    const payload = {
      slug: form.slug.trim(),
      title: form.title.trim(),
      metaTitle: form.metaTitle.trim(),
      metaDescription: form.metaDescription.trim(),
      excerpt: form.excerpt.trim(),
      contentMd: form.contentMd,
      category: form.category,
      cluster: form.cluster.trim() || null,
      tags: splitList(form.tags),
      relatedSlugs: splitList(form.relatedSlugs),
      faq: form.faq.filter((f) => f.q.trim() && f.a.trim()),
      status: form.status,
      scheduledAt: fromLocalInput(form.scheduledAt),
      author: form.author.trim(),
    };

    setSaving(true);
    try {
      const res = await fetch(isNew ? "/api/admin/blog" : `/api/admin/blog/${post!.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "No se pudo guardar");
      }
      const saved: BlogPostDTO = await res.json();
      toast.success(isNew ? "Artículo creado" : "Cambios guardados");
      if (isNew) {
        router.push(`/admin/blog/${saved.id}`);
      } else {
        router.refresh();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <Link
            href="/admin/blog"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              color: "var(--text-3)",
              textDecoration: "none",
              marginBottom: 8,
            }}
          >
            <ArrowLeft size={13} /> Volver al blog
          </Link>
          <h1
            style={{
              fontSize: 22,
              letterSpacing: "-0.02em",
              color: "var(--text-1)",
              fontWeight: 600,
              margin: 0,
            }}
          >
            {isNew ? "Nuevo artículo" : form.title || "Editar artículo"}
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            {minutes} min de lectura · {form.contentMd.trim().split(/\s+/).filter(Boolean).length}{" "}
            palabras
            {!isNew && post?.status === "published" && post.slug ? (
              <>
                {" · "}
                <a
                  href={`/blog/${post.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--text-2)" }}
                >
                  Ver publicado ↗
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BadgeNew tone={form.status === "published" ? "success" : "neutral"} dot>
            {BLOG_STATUS_LABELS[form.status]}
          </BadgeNew>
          <ButtonNew
            variant="ghost"
            icon={showPreview ? <EyeOff size={14} /> : <Eye size={14} />}
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? "Ocultar vista previa" : "Vista previa"}
          </ButtonNew>
          <ButtonNew variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : isNew ? "Crear artículo" : "Guardar cambios"}
          </ButtonNew>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* ── Básicos ── */}
        <CardNew title="Contenido">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field-new">
              <label className="field-new__label">
                Título <span className="req">*</span>
              </label>
              <input
                className="input-new"
                value={form.title}
                maxLength={BLOG_LIMITS.title}
                placeholder="Cómo reducir las ausencias con recordatorios por WhatsApp"
                onChange={(e) => set("title", e.target.value)}
              />
            </div>

            <div className="field-new">
              <label
                className="field-new__label"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span>
                  Slug <span className="req">*</span>
                </span>
                <button
                  type="button"
                  className="btn-new btn-new--ghost btn-new--sm"
                  onClick={() => set("slug", slugifyTitle(form.title))}
                  disabled={!form.title.trim()}
                >
                  <Wand2 size={12} /> Generar del título
                </button>
              </label>
              <input
                className="input-new mono"
                value={form.slug}
                maxLength={BLOG_LIMITS.slug}
                placeholder="recordatorios-whatsapp-citas-dentales"
                onChange={(e) => set("slug", e.target.value)}
                style={!slugOk ? { borderColor: "var(--danger, #dc2626)" } : undefined}
              />
              <span style={{ fontSize: 11, color: slugOk ? "var(--text-3)" : "var(--danger, #dc2626)" }}>
                {slugOk
                  ? `URL pública: /blog/${form.slug || "…"}`
                  : "Sólo minúsculas, números y guiones simples."}
              </span>
            </div>

            <div className="field-new">
              <label
                className="field-new__label"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span>
                  Extracto <span className="req">*</span>
                </span>
                <Counter value={form.excerpt.trim().length} max={BLOG_LIMITS.excerpt} />
              </label>
              <textarea
                rows={2}
                className="input-new"
                value={form.excerpt}
                placeholder="Una o dos frases que resumen el artículo. Se muestra en las tarjetas del índice."
                onChange={(e) => set("excerpt", e.target.value)}
              />
            </div>

            <div className="field-new">
              <label
                className="field-new__label"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span>
                  Contenido (markdown) <span className="req">*</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                  Markdown puro — el HTML crudo no se renderiza
                </span>
              </label>
              <textarea
                rows={showPreview ? 14 : 24}
                className="input-new mono"
                value={form.contentMd}
                placeholder={"## Subtítulo\n\nTexto del artículo…\n\n- Punto uno\n- Punto dos"}
                onChange={(e) => set("contentMd", e.target.value)}
                style={{ fontSize: 13, lineHeight: 1.6, resize: "vertical" }}
              />
            </div>

            {showPreview && (
              <div>
                <div className="form-section__title">
                  Vista previa
                  <span className="form-section__rule" />
                </div>
                <div className="blog-preview-surface">
                  <BlogMarkdown content={form.contentMd} />
                </div>
              </div>
            )}
          </div>
        </CardNew>

        {/* ── SEO ── */}
        <CardNew title="SEO" sub="Lo que ve Google en los resultados de búsqueda.">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="field-new">
              <label
                className="field-new__label"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span>
                  Meta title <span className="req">*</span>
                </span>
                <Counter value={form.metaTitle.trim().length} max={BLOG_LIMITS.metaTitle} />
              </label>
              <input
                className="input-new"
                value={form.metaTitle}
                placeholder="Recordatorios por WhatsApp para clínicas dentales"
                onChange={(e) => set("metaTitle", e.target.value)}
              />
            </div>

            <div className="field-new">
              <label
                className="field-new__label"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
              >
                <span>
                  Meta description <span className="req">*</span>
                </span>
                <Counter
                  value={form.metaDescription.trim().length}
                  min={BLOG_LIMITS.metaDescriptionMin}
                  max={BLOG_LIMITS.metaDescriptionMax}
                />
              </label>
              <textarea
                rows={3}
                className="input-new"
                value={form.metaDescription}
                placeholder="Entre 140 y 160 caracteres."
                onChange={(e) => set("metaDescription", e.target.value)}
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 220px), 1fr))",
                gap: 12,
              }}
            >
              <div className="field-new">
                <label className="field-new__label">
                  Categoría <span className="req">*</span>
                </label>
                <select
                  className="input-new"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  {BLOG_CATEGORIES.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-new">
                <label className="field-new__label">Cluster</label>
                <input
                  className="input-new mono"
                  value={form.cluster}
                  maxLength={BLOG_LIMITS.cluster}
                  placeholder="whatsapp-clinicas"
                  onChange={(e) => set("cluster", e.target.value)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Autor</label>
                <input
                  className="input-new"
                  value={form.author}
                  maxLength={BLOG_LIMITS.author}
                  onChange={(e) => set("author", e.target.value)}
                />
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
                gap: 12,
              }}
            >
              <div className="field-new">
                <label className="field-new__label">Tags (separados por coma)</label>
                <input
                  className="input-new"
                  value={form.tags}
                  placeholder="recordatorios, no-shows"
                  onChange={(e) => set("tags", e.target.value)}
                />
              </div>
              <div className="field-new">
                <label className="field-new__label">Slugs relacionados (separados por coma)</label>
                <input
                  className="input-new mono"
                  value={form.relatedSlugs}
                  placeholder="otro-slug, un-tercero"
                  onChange={(e) => set("relatedSlugs", e.target.value)}
                />
              </div>
            </div>
          </div>
        </CardNew>

        {/* ── FAQ ── */}
        <CardNew
          title="Preguntas frecuentes"
          sub="Se muestran como acordeón al final y generan el rich result FAQPage."
          action={
            <ButtonNew size="sm" variant="ghost" icon={<Plus size={13} />} onClick={addFaq}>
              Añadir
            </ButtonNew>
          }
        >
          {form.faq.length === 0 ? (
            <div style={{ padding: "18px 0", color: "var(--text-3)", fontSize: 13 }}>
              Sin preguntas. El artículo se publica igual (el JSON-LD de FAQ sólo aparece si hay).
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {form.faq.map((item, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: 12,
                    border: "1px solid var(--border-soft)",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      className="input-new"
                      value={item.q}
                      maxLength={BLOG_LIMITS.faqQuestion}
                      placeholder="Pregunta"
                      onChange={(e) => updateFaq(i, { q: e.target.value })}
                    />
                    <textarea
                      rows={2}
                      className="input-new"
                      value={item.a}
                      maxLength={BLOG_LIMITS.faqAnswer}
                      placeholder="Respuesta"
                      onChange={(e) => updateFaq(i, { a: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    className="btn-new btn-new--ghost btn-new--sm"
                    onClick={() => removeFaq(i)}
                    aria-label="Quitar pregunta"
                    style={{ color: "var(--danger)" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardNew>

        {/* ── Publicación ── */}
        <CardNew title="Publicación">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
              gap: 12,
            }}
          >
            <div className="field-new">
              <label className="field-new__label">Estado</label>
              <select
                className="input-new"
                value={form.status}
                onChange={(e) => set("status", e.target.value as BlogStatus)}
              >
                {BLOG_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {BLOG_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field-new">
              <label className="field-new__label">
                Programado para {form.status === "scheduled" && <span className="req">*</span>}
              </label>
              <input
                type="datetime-local"
                className="input-new"
                value={form.scheduledAt}
                onChange={(e) => set("scheduledAt", e.target.value)}
              />
              <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                Hora de tu navegador. El cron publica una vez al día a las 13:00 UTC.
              </span>
            </div>
            {post?.publishedAt && (
              <div className="field-new">
                <label className="field-new__label">Publicado</label>
                <div style={{ fontSize: 13, color: "var(--text-2)", paddingTop: 8 }}>
                  {new Date(post.publishedAt).toLocaleString("es-MX")}
                </div>
              </div>
            )}
          </div>
        </CardNew>
      </div>
    </div>
  );
}
