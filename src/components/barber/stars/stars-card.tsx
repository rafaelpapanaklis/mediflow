import { Gift, Star } from "lucide-react";
import type { Dictionary, TVars } from "@/i18n/t";
import { makeBarberT } from "@/lib/barber/i18n";
// `import type`: se borra al compilar, no arrastra nada del servidor.
import type { BonusPublic, BonusWhat, StarEvent, StarsView } from "@/lib/barber/stars-core";
import s from "./stars.module.css";

/* ═══════════════════════════════════════════════════════════════════════
   La tarjeta de ESTRELLAS dibujada. Sin hooks ni fetch: recibe la vista ya
   resuelta en el servidor (loadStarsView) y la pinta. La usan «mi cuenta»,
   la tarjeta por enlace (/b/[slug]/tarjeta/[token]), la ficha del cliente y
   la pantalla de «cobrado» de Caja — por eso no lleva "use client": sirve
   igual en un componente de servidor que dentro de uno de cliente.

   `dict` es el sub-árbol `barber.estrellas` del diccionario.
   ═══════════════════════════════════════════════════════════════════════ */

export type StarsT = (key: string, vars?: TVars) => string;

export function starsT(dict: Dictionary): StarsT {
  return makeBarberT(dict);
}

/** Más de esto no se dibuja estrella por estrella: barra de avance. */
const MAX_DRAWN = 30;

function moneyFmt(locale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
}

/** «Corte gratis», «$50 de descuento», «10% de descuento» o el texto libre. */
export function bonusWhatText(t: StarsT, what: BonusWhat, locale: string): string {
  switch (what.kind) {
    case "service":
      return what.serviceName ? t("what.service", { service: what.serviceName }) : t("what.serviceAny");
    case "amount":
      return t("what.amount", { amount: moneyFmt(locale).format(what.amount ?? 0) });
    case "percent":
      return t("what.percent", { percent: what.percent ?? 0 });
    default:
      return what.text ?? "";
  }
}

