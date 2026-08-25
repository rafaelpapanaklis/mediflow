"use client";

import { useState } from "react";
import { MessageCircleOff, Send, SlidersHorizontal, TrendingUp } from "lucide-react";
import type { Dictionary } from "@/i18n/t";
import { Banner } from "../team/admin-ui";
import { CampI18n, useCampT } from "./ui";
import { ListsPanel } from "./lists-panel";
import { TemplatesPanel } from "./templates-panel";
import { ResultsPanel } from "./results-panel";
import { OptOutsPanel } from "./optouts-panel";
import type { AudienceDef, CampaignConfigView, CampaignLimits } from "./types";
import s from "./campanas.module.css";

// ═══════════════════════════════════════════════════════════════════════
// /barber/campanas — la palanca de retención de la barbería.
//
// Cuatro pestañas y un orden deliberado: primero LISTAS (lo que se hace
// hoy), luego PLANTILLAS (cómo suena), luego RESULTADOS (si sirvió) y al
// final BAJAS (a quién no se le vuelve a escribir).
//
// El servidor ya decidió que esta barbería puede estar aquí (plan +
// permiso). Este componente solo pinta y pide: no puede ampliar su alcance.
// ═══════════════════════════════════════════════════════════════════════

type Tab = "lists" | "templates" | "results" | "optouts";

export function CampanasScreen(props: {
  dict: Dictionary;
  locale: string;
  audiences: AudienceDef[];
  config: CampaignConfigView;
  limits: CampaignLimits;
  canSend: boolean;
  canEditTemplates: boolean;
  canEditClients: boolean;
  waConnected: boolean;
}) {
  return (
    <CampI18n dict={props.dict}>
      <Screen {...props} />
    </CampI18n>
  );
}

function Screen({
  locale,
  audiences,
  config,
  limits,
  canSend,
  canEditTemplates,
  canEditClients,
  waConnected,
}: {
  locale: string;
  audiences: AudienceDef[];
  config: CampaignConfigView;
  limits: CampaignLimits;
  canSend: boolean;
  canEditTemplates: boolean;
  canEditClients: boolean;
  waConnected: boolean;
}) {
  const t = useCampT();
  const [tab, setTab] = useState<Tab>("lists");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "lists", label: t("tabs.lists"), icon: <Send size={15} /> },
    { id: "templates", label: t("tabs.templates"), icon: <SlidersHorizontal size={15} /> },
    { id: "results", label: t("tabs.results"), icon: <TrendingUp size={15} /> },
    { id: "optouts", label: t("tabs.optouts"), icon: <MessageCircleOff size={15} /> },
  ];

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>{t("title")}</h1>
          <p className={s.subtitle}>{t("subtitle")}</p>
        </div>
      </header>

      {/* Sin WhatsApp conectado no sale nada, y decirlo aquí evita que
          alguien arme una tanda entera para chocar contra el error. */}
      {!waConnected ? (
        <Banner tone="danger" title={t("errors.noWhatsapp")}>
          <a className={s.bannerLink} href="/barber/whatsapp">
            WhatsApp
          </a>
        </Banner>
      ) : null}

      <div className={s.tabs} role="tablist" aria-label={t("title")}>
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={[s.tab, tab === item.id ? s.tabActive : ""].filter(Boolean).join(" ")}
            onClick={() => setTab(item.id)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      {tab === "lists" ? (
        <ListsPanel
          locale={locale}
          audiences={audiences}
          limits={limits}
          canSend={canSend && waConnected}
        />
      ) : null}
      {tab === "templates" ? (
        <TemplatesPanel
          audiences={audiences}
          config={config}
          limits={limits}
          canEdit={canEditTemplates}
        />
      ) : null}
      {tab === "results" ? <ResultsPanel locale={locale} /> : null}
      {tab === "optouts" ? (
        <OptOutsPanel locale={locale} canEdit={canEditClients} />
      ) : null}
    </div>
  );
}
