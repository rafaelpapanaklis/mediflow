"use client";

import { useMemo, useState } from "react";
import { Building2, Copy, KeyRound, Pencil, Plus, ShieldCheck, UserPlus, Users } from "lucide-react";
import type { BarberRole } from "@/lib/barber/types";
import type { BarberMemberRow, BarberTeamContext } from "@/lib/barber/team";
import type { AdminBranchOption } from "./admin-nav";
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
};

export function TeamClient({
  initialMembers,
  team,
  barbers,
  branches,
  activeBranchId,
  isConsolidated,
}: {
  initialMembers: BarberMemberRow[];
  team: BarberTeamContext;
  barbers: BarberOption[];
  branches: AdminBranchOption[];
  activeBranchId: string | null;
  isConsolidated: boolean;
}) {
  const t = useT();
  const [members, setMembers] = useState(initialMembers);
  const [invite, setInvite] = useState<InviteState | null>(null);
  const [created, setCreated] = useState<{ name: string; password: string } | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [permsFor, setPermsFor] = useState<BarberMemberRow | null>(null);
  const [branchesFor, setBranchesFor] = useState<BarberMemberRow | null>(null);
  const [copied, setCopied] = useState(false);
  const { saving, error, setError, run } = useSaving();

  const writeBranchId = activeBranchId ?? branches[0]?.id ?? "";
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

  const assignableRoles = team.canAssignOwner ? ROLES : ROLES.filter((r) => r !== "OWNER");

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
                </div>
                <div className={s.rowMeta}>
                  <Chip>{roleLabel(m.role)}</Chip>
                  {permsSummary(m)}
                  {m.barberName ? (
                    <Chip tone="muted">{t("team.linkedBarberChip", { name: m.barberName })}</Chip>
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
                <div className={s.rowActions}>
                  <Btn size="sm" onClick={() => setPermsFor(m)}>
                    <KeyRound size={13} />
                    {t("team.permissionsBtn")}
                  </Btn>
                  {team.multiBranch && team.canManageBranches ? (
                    <Btn size="sm" onClick={() => setBranchesFor(m)}>
                      <Building2 size={13} />
                      {t("team.branchesBtn")}
                    </Btn>
                  ) : null}
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
                      })
                    }
                  >
                    <Pencil size={13} />
                    {t("common.edit")}
                  </Btn>
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
            <Field label={t("team.linkedBarber")} hint={t("team.linkedBarberHint")}>
              {(id) => (
                <Select
                  id={id}
                  value={invite.barberId}
                  onChange={(e) => setInvite({ ...invite, barberId: e.target.value })}
                >
                  <option value="">{t("team.linkedBarberNone")}</option>
                  {barbers
                    .filter((b) => b.barbershopId === invite.barbershopId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
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
                      <option key={b.id} value={b.id}>
                        {b.label}
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
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={t("team.linkedBarber")} hint={t("team.linkedBarberHint")}>
              {(id) => (
                <Select
                  id={id}
                  value={edit.barberId}
                  onChange={(e) => setEdit({ ...edit, barberId: e.target.value })}
                >
                  <option value="">{t("team.linkedBarberNone")}</option>
                  {barbers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
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
