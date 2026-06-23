"use client";

import { useState } from "react";
import { ShieldCheck, ShieldOff, KeyRound, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className="bg-card border border-border rounded-2xl p-6 shadow-card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              enabled ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"
            }`}
          >
            {enabled ? <ShieldCheck className="h-5 w-5" /> : <ShieldOff className="h-5 w-5" />}
          </div>
          <div>
            <h2 className="text-base font-bold">{t("settings.client.tfa.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("settings.client.tfa.subtitle")}</p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
            enabled
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-muted text-muted-foreground"
          }`}
        >
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
            <Button type="button" onClick={() => setShowSetup(true)}>
              <ShieldCheck className="mr-1.5 h-4 w-4" />
              {t("settings.client.tfa.setupBtn")}
            </Button>
          )}
        </div>
      )}

      {/* ── Activado: protegido + regenerar + desactivar ── */}
      {enabled && (
        <div className="space-y-4 pt-1">
          <p className="flex items-center gap-1.5 text-sm text-emerald-600">
            <Check className="h-4 w-4" />
            {t("settings.client.tfa.accountProtected")}
          </p>

          {/* Regenerar códigos */}
          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t("settings.client.tfa.regenBtn")}</h3>
            </div>
            {newCodes ? (
              <div className="space-y-2">
                <ul className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 font-mono text-sm">
                  {newCodes.map((c) => (
                    <li key={c} className="text-center tracking-wider">
                      {c}
                    </li>
                  ))}
                </ul>
                <Button type="button" variant="outline" size="sm" onClick={copyNew}>
                  {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
                  {copied ? t("settings.client.tfa.recoveryCopied") : t("settings.client.tfa.recoveryCopy")}
                </Button>
              </div>
            ) : regenOpen ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("settings.client.tfa.regenHint")}</p>
                <Input
                  value={regenCode}
                  onChange={(e) => setRegenCode(e.target.value)}
                  inputMode="text"
                  autoComplete="one-time-code"
                  placeholder={t("settings.client.tfa.currentCodePlaceholder")}
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={doRegen} disabled={busy || !regenCode.trim()}>
                    {t("settings.client.tfa.regenConfirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRegenOpen(false);
                      setRegenCode("");
                    }}
                  >
                    {t("settings.client.tfa.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setRegenOpen(true)}>
                {t("settings.client.tfa.regenBtn")}
              </Button>
            )}
          </div>

          {/* Desactivar */}
          <div className="rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldOff className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t("settings.client.tfa.disableBtn")}</h3>
            </div>
            {require2fa ? (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                {t("settings.client.tfa.policyBlockedDisable")}
              </p>
            ) : disableOpen ? (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("settings.client.tfa.disableHint")}</p>
                <Input
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  inputMode="text"
                  autoComplete="one-time-code"
                  placeholder={t("settings.client.tfa.currentCodePlaceholder")}
                />
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={doDisable}
                    disabled={busy || !disableCode.trim()}
                  >
                    {t("settings.client.tfa.disableConfirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDisableOpen(false);
                      setDisableCode("");
                    }}
                  >
                    {t("settings.client.tfa.cancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setDisableOpen(true)}>
                {t("settings.client.tfa.disableBtn")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Política de clínica (solo admin) ── */}
      {isAdmin && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/20 p-4">
          <input
            type="checkbox"
            checked={require2fa}
            disabled={busy}
            onChange={(e) => togglePolicy(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-600"
          />
          <span>
            <span className="block text-sm font-semibold">{t("settings.client.tfa.policyTitle")}</span>
            <span className="block text-xs text-muted-foreground">{t("settings.client.tfa.policyHint")}</span>
          </span>
        </label>
      )}
    </div>
  );
}
