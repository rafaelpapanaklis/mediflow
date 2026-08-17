"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /admin/affiliates/paginas — moderación de las páginas /socio/<slug>.
//
// Dos listas:
//   EN REVISIÓN  lo que un socio mandó y espera decisión. Se ve el ANTES y el
//                DESPUÉS lado a lado: lo que hay publicado ahora contra lo que
//                propone. Aprobar publica; rechazar devuelve con motivo.
//   PUBLICADAS   lo que ya está en línea, para poder retirarlo si algo se pasó.
//
// El motivo es OBLIGATORIO al rechazar y al retirar: el socio lo recibe por
// correo y es lo único que le dice qué corregir.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, RefreshCw, X } from "lucide-react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { useConfirmWithReason } from "@/components/ui/confirm-dialog";
import {
  sectionDef,
  visibleSectionIds,
  type PartnerPageContent,
} from "@/lib/affiliates/page-config";
import type { ModerationQueue, ModerationRow } from "@/lib/affiliates/page-moderation";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("es-MX", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "—";
  }
}

/** Etiquetas de las secciones visibles, en orden. */
function sectionLabels(content: PartnerPageContent): string[] {
  return visibleSectionIds(content.sections).map((id) => sectionDef(id)?.label ?? id);
}

export function PaginasSocioClient({
  initial,
  loadError,
}: {
  initial: ModerationQueue;
  loadError: boolean;
}) {
  const router = useRouter();
  const confirmWithReason = useConfirmWithReason();
  const [queue, setQueue] = useState<ModerationQueue>(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await fetch("/api/admin/affiliates/paginas");
      if (!res.ok) throw new Error("No se pudo recargar la cola.");
      setQueue(await res.json());
      // El badge del menú lo calcula el layout en el servidor.
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo recargar la cola.");
    }
  }

  async function decide(row: ModerationRow, action: "approve" | "reject" | "unpublish", reason?: string) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/affiliates/${row.id}/pagina`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const body = await res.json().catch(() => null as any);
      if (!res.ok) {
        toast.error(body?.error ?? "No se pudo aplicar la decisión.");
        // Un 409 significa que la lista está vieja: se recarga sola.
        if (res.status === 409) await reload();
        return;
      }
      toast.success(
        action === "approve"
          ? "Página publicada. El socio ya recibió el aviso."
          : action === "reject"
            ? "Rechazada. El socio recibió el motivo."
            : "Página retirada. El socio recibió el motivo.",
      );
      await reload();
    } catch {
      toast.error("No se pudo aplicar la decisión.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleApprove(row: ModerationRow) {
    const r = await confirmWithReason({
      title: `¿Publicar la página de ${row.name}?`,
      description:
        "Su foto y su presentación pasan a verse en dalecontrol.com/socio/" +
        row.slug +
        ". Le llega un correo avisándole.",
      confirmText: "Publicar",
      variant: "default",
    });
    if (!r.confirmed) return;
    await decide(row, "approve");
  }

  async function handleReject(row: ModerationRow) {
    const r = await confirmWithReason({
      title: `¿Rechazar los cambios de ${row.name}?`,
      description:
        "Su página pública no cambia. El motivo que escribas se le manda por correo y lo ve en su panel, así que dile exactamente qué corregir.",
      confirmText: "Rechazar",
      variant: "danger",
      withReason: true,
      reasonLabel: "Motivo del rechazo",
      reasonPlaceholder: "Ej. La presentación menciona un descuento que no existe. Quítalo y la aprobamos.",
    });
    if (!r.confirmed) return;
    if (!r.reason?.trim()) {
      toast.error("Hace falta el motivo: es lo único que le dice qué corregir.");
      return;
    }
    await decide(row, "reject", r.reason);
  }

  async function handleUnpublish(row: ModerationRow) {
    const r = await confirmWithReason({
      title: `¿Retirar la página de ${row.name}?`,
      description:
        "Su página vuelve a la versión estándar ahora mismo. Su foto y su texto regresan a su borrador para que pueda corregir, y recibe el motivo por correo.",
      confirmText: "Retirar",
      variant: "danger",
      withReason: true,
      reasonLabel: "Motivo",
      reasonPlaceholder: "Ej. La foto no corresponde a la persona registrada en la cuenta.",
    });
    if (!r.confirmed) return;
    if (!r.reason?.trim()) {
      toast.error("Hace falta el motivo: el socio lo recibe por correo.");
      return;
    }
    await decide(row, "unpublish", r.reason);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0, color: "var(--text-1)" }}>
            Páginas de socio
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "var(--text-3)", maxWidth: 720 }}>
            Lo que un afiliado escribe en su página vive en dalecontrol.com y se lee como dicho
            por DaleControl. Nada se publica sin pasar por aquí.
          </p>
        </div>
        <ButtonNew variant="secondary" size="sm" icon={<RefreshCw size={15} />} onClick={reload}>
          Actualizar
        </ButtonNew>
      </header>

      {loadError ? (
        <CardNew>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-2)" }}>
            No se pudo cargar la cola. Dale a <strong>Actualizar</strong> para reintentar.
          </p>
        </CardNew>
      ) : null}

      {/* ── En revisión ──────────────────────────────────────────────── */}
      <CardNew
        title="En revisión"
        sub={
          queue.pending.length === 0
            ? "Nada esperando decisión."
            : `${queue.pending.length} ${queue.pending.length === 1 ? "página espera" : "páginas esperan"} tu decisión. La más antigua va primero.`
        }
      >
        {queue.pending.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-3)" }}>
            Cuando un socio mande cambios, aparecen aquí con el antes y el después.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {queue.pending.map((row) => (
              <PendingCard
                key={row.id}
                row={row}
                busy={busyId === row.id}
                onApprove={() => handleApprove(row)}
                onReject={() => handleReject(row)}
              />
            ))}
          </div>
        )}
      </CardNew>

      {/* ── Publicadas ───────────────────────────────────────────────── */}
      <CardNew
        title="Publicadas"
        sub="Páginas con foto o presentación en línea ahora mismo. Puedes retirar cualquiera."
      >
        {queue.published.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-3)" }}>
            Ningún socio tiene todavía una página personalizada publicada.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {queue.published.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  border: "1px solid var(--border-soft)",
                  borderRadius: 10,
                  flexWrap: "wrap",
                }}
              >
                <Photo url={row.state.published.photoUrl} name={row.name} size={40} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>{row.name}</div>
                  <div style={{ fontSize: 12, color: "var(--text-3)" }}>
                    /socio/{row.slug} · aprobada el {formatWhen(row.state.reviewedAt)}
                  </div>
                </div>
                <a
                  href={`/socio/${row.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12.5, color: "var(--brand)", display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  Ver <ExternalLink size={13} />
                </a>
                <ButtonNew
                  variant="danger"
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() => handleUnpublish(row)}
                >
                  Retirar
                </ButtonNew>
              </div>
            ))}
          </div>
        )}
      </CardNew>
    </div>
  );
}

