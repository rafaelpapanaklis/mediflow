import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CheckCircle2,
  Contact,
  Crown,
  Globe,
  Inbox,
  Package,
  Receipt,
  Scissors,
  Timer,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import type { TFunction } from "@/i18n/t";
import type { InicioSummary } from "@/lib/barber/stats";
import { fmtInt, fmtLongDay, fmtMoney, fmtPctSigned, fmtTime, weekdayOfKey } from "./format";
import { RefreshButton } from "./refresh-button";
import { BranchSelect, BRANCH_ALL_VALUE, type BranchOption } from "./branch-select";

/**
 * /barber/inicio — resumen del día. Componente de SERVIDOR: pinta lo que ya
 * decidió getInicioSummary (permisos, plan y alcance por rol se resolvieron
 * allá). Las únicas islas de cliente son el botón de actualizar y el
 * selector de sede.
 */
export function InicioView({
  summary: s,
  t,
  locale,
  firstName,
  branches,
  slug,
}: {
  summary: InicioSummary;
  t: TFunction;
  locale: string;
  firstName: string;
  branches: BranchOption[];
  /** Slug de la barbería: arma la liga pública /b/<slug>/reservar del aviso de bloqueo. */
  slug: string;
}) {
  const k = (key: string, vars?: Record<string, string | number>) => t(`barber.inicio.${key}`, vars);
  const tz = s.timezone;
  const weekdayName = t(`barber.reportes.weekdaysLong.${weekdayOfKey(s.date)}`).toLowerCase();

  // ── KPIs ──
  const vsYesterday = s.compare.vsYesterdayPct;
  const revenueDelta =
    vsYesterday === null
      ? undefined
      : {
          value: fmtPctSigned(vsYesterday, locale),
          direction: vsYesterday >= 0 ? ("up" as const) : ("down" as const),
          sub: k("kpi.vsYesterday"),
        };
  const lastWeekText =
    s.compare.vsLastWeekPct === null
      ? null
      : `${fmtPctSigned(s.compare.vsLastWeekPct, locale)} ${k("kpi.vsLastWeek", { weekday: weekdayName })}`;
  const revenueHint = [
    k("kpi.revenueHint", { total: fmtMoney(s.today.total), tips: fmtMoney(s.today.tips) }),
    vsYesterday === null && s.today.revenue > 0 ? k("kpi.yesterdayZero") : null,
    lastWeekText,
  ]
    .filter(Boolean)
    .join(" · ");

  const v = s.visits;
  const c = s.cash;
  const q = s.queue;
  const a = s.alerts;

  // ── Avisos accionables (solo los que tienen algo y que el rol puede resolver) ──
  const alertItems: Array<{ key: string; title: string; hint: string; href: string; cta: string; icon: LucideIcon }> = [];
  if (a.barbersNoSchedule && a.barbersNoSchedule.count > 0) {
    const names = a.barbersNoSchedule.names.join(", ") + (a.barbersNoSchedule.count > a.barbersNoSchedule.names.length ? "…" : "");
    alertItems.push({
      key: "schedule",
      title: k("alerts.barbersNoSchedule", { count: a.barbersNoSchedule.count }),
      hint: [names, k("alerts.barbersNoScheduleHint")].filter(Boolean).join(" · "),
      href: "/barber/agenda/horarios",
      cta: k("alerts.barbersNoScheduleCta"),
      icon: CalendarClock,
    });
  }
  if (a.lowStock && a.lowStock.count > 0) {
    const names = a.lowStock.names.join(", ") + (a.lowStock.count > a.lowStock.names.length ? "…" : "");
    alertItems.push({
      key: "stock",
      title: k("alerts.lowStock", { count: a.lowStock.count }),
      hint: [names, k("alerts.lowStockHint")].filter(Boolean).join(" · "),
      href: "/barber/productos",
      cta: k("alerts.lowStockCta"),
      icon: Package,
    });
  }
  if (a.membershipsSoon !== null && a.membershipsSoon > 0) {
    alertItems.push({
      key: "memberships",
      title: k("alerts.membershipsSoon", { count: a.membershipsSoon }),
      hint: k("alerts.membershipsSoonHint"),
      href: "/barber/membresias",
      cta: k("alerts.membershipsSoonCta"),
      icon: Crown,
    });
  }
  if (a.tomorrowPending !== null && a.tomorrowPending > 0) {
    alertItems.push({
      key: "tomorrow",
      title: k("alerts.tomorrowPending", { count: a.tomorrowPending }),
      hint: k("alerts.tomorrowPendingHint"),
      href: "/barber/agenda",
      cta: k("alerts.tomorrowPendingCta"),
      icon: CalendarDays,
    });
  }
  if (a.publicRequests !== null && a.publicRequests > 0) {
    alertItems.push({
      key: "requests",
      title: k("alerts.publicRequests", { count: a.publicRequests }),
      hint: k("alerts.publicRequestsHint"),
      href: "/barber/solicitudes",
      cta: k("alerts.publicRequestsCta"),
      icon: Inbox,
    });
  }

  const setupSteps: Array<{ key: string; done: boolean; href: string; icon: LucideIcon }> = [
    { key: "barbers", done: s.setup.hasBarbers, href: "/barber/barberos", icon: Contact },
    { key: "schedules", done: s.setup.hasSchedules, href: "/barber/agenda/horarios", icon: CalendarClock },
    { key: "services", done: s.setup.hasServices, href: "/barber/servicios", icon: Scissors },
    { key: "appointments", done: s.setup.hasAppointments, href: "/barber/agenda", icon: CalendarDays },
    { key: "sales", done: s.setup.hasSales, href: "/barber/caja", icon: Wallet },
    { key: "web", done: s.setup.hasWeb, href: "/barber/mi-web", icon: Globe },
  ];

  const branchValue = s.scope.consolidated ? BRANCH_ALL_VALUE : s.scope.activeBranchId ?? "";

  return (
    <div className="bdash-page">
      <div className="bdash-head">
        <div>
          <h1 className="bdash-head__title">{k("greeting", { name: firstName })}</h1>
          <p className="bdash-head__sub">{k(s.scope.selfOnly ? "subtitleSelf" : "subtitle", { date: fmtLongDay(s.date, locale) })}</p>
        </div>
        <div className="bdash-head__actions">
          {s.scope.canConsolidate && branches.length > 1 && (
            <BranchSelect options={branches} value={branchValue} allLabel={k("consolidated")} ariaLabel={k("branchLabel")} />
          )}
          <RefreshButton label={k("refresh")} busyLabel={k("refreshing")} />
          {s.can.reports && (
            <Link href="/barber/reportes" className="btn-new btn-new--sm barber-btn-primary bdash-btn-icon">
              <BarChart3 size={14} aria-hidden /> {k("reports.cta")}
            </Link>
          )}
        </div>
      </div>

      {s.scope.selfOnly && <div className="bdash-note">{s.scope.barberLinked ? k("selfOnly") : k("noBarberLinked")}</div>}

      {/* Reserva en línea activa sin UN solo horario: la liga pública le dice a
          la gente que no hay lugar. Es un bloqueo, no un pendiente más: va
          arriba de todo, en rojo, para todos los roles (el CTA solo para quien
          puede cargar horarios). */}
      {s.setup.bookingBlocked && (
        <div className="bdash-blocker" role="alert">
          <div className="bdash-blocker__icon" aria-hidden>
            <CalendarOff size={22} />
          </div>
          <div className="bdash-blocker__body">
            <div className="bdash-blocker__title">{k("blocker.title")}</div>
            <p className="bdash-blocker__text">
              {k(s.setup.hasWeb ? "blocker.bodyPublished" : "blocker.body")}{" "}
              <code className="bdash-blocker__url">/b/{slug}/reservar</code>
            </p>
          </div>
          {s.can.schedule ? (
            <Link href="/barber/agenda/horarios" className="btn-new barber-btn-primary bdash-blocker__cta">
              <CalendarClock size={14} aria-hidden /> {k("blocker.cta")}
            </Link>
          ) : (
            <span className="bdash-blocker__hint">{k("blocker.askOwner")}</span>
          )}
        </div>
      )}

      {s.setup.isFresh ? (
        <CardNew title={k("setup.title")} sub={k("setup.body")}>
          <div className="bdash-setup">
            {setupSteps.map((st, i) => (
              <Link key={st.key} href={st.href} className={`bdash-step${st.done ? " bdash-step--done" : ""}`}>
                <div className="bdash-step__n" aria-hidden>
                  {st.done ? <CheckCircle2 size={16} /> : i + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="bdash-step__title">{k(`setup.${st.key}`)}</div>
                  <div className="bdash-step__hint">{k(`setup.${st.key}Hint`)}</div>
                  <div className="bdash-step__state">{st.done ? k("setup.done") : k("setup.pending")}</div>
                </div>
              </Link>
            ))}
          </div>
        </CardNew>
      ) : (
        <div className="bdash-kpis">
          <KpiCard
            label={k(s.scope.selfOnly ? "kpi.revenueSelf" : "kpi.revenue")}
            value={fmtMoney(s.today.revenue)}
            icon={Wallet}
            hero
            hint={revenueHint}
            delta={revenueDelta}
          />
          {v ? (
            <KpiCard
              label={k("kpi.visits")}
              value={fmtInt(v.total, locale)}
              icon={Users}
              hint={k("kpi.visitsHint", { done: v.done, pending: v.pending + v.inProgress })}
            />
          ) : (
            <KpiCard label={k("kpi.tips")} value={fmtMoney(s.today.tips)} icon={Scissors} hint={k("kpi.tipsHint")} />
          )}
          <KpiCard label={k("kpi.tickets")} value={fmtInt(s.today.tickets, locale)} icon={Receipt} hint={k("kpi.ticketsHint")} />
          <KpiCard
            label={k("kpi.avgTicket")}
            value={s.today.avgTicket === null ? "—" : fmtMoney(s.today.avgTicket)}
            icon={BarChart3}
            hint={k("kpi.avgTicketHint")}
          />
        </div>
      )}

      <div className="bdash-grid">
        <div className="bdash-stack">
          {v && !s.setup.isFresh && (
            <CardNew
              title={k("visits.title")}
              action={
                <Link href="/barber/agenda" className="bdash-link">
                  {k("visits.goAgenda")} <ArrowRight size={14} aria-hidden />
                </Link>
              }
            >
              {v.total === 0 ? (
                <div className="bdash-empty">{k("visits.empty")}</div>
              ) : (
                <>
                  <div className="bdash-chips">
                    <span className="bdash-chip bdash-chip--success"><span className="bdash-chip__dot" /> {k("visits.done")} <span className="bdash-chip__n">{v.done}</span></span>
                    <span className="bdash-chip bdash-chip--info"><span className="bdash-chip__dot" /> {k("visits.pending")} <span className="bdash-chip__n">{v.pending}</span></span>
                    {v.inProgress > 0 && (
                      <span className="bdash-chip bdash-chip--brand"><span className="bdash-chip__dot" /> {k("visits.inProgress")} <span className="bdash-chip__n">{v.inProgress}</span></span>
                    )}
                    {v.cancelled > 0 && (
                      <span className="bdash-chip"><span className="bdash-chip__dot" /> {k("visits.cancelled")} <span className="bdash-chip__n">{v.cancelled}</span></span>
                    )}
                    {v.noShow > 0 && (
                      <span className="bdash-chip bdash-chip--danger"><span className="bdash-chip__dot" /> {k("visits.noShow")} <span className="bdash-chip__n">{v.noShow}</span></span>
                    )}
                  </div>
                  {v.toCharge > 0 ? (
                    <div className="bdash-callout bdash-callout--danger" style={{ marginTop: 12 }}>
                      <Wallet size={16} aria-hidden />
                      <span className="bdash-callout__text">
                        {k("visits.toCharge", { count: v.toCharge })}. {k("visits.toChargeHint")}
                      </span>
                      {s.can.cash && (
                        <Link href="/barber/caja" className="bdash-callout__cta">
                          {k("visits.goCash")}
                        </Link>
                      )}
                    </div>
                  ) : v.done > 0 ? (
                    <div className="bdash-callout bdash-callout--success" style={{ marginTop: 12 }}>
                      <CheckCircle2 size={16} aria-hidden />
                      <span className="bdash-callout__text">{k("visits.allCharged")}</span>
                    </div>
                  ) : null}
                </>
              )}
            </CardNew>
          )}

          {v && !s.setup.isFresh && (
            <CardNew title={k("upcoming.title")}>
              {s.upcoming.length === 0 ? (
                <div className="bdash-empty">{k("upcoming.empty")}</div>
              ) : (
                <div className="bdash-list">
                  {s.upcoming.map((u) => (
                    <div className="bdash-row" key={u.id}>
                      <div className="bdash-row__time">{fmtTime(u.startAt, tz)}</div>
                      <div className="bdash-row__main">
                        <div className="bdash-row__name">{u.clientName ?? k("upcoming.noClient")}</div>
                        <div className="bdash-row__meta">
                          {u.barberName ?? k("upcoming.noBarber")} · {u.services || k("upcoming.noServices")}
                        </div>
                      </div>
                      {u.status === "IN_PROGRESS" && (
                        <BadgeNew tone="brand" dot>
                          {k("upcoming.inChair")}
                        </BadgeNew>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {a.tomorrowTotal !== null && (
                <div className="bdash-foot">
                  <span>{k("upcoming.tomorrow", { count: a.tomorrowTotal })}</span>
                  <Link href="/barber/agenda" className="bdash-link">
                    {k("visits.goAgenda")} <ArrowRight size={14} aria-hidden />
                  </Link>
                </div>
              )}
            </CardNew>
          )}

          {(s.setup.isFresh || !v) && (
            <CardNew title={k("alerts.title")}>
              <AlertsBody items={alertItems} clearLabel={k("alerts.clear")} />
            </CardNew>
          )}
        </div>

        <div className="bdash-stack">
          {c && (
            <CardNew
              title={k("cash.title")}
              action={
                <Link href="/barber/caja" className="bdash-link">
                  {k("cash.goCash")} <ArrowRight size={14} aria-hidden />
                </Link>
              }
            >
              {c.open ? (
                <>
                  <div className="bdash-status">
                    <span className="bdash-status__dot" /> {k("cash.open")}
                  </div>
                  <div className="bdash-big" style={{ marginTop: 10 }}>{fmtMoney(c.expectedCash)}</div>
                  <div className="bdash-big__label">
                    {k("cash.expected")} · {k("cash.expectedHint", { opening: fmtMoney(c.openingAmount) })}
                  </div>
                  <div className="bdash-chips" style={{ marginTop: 12 }}>
                    <span className="bdash-chip">{k("cash.tickets", { count: c.ticketCount })}</span>
                    <span className="bdash-chip">
                      {k("cash.sold")} <span className="bdash-chip__n">{fmtMoney(c.salesTotal)}</span>
                    </span>
                    <span className="bdash-chip">
                      {k("cash.tips")} <span className="bdash-chip__n">{fmtMoney(c.tipsTotal)}</span>
                    </span>
                  </div>
                  <div className="bdash-foot">
                    <span>{k("cash.since", { time: fmtTime(c.openedAt, tz), name: c.openedByName ?? "—" })}</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="bdash-status">
                    <span className="bdash-status__dot bdash-status__dot--off" /> {k("cash.closed")}
                  </div>
                  <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: "8px 0 0", lineHeight: 1.5 }}>{k("cash.closedBody")}</p>
                  {s.can.cashManage && (
                    <Link href="/barber/caja" className="btn-new btn-new--sm barber-btn-primary" style={{ marginTop: 12 }}>
                      {k("cash.openCta")}
                    </Link>
                  )}
                </>
              )}
            </CardNew>
          )}

          {q && (
            <CardNew
              title={k("queue.title")}
              action={
                <Link href="/barber/fila" className="bdash-link">
                  {k("queue.go")} <ArrowRight size={14} aria-hidden />
                </Link>
              }
            >
              {q.waiting === 0 && q.called === 0 ? (
                <div className="bdash-empty">{k("queue.empty")}</div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div className="bdash-alert__icon" style={{ background: "var(--brand-soft)", color: "var(--brand)", width: 40, height: 40 }}>
                    <Timer size={20} aria-hidden />
                  </div>
                  <div>
                    <div className="bdash-big">{q.waiting}</div>
                    <div className="bdash-big__label">
                      {k("queue.waiting", { count: q.waiting })}
                      {q.called > 0 ? ` · ${k("queue.called", { count: q.called })}` : ""}
                    </div>
                  </div>
                </div>
              )}
            </CardNew>
          )}

          {!s.setup.isFresh && v && (
            <CardNew title={k("alerts.title")}>
              <AlertsBody items={alertItems} clearLabel={k("alerts.clear")} />
            </CardNew>
          )}
        </div>
      </div>
    </div>
  );
}

function AlertsBody({
  items,
  clearLabel,
}: {
  items: Array<{ key: string; title: string; hint: string; href: string; cta: string; icon: LucideIcon }>;
  clearLabel: string;
}) {
  if (items.length === 0) {
    return (
      <div className="bdash-callout bdash-callout--success">
        <CheckCircle2 size={16} aria-hidden />
        <span className="bdash-callout__text">{clearLabel}</span>
      </div>
    );
  }
  return (
    <div className="bdash-list">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <div className="bdash-alert" key={it.key}>
            <div className="bdash-alert__icon">
              <Icon size={16} aria-hidden />
            </div>
            <div className="bdash-alert__body">
              <div className="bdash-alert__title">{it.title}</div>
              <div className="bdash-alert__hint">{it.hint}</div>
            </div>
            <Link href={it.href} className="bdash-alert__cta">
              {it.cta} <ArrowRight size={13} aria-hidden />
            </Link>
          </div>
        );
      })}
    </div>
  );
}
