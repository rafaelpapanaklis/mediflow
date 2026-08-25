"use client";

// ═══════════════════════════════════════════════════════════════════════
// /admin/barberias/[id] — ficha de una barbería.
//
// Sus datos · su equipo · su plan y estado de pago · su consumo de mensajes
// de WhatsApp · actividad del mes (citas y tickets) · bitácora de acciones
// manuales. Acciones: suspender / reactivar y cambiar de plan a mano, las
// dos con nota obligatoria (el modal vive fuera del contenedor, ver
// barberias.css).
//
// Los datos llegan renderizados desde el server (page.tsx). Tras una acción
// se hace router.refresh() en vez de re-armar el estado a mano: la fuente de
// verdad sigue siendo el server.
// ═══════════════════════════════════════════════════════════════════════

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CreditCard,
  History,
  LifeBuoy,
  MessageSquare,
  ScrollText,
  Scissors,
  Users,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { BARBER_ROLE_LABELS, type BarberRole } from "@/lib/barber/types";
import { isBarberUnlimited } from "@/lib/barber/plan-shared";
import type { AdminBarbershopDetail } from "@/lib/barber/admin";
import {
  MANUAL_ACTION_LABELS,
  PLAN_TONES,
  TICKET_PRIORITY_FACE,
  TICKET_STATUS_FACE,
  formatInt,
  formatMoney,
  formatQuota,
  fullDate,
  relativeDate,
  shortDate,
  subscriptionFace,
} from "@/components/admin/barberias/shared";
import {
  ManualActionModal,
  type ManualActionKind,
} from "@/components/admin/barberias/manual-action-modal";
import "@/components/admin/barberias/barberias.css";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="dcba-label">{label}</div>
      <div className="dcba-value">{children}</div>
    </div>
  );
}

