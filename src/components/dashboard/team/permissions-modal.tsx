"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Shield, X } from "lucide-react";
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_DEFAULT_PERMISSIONS,
  type PermissionKey,
} from "@/lib/auth/permissions";
import type { Role } from "@prisma/client";
import { useT } from "@/i18n/i18n-provider";

// labelKey -> resolved via t() at render time (never call t() at module scope).
const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "settings.team.roleSuperAdmin", ADMIN: "settings.team.roleAdmin", DOCTOR: "settings.team.roleDoctor",
  RECEPTIONIST: "settings.team.roleReceptionist", READONLY: "settings.team.roleReadonly",
};

interface MemberLike {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  permissionsOverride?: string[] | null;
}

interface PermissionsModalProps {
  open: boolean;
  member: MemberLike | null;
  onClose: () => void;
  // Callback tras guardar — el padre actualiza su state local para
  // reflejar el cambio sin recargar la página entera.
  onSaved: (memberId: string, newOverride: string[]) => void;
}

export function PermissionsModal({ open, member, onClose, onSaved }: PermissionsModalProps) {
  const t = useT();
  // useDefault: true → checkboxes deshabilitados, mostrando los del rol.
  // false → habilitados, editando el override del usuario.
  const [useDefault, setUseDefault] = useState(true);
  const [selected, setSelected]     = useState<Set<PermissionKey>>(new Set());
  const [saving, setSaving]         = useState(false);

  // Reset al abrir el modal con un member nuevo. Si el member tiene override
  // (length > 0) → useDefault=false con esos checks; si está vacío → default
  // del rol con useDefault=true.
  useEffect(() => {
    if (!open || !member) return;
    const override = member.permissionsOverride ?? [];
    if (override.length > 0) {
      setUseDefault(false);
      setSelected(new Set(override.filter((k): k is PermissionKey => k in ALL_PERMISSIONS)));
    } else {
      setUseDefault(true);
      const role = (member.role as Role) ?? "READONLY";
      setSelected(new Set(ROLE_DEFAULT_PERMISSIONS[role] ?? []));
    }
  }, [open, member]);

  const memberRole = (member?.role as Role) ?? "READONLY";
  const roleDefaults = useMemo(
    () => new Set(ROLE_DEFAULT_PERMISSIONS[memberRole] ?? []),
    [memberRole],
  );

  // Cuando se activa "useDefault", forzamos el set visible al default del role
  // para que el usuario vea exactamente qué tendría con esa configuración.
  function toggleUseDefault(next: boolean) {
    setUseDefault(next);
    if (next) setSelected(new Set(roleDefaults));
  }

  function togglePermission(key: PermissionKey) {
    if (useDefault) return; // checkboxes disabled
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    if (!member) return;
    setSaving(true);
    try {
      // Si está usando default → mandar null al backend (limpia override).
      // Si está customizando → mandar el array actual de keys.
      const payload = useDefault ? null : Array.from(selected);
      const res = await fetch(`/api/team/${member.id}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissionsOverride: payload }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? t("settings.permissions.saveError"));
      }
      const data = await res.json();
      onSaved(member.id, data.permissionsOverride ?? []);
      toast.success(t("settings.permissions.updated"));
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? t("common.genericError"));
    } finally {
      setSaving(false);
    }
  }

  if (!open || !member) return null;
  const fullName = `${member.firstName} ${member.lastName}`.trim();

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div className="modal__header">
          <h2 className="modal__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Shield size={16} strokeWidth={1.75} aria-hidden style={{ color: "var(--brand)" }} />
            {t("settings.team.permissionsOf", { name: fullName })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn-new btn-new--ghost"
            style={{ padding: 0, width: 36 }}
            aria-label={t("common.close")}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className="modal__body space-y-5" style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          {/* Toggle use-default */}
          <label
            className="flex items-start justify-between gap-3 cursor-pointer"
            style={{
              padding: 14,
              borderRadius: "var(--radius)",
              border: `1px solid ${useDefault ? "var(--consult-active-border)" : "var(--border-soft)"}`,
              background: useDefault ? "var(--brand-softer)" : "transparent",
              transition: "background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
            }}
          >
            <div className="flex-1">
              <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>
                {t("settings.permissions.useRoleDefault")}{" "}
                <span className="mono" style={{ fontSize: 12, color: "var(--text-3)" }}>
                  {ROLE_LABEL[memberRole] ? t(ROLE_LABEL[memberRole]) : memberRole}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
                {t("settings.permissions.useRoleDefaultHint")}
              </div>
            </div>
            <input
              type="checkbox"
              checked={useDefault}
              onChange={(e) => toggleUseDefault(e.target.checked)}
              className="peer sr-only"
            />
            <span
              className={`switch peer-focus-visible:shadow-[var(--ring)] ${useDefault ? "switch--on" : ""}`}
              aria-hidden
              style={{ marginTop: 2 }}
            >
              <span className="switch__thumb" />
            </span>
          </label>

          {/* Permission groups */}
          <div className="space-y-4">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="form-section__title">
                  {group.title}
                  <span className="form-section__rule" aria-hidden />
                </div>
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-3"
                  style={{
                    background: "var(--bg-elev-2)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: "var(--radius)",
                  }}
                >
                  {group.keys.map((key) => {
                    const isChecked = selected.has(key);
                    const isInRoleDefault = roleDefaults.has(key);
                    return (
                      <label
                        key={key}
                        className={`flex items-start justify-between gap-2 ${useDefault ? "" : "hover:bg-[var(--bg-hover)]"}`}
                        style={{
                          padding: "6px 8px",
                          borderRadius: "var(--radius-sm)",
                          cursor: useDefault ? "default" : "pointer",
                          opacity: useDefault ? 0.6 : 1,
                          transition: "background var(--dur-1) var(--ease)",
                        }}
                      >
                        <div className="min-w-0 flex-1">
                          <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>
                            {ALL_PERMISSIONS[key]}
                          </div>
                          <div
                            className="mono"
                            style={{ fontSize: 10.5, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}
                          >
                            {key}
                            {isInRoleDefault && (
                              <span
                                className="badge-new badge-new--brand"
                                style={{ height: 16, padding: "0 6px", fontSize: 9 }}
                              >
                                {t("settings.permissions.roleBadge")}
                              </span>
                            )}
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={useDefault}
                          onChange={() => togglePermission(key)}
                          className="peer sr-only"
                        />
                        <span
                          className={`switch peer-focus-visible:shadow-[var(--ring)] ${isChecked ? "switch--on" : ""}`}
                          aria-hidden
                          style={{ marginTop: 1 }}
                        >
                          <span className="switch__thumb" />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal__footer">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="btn-new btn-new--secondary"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-new btn-new--primary"
          >
            {saving ? t("common.saving") : useDefault ? t("settings.permissions.revertToRoleDefault") : t("settings.permissions.savePermissionsCount", { count: selected.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
