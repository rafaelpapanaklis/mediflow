"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Copy, KeyRound, Pencil, Plus, ShieldCheck, UserPlus, Users } from "lucide-react";
import type { BarberRole } from "@/lib/barber/types";
import type { BarberMemberRow, BarberTeamContext } from "@/lib/barber/team";
import type { AdminBranchOption } from "./admin-nav";
import { opcionesDeFicha } from "@/lib/barber/team-fichas";
import { PermissionMatrix } from "./permission-matrix";
import {
  adminStyles as s,
  apiCall,
  Avatar,
  Banner,
  Btn,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  Modal,
  Select,
  SwitchRow,
  TextInput,
  useSaving,
  useT,
} from "./admin-ui";

// ═══════════════════════════════════════════════════════════════════════
// /barber/equipo — quién entra al panel y qué puede hacer.
//
// Cada tarjeta dice en una línea si esa persona HEREDA los permisos de su rol
// o si tiene excepciones puestas a mano, y cuántas. La matriz completa vive
// en permission-matrix.tsx.
// ═══════════════════════════════════════════════════════════════════════

const ROLES: BarberRole[] = ["OWNER", "MANAGER", "RECEPTION", "BARBER"];

interface BarberOption {
  id: string;
  name: string;
  barbershopId: string;
}

type InviteState = {
  firstName: string;
  lastName: string;
  email: string;
  role: BarberRole;
  barberId: string;
  barbershopId: string;
};

type EditState = {
  id: string;
  firstName: string;
  lastName: string;
  role: BarberRole;
  barberId: string;
  isActive: boolean;
  /** Sede de la persona: solo se ofrecen las fichas de ahí. */
  barbershopId: string;
};

