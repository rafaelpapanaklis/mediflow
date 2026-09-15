"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle, Loader2, Sparkles, X } from "lucide-react";
import { ALL_PERMISSIONS, PERMISSION_GROUPS, type PermissionKey } from "@/lib/auth/permissions";
import { overrideDeSabina, permisosDeSabina } from "@/lib/sabina/permisos-sabina";
import { useT } from "@/i18n/i18n-provider";

// Lo que Sabina puede hacer en nombre de UN miembro del equipo. Hermano del
// modal de Permisos, con su misma estética y sus mismos grupos.
//
// La pantalla NO decide nada: lo que el usuario puede lo calcula el servidor
// (GET /api/team/[id]/sabina-permissions) y el conteo de lo que Sabina podrá usar
// sale de `permisosDeSabina`, la misma función que aplica el candado en cada
// petición a Sabina. Aquí solo se pinta, y se deshabilita lo que el usuario no
// tiene: esas casillas no se pueden marcar porque marcarlas no cambiaría nada.

interface MemberLike {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  permissionsOverride?: string[] | null;
}

interface SabinaPermissionsModalProps {
  open: boolean;
  member: MemberLike | null;
  onClose: () => void;
}

interface Estado {
  disponible: boolean;
  aviso: string | null;
  delUsuario: Set<PermissionKey>;
}

