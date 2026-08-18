"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Tarjeta "Tu manager de cuenta" — variante HORIZONTAL del prototipo (1f).
// Se monta ARRIBA de la lista de tickets en /dashboard/soporte.
//
// Los datos llegan YA resueltos desde el servidor (ver
// src/lib/account-manager/get-for-clinic.ts): este componente no calcula
// disponibilidad ni conoce el catálogo de managers — sólo pinta el manager
// asignado a la clínica de la sesión.
//
// Tres estados, los tres del prototipo:
//   · con manager EN LÍNEA         → chip verde con punto pulsante + badge en el avatar
//   · con manager FUERA DE HORARIO → chip gris + copy tranquilizador; el botón
//     de WhatsApp SIGUE habilitado (puede escribir; le contestan en su horario)
//   · sin manager                  → estado vacío con CTA a ticket
// ═══════════════════════════════════════════════════════════════════════════

import { FileText, UserRound } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { ButtonNew } from "@/components/ui/design-system/button-new";
// El glifo y el botón verde salieron de aquí a components/ui al necesitarlos
// una segunda pantalla (el banner de la mini-web). Misma pinta, un solo dueño.
import { WhatsAppLinkButton } from "@/components/ui/whatsapp-link-button";
import type { AccountManagerCardData } from "@/lib/account-manager/get-for-clinic";
import { firstNameOf, initialsFromName } from "@/lib/account-manager/types";
import styles from "./account-manager-card.module.css";

interface Props {
  /** null = la clínica no tiene manager asignado (o el SQL aún no se aplicó). */
  data: AccountManagerCardData | null;
  /** Nombre de la clínica — va en el mensaje pre-escrito de WhatsApp. */
  clinicName: string;
  /** Abre el modal de nuevo ticket YA EXISTENTE. No duplicamos ese flujo. */
  onOpenTicket: () => void;
}

export function AccountManagerCard({ data, clinicName, onOpenTicket }: Props) {
  const t = useT();

  // ── Estado vacío: sin manager asignado ───────────────────────────────────
  if (!data) {
    return (
      <section className={styles.card} aria-label={t("accountManager.eyebrow")}>
        <div className={styles.empty}>
          <div className={styles.emptyHeader}>
            <span className={styles.eyebrow}>{t("accountManager.eyebrow")}</span>
            <span className={`${styles.chip} ${styles.chipSoon}`}>{t("accountManager.soon")}</span>
          </div>
          <div className={styles.emptyIcon} style={{ marginTop: 16 }}>
            <UserRound size={24} strokeWidth={1.7} aria-hidden />
          </div>
          <div className={styles.emptyTitle}>{t("accountManager.emptyTitle")}</div>
          <p className={styles.emptyBody}>{t("accountManager.emptyBody")}</p>
          <div className={styles.emptyActions}>
            <ButtonNew
              variant="primary"
              type="button"
              icon={<FileText size={15} strokeWidth={1.8} />}
              onClick={onOpenTicket}
            >
              {t("accountManager.emptyCta")}
            </ButtonNew>
          </div>
          <div className={styles.emptyFootnote}>{t("accountManager.emptyFootnote")}</div>
        </div>
      </section>
    );
  }

  const { manager, online, scheduleText, nextAvailable } = data;
  const firstName = firstNameOf(manager.name) || manager.name;

  // Mensaje pre-escrito: le ahorra a la clínica explicar quién es. El prototipo
  // no lo definía; se añade porque del otro lado llegan muchos chats sin
  // contexto. El url-encode lo hace <WhatsAppLinkButton />.
  const prefilled = t("accountManager.prefilledMessage", { manager: firstName, clinic: clinicName });

  return (
    <section className={styles.card} aria-label={t("accountManager.eyebrow")}>
      <div className={styles.headRow}>
        <div className={styles.avatarWrap}>
          {manager.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- URL externa (Supabase Storage): next/image exigiría allowlist de dominios.
            <img className={styles.avatar} src={manager.photoUrl} alt={manager.name} width={54} height={54} />
          ) : (
            <div className={styles.avatarFallback} aria-hidden>
              {initialsFromName(manager.name)}
            </div>
          )}
          {online && <span className={styles.presenceDot} aria-hidden />}
        </div>

        <div className={styles.body}>
          <div className={styles.topRow}>
            <span className={styles.eyebrow}>{t("accountManager.eyebrow")}</span>
            {online ? (
              <span className={`${styles.chip} ${styles.chipOnline}`}>
                <span className={`${styles.chipDot} ${styles.chipDotOnline}`} aria-hidden />
                {t("accountManager.online")}
              </span>
            ) : (
              <span className={`${styles.chip} ${styles.chipOffline}`}>
                <span className={`${styles.chipDot} ${styles.chipDotOffline}`} aria-hidden />
                {t("accountManager.offline")}
              </span>
            )}
          </div>

          <div className={styles.name}>
            {manager.name} <span className={styles.quote}>— {t("accountManager.quote")}</span>
          </div>

          <div className={styles.meta}>
            {t("accountManager.attends", { schedule: scheduleText })}
            {" · "}
            <span className={styles.phone}>{manager.whatsappDisplay}</span>
            {/* Fuera de horario el prototipo añade cuándo vuelve a atender. */}
            {!online && nextAvailable ? <>{" · "}{nextAvailable}</> : null}
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        {/* Fuera de horario el botón NO se deshabilita: puede escribir ahora y
            le contestan en su horario (así lo define el prototipo). */}
        <WhatsAppLinkButton phoneE164={manager.whatsappE164} message={prefilled} block>
          {t("accountManager.writeWhatsapp")}
        </WhatsAppLinkButton>
        <div className={styles.ticketHint}>
          {online ? null : <>{t("accountManager.writeNowReplyLater")}{" "}</>}
          {t("accountManager.orOpenTicketPrefix")}
          <button type="button" className={styles.ticketLink} onClick={onOpenTicket}>
            {t("accountManager.orOpenTicketLink")}
          </button>
          {t("accountManager.orOpenTicketSuffix")}
        </div>
      </div>
    </section>
  );
}
