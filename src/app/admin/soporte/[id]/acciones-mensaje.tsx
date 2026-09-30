"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /admin/soporte/[id] — cuerpo de una respuesta de SOPORTE con sus acciones:
// Editar, Adjuntar archivo y Retirar, sobre una respuesta ya enviada.
//
// El aviso a la clínica ya salió, así que nada se borra en silencio:
//   · editar  → la clínica lee el texto nuevo con «(editado · fecha)»
//   · retirar → en su lugar queda «Respuesta retirada por soporte»; el texto y
//               los archivos originales se conservan en la base (auditoría)
// API: PATCH / DELETE /api/admin/support/tickets/[id]/messages/[messageId]
//      POST /api/admin/support/tickets/[id]/attachments (subir antes de adjuntar)
// La regla vive en src/lib/support/mensaje-edicion.ts; aquí solo se pinta.
// ═══════════════════════════════════════════════════════════════════════════

import { useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import toast from "react-hot-toast";
import { Ban, Paperclip, Pencil } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import {
  SUPPORT_ALLOWED_MIME,
  SUPPORT_MAX_BODY_CHARS,
  SUPPORT_MAX_FILE_BYTES,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  type SupportAttachment,
  type SupportMessageDTO,
} from "@/lib/support/types";
import { SUPPORT_RETRACTED_TEXT } from "@/lib/support/mensaje-edicion";

const ACCEPT_ATTR = SUPPORT_ALLOWED_MIME.join(",");

const accionStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  padding: "3px 8px",
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text-3)",
  fontSize: 11.5,
  fontWeight: 500,
  cursor: "pointer",
};

/** «editado · 30 sep 2026, 10:15» — una sola fuente para la etiqueta. */
export function textoEditado(editadoEn: string | null | undefined, formatear: (iso: string) => string): string | null {
  return editadoEn ? `editado · ${formatear(editadoEn)}` : null;
}

async function errorDe(res: Response, porDefecto: string): Promise<string> {
  const j = await res.json().catch(() => null);
  return (j && typeof j.error === "string" && j.error) || porDefecto;
}

