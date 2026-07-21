"use client";
import { useEffect, useState } from "react";
import { X, Users } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { DIRECTORY_CATEGORIES } from "@/lib/directory/types";
import { PATIENT_SHARING_ENABLED } from "@/lib/branches-shared";
import type { BranchDefaults, BranchQuota, OwnedBranchRow } from "@/lib/branches-shared";

interface Props {
  open: boolean;
  onClose: () => void;
  defaults: BranchDefaults;
  quota: BranchQuota;
  /** Se llama tras crear: la cookie de clínica activa ya apunta a la sede nueva. */
  onCreated: () => void;
}

/**
 * MULTI-CLÍNICA · FASE 1 — alta de una sucursal bajo el mismo dueño.
 *
 * El form nace prellenado con la categoría/ciudad/estado de la sede actual
 * (una sucursal casi siempre es del mismo giro y zona). El gate REAL vive en
 * POST /api/clinics: aquí sólo evitamos pedir datos si ya sabemos que no puede.
 */
export function NewBranchDialog({ open, onClose, defaults, quota, onCreated }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", category: defaults.category, city: defaults.city, state: defaults.state, phone: "" });
  const [nameError, setNameError] = useState(false);
  // FASE 2 — sedes existentes del dueño y cuáles compartirán pacientes con la
  // sucursal nueva. Se cargan al abrir el diálogo (no en cada render).
  const [branches, setBranches] = useState<OwnedBranchRow[]>([]);
  const [shareWith, setShareWith] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    setForm({ name: "", category: defaults.category, city: defaults.city, state: defaults.state, phone: "" });
    setNameError(false);
    setShareWith([]);
  }, [open, defaults.category, defaults.city, defaults.state]);

  useEffect(() => {
    if (!open || !PATIENT_SHARING_ENABLED) return;
    let cancelled = false;
    fetch("/api/clinics/links", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (cancelled || !payload) return;
        setBranches(Array.isArray(payload.branches) ? payload.branches : []);
      })
      .catch(() => { /* el selector simplemente no aparece */ });
    return () => { cancelled = true; };
  }, [open]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const toggleShare = (clinicId: string) =>
    setShareWith((prev) =>
      prev.indexOf(clinicId) === -1 ? [...prev, clinicId] : prev.filter((id) => id !== clinicId),
    );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 2) {
      setNameError(true);
      toast.error(t("sidebar.branches.errName"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/clinics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: form.name.trim(),
          category: form.category,
          city: form.city.trim() || undefined,
          state: form.state.trim() || undefined,
          phone: form.phone.trim() || undefined,
          sharePatientsWith: shareWith.length > 0 ? shareWith : undefined,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? t("sidebar.branches.errCreate"));
      toast.success(t("sidebar.branches.created", { name: payload.name ?? form.name.trim() }));
      onCreated();
    } catch (err: any) {
      toast.error(err?.message ?? t("sidebar.branches.errCreate"));
    } finally {
      setLoading(false);
    }
  }

  // 17 categorías del directorio + OTHER (el enum ClinicCategory completo).
  const categoryOptions = [
    ...DIRECTORY_CATEGORIES.map((c) => ({ value: c.category as string, label: c.label })),
    { value: "OTHER", label: t("sidebar.branches.categoryOther") },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay
          style={{ position: "fixed", inset: 0, background: "rgba(15,10,30,0.55)", backdropFilter: "blur(4px)", zIndex: 90 }}
        />
        <Dialog.Content
          className="modal"
          onEscapeKeyDown={onClose}
          aria-describedby={undefined}
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 91,
            maxHeight: "92vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <Dialog.Title className="modal__title" style={{ display: "none" }}>{t("sidebar.branches.newTitle")}</Dialog.Title>
          <div className="modal__header" style={{ flexShrink: 0 }}>
            <div className="modal__title">{t("sidebar.branches.newTitle")}</div>
            <Dialog.Close asChild>
              <button type="button" className="btn-new btn-new--ghost btn-new--sm" aria-label={t("common.close")}>
                <X size={14} />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, overflow: "hidden" }}>
            <div className="modal__body" style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
              <p style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 16, lineHeight: 1.5 }}>
                {quota.max === null
                  ? t("sidebar.branches.introUnlimited")
                  : t("sidebar.branches.intro", { used: String(quota.used), max: String(quota.max) })}
              </p>

              <div className="field-new">
                <label className="field-new__label" htmlFor="branch-name">
                  {t("sidebar.branches.name")} <span className="req">*</span>
                </label>
                <input
                  id="branch-name"
                  className="input-new"
                  placeholder={t("sidebar.branches.namePlaceholder")}
                  maxLength={80}
                  value={form.name}
                  onChange={(e) => { set("name", e.target.value); if (nameError) setNameError(false); }}
                  style={{ borderColor: nameError ? "#ef4444" : undefined }}
                />
              </div>

              <div className="field-new">
                <label className="field-new__label" htmlFor="branch-category">{t("sidebar.branches.category")}</label>
                <select
                  id="branch-category"
                  className="input-new"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  {categoryOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0 14px" }}>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="branch-city">{t("sidebar.branches.city")}</label>
                  <input id="branch-city" className="input-new" maxLength={60} value={form.city} onChange={(e) => set("city", e.target.value)} />
                </div>
                <div className="field-new">
                  <label className="field-new__label" htmlFor="branch-state">{t("sidebar.branches.state")}</label>
                  <input id="branch-state" className="input-new" maxLength={60} value={form.state} onChange={(e) => set("state", e.target.value)} />
                </div>
              </div>

              <div className="field-new">
                <label className="field-new__label" htmlFor="branch-phone">{t("sidebar.branches.phone")}</label>
                <input id="branch-phone" className="input-new" maxLength={30} placeholder="999 123 4567" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </div>

              {/* MULTI-CLÍNICA · FASE 2 — compartir pacientes selectivo.
                  Con PATIENT_SHARING_ENABLED apagado se pinta EXACTAMENTE el
                  aviso "próximamente" de siempre, así que mergear no cambia
                  nada en producción. Encendido, se vuelve un selector real. */}
              {!PATIENT_SHARING_ENABLED || branches.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    marginTop: 6,
                    padding: "10px 12px",
                    border: "1px dashed var(--border-strong)",
                    borderRadius: 10,
                    background: "var(--bg-subtle, transparent)",
                    opacity: 0.75,
                  }}
                >
                  <Users size={15} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 1 }} aria-hidden />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                      {t("sidebar.branches.sharePatients")}{" "}
                      {!PATIENT_SHARING_ENABLED && (
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)" }}>
                          {t("sidebar.branches.comingSoon")}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45, marginTop: 2 }}>
                      {t("sidebar.branches.sharePatientsHint")}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 6,
                    padding: "10px 12px",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 10,
                    background: "var(--bg-subtle, transparent)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <Users size={15} style={{ color: "var(--text-3)", flexShrink: 0, marginTop: 1 }} aria-hidden />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>
                        {t("sidebar.branches.sharePatientsWith")}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.45, marginTop: 2 }}>
                        {t("sidebar.branches.sharePatientsSelectHint")}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
                    {branches.map((b) => (
                      <label
                        key={b.clinicId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 4px",
                          fontSize: 12,
                          color: "var(--text-1)",
                          cursor: "pointer",
                          minWidth: 0,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={shareWith.indexOf(b.clinicId) !== -1}
                          onChange={() => toggleShare(b.clinicId)}
                          style={{ flexShrink: 0, width: 15, height: 15, cursor: "pointer" }}
                        />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {b.clinicName}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal__footer" style={{ flexShrink: 0 }}>
              <ButtonNew variant="ghost" onClick={onClose} type="button">{t("common.cancel")}</ButtonNew>
              <ButtonNew variant="primary" type="submit" disabled={loading}>
                {loading ? t("common.saving") : t("sidebar.branches.create")}
              </ButtonNew>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
