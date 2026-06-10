"use client";

import { useCallback, useEffect, useState } from "react";
import { FileDown, Loader2, Mail, MessageCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { PrescriptionModal } from "@/components/clinical/shared/prescription-modal";

interface RxCums {
  descripcion?: string | null;
  presentacion?: string | null;
  cofeprisGroup?: string | null;
}

interface RxItem {
  id: string;
  dosage: string;
  duration?: string | null;
  quantity?: string | null;
  cums?: RxCums | null;
}

interface Rx {
  id: string;
  issuedAt: string;
  expiresAt?: string | null;
  verifyUrl: string;
  qrCode: string;
  cofeprisGroup?: string | null;
  cofeprisFolio?: string | null;
  diagnosis?: string | null;
  indications?: string | null;
  doctor?: { firstName: string; lastName: string } | null;
  items: RxItem[];
}

interface Props {
  patientId: string;
}

/**
 * Tab "Recetas" del expediente del paciente: listado, emisión standalone
 * (PrescriptionModal), descarga de PDF, envío por WhatsApp/email,
 * verificación pública y eliminación.
 *
 * Multi-tenant: todos los endpoints validan clinicId en el backend.
 */
export function PrescriptionsTab({ patientId }: Props) {
  const t = useT();
  const [list, setList] = useState<Rx[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const res = await fetch(`/api/prescriptions?patientId=${encodeURIComponent(patientId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setList(Array.isArray(data) ? data : []);
    } catch {
      setLoadError(true);
      setList([]);
    }
  }, [patientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function send(rx: Rx, via: "whatsapp" | "email") {
    const key = `${rx.id}:${via}`;
    setBusy(key);
    try {
      const res = await fetch(`/api/prescriptions/${rx.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ via }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
      toast.success(t(via === "whatsapp" ? "patients.prescriptionsTab.sentWhatsApp" : "patients.prescriptionsTab.sentEmail"));
    } catch (err) {
      toast.error(t("patients.prescriptionsTab.sendFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(null);
    }
  }

  async function remove(rx: Rx) {
    if (!window.confirm(t("patients.prescriptionsTab.confirmDelete"))) return;
    setBusy(`${rx.id}:delete`);
    try {
      const res = await fetch(`/api/prescriptions/${rx.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      toast.success(t("patients.prescriptionsTab.deleted"));
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function medsSummary(rx: Rx): string {
    const names = rx.items.map((it) => it.cums?.descripcion).filter(Boolean) as string[];
    if (names.length === 0) return t("patients.prescriptionsTab.medsCount", { count: rx.items.length });
    const head = names.slice(0, 2).join(", ");
    return names.length > 2 ? `${head} +${names.length - 2}` : head;
  }

  const fmtDate = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold">{t("patients.prescriptionsTab.title")}</h2>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
          style={{ background: "var(--brand)" }}
        >
          <Plus size={14} aria-hidden />
          {t("patients.prescriptionsTab.new")}
        </button>
      </div>

      {list === null ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-10 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" aria-hidden />
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-sm text-muted-foreground">
          {t("patients.prescriptionsTab.loadFailed")}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-10 text-center text-muted-foreground">
          <div className="mb-2 text-3xl">💊</div>
          <div className="text-sm font-semibold">{t("patients.prescriptionsTab.empty")}</div>
          <div className="mt-1 text-xs">{t("patients.prescriptionsTab.emptyHint")}</div>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((rx) => {
            const expired = rx.expiresAt ? new Date(rx.expiresAt).getTime() < Date.now() : false;
            return (
              <div key={rx.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold">{fmtDate(rx.issuedAt)}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={
                      expired
                        ? { background: "rgba(220, 38, 38, 0.12)", color: "#b91c1c" }
                        : { background: "rgba(16, 185, 129, 0.12)", color: "#059669" }
                    }
                  >
                    {expired ? t("patients.prescriptionsTab.statusExpired") : t("patients.prescriptionsTab.statusValid")}
                  </span>
                  {rx.cofeprisGroup && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                      style={{ background: "rgba(220, 38, 38, 0.08)", color: "#b91c1c" }}
                    >
                      {t("patients.prescriptionsTab.cofepris", { group: rx.cofeprisGroup })}
                    </span>
                  )}
                </div>

                <div className="mt-2 text-sm font-semibold">{medsSummary(rx)}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {t("patients.prescriptionsTab.medsCount", { count: rx.items.length })}
                  {rx.doctor && (
                    <> · {t("patients.prescriptionsTab.issuedBy", { doctor: `${rx.doctor.firstName} ${rx.doctor.lastName}` })}</>
                  )}
                  {" · "}
                  {rx.expiresAt
                    ? t("patients.prescriptionsTab.validUntil", { date: fmtDate(rx.expiresAt) })
                    : t("patients.prescriptionsTab.noExpiry")}
                </div>
                {rx.diagnosis && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("patients.prescriptionsTab.diagnosis", { diagnosis: rx.diagnosis })}
                  </div>
                )}
                {rx.cofeprisFolio && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t("patients.prescriptionsTab.folio", { folio: rx.cofeprisFolio })}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <a
                    href={`/api/prescriptions/${rx.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                  >
                    <FileDown size={13} aria-hidden />
                    {t("patients.prescriptionsTab.actionPdf")}
                  </a>
                  <button
                    type="button"
                    disabled={busy === `${rx.id}:whatsapp`}
                    onClick={() => send(rx, "whatsapp")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    {busy === `${rx.id}:whatsapp` ? (
                      <Loader2 size={13} className="animate-spin" aria-hidden />
                    ) : (
                      <MessageCircle size={13} aria-hidden />
                    )}
                    {t("patients.prescriptionsTab.actionWhatsApp")}
                  </button>
                  <button
                    type="button"
                    disabled={busy === `${rx.id}:email`}
                    onClick={() => send(rx, "email")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    {busy === `${rx.id}:email` ? (
                      <Loader2 size={13} className="animate-spin" aria-hidden />
                    ) : (
                      <Mail size={13} aria-hidden />
                    )}
                    {t("patients.prescriptionsTab.actionEmail")}
                  </button>
                  <a
                    href={rx.verifyUrl || `/portal/prescription/${rx.id}/verify`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                  >
                    <ShieldCheck size={13} aria-hidden />
                    {t("patients.prescriptionsTab.actionVerify")}
                  </a>
                  <button
                    type="button"
                    disabled={busy === `${rx.id}:delete`}
                    onClick={() => remove(rx)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-red-600 transition-colors hover:bg-muted disabled:opacity-60"
                  >
                    {busy === `${rx.id}:delete` ? (
                      <Loader2 size={13} className="animate-spin" aria-hidden />
                    ) : (
                      <Trash2 size={13} aria-hidden />
                    )}
                    {t("patients.prescriptionsTab.actionDelete")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <PrescriptionModal
        open={modalOpen}
        patientId={patientId}
        medicalRecordId={null}
        onClose={() => {
          setModalOpen(false);
          load();
        }}
        onCreated={() => load()}
      />
    </div>
  );
}
