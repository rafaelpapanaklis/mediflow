"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  Mail,
  MessageSquare,
  Phone,
  Sparkles,
  StickyNote,
  User,
} from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { makeRealtyT } from "@/lib/realty/i18n";
import {
  nextStages,
  REALTY_LEAD_STAGE_UI,
  REALTY_LOST_REASONS,
  type RealtyLeadActivityKind,
  type RealtyLeadStage,
  type RealtyLostReason,
  type RealtyOperation,
  type RealtyPropertyKind,
} from "@/lib/realty/types";
import type { RealtyLeadDetailDTO, RealtyLeadsCatalogs } from "@/lib/realty/leads";
import type { RealtyPropertyMatchDTO } from "@/lib/realty/matching";
import {
  budgetRange,
  contactHeat,
  dateTime,
  heatLabel,
  LEADS_CSS,
  money,
  prettyPhone,
  sourceLabel,
  type RealtyTone,
} from "./lead-ui";
import { Chip, Dialog, Field, HeatBadge, useNow } from "./lead-bits";
import { defaultDue } from "./tasks-today";

// `size?: number | string` (no solo number): así lo tipa lucide-react y así
// lo declara realty-placeholder.tsx. Con `number` a secas no asigna.
const ACTIVITY_ICONS: Record<RealtyLeadActivityKind, React.ComponentType<{ size?: number | string }>> = {
  NOTA: StickyNote,
  LLAMADA: Phone,
  WHATSAPP: MessageSquare,
  CORREO: Mail,
  VISITA: Building2,
  CAMBIO_ETAPA: CheckCircle2,
  ASIGNACION: User,
};

const CONTACT_KINDS: RealtyLeadActivityKind[] = ["LLAMADA", "WHATSAPP", "CORREO", "NOTA"];
const ALL_KINDS: RealtyPropertyKind[] = [
  "CASA",
  "DEPARTAMENTO",
  "TERRENO",
  "BODEGA",
  "LOCAL",
  "EDIFICIO",
  "OFICINA",
  "RANCHO",
];

/**
 * FICHA DEL PROSPECTO. Todo lo que hay que saber antes de marcarle, y la
 * BITÁCORA COMPLETA: cada llamada, mensaje, visita y nota con quién y
 * cuándo. Sin eso, un prospecto que cambia de asesor empieza de cero y la
 * persona del otro lado tiene que contar su historia otra vez.
 */
