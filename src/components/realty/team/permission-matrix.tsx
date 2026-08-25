"use client";

import { useMemo, useState } from "react";
import { Info, RotateCcw, TriangleAlert } from "lucide-react";
import type { RealtyPermissionKey } from "@/lib/realty/permissions";
import type { RealtyMemberRow } from "@/lib/realty/team";
import { REALTY_ROLE_LABELS } from "@/lib/realty/types";
import { apiCall, Banner, Btn, ErrorText, Modal, Switch, styles as s, useSaving } from "./ui";

// ═══════════════════════════════════════════════════════════════════════
// MATRIZ DE PERMISOS — la pantalla que evita el bug del dental.
//
// Regla del motor (realty/permissions.ts): permissionsOverride REEMPLAZA los
// defaults del rol, no se suma. Si esta pantalla dejara guardar un "delta",
// darle un permiso a alguien le apagaría todos los demás.
//
// Aquí se edita SIEMPRE el conjunto EFECTIVO completo y se manda entero. Cada
// renglón enseña tres cosas a la vez:
//   · si el ROL lo trae de fábrica,
//   · si es una excepción puesta a mano (añadido / quitado),
//   · y el interruptor, que es el RESULTADO FINAL — lo mismo que va a validar
//     assertRealtyPermission en el servidor.
//
// 🔴 Y encima está la ADVERTENCIA que pide la regla: en cuanto hay una sola
// excepción, esta persona DEJA DE HEREDAR. Un permiso nuevo que se agregue
// mañana al rol NO le llega. Eso se dice con todas sus letras, no se supone.
// ═══════════════════════════════════════════════════════════════════════

const GROUP_LABELS: Record<string, string> = {
  properties: "Inmuebles",
  leads: "Prospectos",
  visits: "Visitas",
  keys: "Llaves",
  owners: "Propietarios",
  leases: "Contratos de renta",
  payments: "Cobranza",
  maintenance: "Mantenimientos",
  expenses: "Gastos",
  deals: "Operaciones cerradas",
  commissions: "Comisiones",
  web: "Web pública",
  portals: "Portales",
  whatsapp: "WhatsApp",
  calculators: "Calculadoras",
  team: "Equipo",
  offices: "Oficinas",
  settings: "Configuración",
  billing: "Suscripción",
  support: "Soporte",
};

