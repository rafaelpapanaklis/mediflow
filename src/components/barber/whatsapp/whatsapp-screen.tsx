"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bot, Link2, Megaphone, MessageSquareText } from "lucide-react";
import { apiCall } from "../team/admin-ui";
import type { Dictionary } from "@/i18n/t";
import type { BarberWaConnectionDTO, BarberWaQuotaDTO } from "@/lib/barber/whatsapp-core";
import type { BarberWaAckSettings } from "@/lib/barber/wa-acuse-core";
import { ConnectionPanel } from "./connection-panel";
import { AcusePanel } from "./acuse-panel";
import { TemplatesPanel, type TemplateRow } from "./templates-panel";
import { CampaignsPanel } from "./campaigns-panel";
import { WaI18n, useWaT } from "./ui";
import s from "./whatsapp.module.css";

// ═══════════════════════════════════════════════════════════════════════
// /barber/whatsapp — la pantalla completa.
//
// DOS GATES DISTINTOS, a propósito:
//   · Conexión, plantillas y recordatorios → TODOS los planes
//     (feature whatsappReminders). Sin esto, un Básico no podría ni conectar
//     su número y los recordatorios que SÍ incluye su plan nunca saldrían.
//   · Campañas → feature whatsappInbox (Avanzado y Profesional). Se dice
//     qué se gana; no se esconde y ya.
//
// Las conversaciones ya NO viven aquí: desde el 15-nov son la pantalla
// /barber/mensajes, con entrada propia en el menú (bajo Clientes). La liga
// vieja (?tab=inbox) la redirige la página.
// ═══════════════════════════════════════════════════════════════════════

type TabKey = "conexion" | "plantillas" | "campanas";

export interface WaStatusPayload {
  connection: BarberWaConnectionDTO;
  quota: BarberWaQuotaDTO;
  templates: { ok: boolean; reason?: string | null; templates: TemplateRow[] };
}

export function BarberWhatsAppScreen({
  dict,
  locale,
  timezone = null,
  initial,
  ack,
  hasInbox,
  canEdit,
  canSend,
}: {
  dict: Dictionary;
  locale: string;
  /** Zona de la barbería: las fechas salen igual en servidor y navegador (#418). */
  timezone?: string | null;
  initial: WaStatusPayload;
  /** El acuse automático (apagado por defecto). Sin dato = no se pinta. */
  ack?: { settings: BarberWaAckSettings; storageReady: boolean } | null;
  hasInbox: boolean;
  canEdit: boolean;
  canSend: boolean;
}) {
  return (
    <WaI18n dict={dict}>
      <Screen
        locale={locale}
        timezone={timezone}
        initial={initial}
        ack={ack ?? null}
        hasInbox={hasInbox}
        canEdit={canEdit}
        canSend={canSend}
      />
    </WaI18n>
  );
}

function Screen({
  locale,
  timezone,
  initial,
  ack,
  hasInbox,
  canEdit,
  canSend,
}: {
  locale: string;
  timezone: string | null;
  initial: WaStatusPayload;
  ack: { settings: BarberWaAckSettings; storageReady: boolean } | null;
  hasInbox: boolean;
  canEdit: boolean;
  canSend: boolean;
}) {
  const t = useWaT();
  const [tab, setTab] = useState<TabKey>("conexion");
  const [status, setStatus] = useState<WaStatusPayload>(initial);

  const refresh = useCallback(async () => {
    try {
      setStatus(await apiCall<WaStatusPayload>("/api/barber/whatsapp/status"));
    } catch {
      // El estado que ya se está pintando sigue sirviendo: una recarga que
      // falla no puede dejar la pantalla en blanco.
    }
  }, []);

  // Tras conectar, Meta tarda unos segundos en dar de alta las plantillas.
  // Una sola relectura diferida evita que la barbería vea "sin dar de alta"
  // justo después de conectar y crea que algo falló.
  useEffect(() => {
    if (status.connection.state === "DISCONNECTED") return;
    const id = setTimeout(() => void refresh(), 8000);
    return () => clearTimeout(id);
    // Solo al cambiar de estado de conexión, no en cada render.
  }, [status.connection.state, refresh]);

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; locked: boolean }[] = [
    { key: "conexion", label: t("tabs.conexion"), icon: <Link2 size={14} />, locked: false },
    {
      key: "plantillas",
      label: t("tabs.plantillas"),
      icon: <MessageSquareText size={14} />,
      locked: false,
    },
    { key: "campanas", label: t("tabs.campanas"), icon: <Megaphone size={14} />, locked: !hasInbox },
  ];

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>{t("title")}</h1>
          <p className={s.subtitle}>{t("subtitle")}</p>
        </div>
      </header>

      <nav className={s.tabs} aria-label={t("title")}>
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            className={[s.tab, tab === item.key ? s.tabActive : ""].filter(Boolean).join(" ")}
            onClick={() => setTab(item.key)}
            aria-current={tab === item.key ? "page" : undefined}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
        {/* El bot tiene su propia pantalla (/barber/whatsapp/bot) y no había
            forma de llegar a ella sin teclear la dirección. Es un enlace, no
            una pestaña más: la configuración del bot no vive aquí. */}
        <Link href="/barber/whatsapp/bot" className={`${s.tab} ${s.tabLink}`} title={t("tabs.botHint")}>
          <Bot size={14} />
          {t("tabs.bot")}
          <ArrowUpRight size={12} aria-hidden />
        </Link>
      </nav>

      {tab === "conexion" ? (
        <ConnectionPanel
          connection={status.connection}
          quota={status.quota}
          locale={locale}
          timezone={timezone}
          canEdit={canEdit}
          canSend={canSend}
          onChanged={refresh}
        />
      ) : null}

      {tab === "conexion" && ack ? (
        <AcusePanel initial={ack.settings} storageReady={ack.storageReady} canEdit={canEdit} />
      ) : null}

      {tab === "plantillas" ? (
        <TemplatesPanel
          initial={status.templates.templates}
          reason={status.templates.ok ? null : (status.templates.reason ?? null)}
          canEdit={canEdit}
          onChanged={refresh}
        />
      ) : null}

      {tab === "campanas" ? (
        hasInbox ? (
          <CampaignsPanel canSend={canSend} />
        ) : (
          <PlanNotice text={t("errors.planLocked")} />
        )
      ) : null}
    </div>
  );
}

function PlanNotice({ text }: { text: string }) {
  return (
    <div className={s.card}>
      <p className={s.cardLead}>{text}</p>
    </div>
  );
}