export function CuerpoDeRespuesta({
  ticketId,
  message,
  formatearFecha,
  onCambio,
  children,
}: {
  ticketId: string;
  message: SupportMessageDTO;
  formatearFecha: (iso: string) => string;
  /** Tras guardar/retirar/adjuntar: el padre vuelve a pedir el ticket. */
  onCambio: () => Promise<void> | void;
  /** Los adjuntos ya pintados (la lista vive en el archivo del padre). */
  children?: ReactNode;
}) {
  const [modo, setModo] = useState<"ver" | "editar" | "retirar">("ver");
  const [texto, setTexto] = useState(message.body);
  const [ocupado, setOcupado] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const retirada = Boolean(message.retractedAt);
  const esNota = message.internalNote === true;

  // ── Retirada: solo el aviso (y la fecha) ───────────────────────────────────
  if (retirada) {
    return (
      <div data-mensaje-retirado="true">
        <div style={{ fontSize: 13, lineHeight: 1.55, fontStyle: "italic", color: "var(--text-3)" }}>
          {message.body || SUPPORT_RETRACTED_TEXT}
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 4 }}>
          Retirada el {formatearFecha(message.retractedAt as string)} · el texto original se conserva para auditoría
        </div>
      </div>
    );
  }

  async function guardar() {
    const nuevo = texto.trim();
    if (ocupado) return;
    if (nuevo === message.body.trim()) {
      toast("No hay cambios que guardar");
      return;
    }
    setOcupado(true);
    try {
      const res = await fetch(`/api/admin/support/tickets/${ticketId}/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: nuevo }),
      });
      if (!res.ok) throw new Error(await errorDe(res, "No se pudo guardar el cambio"));
      toast.success("Respuesta editada");
      setModo("ver");
      await onCambio();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "No se pudo guardar el cambio");
    } finally {
      setOcupado(false);
    }
  }

  async function retirar() {
    if (ocupado) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/admin/support/tickets/${ticketId}/messages/${message.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await errorDe(res, "No se pudo retirar la respuesta"));
      toast.success(esNota ? "Nota retirada" : "Respuesta retirada");
      setModo("ver");
      await onCambio();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "No se pudo retirar la respuesta");
    } finally {
      setOcupado(false);
    }
  }

  async function adjuntar(lista: FileList | null) {
    if (!lista || lista.length === 0 || ocupado) return;
    const archivos = Array.from(lista);
    const lugares = SUPPORT_MAX_FILES_PER_MESSAGE - message.attachments.length;
    if (lugares <= 0) {
      toast.error(`Máximo ${SUPPORT_MAX_FILES_PER_MESSAGE} archivos por mensaje.`);
      return;
    }
    if (archivos.length > lugares) {
      toast.error(`Solo caben ${lugares} archivo${lugares === 1 ? "" : "s"} más en este mensaje.`);
    }
    setOcupado(true);
    try {
      const subidos: SupportAttachment[] = [];
      for (const file of archivos.slice(0, lugares)) {
        if (!(SUPPORT_ALLOWED_MIME as readonly string[]).includes(file.type)) {
          toast.error(`"${file.name}": tipo no permitido (solo imágenes o PDF).`);
          continue;
        }
        if (file.size > SUPPORT_MAX_FILE_BYTES) {
          toast.error(`"${file.name}" supera el límite de 5MB.`);
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/admin/support/tickets/${ticketId}/attachments`, { method: "POST", body: fd });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.path) {
          toast.error((data && data.error) || `No se pudo subir "${file.name}".`);
          continue;
        }
        subidos.push({
          path: data.path,
          name: data.name || file.name,
          size: typeof data.size === "number" ? data.size : file.size,
          type: data.type || file.type,
        });
      }
      if (subidos.length === 0) return;
      const res = await fetch(`/api/admin/support/tickets/${ticketId}/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachments: subidos }),
      });
      if (!res.ok) throw new Error(await errorDe(res, "No se pudo adjuntar el archivo"));
      toast.success(subidos.length === 1 ? "Archivo agregado a la respuesta" : "Archivos agregados a la respuesta");
      await onCambio();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : "Error de red al adjuntar");
    } finally {
      setOcupado(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div data-respuesta-soporte={message.id}>
      {modo === "editar" ? (
        <div>
          <textarea
            className="input-new"
            aria-label="Texto de la respuesta"
            value={texto}
            maxLength={SUPPORT_MAX_BODY_CHARS}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                guardar();
              }
              if (e.key === "Escape") setModo("ver");
            }}
            rows={Math.min(10, Math.max(3, texto.split("\n").length + 1))}
            style={{ width: "100%", resize: "vertical", fontSize: 13, lineHeight: 1.55 }}
            autoFocus
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <ButtonNew variant="primary" size="sm" onClick={guardar} disabled={ocupado || (!texto.trim() && message.attachments.length === 0)}>
              {ocupado ? "Guardando…" : "Guardar cambios"}
            </ButtonNew>
            <ButtonNew
              variant="ghost"
              size="sm"
              onClick={() => {
                setTexto(message.body);
                setModo("ver");
              }}
              disabled={ocupado}
            >
              Cancelar
            </ButtonNew>
            <span style={{ fontSize: 11, color: "var(--text-3)", flex: "1 1 220px" }}>
              {esNota
                ? "Es una nota interna: la clínica no la ve."
                : "La clínica verá el texto nuevo con «(editado)» y la fecha. El texto anterior se conserva."}
            </span>
          </div>
        </div>
      ) : (
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            color: "var(--text-1)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {message.body}
        </div>
      )}

      {children}

      {modo === "retirar" && (
        <div
          role="alertdialog"
          aria-label="Confirmar retirar respuesta"
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid var(--danger-border-strong, var(--border-soft))",
            background: "var(--danger-soft)",
          }}
        >
          <div style={{ fontSize: 12.5, color: "var(--text-1)", lineHeight: 1.5 }}>
            <strong>¿Retirar {esNota ? "esta nota" : "esta respuesta"}?</strong>{" "}
            {esNota
              ? "Queda «Nota interna retirada por soporte» en su lugar."
              : "La clínica verá «Respuesta retirada por soporte» en su lugar."}{" "}
            No se borra: el texto y los archivos originales se conservan para auditoría.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <ButtonNew variant="danger" size="sm" onClick={retirar} disabled={ocupado}>
              {ocupado ? "Retirando…" : "Sí, retirar"}
            </ButtonNew>
            <ButtonNew variant="ghost" size="sm" onClick={() => setModo("ver")} disabled={ocupado}>
              Cancelar
            </ButtonNew>
          </div>
        </div>
      )}

      {modo === "ver" && (
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", marginTop: 8, marginLeft: -8 }}>
          <button
            type="button"
            style={accionStyle}
            onClick={() => {
              setTexto(message.body);
              setModo("editar");
            }}
            disabled={ocupado}
          >
            <Pencil size={12} aria-hidden /> Editar
          </button>
          {message.attachments.length < SUPPORT_MAX_FILES_PER_MESSAGE && (
            <button type="button" style={accionStyle} onClick={() => fileRef.current?.click()} disabled={ocupado}>
              <Paperclip size={12} aria-hidden /> {ocupado ? "Subiendo…" : "Adjuntar archivo"}
            </button>
          )}
          <button type="button" style={{ ...accionStyle, color: "var(--danger)" }} onClick={() => setModo("retirar")} disabled={ocupado}>
            <Ban size={12} aria-hidden /> Retirar
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT_ATTR}
            multiple
            hidden
            aria-label="Adjuntar archivo a esta respuesta"
            onChange={(e) => adjuntar(e.target.files)}
          />
        </div>
      )}
    </div>
  );
}