/* ── Tarjeta de una página en revisión ──────────────────────────────── */

function PendingCard({
  row,
  busy,
  onApprove,
  onReject,
}: {
  row: ModerationRow;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const antes = row.state.published;
  const despues = row.state.draft;
  const seccionesIguales =
    sectionLabels(antes).join("|") === sectionLabels(despues).join("|");

  return (
    <div style={{ border: "1px solid var(--border-soft)", borderRadius: 12, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "var(--bg-elev-2)",
          borderBottom: "1px solid var(--border-soft)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-1)" }}>{row.name}</div>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            {row.email} · /socio/{row.slug}
          </div>
        </div>
        <BadgeNew tone="warning">Enviada el {formatWhen(row.state.submittedAt)}</BadgeNew>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 1,
          background: "var(--border-soft)",
        }}
      >
        <SideBySide
          titulo="Publicado ahora"
          content={antes}
          name={row.name}
          vacioTexto={
            row.state.publishedEmpty
              ? "Su página está sin personalizar: se ve la versión estándar."
              : "Sin presentación publicada."
          }
        />
        <SideBySide
          titulo="Propuesto"
          content={despues}
          name={row.name}
          destacado
          vacioTexto="Propone quitar su foto y su presentación."
        />
      </div>

      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border-soft)" }}>
        <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-4)", fontWeight: 600, marginBottom: 4 }}>
          Secciones
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5 }}>
          {seccionesIguales ? (
            "Sin cambios: mismas secciones y mismo orden."
          ) : (
            <>
              <strong>Queda:</strong> {sectionLabels(despues).join(" · ") || "ninguna"}
            </>
          )}
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "10px 14px",
          borderTop: "1px solid var(--border-soft)",
          flexWrap: "wrap",
        }}
      >
        <ButtonNew variant="primary" size="sm" icon={<Check size={15} />} disabled={busy} onClick={onApprove}>
          Aprobar y publicar
        </ButtonNew>
        <ButtonNew variant="danger" size="sm" icon={<X size={15} />} disabled={busy} onClick={onReject}>
          Rechazar con motivo
        </ButtonNew>
      </div>
    </div>
  );
}

function SideBySide({
  titulo,
  content,
  name,
  destacado,
  vacioTexto,
}: {
  titulo: string;
  content: PartnerPageContent;
  name: string;
  destacado?: boolean;
  vacioTexto: string;
}) {
  const vacio = !content.photoUrl && !content.bio;

  return (
    <div style={{ padding: 14, background: destacado ? "var(--brand-soft)" : "var(--bg-elev)" }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: destacado ? "var(--brand)" : "var(--text-4)",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        {titulo}
      </div>

      {vacio ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-3)" }}>{vacioTexto}</p>
      ) : (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
          <Photo url={content.photoUrl} name={name} size={56} />
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.55,
              color: "var(--text-2)",
              // El texto del socio es TEXTO PLANO: se pinta con {} (React
              // escapa) y pre-line respeta sus párrafos. Nada de HTML.
              whiteSpace: "pre-line",
              overflowWrap: "break-word",
              minWidth: 0,
            }}
          >
            {content.bio || "Sin presentación escrita."}
          </p>
        </div>
      )}
    </div>
  );
}

function Photo({ url, name, size }: { url: string | null; name: string; size: number }) {
  if (!url) {
    return (
      <span
        aria-hidden
        style={{
          width: size,
          height: size,
          flex: "0 0 auto",
          borderRadius: "50%",
          background: "var(--bg-elev-2)",
          border: "1px dashed var(--border-soft)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          color: "var(--text-4)",
        }}
      >
        sin foto
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL pública de Supabase Storage.
    <img
      src={url}
      alt={`Foto de ${name}`}
      width={size}
      height={size}
      style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
    />
  );
}
