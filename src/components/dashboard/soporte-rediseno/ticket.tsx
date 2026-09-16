"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /dashboard/soporte/[id] con el rediseño encendido: el hilo del ticket
// (clínica a la derecha, soporte a la izquierda, sistema al centro), el
// redactor con adjuntos, el aviso de resuelto, el estado cerrado y el diálogo
// de cierre con calificación.
//
// NO pide datos ni los manda: los fetch a /api/support/tickets/[id], a
// …/messages, a /api/support/attachments y el PATCH de cierre viven en
// `src/app/dashboard/soporte/[id]/ticket-client.tsx`, que sigue siendo el
// dueño y le pasa a esto su estado y sus acciones. Encendido o apagado se
// envían los mismos datos al mismo sitio.
//
// Misma cantidad de clics que hoy. Y lo que hoy se esconde en pantallas
// estrechas (la palabra «Adjuntar», el contador de adjuntos, la pista de
// Enter) aquí se ve siempre.
// ═══════════════════════════════════════════════════════════════════════════

import { useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileText, Image as ImageIcon, LifeBuoy, Loader2, Paperclip, Send, X } from "lucide-react";
import {
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_MAX_BODY_CHARS,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS_CLINIC,
} from "@/lib/support/types";
import type { SupportAttachment, SupportMessageDTO, SupportTicketSummary } from "@/lib/support/types";
import { RaizSoporte } from "./raiz";
import { Avatar, Boton, Estrellas, Etiqueta } from "./piezas";
import { bytesHilo, fechaLarga, horaMensaje, TONO_ESTADO, TONO_PRIORIDAD } from "./formato";
import s from "./soporte.module.css";

export interface TicketProps {
  loading: boolean;
  notFound: boolean;
  loadError: boolean;
  ticket: SupportTicketSummary | null;
  visibleMessages: SupportMessageDTO[];
  reintentar: () => void;

  body: string;
  setBody: (v: string) => void;
  pendingFiles: SupportAttachment[];
  uploading: boolean;
  sending: boolean;
  fileRef: RefObject<HTMLInputElement>;
  bottomRef: RefObject<HTMLDivElement>;
  fileAccept: string;
  handleFiles: (list: FileList | null) => void;
  removePending: (i: number) => void;
  handleSend: () => void;
  onComposerKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;

  closeOpen: boolean;
  setCloseOpen: (v: boolean) => void;
  closing: boolean;
  handleCloseTicket: (rating: number) => void;
}

// ── Adjunto dentro de un mensaje ─────────────────────────────────────────────

