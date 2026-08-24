"use client";

import { useCallback, useRef, useState } from "react";
import { FileText, LifeBuoy, Paperclip, Plus, Send, X } from "lucide-react";
import { prepararImagen } from "@/lib/image-client";
import type { BarberSupportAttachment } from "@/lib/barber/types";
import type { BarberTicketDetail, BarberTicketRow } from "@/lib/barber/support";
import type { AdminBranchOption } from "../team/admin-nav";
import {
  adminStyles as s,
  apiCall,
  Banner,
  Btn,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  formatWhen,
  Modal,
  Select,
  TextArea,
  TextInput,
  useSaving,
  useT,
} from "../team/admin-ui";

// ═══════════════════════════════════════════════════════════════════════
// /barber/soporte — tickets a DaleControl (lado barbería).
//
// Adjuntos: la imagen se comprime EN EL NAVEGADOR (prepararImagen) antes de
// salir, se sube a /api/barber/support/attachments (que la guarda bajo
// support/{barbershopId}/ y revalida el tipo real por magic number) y al
// mensaje solo viajan los metadatos. Las ligas de lectura son firmadas y de
// vida corta: se generan al abrir el hilo.
// ═══════════════════════════════════════════════════════════════════════

const CATEGORIES = ["BUG", "DUDA", "FACTURACION", "SUGERENCIA"] as const;
const PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;

export interface SupportLimits {
  maxFiles: number;
  maxFileBytes: number;
  allowedMime: readonly string[];
  subjectMax: number;
  bodyMax: number;
}

type Pending = BarberSupportAttachment;

/** Sube archivos (comprimiendo imágenes) y devuelve sus metadatos. */
function useUploader(limits: SupportLimits, branchId: string | null) {
  const t = useT();
  const [files, setFiles] = useState<Pending[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    async (picked: FileList | null) => {
      if (!picked || picked.length === 0) return;
      setError(null);
      const room = limits.maxFiles - files.length;
      if (room <= 0) {
        setError(t("support.attachTooMany", { max: limits.maxFiles }));
        return;
      }
      const list = Array.from(picked).slice(0, room);

      for (const original of list) {
        try {
          let file = original;
          if (original.type.startsWith("image/")) {
            setBusy(t("support.compressing"));
            file = await prepararImagen(original);
          }
          if (!limits.allowedMime.includes(file.type)) {
            setError(t("support.attachBadType"));
            continue;
          }
          if (file.size > limits.maxFileBytes) {
            setError(
              t("support.attachTooBig", {
                size: Math.round(limits.maxFileBytes / (1024 * 1024)),
              }),
            );
            continue;
          }

          setBusy(t("support.uploading"));
          const body = new FormData();
          body.append("file", file);
          if (branchId) body.append("branchId", branchId);
          const meta = await apiCall<Pending>("/api/barber/support/attachments", {
            method: "POST",
            body,
          });
          setFiles((prev) => prev.concat(meta));
        } catch (err) {
          setError(err instanceof Error ? err.message : t("common.genericError"));
        } finally {
          setBusy(null);
        }
      }
    },
    [branchId, files.length, limits, t],
  );

  const remove = useCallback((path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path));
  }, []);

  const reset = useCallback(() => {
    setFiles([]);
    setError(null);
  }, []);

  return { files, busy, error, add, remove, reset };
}

