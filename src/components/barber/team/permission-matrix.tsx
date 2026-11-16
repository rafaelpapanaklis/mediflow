"use client";

import { useMemo, useState } from "react";
import { Info, RotateCcw, ShieldCheck } from "lucide-react";
import { includedBy, type BarberPermissionKey } from "@/lib/barber/permissions";
import type { BarberMemberRow } from "@/lib/barber/team";
import {
  adminStyles as s,
  apiCall,
  Banner,
  Btn,
  ErrorText,
  Modal,
  Switch,
  useSaving,
  useT,
} from "./admin-ui";

// ═══════════════════════════════════════════════════════════════════════
// MATRIZ DE PERMISOS — la pantalla que arregla el bug del dental.
//
// Regla del motor: permissionsOverride REEMPLAZA los defaults del rol. Si la
// pantalla dejara guardar un "delta", darle un permiso a alguien le apagaría
// todos los demás — que es exactamente lo que pasó en el dental.
//
// Aquí se edita SIEMPRE el conjunto EFECTIVO completo y se manda entero. Por
// eso cada renglón enseña tres cosas a la vez:
//   · si el ROL lo trae de fábrica,
//   · si es una excepción puesta a mano (añadido / quitado),
//   · y el interruptor, que es el RESULTADO FINAL — lo mismo que va a
//     validar assertBarberPermission en el servidor.
// El resumen de abajo dice en una línea qué le queda.
// ═══════════════════════════════════════════════════════════════════════

type Origin = "inherited" | "added" | "removed" | "roleOnly";