export function TeamClient({
  initialMembers,
  team,
  barbers,
  branches,
  activeBranchId,
  isConsolidated,
  initialInviteBarberId = null,
}: {
  /** Llega de «Darle acceso al panel» en Barberos (?alta=<ficha>): abre el alta con esa ficha. */
  initialInviteBarberId?: string | null;
  initialMembers: BarberMemberRow[];
  team: BarberTeamContext;
  barbers: BarberOption[];
  branches: AdminBranchOption[];
  activeBranchId: string | null;
  isConsolidated: boolean;
}) {
  const t = useT();
  const [members, setMembers] = useState(initialMembers);
  // Desde Barberos («Darle acceso al panel»): el alta ya abierta, rol Barbero y
  // esa ficha elegida en SU sede. Una ficha que no está en la lista (otra sede,
  // inactiva) no abre nada.
  const [invite, setInvite] = useState<InviteState | null>(() => {
    const ficha = initialInviteBarberId ? barbers.find((b) => b.id === initialInviteBarberId) : null;
    if (!ficha || isConsolidated) return null;
    return { firstName: "", lastName: "", email: "", role: "BARBER", barberId: ficha.id, barbershopId: ficha.barbershopId };
  });
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [permsFor, setPermsFor] = useState<BarberMemberRow | null>(null);
  const [branchesFor, setBranchesFor] = useState<BarberMemberRow | null>(null);
  const [copied, setCopied] = useState(false);
  const { saving, error, setError, run } = useSaving();

  // Alta por defecto en la sede que se ve, salvo que esté cerrada (igual que Barberos).
  const openBranches = branches.filter((b) => b.isActive);
  const writeBranchId =
    (activeBranchId && openBranches.some((b) => b.id === activeBranchId) ? activeBranchId : openBranches[0]?.id) ??
    activeBranchId ??
    branches[0]?.id ??
    "";

  /** Opciones de ficha con «ya es de …» y solo de la sede de la persona. */
  function fichaOptions(barbershopId: string, miembroId: string | null, actual: string | null = null) {
    return opcionesDeFicha(barbers, members, { barbershopId, miembroId, actual }).map((o) => (
      // El servidor ya no deja ligar una ficha ocupada (409): aquí se ve y no se elige.
      <option key={o.id} value={o.id} disabled={Boolean(o.ligadaA) && o.id !== actual}>
        {o.ligadaA ? t("team.linkedBarberTaken", { name: o.name, who: o.ligadaA }) : o.name}
      </option>
    ));
  }
  const branchLabelById = useMemo(
    () => new Map(branches.map((b) => [b.id, b.label])),
    [branches],
  );

  function roleLabel(role: BarberRole) {
    return t(`roles.${role}`);
  }

  function upsert(next: BarberMemberRow) {
    setMembers((list) => list.map((m) => (m.id === next.id ? next : m)));
  }

  // Dueños y Encargados los nombra solo el dueño (D1, 16-nov). Al editar se
  // conserva en la lista el rol que la persona YA tiene, para que se lea bien.
  const assignableRoles = team.canAssignOwner ? ROLES : ROLES.filter((r) => r !== "OWNER" && r !== "MANAGER");
  const rolesForEdit = (id: string) => {
    const actual = members.find((m) => m.id === id)?.role;
    return ROLES.filter((r) => assignableRoles.includes(r) || r === actual);
  };

  /** Fila de un dueño vista por alguien que no lo es: solo se mira. */
  function ownerLocked(m: BarberMemberRow): boolean {
    return m.role === "OWNER" && team.selfRole !== "OWNER";
  }

  async function submitInvite() {
    if (!invite) return;
    const ok = await run(async () => {
      const { member, tempPassword } = await apiCall<{
        member: BarberMemberRow;
        tempPassword: string;
      }>("/api/barber/team/members", { method: "POST", json: invite });
      setMembers((list) => [...list, member]);
      setCreated({ name: `${member.firstName} ${member.lastName}`, password: tempPassword });
    });
    if (ok) setInvite(null);
  }

  async function submitEdit() {
    if (!edit) return;
    const ok = await run(async () => {
      const { member } = await apiCall<{ member: BarberMemberRow }>(
        `/api/barber/team/members/${edit.id}`,
        {
          method: "PATCH",
          json: {
            firstName: edit.firstName,
            lastName: edit.lastName,
            role: edit.role,
            barberId: edit.barberId || null,
            isActive: edit.isActive,
          },
        },
      );
      upsert(member);
    });
    if (ok) setEdit(null);
  }

  function permsSummary(m: BarberMemberRow) {
    if (!m.permissions.hasOverride) {
      return <Chip tone="muted">{t("team.inheritsRole", { role: roleLabel(m.role) })}</Chip>;
    }
    const parts: string[] = [];
    if (m.permissions.added.length > 0) {
      parts.push(t("perms.sumAdded", { count: m.permissions.added.length }));
    }
    if (m.permissions.removed.length > 0) {
      parts.push(t("perms.sumRemoved", { count: m.permissions.removed.length }));
    }
    return <Chip tone="warn">{parts.join(" · ")}</Chip>;
  }

  return (
    <>
      <header className={s.header}>
        <div className={s.headerText}>
          <h1 className={s.title}>{t("team.title")}</h1>
          <p className={s.subtitle}>{t("team.subtitle")}</p>
          {/* Equipo ≠ Barberos (16-nov): las cuentas aquí; las fichas de quienes cortan allá. */}
          <p className={s.subtitle}>
            {t("team.subtitleOther")}{" "}
            <Link href="/barber/barberos" style={{ color: "var(--brand)", fontWeight: 600 }}>
              {t("nav.barberos")}
            </Link>
            .
          </p>
        </div>
        <div className={s.headerActions}>
          <Btn
            variant="primary"
            disabled={isConsolidated}
            onClick={() =>
              setInvite({
                firstName: "",
                lastName: "",
                email: "",
                role: "RECEPTION",
                barberId: "",
                barbershopId: writeBranchId,
              })
            }
          >
            <UserPlus size={15} />
            {t("team.invite")}
          </Btn>
        </div>
      </header>

      {isConsolidated ? (
        <Banner icon={<Building2 size={16} />}>
          {t("branch.consolidatedHint", { count: branches.length })}
        </Banner>
      ) : null}

      {!team.advancedRoles ? (
        <Banner title={t("perms.lockedTitle")} icon={<ShieldCheck size={16} />}>
          {t("perms.lockedBody", { plan: team.planName })}
        </Banner>
      ) : null}

      {members.length === 0 ? (
        <div className={s.card}>
          <EmptyState icon={<Users size={22} />} title={t("team.empty")} />
        </div>
      ) : (
        <div className={s.grid}>
          {members.map((m) => (
            <article
              key={m.id}
              className={[s.rowCard, m.isActive ? "" : s.rowCardMuted].filter(Boolean).join(" ")}
            >
              <Avatar name={`${m.firstName} ${m.lastName}`} />
              <div className={s.rowMain}>
                <div className={s.rowTitle}>
                  <span className={s.truncate}>
                    {m.firstName} {m.lastName}
                  </span>
                  {m.isSelf ? <Chip tone="brand">{t("team.you")}</Chip> : null}
                  {!m.isActive ? <Chip tone="muted">{t("common.inactive")}</Chip> : null}
                </div>
                <div className={s.rowMeta}>
                  <span className={[s.rowMetaItem, s.truncate].join(" ")}>{m.email}</span>
                  {/* Último acceso (como el Equipo del dental): saber si ya entró con su cuenta. */}
                  <span className={s.rowMetaItem} suppressHydrationWarning>
                    {m.lastLogin
                      ? `${t("team.lastLogin")}: ${new Intl.DateTimeFormat(t("team.dateLocale"), { day: "numeric", month: "short", year: "numeric" }).format(new Date(m.lastLogin))}`
                      : t("team.neverEntered")}
                  </span>
                </div>
                <div className={s.rowMeta}>
                  <Chip>{roleLabel(m.role)}</Chip>
                  {permsSummary(m)}
                  {m.barberName ? (
                    <Chip tone="muted">{t("team.linkedBarberChip", { name: m.barberName })}</Chip>
                  ) : null}
                  {m.noSchedule && m.barberId ? (
                    <Link href={`/barber/agenda/horarios?barbero=${encodeURIComponent(m.barberId)}`} title={t("team.noScheduleAction")}>
                      <Chip tone="warn">{t("team.noScheduleWarn")} →</Chip>
                    </Link>
                  ) : null}
                  {isConsolidated ? (
                    <Chip tone="muted">{branchLabelById.get(m.barbershopId) ?? ""}</Chip>
                  ) : null}
                  {m.branchAccessIds.length > 0 ? (
                    <Chip tone="muted">
                      {t("team.branchAccessCount", { count: m.branchAccessIds.length + 1 })}
                    </Chip>
                  ) : null}
                </div>
                {/* A un dueño solo lo cambia otro dueño (el servidor contesta
                    403: team.ts, assertCanTouchMember). Quien no lo es no ve
                    Permisos ni Editar —la baja vive dentro de Editar— sobre
                    esa fila, en vez de botones que fallan al guardar. */}
                <div className={s.rowActions}>
                  {ownerLocked(m) ? (
                    <Chip tone="muted">{t("team.ownerOnlyNote")}</Chip>
                  ) : (
                    <Btn size="sm" onClick={() => setPermsFor(m)}>
                      <KeyRound size={13} />
                      {t("team.permissionsBtn")}
                    </Btn>
                  )}
                  {team.multiBranch && team.canManageBranches ? (
                    <Btn size="sm" onClick={() => setBranchesFor(m)}>
                      <Building2 size={13} />
                      {t("team.branchesBtn")}
                    </Btn>
                  ) : null}
                  {ownerLocked(m) ? null : (
                    <Btn
                      size="sm"
                      onClick={() =>
                        setEdit({
                          id: m.id,
                          firstName: m.firstName,
                          lastName: m.lastName,
                          role: m.role,
                          barberId: m.barberId ?? "",
                          isActive: m.isActive,
                          barbershopId: m.barbershopId,
                        })
                      }
                    >
                      <Pencil size={13} />
                      {t("common.edit")}
                    </Btn>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {invite ? (
        <Modal
          title={t("team.formInvite")}
          onClose={() => {
            setInvite(null);
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setInvite(null)} disabled={saving}>
                {t("common.cancel")}
              </Btn>
              <Btn variant="primary" onClick={submitInvite} disabled={saving}>
                {saving ? t("common.saving") : t("team.invite")}
              </Btn>
            </>
          }
        >
          <ErrorText>{error}</ErrorText>
          <div className={s.formGrid}>
            <Field label={t("team.firstName")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={invite.firstName}
                  maxLength={60}
                  onChange={(e) => setInvite({ ...invite, firstName: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("team.lastName")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={invite.lastName}
                  maxLength={60}
                  onChange={(e) => setInvite({ ...invite, lastName: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("team.email")} hint={t("team.emailHint")} full>
              {(id) => (
                <TextInput
                  id={id}
                  type="email"
                  value={invite.email}
                  maxLength={160}
                  onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("team.role")} hint={t(`roleHint.${invite.role}`)}>
              {(id) => (
                <Select
                  id={id}
                  value={invite.role}
                  onChange={(e) => setInvite({ ...invite, role: e.target.value as BarberRole })}
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={t("team.linkedBarber")}
              hint={invite.role === "BARBER" && !invite.barberId ? t("team.barberWithoutFicha") : t("team.linkedBarberHint")}
            >
              {(id) => (
                <Select
                  id={id}
                  value={invite.barberId}
                  onChange={(e) => setInvite({ ...invite, barberId: e.target.value })}
                >
                  <option value="">{t("team.linkedBarberNone")}</option>
                  {fichaOptions(invite.barbershopId, null)}
                </Select>
              )}
            </Field>
            {branches.length > 1 ? (
              <Field label={t("team.branch")} full>
                {(id) => (
                  <Select
                    id={id}
                    value={invite.barbershopId}
                    onChange={(e) =>
                      setInvite({ ...invite, barbershopId: e.target.value, barberId: "" })
                    }
                  >
                    {branches.map((b) => (
                      // Una sede cerrada no recibe altas: se ve, marcada, sin poder elegirse.
                      <option key={b.id} value={b.id} disabled={!b.isActive}>
                        {b.isActive ? b.label : `${b.label} (${t("branch.closed").toLowerCase()})`}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {created ? (
        <Modal
          title={t("team.created")}
          onClose={() => {
            setCreated(null);
            setCopied(false);
          }}
          footer={
            <Btn
              variant="primary"
              onClick={() => {
                setCreated(null);
                setCopied(false);
              }}
            >
              {t("team.done")}
            </Btn>
          }
        >
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.55, color: "var(--text-2)" }}>
            {t("team.createdBody", { name: created.name })}
          </p>
          <div className={s.switchRow}>
            <div style={{ minWidth: 0 }}>
              <div className={s.label}>{t("team.tempPassword")}</div>
              <code style={{ fontSize: 16, fontWeight: 700, letterSpacing: ".04em" }}>
                {created.password}
              </code>
            </div>
            <Btn
              size="sm"
              onClick={() => {
                navigator.clipboard?.writeText(created.password).catch(() => undefined);
                setCopied(true);
              }}
            >
              <Copy size={13} />
              {copied ? t("common.copied") : t("common.copy")}
            </Btn>
          </div>
          <p className={s.hint}>{t("team.createdHint")}</p>
        </Modal>
      ) : null}

      {edit ? (
        <Modal
          title={t("team.formEdit", { name: `${edit.firstName} ${edit.lastName}` })}
          onClose={() => {
            setEdit(null);
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setEdit(null)} disabled={saving}>
                {t("common.cancel")}
              </Btn>
              <Btn variant="primary" onClick={submitEdit} disabled={saving}>
                {saving ? t("common.saving") : t("common.save")}
              </Btn>
            </>
          }
        >
          <ErrorText>{error}</ErrorText>
          <div className={s.formGrid}>
            <Field label={t("team.firstName")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={edit.firstName}
                  maxLength={60}
                  onChange={(e) => setEdit({ ...edit, firstName: e.target.value })}
                />
              )}
            </Field>
            <Field label={t("team.lastName")}>
              {(id) => (
                <TextInput
                  id={id}
                  value={edit.lastName}
                  maxLength={60}
                  onChange={(e) => setEdit({ ...edit, lastName: e.target.value })}
                />
              )}
            </Field>
            <Field
              label={t("team.role")}
              hint={
                edit.id === team.selfUserId
                  ? t("perms.selfWarning")
                  : t("team.roleChangeResetsOverrides")
              }
            >
              {(id) => (
                <Select
                  id={id}
                  value={edit.role}
                  disabled={edit.id === team.selfUserId}
                  onChange={(e) => setEdit({ ...edit, role: e.target.value as BarberRole })}
                >
                  {rolesForEdit(edit.id).map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label={t("team.linkedBarber")}
              hint={edit.role === "BARBER" && !edit.barberId ? t("team.barberWithoutFicha") : t("team.linkedBarberHint")}
            >
              {(id) => (
                <Select
                  id={id}
                  value={edit.barberId}
                  onChange={(e) => setEdit({ ...edit, barberId: e.target.value })}
                >
                  <option value="">{t("team.linkedBarberNone")}</option>
                  {fichaOptions(edit.barbershopId, edit.id, edit.barberId || null)}
                </Select>
              )}
            </Field>
          </div>
          <p className={s.hint}>{t("team.emailLocked")}</p>
          <SwitchRow
            title={t("common.active")}
            hint={edit.id === team.selfUserId ? t("perms.selfWarning") : undefined}
            checked={edit.isActive}
            disabled={edit.id === team.selfUserId}
            onChange={(v) => setEdit({ ...edit, isActive: v })}
          />
        </Modal>
      ) : null}

      {branchesFor ? (
        <BranchAccessModal
          member={branchesFor}
          branches={branches}
          onClose={() => setBranchesFor(null)}
          onSaved={(next) => {
            upsert(next);
            setBranchesFor(null);
          }}
        />
      ) : null}

      {permsFor ? (
        <PermissionMatrix
          member={permsFor}
          roleLabel={roleLabel(permsFor.role)}
          advancedRoles={team.advancedRoles}
          planName={team.planName}
          ownPermissions={team.selfPermissions}
          onClose={() => setPermsFor(null)}
          onSaved={upsert}
        />
      ) : null}
    </>
  );
}

/** Reparte el acceso de una persona a otras sedes de la cadena. */
function BranchAccessModal({
  member,
  branches,
  onClose,
  onSaved,
}: {
  member: BarberMemberRow;
  branches: AdminBranchOption[];
  onClose: () => void;
  onSaved: (next: BarberMemberRow) => void;
}) {
  const t = useT();
  const { saving, error, run } = useSaving();
  const [selected, setSelected] = useState<string[]>(() => member.branchAccessIds.slice());

  async function save() {
    await run(async () => {
      const { member: next } = await apiCall<{ member: BarberMemberRow }>(
        `/api/barber/team/members/${member.id}/branches`,
        { method: "PUT", json: { branchIds: selected } },
      );
      onSaved(next);
    });
  }

  return (
    <Modal
      title={t("team.branchAccessTitle", { name: member.firstName })}
      subtitle={t("team.branchAccessBody")}
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            {t("common.cancel")}
          </Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? t("common.saving") : t("common.save")}
          </Btn>
        </>
      }
    >
      <ErrorText>{error}</ErrorText>
      {member.role === "OWNER" ? <p className={s.hint}>{t("team.branchAccessOwner")}</p> : null}
      {branches.map((b) => {
        const isHome = b.id === member.barbershopId;
        return (
          <SwitchRow
            key={b.id}
            title={b.label}
            hint={isHome ? t("team.branchAccessHome") : undefined}
            checked={isHome || selected.includes(b.id)}
            disabled={isHome || saving}
            onChange={(on) =>
              setSelected((prev) => (on ? prev.concat(b.id) : prev.filter((id) => id !== b.id)))
            }
          />
        );
      })}
    </Modal>
  );
}