function AttachPicker({
  limits,
  uploader,
}: {
  limits: SupportLimits;
  uploader: ReturnType<typeof useUploader>;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Btn
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={Boolean(uploader.busy) || uploader.files.length >= limits.maxFiles}
        >
          <Paperclip size={13} />
          {uploader.busy ?? t("support.attachAdd")}
        </Btn>
        <span className={s.hint}>
          {t("support.attachHint", {
            max: limits.maxFiles,
            size: Math.round(limits.maxFileBytes / (1024 * 1024)),
          })}
        </span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className={s.srOnly}
        accept={limits.allowedMime.join(",")}
        onChange={(e) => {
          void uploader.add(e.target.files);
          e.target.value = "";
        }}
      />
      <ErrorText>{uploader.error}</ErrorText>
      {uploader.files.length > 0 ? (
        <div className={s.attachRow}>
          {uploader.files.map((f) => (
            <span key={f.path} className={s.attachFile}>
              <FileText size={13} />
              <span className={s.truncate}>{f.name}</span>
              <button
                type="button"
                onClick={() => uploader.remove(f.path)}
                aria-label={t("support.attachRemove")}
                style={{
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  color: "var(--text-3)",
                  padding: 0,
                  display: "flex",
                }}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SupportClient({
  initialTickets,
  initialDetail,
  canWrite,
  limits,
  locale,
  branches,
  activeBranchId,
  isConsolidated,
}: {
  initialTickets: BarberTicketRow[];
  initialDetail: BarberTicketDetail | null;
  canWrite: boolean;
  limits: SupportLimits;
  locale: string;
  branches: AdminBranchOption[];
  activeBranchId: string | null;
  isConsolidated: boolean;
}) {
  const t = useT();
  const [tickets, setTickets] = useState(initialTickets);
  const [detail, setDetail] = useState<BarberTicketDetail | null>(initialDetail);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [reply, setReply] = useState("");
  const [newTicket, setNewTicket] = useState<{
    subject: string;
    category: string;
    priority: string;
    body: string;
    barbershopId: string;
  } | null>(null);

  const writeBranchId = activeBranchId ?? branches[0]?.id ?? null;
  const replyUploader = useUploader(limits, detail?.ticket.barbershopId ?? writeBranchId);
  const newUploader = useUploader(limits, newTicket?.barbershopId ?? writeBranchId);
  const { saving, error, setError, run } = useSaving();

  function upsertTicket(next: BarberTicketRow) {
    setTickets((list) => {
      const without = list.filter((x) => x.id !== next.id);
      return [next, ...without].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    });
  }

  async function open(id: string) {
    if (loadingId) return;
    setLoadingId(id);
    setThreadError(null);
    try {
      const data = await apiCall<BarberTicketDetail>(`/api/barber/support/tickets/${id}`);
      setDetail(data);
      upsertTicket(data.ticket);
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : t("common.genericError"));
    } finally {
      setLoadingId(null);
    }
  }

  async function submitNew() {
    if (!newTicket) return;
    const ok = await run(async () => {
      const { ticket } = await apiCall<{ ticket: BarberTicketRow }>(
        "/api/barber/support/tickets",
        {
          method: "POST",
          json: { ...newTicket, attachments: newUploader.files },
        },
      );
      upsertTicket(ticket);
      newUploader.reset();
      await open(ticket.id);
    });
    if (ok) setNewTicket(null);
  }

  async function submitReply() {
    if (!detail) return;
    if (!reply.trim() && replyUploader.files.length === 0) return;
    setComposing(true);
    setThreadError(null);
    try {
      const data = await apiCall<BarberTicketDetail>(
        `/api/barber/support/tickets/${detail.ticket.id}/messages`,
        { method: "POST", json: { body: reply, attachments: replyUploader.files } },
      );
      setDetail(data);
      upsertTicket(data.ticket);
      setReply("");
      replyUploader.reset();
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : t("common.genericError"));
    } finally {
      setComposing(false);
    }
  }

  async function toggleClosed() {
    if (!detail) return;
    const closed = detail.ticket.status !== "CLOSED";
    setThreadError(null);
    try {
      const data = await apiCall<BarberTicketDetail>(
        `/api/barber/support/tickets/${detail.ticket.id}`,
        { method: "PATCH", json: { closed } },
      );
      setDetail(data);
      upsertTicket(data.ticket);
    } catch (err) {
      setThreadError(err instanceof Error ? err.message : t("common.genericError"));
    }
  }

  return (
    <>
      <header className={s.header}>
        <div className={s.headerText}>
          <h1 className={s.title}>{t("support.title")}</h1>
          <p className={s.subtitle}>{t("support.subtitle")}</p>
        </div>
        {canWrite ? (
          <div className={s.headerActions}>
            <Btn
              variant="primary"
              onClick={() =>
                setNewTicket({
                  subject: "",
                  category: "BUG",
                  priority: "NORMAL",
                  body: "",
                  barbershopId: writeBranchId ?? "",
                })
              }
            >
              <Plus size={15} />
              {t("support.new")}
            </Btn>
          </div>
        ) : null}
      </header>

      <div className={s.supportShell}>
      <div className={s.supportLayout}>
        <div className={s.card}>
          <div className={s.permGroupTitle} style={{ padding: "12px 14px 4px" }}>
            {t("support.listTitle")}
          </div>
          {tickets.length === 0 ? (
            <EmptyState
              icon={<LifeBuoy size={22} />}
              title={t("support.empty")}
              body={t("support.emptyBody")}
            />
          ) : (
            <div className={s.ticketList}>
              {tickets.map((ticket) => (
                <button
                  key={ticket.id}
                  type="button"
                  className={s.ticketItem}
                  aria-current={detail?.ticket.id === ticket.id}
                  onClick={() => open(ticket.id)}
                >
                  <span className={s.ticketSubject}>{ticket.subject}</span>
                  <span className={s.ticketMeta}>
                    <Chip tone={ticket.status === "CLOSED" ? "muted" : undefined}>
                      {t(`ticketStatus.${ticket.status}`)}
                    </Chip>
                    {ticket.hasNewReply ? <Chip tone="brand">{t("support.newReply")}</Chip> : null}
                    {ticket.priority === "HIGH" ? (
                      <Chip tone="danger">{t("ticketPriority.HIGH")}</Chip>
                    ) : null}
                    {isConsolidated ? <Chip tone="muted">{ticket.branchLabel}</Chip> : null}
                    <span>{formatWhen(ticket.lastMessageAt, locale)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={[s.card, s.cardPad].join(" ")}>
          {!detail ? (
            <EmptyState icon={<LifeBuoy size={22} />} title={t("support.emptyThread")} />
          ) : (
            <div className={s.thread}>
              <div>
                <div className={s.rowTitle}>{detail.ticket.subject}</div>
                <div className={s.rowMeta} style={{ marginTop: 6 }}>
                  <Chip>{t(`ticketCategory.${detail.ticket.category}`)}</Chip>
                  <Chip tone={detail.ticket.status === "CLOSED" ? "muted" : "brand"}>
                    {t(`ticketStatus.${detail.ticket.status}`)}
                  </Chip>
                  <Chip tone="muted">{t(`ticketPriority.${detail.ticket.priority}`)}</Chip>
                  {isConsolidated ? <Chip tone="muted">{detail.ticket.branchLabel}</Chip> : null}
                </div>
                <p className={s.hint} style={{ marginTop: 6 }}>
                  {t("support.openedBy", { name: detail.ticket.createdByName ?? "" })} ·{" "}
                  {t("support.openedAt", { date: formatWhen(detail.ticket.createdAt, locale) })}
                </p>
              </div>

              <ErrorText>{threadError}</ErrorText>

              <div className={s.msgList}>
                {detail.messages.map((m) => (
                  <div
                    key={m.id}
                    className={[s.msg, m.authorType === "SHOP" ? s.msgShop : s.msgAdmin].join(" ")}
                  >
                    <div className={s.msgBubble}>{m.body}</div>
                    {m.attachments.length > 0 ? (
                      <div className={s.attachRow}>
                        {m.attachments.map((a) =>
                          a.type.startsWith("image/") && a.signedUrl ? (
                            <a
                              key={a.path}
                              href={a.signedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={s.attachThumb}
                            >
                              <img src={a.signedUrl} alt={a.name} loading="lazy" />
                            </a>
                          ) : (
                            <a
                              key={a.path}
                              href={a.signedUrl ?? "#"}
                              target="_blank"
                              rel="noreferrer"
                              className={s.attachFile}
                            >
                              <FileText size={13} />
                              <span className={s.truncate}>{a.name}</span>
                            </a>
                          ),
                        )}
                      </div>
                    ) : null}
                    <span className={s.msgMeta}>
                      {m.authorType === "SHOP"
                        ? m.authorName ?? t("support.authorShop")
                        : t("support.authorAdmin")}{" "}
                      · {formatWhen(m.createdAt, locale)}
                    </span>
                  </div>
                ))}
              </div>

              {canWrite ? (
                <div className={s.composer}>
                  {detail.ticket.status === "CLOSED" ? (
                    <p className={s.hint}>{t("support.closedNote")}</p>
                  ) : null}
                  <TextArea
                    value={reply}
                    maxLength={limits.bodyMax}
                    placeholder={t("support.replyPlaceholder")}
                    onChange={(e) => setReply(e.target.value)}
                  />
                  <AttachPicker limits={limits} uploader={replyUploader} />
                  <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                    <Btn size="sm" onClick={toggleClosed} disabled={composing}>
                      {detail.ticket.status === "CLOSED"
                        ? t("support.reopenTicket")
                        : t("support.closeTicket")}
                    </Btn>
                    <Btn
                      variant="primary"
                      size="sm"
                      onClick={submitReply}
                      disabled={composing || (!reply.trim() && replyUploader.files.length === 0)}
                    >
                      <Send size={13} />
                      {composing ? t("support.sending") : t("support.reply")}
                    </Btn>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
      </div>

      {newTicket ? (
        <Modal
          title={t("support.new")}
          onClose={() => {
            setNewTicket(null);
            newUploader.reset();
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setNewTicket(null)} disabled={saving}>
                {t("common.cancel")}
              </Btn>
              <Btn variant="primary" onClick={submitNew} disabled={saving}>
                <Send size={14} />
                {saving ? t("support.sending") : t("support.send")}
              </Btn>
            </>
          }
        >
          <ErrorText>{error}</ErrorText>
          <Field label={t("support.subject")}>
            {(id) => (
              <TextInput
                id={id}
                value={newTicket.subject}
                maxLength={limits.subjectMax}
                placeholder={t("support.subjectPlaceholder")}
                onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })}
              />
            )}
          </Field>
          <div className={s.formGrid}>
            <Field label={t("support.category")}>
              {(id) => (
                <Select
                  id={id}
                  value={newTicket.category}
                  onChange={(e) => setNewTicket({ ...newTicket, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`ticketCategory.${c}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("support.priority")}>
              {(id) => (
                <Select
                  id={id}
                  value={newTicket.priority}
                  onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value })}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`ticketPriority.${p}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {branches.length > 1 ? (
              <Field label={t("branch.label")} full>
                {(id) => (
                  <Select
                    id={id}
                    value={newTicket.barbershopId}
                    onChange={(e) =>
                      setNewTicket({ ...newTicket, barbershopId: e.target.value })
                    }
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </div>
          <Field label={t("support.message")}>
            {(id) => (
              <TextArea
                id={id}
                value={newTicket.body}
                maxLength={limits.bodyMax}
                placeholder={t("support.messagePlaceholder")}
                onChange={(e) => setNewTicket({ ...newTicket, body: e.target.value })}
              />
            )}
          </Field>
          <div className={s.field}>
            <span className={s.label}>{t("support.attachments")}</span>
            <AttachPicker limits={limits} uploader={newUploader} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}
