"use client";

// ═══════════════════════════════════════════════════════════════════════════
// Banner "¿Necesitas una página más avanzada o personalizada?" — vive al pie
// de /dashboard/landing (la pantalla de la mini-web).
//
// NO consulta nada: el manager llega YA resuelto desde el servidor
// (getAccountManagerForClinic, el mismo helper que usa /dashboard/soporte), y
// el botón verde es <WhatsAppLinkButton />, el mismo de la tarjeta de soporte.
// Aquí sólo se decide QUÉ se dice y a DÓNDE se manda.
//
// No es una segunda tarjeta de manager: no lleva horario, ni chip de estado, ni
// —sobre todo— el teléfono a la vista. Es un ofrecimiento comercial dentro del
// editor del sitio; el número viaja en el href y en ningún otro lado.
//
// Dos estados:
//   · CON manager (con WhatsApp usable) → botón de WhatsApp con el mensaje ya
//     escrito: de qué clínica viene y que es por la mini-web. Fuera de horario
//     el botón SIGUE habilitado, igual que en la tarjeta de soporte; sólo se
//     añade la nota de que le contestan en su horario.
//   · SIN manager (sin asignar, sin WhatsApp usable, o la lectura degradada)
//     → el banner se pinta igual pero manda a /dashboard/soporte. Nunca un
//     wa.me apuntando a nadie. Ver el comentario largo en la página.
// ═══════════════════════════════════════════════════════════════════════════

import { LifeBuoy, Sparkles } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { WhatsAppLinkButton } from "@/components/ui/whatsapp-link-button";
import type { AccountManagerCardData } from "@/lib/account-manager/get-for-clinic";
import { firstNameOf, hasUsableWhatsapp, initialsFromName } from "@/lib/account-manager/types";

interface Props {
  /** null = sin manager asignado / lectura degradada. Estado VÁLIDO. */
  manager: AccountManagerCardData | null;
  /** Va en el mensaje pre-escrito: identifica de qué clínica viene el chat. */
  clinicName: string;
}

export function LandingUpgradeBanner({ manager, clinicName }: Props) {
  const t = useT();

  // Un manager sin número usable es, para esta pantalla, lo mismo que no tener
  // manager: lo único que le podíamos ofrecer era su WhatsApp.
  const data = manager && hasUsableWhatsapp(manager.manager.whatsappE164) ? manager : null;
  const firstName = data ? firstNameOf(data.manager.name) || data.manager.name : "";

  return (
    <div className="bg-card border border-[color:var(--border-soft)] rounded-[var(--radius-lg)] shadow-[var(--shadow-1)] px-4 py-4 sm:px-5 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
      {/* Avatar + textos van juntos también en móvil (mismo criterio que el
          .headRow de la tarjeta de soporte): al apilar, lo único que baja es el
          botón. Si el avatar cayera en su propia línea sobraría aire. */}
      <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
        {/* Con manager, su cara; sin manager, el glifo de la casa. Nunca un hueco. */}
        {data ? (
          <div className="relative w-10 h-10 shrink-0">
            {data.manager.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL externa (Supabase Storage): next/image exigiría allowlist de dominios.
              <img
                src={data.manager.photoUrl}
                alt={data.manager.name}
                width={40}
                height={40}
                className="w-10 h-10 rounded-full object-cover block"
              />
            ) : (
              <div
                aria-hidden
                className="w-10 h-10 rounded-full grid place-items-center text-white text-[13px] font-bold select-none bg-gradient-to-br from-violet-400 to-brand-600"
              >
                {initialsFromName(data.manager.name)}
              </div>
            )}
            {data.online && (
              <span
                aria-hidden
                className="absolute right-0 bottom-0 w-3 h-3 rounded-full bg-[color:var(--success)] border-2 border-card"
              />
            )}
          </div>
        ) : (
          <span className="w-10 h-10 shrink-0 grid place-items-center rounded-full bg-[color:var(--brand-soft)] text-[color:var(--brand)]">
            <Sparkles size={18} strokeWidth={1.9} aria-hidden />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-[color:var(--text-1)]">
            {t("pages.landing.upgradeTitle")}
          </div>
          <p className="text-[12.5px] text-[color:var(--text-3)] mt-0.5 leading-snug">
            {data
              ? firstName
                ? t("pages.landing.upgradeBodyNamed", { name: firstName })
                : t("pages.landing.upgradeBody")
              : t("pages.landing.upgradeBodyNoManager")}
            {/* Fuera de horario no se esconde el botón: se dice qué esperar. */}
            {data && !data.online ? <> {t("accountManager.writeNowReplyLater")}</> : null}
          </p>
        </div>
      </div>

      <div className="shrink-0 w-full sm:w-auto">
        {data ? (
          <WhatsAppLinkButton
            phoneE164={data.manager.whatsappE164}
            message={t("pages.landing.upgradeWhatsappMessage", {
              manager: firstName,
              clinic: clinicName,
            })}
          >
            {t("accountManager.writeWhatsapp")}
          </WhatsAppLinkButton>
        ) : (
          // Sin manager la salida es el canal que SÍ existe: soporte. Es un <a>
          // con las clases del sistema (ButtonNew renderiza <button> y esto es
          // una navegación de verdad, que se debe poder abrir en otra pestaña).
          <a href="/dashboard/soporte" className="btn-new btn-new--secondary w-full sm:w-auto justify-center">
            <LifeBuoy size={15} strokeWidth={1.9} aria-hidden />
            {t("pages.landing.upgradeSupportCta")}
          </a>
        )}
      </div>
    </div>
  );
}
