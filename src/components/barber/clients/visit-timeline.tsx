"use client";

import { Gift, Scissors, Store } from "lucide-react";
import { BARBER_APPOINTMENT_STATUS_UI } from "@/lib/barber/types";
import type { BarberVisitEntry } from "@/lib/barber/loyalty";
import type { BarberVisitPhotoView } from "@/lib/barber/clients";
import { Badge, clientStyles as s, formatDateTime, formatMoney, type BarberT } from "./ui";

/**
 * Historial de cortes: una sola línea de tiempo con las citas, las ventas de
 * mostrador sin cita y los canjes de premio.
 *
 * Las citas que NO llegaron (NO_SHOW) también salen, a propósito: es
 * exactamente lo que se mira antes de decidir si bloqueas a alguien.
 */

function toneToBadge(tone: string): "neutral" | "brand" | "danger" | "success" {
  if (tone === "success") return "success";
  if (tone === "danger") return "danger";
  if (tone === "brand" || tone === "info" || tone === "warning") return "brand";
  return "neutral";
}

export function VisitTimeline({
  entries,
  locale,
  t,
  onOpenPhoto,
}: {
  entries: BarberVisitEntry[];
  locale: string;
  t: BarberT;
  onOpenPhoto: (photo: BarberVisitPhotoView) => void;
}) {
  if (entries.length === 0) {
    return <p className={s.sectionSub}>{t("history.empty")}</p>;
  }

  return (
    <ol className={s.timeline} aria-label={t("history.title")}>
      {entries.map((entry) => {
        const isRedemption = entry.kind === "redemption";
        const statusUi = entry.status ? BARBER_APPOINTMENT_STATUS_UI[entry.status] : null;

        return (
          <li key={`${entry.kind}-${entry.id}`} className={s.tlItem}>
            <span className={`${s.tlDot} ${isRedemption ? s.tlDotBrand : ""}`} aria-hidden="true">
              {isRedemption ? (
                <Gift size={11} />
              ) : entry.kind === "sale" ? (
                <Store size={11} />
              ) : (
                <Scissors size={11} />
              )}
            </span>

            <div className={s.tlBody}>
              <div className={s.tlHead}>
                <span className={s.tlDate}>{formatDateTime(entry.at, locale)}</span>

                {isRedemption ? (
                  <Badge tone="brand">
                    {t("history.redemption", { reward: entry.reward ?? "" })}
                  </Badge>
                ) : null}

                {entry.status && statusUi ? (
                  <Badge tone={toneToBadge(statusUi.tone)}>
                    {t(`history.status.${entry.status}`)}
                  </Badge>
                ) : null}

                {entry.kind === "sale" ? <Badge>{t("history.walkIn")}</Badge> : null}

                {/* El canje cobrado en caja (T6) también tiene que verse aquí. */}
                {!isRedemption && entry.loyaltyRedeemed ? (
                  <Badge tone="brand">
                    <Gift size={11} /> {t("history.paidWithReward")}
                  </Badge>
                ) : null}

                {entry.amount !== null ? (
                  <span className={s.tlMeta}>
                    {formatMoney(entry.amount, locale)}
                    {entry.amountIsEstimate ? ` · ${t("history.estimate")}` : ""}
                  </span>
                ) : null}
              </div>

              {!isRedemption ? (
                <span className={s.tlMeta}>{entry.barberName ?? t("history.noBarber")}</span>
              ) : null}

              {entry.services.length > 0 ? (
                <span className={s.tlServices}>{entry.services.join(" · ")}</span>
              ) : null}

              {entry.notes ? <p className={s.tlNote}>{entry.notes}</p> : null}

              {entry.photos.length > 0 ? (
                <div className={s.tlPhotos}>
                  {entry.photos.map((photo) => (
                    <button
                      key={photo.id}
                      type="button"
                      className={s.tlThumb}
                      onClick={() => onOpenPhoto(photo)}
                      aria-label={t("photos.openFull")}
                    >
                      {photo.signedUrl ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={photo.signedUrl} alt="" loading="lazy" decoding="async" />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