function Adjunto({ att }: { att: SupportAttachment }) {
  const esImagen = typeof att.type === "string" && att.type.startsWith("image/");
  const icono = esImagen
    ? <ImageIcon size={15} strokeWidth={1.75} aria-hidden />
    : <FileText size={15} strokeWidth={1.75} aria-hidden />;

  // Sin signedUrl → solo el nombre, en tono tenue y sin enlace.
  if (!att.signedUrl) {
    return (
      <span className={`${s.chip} ${s.chipApagado}`} title="Adjunto no disponible por ahora">
        {icono}
        <span className={s.chipNombre}>{att.name}</span>
      </span>
    );
  }

  if (esImagen) {
    return (
      <a href={att.signedUrl} target="_blank" rel="noopener noreferrer" title={att.name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={att.signedUrl} alt={att.name} loading="lazy" className={s.imagenAdjunta} />
      </a>
    );
  }

  return (
    <a href={att.signedUrl} target="_blank" rel="noopener noreferrer" className={s.chip} title={att.name}>
      {icono}
      <span className={s.chipNombre}>{att.name}</span>
    </a>
  );
}

// ── Burbuja de mensaje ───────────────────────────────────────────────────────

function Mensaje({ msg }: { msg: SupportMessageDTO }) {
  const hora = horaMensaje(msg.createdAt);
  const adjuntos = Array.isArray(msg.attachments) ? msg.attachments : [];

  if (msg.authorType === "system") {
    return (
      <div className={`${s.mensaje} ${s.mensajeSistema}`}>
        <div className={s.mensajeSistemaTexto}>
          <p>{msg.body}</p>
          {hora && <p className={s.burbujaHora}>{hora}</p>}
        </div>
      </div>
    );
  }

  const esClinica = msg.authorType === "clinic";
  const autor = esClinica ? (msg.authorName || "Tú") : (msg.authorName || "Soporte DaleControl");

  return (
    <div className={`${s.mensaje} ${esClinica ? s.mensajeClinica : s.mensajeSoporte}`}>
      {!esClinica && <Avatar nombre={autor} />}
      <div className={s.burbuja}>
        <p className={s.burbujaAutor}>{autor}</p>
        {/* Texto plano siempre — nunca HTML */}
        <p className={s.burbujaTexto}>{msg.body}</p>
        {adjuntos.length > 0 && (
          <div className={s.burbujaAdjuntos}>
            {adjuntos.map((att, i) => <Adjunto key={`${att.path || att.name}-${i}`} att={att} />)}
          </div>
        )}
        {hora && <p className={s.burbujaHora}>{hora}</p>}
      </div>
      {esClinica && <Avatar nombre={autor} clinica />}
    </div>
  );
}

// ── Diálogo de cierre con calificación opcional ──────────────────────────────

function DialogoCierre({ closing, onCancel, onConfirm }: {
  closing: boolean;
  onCancel: () => void;
  onConfirm: (rating: number) => void;
}) {
  const [calificacion, setCalificacion] = useState(0);
  return (
    <div className={s.velo} onClick={closing ? undefined : onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cerrar ticket"
        className={`${s.dialogo} ${s.dialogoChico}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.dialogoCabecera}>
          <h3 className={s.dialogoTitulo}>¿Resolvimos tu problema?</h3>
        </div>
        <div className={s.dialogoCuerpo}>
          <p className={s.dialogoTexto}>
            Al cerrar el ticket ya no podrás responder en este hilo. Si quieres, califica la atención (es opcional).
          </p>
          <Estrellas valor={calificacion} onChange={setCalificacion} />
          <p className={s.estrellasTexto}>{calificacion > 0 ? `${calificacion} de 5` : "Sin calificación"}</p>
        </div>
        <div className={s.dialogoPie}>
          <Boton variante="fantasma" type="button" onClick={onCancel} disabled={closing}>Cancelar</Boton>
          <Boton
            variante="principal"
            type="button"
            onClick={() => onConfirm(calificacion)}
            disabled={closing}
            icono={closing ? <Loader2 size={16} strokeWidth={1.75} className={s.girando} aria-hidden /> : undefined}
          >
            {closing ? "Cerrando…" : "Cerrar ticket"}
          </Boton>
        </div>
      </div>
    </div>
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

export function TicketRediseno(p: TicketProps) {
  if (p.loading) {
    return (
      <RaizSoporte className={s.ticket}>
        <div className={s.estado}>
          <Loader2 size={20} strokeWidth={1.75} className={s.girando} aria-hidden />
          <p className={s.estadoTexto}>Cargando ticket…</p>
        </div>
      </RaizSoporte>
    );
  }

  if (p.notFound) {
    return (
      <RaizSoporte className={s.ticket}>
        <div className={s.estado}>
          <LifeBuoy size={22} strokeWidth={1.75} aria-hidden />
          <h2 className={s.estadoTitulo}>Ticket no encontrado</h2>
          <p className={s.estadoTexto}>Puede que el enlace sea incorrecto o que el ticket ya no exista.</p>
          <div className={s.estadoAcciones}>
            <Link href="/dashboard/soporte" className={s.boton}>
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Volver a Soporte
            </Link>
          </div>
        </div>
      </RaizSoporte>
    );
  }

  if (p.loadError || !p.ticket) {
    return (
      <RaizSoporte className={s.ticket}>
        <div className={s.estado}>
          <LifeBuoy size={22} strokeWidth={1.75} aria-hidden />
          <h2 className={s.estadoTitulo}>No se pudo cargar el ticket</h2>
          <p className={s.estadoTexto}>Revisa tu conexión e inténtalo de nuevo.</p>
          <div className={s.estadoAcciones}>
            <Boton variante="principal" type="button" onClick={p.reintentar}>Reintentar</Boton>
            <Link href="/dashboard/soporte" className={`${s.boton} ${s.botonFantasma}`}>
              <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Soporte
            </Link>
          </div>
        </div>
      </RaizSoporte>
    );
  }

  const ticket = p.ticket;
  const cerrado = ticket.status === "CERRADO";
  const estado = SUPPORT_STATUS_LABELS_CLINIC[ticket.status] || ticket.status;
  const categoria = SUPPORT_CATEGORY_LABELS[ticket.category] || ticket.category;
  const prioridad = SUPPORT_PRIORITY_LABELS[ticket.priority] || ticket.priority;
  const puedeAdjuntar = p.pendingFiles.length < SUPPORT_MAX_FILES_PER_MESSAGE;

  return (
    <RaizSoporte className={s.ticket}>
      <Link href="/dashboard/soporte" className={s.enlace}>
        <ArrowLeft size={16} strokeWidth={1.75} aria-hidden /> Soporte
      </Link>

      {/* Cabecera del ticket */}
      <div className={`${s.tarjeta} ${s.ticketCabecera}`}>
        <div className={s.ticketCabeceraTextos}>
          <div className={s.ticketFolioFila}>
            <span className={s.folio}>{ticket.folioLabel}</span>
            <Etiqueta tono={TONO_ESTADO[ticket.status] || "neutro"} punto>{estado}</Etiqueta>
          </div>
          <h1 className={s.ticketAsunto}>{ticket.subject}</h1>
          <div className={s.ticketMeta}>
            <Etiqueta>{categoria}</Etiqueta>
            <Etiqueta tono={TONO_PRIORIDAD[ticket.priority] || "neutro"} punto>Prioridad: {prioridad}</Etiqueta>
            <span className={s.ticketFecha}>Creado el {fechaLarga(ticket.createdAt)}</span>
          </div>
        </div>
        {!cerrado && (
          <Boton type="button" onClick={() => p.setCloseOpen(true)}>Cerrar ticket</Boton>
        )}
      </div>

      {/* Hilo */}
      <div className={s.hilo}>
        {p.visibleMessages.length === 0 ? (
          <p className={s.hiloVacio}>Aún no hay mensajes en este ticket.</p>
        ) : (
          p.visibleMessages.map((m) => <Mensaje key={m.id} msg={m} />)
        )}
        <div ref={p.bottomRef} aria-hidden />
      </div>

      {/* Aviso de resuelto */}
      {ticket.status === "RESUELTO" && (
        <div className={s.aviso}>
          <div className={s.avisoTexto}>
            <CheckCircle2 size={16} strokeWidth={1.75} aria-hidden />
            <span>Marcamos tu ticket como resuelto. Si todo quedó bien, ciérralo y califica la atención.</span>
          </div>
          <Boton type="button" onClick={() => p.setCloseOpen(true)}>Cerrar y calificar</Boton>
        </div>
      )}

      {/* Redactor / aviso de cerrado */}
      {cerrado ? (
        <div className={`${s.tarjeta} ${s.cerrado}`}>
          <p className={s.cerradoTitulo}>Este ticket está cerrado.</p>
          {typeof ticket.rating === "number" && ticket.rating >= 1 && (
            <p className={s.cerradoTexto}>
              Tu calificación: <span className={s.calificacion}>{"★".repeat(Math.min(5, ticket.rating))}</span> ({ticket.rating}/5)
            </p>
          )}
          <p className={s.cerradoTexto}>Si necesitas algo más, crea un ticket nuevo y te atendemos.</p>
          <div className={s.cerradoAccion}>
            <Link href="/dashboard/soporte" className={`${s.boton} ${s.botonPrincipal}`}>Crear ticket nuevo</Link>
          </div>
        </div>
      ) : (
        <div className={s.redactorPegajoso}>
          {p.pendingFiles.length > 0 && (
            <div className={s.pendientes}>
              {p.pendingFiles.map((f, i) => (
                <span key={`${f.path}-${i}`} className={s.chip}>
                  {f.type && f.type.startsWith("image/")
                    ? <ImageIcon size={15} strokeWidth={1.75} aria-hidden />
                    : <FileText size={15} strokeWidth={1.75} aria-hidden />}
                  <span className={s.chipNombre}>{f.name}</span>
                  {bytesHilo(f.size) && <span className={s.adjuntoTamano}>{bytesHilo(f.size)}</span>}
                  <button type="button" className={s.adjuntoQuitar} aria-label={`Quitar ${f.name}`} onClick={() => p.removePending(i)}>
                    <X size={14} strokeWidth={1.75} aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className={`${s.tarjeta} ${s.redactor}`}>
            <textarea
              value={p.body}
              onChange={(e) => p.setBody(e.target.value.slice(0, SUPPORT_MAX_BODY_CHARS))}
              onKeyDown={p.onComposerKeyDown}
              placeholder="Escribe tu mensaje…"
              rows={2}
              maxLength={SUPPORT_MAX_BODY_CHARS}
              disabled={p.sending}
              className={s.redactorArea}
              aria-label="Tu mensaje"
            />
            <div className={s.redactorBarra}>
              <div className={s.redactorIzquierda}>
                <input
                  ref={p.fileRef}
                  type="file"
                  multiple
                  accept={p.fileAccept}
                  className={s.ocultoInput}
                  onChange={(e) => { p.handleFiles(e.target.files); e.target.value = ""; }}
                />
                <Boton
                  type="button"
                  variante="fantasma"
                  chico
                  onClick={() => { if (p.fileRef.current) p.fileRef.current.click(); }}
                  disabled={p.uploading || p.sending || !puedeAdjuntar}
                  aria-label="Adjuntar archivo (imagen o PDF, máximo 5MB)"
                  title="Imágenes o PDF · máx. 5MB · hasta 5 por mensaje"
                  icono={p.uploading
                    ? <Loader2 size={16} strokeWidth={1.75} className={s.girando} aria-hidden />
                    : <Paperclip size={16} strokeWidth={1.75} aria-hidden />}
                >
                  {p.uploading ? "Subiendo…" : "Adjuntar"}
                </Boton>
                <span className={s.cifra}>{p.pendingFiles.length}/{SUPPORT_MAX_FILES_PER_MESSAGE}</span>
              </div>
              <div className={s.redactorDerecha}>
                {p.body.length > SUPPORT_MAX_BODY_CHARS - 500 && (
                  <span className={s.cifra}>{p.body.length}/{SUPPORT_MAX_BODY_CHARS}</span>
                )}
                <Boton
                  variante="principal"
                  type="button"
                  onClick={p.handleSend}
                  disabled={p.sending || p.uploading || !p.body.trim()}
                  icono={p.sending
                    ? <Loader2 size={16} strokeWidth={1.75} className={s.girando} aria-hidden />
                    : <Send size={16} strokeWidth={1.75} aria-hidden />}
                >
                  {p.sending ? "Enviando…" : "Enviar"}
                </Boton>
              </div>
            </div>
          </div>
          <p className={s.pista}>Enter para enviar · Shift+Enter para salto de línea</p>
        </div>
      )}

      {p.closeOpen && (
        <DialogoCierre closing={p.closing} onCancel={() => p.setCloseOpen(false)} onConfirm={p.handleCloseTicket} />
      )}
    </RaizSoporte>
  );
}
