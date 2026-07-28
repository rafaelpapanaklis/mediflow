"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Archive, ExternalLink, Pencil, Plus, Search, Send, Trash2 } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { BLOG_CATEGORIES, blogCategoryLabel } from "@/lib/blog/categories";
import {
  BLOG_STATUSES,
  BLOG_STATUS_LABELS,
  type BlogPostDTO,
  type BlogStatus,
} from "@/lib/blog/types";
import { BlogImporter } from "./importer";

// ─────────────────────────────────────────────────────────────────────────────
// /admin/blog — listado con filtros, búsqueda y paginación.
//
// El filtrado y la búsqueda son SERVER-SIDE (GET /api/admin/blog): la tabla
// crece con cada importación de 200 y filtrar en memoria dejaría de funcionar
// a la tercera tanda. La primera página llega renderizada desde el server y a
// partir de ahí el cliente refetchea.
// ─────────────────────────────────────────────────────────────────────────────

type StatusFilter = "ALL" | BlogStatus;

const STATUS_TONE: Record<BlogStatus, "success" | "warning" | "info" | "neutral"> = {
  published: "success",
  scheduled: "info",
  draft: "warning",
  archived: "neutral",
};

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "ALL", label: "Todos" },
  { key: "published", label: "Publicados" },
  { key: "scheduled", label: "Programados" },
  { key: "draft", label: "Borradores" },
  { key: "archived", label: "Archivados" },
];

interface ListPayload {
  posts: BlogPostDTO[];
  total: number;
  page: number;
  totalPages: number;
}

