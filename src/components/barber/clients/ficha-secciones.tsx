"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ChevronRight,
  Crown,
  Eye,
  EyeOff,
  Gift,
  ImageIcon,
  Receipt,
  Scissors,
  Star,
  Trash2,
} from "lucide-react";
import type { BarberVisitPhotoView } from "@/lib/barber/clients";
import type { BarberClientMembershipBadge, BarberVisitEntry } from "@/lib/barber/loyalty";
import type { ClientSaleRow } from "@/lib/barber/client-sales";
import type { FichaMembershipPeriod } from "@/lib/barber/ficha";
import type { StarsView } from "@/lib/barber/stars-core";
import type { BarberLoyaltyState } from "@/lib/barber/loyalty";
import { StarsHistoryList, starsT } from "@/components/barber/stars/stars-card";
import type { Dictionary } from "@/i18n/t";
import { VisitTimeline } from "./visit-timeline";
import { formatDate, formatDateTime, type BarberT } from "./ui";
import f from "./ficha.module.css";

/**
 * Piezas de la ficha «A» que no son de nadie más: estrellas en chico,
 * próxima cita, últimos pagos, fotos por visita, historial con filtros y
 * membresía. Solo pintan lo que ya llegó del servidor; las acciones llaman
 * a las mismas rutas de siempre (o se las pasan a la ficha).
 */

const L = (locale: string) => (locale === "en" ? "en-US" : "es-MX");

/** Día (aaaa-mm-dd) de un instante en la zona de la barbería. */
export function dayKey(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(0, 10);
  }
}

