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

  const saveAll = async () => {
    if (!slug.trim()) {
      toast.error("Define un slug primero");
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
          toast.error("Ese slug ya está en uso por otra clínica");
        } else if (err.error === "invalid_slug") {
          toast.error("Slug inválido. Usa solo a-z, 0-9 y guiones (3-50 chars).");
        } else if (err.error === "password_too_short") {
          toast.error("La contraseña debe tener al menos 4 caracteres");
        } else {
          toast.error("No se pudo guardar");
        }
        return;
      }
      const data = await res.json();
      setHasPassword(Boolean(data.hasPassword));
      setPassword("");
      setSavedOk(true);
      toast.success("Configuración guardada");
      setTimeout(() => setSavedOk(false), 2500);
    } catch {
      toast.error("Error de red");
    } finally {
      setSaving(false);
    }
  };

  const removePassword = async () => {
    if (!(await askConfirm({
      title: "¿Quitar la contraseña?",
      description: "La URL pública quedará accesible para cualquiera que la conozca, sin protección.",
      variant: "warning",
      confirmText: "Quitar contraseña",
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
      toast.success("Contraseña eliminada");
    } catch {
      toast.error("No se pudo quitar la contraseña");
    } finally {
      setSaving(false);
    }
  };

  const copyUrl = async () => {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success("URL copiada");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  return (
    <div className={shareStyles.backdrop} role="dialog" aria-modal="true" onClick={onClose}>
      <div className={shareStyles.dialog} onClick={(e) => e.stopPropagation()}>
        <header className={shareStyles.header}>
          <div className={shareStyles.headerInfo}>
            <span className={shareStyles.headerIcon}><Share2 size={18} aria-hidden /></span>
            <div>
              <h2 className={shareStyles.title}>Compartir vista en vivo</h2>
              <p className={shareStyles.subtitle}>
                URL pública para mostrar en TV de sala de espera. Abre directamente sin login.
              </p>
            </div>
          </div>
          <button
            type="button"
            className={shareStyles.closeBtn}
            onClick={onClose}
            aria-label="Cerrar"
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
              <span className={shareStyles.toggleLabel}>Habilitar URL pública</span>
              <span className={shareStyles.toggleHint}>
                Cuando esté apagado, /live/{slug || "…"} responderá 404.
              </span>
            </div>
          </label>

          {/* Slug */}
          <label className={shareStyles.field}>
            <span className={shareStyles.fieldLabel}>Slug en URL</span>
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
              Solo a-z, 0-9 y guiones. Único entre todas las clínicas MediFlow.
            </span>
          </label>

          {/* Password */}
          <div className={shareStyles.field}>
            <span className={shareStyles.fieldLabel}>
              Contraseña (opcional)
              {hasPassword && (
                <span className={shareStyles.passwordSet}>
                  <Check size={11} aria-hidden /> configurada
                </span>
              )}
            </span>
            <div className={shareStyles.passwordRow}>
              <input
                type={showPasswordRaw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={hasPassword ? "(deja vacío para mantener)" : "(sin contraseña)"}
                className={shareStyles.passwordInput}
                autoComplete="new-password"
              />
              <button
                type="button"
                className={shareStyles.passwordEye}
                onClick={() => setShowPasswordRaw((v) => !v)}
                aria-label={showPasswordRaw ? "Ocultar" : "Mostrar"}
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
                Quitar contraseña
              </button>
            )}
            <span className={shareStyles.fieldHint}>
              Si la URL es pública (compartida en redes), recomendamos usar contraseña.
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
              <span className={shareStyles.toggleLabel}>Mostrar nombres de pacientes</span>
              <span className={shareStyles.toggleHint}>
                Por defecto solo iniciales (ej. M.G.). HIPAA / LGPD friendly.
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
                    <Copy size={12} aria-hidden /> Copiar
                  </button>
                  <a
                    href={publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={shareStyles.previewBtn}
                  >
                    <ExternalLink size={12} aria-hidden /> Abrir
                  </a>
                </div>
              </div>
              <div className={shareStyles.qrWrap}>
                <QRCodeSVG value={publicUrl} size={140} bgColor="#FFFFFF" fgColor="#1A2540" />
                <span className={shareStyles.qrLabel}>Escanea para abrir en otra pantalla</span>
              </div>
            </div>
          )}
        </div>

        <footer className={shareStyles.footer}>
          <button type="button" className={shareStyles.cancelBtn} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={shareStyles.saveBtn}
            onClick={saveAll}
            disabled={saving}
          >
            {savedOk ? (
              <><Check size={13} aria-hidden /> Guardado</>
            ) : saving ? (
              "Guardando…"
            ) : (
              "Guardar configuración"
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
