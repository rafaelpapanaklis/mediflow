"use client";

import { useState } from "react";
import { ShieldCheck, ShieldOff, KeyRound, Copy, Check } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import toast from "react-hot-toast";
import { TwoFactorSetup } from "./two-factor-setup";

interface Props {
  initialEnabled: boolean;
  initialRequire2fa: boolean;
  isAdmin: boolean;
}

// Card de la pestaña Seguridad: estado del 2FA del usuario, activar (wizard),
// regenerar códigos, desactivar (con código), y — solo admin — la política de
// exigir 2FA a todo el equipo.
export function TwoFactorCard({ initialEnabled, initialRequire2fa, isAdmin }: Props) {
  const t = useT();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [require2fa, setRequire2fa] = useState(initialRequire2fa);
  const [showSetup, setShowSetup] = useState(false);
  const [busy, setBusy] = useState(false);

  // Desactivar
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  // Regenerar
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState("");
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  async function doDisable() {
    if (busy || !disableCode.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? t("settings.client.tfa.genericError"));
        return;
      }
      toast.success(t("settings.client.tfa.disabledToast"));
      setEnabled(false);
      setDisableOpen(false);
      setDisableCode("");
    } catch {
      toast.error(t("settings.client.tfa.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function doRegen() {
    if (busy || !regenCode.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/recovery-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: regenCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? t("settings.client.tfa.genericError"));
        return;
      }
      setNewCodes(data.recoveryCodes ?? []);
      setRegenCode("");
      toast.success(t("settings.client.tfa.regenToast"));
    } catch {
      toast.error(t("settings.client.tfa.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function togglePolicy(next: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/auth/2fa/clinic-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ require2fa: next }),
      });
      if (!res.ok) {
        toast.error(t("settings.client.tfa.errorGeneric"));
        return;
      }
      setRequire2fa(next);
      toast.success(
        next ? t("settings.client.tfa.policyOnToast") : t("settings.client.tfa.policyOffToast"),
      );
    } catch {
      toast.error(t("settings.client.tfa.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  function copyNew() {
    if (!newCodes) return;
    navigator.clipboard
      ?.writeText(newCodes.join("\n"))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{
              background: enabled ? "var(--success-soft)" : "var(--bg-elev-2)",
              color: enabled ? "var(--success-strong)" : "var(--text-3)",
            }}
          >
            {enabled ? (
              <ShieldCheck size={20} strokeWidth={1.75} />
            ) : (
              <ShieldOff size={20} strokeWidth={1.75} />
            )}
          </div>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
              {t("settings.client.tfa.title")}
            </h2>
            <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: "2px 0 0" }}>
              {t("settings.client.tfa.subtitle")}
            </p>
          </div>
        </div>
        <span
          className={`badge-new shrink-0 ${enabled ? "badge-new--success" : "badge-new--neutral"}`}
        >
          {enabled && <span className="badge-new__dot" />}
          {enabled ? t("settings.client.tfa.statusOn") : t("settings.client.tfa.statusOff")}
        </span>
      </div>

      {/* ── Desactivado: activar ── */}
      {!enabled && (
        <div className="pt-1">
          {showSetup ? (
            <TwoFactorSetup
              onEnabled={() => {
                setEnabled(true);
                setShowSetup(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="btn-new btn-new--primary"
              style={{ height: 40 }}
              onClick={() => setShowSetup(true)}
            >
              <ShieldCheck size={16} strokeWidth={1.75} />
              {t("settings.client.tfa.setupBtn")}
            </button>
          )}
        </div>
      )}

      {/* ── Activado: protegido + regenerar + desactivar ── */}
      {enabled && (
        <div className="space-y-4 pt-1">
          <p
            className="flex items-center gap-1.5"
            style={{ fontSize: 13, color: "var(--success-strong)", margin: 0 }}
          >
            <Check size={16} strokeWidth={1.75} />
            {t("settings.client.tfa.accountProtected")}
          </p>

          {/* Regenerar códigos */}
          <div
            className="space-y-3"
            style={{
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--radius)",
              padding: 16,
            }}
          >
            <div className="flex items-center gap-2">
              <KeyRound size={16} strokeWidth={1.75} style={{ color: "var(--text-3)" }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
                {t("settings.client.tfa.regenBtn")}
              </h3>
            </div>
            {newCodes ? (
              <div className="space-y-2">
                <ul
                  className="mono grid grid-cols-2 gap-2"
                  style={{
                    background: "var(--bg-elev-2)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: "var(--radius)",
                    padding: 12,
                    fontSize: 12,
                    color: "var(--text-1)",
                  }}
                >
                  {newCodes.map((c) => (
                    <li key={c} className="text-center tracking-wider">
                      {c}
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn-new btn-new--secondary btn-new--sm" onClick={copyNew}>
                  {copied ? <Check size={16} strokeWidth={1.75} /> : <Copy size={16} strokeWidth={1.75} />}
                  {copied ? t("settings.client.tfa.recoveryCopied") : t("settings.client.tfa.recoveryCopy")}
                </button>
              </div>
            ) : regenOpen ? (
              <div className="space-y-2">
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
                  {t("settings.client.tfa.regenHint")}
                </p>
                <input
                  className="input-new mono"
                  value={regenCode}
                  onChange={(e) => setRegenCode(e.target.value)}
                  inputMode="text"
                  autoComplete="one-time-code"
                  placeholder={t("settings.client.tfa.currentCodePlaceholder")}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-new btn-new--primary btn-new--sm"
                    onClick={doRegen}
                    disabled={busy || !regenCode.trim()}
                  >
                    {t("settings.client.tfa.regenConfirm")}
                  </button>
                  <button
                    type="button"
                    className="btn-new btn-new--ghost btn-new--sm"
                    onClick={() => {
                      setRegenOpen(false);
                      setRegenCode("");
                    }}
                  >
                    {t("settings.client.tfa.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-new btn-new--secondary btn-new--sm"
                onClick={() => setRegenOpen(true)}
              >
                {t("settings.client.tfa.regenBtn")}
              </button>
            )}
          </div>

          {/* Desactivar */}
          <div
            className="space-y-3"
            style={{
              border: "1px solid var(--border-soft)",
              borderRadius: "var(--radius)",
              padding: 16,
            }}
          >
            <div className="flex items-center gap-2">
              <ShieldOff size={16} strokeWidth={1.75} style={{ color: "var(--text-3)" }} />
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
                {t("settings.client.tfa.disableBtn")}
              </h3>
            </div>
            {require2fa ? (
              <p style={{ fontSize: 12, color: "var(--warning-strong)", margin: 0 }}>
                {t("settings.client.tfa.policyBlockedDisable")}
              </p>
            ) : disableOpen ? (
              <div className="space-y-2">
                <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>
                  {t("settings.client.tfa.disableHint")}
                </p>
                <input
                  className="input-new mono"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  inputMode="text"
                  autoComplete="one-time-code"
                  placeholder={t("settings.client.tfa.currentCodePlaceholder")}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-new btn-new--danger btn-new--sm"
                    onClick={doDisable}
                    disabled={busy || !disableCode.trim()}
                  >
                    {t("settings.client.tfa.disableConfirm")}
                  </button>
                  <button
                    type="button"
                    className="btn-new btn-new--ghost btn-new--sm"
                    onClick={() => {
                      setDisableOpen(false);
                      setDisableCode("");
                    }}
                  >
                    {t("settings.client.tfa.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className="btn-new btn-new--secondary btn-new--sm"
                onClick={() => setDisableOpen(true)}
              >
                {t("settings.client.tfa.disableBtn")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Política de clínica (solo admin) ── */}
      {isAdmin && (
        <label
          className="flex cursor-pointer items-start gap-3"
          style={{
            border: "1px solid var(--border-soft)",
            background: "var(--bg-elev-2)",
            borderRadius: "var(--radius)",
            padding: 16,
          }}
        >
          <input
            type="checkbox"
            checked={require2fa}
            disabled={busy}
            onChange={(e) => togglePolicy(e.target.checked)}
            className="mt-0.5 h-4 w-4"
            style={{ accentColor: "var(--brand)" }}
          />
          <span>
            <span className="block" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
              {t("settings.client.tfa.policyTitle")}
            </span>
            <span className="block" style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
              {t("settings.client.tfa.policyHint")}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}