export function LeadDetail({
  dict,
  locale,
  initial,
  catalogs,
  canEdit,
  canAssign,
  timeZone,
  meId,
}: {
  dict: Dictionary;
  locale: string;
  initial: RealtyLeadDetailDTO;
  catalogs: RealtyLeadsCatalogs;
  canEdit: boolean;
  canAssign: boolean;
  timeZone: string;
  meId: string;
}) {
  const t = useMemo(() => makeRealtyT(dict), [dict]);
  const now = useNow();

  const [lead, setLead] = useState<RealtyLeadDetailDTO>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activityKind, setActivityKind] = useState<RealtyLeadActivityKind>("LLAMADA");
  const [activityNote, setActivityNote] = useState("");

  const [showVisit, setShowVisit] = useState(false);
  const [showTask, setShowTask] = useState(false);
  const [showWants, setShowWants] = useState(false);
  const [pendingLost, setPendingLost] = useState(false);
  const [lostReason, setLostReason] = useState<RealtyLostReason | "">("");

  const [matches, setMatches] = useState<RealtyPropertyMatchDTO[] | null>(null);
  const [tolerance, setTolerance] = useState(10);

  const heat = contactHeat(lead, now);
  const stageUi = REALTY_LEAD_STAGE_UI[lead.stage];

  const loadMatches = useCallback(async () => {
    try {
      const res = await fetch(`/api/realty/leads/${lead.id}/matches`, { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { matches: RealtyPropertyMatchDTO[]; tolerancePct: number };
      setMatches(json.matches);
      setTolerance(json.tolerancePct);
    } catch {
      setMatches([]);
    }
  }, [lead.id]);

  useEffect(() => {
    void loadMatches();
  }, [loadMatches]);

  async function send(url: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { lead?: RealtyLeadDetailDTO; error?: string };
      if (!res.ok) {
        setError(json.error ?? t("error"));
        return false;
      }
      if (json.lead) setLead(json.lead);
      return true;
    } catch {
      setError(t("error"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function moveStage(to: RealtyLeadStage, reason?: RealtyLostReason) {
    const ok = await send(`/api/realty/leads/${lead.id}`, "PATCH", {
      stage: to,
      lostReason: reason ?? null,
    });
    if (ok) void loadMatches();
  }

  async function logActivity() {
    if (!activityNote.trim() && activityKind === "NOTA") return;
    const ok = await send(`/api/realty/leads/${lead.id}/activities`, "POST", {
      kind: activityKind,
      note: activityNote.trim() || null,
    });
    if (ok) setActivityNote("");
  }

  const available = useMemo(() => nextStages(lead.stage), [lead.stage]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: LEADS_CSS }} />

      <div className="realty-page">
        <div>
          <Link
            href="/inmobiliaria/prospectos"
            className="lead-btn lead-btn--sm lead-btn--ghost"
            style={{ paddingLeft: 0 }}
          >
            <ArrowLeft size={14} aria-hidden />
            {t("actions.back")}
          </Link>
        </div>

        <header style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-1)" }}>
              {lead.contactName}
            </h1>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, alignItems: "center" }}>
              <Chip tone={stageUi.tone as RealtyTone}>{t(`stages.${lead.stage}`)}</Chip>
              <HeatBadge
                heat={heat.heat}
                label={heatLabel(heat, t)}
                never={heat.neverContacted && heat.heat !== "NEUTRO"}
                neverLabel={t("heat.never")}
              />
              {sourceLabel(lead.source, lead.portal) ? (
                <Chip tone="neutral">{sourceLabel(lead.source, lead.portal)}</Chip>
              ) : null}
              {lead.lostReason ? (
                <Chip tone="danger">{t(`lostReasons.${lead.lostReason}`)}</Chip>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {lead.contactPhone ? (
              <a className="lead-btn" href={`tel:+52${lead.contactPhone}`}>
                <Phone size={14} aria-hidden />
                {t("detail.call")}
              </a>
            ) : null}
            {canEdit ? (
              <>
                <button type="button" className="lead-btn" onClick={() => setShowVisit(true)} disabled={busy}>
                  <CalendarPlus size={14} aria-hidden />
                  {t("actions.scheduleVisit")}
                </button>
                <button type="button" className="lead-btn" onClick={() => setShowTask(true)} disabled={busy}>
                  <ClipboardList size={14} aria-hidden />
                  {t("actions.newTask")}
                </button>
              </>
            ) : null}
          </div>
        </header>

        {error ? (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: 12.5,
              color: "var(--danger)",
              background: "rgba(198, 40, 40, 0.10)",
              border: "1px solid rgba(198, 40, 40, 0.30)",
              borderRadius: 10,
              padding: "8px 11px",
            }}
          >
            {error}
          </p>
        ) : null}

        {/* ── Mover de etapa. Solo salen las etapas que el embudo PERMITE
            (contrato: nextStages). Un botón que lleva a una transición
            inválida es una promesa que el servidor va a romper. ── */}
        {canEdit && available.length > 0 ? (
          <section className="lead-panel">
            <p className="lead-panel__title">{t("detail.stageActions")}</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 8 }}>
              {available.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={s === "PERDIDO" ? "lead-btn lead-btn--danger" : "lead-btn"}
                  disabled={busy}
                  onClick={() => {
                    if (s === "PERDIDO") {
                      setLostReason("");
                      setPendingLost(true);
                      return;
                    }
                    void moveStage(s);
                  }}
                >
                  {t(`stages.${s}`)}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className="lead-detail">
          {/* ── Columna izquierda ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            <section className="lead-panel">
              <p className="lead-panel__title">{t("detail.contact")}</p>
              <dl style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "7px 14px", margin: "9px 0 0", fontSize: 13 }}>
                <Row label={t("new.phone")} value={prettyPhone(lead.contactPhone) ?? t("card.noPhone")} />
                <Row label={t("new.email")} value={lead.contactEmail ?? "—"} />
                <Row label={t("detail.budget")} value={budgetRange(lead.budgetMin, lead.budgetMax, t("card.noBudget"))} />
                <Row label={t("detail.credit")} value={t(`credit.${lead.creditKind}`)} />
                <Row label={t("detail.property")} value={lead.propertyTitle ?? t("card.noProperty")} />
                <Row label={t("detail.agent")} value={lead.assignedUserName ?? t("card.noAgent")} />
                <Row label={t("detail.entered")} value={dateTime(lead.createdAt, locale)} />
                <Row
                  label={t("detail.firstResponse")}
                  value={lead.firstResponseAt ? dateTime(lead.firstResponseAt, locale) : t("detail.firstResponseNever")}
                />
              </dl>

              {canAssign ? (
                <div style={{ marginTop: 12 }}>
                  <Field label={t("detail.agent")} htmlFor="ld-agent">
                    <select
                      id="ld-agent"
                      className="lead-select"
                      value={lead.assignedUserId ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        void send(`/api/realty/leads/${lead.id}`, "PATCH", {
                          assignedUserId: e.target.value || null,
                        })
                      }
                    >
                      <option value="">{t("card.noAgent")}</option>
                      {catalogs.agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              ) : null}
            </section>

            {/* ── Qué busca ── */}
            <section className="lead-panel">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <p className="lead-panel__title">{t("detail.wants")}</p>
                {canEdit ? (
                  <button type="button" className="lead-btn lead-btn--sm" onClick={() => setShowWants(true)}>
                    {t("detail.editWants")}
                  </button>
                ) : null}
              </div>
              {lead.searchProfile ? (
                <dl style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "7px 14px", margin: "9px 0 0", fontSize: 13 }}>
                  <Row label={t("new.operation")} value={t(`operation.${lead.searchProfile.operation}`)} />
                  <Row
                    label={t("new.kinds")}
                    value={
                      lead.searchProfile.kinds.length > 0
                        ? lead.searchProfile.kinds.map((k) => t(`kinds.${k}`)).join(", ")
                        : "—"
                    }
                  />
                  <Row label={t("new.zones")} value={lead.searchProfile.zones.join(", ") || "—"} />
                  <Row
                    label={t("new.budget")}
                    value={budgetRange(lead.searchProfile.budgetMin, lead.searchProfile.budgetMax, "—")}
                  />
                  <Row label={t("new.bedrooms")} value={lead.searchProfile.bedroomsMin?.toString() ?? "—"} />
                  <Row
                    label={t("new.notify")}
                    value={lead.searchProfile.notifyByWhatsapp ? "Sí" : "No"}
                  />
                </dl>
              ) : (
                <p style={{ margin: "9px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>—</p>
              )}
            </section>

            {/* ── ⭐ Match automático ── */}
            <section className="lead-panel">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <p className="lead-panel__title" style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Sparkles size={15} aria-hidden style={{ color: "var(--brand)" }} />
                  {t("detail.matches")}
                </p>
                <span style={{ fontSize: 11, color: "var(--text-4)" }}>
                  {t("match.tolerance", { pct: tolerance })}
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "var(--text-3)" }}>{t("detail.matchesHelp")}</p>

              {matches === null ? (
                <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>{t("loading")}</p>
              ) : matches.length === 0 ? (
                <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>{t("detail.matchesEmpty")}</p>
              ) : (
                <ul style={{ listStyle: "none", margin: "11px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {matches.map((m) => (
                    <li
                      key={m.property.id}
                      style={{
                        border: "1px solid var(--border-soft)",
                        borderRadius: 11,
                        padding: "9px 11px",
                        background: "var(--bg-elev-2)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 9 }}>
                        <div style={{ minWidth: 0 }}>
                          <div className="lead-truncate" style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                            {m.property.title}
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
                            {t(`kinds.${m.property.kind}`)}
                            {m.property.colonia ? ` · ${m.property.colonia}` : ""}
                            {" · "}
                            {money(
                              m.property.operation === "RENTA" ? m.property.rentPrice ?? m.property.price : m.property.price,
                              m.property.currency,
                            )}
                          </div>
                        </div>
                        <Chip tone={m.score >= 90 ? "success" : m.score >= 75 ? "brand" : "warning"}>
                          {t("match.score", { score: m.score })}
                        </Chip>
                      </div>
                      {/* El PORQUÉ del puntaje. Un número sin explicación no
                          se usa: el asesor tiene que poder decirle al
                          prospecto por qué le está enseñando esta casa. */}
                      <ul style={{ listStyle: "none", display: "flex", flexWrap: "wrap", gap: 5, margin: "8px 0 0", padding: 0 }}>
                        {m.reasons.map((r) => (
                          <li key={r.key}>
                            <Chip tone={r.ok ? "success" : "danger"} title={r.detail}>
                              {t(`match.factors.${r.key}`)}: {r.detail}
                            </Chip>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* ── Columna derecha: bitácora ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
            {canEdit ? (
              <section className="lead-panel">
                <p className="lead-panel__title">{t("activity.title")}</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "9px 0" }}>
                  {CONTACT_KINDS.map((k) => {
                    const on = activityKind === k;
                    const Icon = ACTIVITY_ICONS[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        className="lead-btn lead-btn--sm"
                        aria-pressed={on}
                        onClick={() => setActivityKind(k)}
                        style={
                          on
                            ? { background: "var(--brand-soft)", borderColor: "var(--border-brand)", color: "var(--pine-700)" }
                            : undefined
                        }
                      >
                        <Icon size={13} />
                        {t(`activity.kinds.${k}`)}
                      </button>
                    );
                  })}
                </div>
                <textarea
                  className="lead-textarea"
                  value={activityNote}
                  onChange={(e) => setActivityNote(e.target.value)}
                  placeholder={t("activity.notePlaceholder")}
                  aria-label={t("activity.note")}
                />
                {/* Aviso honesto: una NOTA no apaga el semáforo ni saca al
                    prospecto de la cola de reasignación. */}
                {activityKind === "NOTA" ? (
                  <p style={{ margin: "6px 0 0", fontSize: 11.5, color: "var(--text-3)" }}>{t("activity.noteOnly")}</p>
                ) : null}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 9 }}>
                  <button
                    type="button"
                    className="lead-btn realty-btn-primary"
                    onClick={() => void logActivity()}
                    disabled={busy}
                  >
                    {activityKind === "NOTA" ? t("activity.add") : t("actions.markContacted")}
                  </button>
                </div>
              </section>
            ) : null}

            <section className="lead-panel">
              <p className="lead-panel__title">{t("detail.timeline")}</p>
              {lead.activities.length === 0 ? (
                <p style={{ margin: "9px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>{t("detail.timelineEmpty")}</p>
              ) : (
                <div className="lead-timeline" style={{ marginTop: 11 }}>
                  {lead.activities.map((a, i) => {
                    const Icon = ACTIVITY_ICONS[a.kind] ?? StickyNote;
                    const last = i === lead.activities.length - 1;
                    return (
                      <div key={a.id} className="lead-timeline__row">
                        <div className="lead-timeline__rail">
                          <span
                            aria-hidden
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 999,
                              background: "var(--brand-soft)",
                              color: "var(--pine-700)",
                              display: "grid",
                              placeItems: "center",
                              flexShrink: 0,
                            }}
                          >
                            <Icon size={12} />
                          </span>
                          {!last ? <span className="lead-timeline__line" /> : null}
                        </div>
                        <div className="lead-timeline__body">
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-1)" }}>
                            {t(`activity.kinds.${a.kind}`)}
                          </div>
                          {a.note ? (
                            <p style={{ margin: "2px 0 0", fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                              {a.note}
                            </p>
                          ) : null}
                          <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-4)" }}>
                            {dateTime(a.createdAt, locale)} ·{" "}
                            {t("detail.by", { name: a.userName ?? t("detail.system") })}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="lead-panel">
              <p className="lead-panel__title">{t("detail.tasks")}</p>
              {lead.tasks.length === 0 ? (
                <p style={{ margin: "9px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>{t("detail.tasksEmpty")}</p>
              ) : (
                <ul style={{ listStyle: "none", margin: "9px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {lead.tasks.map((task) => (
                    <li key={task.id} style={{ fontSize: 12.5, color: task.done ? "var(--text-4)" : "var(--text-2)" }}>
                      <span style={{ textDecoration: task.done ? "line-through" : "none" }}>{task.title}</span>
                      <span style={{ color: "var(--text-4)" }}> · {dateTime(task.dueAt, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="lead-panel">
              <p className="lead-panel__title">{t("detail.visits")}</p>
              {lead.visits.length === 0 ? (
                <p style={{ margin: "9px 0 0", fontSize: 12.5, color: "var(--text-3)" }}>{t("detail.visitsEmpty")}</p>
              ) : (
                <ul style={{ listStyle: "none", margin: "9px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  {lead.visits.map((v) => (
                    <li key={v.id} style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                      {v.propertyTitle ?? "—"}
                      <span style={{ color: "var(--text-4)" }}> · {dateTime(v.scheduledAt, locale)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>

      {/* ── Diálogos (Dialog los saca por portal a .realty-shell) ── */}
      {pendingLost ? (
        <Dialog
          title={t("lost.title")}
          closeLabel={t("actions.close")}
          onClose={() => setPendingLost(false)}
          footer={
            <>
              <button type="button" className="lead-btn" onClick={() => setPendingLost(false)}>
                {t("actions.cancel")}
              </button>
              <button
                type="button"
                className="lead-btn lead-btn--danger"
                disabled={!lostReason || busy}
                onClick={() => {
                  if (!lostReason) return;
                  setPendingLost(false);
                  void moveStage("PERDIDO", lostReason);
                }}
              >
                {t("lost.confirm")}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 }}>{t("lost.help")}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {REALTY_LOST_REASONS.map((r) => (
              <label
                key={r}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 11px",
                  border: `1px solid ${lostReason === r ? "var(--border-brand)" : "var(--border-soft)"}`,
                  background: lostReason === r ? "var(--brand-soft)" : "transparent",
                  borderRadius: 10,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <input type="radio" name="ld-lost" checked={lostReason === r} onChange={() => setLostReason(r)} />
                {t(`lostReasons.${r}`)}
              </label>
            ))}
          </div>
        </Dialog>
      ) : null}

      {showVisit ? (
        <VisitDialog
          t={t}
          leadId={lead.id}
          catalogs={catalogs}
          defaultPropertyId={lead.propertyId}
          timeZone={timeZone}
          onClose={() => setShowVisit(false)}
          onDone={(updated) => {
            setShowVisit(false);
            setLead(updated);
          }}
        />
      ) : null}

      {showTask ? (
        <TaskDialog
          t={t}
          leadId={lead.id}
          catalogs={catalogs}
          canAssign={canAssign}
          meId={meId}
          timeZone={timeZone}
          onClose={() => setShowTask(false)}
          onDone={(updated) => {
            setShowTask(false);
            setLead(updated);
          }}
        />
      ) : null}

      {showWants ? (
        <WantsDialog
          t={t}
          leadId={lead.id}
          initial={lead.searchProfile}
          onClose={() => setShowWants(false)}
          onDone={(updated) => {
            setShowWants(false);
            setLead(updated);
            void loadMatches();
          }}
        />
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ color: "var(--text-3)", fontSize: 12, whiteSpace: "nowrap" }}>{label}</dt>
      <dd style={{ margin: 0, color: "var(--text-1)", minWidth: 0, overflowWrap: "anywhere" }}>{value}</dd>
    </>
  );
}

// ── Diálogos de la ficha ────────────────────────────────────────────────

function VisitDialog({
  t,
  leadId,
  catalogs,
  defaultPropertyId,
  timeZone,
  onClose,
  onDone,
}: {
  t: ReturnType<typeof makeRealtyT>;
  leadId: string;
  catalogs: RealtyLeadsCatalogs;
  defaultPropertyId: string | null;
  timeZone: string;
  onClose: () => void;
  onDone: (lead: RealtyLeadDetailDTO) => void;
}) {
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? "");
  const [when, setWhen] = useState(() => defaultDue());
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!propertyId) {
      setError(t("visit.needProperty"));
      return;
    }
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) {
      setError(t("error"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/realty/leads/${leadId}/visits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, scheduledAt: date.toISOString(), userId: userId || null }),
      });
      const json = (await res.json().catch(() => ({}))) as { lead?: RealtyLeadDetailDTO; error?: string };
      if (!res.ok || !json.lead) {
        setError(json.error ?? t("error"));
        return;
      }
      onDone(json.lead);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("visit.title")}
      closeLabel={t("actions.close")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="lead-btn" onClick={onClose} disabled={busy}>
            {t("actions.cancel")}
          </button>
          <button type="button" className="lead-btn realty-btn-primary" onClick={submit} disabled={busy}>
            {t("visit.confirm")}
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
      <Field label={t("visit.property")} htmlFor="v-prop">
        <select id="v-prop" className="lead-select" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
          <option value="">—</option>
          {catalogs.properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("visit.when")} help={timeZone} htmlFor="v-when">
        <input id="v-when" className="lead-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </Field>
      <Field label={t("visit.who")} htmlFor="v-who">
        <select id="v-who" className="lead-select" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">{t("visit.whoDefault")}</option>
          {catalogs.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
    </Dialog>
  );
}

function TaskDialog({
  t,
  leadId,
  catalogs,
  canAssign,
  meId,
  timeZone,
  onClose,
  onDone,
}: {
  t: ReturnType<typeof makeRealtyT>;
  leadId: string;
  catalogs: RealtyLeadsCatalogs;
  canAssign: boolean;
  meId: string;
  timeZone: string;
  onClose: () => void;
  onDone: (lead: RealtyLeadDetailDTO) => void;
}) {
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState(() => defaultDue());
  const [userId, setUserId] = useState(meId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (title.trim().length < 2) {
      setError(t("task.what"));
      return;
    }
    const date = new Date(dueAt);
    if (Number.isNaN(date.getTime())) {
      setError(t("error"));
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/realty/leads/${leadId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueAt: date.toISOString(), userId }),
      });
      const json = (await res.json().catch(() => ({}))) as { lead?: RealtyLeadDetailDTO; error?: string };
      if (!res.ok || !json.lead) {
        setError(json.error ?? t("error"));
        return;
      }
      onDone(json.lead);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("task.title")}
      closeLabel={t("actions.close")}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="lead-btn" onClick={onClose} disabled={busy}>
            {t("actions.cancel")}
          </button>
          <button type="button" className="lead-btn realty-btn-primary" onClick={submit} disabled={busy}>
            {t("task.create")}
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
      <Field label={t("task.what")} htmlFor="td-title">
        <input
          id="td-title"
          className="lead-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("task.whatPlaceholder")}
          autoComplete="off"
        />
      </Field>
      <Field label={t("task.due")} help={timeZone} htmlFor="td-due">
        <input id="td-due" className="lead-input" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
      </Field>
      {canAssign ? (
        <Field label={t("task.owner")} htmlFor="td-owner">
          <select id="td-owner" className="lead-select" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {catalogs.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id === meId ? `${a.name} (${t("task.ownerMe")})` : a.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </Dialog>
  );
}

function WantsDialog({
  t,
  leadId,
  initial,
  onClose,
  onDone,
}: {
  t: ReturnType<typeof makeRealtyT>;
  leadId: string;
  initial: RealtyLeadDetailDTO["searchProfile"];
  onClose: () => void;
  onDone: (lead: RealtyLeadDetailDTO) => void;
}) {
  const [operation, setOperation] = useState<RealtyOperation>(initial?.operation ?? "VENTA");
  const [kinds, setKinds] = useState<RealtyPropertyKind[]>(initial?.kinds ?? []);
  const [zones, setZones] = useState((initial?.zones ?? []).join(", "));
  const [budgetMin, setBudgetMin] = useState(initial?.budgetMin?.toString() ?? "");
  const [budgetMax, setBudgetMax] = useState(initial?.budgetMax?.toString() ?? "");
  const [bedroomsMin, setBedroomsMin] = useState(initial?.bedroomsMin?.toString() ?? "");
  const [notify, setNotify] = useState(initial?.notifyByWhatsapp ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toNumber(v: string): number | null {
    const clean = v.replace(/[^0-9.]/g, "");
    if (!clean) return null;
    const n = Number(clean);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/realty/leads/${leadId}/search-profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation,
          kinds,
          zones: zones.split(",").map((z) => z.trim()).filter(Boolean),
          budgetMin: toNumber(budgetMin),
          budgetMax: toNumber(budgetMax),
          bedroomsMin: bedroomsMin ? Number(bedroomsMin) : null,
          notifyByWhatsapp: notify,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { lead?: RealtyLeadDetailDTO; error?: string };
      if (!res.ok || !json.lead) {
        setError(json.error ?? t("error"));
        return;
      }
      onDone(json.lead);
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={t("detail.wants")}
      closeLabel={t("actions.close")}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="lead-btn" onClick={onClose} disabled={busy}>
            {t("actions.cancel")}
          </button>
          <button type="button" className="lead-btn realty-btn-primary" onClick={submit} disabled={busy}>
            {t("detail.saveWants")}
          </button>
        </>
      }
    >
      {error ? (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
      <div className="lead-dialog__grid">
        <Field label={t("new.operation")} htmlFor="w-op">
          <select id="w-op" className="lead-select" value={operation} onChange={(e) => setOperation(e.target.value as RealtyOperation)}>
            <option value="VENTA">{t("operation.VENTA")}</option>
            <option value="RENTA">{t("operation.RENTA")}</option>
            <option value="AMBAS">{t("operation.AMBAS")}</option>
          </select>
        </Field>
        <Field label={t("new.bedrooms")} htmlFor="w-bed">
          <input
            id="w-bed"
            className="lead-input"
            value={bedroomsMin}
            onChange={(e) => setBedroomsMin(e.target.value.replace(/\D/g, "").slice(0, 2))}
            inputMode="numeric"
          />
        </Field>
        <Field label={t("filters.budgetMin")} htmlFor="w-bmin">
          <input id="w-bmin" className="lead-input" value={budgetMin} onChange={(e) => setBudgetMin(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label={t("filters.budgetMax")} htmlFor="w-bmax">
          <input id="w-bmax" className="lead-input" value={budgetMax} onChange={(e) => setBudgetMax(e.target.value)} inputMode="numeric" />
        </Field>
      </div>

      <div>
        <span className="lead-label">{t("new.kinds")}</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
          {ALL_KINDS.map((k) => {
            const on = kinds.includes(k);
            return (
              <button
                key={k}
                type="button"
                className="lead-btn lead-btn--sm"
                aria-pressed={on}
                onClick={() => setKinds((prev) => (on ? prev.filter((x) => x !== k) : [...prev, k]))}
                style={
                  on
                    ? { background: "var(--brand-soft)", borderColor: "var(--border-brand)", color: "var(--pine-700)" }
                    : undefined
                }
              >
                {t(`kinds.${k}`)}
              </button>
            );
          })}
        </div>
      </div>

      <Field label={t("new.zones")} help={t("new.zonesPlaceholder")} htmlFor="w-zones">
        <input id="w-zones" className="lead-input" value={zones} onChange={(e) => setZones(e.target.value)} autoComplete="off" />
      </Field>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, color: "var(--text-2)", cursor: "pointer" }}>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} style={{ marginTop: 2 }} />
        {t("new.notify")}
      </label>
    </Dialog>
  );
}
