"use client";
// Tab "Consentimientos" del expediente.
//
// Vive en su propio archivo y no dentro de patient-detail-client.tsx (3.400
// líneas) a propósito: el monolito ya cuesta de leer y este módulo tiene tres
// modales propios.
//
// Lo que la pantalla tiene que dejar claro de un vistazo es la COMPLETITUD del
// documento, no solo si está firmado: una carta con la firma del paciente pero
// sin la del profesional está incompleta según la NOM-004 numeral 10.1.1, y
// hasta ahora no había forma de notarlo.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check, Copy, FileDown, FileSignature, Loader2, MessageCircle,
  PenLine, Plus, RefreshCw, Trash2, XCircle,
} from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { useConfirm, useConfirmWithReason } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { SignaturePad } from "@/components/ui/signature-pad";
import { listConsentTemplates } from "@/lib/consent/templates";
import type { ConsentDTO, ConsentStatus } from "@/lib/consent/types";

interface DoctorOption {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ConsentsTabProps {
  patientId: string;
  /** Snapshot del server component: la lista se pinta sin esperar al fetch. */
  initialConsents: ConsentDTO[];
  doctors: DoctorOption[];
  /** Usuario de la sesión — default del selector de responsable. */
  currentUserId: string;
  canCreate: boolean;
  canRevoke: boolean;
  /** "whatsapp.send" — sin él no se ofrece el envío (la API lo revalida). */
  canSendWhatsApp: boolean;
  /** Solo el profesional responsable contrafirma (la API revalida el rol). */
  canCountersign: boolean;
}

const STATUS_STYLE: Record<ConsentStatus, { labelKey: string; bg: string; fg: string }> = {
  PENDING: { labelKey: "patients.consents.statusPending", bg: "rgba(245, 158, 11, 0.14)", fg: "#b45309" },
  EXPIRED: { labelKey: "patients.consents.statusExpired", bg: "rgba(100, 116, 139, 0.16)", fg: "#475569" },
  SIGNED: { labelKey: "patients.consents.statusSigned", bg: "rgba(16, 185, 129, 0.14)", fg: "#059669" },
  REVOKED: { labelKey: "patients.consents.statusRevoked", bg: "rgba(220, 38, 38, 0.14)", fg: "#b91c1c" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
}

export function ConsentsTab(props: ConsentsTabProps) {
  const {
    patientId, initialConsents, doctors, currentUserId,
    canCreate, canRevoke, canSendWhatsApp, canCountersign,
  } = props;
  const t = useT();
  const confirm = useConfirm();
  const confirmWithReason = useConfirmWithReason();

  const [list, setList] = useState<ConsentDTO[]>(initialConsents);
  const [busy, setBusy] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [countersigning, setCountersigning] = useState<ConsentDTO | null>(null);

  useEffect(() => { setList(initialConsents); }, [initialConsents]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/consent?patientId=${encodeURIComponent(patientId)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setList(data);
    } catch {
      /* la lista anterior sigue siendo válida: no se vacía por un fallo de red */
    }
  }, [patientId]);

  function publicUrl(token: string): string {
    return `${window.location.origin}/consentimiento/${token}`;
  }

  async function copyLink(c: ConsentDTO) {
    try {
      await navigator.clipboard.writeText(publicUrl(c.token));
      setCopiedId(c.id);
      setTimeout(() => setCopiedId((v) => (v === c.id ? null : v)), 2000);
    } catch {
      toast.error(t("patients.consents.copyFailed"));
    }
  }

  async function post(c: ConsentDTO, path: string, key: string, body?: unknown) {
    setBusy(`${c.id}:${key}`);
    try {
      const res = await fetch(`/api/consent/${c.id}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("patients.consents.genericError"));
      await load();
      return out;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function sendWhatsApp(c: ConsentDTO) {
    const out = await post(c, "/send-whatsapp", "wa");
    if (out) toast.success(t("patients.consents.sentWhatsApp"));
  }

  async function renew(c: ConsentDTO) {
    const out = await post(c, "/renew", "renew");
    if (out) toast.success(t("patients.consents.linkRenewed"));
  }

  async function revoke(c: ConsentDTO) {
    const result = await confirmWithReason({
      title: t("patients.consents.revokeTitle"),
      description: t("patients.consents.revokeBody", { procedure: c.procedure }),
      variant: "warning",
      withReason: true,
      reasonLabel: t("patients.consents.revokeReasonLabel"),
      reasonPlaceholder: t("patients.consents.revokeReasonPlaceholder"),
      confirmText: t("patients.consents.revokeConfirm"),
    });
    if (!result.confirmed) return;
    const reason = (result.reason ?? "").trim();
    if (!reason) {
      // El motivo queda en el expediente: sin él la revocación no dice nada.
      toast.error(t("patients.consents.revokeReasonRequired"));
      return;
    }
    const out = await post(c, "/revoke", "revoke", { reason });
    if (out) toast.success(t("patients.consents.revoked"));
  }

  async function remove(c: ConsentDTO) {
    const ok = await confirm({
      title: t("patients.consents.deleteTitle"),
      description: t("patients.consents.deleteBody", { procedure: c.procedure }),
      variant: "danger",
      confirmText: t("patients.consents.deleteConfirm"),
    });
    if (!ok) return;
    setBusy(`${c.id}:delete`);
    try {
      const res = await fetch(`/api/consent/${c.id}`, { method: "DELETE" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("patients.consents.genericError"));
      toast.success(t("patients.consents.deleted"));
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold flex items-center gap-2">
            <FileSignature size={15} style={{ color: "var(--brand)" }} aria-hidden />
            {t("patients.consents.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{t("patients.consents.subtitle")}</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setNewOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
            style={{ background: "var(--brand)" }}
          >
            <Plus size={14} aria-hidden /> {t("patients.consents.new")}
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-muted-foreground">
          <FileSignature size={28} className="mx-auto mb-2 opacity-40" aria-hidden />
          <div className="text-sm font-semibold">{t("patients.consents.empty")}</div>
          <div className="mt-1 text-xs">{t("patients.consents.emptyHint")}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((c) => {
            const style = STATUS_STYLE[c.status] ?? STATUS_STYLE.PENDING;
            const isBusy = busy?.startsWith(`${c.id}:`) ?? false;
            const pending = c.status === "PENDING" || c.status === "EXPIRED";
            return (
              <div key={c.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{c.procedure}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={{ background: style.bg, color: style.fg }}
                  >
                    {t(style.labelKey)}
                  </span>
                  {c.signerName ? (
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold bg-muted text-muted-foreground">
                      {t("patients.consents.byRepresentative")}
                    </span>
                  ) : null}
                </div>

                <div className="mt-1 text-xs text-muted-foreground">
                  {t("patients.consents.createdOn", { date: fmtDate(c.createdAt) })}
                  {c.signedAt
                    ? ` · ${t("patients.consents.signedOn", { date: fmtDate(c.signedAt) })}`
                    : ` · ${t("patients.consents.expiresOn", { date: fmtDate(c.expiresAt) })}`}
                  {c.viewedAt && !c.signedAt
                    ? ` · ${t("patients.consents.viewedOn", { date: fmtDate(c.viewedAt) })}`
                    : ""}
                </div>

                {/* Completitud de firmas — lo que dice si el documento está entero. */}
                <div className="mt-1.5 text-xs font-semibold text-muted-foreground">
                  {t("patients.consents.completeness", {
                    patient: c.signedAt ? "✓" : "—",
                    witnesses: `${c.witnessCount}/2`,
                    doctor: c.doctorSignedAt ? "✓" : "—",
                  })}
                </div>

                {c.revokedAt ? (
                  <div className="mt-1.5 text-xs" style={{ color: "#b91c1c" }}>
                    {t("patients.consents.revokedOn", { date: fmtDate(c.revokedAt) })}
                    {c.revokedReason ? ` · ${c.revokedReason}` : ""}
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    href={`/api/consent/${c.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                  >
                    <FileDown size={13} aria-hidden /> {t("patients.consents.actionPdf")}
                  </a>

                  {!c.revokedAt && (
                    <button
                      type="button"
                      onClick={() => copyLink(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                    >
                      {copiedId === c.id ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
                      {copiedId === c.id ? t("patients.consents.copied") : t("patients.consents.actionCopyLink")}
                    </button>
                  )}

                  {canSendWhatsApp && canCreate && !c.revokedAt && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => sendWhatsApp(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60"
                    >
                      {busy === `${c.id}:wa` ? (
                        <Loader2 size={13} className="animate-spin" aria-hidden />
                      ) : (
                        <MessageCircle size={13} aria-hidden />
                      )}
                      {t("patients.consents.actionWhatsApp")}
                    </button>
                  )}

                  {/* Flujo de tableta: se abre la liga en otra pestaña y el
                      paciente firma ahí mismo, delante del equipo. */}
                  {c.status === "PENDING" && (
                    <a
                      href={`/consentimiento/${c.token}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
                      style={{ background: "var(--brand)", borderColor: "var(--brand)", color: "#fff" }}
                    >
                      <PenLine size={13} aria-hidden /> {t("patients.consents.actionSignHere")}
                    </a>
                  )}

                  {c.status === "EXPIRED" && canCreate && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => renew(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60"
                    >
                      {busy === `${c.id}:renew` ? (
                        <Loader2 size={13} className="animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw size={13} aria-hidden />
                      )}
                      {t("patients.consents.actionRenew")}
                    </button>
                  )}

                  {canCountersign && canCreate && c.signedAt && !c.doctorSignedAt && !c.revokedAt && (
                    <button
                      type="button"
                      onClick={() => setCountersigning(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                    >
                      <PenLine size={13} aria-hidden /> {t("patients.consents.actionCountersign")}
                    </button>
                  )}

                  {canRevoke && c.status === "SIGNED" && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => revoke(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60"
                      style={{ color: "#b45309" }}
                    >
                      <XCircle size={13} aria-hidden /> {t("patients.consents.actionRevoke")}
                    </button>
                  )}

                  {/* Eliminar SOLO pendientes: uno firmado se conserva siempre
                      (la API responde 409 aunque se fuerce la petición). */}
                  {canRevoke && pending && (
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => remove(c)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-muted disabled:opacity-60"
                    >
                      {busy === `${c.id}:delete` ? (
                        <Loader2 size={13} className="animate-spin" aria-hidden />
                      ) : (
                        <Trash2 size={13} aria-hidden />
                      )}
                      {t("patients.consents.actionDelete")}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canCreate && (
        <NewConsentModal
          open={newOpen}
          onClose={() => setNewOpen(false)}
          patientId={patientId}
          doctors={doctors}
          currentUserId={currentUserId}
          canSendWhatsApp={canSendWhatsApp}
          onCreated={load}
        />
      )}

      {countersigning && (
        <CountersignModal
          consent={countersigning}
          onClose={() => setCountersigning(null)}
          onDone={async () => { setCountersigning(null); await load(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal: nuevo consentimiento
// ---------------------------------------------------------------------------

function NewConsentModal({
  open, onClose, patientId, doctors, currentUserId, canSendWhatsApp, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  patientId: string;
  doctors: DoctorOption[];
  currentUserId: string;
  canSendWhatsApp: boolean;
  onCreated: () => Promise<void> | void;
}) {
  const t = useT();
  const templates = useMemo(() => listConsentTemplates(), []);
  const [procedureKey, setProcedureKey] = useState(templates[0]?.key ?? "");
  const [doctorId, setDoctorId] = useState(
    doctors.some((d) => d.id === currentUserId) ? currentUserId : (doctors[0]?.id ?? ""),
  );
  const [byRepresentative, setByRepresentative] = useState(false);
  const [signerName, setSignerName] = useState("");
  const [signerRelation, setSignerRelation] = useState("");
  const [content, setContent] = useState("");
  const [loadingText, setLoadingText] = useState(false);
  // `touched` evita que el regenerado pise lo que el doctor ya escribió: el
  // texto es lo que va a firmar el paciente, no un borrador que la UI pueda
  // sobrescribir por cambiar un selector.
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ id: string; signUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Regenera el borrador cuando cambian los datos que lo componen.
  //
  // Con retardo: el nombre del representante se escribe letra a letra y sin
  // esperar saldría una petición por tecla — y cada respuesta reescribiría el
  // textarea a media escritura. Se pide una sola vez, 400 ms después del
  // último cambio.
  useEffect(() => {
    if (!open || touched || created) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ patientId, procedureKey });
      if (doctorId) params.set("doctorId", doctorId);
      if (byRepresentative && signerName.trim()) {
        params.set("signerName", signerName.trim());
        params.set("signerRelation", signerRelation.trim());
      }
      setLoadingText(true);
      fetch(`/api/consent/preview?${params.toString()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (!cancelled && d?.content) setContent(d.content); })
        .catch(() => undefined)
        .finally(() => { if (!cancelled) setLoadingText(false); });
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, touched, created, patientId, procedureKey, doctorId, byRepresentative, signerName, signerRelation]);

  function reset() {
    setCreated(null);
    setError(null);
    setTouched(false);
    setContent("");
    setByRepresentative(false);
    setSignerName("");
    setSignerRelation("");
  }

  async function create() {
    if (byRepresentative && (!signerName.trim() || !signerRelation.trim())) {
      setError(t("patients.consents.errorRepresentative"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          procedureKey,
          doctorId: doctorId || undefined,
          // El texto SIEMPRE viaja: es el snapshot que firmará el paciente,
          // editado o no.
          content: content.trim() || undefined,
          procedure: templates.find((x) => x.key === procedureKey)?.label,
          signerName: byRepresentative ? signerName.trim() : undefined,
          signerRelation: byRepresentative ? signerRelation.trim() : undefined,
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("patients.consents.genericError"));
      setCreated({ id: out.id, signUrl: out.signUrl });
      await onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function sendCreated() {
    if (!created) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/consent/${created.id}/send-whatsapp`, { method: "POST" });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("patients.consents.genericError"));
      toast.success(t("patients.consents.sentWhatsApp"));
      await onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="text-foreground font-bold">
            {created ? t("patients.consents.createdTitle") : t("patients.consents.newTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          {created ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{t("patients.consents.createdHint")}</p>
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs break-all">
                {created.signUrl}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(created.signUrl).then(
                      () => toast.success(t("patients.consents.copied")),
                      () => toast.error(t("patients.consents.copyFailed")),
                    );
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted"
                >
                  <Copy size={13} aria-hidden /> {t("patients.consents.actionCopyLink")}
                </button>
                {canSendWhatsApp && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={sendCreated}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:bg-muted disabled:opacity-60"
                  >
                    <MessageCircle size={13} aria-hidden /> {t("patients.consents.actionWhatsApp")}
                  </button>
                )}
                <a
                  href={created.signUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white hover:opacity-90"
                  style={{ background: "var(--brand)" }}
                >
                  <PenLine size={13} aria-hidden /> {t("patients.consents.actionSignHere")}
                </a>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t("patients.consents.fieldProcedure")}
                  </span>
                  <select
                    value={procedureKey}
                    onChange={(e) => setProcedureKey(e.target.value)}
                    className={inputCls}
                  >
                    {templates.map((tpl) => (
                      <option key={tpl.key} value={tpl.key}>{tpl.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                    {t("patients.consents.fieldDoctor")}
                  </span>
                  <select
                    value={doctorId}
                    onChange={(e) => setDoctorId(e.target.value)}
                    className={inputCls}
                  >
                    {doctors.map((d) => (
                      <option key={d.id} value={d.id}>{d.firstName} {d.lastName}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-start gap-2.5 rounded-lg border border-border p-3">
                <input
                  type="checkbox"
                  checked={byRepresentative}
                  onChange={(e) => setByRepresentative(e.target.checked)}
                  className="mt-0.5 h-4 w-4 flex-shrink-0"
                />
                <span className="text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">
                    {t("patients.consents.fieldRepresentative")}
                  </span>
                  <br />
                  {t("patients.consents.representativeHint")}
                </span>
              </label>

              {byRepresentative && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t("patients.consents.fieldSignerName")}
                    </span>
                    <input
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      className={inputCls}
                      placeholder={t("patients.consents.signerNamePlaceholder")}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {t("patients.consents.fieldSignerRelation")}
                    </span>
                    <input
                      value={signerRelation}
                      onChange={(e) => setSignerRelation(e.target.value)}
                      className={inputCls}
                      placeholder={t("patients.consents.signerRelationPlaceholder")}
                    />
                  </label>
                </div>
              )}

              <label className="block">
                <span className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {t("patients.consents.fieldContent")}
                  {loadingText ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
                </span>
                <textarea
                  value={content}
                  onChange={(e) => { setContent(e.target.value); setTouched(true); }}
                  rows={14}
                  className={`${inputCls} resize-y font-mono text-xs leading-relaxed`}
                />
                <span className="mt-1 block text-[11px] text-muted-foreground">
                  {t("patients.consents.contentHint")}
                </span>
              </label>

              {error ? <p className="text-xs text-red-600">{error}</p> : null}
            </>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => { reset(); onClose(); }}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:bg-muted"
          >
            {created ? t("common.close") : t("common.cancel")}
          </button>
          {!created && (
            <button
              type="button"
              disabled={saving || !content.trim()}
              onClick={create}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60"
              style={{ background: "var(--brand)" }}
            >
              {saving ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
              {t("patients.consents.createCta")}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Modal: contrafirma del profesional
// ---------------------------------------------------------------------------

function CountersignModal({
  consent, onClose, onDone,
}: {
  consent: ConsentDTO;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const t = useT();
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!signature) { setError(t("patients.consents.countersignEmpty")); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/consent/${consent.id}/countersign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureDataUrl: signature }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error ?? t("patients.consents.genericError"));
      toast.success(t("patients.consents.countersigned"));
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-foreground font-bold">
            {t("patients.consents.countersignTitle")}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("patients.consents.countersignBody", { procedure: consent.procedure })}
          </p>
          <SignaturePad
            width={560}
            height={180}
            onChange={setSignature}
            ariaLabel={t("patients.consents.countersignAria")}
          />
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-xs font-semibold hover:bg-muted"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !signature}
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white hover:opacity-90 disabled:opacity-60"
            style={{ background: "var(--brand)" }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
            {t("patients.consents.countersignCta")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
