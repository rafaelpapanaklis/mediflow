"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Shield } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_DEFAULT_PERMISSIONS,
  type PermissionKey,
} from "@/lib/auth/permissions";
import type { Role } from "@prisma/client";

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin", ADMIN: "Admin", DOCTOR: "Doctor",
  RECEPTIONIST: "Recepcionista", READONLY: "Solo lectura",
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
        throw new Error(err.error ?? "Error al guardar permisos");
      }
      const data = await res.json();
      onSaved(member.id, data.permissionsOverride ?? []);
      toast.success("Permisos actualizados");
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? "Error");
    } finally {
      setSaving(false);
    }
  }

  if (!member) return null;
  const fullName = `${member.firstName} ${member.lastName}`.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl bg-card text-foreground border border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-foreground font-bold flex items-center gap-2">
            <Shield size={16} className="text-violet-600 dark:text-violet-400" />
            Permisos de {fullName}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-4 space-y-5">
          {/* Toggle use-default */}
          <label className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30 cursor-pointer">
            <input
              type="checkbox"
              checked={useDefault}
              onChange={(e) => toggleUseDefault(e.target.checked)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-semibold text-foreground">
                Usar default del rol <span className="font-mono text-xs text-muted-foreground">{ROLE_LABEL[memberRole] ?? memberRole}</span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Cuando está activado, este usuario hereda los permisos por defecto de su rol.
                Desmárcalo para personalizar permiso por permiso.
              </div>
            </div>
          </label>

          {/* Permission groups */}
          <div className="space-y-4">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.title}>
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
                  {group.title}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 bg-card border border-border rounded-lg p-3">
                  {group.keys.map((key) => {
                    const isChecked = selected.has(key);
                    const isInRoleDefault = roleDefaults.has(key);
                    return (
                      <label
                        key={key}
                        className={`flex items-start gap-2 p-1.5 rounded text-xs ${
                          useDefault ? "cursor-default opacity-60" : "cursor-pointer hover:bg-muted/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={useDefault}
                          onChange={() => togglePermission(key)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-foreground">{ALL_PERMISSIONS[key]}</div>
                          <div className="font-mono text-[10px] text-muted-foreground flex items-center gap-1.5">
                            {key}
                            {isInRoleDefault && (
                              <span className="text-[9px] px-1 py-px rounded bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                                rol
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Guardando…" : useDefault ? "Volver a default del rol" : `Guardar permisos (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