/** Un enlace a otra pestaña: funciona con clic (sin recargar) y con «abrir en otra pestaña». */
export function TabLink({
  href,
  onGo,
  className,
  children,
  ...rest
}: {
  href: string;
  onGo: () => void;
  className?: string;
  children: React.ReactNode;
  "data-accion"?: string;
}) {
  return (
    <a
      href={href}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onGo();
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

// ── Estrellas en chico (cabecera) ───────────────────────────────────────

const MINI_MAX = 12;

export function StarsMini({
  stars,
  loyalty,
  t,
}: {
  stars: StarsView | null;
  loyalty: BarberLoyaltyState;
  t: BarberT;
}) {
  if (stars && stars.enabled) {
    const filled = Math.min(stars.stars, stars.slots);
    if (stars.slots > MINI_MAX) {
      return (
        <span className={f.starsMini} data-estrellas-mini>
          <Star size={13} fill="currentColor" aria-hidden="true" />
          <span className={f.starsMiniText}>{t("ficha.starsCount", { count: stars.stars })}</span>
        </span>
      );
    }
    return (
      <span className={f.starsMini} data-estrellas-mini>
        <span role="img" aria-label={t("ficha.starsShort", { count: filled, total: stars.slots })} style={{ display: "inline-flex", gap: 1 }}>
          {Array.from({ length: stars.slots }, (_, i) => (
            <Star
              key={i}
              size={12}
              fill={i < filled ? "currentColor" : "none"}
              className={i < filled ? undefined : f.starOff}
              aria-hidden="true"
            />
          ))}
        </span>
        <span className={f.starsMiniText} aria-hidden="true">
          {t("ficha.starsShort", { count: filled, total: stars.slots })}
        </span>
      </span>
    );
  }
  if (!stars && loyalty.enabled) {
    return (
      <span className={f.starsMini}>
        <Gift size={13} aria-hidden="true" />
        <span className={f.starsMiniText}>
          {t("ficha.stampsShort", { count: loyalty.progress, total: loyalty.threshold })}
        </span>
      </span>
    );
  }
  return null;
}

// ── Próxima cita + última visita (Resumen) ──────────────────────────────

export function NextVisitCard({
  next,
  last,
  locale,
  timezone,
  t,
  canOpenAgenda,
  historyHref,
  onHistory,
  todayKey,
}: {
  next: BarberVisitEntry | null;
  last: BarberVisitEntry | null;
  locale: string;
  timezone: string;
  t: BarberT;
  canOpenAgenda: boolean;
  historyHref: string;
  onHistory: () => void;
  todayKey: string;
}) {
  const fmt = (o: Intl.DateTimeFormatOptions, iso: string) => {
    try {
      return new Intl.DateTimeFormat(L(locale), { ...o, timeZone: timezone }).format(new Date(iso));
    } catch {
      return iso.slice(0, 10);
    }
  };
  const agendaHref = (e: BarberVisitEntry) =>
    `/barber/agenda?fecha=${dayKey(e.at, timezone)}&visita=${encodeURIComponent(e.id)}`;

  return (
    <section className={`${f.card} ${f.cardPad}`} aria-label={t("ficha.nextTitle")} data-proxima-cita>
      {next ? (
        <div className={f.next}>
          <span className={f.dateBox} aria-hidden="true">
            <span className={f.dateBoxDay}>{fmt({ day: "numeric" }, next.at)}</span>
            <span className={f.dateBoxMonth}>{fmt({ month: "short" }, next.at)}</span>
          </span>
          <div className={f.nextBody}>
            <p className={f.hint}>{t("ficha.nextTitle")}</p>
            <p className={f.nextWhen}>
              {fmt({ weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }, next.at)}
            </p>
            <p className={f.hint}>
              {[next.services.join(" · "), next.barberName].filter(Boolean).join(" · ")}
              {next.status === "PENDING" ? (
                <>
                  {" "}
                  <span className={`${f.chip} ${f.chipWarn}`}>{t("history.status.PENDING")}</span>
                </>
              ) : null}
            </p>
          </div>
          {canOpenAgenda ? (
            <Link href={agendaHref(next)} className={`${f.btn} ${f.btnSm}`}>
              <CalendarDays size={14} aria-hidden="true" /> {t("ficha.openAgenda")}
            </Link>
          ) : null}
        </div>
      ) : (
        <p className={`${f.empty} ${f.inlineIcon}`}>
          <CalendarDays size={15} aria-hidden="true" />
          {t("ficha.nextNone")}
        </p>
      )}
      {last ? (
        <div className={f.lastRow}>
          <span>{t("ficha.lastVisitLabel")}</span>
          <span style={{ minWidth: 0 }}>
            <strong style={{ color: "var(--text-1)" }}>
              {dayKey(last.at, timezone) === todayKey ? t("ficha.today") : formatDateTime(last.at, locale, timezone)}
            </strong>
            {last.services.length ? ` · ${last.services.join(" · ")}` : ""}
            {last.barberName ? ` · ${last.barberName}` : ""}
          </span>
          <TabLink href={historyHref} onGo={onHistory} className={f.btnLink}>
            {t("ficha.historyLink")} <ChevronRight size={14} aria-hidden="true" />
          </TabLink>
        </div>
      ) : null}
    </section>
  );
}

// ── Últimos pagos (Resumen) ─────────────────────────────────────────────

export function LastPaymentsCard({
  rows,
  count,
  money,
  when,
  t,
  cobrosT,
  href,
  onGo,
  drafts,
  onChargeDrafts,
}: {
  rows: ClientSaleRow[];
  count: number;
  money: Intl.NumberFormat;
  when: (iso: string) => string;
  t: BarberT;
  cobrosT: BarberT;
  href: string;
  onGo: () => void;
  drafts: { count: number; total: number; summary: string } | null;
  onChargeDrafts: (() => void) | null;
}) {
  const list = rows.slice(0, 3);
  return (
    <section className={`${f.card} ${f.cardPad}`} aria-label={t("ficha.paymentsTitle")} data-ultimos-pagos>
      <div className={f.cardHead}>
        <h2 className={f.cardTitle}>
          <Receipt size={16} aria-hidden="true" /> {t("ficha.paymentsTitle")}
        </h2>
        <TabLink href={href} onGo={onGo} className={f.btnLink}>
          {count > 0 ? `${t("ficha.paymentsAll")} (${count})` : t("ficha.paymentsAll")}
          <ChevronRight size={14} aria-hidden="true" />
        </TabLink>
      </div>
      {list.length === 0 ? (
        <p className={f.empty}>{cobrosT("empty")}</p>
      ) : (
        <ul className={f.miniList}>
          {list.map((r) => {
            const cancelled = r.status === "cancelled";
            const items = cancelled
              ? r.cancelledSummary || cobrosT("cancelled")
              : r.lines
                  .filter((l) => l.kind === "service" || l.kind === "product")
                  .map((l) => l.description.replace(/ · Gratis \(lealtad[^)]*\)$/, ""))
                  .join(" · ") || (r.kind !== "sale" ? cobrosT(`kind.${r.kind}`) : "—");
            const total = cancelled && r.cancelledTotal !== null ? r.cancelledTotal : r.total;
            return (
              <li key={r.id} className={f.miniRow}>
                <span>{when(r.createdAt)}</span>
                <span className={`${f.miniItems} ${cancelled ? f.miniCancelled : ""}`}>{items}</span>
                <span className={`${f.miniTotal} ${cancelled ? f.miniCancelled : ""}`}>{money.format(total)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {drafts && drafts.count > 0 ? (
        <div className={f.banner} data-por-cobrar-resumen>
          <span>
            <strong>{t("ficha.draftsBanner", { count: drafts.count })}:</strong> {drafts.summary}{" "}
            {cobrosT("drafts.estimate", { amount: money.format(drafts.total) })}
          </span>
          {onChargeDrafts ? (
            <button type="button" className={`${f.btn} ${f.btnSm}`} onClick={onChargeDrafts}>
              {t("ficha.charge")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// ── Fotos ───────────────────────────────────────────────────────────────

type PhotoFilter = "all" | "BEFORE" | "AFTER" | "REFERENCE";

interface PhotoGroup {
  key: string;
  at: string;
  entry: BarberVisitEntry | null;
  photos: BarberVisitPhotoView[];
}

export function groupPhotos(photos: BarberVisitPhotoView[], entries: BarberVisitEntry[], tz: string): PhotoGroup[] {
  const byId = new Map(entries.filter((e) => e.kind === "appointment").map((e) => [e.id, e]));
  const groups = new Map<string, PhotoGroup>();
  for (const p of photos) {
    const entry = p.appointmentId ? byId.get(p.appointmentId) ?? null : null;
    const key = entry ? `v-${entry.id}` : `s-${dayKey(p.createdAt, tz)}`;
    const g = groups.get(key) ?? { key, at: entry?.at ?? p.createdAt, entry, photos: [] };
    g.photos.push(p);
    groups.set(key, g);
  }
  return Array.from(groups.values()).sort((a, b) => (a.at < b.at ? 1 : -1));
}

export function PhotoKindTag({ kind, t }: { kind: string; t: BarberT }) {
  return (
    <span className={f.thumbTag}>
      {kind === "BEFORE" ? t("photos.kindBefore") : kind === "AFTER" ? t("photos.kindAfter") : t("photos.kindReference")}
    </span>
  );
}

/** Antes y después de la última visita con fotos (Resumen y Corte). */
export function LastLookCard({
  photos,
  entries,
  locale,
  timezone,
  t,
  href,
  onGo,
  onOpen,
}: {
  photos: BarberVisitPhotoView[];
  entries: BarberVisitEntry[];
  locale: string;
  timezone: string;
  t: BarberT;
  href: string;
  onGo: () => void;
  onOpen: (p: BarberVisitPhotoView) => void;
}) {
  const latest = groupPhotos(photos, entries, timezone)[0] ?? null;
  // Antes y después juntos si los hay; si no, las dos más recientes.
  const pick = latest
    ? [
        latest.photos.find((p) => p.kind === "BEFORE"),
        latest.photos.find((p) => p.kind === "AFTER"),
      ].filter(Boolean) as BarberVisitPhotoView[]
    : [];
  const shown = pick.length > 0 ? pick : (latest?.photos ?? []).slice(0, 2);
  return (
    <section className={`${f.card} ${f.cardPad}`} aria-label={t("ficha.photosLast")} data-ultima-foto>
      <div className={f.cardHead}>
        <h2 className={f.cardTitle}>
          <ImageIcon size={16} aria-hidden="true" /> {t("ficha.photosLast")}
        </h2>
        {photos.length > 0 ? (
          <TabLink href={href} onGo={onGo} className={f.btnLink}>
            {t("ficha.photosAll", { count: photos.length })} <ChevronRight size={14} aria-hidden="true" />
          </TabLink>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className={f.empty}>{t("photos.empty")}</p>
      ) : (
        <>
          <div className={f.photoPair}>
            {shown.map((p) => (
              <button key={p.id} type="button" className={f.thumb} onClick={() => onOpen(p)} aria-label={t("photos.openFull")}>
                {p.signedUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={p.signedUrl} alt="" loading="lazy" decoding="async" />
                ) : null}
                <PhotoKindTag kind={p.kind} t={t} />
              </button>
            ))}
          </div>
          {latest ? (
            <p className={f.hint} style={{ marginTop: 10 }}>
              {[formatDate(latest.at, locale, timezone), latest.entry?.barberName, latest.entry?.notes ? `«${latest.entry.notes}»` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function PhotosSection({
  photos,
  entries,
  locale,
  timezone,
  t,
  canEdit,
  canPublish,
  canOpenAgenda,
  uploader,
  onOpen,
  onToggleVisible,
  onRemove,
}: {
  photos: BarberVisitPhotoView[];
  entries: BarberVisitEntry[];
  locale: string;
  timezone: string;
  t: BarberT;
  canEdit: boolean;
  canPublish: boolean;
  canOpenAgenda: boolean;
  uploader: React.ReactNode;
  onOpen: (p: BarberVisitPhotoView) => void;
  onToggleVisible: (p: BarberVisitPhotoView) => void;
  onRemove: (p: BarberVisitPhotoView) => void;
}) {
  const [filter, setFilter] = useState<PhotoFilter>("all");
  const counts = useMemo(() => {
    const c: Record<PhotoFilter, number> = { all: photos.length, BEFORE: 0, AFTER: 0, REFERENCE: 0 };
    for (const p of photos) c[p.kind as PhotoFilter] = (c[p.kind as PhotoFilter] ?? 0) + 1;
    return c;
  }, [photos]);
  const visible = filter === "all" ? photos : photos.filter((p) => p.kind === filter);
  const groups = groupPhotos(visible, entries, timezone);
  const latestId = photos[0]?.id ?? null;

  return (
    <>
      <div className={f.panelHead}>
        <div>
          <h2 className={f.panelTitle}>{t("ficha.tabs.fotos")}</h2>
          <p className={f.panelSub}>{t("ficha.photosSubtitle")}</p>
        </div>
      </div>

      {uploader ? <div className={`${f.card} ${f.cardPad} ${f.uploaderBox}`}>{uploader}</div> : null}

      {photos.length > 0 ? (
        <div className={f.pills} role="group" aria-label={t("photos.kind")}>
          {(["all", "BEFORE", "AFTER", "REFERENCE"] as const)
            .filter((k) => k === "all" || counts[k] > 0)
            .map((k) => (
              <button
                key={k}
                type="button"
                className={`${f.pill} ${filter === k ? f.pillOn : ""}`}
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
              >
                {t(`ficha.photosFilter.${k}`)} <span className={f.pillCount}>{counts[k]}</span>
              </button>
            ))}
        </div>
      ) : null}

      {photos.length === 0 ? (
        <div className={`${f.card} ${f.cardPad}`}>
          <p className={f.empty}>{t("photos.empty")}</p>
        </div>
      ) : (
        <ul className={`${f.card} ${f.visits}`} data-fotos-por-visita>
          {groups.map((g) => (
            <li key={g.key} className={f.visit}>
              <div className={f.visitInfo}>
                <p className={f.visitDate}>{formatDate(g.at, locale, timezone)}</p>
                <p className={f.hint}>
                  {g.entry
                    ? [g.entry.services.join(" · "), g.entry.barberName].filter(Boolean).join(" · ")
                    : `${t("ficha.photosNoVisit")} · ${t("ficha.photosNoVisitHint")}`}
                </p>
                {g.entry && canOpenAgenda ? (
                  <Link
                    href={`/barber/agenda?fecha=${dayKey(g.entry.at, timezone)}&visita=${encodeURIComponent(g.entry.id)}`}
                    className={f.btnLink}
                    style={{ marginTop: 8 }}
                  >
                    {t("ficha.openVisit")} <ChevronRight size={14} aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
              <div className={f.visitPhotos}>
                {g.photos.map((p) => (
                  <div key={p.id} className={f.photoCell} data-foto={p.id}>
                    <button type="button" className={f.thumb} onClick={() => onOpen(p)} aria-label={t("photos.openFull")}>
                      {p.signedUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={p.signedUrl} alt="" loading="lazy" decoding="async" />
                      ) : null}
                      {p.id === latestId ? <span className={`${f.thumbTag} ${f.thumbTagTop}`}>{t("photos.latest")}</span> : null}
                      <PhotoKindTag kind={p.kind} t={t} />
                    </button>
                    <div className={f.photoTools}>
                      <button
                        type="button"
                        className={`${f.photoToggle} ${p.visibleToClient ? f.photoToggleOn : ""}`}
                        onClick={() => onToggleVisible(p)}
                        disabled={!(canEdit && canPublish)}
                        title={t("photos.visibleHelp")}
                        aria-pressed={canEdit && canPublish ? p.visibleToClient : undefined}
                        data-accion="foto-portal"
                      >
                        {p.visibleToClient ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
                        {p.visibleToClient ? t("ficha.inPortal") : t("ficha.onlyYou")}
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          className={f.iconBtn}
                          onClick={() => onRemove(p)}
                          aria-label={t("photos.delete")}
                          title={t("photos.delete")}
                          data-accion="borrar-foto"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {photos.length > 0 ? (
        <p className={f.footNote}>
          <Eye size={14} aria-hidden="true" /> {t("ficha.photosFooter")}
        </p>
      ) : null}
    </>
  );
}

// ── Historial ───────────────────────────────────────────────────────────

type HistoryFilter = "all" | "done" | "missed" | "rewards" | "counter";

function matches(e: BarberVisitEntry, filter: HistoryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "done") return e.kind === "appointment" && e.status === "DONE";
  if (filter === "missed") return e.kind === "appointment" && (e.status === "NO_SHOW" || e.status === "CANCELLED");
  if (filter === "rewards") return e.kind === "redemption" || e.loyaltyRedeemed;
  return e.kind === "sale";
}

export function HistorySection({
  entries,
  totalVisits,
  locale,
  timezone,
  t,
  canOpenAgenda,
  onOpenPhoto,
  stars,
  starsDict,
  seg,
  onSeg,
}: {
  entries: BarberVisitEntry[];
  totalVisits: number;
  locale: string;
  timezone: string;
  t: BarberT;
  canOpenAgenda: boolean;
  onOpenPhoto: (p: BarberVisitPhotoView) => void;
  stars: StarsView | null;
  starsDict?: Dictionary;
  seg: "visits" | "stars";
  onSeg: (s: "visits" | "stars") => void;
}) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const st = useMemo(() => (starsDict ? starsT(starsDict) : null), [starsDict]);
  const showStars = Boolean(stars && st);
  const counts = useMemo(() => {
    const c: Record<HistoryFilter, number> = { all: entries.length, done: 0, missed: 0, rewards: 0, counter: 0 };
    for (const e of entries) for (const k of ["done", "missed", "rewards", "counter"] as const) if (matches(e, k)) c[k] += 1;
    return c;
  }, [entries]);
  const list = entries.filter((e) => matches(e, filter));
  const current = showStars ? seg : "visits";

  return (
    <>
      <div className={f.panelHead}>
        <div>
          <h2 className={f.panelTitle}>{t("ficha.tabs.historial")}</h2>
          <p className={f.panelSub}>{t("ficha.historySubtitle", { count: totalVisits })}</p>
        </div>
        {showStars ? (
          <div className={f.seg} role="group" aria-label={t("ficha.tabs.historial")}>
            {(["visits", "stars"] as const).map((k) => (
              <button
                key={k}
                type="button"
                className={`${f.segBtn} ${current === k ? f.segOn : ""}`}
                aria-pressed={current === k}
                onClick={() => onSeg(k)}
                data-historial={k}
              >
                {t(`ficha.historySeg.${k}`)}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {current === "stars" && stars && st ? (
        <div className={`${f.card} ${f.cardPad}`} data-historial-estrellas>
          {stars.enabled ? (
            <StarsHistoryList view={stars} t={st} locale={locale} timezone={timezone} />
          ) : (
            <p className={f.empty}>{t("ficha.starsOff")}</p>
          )}
        </div>
      ) : (
        <>
          {entries.length > 0 ? (
            <div className={f.pills} role="group" aria-label={t("ficha.tabs.historial")}>
              {(["all", "done", "missed", "rewards", "counter"] as const)
                .filter((k) => k === "all" || counts[k] > 0)
                .map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`${f.pill} ${filter === k ? f.pillOn : ""}`}
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                  >
                    {t(`ficha.historyFilter.${k}`)} {k === "all" ? null : <span className={f.pillCount}>{counts[k]}</span>}
                  </button>
                ))}
            </div>
          ) : null}
          <div className={`${f.card} ${f.cardPad}`}>
            {entries.length > 0 && list.length === 0 ? (
              <p className={f.empty}>{t("ficha.historyEmptyFilter")}</p>
            ) : (
              <VisitTimeline
                entries={list}
                locale={locale}
                timezone={timezone}
                t={t}
                agendaLinks={canOpenAgenda}
                onOpenPhoto={onOpenPhoto}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}

// ── Membresía ───────────────────────────────────────────────────────────

const DOTS_MAX = 8;

export function MembershipSection({
  current,
  periods,
  nowISO,
  locale,
  timezone,
  t,
  membresiasT,
  money,
  showMoney,
  canSell,
  onSell,
}: {
  current: BarberClientMembershipBadge | null;
  periods: FichaMembershipPeriod[];
  nowISO: string;
  locale: string;
  timezone: string;
  t: BarberT;
  /** Llaves de barber.membresias (estado y método de pago). */
  membresiasT: BarberT | null;
  money: Intl.NumberFormat;
  /** Ver importes (cash.view o memberships.sell). */
  showMoney: boolean;
  canSell: boolean;
  onSell: (planId: string | null) => void;
}) {
  const now = Date.parse(nowISO);
  const live = periods.find((p) => p.status === "ACTIVE" && Date.parse(p.startAt) <= now && Date.parse(p.endAt) > now) ??
    periods.find((p) => p.status === "PAUSED" && Date.parse(p.endAt) > now) ??
    null;
  const left = current && current.includedCuts !== null ? Math.max(current.includedCuts - current.cutsUsed, 0) : null;
  const daysLeft = current ? Math.max(0, Math.ceil((Date.parse(current.endAt) - now) / 86_400_000)) : 0;
  const range = (a: string, b: string) => t("ficha.membershipRange", { from: formatDate(a, locale, timezone), to: formatDate(b, locale, timezone) });

  const periodState = (p: FichaMembershipPeriod) => {
    if (p.status === "CANCELLED") return { label: t("ficha.periodCancelled"), cls: f.chipDanger };
    if (p.status === "PAUSED") return { label: t("ficha.periodPaused"), cls: f.chipWarn };
    if (Date.parse(p.endAt) <= now || p.status === "EXPIRED") return { label: t("ficha.periodEnded"), cls: "" };
    if (Date.parse(p.startAt) > now) return { label: t("ficha.periodUpcoming"), cls: f.chipBrand };
    return { label: t("ficha.periodCurrent"), cls: f.chipOk };
  };

  return (
    <>
      <div className={f.panelHead}>
        <div>
          <h2 className={f.panelTitle}>{t("ficha.membershipTitle")}</h2>
          <p className={f.panelSub}>{t("ficha.membershipSubtitle")}</p>
        </div>
        {canSell ? (
          <button
            type="button"
            className={`${f.btn} ${current ? "" : f.btnPrimary}`}
            onClick={() => onSell(null)}
            data-accion="vender-membresia"
          >
            <Crown size={15} aria-hidden="true" /> {current ? t("ficha.membershipSellOther") : t("ficha.membershipSell")}
          </button>
        ) : null}
      </div>

      <div className={f.cols}>
        <div className={f.colMain} style={{ flexBasis: 420 }}>
          <section className={`${f.card} ${f.cardPad}`} data-membresia-actual>
            {current ? (
              <>
                <div className={f.memTop}>
                  <span className={f.memIcon} aria-hidden="true">
                    <Crown size={18} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className={f.memName}>{current.name}</p>
                    <p className={f.hint}>
                      {[
                        showMoney && live ? money.format(live.planPrice) : null,
                        current.includedCuts !== null
                          ? t("ficha.membershipCutsUnlimited", { count: current.includedCuts })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className={`${f.chip} ${f.chipOk}`}>{t("ficha.periodCurrent")}</span>
                </div>
                <div className={f.memLeft}>
                  {current.includedCuts !== null && current.includedCuts <= DOTS_MAX ? (
                    <span className={f.cutDots} aria-hidden="true">
                      {Array.from({ length: current.includedCuts }, (_, i) => (
                        <span key={i} className={`${f.cutDot} ${i >= current.cutsUsed ? f.cutDotOn : ""}`}>
                          <Scissors size={13} />
                        </span>
                      ))}
                    </span>
                  ) : null}
                  <span>
                    <strong>
                      {left !== null && current.includedCuts !== null
                        ? t("ficha.membershipLeft", { left, total: current.includedCuts })
                        : t("ficha.membershipUnlimited")}
                    </strong>{" "}
                    {left !== null ? t("ficha.membershipLeftTail") : null}
                    <br />
                    <span className={f.hint}>
                      {live ? range(live.startAt, current.endAt) : formatDate(current.endAt, locale, timezone)} ·{" "}
                      {t("ficha.membershipExpiresIn", { count: daysLeft })}
                    </span>
                  </span>
                </div>
                {current.nextPeriods && current.nextPeriods.length > 0 ? (
                  <p className={f.hint} style={{ marginBottom: 12 }}>
                    {t("detail.membershipNext", {
                      date: formatDate(current.nextPeriods[0].startAt, locale, timezone),
                      until: formatDate(current.nextPeriods[current.nextPeriods.length - 1].endAt, locale, timezone),
                    })}
                  </p>
                ) : null}
                {canSell ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                    <Link href="/barber/membresias" className={`${f.btn} ${f.btnSm}`}>
                      {t("ficha.membershipSeeAll")}
                    </Link>
                    <span className={f.hint}>{t("ficha.membershipRenewHint")}</span>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <div className={f.memTop}>
                  <span className={f.memIcon} aria-hidden="true">
                    <Crown size={18} />
                  </span>
                  <div>
                    <p className={f.memName}>{t("ficha.membershipNone")}</p>
                    <p className={f.hint}>{t("ficha.membershipNoneHint")}</p>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        {periods.length > 0 ? (
          <div className={f.colSide} style={{ flexBasis: 380 }}>
            <section className={`${f.card} ${f.cardPad}`} data-membresia-periodos>
              <div className={f.cardHead}>
                <h3 className={f.cardTitle}>{t("ficha.membershipPeriods")}</h3>
              </div>
              <ul className={f.periods}>
                {periods.map((p) => {
                  const state = periodState(p);
                  return (
                    <li key={p.id} className={f.period}>
                      <div style={{ minWidth: 0 }}>
                        <p className={f.periodName}>{p.name}</p>
                        <span className={f.hint}>{range(p.startAt, p.endAt)}</span>
                      </div>
                      <span>
                        {p.includedCuts !== null
                          ? t("ficha.membershipCuts", { used: p.cutsUsed, total: p.includedCuts })
                          : t("ficha.membershipCutsUnlimited", { count: p.cutsUsed })}
                        {membresiasT ? (
                          <span className={f.hint} style={{ display: "block" }}>
                            {membresiasT(`barber.membresias.payment.${p.paymentMethod}`)}
                          </span>
                        ) : null}
                      </span>
                      <span className={`${f.chip} ${state.cls}`}>{state.label}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        ) : null}
      </div>
    </>
  );
}