export function SabinaPermissionsModal({ open, member, onClose }: SabinaPermissionsModalProps) {
  const t = useT();
  const [estado, setEstado]       = useState<Estado | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [activa, setActiva]       = useState(true);
  // sameAsUser: true → Sabina con todo lo del usuario (lista vacía en la base);
  // false → exactamente lo marcado.
  const [sameAsUser, setSameAsUser] = useState(true);
  const [selected, setSelected]   = useState<Set<PermissionKey>>(new Set());
  const [saving, setSaving]       = useState(false);

  // Se lee fresco al abrir: si el Super Admin acaba de cambiar los permisos del
  // usuario en el otro modal, lo que se ve aquí ya los refleja.
  useEffect(() => {
    if (!open || !member) return;
    let cancelado = false;
    setEstado(null);
    setErrorCarga(null);
    (async () => {
      try {
        const res = await fetch(`/api/team/${member.id}/sabina-permissions`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error ?? t("settings.sabinaPermissions.loadError"));
        if (cancelado) return;
        const delUsuario = new Set<PermissionKey>(
          (Array.isArray(data.permisosDelUsuario) ? data.permisosDelUsuario : []).filter(
            (k: unknown): k is PermissionKey => typeof k === "string" && k in ALL_PERMISSIONS,
          ),
        );
        const guardadas: PermissionKey[] = (Array.isArray(data.sabinaPermissions) ? data.sabinaPermissions : []).filter(
          (k: unknown): k is PermissionKey => typeof k === "string" && k in ALL_PERMISSIONS,
        );
        setEstado({ disponible: data.disponible !== false, aviso: typeof data.aviso === "string" ? data.aviso : null, delUsuario });
        setActiva(data.sabinaEnabled !== false);
        // `sabinaSameAsUser` lo dice el servidor con la lista guardada: una lista
        // de keys retiradas del catálogo llega vacía pero NO es «lo mismo».
        const mismo = typeof data.sabinaSameAsUser === "boolean" ? data.sabinaSameAsUser : guardadas.length === 0;
        setSameAsUser(mismo);
        setSelected(new Set(mismo ? delUsuario : guardadas));
      } catch (err: any) {
        if (!cancelado) setErrorCarga(err?.message ?? t("settings.sabinaPermissions.loadError"));
      }
    })();
    return () => { cancelado = true; };
  }, [open, member, t]);

  // Lo que se guardaría: solo lo marcado que el usuario tiene.
  const marcadasEfectivas = useMemo(
    () => (estado ? Array.from(selected).filter((k) => estado.delUsuario.has(k)) : []),
    [selected, estado],
  );

  // El conteo que ve el Super Admin, con la función del candado.
  const resumen = useMemo(() => {
    if (!member || !estado) return null;
    // `overrideDeSabina` y no la lista pelada: un usuario sin ningún permiso
    // escrito como `[]` contaría como «defaults del rol».
    return permisosDeSabina(
      { role: member.role, permissionsOverride: overrideDeSabina(Array.from(estado.delUsuario)) },
      { activa, permisos: sameAsUser ? [] : marcadasEfectivas },
    );
  }, [member, estado, activa, sameAsUser, marcadasEfectivas]);

  function toggleSameAsUser(next: boolean) {
    if (!estado) return;
    setSameAsUser(next);
    // Al personalizar se arranca con todo lo del usuario marcado: lo natural es
    // quitarle a Sabina un par de cosas, no volver a marcar treinta.
    if (next) setSelected(new Set(estado.delUsuario));
  }

  function togglePermission(key: PermissionKey) {
    if (!estado || !activa || sameAsUser || !estado.delUsuario.has(key)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const personalizadaVacia = activa && !sameAsUser && marcadasEfectivas.length === 0;

  async function save() {
    if (!member || !estado) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/team/${member.id}/sabina-permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sabinaEnabled: activa,
          // Apagada con una lista personalizada vacía no hay nada que recordar.
          sabinaPermissions: sameAsUser || marcadasEfectivas.length === 0 ? null : marcadasEfectivas,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? t("settings.sabinaPermissions.saveError"));
      toast.success(t("settings.sabinaPermissions.updated"));
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? t("common.genericError"));
    } finally {
      setSaving(false);
    }
  }

  if (!open || !member) return null;
  const fullName = `${member.firstName} ${member.lastName}`.trim();
  const name = member.firstName || fullName;
  const bloqueado = !estado || !estado.disponible;

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
            <Sparkles size={16} strokeWidth={1.75} aria-hidden style={{ color: "var(--brand)" }} />
            {t("settings.sabinaPermissions.title", { name: fullName })}
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
          <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.5, margin: 0 }}>
            {t("settings.sabinaPermissions.intro", { name })}
          </p>

          {errorCarga ? (
            <Aviso tono="danger">{errorCarga}</Aviso>
          ) : !estado ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-3)" }}>
              <Loader2 size={14} aria-hidden className="animate-spin" /> {t("common.loading")}
            </div>
          ) : (
            <>
              {!estado.disponible && <Aviso tono="warning">{estado.aviso ?? t("settings.sabinaPermissions.missingSql")}</Aviso>}

              {/* Interruptor general */}
              <Interruptor
                activo={activa}
                deshabilitado={bloqueado}
                titulo={t("settings.sabinaPermissions.enabled", { name })}
                pista={activa ? t("settings.sabinaPermissions.enabledHint", { name }) : t("settings.sabinaPermissions.disabledHint", { name })}
                onChange={setActiva}
              />

              {activa && (
                <Interruptor
                  activo={sameAsUser}
                  deshabilitado={bloqueado}
                  titulo={t("settings.sabinaPermissions.sameAsUser", { name })}
                  pista={sameAsUser ? t("settings.sabinaPermissions.sameAsUserHint", { name }) : t("settings.sabinaPermissions.customHint", { name })}
                  onChange={toggleSameAsUser}
                />
              )}

              {resumen && (
                <div style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                  {activa
                    ? t("settings.sabinaPermissions.summary", { sabina: resumen.permitidas.length, user: resumen.delUsuario.length, name })
                    : t("settings.sabinaPermissions.summaryOff", { name })}
                </div>
              )}

              {activa && (
                <div
                  style={{
                    display: "flex", alignItems: "flex-start", gap: 8, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.45,
                  }}
                >
                  <span className="badge-new badge-new--neutral" style={{ height: 16, padding: "0 6px", fontSize: 9, flexShrink: 0, marginTop: 1 }}>
                    {t("settings.sabinaPermissions.userLacksBadge")}
                  </span>
                  <span>{t("settings.sabinaPermissions.userLacksLegend", { name })}</span>
                </div>
              )}

              {activa && (
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
                          const usuarioLaTiene = estado.delUsuario.has(key);
                          const isChecked = usuarioLaTiene && (sameAsUser || selected.has(key));
                          const disabled = bloqueado || sameAsUser || !usuarioLaTiene;
                          return (
                            <label
                              key={key}
                              className={`flex items-start justify-between gap-2 ${disabled ? "" : "hover:bg-[var(--bg-hover)]"}`}
                              title={usuarioLaTiene ? undefined : t("settings.sabinaPermissions.userLacksTitle", { name })}
                              style={{
                                padding: "6px 8px",
                                borderRadius: "var(--radius-sm)",
                                cursor: disabled ? "default" : "pointer",
                                // Lo que el usuario no tiene va más apagado que el
                                // modo «lo mismo que el usuario»: son dos motivos
                                // distintos y se tienen que distinguir de un vistazo.
                                opacity: !usuarioLaTiene ? 0.45 : sameAsUser ? 0.7 : 1,
                                transition: "background var(--dur-1) var(--ease)",
                              }}
                            >
                              <div className="min-w-0 flex-1">
                                <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--text-1)" }}>
                                  {ALL_PERMISSIONS[key]}
                                </div>
                                <div
                                  className="mono"
                                  style={{ fontSize: 10.5, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6, marginTop: 1, flexWrap: "wrap" }}
                                >
                                  {key}
                                  {!usuarioLaTiene && (
                                    <span
                                      className="badge-new badge-new--neutral"
                                      style={{ height: 16, padding: "0 6px", fontSize: 9 }}
                                    >
                                      {t("settings.sabinaPermissions.userLacksBadge")}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={disabled}
                                onChange={() => togglePermission(key)}
                                className="peer sr-only"
                                aria-describedby={usuarioLaTiene ? undefined : `sabina-lacks-${key}`}
                              />
                              {!usuarioLaTiene && (
                                <span id={`sabina-lacks-${key}`} className="sr-only">
                                  {t("settings.sabinaPermissions.userLacksTitle", { name })}
                                </span>
                              )}
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
              )}
            </>
          )}
        </div>

        <div className="modal__footer" style={{ flexWrap: "wrap" }}>
          {personalizadaVacia && (
            <span style={{ fontSize: 12, color: "var(--warning-strong)", marginRight: "auto" }}>
              {t("settings.sabinaPermissions.emptyCustom")}
            </span>
          )}
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
            disabled={saving || bloqueado || personalizadaVacia}
            className="btn-new btn-new--primary"
          >
            {saving
              ? t("common.saving")
              : !activa
                ? t("settings.sabinaPermissions.saveDisabled")
                : sameAsUser
                  ? t("settings.sabinaPermissions.saveSameAsUser")
                  : t("settings.sabinaPermissions.saveCount", { count: marcadasEfectivas.length })}
          </button>
        </div>
      </div>
    </div>
  );
}