export function StarsCard({
  view,
  t,
  audience,
  locale,
}: {
  view: StarsView;
  t: StarsT;
  audience: "client" | "staff";
  locale: string;
}) {
  const filled = Math.min(view.stars, view.slots);
  const goals = new Set(view.catalog.map((b) => b.cost));
  const next = view.next;
  const label = t("card.progress", { count: filled, total: view.slots });

  return (
    <section className={s.card} aria-label={audience === "client" ? t("card.title") : t("card.titleStaff")}>
      <div className={s.head}>
        <div>
          <p className={s.eyebrow}>{audience === "client" ? t("card.title") : t("card.titleStaff")}</p>
          <p className={s.count}>
            <Star size={24} className={s.countStar} fill="currentColor" aria-hidden="true" />
            {t("card.count", { count: view.stars })}
          </p>
        </div>
        {view.catalog.length > 0 ? <span className={s.progress}>{label}</span> : null}
      </div>

      {view.slots <= MAX_DRAWN ? (
        <div className={s.grid} role="img" aria-label={label}>
          {Array.from({ length: view.slots }, (_, i) => {
            const on = i < filled;
            const goal = goals.has(i + 1);
            return (
              <span key={i} className={`${s.slot} ${on ? s.slotOn : ""} ${goal ? s.slotGoal : ""}`}>
                <Star size={18} fill={on ? "currentColor" : "none"} aria-hidden="true" />
                {goal ? (
                  <span className={s.slotGift} aria-hidden="true">
                    <Gift size={11} />
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : (
        <div className={s.bar} role="img" aria-label={label}>
          <div className={s.barFill} style={{ width: `${Math.round((filled / Math.max(1, view.slots)) * 100)}%` }} />
        </div>
      )}

      <p className={s.next}>
        {view.catalog.length === 0
          ? t("card.noBonuses")
          : next
            ? t(audience === "client" ? "card.next" : "card.nextStaff", {
                count: next.remaining,
                bonus: next.bonus.name,
              })
            : t(audience === "client" ? "card.allReached" : "card.allReachedStaff")}
        {next ? <span className={s.nextWhat}>{bonusWhatText(t, next.bonus.what, locale)}</span> : null}
      </p>
    </section>
  );
}

export function BonusRow({
  bonus,
  t,
  locale,
  ready,
  action,
}: {
  bonus: BonusPublic;
  t: StarsT;
  locale: string;
  ready: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className={`${s.bonus} ${ready ? s.bonusReady : ""}`}>
      <div style={{ minWidth: 0 }}>
        <p className={s.bonusName}>{bonus.name}</p>
        <p className={s.bonusWhat}>{bonusWhatText(t, bonus.what, locale)}</p>
      </div>
      {action ?? <span className={s.cost}>{t("card.stars", { count: bonus.cost })}</span>}
    </div>
  );
}

/** Bonos disponibles, lo que se puede ganar, la regla y el historial. */
export function StarsDetails({
  view,
  t,
  audience,
  locale,
  timezone,
  availableAction,
}: {
  view: StarsView;
  t: StarsT;
  audience: "client" | "staff";
  locale: string;
  timezone: string;
  /** Botón por bono disponible (solo en la ficha: «Marcar como entregado»). */
  availableAction?: (bonus: BonusPublic) => React.ReactNode;
}) {
  const ready = new Set(view.available.map((b) => b.id));
  const pending = view.catalog.filter((b) => !ready.has(b.id));
  return (
    <div>
      {view.available.length > 0 ? (
        <div className={s.section}>
          <p className={s.sectionTitle}>{audience === "client" ? t("card.available") : t("card.availableStaff")}</p>
          {view.available.map((b) => (
            <BonusRow
              key={b.id}
              bonus={b}
              t={t}
              locale={locale}
              ready
              action={availableAction ? availableAction(b) : undefined}
            />
          ))}
          {audience === "client" ? <p className={s.hint}>{t("card.availableHint")}</p> : null}
        </div>
      ) : null}

      {pending.length > 0 ? (
        <div className={s.section}>
          <p className={s.sectionTitle}>{t("card.catalog")}</p>
          {pending.map((b) => (
            <BonusRow key={b.id} bonus={b} t={t} locale={locale} ready={false} />
          ))}
        </div>
      ) : null}

      <p className={s.hint}>
        {t("card.rule")}
        {view.usedCount > 0 ? ` · ${t("card.used", { count: view.usedCount })}` : ""}
      </p>

      <div className={s.section}>
        <p className={s.sectionTitle}>{t("card.history")}</p>
        {view.history.length === 0 ? (
          <p className={s.hint}>{t("card.historyEmpty")}</p>
        ) : (
          <ul className={s.history}>
            {view.history.map((e) => (
              <StarEventRow key={e.id} event={e} t={t} locale={locale} timezone={timezone} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function eventTitle(t: StarsT, e: StarEvent): string {
  if (e.kind === "manual") return e.delta > 0 ? t("reason.manualPlus") : t("reason.manualMinus");
  if (e.kind === "returned") return t("reason.returned");
  return t(`reason.${e.reason}`);
}

function StarEventRow({
  event: e,
  t,
  locale,
  timezone,
}: {
  event: StarEvent;
  t: StarsT;
  locale: string;
  timezone: string;
}) {
  let when = "";
  try {
    when = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: timezone,
    }).format(new Date(e.at));
  } catch {
    when = e.at.slice(0, 10);
  }
  const cls = e.delta > 0 ? s.deltaPlus : e.delta < 0 ? s.deltaMinus : s.deltaZero;
  const delta =
    e.delta > 0 ? `+${e.delta} ★` : e.delta < 0 ? `−${Math.abs(e.delta)} ★` : t("card.noStar");
  return (
    <li className={s.event}>
      <div style={{ minWidth: 0 }}>
        <p className={s.eventWhen}>{when}</p>
        <p className={s.eventTitle}>{eventTitle(t, e)}</p>
        {e.detail ? <p className={s.eventDetail}>{e.detail}</p> : null}
        {e.note || e.by ? (
          <p className={s.eventNote}>
            {[e.note, e.by ? t("staff.by", { name: e.by }) : null].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </div>
      <span className={`${s.delta} ${cls}`}>{delta}</span>
    </li>
  );
}