function fmt(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function BlogClient({ initial }: { initial: ListPayload }) {
  const router = useRouter();
  const askConfirm = useConfirm();

  const [data, setData] = useState<ListPayload>(initial);
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Debounce de la búsqueda: escribir no debe disparar una query por tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams();
      if (status !== "ALL") sp.set("status", status);
      if (category) sp.set("category", category);
      if (search) sp.set("q", search);
      sp.set("page", String(page));
      sp.set("take", "25");

      const res = await fetch(`/api/admin/blog?${sp.toString()}`);
      if (!res.ok) throw new Error("No se pudo cargar la lista");
      setData(await res.json());
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo cargar la lista");
    } finally {
      setLoading(false);
    }
  }, [status, category, search, page]);

  // Salta la PRIMERA ejecución: `initial` ya viene renderizado del server y
  // refetchear al montar sería una query de más en cada visita. Con un ref y
  // no con estado, para no provocar un render extra.
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    load();
  }, [load]);

  async function patch(post: BlogPostDTO, body: Record<string, unknown>, okMsg: string) {
    setBusyId(post.id);
    try {
      const res = await fetch(`/api/admin/blog/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "No se pudo actualizar");
      }
      const updated: BlogPostDTO = await res.json();
      setData((d) => ({ ...d, posts: d.posts.map((p) => (p.id === post.id ? updated : p)) }));
      toast.success(okMsg);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo actualizar");
    } finally {
      setBusyId(null);
    }
  }

  async function publishNow(post: BlogPostDTO) {
    const ok = await askConfirm({
      title: "¿Publicar ahora?",
      description: `"${post.title}" quedará visible en /blog/${post.slug} de inmediato y entrará al sitemap.`,
      confirmText: "Publicar",
    });
    if (!ok) return;
    await patch(post, { status: "published" }, "Artículo publicado");
  }

  async function archive(post: BlogPostDTO) {
    const ok = await askConfirm({
      title: "¿Archivar artículo?",
      description:
        "Dejará de mostrarse en el blog, en el RSS y en el sitemap. El contenido se conserva y puedes republicarlo después.",
      variant: "warning",
      confirmText: "Archivar",
    });
    if (!ok) return;
    await patch(post, { status: "archived" }, "Artículo archivado");
  }

  async function remove(post: BlogPostDTO) {
    const ok = await askConfirm({
      title: "¿Eliminar artículo?",
      description: `Se borra "${post.title}" de forma permanente. Si sólo quieres retirarlo del blog, archívalo.`,
      variant: "danger",
      confirmText: "Eliminar",
    });
    if (!ok) return;

    setBusyId(post.id);
    try {
      const res = await fetch(`/api/admin/blog/${post.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "No se pudo eliminar");
      }
      setData((d) => ({ ...d, posts: d.posts.filter((p) => p.id !== post.id), total: Math.max(0, d.total - 1) }));
      toast.success("Artículo eliminado");
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo eliminar");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
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
        <div>
          <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
            Blog
          </h1>
          <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
            Artículos públicos de dalecontrol.com/blog. El cron publica los programados cada día a
            las 13:00 UTC.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href="/blog" target="_blank" rel="noopener noreferrer" className="btn-new btn-new--ghost">
            <ExternalLink size={14} /> Ver blog
          </a>
          <Link href="/admin/blog/nuevo" className="btn-new btn-new--primary">
            <Plus size={14} /> Nuevo artículo
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <BlogImporter />

        {/* Filtros */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map((f) => (
              <ButtonNew
                key={f.key}
                size="sm"
                variant={status === f.key ? "primary" : "ghost"}
                onClick={() => {
                  setStatus(f.key);
                  setPage(1);
                }}
              >
                {f.label}
              </ButtonNew>
            ))}
          </div>
          <select
            className="input-new"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            style={{ maxWidth: 240, height: 32, padding: "4px 10px", fontSize: 12.5 }}
          >
            <option value="">Todas las categorías</option>
            {BLOG_CATEGORIES.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
          <div style={{ position: "relative", flex: 1, minWidth: 200, maxWidth: 320 }}>
            <Search
              size={13}
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)" }}
            />
            <input
              className="input-new"
              placeholder="Buscar por título…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ height: 32, padding: "4px 10px 4px 28px", fontSize: 12.5, width: "100%" }}
            />
          </div>
        </div>

        {/* Tabla */}
        <CardNew noPad title={`Artículos (${data.total})`}>
          {data.posts.length === 0 ? (
            <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
              {loading ? "Cargando…" : "No hay artículos con estos filtros."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="table-new">
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th>Categoría</th>
                    <th>Estado</th>
                    <th>Programado</th>
                    <th>Publicado</th>
                    <th style={{ textAlign: "right" }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.posts.map((p) => {
                    const busy = busyId === p.id;
                    return (
                      <tr key={p.id} style={busy ? { opacity: 0.55 } : undefined}>
                        <td style={{ maxWidth: 380 }}>
                          <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{p.title}</div>
                          <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", overflowWrap: "anywhere" }}>
                            /blog/{p.slug}
                          </div>
                        </td>
                        <td style={{ color: "var(--text-2)", fontSize: 12 }}>
                          {blogCategoryLabel(p.category)}
                          {p.cluster && (
                            <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{p.cluster}</div>
                          )}
                        </td>
                        <td>
                          <BadgeNew tone={STATUS_TONE[p.status]} dot>
                            {BLOG_STATUS_LABELS[p.status]}
                          </BadgeNew>
                        </td>
                        <td className="mono" style={{ color: "var(--text-3)", fontSize: 11.5, whiteSpace: "nowrap" }}>
                          {fmt(p.scheduledAt)}
                        </td>
                        <td className="mono" style={{ color: "var(--text-3)", fontSize: 11.5, whiteSpace: "nowrap" }}>
                          {fmt(p.publishedAt)}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <Link href={`/admin/blog/${p.id}`} className="btn-new btn-new--ghost btn-new--sm">
                              <Pencil size={13} /> Editar
                            </Link>
                            {p.status !== "published" && (
                              <ButtonNew size="sm" variant="secondary" icon={<Send size={13} />} disabled={busy} onClick={() => publishNow(p)}>
                                Publicar ahora
                              </ButtonNew>
                            )}
                            {p.status !== "archived" && (
                              <ButtonNew size="sm" variant="ghost" icon={<Archive size={13} />} disabled={busy} onClick={() => archive(p)}>
                                Archivar
                              </ButtonNew>
                            )}
                            <ButtonNew
                              size="sm"
                              variant="ghost"
                              icon={<Trash2 size={13} />}
                              disabled={busy}
                              onClick={() => remove(p)}
                              style={{ color: "var(--danger)" }}
                              aria-label="Eliminar"
                            >
                              Eliminar
                            </ButtonNew>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardNew>

        {/* Paginación */}
        {data.totalPages > 1 && (
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
            <ButtonNew size="sm" variant="ghost" disabled={page <= 1 || loading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              ← Anterior
            </ButtonNew>
            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>
              Página {data.page} de {data.totalPages}
            </span>
            <ButtonNew
              size="sm"
              variant="ghost"
              disabled={page >= data.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente →
            </ButtonNew>
          </div>
        )}

        <p style={{ fontSize: 11.5, color: "var(--text-3)", textAlign: "center", margin: 0 }}>
          Estados: {BLOG_STATUSES.map((s) => BLOG_STATUS_LABELS[s]).join(" · ")}
        </p>
      </div>
    </div>
  );
}
