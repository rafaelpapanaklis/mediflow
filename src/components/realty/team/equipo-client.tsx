"use client";

import { useMemo, useState } from "react";
import {
  Building2,
  Check,
  Copy,
  IdCard,
  KeyRound,
  Link2,
  Pencil,
  Store,
  TriangleAlert,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import type { RealtyMemberRow, RealtyTeamContext, InviteMemberResult, OffboardResult } from "@/lib/realty/team";
import type { RealtyOfficeRow, RealtyOfficesOverview } from "@/lib/realty/offices";
import { formatRealtyPrice, isRealtyUnlimited } from "@/lib/realty/plan-shared";
import { REALTY_ROLE_LABELS, type RealtyRole } from "@/lib/realty/types";
import { AgentProfileModal } from "./agent-profile-modal";
import { OffboardModal } from "./offboard-modal";
import { OfficesPanel } from "./offices-panel";
import { PermissionMatrix } from "./permission-matrix";
import {
  apiCall,
  Avatar,
  Banner,
  Btn,
  Chip,
  EmptyState,
  ErrorText,
  Field,
  fmtSince,
  Kpi,
  Modal,
  plural,
  Select,
  styles as s,
  SwitchRow,
  TextInput,
  useSaving,
} from "./ui";

// ═══════════════════════════════════════════════════════════════════════
// /inmobiliaria/equipo — personas, roles, permisos, ficha pública y sedes.
//
// Cada tarjeta dice en una línea si esa persona HEREDA los permisos de su rol
// o si tiene excepciones puestas a mano, y cuántas. La matriz completa (con
// la advertencia de que un override congela la herencia) vive en
// permission-matrix.tsx.
//
// El envoltorio de esta pantalla NO lleva container-type: los modales son
// hermanos del contenido para que su position:fixed sea real.
// ═══════════════════════════════════════════════════════════════════════

const ROLES: RealtyRole[] = ["OWNER", "MANAGER", "AGENT", "ASSISTANT"];

const ROLE_HINTS: Record<RealtyRole, string> = {
  OWNER: "Manda en todo, incluida la suscripción.",
  MANAGER: "Todo menos la suscripción y el pago a DaleControl.",
  AGENT: "Su cartera y su embudo: inmuebles, prospectos, visitas, llaves y sus comisiones.",
  ASSISTANT: "La mesa de control: agenda, contratos y cobros, sin tocar precios ni el reparto.",
};

type InviteDraft = {
  firstName: string;
  lastName: string;
  email: string;
  role: RealtyRole;
  officeIds: string[];
};

type EditDraft = {
  id: string;
  firstName: string;
  lastName: string;
  role: RealtyRole;
  active: boolean;
};

export function EquipoClient({
  initialTeam,
  offices,
  planName,
  canManageOffices,
}: {
  initialTeam: RealtyTeamContext;
  offices: RealtyOfficesOverview;
  planName: string;
  canManageOffices: boolean;
}) {
  const [tab, setTab] = useState<"personas" | "oficinas">("personas");
  const [team, setTeam] = useState(initialTeam);
  const [invite, setInvite] = useState<InviteDraft | null>(null);
  const [created, setCreated] = useState<InviteMemberResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [permsFor, setPermsFor] = useState<RealtyMemberRow | null>(null);
  const [profileFor, setProfileFor] = useState<RealtyMemberRow | null>(null);
  const [officesFor, setOfficesFor] = useState<RealtyMemberRow | null>(null);
  const [offboardFor, setOffboardFor] = useState<RealtyMemberRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { saving, error, setError, run } = useSaving();

  const seats = team.seats;
  const activeCount = team.members.filter((m) => m.active).length;
  const agents = team.members.filter((m) => m.active && m.role === "AGENT").length;
  const withOverride = team.members.filter((m) => m.active && m.permissions.hasOverride).length;

  // Solo un dueño nombra a otro dueño: el servidor lo rechaza igual
  // (assertCanAssignRole), pero ofrecer una opción que va a fallar es
  // enseñarle a la gente una puerta pintada en la pared.
  const assignableRoles = team.canAssignOwner ? ROLES : ROLES.filter((r) => r !== "OWNER");

  const officeLabel = useMemo(
    () => new Map(offices.offices.map((o) => [o.id, o.name])),
    [offices.offices],
  );

  function upsert(next: RealtyMemberRow) {
    setTeam((prev) => ({ ...prev, members: prev.members.map((m) => (m.id === next.id ? next : m)) }));
  }

  async function refresh() {
    setTeam(await apiCall<RealtyTeamContext>("/api/realty/team"));
  }

  async function submitInvite() {
    if (!invite) return;
    const ok = await run(async () => {
      const result = await apiCall<InviteMemberResult>("/api/realty/team", {
        method: "POST",
        json: invite,
      });
      setCreated(result);
      await refresh();
    });
    if (ok) setInvite(null);
  }

  async function submitEdit() {
    if (!edit) return;
    const ok = await run(async () => {
      const { member } = await apiCall<{ member: RealtyMemberRow }>(`/api/realty/team/${edit.id}`, {
        method: "PATCH",
        json: {
          firstName: edit.firstName,
          lastName: edit.lastName,
          role: edit.role,
          active: edit.active,
        },
      });
      upsert(member);
      await refresh();
    });
    if (ok) setEdit(null);
  }

  function onOffboarded(result: OffboardResult) {
    setOffboardFor(null);
    const partes: string[] = [];
    if (result.propertiesMoved > 0) partes.push(plural(result.propertiesMoved, "inmueble", "inmuebles"));
    if (result.leadsMoved > 0) partes.push(plural(result.leadsMoved, "prospecto", "prospectos"));
    if (result.visitsMoved > 0) partes.push(plural(result.visitsMoved, "visita", "visitas"));
    if (result.tasksMoved > 0) partes.push(plural(result.tasksMoved, "pendiente", "pendientes"));
    const destino = result.reassignedTo ? `a ${result.reassignedTo.fullName}` : "a la bandeja general";
    setNotice(
      partes.length > 0
        ? `Listo. Se movieron ${partes.join(", ")} ${destino}.${
            result.keysStillOut > 0
              ? ` Ojo: siguen fuera ${plural(result.keysStillOut, "juego de llaves", "juegos de llaves")}.`
              : ""
          }`
        : "Listo. Esa persona ya no entra al panel.",
    );
    void refresh();
  }

  return (
    <div className={s.root}>
      <header className={s.header}>
        <div className={s.headerText}>
          <h1 className={s.title}>Equipo</h1>
          <p className={s.subtitle}>
            Tus asesores, sus permisos y tus oficinas: quién ve qué y quién puede tocar el dinero.
          </p>
        </div>
        <div className={s.headerActions}>
          {tab === "personas" ? (
            <Btn
              variant="primary"
              onClick={() =>
                setInvite({
                  firstName: "",
                  lastName: "",
                  email: "",
                  role: "AGENT",
                  officeIds: [],
                })
              }
              disabled={!seats.canInvite}
            >
              <UserPlus size={15} /> Invitar a alguien
            </Btn>
          ) : null}
        </div>
      </header>

      <div className={s.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "personas"}
          className={[s.tab, tab === "personas" ? s.tabActive : ""].filter(Boolean).join(" ")}
          onClick={() => setTab("personas")}
        >
          <Users size={15} /> Personas
          <span className={s.tabBadge}>{activeCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "oficinas"}
          className={[s.tab, tab === "oficinas" ? s.tabActive : ""].filter(Boolean).join(" ")}
          onClick={() => setTab("oficinas")}
        >
          <Store size={15} /> Oficinas
          <span className={s.tabBadge}>{offices.offices.length}</span>
        </button>
      </div>

      {tab === "oficinas" ? (
        <OfficesPanel initial={offices} canManage={canManageOffices} />
      ) : (
        <div className={s.content}>
          {notice ? (
            <Banner icon={<Check size={16} />}>{notice}</Banner>
          ) : null}
          <ErrorText>{!invite && !edit && !officesFor ? error : null}</ErrorText>

          {/* Contraseña temporal: se ve UNA vez. */}
          {created ? (
            <div className={[s.card, s.cardPad].join(" ")} style={{ borderColor: "var(--border-brand)" }}>
              <div className={s.sectionTitle}>
                <KeyRound size={14} /> {created.member.fullName} ya puede entrar
              </div>
              {created.linkedExistingLogin ? (
                <p className={s.hint}>
                  Ese correo ya tenía cuenta de DaleControl, así que la ligamos a tu inmobiliaria:{" "}
                  <strong>entra con la contraseña que ya usa</strong>. No le mandamos nada nuevo.
                </p>
              ) : (
                <>
                  <p className={s.hint} style={{ marginBottom: 10 }}>
                    Esta contraseña temporal se enseña <strong>una sola vez</strong>. Pásasela por un
                    canal seguro; que la cambie al entrar.
                  </p>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <code
                      style={{
                        fontSize: 15,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        padding: "7px 13px",
                        borderRadius: 9,
                        background: "var(--brand-soft)",
                        border: "1px solid var(--border-brand)",
                        color: "var(--text-1)",
                      }}
                    >
                      {created.tempPassword}
                    </code>
                    <Btn
                      size="sm"
                      onClick={() => {
                        if (created.tempPassword) {
                          navigator.clipboard?.writeText(created.tempPassword).catch(() => undefined);
                          setCopied(true);
                        }
                      }}
                    >
                      {copied ? <Check size={13} /> : <Copy size={13} />}
                      {copied ? "Copiada" : "Copiar"}
                    </Btn>
                  </div>
                </>
              )}
              <div style={{ marginTop: 12 }}>
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCreated(null);
                    setCopied(false);
                  }}
                >
                  Listo
                </Btn>
              </div>
            </div>
          ) : null}

          {/* Cupo del plan, con el precio leído de la tabla. */}
          {!seats.canInvite ? (
            <Banner tone="warn" title="Ya usaste los lugares de tu plan" icon={<TriangleAlert size={16} />}>
              El plan {seats.planName} incluye {plural(seats.max, "persona", "personas")} y tienes{" "}
              {seats.used} activas.
              {seats.upgrade
                ? ` Con el plan ${seats.upgrade.name} (${formatRealtyPrice(seats.upgrade.priceMonthly)} al mes) caben ${
                    isRealtyUnlimited(seats.upgrade.maxUsers)
                      ? "todas las que necesites"
                      : seats.upgrade.maxUsers
                  }.`
                : " Da de baja a alguien para liberar un lugar."}
            </Banner>
          ) : null}

          <div className={s.kpis}>
            <Kpi
              label="En tu equipo"
              value={String(activeCount)}
              hero
              hint={seats.unlimited ? "Sin tope en tu plan" : `de ${seats.max} en el plan ${seats.planName}`}
            />
            <Kpi label="Asesores" value={String(agents)} />
            <Kpi label="Con permisos a la medida" value={String(withOverride)} hint="Dejaron de heredar del rol" />
            <Kpi label="Oficinas" value={String(offices.offices.length)} />
          </div>

          {team.members.length === 0 ? (
            <div className={s.card}>
              <EmptyState
                icon={<Users size={22} />}
                title="Todavía estás solo"
                body="Invita a tu primer asesor con su correo. Le llega su acceso y tú decides qué puede ver."
              />
            </div>
          ) : (
            <div className={s.grid}>
              {team.members.map((m) => (
                <article
                  key={m.id}
                  className={[
                    s.rowCard,
                    m.active ? "" : s.rowCardMuted,
                    m.isSelf ? s.rowCardSelf : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <Avatar name={m.fullName} photoUrl={m.profile?.photoUrl} />
                  <div className={s.rowMain}>
                    <div className={s.rowTitle}>
                      <span className={s.truncate}>{m.fullName}</span>
                      {m.isSelf ? <Chip tone="brand">Tú</Chip> : null}
                      {!m.active ? <Chip tone="muted">Dado de baja</Chip> : null}
                    </div>
                    <div className={s.rowMeta}>
                      <span className={s.truncate}>{m.email}</span>
                    </div>
                    <div className={s.rowMeta}>
                      <Chip>{REALTY_ROLE_LABELS[m.role]}</Chip>
                      {m.permissions.hasOverride ? (
                        <Chip tone="warn">
                          {[
                            m.permissions.added.length > 0
                              ? `${m.permissions.added.length} añadidos`
                              : null,
                            m.permissions.removed.length > 0
                              ? `${m.permissions.removed.length} quitados`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Permisos a la medida"}
                        </Chip>
                      ) : (
                        <Chip tone="muted">Hereda del rol</Chip>
                      )}
                      {m.profile?.visibleOnWeb ? <Chip tone="ok">En la web</Chip> : null}
                      {m.allOffices ? (
                        <Chip tone="muted">Todas las oficinas</Chip>
                      ) : m.officeIds.length > 0 ? (
                        <Chip tone="muted">
                          {m.officeIds.length === 1
                            ? (officeLabel.get(m.officeIds[0]) ?? "1 oficina")
                            : plural(m.officeIds.length, "oficina", "oficinas")}
                        </Chip>
                      ) : (
                        <Chip tone="danger">Sin oficina</Chip>
                      )}
                      <Chip tone="muted">Entró {fmtSince(m.lastLogin)}</Chip>
                    </div>
                    <div className={s.rowActions}>
                      <Btn
                        size="sm"
                        onClick={() =>
                          setEdit({
                            id: m.id,
                            firstName: m.firstName,
                            lastName: m.lastName,
                            role: m.role,
                            active: m.active,
                          })
                        }
                      >
                        <Pencil size={13} /> Editar
                      </Btn>
                      <Btn size="sm" onClick={() => setPermsFor(m)}>
                        <KeyRound size={13} /> Permisos
                      </Btn>
                      <Btn size="sm" onClick={() => setProfileFor(m)}>
                        <IdCard size={13} /> Ficha pública
                      </Btn>
                      {canManageOffices && !m.allOffices ? (
                        <Btn size="sm" onClick={() => setOfficesFor(m)}>
                          <Building2 size={13} /> Oficinas
                        </Btn>
                      ) : null}
                      {m.active && !m.isSelf ? (
                        <Btn size="sm" variant="danger" onClick={() => setOffboardFor(m)}>
                          <UserMinus size={13} /> Dar de baja
                        </Btn>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Modales (hermanos del contenido: su fixed es real) ── */}

      {invite ? (
        <Modal
          title="Invitar a alguien a tu equipo"
          subtitle="Le creamos su acceso con su correo. Si ya tiene cuenta de DaleControl, se la ligamos."
          onClose={() => {
            setInvite(null);
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setInvite(null)} disabled={saving}>
                Cancelar
              </Btn>
              <Btn variant="primary" onClick={submitInvite} disabled={saving}>
                {saving ? "Dando de alta…" : "Dar de alta"}
              </Btn>
            </>
          }
        >
          <ErrorText>{error}</ErrorText>
          <div className={s.formGrid}>
            <Field label="Nombre">
              {(id) => (
                <TextInput
                  id={id}
                  autoFocus
                  value={invite.firstName}
                  maxLength={60}
                  onChange={(e) => setInvite({ ...invite, firstName: e.target.value })}
                />
              )}
            </Field>
            <Field label="Apellido">
              {(id) => (
                <TextInput
                  id={id}
                  value={invite.lastName}
                  maxLength={60}
                  onChange={(e) => setInvite({ ...invite, lastName: e.target.value })}
                />
              )}
            </Field>
            <Field label="Correo" hint="Con este correo entra al panel." full>
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
            <Field label="Rol" hint={ROLE_HINTS[invite.role]} full>
              {(id) => (
                <Select
                  id={id}
                  value={invite.role}
                  onChange={(e) => setInvite({ ...invite, role: e.target.value as RealtyRole })}
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {REALTY_ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {offices.offices.length > 1 && invite.role !== "OWNER" && invite.role !== "MANAGER" ? (
            <>
              <div className={s.sectionTitle}>A qué oficinas entra</div>
              {offices.offices.map((o) => (
                <SwitchRow
                  key={o.id}
                  title={o.name}
                  hint={o.isMain ? "Principal" : undefined}
                  checked={invite.officeIds.includes(o.id)}
                  onChange={(on) =>
                    setInvite({
                      ...invite,
                      officeIds: on
                        ? invite.officeIds.concat(o.id)
                        : invite.officeIds.filter((id) => id !== o.id),
                    })
                  }
                  disabled={saving}
                />
              ))}
            </>
          ) : null}

          <p className={s.hint}>
            Nace heredando los permisos de su rol. Las excepciones se ponen después, desde
            «Permisos».
          </p>
        </Modal>
      ) : null}

      {edit ? (
        <Modal
          title={`Editar a ${edit.firstName} ${edit.lastName}`}
          onClose={() => {
            setEdit(null);
            setError(null);
          }}
          footer={
            <>
              <Btn variant="ghost" onClick={() => setEdit(null)} disabled={saving}>
                Cancelar
              </Btn>
              <Btn variant="primary" onClick={submitEdit} disabled={saving}>
                {saving ? "Guardando…" : "Guardar"}
              </Btn>
            </>
          }
        >
          <ErrorText>{error}</ErrorText>
          <div className={s.formGrid}>
            <Field label="Nombre">
              {(id) => (
                <TextInput
                  id={id}
                  value={edit.firstName}
                  maxLength={60}
                  onChange={(e) => setEdit({ ...edit, firstName: e.target.value })}
                />
              )}
            </Field>
            <Field label="Apellido">
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
              label="Rol"
              hint={`${ROLE_HINTS[edit.role]} Al cambiar de rol, sus permisos vuelven a los de fábrica del rol nuevo.`}
              full
            >
              {(id) => (
                <Select
                  id={id}
                  value={edit.role}
                  onChange={(e) => setEdit({ ...edit, role: e.target.value as RealtyRole })}
                >
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>
                      {REALTY_ROLE_LABELS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <p className={s.hint}>
            El correo no se edita: es su identidad de acceso. Si cambia de correo, se da de baja y
            se vuelve a dar de alta.
          </p>
          <SwitchRow
            title="Puede entrar al panel"
            hint={
              edit.id === team.members.find((m) => m.isSelf)?.id
                ? "No puedes desactivarte a ti mismo."
                : "Apagarlo lo saca del panel al instante, sin borrar nada. Para repartir su cartera usa «Dar de baja»."
            }
            checked={edit.active}
            onChange={(v) => setEdit({ ...edit, active: v })}
            disabled={saving || edit.id === team.members.find((m) => m.isSelf)?.id}
          />
        </Modal>
      ) : null}

      {officesFor ? (
        <OfficeAccessModal
          member={officesFor}
          offices={offices.offices}
          onClose={() => setOfficesFor(null)}
          onSaved={(next) => {
            upsert(next);
            setOfficesFor(null);
          }}
        />
      ) : null}

      {permsFor ? (
        <PermissionMatrix
          member={permsFor}
          selfEffective={team.selfEffective}
          onClose={() => setPermsFor(null)}
          onSaved={(next) => {
            upsert(next);
            setPermsFor(null);
          }}
        />
      ) : null}

      {profileFor ? (
        <AgentProfileModal
          member={profileFor}
          agentPagesEnabled={team.agentPagesEnabled}
          planName={planName}
          onClose={() => setProfileFor(null)}
          onSaved={(next) => {
            upsert(next);
            setProfileFor(null);
          }}
        />
      ) : null}

      {offboardFor ? (
        <OffboardModal
          member={offboardFor}
          onClose={() => setOffboardFor(null)}
          onDone={onOffboarded}
        />
      ) : null}
    </div>
  );
}

/** Reparte a qué oficinas entra una persona (RealtyUserOfficeAccess). */
function OfficeAccessModal({
  member,
  offices,
  onClose,
  onSaved,
}: {
  member: RealtyMemberRow;
  offices: RealtyOfficeRow[];
  onClose: () => void;
  onSaved: (next: RealtyMemberRow) => void;
}) {
  const { saving, error, run } = useSaving();
  const [selected, setSelected] = useState<string[]>(() => member.officeIds.slice());

  async function save() {
    const ok = await run(async () => {
      const { member: next } = await apiCall<{ member: RealtyMemberRow }>(
        `/api/realty/team/${member.id}/offices`,
        { method: "PUT", json: { officeIds: selected } },
      );
      onSaved(next);
    });
    if (ok) onClose();
  }

  return (
    <Modal
      title={`Oficinas de ${member.firstName}`}
      subtitle="Solo ve los inmuebles y la operación de las oficinas que marques."
      onClose={onClose}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </Btn>
          <Btn variant="primary" onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Btn>
        </>
      }
    >
      <ErrorText>{error}</ErrorText>
      {member.allOffices ? (
        <Banner icon={<Link2 size={16} />}>
          Como {REALTY_ROLE_LABELS[member.role]} ve TODAS las oficinas por su rol, sin necesitar
          estas llaves. Se guardan igual, por si algún día baja a asesor.
        </Banner>
      ) : null}
      {offices.length === 0 ? (
        <p className={s.hint}>Todavía no hay oficinas que repartir.</p>
      ) : (
        offices.map((o) => (
          <SwitchRow
            key={o.id}
            title={o.name}
            hint={[o.isMain ? "Principal" : null, o.isActive ? null : "Cerrada"]
              .filter(Boolean)
              .join(" · ")}
            checked={selected.includes(o.id)}
            onChange={(on) =>
              setSelected((prev) => (on ? prev.concat(o.id) : prev.filter((id) => id !== o.id)))
            }
            disabled={saving}
          />
        ))
      )}
      {selected.length === 0 && !member.allOffices ? (
        <Banner tone="warn" title="Sin oficinas no ve nada" icon={<TriangleAlert size={16} />}>
          Sin al menos una oficina marcada, esta persona entra al panel y las pantallas de
          inmuebles le salen vacías.
        </Banner>
      ) : null}
    </Modal>
  );
}