function Interruptor({
  activo,
  deshabilitado,
  titulo,
  pista,
  onChange,
}: {
  activo: boolean;
  deshabilitado: boolean;
  titulo: string;
  pista: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start justify-between gap-3 ${deshabilitado ? "" : "cursor-pointer"}`}
      style={{
        padding: 14,
        borderRadius: "var(--radius)",
        border: `1px solid ${activo ? "var(--consult-active-border)" : "var(--border-soft)"}`,
        background: activo ? "var(--brand-softer)" : "transparent",
        opacity: deshabilitado ? 0.6 : 1,
        transition: "background var(--dur-1) var(--ease), border-color var(--dur-1) var(--ease)",
      }}
    >
      <div className="flex-1">
        <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text-1)" }}>{titulo}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{pista}</div>
      </div>
      <input
        type="checkbox"
        checked={activo}
        disabled={deshabilitado}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        className={`switch peer-focus-visible:shadow-[var(--ring)] ${activo ? "switch--on" : ""}`}
        aria-hidden
        style={{ marginTop: 2 }}
      >
        <span className="switch__thumb" />
      </span>
    </label>
  );
}

function Aviso({ tono, children }: { tono: "warning" | "danger"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      style={{
        display: "flex", alignItems: "flex-start", gap: 8, padding: 12, fontSize: 12.5, lineHeight: 1.45,
        borderRadius: "var(--radius)",
        border: `1px solid var(--${tono}-border-strong)`,
        background: `var(--${tono}-soft)`,
        color: `var(--${tono}-strong)`,
      }}
    >
      <AlertTriangle size={14} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{children}</span>
    </div>
  );
}
