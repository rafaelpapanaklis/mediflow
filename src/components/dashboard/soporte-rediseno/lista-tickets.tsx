"use client";

// ═══════════════════════════════════════════════════════════════════════════
// /dashboard/soporte con el rediseño encendido: la lista de tickets y el modal
// de «Nuevo ticket», vestidos con el lenguaje visual del menú de dos niveles.
//
// NO pide datos ni los manda: todo el estado, los fetch a
// /api/support/tickets y /api/support/attachments y la navegación viven en
// `src/app/dashboard/soporte/soporte-client.tsx`, que sigue siendo el dueño y
// le pasa a esto lo que ya tiene. Así, encendido o apagado, se envían los
// mismos datos al mismo sitio.
//
// Misma cantidad de clics que hoy: «Nuevo ticket» → modal → «Crear ticket»;
// clic en una fila → el hilo. Nada de lo que hoy se ve sin clic se esconde.
// ═══════════════════════════════════════════════════════════════════════════

import type { ChangeEvent, RefObject } from "react";
import { FileText, LifeBuoy, Loader2, Paperclip, Plus, X } from "lucide-react";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  SUPPORT_MAX_BODY_CHARS,
  SUPPORT_MAX_FILES_PER_MESSAGE,
  SUPPORT_MAX_SUBJECT_CHARS,
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABELS,
  SUPPORT_STATUS_LABELS_CLINIC,
} from "@/lib/support/types";
import type { SupportAttachment, SupportTicketSummary } from "@/lib/support/types";
import { AccountManagerCard } from "@/components/dashboard/account-manager-card";
import type { AccountManagerCardData } from "@/lib/account-manager/get-for-clinic";
import { RaizSoporte } from "./raiz";
import { Boton, Etiqueta } from "./piezas";
import { bytesLista, fechaCorta, TONO_ESTADO, TONO_PRIORIDAD } from "./formato";
import s from "./soporte.module.css";

export interface ListaTicketsProps {
  accountManager: AccountManagerCardData | null;
  clinicName: string;
  tickets: SupportTicketSummary[];
  loading: boolean;
  abrirTicket: (id: string) => void;

  // Modal «Nuevo ticket» — el estado y las acciones son los de siempre.
  showNew: boolean;
  setShowNew: (v: boolean) => void;
  subject: string;
  setSubject: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  priority: string;
  setPriority: (v: string) => void;
  body: string;
  setBody: (v: string) => void;
  attachments: SupportAttachment[];
  removeAttachment: (i: number) => void;
  uploading: boolean;
  submitting: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  fileAccept: string;
  maxFileMb: number;
  handleFilesSelected: (e: ChangeEvent<HTMLInputElement>) => void;
  submitTicket: () => void;
}