export function PermissionMatrix({
  member,
  selfEffective,
  onClose,
  onSaved,
}: {
  member: RealtyMemberRow;
  /** Lo que tiene QUIEN MIRA: nadie reparte lo que no tiene. */
  selfEffective: RealtyPermissionKey[];
  onClose: () => void;
  onSaved: (next: RealtyMemberRow) => void;
}) {
  const { saving, error, run } = useSaving();
  const [effective, setEffective] = useState<RealtyPermissionKey[]>(() =>
    member.permissions.effective.slice(),
  );

  const items = member.permissions.items;
  const roleLabel = REALTY_ROLE_LABELS[member.role];
  const roleDefaults = useMemo(
    () => items.filter((i) => i.fromRole).map((i) => i.key),
    [items],
  );
  const effectiveSet = useMemo(() => new Set<string>(effective), [effective]);
  // El servidor rechaza mover una clave que el llamante no posee
  // (setMemberPermissions). Aquí se apaga el interruptor para que el candado
  // se vea ANTES de guardar, no después.
  const mine = useMemo(() => new Set<string>(selfEffective), [selfEffective]);
  const lockedCount = items.filter((i) => !mine.has(i.key)).length;

  function toggle(key: RealtyPermissionKey) {
    setEffective((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : prev.concat(key)));
  }

  const added = items.filter((i) => effectiveSet.has(i.key) && !i.fromRole);
  const removed = items.filter((i) => !effectiveSet.has(i.key) && i.fromRole);
  const inheritsAll = added.length === 0 && removed.length === 0;

  // Agrupa por el prefijo de la clave ("leads.view" → leads). Una clave con
  // prefijo nuevo cae en "Otros" y SIGUE saliendo: nunca se pierde un permiso
  // por faltarle una etiqueta.
  const groups = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const item of items) {
      const prefix = item.key.split(".")[0] ?? "otros";
      const list = map.get(prefix);
      if (list) list.push(item);
      else map.set(prefix, [item]);
    }
    return Array.from(map.entries());
  }, [items]);

  const dirty =
    effective.length !== member.permissions.effective.length ||
    effective.some((k) => !member.permissions.effective.includes(k));

  async function save() {
    const ok = await run(async () => {
      const { member: next } = await apiCall<{ member: RealtyMemberRow }>(
        `/api/realty/team/${member.id}/permissions`,
        { method: "PUT", json: { permissions: effective } },
      );
      onSaved(next);
    });
    if (ok) onClose();
  }

  const diffParts: string[] = [];
  if (added.length > 0) diffParts.push(`${added.length} ${added.length === 1 ? "añadido" : "añadidos"} a mano`);
  if (removed.length > 0) {
    diffParts.push(`${removed.length} ${removed.length === 1 ? "quitado" : "quitados"} a mano`);
  }

  return (
    <Modal
      wide
      title={`Permisos de ${member.fullName}`}
      subtitle={`Rol: ${roleLabel}`}
      onClose={onClose}
      footer={
        <div className={[s.modalFoot, s.modalFootSpread].join(" ")} style={{ padding: 0, border: "none", width: "100%" }}>
          <Btn
            variant="ghost"
            onClick={() =>
              // Respeta los candados: lo que no es tuyo se queda como está.
              setEffective(
                items
                  .filter((i) => (mine.has(i.key) ? i.fromRole : effectiveSet.has(i.key)))
                  .map((i) => i.key),
              )
            }
            disabled={saving || inheritsAll}
            title={`Deja de tener excepciones y vuelve a heredar de ${roleLabel}.`}
          >
            <RotateCcw size={14} />
            Volver a los permisos del rol
          </Btn>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn variant="ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </Btn>
            <Btn variant="primary" onClick={save} disabled={saving || !dirty}>
              {saving ? "Guardando…" : "Guardar"}
            </Btn>
          </div>
        </div>
      }
    >
      <ErrorText>{error}</ErrorText>

      <Banner title="Cómo funciona" icon={<Info size={16} />}>
        Marca lo que esta persona debe poder hacer. Lo que ves aquí es exactamente lo que el
        sistema va a permitir: no hay nada escondido detrás.
      </Banner>

      {/* 🔴 LA ADVERTENCIA. Aparece en cuanto hay una excepción, porque a
          partir de ahí el rol deja de mandar sobre esta persona. */}
      {inheritsAll ? (
        <p className={s.hint}>
          Hereda todo de <strong>{roleLabel}</strong>. Si mañana ese rol gana un permiso nuevo,
          esta persona lo gana también.
        </p>
      ) : (
        <Banner tone="warn" title="Con excepciones, deja de heredar" icon={<TriangleAlert size={16} />}>
          Al guardar una sola excepción, los permisos de {member.fullName} se congelan en lo que
          marques aquí: <strong>dejan de venir del rol {roleLabel}</strong>. Si mañana agregamos un
          permiso nuevo a ese rol, a esta persona NO le va a llegar y habrá que dárselo aquí a
          mano. Si no es lo que quieres, usa «Volver a los permisos del rol».
        </Banner>
      )}

      {lockedCount > 0 ? (
        <p className={s.hint}>
          Hay {lockedCount} {lockedCount === 1 ? "permiso" : "permisos"} en gris: son los que tú no
          tienes, y nadie puede repartir lo que no tiene. Se quedan como están.
        </p>
      ) : null}

      {member.isSelf ? (
        <p className={s.hint}>
          Eres tú: no puedes quitarte a ti mismo el permiso de administrar el equipo.
        </p>
      ) : null}

      <div>
        {groups.map(([prefix, list]) => (
          <div key={prefix} className={s.permGroup}>
            <div className={s.permGroupTitle}>{GROUP_LABELS[prefix] ?? "Otros"}</div>
            {list.map((item) => {
              const on = effectiveSet.has(item.key);
              const isAdded = on && !item.fromRole;
              const isRemoved = !on && item.fromRole;
              const lockSelf = member.isSelf && item.key === "team.manage";
              // El servidor lo va a rechazar (setMemberPermissions): más vale
              // un candado visible que un error después de guardar.
              const notMine = !mine.has(item.key);
              return (
                <div
                  key={item.key}
                  className={[s.permRow, isAdded || isRemoved ? s.permRowChanged : ""]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className={s.permLabel}>{item.label}</span>
                  {isAdded ? (
                    <span className={[s.permTag, s.permTagAdded].join(" ")}>Añadido</span>
                  ) : null}
                  {isRemoved ? (
                    <span className={[s.permTag, s.permTagRemoved].join(" ")}>Quitado</span>
                  ) : null}
                  {on && item.fromRole && !isAdded ? (
                    <span className={[s.permTag, s.permTagInherited].join(" ")}>Del rol</span>
                  ) : null}
                  {notMine ? (
                    <span
                      className={[s.permTag, s.permTagInherited].join(" ")}
                      title="No puedes repartir un permiso que tú no tienes."
                    >
                      No es tuyo
                    </span>
                  ) : null}
                  <Switch
                    checked={on}
                    onChange={() => toggle(item.key)}
                    label={item.label}
                    disabled={saving || lockSelf || notMine}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className={s.permSummary}>
        {inheritsAll
          ? `Hereda todo de ${roleLabel}.`
          : `${effective.length} ${effective.length === 1 ? "permiso" : "permisos"} en total · ${diffParts.join(" · ")} respecto a ${roleLabel}.`}
      </div>
    </Modal>
  );
}