export function PermissionMatrix({
  member,
  roleLabel,
  advancedRoles,
  planName,
  ownPermissions,
  onClose,
  onSaved,
}: {
  member: BarberMemberRow;
  roleLabel: string;
  advancedRoles: boolean;
  planName: string;
  /** Permisos efectivos de quien edita: lo que no tiene, no lo puede dar. */
  ownPermissions: BarberPermissionKey[];
  onClose: () => void;
  onSaved: (next: BarberMemberRow) => void;
}) {
  const t = useT();
  const { saving, error, run } = useSaving();
  const [effective, setEffective] = useState<BarberPermissionKey[]>(() =>
    member.permissions.effective.slice(),
  );

  const isSelf = member.isSelf;
  const items = member.permissions.items;
  const roleDefaults = useMemo(
    () => items.filter((i) => i.fromRole).map((i) => i.key),
    [items],
  );

  // Lo INCLUIDO en otro encendido (D4, 16-nov): se pinta encendido y
  // bloqueado con «Viene con «…»». Antes se podía apagar y al guardar el
  // servidor lo volvía a sumar (BARBER_PERMISSION_IMPLIES): parecía que
  // quitarlo no servía. `effective` es lo que eligió quien edita; lo que se
  // ve, se cuenta y se manda es eso más lo incluido.
  const via = useMemo(() => includedBy(effective), [effective]);
  const shown = useMemo(() => {
    const set = new Set<BarberPermissionKey>(effective);
    for (const k of via.keys()) set.add(k);
    return items.map((i) => i.key).filter((k) => set.has(k));
  }, [effective, via, items]);
  const effectiveSet = useMemo(() => new Set<string>(shown), [shown]);
  const labelOf = (key: string) => items.find((i) => i.key === key)?.label ?? key;

  // Lo que quien edita NO puede dar: permisos que él no tiene y que esta
  // persona tampoco tenía ya guardados. Es la misma cuenta que hace el
  // servidor (team.ts, assertOnlyGrantsOwnPermissions: lo que GANA frente a lo
  // guardado), así que el interruptor se apaga aquí en vez de fallar al
  // guardar. Los que ya tenía sí se le pueden quitar y volver a poner.
  const notGrantable = useMemo(() => {
    const own = new Set<string>(ownPermissions);
    const saved = new Set<string>(member.permissions.effective);
    return new Set<string>(
      items.filter((i) => !own.has(i.key) && !saved.has(i.key)).map((i) => i.key),
    );
  }, [items, member.permissions.effective, ownPermissions]);

  function originOf(key: string, fromRole: boolean): Origin {
    const on = effectiveSet.has(key);
    if (on && fromRole) return "inherited";
    if (on) return "added";
    if (fromRole) return "removed";
    return "roleOnly";
  }

  function toggle(key: BarberPermissionKey) {
    setEffective((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : prev.concat(key),
    );
  }

  const added = items.filter((i) => originOf(i.key, i.fromRole) === "added");
  const removed = items.filter((i) => originOf(i.key, i.fromRole) === "removed");
  const inheritsAll = added.length === 0 && removed.length === 0;

  // Agrupa por el prefijo de la clave ("agenda.view" -> agenda). Si mañana
  // el contrato agrega una clave con prefijo nuevo, cae en "Otros" y sigue
  // saliendo en pantalla: nunca se pierde un permiso por falta de etiqueta.
  const groups = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const prefix = item.key.split(".")[0] ?? "other";
      const list = map.get(prefix);
      if (list) list.push(item);
      else map.set(prefix, [item]);
    }
    return Array.from(map.entries());
  }, [items]);

  function groupLabel(prefix: string): string {
    const key = `perms.group${prefix.charAt(0).toUpperCase()}${prefix.slice(1)}`;
    const label = t(key);
    return label.startsWith("barber.admin.") ? t("perms.groupOther") : label;
  }

  async function save() {
    const ok = await run(async () => {
      const { member: next } = await apiCall<{ member: BarberMemberRow }>(
        `/api/barber/team/members/${member.id}/permissions`,
        { method: "PUT", json: { permissions: shown } },
      );
      onSaved(next);
    });
    if (ok) onClose();
  }

  // Resumen en lenguaje humano: solo menciona lo que de verdad hay, y con
  // el plural correcto (el motor de i18n resuelve one/other por `count`).
  const diffParts: string[] = [];
  if (added.length > 0) diffParts.push(t("perms.sumAdded", { count: added.length }));
  if (removed.length > 0) diffParts.push(t("perms.sumRemoved", { count: removed.length }));
  const summaryLine = inheritsAll
    ? t("perms.summaryInherits", { role: roleLabel })
    : `${t("perms.sumTotal", { count: shown.length })} · ${t("perms.sumVs", {
        diff: diffParts.join(" · "),
        role: roleLabel,
      })}`;

  // «Volver al rol» también reparte: si el rol trae algo que no puedo dar,
  // el servidor lo rechazaría entero.
  const resetBlocked = roleDefaults.some((k) => notGrantable.has(k));

  const dirty =
    shown.length !== member.permissions.effective.length ||
    shown.some((k) => !member.permissions.effective.includes(k));

  return (
    <Modal
      wide
      title={t("perms.title", { name: `${member.firstName} ${member.lastName}` })}
      subtitle={t("perms.roleLine", { role: roleLabel })}
      onClose={onClose}
      footer={
        <div className={s.modalFootSpread} style={{ display: "flex", width: "100%", gap: 8 }}>
          <Btn
            variant="ghost"
            onClick={() => setEffective(roleDefaults.slice())}
            disabled={saving || inheritsAll || resetBlocked}
            title={t("perms.resetHint", { role: roleLabel })}
          >
            <RotateCcw size={14} />
            {t("perms.resetToRole")}
          </Btn>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" onClick={onClose} disabled={saving}>
              {t("common.cancel")}
            </Btn>
            <Btn variant="primary" onClick={save} disabled={saving || !dirty}>
              {saving ? t("common.saving") : t("common.save")}
            </Btn>
          </div>
        </div>
      }
    >
      <ErrorText>{error}</ErrorText>

      {advancedRoles ? (
        <Banner title={t("perms.explainTitle")} icon={<Info size={16} />}>
          {t("perms.explainBody")}
        </Banner>
      ) : (
        <Banner title={t("perms.lockedTitle")} icon={<ShieldCheck size={16} />}>
          {t("perms.lockedBody", { plan: planName })}
        </Banner>
      )}

      {isSelf ? <p className={s.hint}>{t("perms.selfWarning")}</p> : null}
      {advancedRoles && notGrantable.size > 0 ? (
        <p className={s.hint}>{t("perms.notYoursNote")}</p>
      ) : null}

      <div>
        {groups.map(([prefix, list]) => (
          <div key={prefix} className={s.permGroup}>
            <div className={s.permGroupTitle}>{groupLabel(prefix)}</div>
            {list.map((item) => {
              const origin = originOf(item.key, item.fromRole);
              const changed = origin === "added" || origin === "removed";
              const lockSelf = isSelf && item.key === "team.manage";
              const lockNotMine = notGrantable.has(item.key);
              const viaKey = via.get(item.key);
              return (
                <div
                  key={item.key}
                  className={[s.permRow, changed ? s.permRowChanged : ""]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className={s.permLabel}>{item.label}</span>
                  {viaKey ? (
                    <span className={[s.permTag, s.permTagInherited].join(" ")} data-incluido={viaKey}>
                      {t("perms.badgeIncluded", { perm: labelOf(viaKey) })}
                    </span>
                  ) : origin === "added" ? (
                    <span className={[s.permTag, s.permTagAdded].join(" ")}>
                      {t("perms.badgeAdded")}
                    </span>
                  ) : null}
                  {origin === "removed" ? (
                    <span className={[s.permTag, s.permTagRemoved].join(" ")}>
                      {t("perms.badgeRemoved")}
                    </span>
                  ) : null}
                  {origin === "inherited" && !viaKey ? (
                    <span className={[s.permTag, s.permTagInherited].join(" ")}>
                      {t("perms.badgeInherited")}
                    </span>
                  ) : null}
                  {lockNotMine && advancedRoles ? (
                    <span className={[s.permTag, s.permTagInherited].join(" ")}>
                      {t("perms.badgeNotYours")}
                    </span>
                  ) : null}
                  <Switch
                    checked={effectiveSet.has(item.key)}
                    onChange={() => toggle(item.key)}
                    label={item.label}
                    disabled={!advancedRoles || saving || lockSelf || lockNotMine || Boolean(viaKey)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className={s.permSummary}>{summaryLine}</div>
    </Modal>
  );
}
