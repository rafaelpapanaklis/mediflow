"use client";

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Copy,
  ExternalLink,
  Share2,
  X,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";
import toast from "react-hot-toast";
import shareStyles from "./share-panel.module.css";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useT } from "@/i18n/i18n-provider";

interface ShareConfig {
  enabled: boolean;
  slug: string | null;
  hasPassword: boolean;
  showPatientNames: boolean;
}

export function SharePanel({
  initial,
  clinicName,
  onClose,
}: {
  initial: ShareConfig;
  clinicName: string;
  onClose: () => void;
}) {
  const t = useT();
  const askConfirm = useConfirm();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [slug, setSlug] = useState(initial.slug ?? slugify(clinicName));
  const [hasPassword, setHasPassword] = useState(initial.hasPassword);
  const [password, setPassword] = useState("");
  const [showPasswordRaw, setShowPasswordRaw] = useState(false);
  const [showPatientNames, setShowPatientNames] = useState(initial.showPatientNames);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  const publicUrl =
    typeof window !== "undefined" && slug ? `${window.location.origin}/live/${slug}` : "";
  // Recorrido 3D público (mismo slug + mismo gate de password). Solo con slug.
  const public3dUrl = publicUrl ? `${publicUrl}/3d` : "";

  const saveAll = async () => {
    if (!slug.trim()) {
      toast.error(t("pages.clinicLayout.shareDefineSlugFirst"));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        liveModeEnabled: enabled,
        liveModeSlug: slug.trim().toLowerCase(),
        liveModeShowPatientNames: showPatientNames,
      };
      if (password.trim()) {
        payload.liveModePassword = password;
      }
      const res = await fetch("/api/clinic-layout/live-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 409) {
          toast.error(t("pages.clinicLayout.shareSlugInUse"));
        } else if (err.error === "invalid_slug") {
          toast.error(t("pages.clinicLayout.shareInvalidSlug"));
        } else if (err.error === "password_too_short") {
          toast.error(t("pages.clinicLayout.sharePasswordTooShort"));
        } else {
          toast.error(t("pages.clinicLayout.shareSaveFailed"));
        }
        return;
      }
      const data = await res.json();
      setHasPassword(Boolean(data.hasPassword));
      setPassword("");
      setSavedOk(true);
      toast.success(t("pages.clinicLayout.shareConfigSaved"));
      setTimeout(() => setSavedOk(false), 2500);
    } catch {
      toast.error(t("pages.clinicLayout.shareNetworkError"));
    } finally {
      setSaving(false);
    }
  };

  const removePassword = async () => {
    if (!(await askConfirm({
      title: t("pages.clinicLayout.shareRemovePasswordTitle"),
      description: t("pages.clinicLayout.shareRemovePasswordDesc"),
      variant: "warning",
      confirmText: t("pages.clinicLayout.shareRemovePasswordConfirm"),
    }))) return;
    setSaving(true);
    try {
      const res = await fetch("/api/clinic-layout/live-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ liveModePassword: null }),
      });
      if (!res.ok) throw new Error();
      setHasPassword(false);
      setPassword("");
      toast.success(t("pages.clinicLayout.sharePasswordRemoved"));
    } catch {
      toast.error(t("pages.clinicLayout.sharePasswordRemoveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success(t("pages.clinicLayout.shareUrlCopied"));
    } catch {
      toast.error(t("pages.clinicLayout.shareCopyFailed"));
    }
  };

  const copy3dUrl = async () => {
    if (!public3dUrl) return;
    try {
      await navigator.clipboard.writeText(public3dUrl);
      toast.success(t("pages.clinicLayout.shareUrlCopied"));
    } catch {
      toast.error(t("pages.clinicLayout.shareCopyFailed"));
    }
  };

  return (
    <div className={shareStyles.backdrop} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={shareStyles.dialog} onClick={(e) => e.stopPropagation()}>
        <header className={shareStyles.header}>
          <div className={shareStyles.headerInfo}>
            <span className={shareStyles.headerIcon}><Share2 size={18} aria-hidden /></span>
            <div>
              <h2 className={shareStyles.title}>{t("pages.clinicLayout.shareTitle")}</h2>
              <p className={shareStyles.subtitle}>
                {t("pages.clinicLayout.shareSubtitle")}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={shareStyles.closeBtn}
            onClick={onClose}
            aria-label={t("common.close")}
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className={shareStyles.body}>
          {/* Toggle enable */}
          <label className={shareStyles.toggleRow}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <div>
              <span className={shareStyles.toggleLabel}>{t("pages.clinicLayout.shareEnableLabel")}</span>
              <span className={shareStyles.toggleHint}>
                {t("pages.clinicLayout.shareEnableHint", { slug: slug || "…" })}
              </span>
            </div>
          </label>

          {/* Slug */}
          <label className={shareStyles.field}>
            <span className={shareStyles.fieldLabel}>{t("pages.clinicLayout.shareSlugLabel")}</span>
            <div className={shareStyles.slugInputWrap}>
              <span className={shareStyles.slugPrefix}>
                {typeof window !== "undefined" ? `${window.location.host}/live/` : "/live/"}
              </span>
              <input
                type="text"
                value={slug}
                onChange={(e) => setSlug(slugify(e.target.value))}
                placeholder="mi-clinica"
                className={shareStyles.slugInput}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <span className={shareStyles.fieldHint}>
              {t("pages.clinicLayout.shareSlugHint")}
            </span>
          </label>

          {/* Password */}
          <div className={shareStyles.field}>
            <span className={shareStyles.fieldLabel}>
              {t("pages.clinicLayout.sharePasswordLabel")}
              {hasPassword && (
                <span className={shareStyles.passwordSet}>
                  <Check size={11} aria-hidden /> {t("pages.clinicLayout.sharePasswordConfigured")}
                </span>
              )}
            </span>
            <div className={shareStyles.passwordRow}>
              <input
                type={showPasswordRaw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={hasPassword ? t("pages.clinicLayout.sharePasswordKeepPlaceholder") : t("pages.clinicLayout.sharePasswordNonePlaceholder")}
                className={shareStyles.passwordInput}
                autoComplete="new-password"
              />
              <button
                type="button"
                className={shareStyles.passwordEye}
                onClick={() => setShowPasswordRaw((v) => !v)}
                aria-label={showPasswordRaw ? t("pages.clinicLayout.shareHidePassword") : t("pages.clinicLayout.shareShowPassword")}
              >
                {showPasswordRaw ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
              </button>
            </div>
            {hasPassword && (
              <button
                type="button"
                className={shareStyles.removePasswordLink}
                onClick={removePassword}
                disabled={saving}
              >
                {t("pages.clinicLayout.shareRemovePasswordLink")}
              </button>
            )}
            <span className={shareStyles.fieldHint}>
              {t("pages.clinicLayout.sharePasswordHint")}
            </span>
          </div>

          {/* Privacy toggle */}
          <label className={shareStyles.toggleRow}>
            <input
              type="checkbox"
              checked={showPatientNames}
              onChange={(e) => setShowPatientNames(e.target.checked)}
            />
            <div>
              <span className={shareStyles.toggleLabel}>{t("pages.clinicLayout.shareShowPatientNames")}</span>
              <span className={shareStyles.toggleHint}>
                {t("pages.clinicLayout.shareShowPatientNamesHint")}
              </span>
            </div>
          </label>

          {/* URL preview + acciones */}
          {enabled && slug && (
            <div className={shareStyles.previewBlock}>
              <div className={shareStyles.previewUrl}>
                <code>{publicUrl}</code>
                <div className={shareStyles.previewActions}>
                  <button
                    type="button"
                    className={shareStyles.previewBtn}
                    onClick={copyUrl}
                  >
                    <Copy size={12} aria-hidden /> {t("pages.clinicLayout.shareCopy")}
                  </button>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={shareStyles.previewBtn}
                  >
                    <ExternalLink size={12} aria-hidden /> {t("pages.clinicLayout.shareOpen")}
                  </a>
                </div>
              </div>
              {/* Recorrido 3D público — mismo slug y mismo gate de password. */}
              <div className={shareStyles.previewUrl}>
                <code>🎮 {public3dUrl}</code>
                <div className={shareStyles.previewActions}>
                  <button
                    type="button"
                    className={shareStyles.previewBtn}
                    onClick={copy3dUrl}
                  >
                    <Copy size={12} aria-hidden /> {t("pages.clinicLayout.shareCopy")}
                  </button>
                  <a
                    href={public3dUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={shareStyles.previewBtn}
                  >
                    <ExternalLink size={12} aria-hidden /> Recorrido 3D
                  </a>
                </div>
              </div>
              <div className={shareStyles.qrWrap}>
                <QRCodeSVG value={publicUrl} size={140} bgColor="#FFFFFF" fgColor="#1A2540" />
                <span className={shareStyles.qrLabel}>{t("pages.clinicLayout.shareQrLabel")}</span>
              </div>
            </div>
          )}
        </div>

        <footer className={shareStyles.footer}>
          <button type="button" className={shareStyles.cancelBtn} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={shareStyles.saveBtn}
            onClick={saveAll}
            disabled={saving}
          >
            {savedOk ? (
              <><Check size={13} aria-hidden /> {t("pages.clinicLayout.shareSaved")}</>
            ) : saving ? (
              t("common.saving")
            ) : (
              t("pages.clinicLayout.shareSaveConfig")
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}
