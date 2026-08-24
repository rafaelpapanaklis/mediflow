"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox, Link2, Megaphone, MessageSquareText } from "lucide-react";
import { apiCall } from "../team/admin-ui";
import type { Dictionary } from "@/i18n/t";
import type { BarberWaConnectionDTO, BarberWaQuotaDTO } from "@/lib/barber/whatsapp-core";
import { ConnectionPanel } from "./connection-panel";
import { InboxPanel } from "./inbox-panel";
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
//   · Conversaciones y campañas → feature whatsappInbox (Avanzado y
//     Profesional). Se dice qué se gana; no se esconde y ya.
// ═══════════════════════════════════════════════════════════════════════

type TabKey = "conexion" | "inbox" | "plantillas" | "campanas";

export interface WaStatusPayload {
  connection: BarberWaConnectionDTO;
  quota: BarberWaQuotaDTO;
  templates: { ok: boolean; reason?: string | null; templates: TemplateRow[] };
}

export function BarberWhatsAppScreen({
  dict,
  locale,
  initial,
  hasInbox,
  canEdit,
  canSend,
}: {
  dict: Dictionary;
  locale: string;
  initial: WaStatusPayload;
  hasInbox: boolean;
  canEdit: boolean;
  canSend: boolean;
}) {
  return (
    <WaI18n dict={dict}>
      <Screen
        locale={locale}
        initial={initial}
        hasInbox={hasInbox}
        canEdit={canEdit}
        canSend={canSend}
      />
    </WaI18n>
  );
}

function Screen({
  locale,
  initial,
  hasInbox,
  canEdit,
  canSend,
}: {
  locale: string;
  initial: WaStatusPayload;
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
    { key: "inbox", label: t("tabs.inbox"), icon: <Inbox size={14} />, locked: !hasInbox },
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
      </nav>

      {tab === "conexion" ? (
        <ConnectionPanel
          connection={status.connection}
          quota={status.quota}
          locale={locale}
          canEdit={canEdit}
          canSend={canSend}
          onChanged={refresh}
        />
      ) : null}

      {tab === "plantillas" ? (
        <TemplatesPanel
          initial={status.templates.templates}
          reason={status.templates.ok ? null : (status.templates.reason ?? null)}
          canEdit={canEdit}
          onChanged={refresh}
        />
      ) : null}

      {tab === "inbox" ? (
        hasInbox ? (
          <InboxPanel locale={locale} canSend={canSend} quota={status.quota} />
        ) : (
          <PlanNotice text={t("errors.planLocked")} />
        )
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