export function AdminBarbershopDetailClient({ detail }: { detail: AdminBarbershopDetail }) {
  const router = useRouter();
  const [action, setAction] = useState<ManualActionKind | null>(null);

  const { shop, plan, plans, team, barbers, branches, whatsapp, activity, manualActions } = detail;
  const face = subscriptionFace(shop.subscriptionStatus);
  const quotaUnlimited = isBarberUnlimited(whatsapp.quota);
  const quotaPct = whatsapp.usedPct;
  const quotaColor =
    quotaPct === null || quotaPct < 70
      ? "var(--success)"
      : quotaPct < 90
        ? "var(--warning)"
        : "var(--danger)";

  return (
    <>
      <div className="dcba">
        <Link href="/admin/barberias" className="dcba-backlink">
          <ArrowLeft size={14} />
          Barberías
        </Link>

        <div className="dcba-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="dcba-title">{shop.name}</h1>
            <p className="dcba-sub">
              <span className="mono">{shop.slug}</span>
              {shop.city ? ` · ${shop.city}` : ""}
              {shop.state ? `, ${shop.state}` : ""}
              {shop.isBranch
                ? ` · sucursal${shop.parentName ? ` de ${shop.parentName}` : ""}`
                : branches.length > 0
                  ? ` · matriz de ${formatInt(branches.length)} ${branches.length === 1 ? "sucursal" : "sucursales"}`
                  : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {!shop.isBranch && (
              <>
                <ButtonNew size="sm" variant="secondary" onClick={() => setAction("plan")}>
                  Cambiar plan
                </ButtonNew>
                {shop.subscriptionActive ? (
                  <ButtonNew size="sm" variant="danger" onClick={() => setAction("suspend")}>
                    Suspender
                  </ButtonNew>
                ) : (
                  <ButtonNew size="sm" variant="primary" onClick={() => setAction("reactivate")}>
                    Reactivar
                  </ButtonNew>
                )}
              </>
            )}
            <Link
              href={`/admin/barberias/soporte?barbershopId=${shop.id}`}
              style={{ textDecoration: "none" }}
            >
              <ButtonNew size="sm" variant="ghost" icon={<LifeBuoy size={14} />}>
                Sus tickets
              </ButtonNew>
            </Link>
          </div>
        </div>

        {shop.isBranch && (
          <div className="dcba-warn">
            <Building2 size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Esta sede es una <strong>sucursal</strong>: su plan y su suscripción los paga la
              matriz. Las acciones manuales se hacen en la ficha de la matriz.
            </span>
          </div>
        )}

        {/* ── KPIs de la cuenta ─────────────────────────────────────── */}
        <div className="dcba-kpis">
          <KpiCard
            label="Plan"
            value={plan.name}
            icon={CreditCard}
            hero
            hint={`${formatMoney(shop.planPriceMonthly)}/mes de lista`}
          />
          <KpiCard label="Barberos activos" value={formatInt(shop.barbers)} icon={Scissors} />
          <KpiCard label="Con acceso al panel" value={formatInt(team.length)} icon={Users} />
          <KpiCard
            label="Citas del mes"
            value={formatInt(activity.appointmentsThisMonth)}
            icon={CalendarDays}
            hint={`${formatInt(activity.doneThisMonth)} atendidas · ${formatInt(activity.cancelledThisMonth)} canceladas`}
          />
          <KpiCard
            label="Tickets del mes"
            value={formatInt(activity.ticketsThisMonth)}
            icon={MessageSquare}
            tone={activity.openTickets > 0 ? "warning" : undefined}
            hint={`${formatInt(activity.openTickets)} sin cerrar`}
          />
        </div>

        <div className="dcba-grid2 dcba-section">
          {/* ── Datos ──────────────────────────────────────────────── */}
          <CardNew>
            <div className="dcba-cardtitle">
              <Building2 size={14} />
              Datos de la barbería
            </div>
            <div className="dcba-fields">
              <Field label="Correo">{shop.email || "—"}</Field>
              <Field label="Teléfono">{shop.phone || "—"}</Field>
              <Field label="Dirección">{shop.address || "—"}</Field>
              <Field label="Zona horaria">{shop.timezone}</Field>
              <Field label="Alta">
                <span title={fullDate(shop.createdAt)}>{shortDate(shop.createdAt)}</span>
              </Field>
              <Field label="Última actividad">
                <span title={fullDate(activity.lastActivityAt)}>
                  {relativeDate(activity.lastActivityAt)}
                </span>
              </Field>
              <Field label="Tamaño declarado">{shop.teamSize || "—"}</Field>
              <Field label="Mini-web">
                <a
                  href={`/b/${shop.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--text-2)" }}
                >
                  /b/{shop.slug}
                </a>
              </Field>
            </div>
          </CardNew>

          {/* ── Plan y pago ────────────────────────────────────────── */}
          <CardNew>
            <div className="dcba-cardtitle">
              <CreditCard size={14} />
              Plan y estado de pago
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
              <BadgeNew tone={PLAN_TONES[shop.plan] ?? "neutral"}>{plan.name}</BadgeNew>
              <BadgeNew tone={face.tone} dot>
                {face.label}
              </BadgeNew>
            </div>
            <div className="dcba-fields">
              <Field label="Precio de lista">{formatMoney(shop.planPriceMonthly)}/mes</Field>
              <Field label="Estado en BD">
                <span className="mono">{shop.subscriptionStatus}</span>
              </Field>
              <Field label="Barberos del plan">
                {isBarberUnlimited(plan.maxBarbers) ? "Ilimitados" : formatInt(plan.maxBarbers)}
              </Field>
              <Field label="Sedes del plan">
                {isBarberUnlimited(plan.maxBranches) ? "Ilimitadas" : formatInt(plan.maxBranches)}
              </Field>
              <Field label="Cliente en Stripe">
                <span className="mono" style={{ fontSize: 11 }}>
                  {shop.stripeCustomerId || "—"}
                </span>
              </Field>
              <Field label="Suscripción en Stripe">
                <span className="mono" style={{ fontSize: 11 }}>
                  {shop.stripeSubscriptionId || "—"}
                </span>
              </Field>
            </div>
            <p className="dcba-note" style={{ marginTop: 12 }}>
              Los precios y los límites salen de <span className="mono">barber_plan_configs</span>;
              editarlos ahí cambia esta ficha sin volver a desplegar.
            </p>
          </CardNew>
        </div>

        {/* ── WhatsApp ─────────────────────────────────────────────── */}
        <div className="dcba-section">
          <CardNew>
            <div className="dcba-cardtitle">
              <MessageSquare size={14} />
              Consumo de mensajes de WhatsApp
            </div>
            <div className="dcba-grid3" style={{ gap: 14 }}>
              <div>
                <div className="dcba-label">Conexión</div>
                {whatsapp.connected ? (
                  <BadgeNew tone="success" dot>
                    {whatsapp.mode === "PLATFORM" ? "Número de DaleControl" : "WABA propia"}
                  </BadgeNew>
                ) : (
                  <BadgeNew tone="neutral">Sin conectar</BadgeNew>
                )}
                {whatsapp.mode === "OWN_WABA" && (
                  <div className="dcba-note" style={{ marginTop: 6 }}>
                    WABA <span className="mono">{whatsapp.wabaId || "—"}</span>
                    {whatsapp.verifiedAt ? ` · verificada ${shortDate(whatsapp.verifiedAt)}` : ""}
                  </div>
                )}
              </div>
              <div>
                <div className="dcba-label">Consumo del periodo</div>
                <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)" }}>
                  {formatInt(whatsapp.usedPeriod)}
                  <span style={{ fontSize: 12, color: "var(--text-3)", fontWeight: 400 }}>
                    {" "}
                    / {formatQuota(whatsapp.quota)}
                  </span>
                </div>
                {!quotaUnlimited && quotaPct !== null && (
                  <>
                    <div className="dcba-meter">
                      <div
                        className="dcba-meter__fill"
                        style={{ width: `${Math.min(quotaPct, 100)}%`, background: quotaColor }}
                      />
                    </div>
                    <div className="dcba-note">{quotaPct}% del cupo del plan</div>
                  </>
                )}
                <div className="dcba-note">
                  Periodo desde {shortDate(whatsapp.periodStart) || "—"}
                </div>
              </div>
              <div>
                <div className="dcba-label">Últimos 30 días</div>
                <div className="dcba-value">
                  {formatInt(whatsapp.sentLast30d)} enviados
                  {whatsapp.failedLast30d > 0 && (
                    <span style={{ color: "var(--danger)" }}>
                      {" "}
                      · {formatInt(whatsapp.failedLast30d)} fallidos
                    </span>
                  )}
                </div>
                <div className="dcba-note">
                  Cuenta la familia entera (matriz y sus sucursales activas).
                </div>
              </div>
            </div>
          </CardNew>
        </div>

        {/* ── Equipo ───────────────────────────────────────────────── */}
        <div className="dcba-section">
          <CardNew noPad>
            <div style={{ padding: "14px 16px 0" }}>
              <div className="dcba-cardtitle">
                <Users size={14} />
                Equipo con acceso al panel ({formatInt(team.length)})
              </div>
            </div>
            <div className="dcba-tablewrap">
              <table className="table-new">
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th className="dcba-col-wide">Último acceso</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div style={{ fontSize: 12.5, color: "var(--text-1)" }}>{m.name}</div>
                        {m.barberName && (
                          <div className="dcba-note">Atiende como {m.barberName}</div>
                        )}
                      </td>
                      <td>
                        <span style={{ fontSize: 12, color: "var(--text-2)" }}>{m.email}</span>
                      </td>
                      <td>
                        <BadgeNew tone={m.role === "OWNER" ? "brand" : "neutral"}>
                          {BARBER_ROLE_LABELS[m.role as BarberRole] ?? m.role}
                        </BadgeNew>
                      </td>
                      <td className="dcba-col-wide">
                        <span style={{ fontSize: 12, color: "var(--text-2)" }} title={fullDate(m.lastLogin)}>
                          {m.lastLogin ? relativeDate(m.lastLogin) : "Nunca"}
                        </span>
                      </td>
                      <td>
                        {m.isActive ? (
                          <BadgeNew tone="success" dot>
                            Activo
                          </BadgeNew>
                        ) : (
                          <BadgeNew tone="neutral">Desactivado</BadgeNew>
                        )}
                      </td>
                    </tr>
                  ))}
                  {team.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                        Nadie con acceso al panel todavía.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardNew>
        </div>

        <div className="dcba-grid2 dcba-section">
          {/* ── Barberos ───────────────────────────────────────────── */}
          <CardNew>
            <div className="dcba-cardtitle">
              <Scissors size={14} />
              Barberos ({formatInt(barbers.filter((b) => b.isActive).length)} activos)
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {barbers.map((b) => (
                <div
                  key={b.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}
                >
                  <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>
                    {b.name}
                    {b.nickname ? ` · ${b.nickname}` : ""}
                  </span>
                  {b.isActive ? (
                    <BadgeNew tone="success" dot>
                      Activo
                    </BadgeNew>
                  ) : (
                    <BadgeNew tone="neutral">Retirado</BadgeNew>
                  )}
                </div>
              ))}
              {barbers.length === 0 && <p className="dcba-note">Sin barberos dados de alta.</p>}
            </div>
          </CardNew>

          {/* ── Sucursales ─────────────────────────────────────────── */}
          <CardNew>
            <div className="dcba-cardtitle">
              <Building2 size={14} />
              Sucursales ({formatInt(branches.length)})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {branches.map((b) => (
                <div key={b.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <Link
                    href={`/admin/barberias/${b.id}`}
                    style={{ fontSize: 12.5, color: "var(--text-2)", textDecoration: "none" }}
                  >
                    {b.branchName || b.name}
                    {b.city ? ` · ${b.city}` : ""}
                  </Link>
                  {b.isActive ? (
                    <BadgeNew tone="success" dot>
                      Activa
                    </BadgeNew>
                  ) : (
                    <BadgeNew tone="neutral">Cerrada</BadgeNew>
                  )}
                </div>
              ))}
              {branches.length === 0 && (
                <p className="dcba-note">
                  {shop.isBranch ? "Esta sede es una sucursal." : "Sólo la matriz, sin sucursales."}
                </p>
              )}
            </div>
          </CardNew>
        </div>

        {/* ── Tickets recientes ────────────────────────────────────── */}
        <div className="dcba-section">
          <CardNew noPad>
            <div style={{ padding: "14px 16px 0" }}>
              <div className="dcba-cardtitle">
                <LifeBuoy size={14} />
                Tickets recientes
              </div>
            </div>
            <div className="dcba-tablewrap">
              <table className="table-new">
                <thead>
                  <tr>
                    <th>Asunto</th>
                    <th>Estado</th>
                    <th className="dcba-col-wide">Prioridad</th>
                    <th>Último mensaje</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.recentTickets.map((t) => (
                    <tr key={t.id} className="dcba-row" onClick={() => router.push(`/admin/barberias/soporte/${t.id}`)}>
                      <td>
                        <span className="dcba-ellipsis" style={{ fontSize: 12.5, color: "var(--text-2)", display: "block" }}>
                          {t.subject}
                        </span>
                      </td>
                      <td>
                        <BadgeNew tone={TICKET_STATUS_FACE[t.status].tone} dot>
                          {TICKET_STATUS_FACE[t.status].label}
                        </BadgeNew>
                      </td>
                      <td className="dcba-col-wide">
                        <BadgeNew tone={TICKET_PRIORITY_FACE[t.priority].tone}>
                          {TICKET_PRIORITY_FACE[t.priority].label}
                        </BadgeNew>
                      </td>
                      <td>
                        <span className="dcba-nowrap" style={{ fontSize: 12, color: "var(--text-2)" }} title={fullDate(t.lastMessageAt)}>
                          {shortDate(t.lastMessageAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {activity.recentTickets.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ padding: 28, textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                        Esta barbería no ha abierto ningún ticket.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardNew>
        </div>

        {/* ── Bitácora de acciones manuales ────────────────────────── */}
        <div className="dcba-section">
          <CardNew>
            <div className="dcba-cardtitle">
              <History size={14} />
              Acciones manuales de DaleControl
            </div>
            {manualActions === null ? (
              <div className="dcba-warn" style={{ marginBottom: 0 }}>
                <ScrollText size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  La bitácora no está disponible: falta aplicar{" "}
                  <span className="mono">sql/barber_admin.sql</span>. Las acciones se pueden hacer
                  igual y quedan en el log del servidor, pero no se ven aquí hasta que se aplique.
                </span>
              </div>
            ) : manualActions.length === 0 ? (
              <p className="dcba-note">Nadie ha movido nada a mano en esta barbería.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {manualActions.map((a) => (
                  <div key={a.id} style={{ borderLeft: "2px solid var(--border-soft)", paddingLeft: 12 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <BadgeNew tone={a.action === "SUSPEND" ? "danger" : a.action === "REACTIVATE" ? "success" : "info"}>
                        {MANUAL_ACTION_LABELS[a.action] ?? a.action}
                      </BadgeNew>
                      {a.beforeValue && a.afterValue && (
                        <span className="mono dcba-note">
                          {a.beforeValue} → {a.afterValue}
                        </span>
                      )}
                      <span className="dcba-note" style={{ marginLeft: "auto" }}>
                        {fullDate(a.createdAt)}
                      </span>
                    </div>
                    <div className="dcba-value" style={{ marginTop: 4 }}>
                      {a.note}
                    </div>
                    <div className="dcba-note">{a.actorEmail || "admin"}</div>
                  </div>
                ))}
              </div>
            )}
          </CardNew>
        </div>
      </div>

      {/* FUERA de .dcba: container-type atraparía el position:fixed. */}
      {action && (
        <ManualActionModal
          kind={action}
          barbershopId={shop.id}
          barbershopName={shop.name}
          currentPlan={shop.plan}
          plans={plans}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