export function ListaTicketsRediseno(p: ListaTicketsProps) {
  return (
    <RaizSoporte>
      <div className={s.cabecera}>
        <div>
          <h1 className={s.titulo}>Soporte Técnico</h1>
          <p className={s.subtitulo}>¿Necesitas ayuda? Levanta un ticket y te respondemos por aquí y por correo.</p>
        </div>
        <Boton variante="principal" type="button" icono={<Plus size={16} strokeWidth={1.75} aria-hidden />} onClick={() => p.setShowNew(true)}>
          Nuevo ticket
        </Boton>
      </div>

      {/* Manager de cuenta — ARRIBA de los tickets, como hoy. La tarjeta es
          compartida (account-manager-card.tsx) y no se toca: aquí solo se
          coloca. «Abre un ticket» reusa el mismo modal. */}
      <div className={s.manager}>
        <AccountManagerCard data={p.accountManager} clinicName={p.clinicName} onOpenTicket={() => p.setShowNew(true)} />
      </div>

      {p.loading ? (
        <div className={`${s.tarjeta} ${s.lista}`} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className={s.esqueletoFila}>
              <span className={s.esqueleto} style={{ height: 10, width: 96 }} />
              <span className={s.esqueleto} style={{ height: 14, width: "60%", maxWidth: 320 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <span className={s.esqueleto} style={{ height: 22, width: 80, borderRadius: 99 }} />
                <span className={s.esqueleto} style={{ height: 22, width: 112, borderRadius: 99 }} />
              </div>
            </div>
          ))}
        </div>
      ) : p.tickets.length === 0 ? (
        <div className={s.tarjeta}>
          <div className={s.vacio}>
            <span className={s.vacioIcono}><LifeBuoy size={22} strokeWidth={1.75} aria-hidden /></span>
            <div className={s.vacioTitulo}>Aún no tienes tickets</div>
            <p className={s.vacioTexto}>
              Si encuentras un error, tienes una duda o quieres sugerir algo, levanta un ticket
              y el equipo de DaleControl te responderá lo antes posible.
            </p>
            <Boton variante="principal" type="button" className={s.vacioAccion} icono={<Plus size={16} strokeWidth={1.75} aria-hidden />} onClick={() => p.setShowNew(true)}>
              Crear mi primer ticket
            </Boton>
          </div>
        </div>
      ) : (
        <div className={`${s.tarjeta} ${s.lista}`}>
          <div className={s.listaCabecera} aria-hidden>
            <span>Folio</span>
            <span>Asunto</span>
            <span>Categoría</span>
            <span>Estado</span>
            <span>Prioridad</span>
            <span className={s.alineadoDerecha}>Actividad</span>
          </div>
          {p.tickets.map((tk) => {
            const estado = SUPPORT_STATUS_LABELS_CLINIC[tk.status] || tk.status;
            const categoria = SUPPORT_CATEGORY_LABELS[tk.category] || tk.category;
            const prioridad = SUPPORT_PRIORITY_LABELS[tk.priority] || tk.priority;
            return (
              <button key={tk.id} type="button" className={s.fila} onClick={() => p.abrirTicket(tk.id)}>
                <span className={`${s.celda} ${s.celdaFolio} ${s.folio}`}>{tk.folioLabel}</span>
                <span className={`${s.celda} ${s.celdaAsunto} ${s.asunto}`}>
                  <span className={s.asuntoTexto}>{tk.subject}</span>
                  {tk.clinicUnread === true && <Etiqueta tono="marca" punto>Respuesta nueva</Etiqueta>}
                </span>
                <span className={s.etiquetas}>
                  <span className={`${s.celda} ${s.celdaCategoria}`}><Etiqueta>{categoria}</Etiqueta></span>
                  <span className={`${s.celda} ${s.celdaEstado}`}><Etiqueta tono={TONO_ESTADO[tk.status] || "neutro"} punto>{estado}</Etiqueta></span>
                  <span className={`${s.celda} ${s.celdaPrioridad}`}><Etiqueta tono={TONO_PRIORIDAD[tk.priority] || "neutro"} punto>{prioridad}</Etiqueta></span>
                </span>
                <span className={`${s.celda} ${s.celdaActividad} ${s.actividad}`}>
                  <span>{fechaCorta(tk.lastActivityAt)}</span>
                  {tk.rating != null && <span className={s.calificacion}>★ {tk.rating}/5</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {p.showNew && (
        <div className={s.velo} onClick={() => { if (!p.submitting && !p.uploading) p.setShowNew(false); }}>
          <div className={s.dialogo} role="dialog" aria-modal="true" aria-label="Nuevo ticket" onClick={(e) => e.stopPropagation()}>
            <div className={s.dialogoCabecera}>
              <h2 className={s.dialogoTitulo}>Nuevo ticket</h2>
              <button type="button" className={s.botonIcono} aria-label="Cerrar" onClick={() => { if (!p.submitting) p.setShowNew(false); }}>
                <X size={16} strokeWidth={1.75} aria-hidden />
              </button>
            </div>

            <div className={s.dialogoCuerpo}>
              <div className={s.campoGrupo}>
                <label className={s.etiquetaCampo} htmlFor="soporte-asunto">Asunto <span className={s.obligatorio}>*</span></label>
                <input
                  id="soporte-asunto"
                  className={s.campo}
                  maxLength={SUPPORT_MAX_SUBJECT_CHARS}
                  placeholder="Resumen breve de tu problema o duda"
                  value={p.subject}
                  onChange={(e) => p.setSubject(e.target.value)}
                />
              </div>

              <div className={`${s.dosColumnas} ${s.campoGrupo}`}>
                <div className={s.campoGrupo} style={{ marginBottom: 0 }}>
                  <label className={s.etiquetaCampo} htmlFor="soporte-categoria">Categoría</label>
                  <select id="soporte-categoria" className={s.campo} value={p.category} onChange={(e) => p.setCategory(e.target.value)}>
                    {SUPPORT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{SUPPORT_CATEGORY_LABELS[c] || c}</option>
                    ))}
                  </select>
                </div>
                <div className={s.campoGrupo} style={{ marginBottom: 0 }}>
                  <label className={s.etiquetaCampo} htmlFor="soporte-prioridad">Prioridad</label>
                  <select id="soporte-prioridad" className={s.campo} value={p.priority} onChange={(e) => p.setPriority(e.target.value)}>
                    {SUPPORT_PRIORITIES.map((pr) => (
                      <option key={pr} value={pr}>{SUPPORT_PRIORITY_LABELS[pr] || pr}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={s.campoGrupo}>
                <label className={s.etiquetaCampo} htmlFor="soporte-descripcion">Descripción <span className={s.obligatorio}>*</span></label>
                <textarea
                  id="soporte-descripcion"
                  className={`${s.campo} ${s.campoArea}`}
                  maxLength={SUPPORT_MAX_BODY_CHARS}
                  placeholder="Cuéntanos qué pasa con el mayor detalle posible: dónde ocurre, desde cuándo, qué esperabas que pasara…"
                  value={p.body}
                  onChange={(e) => p.setBody(e.target.value)}
                />
                <div className={s.contador}>{p.body.length}/{SUPPORT_MAX_BODY_CHARS}</div>
              </div>

              <div className={s.campoGrupo} style={{ marginBottom: 0 }}>
                <span className={s.etiquetaCampo}>
                  Adjuntos (opcional · máx. {SUPPORT_MAX_FILES_PER_MESSAGE} · {p.maxFileMb}MB c/u · imágenes o PDF)
                </span>
                <input
                  ref={p.fileInputRef}
                  type="file"
                  multiple
                  accept={p.fileAccept}
                  className={s.ocultoInput}
                  onChange={p.handleFilesSelected}
                />
                <div className={s.adjuntos}>
                  {p.attachments.map((f, i) => (
                    <div key={`${f.path}-${i}`} className={s.adjunto}>
                      <FileText size={16} strokeWidth={1.75} aria-hidden />
                      <span className={s.adjuntoNombre}>{f.name}</span>
                      <span className={s.adjuntoTamano}>{bytesLista(f.size)}</span>
                      <button
                        type="button"
                        className={s.adjuntoQuitar}
                        aria-label={`Quitar ${f.name}`}
                        onClick={() => p.removeAttachment(i)}
                        disabled={p.submitting}
                      >
                        <X size={15} strokeWidth={1.75} aria-hidden />
                      </button>
                    </div>
                  ))}
                  {p.uploading && (
                    <div className={s.subiendo}>
                      <Loader2 size={16} strokeWidth={1.75} className={s.girando} aria-hidden /> Subiendo…
                    </div>
                  )}
                  <div>
                    <Boton
                      type="button"
                      chico
                      icono={<Paperclip size={15} strokeWidth={1.75} aria-hidden />}
                      onClick={() => { if (p.fileInputRef.current) p.fileInputRef.current.click(); }}
                      disabled={p.uploading || p.submitting || p.attachments.length >= SUPPORT_MAX_FILES_PER_MESSAGE}
                    >
                      {p.uploading ? "Subiendo…" : "Adjuntar archivos"}
                    </Boton>
                  </div>
                </div>
              </div>
            </div>

            <div className={s.dialogoPie}>
              <Boton variante="fantasma" type="button" onClick={() => p.setShowNew(false)} disabled={p.submitting}>
                Cancelar
              </Boton>
              <Boton variante="principal" type="button" onClick={p.submitTicket} disabled={p.submitting || p.uploading}>
                {p.submitting ? "Creando…" : "Crear ticket"}
              </Boton>
            </div>
          </div>
        </div>
      )}
    </RaizSoporte>
  );
}
