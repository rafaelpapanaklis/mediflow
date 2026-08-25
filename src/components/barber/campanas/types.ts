// ═══════════════════════════════════════════════════════════════════════
// Tipos que comparten las piezas de /barber/campanas.
//
// Son un ESPEJO de lo que devuelven las rutas de /api/barber/campaigns.
// Viven aquí (client-safe, sin imports de servidor) para que ningún
// componente tenga que importar src/lib/barber/campaigns.ts, que es
// server-only y arrastraría prisma al bundle del navegador.
// ═══════════════════════════════════════════════════════════════════════

export type CampaignAudienceId =
  | "inactive"
  | "birthday"
  | "membershipExpiring"
  | "membershipExpired"
  | "loyaltyReward"
  | "noShow";

export type SkipReason = "optOut" | "blocked" | "noPhone" | "alreadySent" | "cooldown";

export const SKIP_REASONS: SkipReason[] = [
  "optOut",
  "blocked",
  "noPhone",
  "alreadySent",
  "cooldown",
];

export interface CampaignTarget {
  clientId: string;
  name: string;
  phone: string;
  lastVisitAt: string | null;
  daysSinceLastVisit: number | null;
  totalVisits: number;
  loyaltyCount: number;
  spentMxn: number;
  birthdayDay: number | null;
  membershipEndAt: string | null;
  membershipName: string | null;
  noShowCount: number;
  lastSentAt: string | null;
  eligible: boolean;
  skipReason: SkipReason | null;
}

export interface CampaignCost {
  messages: number;
  category: "MARKETING";
  unitUsd: number;
  totalUsd: number;
}

export interface WaQuota {
  limit: number;
  used: number;
  remaining: number;
  periodStart: string | null;
  nearLimit: boolean;
  exhausted: boolean;
}

export interface AudiencePayload {
  audience: CampaignAudienceId;
  days: number | null;
  month: number | null;
  targets: CampaignTarget[];
  skipped: Record<SkipReason, number>;
  eligibleCount: number;
  batchMax: number;
  templateName: string;
  templateStatus: string;
  templateBody: string;
  promo: string;
  cooldownDays: number;
  configPersisted: boolean;
  cost: CampaignCost;
  quota: WaQuota;
}

export interface SendResult {
  ok: true;
  sent: number;
  failed: number;
  skipped: number;
  detail: { clientId: string; name: string; ok: boolean; reason: string | null }[];
  cost: CampaignCost;
  quotaExhausted: boolean;
}

export interface HistoryRow {
  day: string;
  templateName: string;
  audienceLabel: string | null;
  messages: number;
  delivered: number;
  failed: number;
  costUsd: number;
  returned: number;
}

export interface HistoryPayload {
  rows: HistoryRow[];
  totals: {
    messages: number;
    delivered: number;
    failed: number;
    costUsd: number;
    returned: number;
  };
  windowDays: number;
}

export interface OptOutRow {
  clientId: string;
  name: string;
  phone: string;
  optOut: {
    at: string;
    source: "client" | "staff";
    byUserId: string | null;
    reason: string | null;
  };
}

export interface CampaignLimits {
  batchMax: number;
  promoMax: number;
  tokens: string[];
  inactiveDays: number;
  membershipExpiringDays: number;
  noShowMin: number;
  unitUsd: number;
}

export interface CampaignConfigView {
  cooldownDays: number;
  templates: Record<CampaignAudienceId, string>;
  persisted: boolean;
}

export interface AudienceDef {
  id: CampaignAudienceId;
  repeatAfterDays: number;
}
