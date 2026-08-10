"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import toast from "react-hot-toast";
import {
  Clock, CheckCircle2, XCircle, Ban,
  MousePointerClick, Wallet, DollarSign, TrendingUp,
  Coins, Percent, Repeat, Trophy,
} from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { KpiCard } from "@/components/ui/design-system/kpi-card";
import { formatRelativeDate } from "@/lib/format";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm-dialog";
// Motor de comisiones: matemática PURA (sin Prisma) → se puede importar aquí.
import {
  DEFAULT_MILESTONES,
  DEFAULT_PAYOUT_CONFIG,
  PAYOUT_MODE_LABELS,
  PLAN_KEYS,
  equivalentPct,
  paybackMonths,
  simulateProgram,
  type MilestonesConfig,
  type PayoutConfig,
  type PayoutMode,
  type PlanKey,
  type ProgramMode,
} from "@/lib/affiliates/payout-core";
// Type-only: se borra al compilar (mismo patrón que SearchablePatient).
import type { AdminAffiliateMetricsResponse } from "@/app/api/admin/affiliates/metrics/route";

type AffiliateStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
type AssignableStatus = "APPROVED" | "REJECTED" | "SUSPENDED";
type FilterKey = "ALL" | AffiliateStatus;

type AffiliateRow = {
  id: string;
  name: string;
  slug: string;
  email: string;
  status: AffiliateStatus;
  referralCode: string;
  commissionPct: number;
  // % vigente por nivel bronce/plata/oro (lo que paga el webhook). null =
  // modo legacy (config de niveles sin aplicar) → se muestra commissionPct.
  effectiveLevelLabel?: string | null;
  effectivePct?: number | null;
  totalClicks?: number;
  payoutMethod: string | null;
  createdAt: string | Date;
  approvedAt: string | Date | null;
  _count?: { clinics: number };
};

// Vendedor del equipo de un afiliado (GET /api/admin/affiliates/[id]/sellers).
type SellerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  commissionPct: number;
  isActive: boolean;
  payoutMethod: string | null;
  payoutDetails: string | null;
  pendingMxn: number;
  paidMxn: number;
  clinics: number;
};

const STATUS_LABELS: Record<AffiliateStatus, string> = {
  PENDING: "En revisión",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  SUSPENDED: "Suspendido",
};

const STATUS_TONE: Record<AffiliateStatus, "success" | "warning" | "danger" | "neutral"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  SUSPENDED: "neutral",
};

// Orden de revisión: lo accionable (PENDING) primero, lo resuelto al final.
const STATUS_ORDER: Record<AffiliateStatus, number> = {
  PENDING: 0,
  APPROVED: 1,
  SUSPENDED: 2,
  REJECTED: 3,
};

// Transiciones ofrecidas desde cada estado.
const ACTIONS: Record<AffiliateStatus, AssignableStatus[]> = {
  PENDING: ["APPROVED", "REJECTED"],
  APPROVED: ["SUSPENDED"],
  REJECTED: ["APPROVED"],
  SUSPENDED: ["APPROVED"],
};

const ACTION_CONFIG: Record<
  AssignableStatus,
  {
    label: string;
    btn: "primary" | "secondary" | "danger";
    confirmVariant: "default" | "warning" | "danger";
    title: string;
    description: string;
  }
> = {
  APPROVED: {
    label: "Aprobar",
    btn: "primary",
    confirmVariant: "default",
    title: "¿Aprobar afiliado?",
    description:
      "Podrá compartir su enlace de referido y ganará comisión recurrente por cada clínica que se suscriba.",
  },
  REJECTED: {
    label: "Rechazar",
    btn: "danger",
    confirmVariant: "danger",
    title: "¿Rechazar afiliado?",
    description: "No tendrá acceso al panel de afiliados. Puedes reactivarlo después con Aprobar.",
  },
  SUSPENDED: {
    label: "Suspender",
    btn: "secondary",
    confirmVariant: "warning",
    title: "¿Suspender afiliado?",
    description: "Perderá el acceso al panel temporalmente. Podrás reactivarlo después con Aprobar.",
  },
};

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "Todos" },
  { key: "PENDING", label: "En revisión" },
  { key: "APPROVED", label: "Aprobados" },
  { key: "SUSPENDED", label: "Suspendidos" },
  { key: "REJECTED", label: "Rechazados" },
];

// Config global de niveles (GET/PUT /api/admin/affiliates/config).
type ConfigFieldKey = "bronzePct" | "silverPct" | "goldPct" | "silverMinActive" | "goldMinActive";

const CONFIG_FIELDS: { key: ConfigFieldKey; label: string; min: number; max: number; step: number }[] = [
  { key: "bronzePct", label: "Bronce %", min: 0, max: 50, step: 0.5 },
  { key: "silverPct", label: "Plata %", min: 0, max: 50, step: 0.5 },
  { key: "goldPct", label: "Oro %", min: 0, max: 50, step: 0.5 },
  { key: "silverMinActive", label: "Clínicas activas para Plata", min: 1, max: 1000, step: 1 },
  { key: "goldMinActive", label: "Clínicas activas para Oro", min: 1, max: 1000, step: 1 },
];

const DEFAULT_CONFIG_FORM: Record<ConfigFieldKey, string> = {
  bronzePct: "10",
  silverPct: "12",
  goldPct: "15",
  silverMinActive: "3",
  goldMinActive: "10",
};

// ── Esquema de pago (GET/PUT /api/admin/affiliates/payout-config) ─────────
// Los tipos van declarados aquí a propósito (mismo criterio que SellerRow):
// así este archivo compila sin depender de la ruta del API.

/** Precio REAL del plan (plan_configs). Jamás se escribe un precio a mano. */
type PayoutPlanRow = { id: PlanKey; label: string; priceMxn: number };

type PayoutConfigResponse = {
  config: PayoutConfig;
  /** Bono por Clínicas Activas: se guarda en la misma fila, fuera de `config`. */
  milestones?: MilestonesConfig;
  exists: boolean;
  plans: PayoutPlanRow[];
};

/**
 * Bloque `milestones` de /metrics: cuántos afiliados alcanzan hoy cada escalón
 * del Bono por Clínicas Activas. Se toma DEL CONTRATO del endpoint (no se
 * redeclara) para que un cambio de shape rompa aquí en compilación.
 */
type MilestoneMetrics = AdminAffiliateMetricsResponse["milestones"];

/** Bloque `payout` que /metrics agrega con el estado del motor de comisiones. */
type PayoutMetrics = {
  enabled: boolean;
  mode: ProgramMode;
  committedMonthlyMxn: number;
  committedPctOfMrr: number | null;
  recurringClinics: number;
  onetimeClinics: number;
  onetimePaidClinics: number;
  byKindMxn: { pct: number; recurring: number; onetime: number };
};

/** Campos numéricos del esquema: viven como string (inputs controlados). */
type PayoutNumberKey =
  | "recurringBasicMxn"
  | "recurringProMxn"
  | "recurringClinicMxn"
  | "oneTimeBasicMxn"
  | "oneTimeProMxn"
  | "oneTimeClinicMxn"
  | "startAtInvoiceNo"
  | "oneTimeAtInvoiceNo";

interface PayoutForm {
  defaultMode: ProgramMode;
  defaultPayoutMode: PayoutMode;
  allowAffiliateChoice: boolean;
  recurringBasicMxn: string;
  recurringProMxn: string;
  recurringClinicMxn: string;
  oneTimeBasicMxn: string;
  oneTimeProMxn: string;
  oneTimeClinicMxn: string;
  startAtInvoiceNo: string;
  oneTimeAtInvoiceNo: string;
}

const RECURRING_FIELD: Record<PlanKey, PayoutNumberKey> = {
  BASIC: "recurringBasicMxn",
  PRO: "recurringProMxn",
  CLINIC: "recurringClinicMxn",
};

const ONETIME_FIELD: Record<PlanKey, PayoutNumberKey> = {
  BASIC: "oneTimeBasicMxn",
  PRO: "oneTimeProMxn",
  CLINIC: "oneTimeClinicMxn",
};

// Nombre de respaldo mientras `plans[]` no llega. Es solo el NOMBRE del plan:
// el precio siempre sale del API (si no llegó, se muestra un guion).
const PLAN_FALLBACK_LABELS: Record<PlanKey, string> = {
  BASIC: "Básico",
  PRO: "Profesional",
  CLINIC: "Clínica",
};

const SIM_COUNT_LABELS: Record<PlanKey, string> = {
  BASIC: "Básicos",
  PRO: "Profesionales",
  CLINIC: "Clínicas",
};

const PROGRAM_MODE_LABELS: Record<ProgramMode, string> = {
  fixed: "Montos fijos por plan",
  pct: "% por nivel (bronce/plata/oro)",
};

// Valores iniciales = los DEFAULT del motor (los mismos del DDL), nunca
// inventados aquí. Se reemplazan en cuanto responde el GET.
const DEFAULT_PAYOUT_FORM: PayoutForm = {
  defaultMode: DEFAULT_PAYOUT_CONFIG.defaultMode,
  defaultPayoutMode: DEFAULT_PAYOUT_CONFIG.defaultPayoutMode,
  allowAffiliateChoice: DEFAULT_PAYOUT_CONFIG.allowAffiliateChoice,
  recurringBasicMxn: String(DEFAULT_PAYOUT_CONFIG.recurringBasicMxn),
  recurringProMxn: String(DEFAULT_PAYOUT_CONFIG.recurringProMxn),
  recurringClinicMxn: String(DEFAULT_PAYOUT_CONFIG.recurringClinicMxn),
  oneTimeBasicMxn: String(DEFAULT_PAYOUT_CONFIG.oneTimeBasicMxn),
  oneTimeProMxn: String(DEFAULT_PAYOUT_CONFIG.oneTimeProMxn),
  oneTimeClinicMxn: String(DEFAULT_PAYOUT_CONFIG.oneTimeClinicMxn),
  startAtInvoiceNo: String(DEFAULT_PAYOUT_CONFIG.startAtInvoiceNo),
  oneTimeAtInvoiceNo: String(DEFAULT_PAYOUT_CONFIG.oneTimeAtInvoiceNo),
};

// ── Bono por Clínicas Activas ─────────────────────────────────────────────
// Se guardan en la MISMA fila que el esquema de pago y se mandan en el mismo
// PUT, pero son otra cosa: una promoción que hoy sólo se ANUNCIA. Nada en el
// sistema cuenta clínicas ni paga estos bonos — el seguimiento es manual.

type MilestoneNumberKey =
  | "milestone1Clinics" | "milestone1Mxn"
  | "milestone2Clinics" | "milestone2Mxn"
  | "milestone3Clinics" | "milestone3Mxn";

interface MilestoneForm extends Record<MilestoneNumberKey, string> {
  milestonesEnabled: boolean;
}

const MILESTONE_ROWS: { n: number; clinics: MilestoneNumberKey; mxn: MilestoneNumberKey }[] = [
  { n: 1, clinics: "milestone1Clinics", mxn: "milestone1Mxn" },
  { n: 2, clinics: "milestone2Clinics", mxn: "milestone2Mxn" },
  { n: 3, clinics: "milestone3Clinics", mxn: "milestone3Mxn" },
];

/** Valores iniciales = los DEFAULT del DDL. Se reemplazan con el GET. */
const DEFAULT_MILESTONE_FORM: MilestoneForm = {
  milestonesEnabled: DEFAULT_MILESTONES.milestonesEnabled,
  milestone1Clinics: String(DEFAULT_MILESTONES.milestone1Clinics),
  milestone1Mxn: String(DEFAULT_MILESTONES.milestone1Mxn),
  milestone2Clinics: String(DEFAULT_MILESTONES.milestone2Clinics),
  milestone2Mxn: String(DEFAULT_MILESTONES.milestone2Mxn),
  milestone3Clinics: String(DEFAULT_MILESTONES.milestone3Clinics),
  milestone3Mxn: String(DEFAULT_MILESTONES.milestone3Mxn),
};

/** Config del API → formulario (strings). Tolerante a campos faltantes. */
function toMilestoneForm(cfg: Partial<MilestonesConfig> | null | undefined): MilestoneForm {
  const c = cfg ?? {};
  return {
    milestonesEnabled: c.milestonesEnabled !== false,
    milestone1Clinics: String(c.milestone1Clinics ?? DEFAULT_MILESTONE_FORM.milestone1Clinics),
    milestone1Mxn: String(c.milestone1Mxn ?? DEFAULT_MILESTONE_FORM.milestone1Mxn),
    milestone2Clinics: String(c.milestone2Clinics ?? DEFAULT_MILESTONE_FORM.milestone2Clinics),
    milestone2Mxn: String(c.milestone2Mxn ?? DEFAULT_MILESTONE_FORM.milestone2Mxn),
    milestone3Clinics: String(c.milestone3Clinics ?? DEFAULT_MILESTONE_FORM.milestone3Clinics),
    milestone3Mxn: String(c.milestone3Mxn ?? DEFAULT_MILESTONE_FORM.milestone3Mxn),
  };
}

const DEFAULT_SIM_COUNTS: Record<PlanKey, string> = { BASIC: "10", PRO: "20", CLINIC: "5" };

// Aviso ámbar: mismo look que el de "Niveles y comisiones del programa".
const AMBER_NOTE: CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid rgba(245,158,11,0.35)",
  background: "rgba(245,158,11,0.08)",
  color: "var(--text-2)",
  fontSize: 13,
  lineHeight: 1.5,
};

const SIM_PANEL: CSSProperties = {
  border: "1px solid var(--border-soft)",
  borderRadius: 12,
  padding: "14px 16px",
  background: "var(--surface-2, rgba(255,255,255,0.02))",
};

/** Config del API → formulario (strings). Tolerante a campos faltantes. */
function toPayoutForm(cfg: Partial<PayoutConfig> | null | undefined): PayoutForm {
  const c = cfg ?? {};
  return {
    defaultMode: c.defaultMode === "pct" ? "pct" : "fixed",
    defaultPayoutMode: c.defaultPayoutMode === "onetime" ? "onetime" : "recurring",
    allowAffiliateChoice: c.allowAffiliateChoice !== false,
    recurringBasicMxn: String(c.recurringBasicMxn ?? DEFAULT_PAYOUT_FORM.recurringBasicMxn),
    recurringProMxn: String(c.recurringProMxn ?? DEFAULT_PAYOUT_FORM.recurringProMxn),
    recurringClinicMxn: String(c.recurringClinicMxn ?? DEFAULT_PAYOUT_FORM.recurringClinicMxn),
    oneTimeBasicMxn: String(c.oneTimeBasicMxn ?? DEFAULT_PAYOUT_FORM.oneTimeBasicMxn),
    oneTimeProMxn: String(c.oneTimeProMxn ?? DEFAULT_PAYOUT_FORM.oneTimeProMxn),
    oneTimeClinicMxn: String(c.oneTimeClinicMxn ?? DEFAULT_PAYOUT_FORM.oneTimeClinicMxn),
    startAtInvoiceNo: String(c.startAtInvoiceNo ?? DEFAULT_PAYOUT_FORM.startAtInvoiceNo),
    oneTimeAtInvoiceNo: String(c.oneTimeAtInvoiceNo ?? DEFAULT_PAYOUT_FORM.oneTimeAtInvoiceNo),
  };
}

/** Lee un campo numérico del formulario; lo no finito cuenta como 0. */
function amountOf(form: PayoutForm, key: PayoutNumberKey): number {
  const n = Number(form[key]);
  return Number.isFinite(n) ? n : 0;
}

/** "$90/mes = 13.1% de $689". Sin precio del plan → guion (no se inventa). */
function recurringHint(amountMxn: number, planPriceMxn: number | undefined): string {
  const pct = planPriceMxn ? equivalentPct(amountMxn, planPriceMxn) : null;
  if (pct === null || !planPriceMxn) return `${formatCurrency(amountMxn)}/mes · equivalencia —`;
  return `${formatCurrency(amountMxn)}/mes = ${pct}% de ${formatCurrency(planPriceMxn)}`;
}

/** "$650 = 0.9 meses de $689". Sin precio del plan → guion. */
function onetimeHint(amountMxn: number, planPriceMxn: number | undefined): string {
  const months = planPriceMxn ? paybackMonths(amountMxn, planPriceMxn) : null;
  if (months === null || !planPriceMxn) return `${formatCurrency(amountMxn)} · equivalencia —`;
  return `${formatCurrency(amountMxn)} = ${months} ${months === 1 ? "mes" : "meses"} de ${formatCurrency(planPriceMxn)}`;
}

function pctLabel(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value}%`;
}

function monthsLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value} ${value === 1 ? "mes" : "meses"}`;
}

export function AffiliatesClient({ initial }: { initial: AffiliateRow[] }) {
  const askConfirm = useConfirm();
  const [list, setList] = useState<AffiliateRow[]>(initial);
  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Equipo de vendedores por afiliado (expandible bajo cada fila).
  const [expandedTeam, setExpandedTeam] = useState<string | null>(null);
  const [teamByAffiliate, setTeamByAffiliate] = useState<Record<string, SellerRow[]>>({});
  const [teamLoading, setTeamLoading] = useState<string | null>(null);
  const [busySellerId, setBusySellerId] = useState<string | null>(null);

  // Métricas del programa (A7)
  const [metrics, setMetrics] = useState<AdminAffiliateMetricsResponse | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState(false);

  const loadMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError(false);
    try {
      const res = await fetch("/api/admin/affiliates/metrics");
      if (!res.ok) throw new Error();
      setMetrics(await res.json());
    } catch {
      setMetricsError(true);
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  // Niveles y comisiones del programa (config global, fila id=1).
  const [cfg, setCfg] = useState<Record<ConfigFieldKey, string>>(DEFAULT_CONFIG_FORM);
  const [cfgExists, setCfgExists] = useState(true);
  const [cfgLoading, setCfgLoading] = useState(true);
  const [cfgSaving, setCfgSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/affiliates/config")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (cancelled) return;
        setCfgExists(data?.exists !== false);
        if (data?.config) {
          setCfg({
            bronzePct: String(data.config.bronzePct ?? DEFAULT_CONFIG_FORM.bronzePct),
            silverPct: String(data.config.silverPct ?? DEFAULT_CONFIG_FORM.silverPct),
            goldPct: String(data.config.goldPct ?? DEFAULT_CONFIG_FORM.goldPct),
            silverMinActive: String(data.config.silverMinActive ?? DEFAULT_CONFIG_FORM.silverMinActive),
            goldMinActive: String(data.config.goldMinActive ?? DEFAULT_CONFIG_FORM.goldMinActive),
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCfgLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveConfig() {
    setCfgSaving(true);
    try {
      const res = await fetch("/api/admin/affiliates/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bronzePct: Number(cfg.bronzePct),
          silverPct: Number(cfg.silverPct),
          goldPct: Number(cfg.goldPct),
          silverMinActive: Number(cfg.silverMinActive),
          goldMinActive: Number(cfg.goldMinActive),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "No se pudo guardar la configuración");
      }
      toast.success("Configuración de niveles guardada");
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar la configuración");
    } finally {
      setCfgSaving(false);
    }
  }

  // ── Esquema de pago (motor de comisiones) ──────────────────────────────
  const [payForm, setPayForm] = useState<PayoutForm>(DEFAULT_PAYOUT_FORM);
  const [milForm, setMilForm] = useState<MilestoneForm>(DEFAULT_MILESTONE_FORM);
  const [payPlans, setPayPlans] = useState<PayoutPlanRow[]>([]);
  const [payExists, setPayExists] = useState(true);
  const [payLoading, setPayLoading] = useState(true);
  const [paySaving, setPaySaving] = useState(false);
  const [simCounts, setSimCounts] = useState<Record<PlanKey, string>>(DEFAULT_SIM_COUNTS);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/affiliates/payout-config")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: PayoutConfigResponse) => {
        if (cancelled) return;
        setPayExists(data?.exists !== false);
        setPayPlans(Array.isArray(data?.plans) ? data.plans : []);
        if (data?.config) setPayForm(toPayoutForm(data.config));
        if (data?.milestones) setMilForm(toMilestoneForm(data.milestones));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setPayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Precio vigente de cada plan (plan_configs). Sin entrada = sin precio.
  const planPrices = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of payPlans) {
      const price = Number(p?.priceMxn);
      if (Number.isFinite(price) && price > 0) map[p.id] = price;
    }
    return map;
  }, [payPlans]);

  const planLabels = useMemo(() => {
    const map: Record<string, string> = { ...PLAN_FALLBACK_LABELS };
    for (const p of payPlans) if (p?.label) map[p.id] = p.label;
    return map;
  }, [payPlans]);

  // El formulario visto como PayoutConfig: es lo que alimenta al simulador
  // (así Rafael ve el efecto ANTES de guardar).
  const payFormConfig: PayoutConfig = useMemo(
    () => ({
      defaultMode: payForm.defaultMode,
      defaultPayoutMode: payForm.defaultPayoutMode,
      allowAffiliateChoice: payForm.allowAffiliateChoice,
      recurringBasicMxn: amountOf(payForm, "recurringBasicMxn"),
      recurringProMxn: amountOf(payForm, "recurringProMxn"),
      recurringClinicMxn: amountOf(payForm, "recurringClinicMxn"),
      oneTimeBasicMxn: amountOf(payForm, "oneTimeBasicMxn"),
      oneTimeProMxn: amountOf(payForm, "oneTimeProMxn"),
      oneTimeClinicMxn: amountOf(payForm, "oneTimeClinicMxn"),
      startAtInvoiceNo: amountOf(payForm, "startAtInvoiceNo"),
      oneTimeAtInvoiceNo: amountOf(payForm, "oneTimeAtInvoiceNo"),
    }),
    [payForm]
  );

  // Aviso NO bloqueante: el pago único supera lo que la clínica habrá pagado
  // cuando se dispara. Aproximado porque el primer cobro es promocional.
  const oneTimeWarnings = useMemo(() => {
    const out: string[] = [];
    const at = payFormConfig.oneTimeAtInvoiceNo;
    if (!Number.isFinite(at) || at < 1) return out;
    for (const plan of PLAN_KEYS) {
      const price = planPrices[plan];
      if (!price) continue;
      const amount = amountOf(payForm, ONETIME_FIELD[plan]);
      const billed = price * at;
      if (amount > billed) {
        out.push(
          `Ojo: el pago único de ${planLabels[plan]} (${formatCurrency(amount)}) supera lo cobrado hasta el cobro #${at} (${formatCurrency(billed)} aprox.).`
        );
      }
    }
    return out;
  }, [payForm, payFormConfig, planPrices, planLabels]);

  const simulation = useMemo(() => {
    const counts: Record<PlanKey, number> = { BASIC: 0, PRO: 0, CLINIC: 0 };
    const prices: Record<PlanKey, number> = { BASIC: 0, PRO: 0, CLINIC: 0 };
    for (const plan of PLAN_KEYS) {
      const n = Number(simCounts[plan]);
      counts[plan] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
      prices[plan] = planPrices[plan] ?? 0;
    }
    return simulateProgram(counts, prices, payFormConfig);
  }, [simCounts, planPrices, payFormConfig]);

  // El bloque `payout` de /metrics puede no existir todavía (lo agrega el
  // motor de comisiones): se lee tolerante y solo se pinta si viene.
  const payoutMetrics: PayoutMetrics | null = (metrics as any)?.payout ?? null;

  // Igual de tolerante: un deploy viejo del endpoint no manda `milestones`.
  const milestoneMetrics: MilestoneMetrics | null = (metrics as any)?.milestones ?? null;
  const showMilestoneMetrics =
    !!milestoneMetrics?.enabled && (milestoneMetrics.tiers?.length ?? 0) > 0;

  function setPayNum(key: PayoutNumberKey, value: string) {
    setPayForm((prev) => {
      const next: PayoutForm = { ...prev };
      next[key] = value;
      return next;
    });
  }

  function setMilNum(key: MilestoneNumberKey, value: string) {
    setMilForm((prev) => {
      const next: MilestoneForm = { ...prev };
      next[key] = value;
      return next;
    });
  }

  /** Suma de los tres bonos: son acumulables y así se publican. */
  const milestonesTotal = useMemo(() => {
    let total = 0;
    for (const row of MILESTONE_ROWS) {
      const mxn = Number(milForm[row.mxn]);
      if (Number.isFinite(mxn) && mxn > 0) total += mxn;
    }
    return total;
  }, [milForm]);

  async function savePayoutConfig() {
    // Validación en cliente: al motor de comisiones no le mandamos basura.
    for (const plan of PLAN_KEYS) {
      for (const key of [RECURRING_FIELD[plan], ONETIME_FIELD[plan]]) {
        const n = Number(payForm[key]);
        if (!Number.isFinite(n) || n < 0) {
          toast.error(`El monto de ${planLabels[plan]} debe ser un número mayor o igual a 0.`);
          return;
        }
      }
    }
    const startAt = Number(payForm.startAtInvoiceNo);
    if (!Number.isInteger(startAt) || startAt < 1 || startAt > 12) {
      toast.error('"La comisión empieza en el cobro #" debe ser un entero entre 1 y 12.');
      return;
    }
    const oneTimeAt = Number(payForm.oneTimeAtInvoiceNo);
    if (!Number.isInteger(oneTimeAt) || oneTimeAt < 1 || oneTimeAt > 12) {
      toast.error('"El pago único se entrega desde el cobro #" debe ser un entero entre 1 y 12.');
      return;
    }
    // Bono por clínicas activas: umbrales enteros CRECIENTES y montos ≥ 0. El servidor lo
    // valida igual (y responde 400); aquí se avisa sin gastar el viaje.
    const hitos = MILESTONE_ROWS.map((row) => ({
      n: row.n,
      clinics: Number(milForm[row.clinics]),
      mxn: Number(milForm[row.mxn]),
    }));
    for (const hito of hitos) {
      if (!Number.isInteger(hito.clinics) || hito.clinics < 1) {
        toast.error(`Hito ${hito.n}: las clínicas deben ser un entero mayor o igual a 1.`);
        return;
      }
      if (!Number.isFinite(hito.mxn) || hito.mxn < 0) {
        toast.error(`Hito ${hito.n}: el bono debe ser un número mayor o igual a 0.`);
        return;
      }
    }
    if (!(hitos[0].clinics < hitos[1].clinics && hitos[1].clinics < hitos[2].clinics)) {
      toast.error("Los umbrales de los hitos deben ir en aumento: hito 1 < hito 2 < hito 3.");
      return;
    }
    // Si el pago único cae ANTES del arranque de la comisión, el arranque lo
    // corre en silencio: el valor guardado deja de ser el que manda. Se rechaza
    // para que la pantalla no prometa un cobro que no es el real. El servidor lo
    // valida igual; aquí se avisa sin gastar el viaje.
    if (oneTimeAt < startAt) {
      toast.error(
        "El pago único no se entregaría en ese cobro: debe ser igual o posterior al cobro en el que arranca la comisión.",
      );
      return;
    }

    setPaySaving(true);
    try {
      const res = await fetch("/api/admin/affiliates/payout-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultMode: payForm.defaultMode,
          defaultPayoutMode: payForm.defaultPayoutMode,
          allowAffiliateChoice: payForm.allowAffiliateChoice,
          recurringBasicMxn: Number(payForm.recurringBasicMxn),
          recurringProMxn: Number(payForm.recurringProMxn),
          recurringClinicMxn: Number(payForm.recurringClinicMxn),
          oneTimeBasicMxn: Number(payForm.oneTimeBasicMxn),
          oneTimeProMxn: Number(payForm.oneTimeProMxn),
          oneTimeClinicMxn: Number(payForm.oneTimeClinicMxn),
          startAtInvoiceNo: startAt,
          oneTimeAtInvoiceNo: oneTimeAt,
          milestonesEnabled: milForm.milestonesEnabled,
          milestone1Clinics: hitos[0].clinics,
          milestone1Mxn: hitos[0].mxn,
          milestone2Clinics: hitos[1].clinics,
          milestone2Mxn: hitos[1].mxn,
          milestone3Clinics: hitos[2].clinics,
          milestone3Mxn: hitos[2].mxn,
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error ?? "No se pudo guardar el esquema de pago");
      if (data?.config) setPayForm(toPayoutForm(data.config));
      if (data?.milestones) setMilForm(toMilestoneForm(data.milestones));
      // El mensaje dice explícitamente que la landing pública YA quedó al día:
      // /afiliados es una página cacheada y sin este aviso un guardado correcto
      // parecía fallido al recargarla y ver los montos viejos. `revalidated` lo
      // reporta el endpoint — si la invalidación falló, se avisa en vez de
      // prometer algo que no pasó.
      toast.success(
        data?.revalidated === false
          ? "Esquema de pago guardado. La página pública /afiliados puede tardar hasta 1 minuto en mostrarlo."
          : "Esquema de pago guardado · la página pública /afiliados ya muestra estos montos",
      );
      // El costo comprometido del motor depende de estos montos.
      void loadMetrics();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo guardar el esquema de pago");
    } finally {
      setPaySaving(false);
    }
  }

  const counts = useMemo(() => {
    const c: Record<AffiliateStatus, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
    for (const a of list) c[a.status]++;
    return c;
  }, [list]);

  const visible = useMemo(() => {
    const rows = filter === "ALL" ? list : list.filter((a) => a.status === filter);
    return [...rows].sort((a, b) => {
      if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      return +new Date(b.createdAt) - +new Date(a.createdAt);
    });
  }, [list, filter]);

  async function applyStatus(affiliate: AffiliateRow, target: AssignableStatus) {
    const cfg = ACTION_CONFIG[target];
    const ok = await askConfirm({
      title: cfg.title,
      description: cfg.description,
      variant: cfg.confirmVariant,
      confirmText: cfg.label,
    });
    if (!ok) return;

    setBusyId(affiliate.id);
    try {
      const res = await fetch(`/api/admin/affiliates/${affiliate.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? "No se pudo actualizar");
      }
      const updated = await res.json();
      // El PATCH no devuelve _count; conservamos el de la fila previa.
      setList((prev) =>
        prev.map((x) => (x.id === affiliate.id ? { ...x, ...updated, _count: x._count } : x))
      );
      toast.success(`Afiliado ${STATUS_LABELS[target].toLowerCase()}`);
      // El estado afecta aprobados/inactivos de la sección de métricas.
      void loadMetrics();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo actualizar");
    } finally {
      setBusyId(null);
    }
  }

  async function markPaid(affiliate: AffiliateRow) {
    const ok = await askConfirm({
      title: "¿Marcar comisiones como pagadas?",
      description: `Todas las comisiones pendientes de ${affiliate.name} se marcarán como pagadas y se notificará al afiliado por email.`,
      variant: "warning",
      confirmText: "Marcar pagadas",
    });
    if (!ok) return;

    setBusyId(affiliate.id);
    try {
      const res = await fetch(`/api/admin/affiliates/${affiliate.id}/payouts`, { method: "POST" });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error ?? "No se pudo registrar el pago");
      const paid: number = data?.paid ?? 0;
      if (paid === 0) {
        toast.success("Sin comisiones pendientes");
      } else {
        const monto = formatCurrency(data?.totalMxn ?? 0);
        toast.success(
          paid === 1
            ? `Se liquidó 1 comisión por ${monto}`
            : `Se liquidaron ${paid} comisiones por ${monto}`
        );
      }
      void loadMetrics();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo registrar el pago");
    } finally {
      setBusyId(null);
    }
  }

  // Carga (o recarga) el equipo de vendedores de un afiliado.
  const loadTeam = useCallback(async (affiliateId: string) => {
    setTeamLoading(affiliateId);
    try {
      const res = await fetch(`/api/admin/affiliates/${affiliateId}/sellers`);
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error ?? "No se pudo cargar el equipo");
      setTeamByAffiliate((prev) => ({ ...prev, [affiliateId]: data?.sellers ?? [] }));
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo cargar el equipo");
      setTeamByAffiliate((prev) => ({ ...prev, [affiliateId]: [] }));
    } finally {
      setTeamLoading(null);
    }
  }, []);

  // Abre/cierra el equipo de un afiliado; carga la primera vez que se expande.
  function toggleTeam(affiliateId: string) {
    if (expandedTeam === affiliateId) {
      setExpandedTeam(null);
      return;
    }
    setExpandedTeam(affiliateId);
    if (!teamByAffiliate[affiliateId]) void loadTeam(affiliateId);
  }

  // Marca pagadas las comisiones pendientes de UN vendedor (espejo de markPaid).
  async function markSellerPaid(affiliateId: string, seller: SellerRow) {
    const ok = await askConfirm({
      title: "¿Marcar comisiones del vendedor como pagadas?",
      description: `Todas las comisiones pendientes de ${seller.name} se marcarán como pagadas y se notificará al vendedor por email.`,
      variant: "warning",
      confirmText: "Marcar pagadas",
    });
    if (!ok) return;

    setBusySellerId(seller.id);
    try {
      const res = await fetch(`/api/admin/affiliates/sellers/${seller.id}/payouts`, { method: "POST" });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(data?.error ?? "No se pudo registrar el pago");
      const paid: number = data?.paid ?? 0;
      if (paid === 0) {
        toast.success("Sin comisiones pendientes");
      } else {
        const monto = formatCurrency(data?.totalMxn ?? 0);
        toast.success(
          paid === 1
            ? `Se liquidó 1 comisión por ${monto}`
            : `Se liquidaron ${paid} comisiones por ${monto}`
        );
      }
      // Refresca el equipo (montos) y las métricas del programa.
      void loadTeam(affiliateId);
      void loadMetrics();
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo registrar el pago");
    } finally {
      setBusySellerId(null);
    }
  }

  // Input de monto + su equivalencia viva contra el precio real del plan.
  function renderAmountField(plan: PlanKey, mode: PayoutMode) {
    const key = mode === "onetime" ? ONETIME_FIELD[plan] : RECURRING_FIELD[plan];
    const amount = amountOf(payForm, key);
    const price = planPrices[plan];
    const hint = mode === "onetime" ? onetimeHint(amount, price) : recurringHint(amount, price);
    const id = `payout-${key}`;
    return (
      <div className="field-new" key={key}>
        <label className="field-new__label" htmlFor={id}>{planLabels[plan]}</label>
        <input
          id={id}
          type="number"
          className="input-new"
          min={0}
          step={10}
          value={payForm[key]}
          disabled={payLoading}
          onChange={(e) => setPayNum(key, e.target.value)}
        />
        <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.4 }}>
          {hint}
        </span>
      </div>
    );
  }

  // Un escalón del bono por clínicas activas: umbral + monto + su equivalencia viva.
  // La equivalencia se calcula con los datos REALES que ya están en pantalla
  // (el propio monto y el fijo recurrente del plan más común), igual que las
  // comisiones: aquí no se teclea ningún número.
  function renderMilestoneRow(row: (typeof MILESTONE_ROWS)[number]) {
    const clinics = Number(milForm[row.clinics]);
    const mxn = Number(milForm[row.mxn]);
    const okClinics = Number.isInteger(clinics) && clinics > 0;
    const okMxn = Number.isFinite(mxn) && mxn >= 0;
    const perClinic = okClinics && okMxn ? mxn / clinics : null;
    // Referencia: el fijo recurrente del plan más común (Profesional). Sin él
    // configurado no se inventa nada: se muestra sólo el "por clínica".
    const refRecurring = amountOf(payForm, RECURRING_FIELD.PRO);
    const months = perClinic !== null && refRecurring > 0 ? paybackMonths(perClinic, refRecurring) : null;

    const hint =
      perClinic === null
        ? "equivalencia —"
        : `${formatCurrency(mxn)} ÷ ${clinics} = ${formatCurrency(perClinic)} por clínica` +
          (months === null
            ? ""
            : ` · ${months} ${months === 1 ? "mes" : "meses"} del fijo de ${planLabels.PRO} (${formatCurrency(refRecurring)})`);

    return (
      <div key={row.n} style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr)", gap: 12 }}>
          <div className="field-new">
            <label className="field-new__label" htmlFor={`milestone-${row.n}-clinics`}>
              Hito {row.n} · clínicas activas
            </label>
            <input
              id={`milestone-${row.n}-clinics`}
              type="number"
              className="input-new"
              min={1}
              step={1}
              value={milForm[row.clinics]}
              disabled={payLoading}
              onChange={(e) => setMilNum(row.clinics, e.target.value)}
            />
          </div>
          <div className="field-new">
            <label className="field-new__label" htmlFor={`milestone-${row.n}-mxn`}>
              Bono (MXN, pago único)
            </label>
            <input
              id={`milestone-${row.n}-mxn`}
              type="number"
              className="input-new"
              min={0}
              step={500}
              value={milForm[row.mxn]}
              disabled={payLoading}
              onChange={(e) => setMilNum(row.mxn, e.target.value)}
            />
          </div>
        </div>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.4 }}>
          {hint}
        </span>
      </div>
    );
  }

  // Renglón "etiqueta ····· valor" de las columnas del simulador.
  function renderSimRow(label: string, value: string) {
    return (
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "5px 0" }}>
        <span style={{ fontSize: 12, color: "var(--text-3)" }}>{label}</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap" }}>
          {value}
        </span>
      </div>
    );
  }

  // Panel expandible con el equipo de vendedores de un afiliado.
  function renderTeam(a: AffiliateRow) {
    const loading = teamLoading === a.id;
    const sellers = teamByAffiliate[a.id];

    return (
      <div style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
              Equipo de {a.name}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
              El % es la parte de la comisión del afiliado que se lleva cada vendedor; el resto le queda a
              él como override. No cambia lo que paga DaleControl.
            </div>
          </div>
          <ButtonNew size="sm" variant="ghost" disabled={loading} onClick={() => void loadTeam(a.id)}>
            {loading ? "Cargando…" : "Actualizar"}
          </ButtonNew>
        </div>

        {loading && !sellers ? (
          <div style={{ fontSize: 13, color: "var(--text-3)", padding: "10px 0" }}>Cargando equipo…</div>
        ) : !sellers || sellers.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--text-3)", padding: "10px 0" }}>
            Este afiliado aún no tiene vendedores en su equipo.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table-new">
              <thead>
                <tr>
                  <th>Vendedor</th>
                  <th>Datos de pago</th>
                  <th>% de la comisión</th>
                  <th>Clínicas</th>
                  <th>Pendiente</th>
                  <th>Pagado</th>
                  <th>Estado</th>
                  <th style={{ textAlign: "right" }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((s) => {
                  const busy = busySellerId === s.id;
                  return (
                    <tr key={s.id}>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{s.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-3)" }}>{s.email}</div>
                        {s.phone && (
                          <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{s.phone}</div>
                        )}
                      </td>
                      <td>
                        {s.payoutMethod || s.payoutDetails ? (
                          <>
                            {s.payoutMethod && (
                              <div style={{ fontSize: 12, color: "var(--text-2)" }}>{s.payoutMethod}</div>
                            )}
                            {s.payoutDetails && (
                              <div className="mono" style={{ fontSize: 12, color: "var(--text-1)", wordBreak: "break-all" }}>
                                {s.payoutDetails}
                              </div>
                            )}
                          </>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--text-3)" }}>Sin datos</span>
                        )}
                      </td>
                      <td className="mono" style={{ color: "var(--text-2)", fontSize: 12 }}>{s.commissionPct}%</td>
                      <td className="mono" style={{ color: "var(--text-2)", fontSize: 12 }}>{s.clinics}</td>
                      <td className="mono" style={{ color: "var(--warning)", fontSize: 12 }}>{formatCurrency(s.pendingMxn)}</td>
                      <td className="mono" style={{ color: "var(--text-2)", fontSize: 12 }}>{formatCurrency(s.paidMxn)}</td>
                      <td>
                        <BadgeNew tone={s.isActive ? "success" : "neutral"} dot>
                          {s.isActive ? "Activo" : "Inactivo"}
                        </BadgeNew>
                      </td>
                      <td>
                        <div style={{ display: "flex", justifyContent: "flex-end" }}>
                          <ButtonNew
                            size="sm"
                            variant="ghost"
                            disabled={busy || s.pendingMxn <= 0}
                            onClick={() => markSellerPaid(a.id, s)}
                          >
                            {busy ? "Pagando…" : "Marcar pagado"}
                          </ButtonNew>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 22, letterSpacing: "-0.02em", color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
          Afiliados
        </h1>
        <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
          Revisa las solicitudes del programa de referidos y aprueba, rechaza o suspende cada afiliado.
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 14, marginBottom: 20 }}>
        <KpiCard
          label="En revisión"
          value={String(counts.PENDING)}
          icon={Clock}
          delta={{ value: `${list.length} en total`, direction: counts.PENDING > 0 ? "up" : "down" }}
        />
        <KpiCard
          label="Aprobados"
          value={String(counts.APPROVED)}
          icon={CheckCircle2}
          delta={{ value: "Activos en el programa", direction: "up" }}
        />
        <KpiCard
          label="Suspendidos"
          value={String(counts.SUSPENDED)}
          icon={Ban}
          delta={{ value: "Sin acceso temporal", direction: "down" }}
        />
        <KpiCard
          label="Rechazados"
          value={String(counts.REJECTED)}
          icon={XCircle}
          delta={{ value: "No aprobados", direction: "down" }}
        />
      </div>

      {/* Métricas del programa */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0, letterSpacing: "-0.01em" }}>
            Métricas del programa
          </h2>
          <p style={{ color: "var(--text-3)", fontSize: 12.5, margin: "3px 0 0" }}>
            Funnel global, comisiones y actividad reciente de los afiliados.
          </p>
        </div>

        {metricsError && !metrics ? (
          <CardNew>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--text-3)" }}>No se pudieron cargar las métricas.</span>
              <ButtonNew size="sm" variant="secondary" disabled={metricsLoading} onClick={() => void loadMetrics()}>
                Reintentar
              </ButtonNew>
            </div>
          </CardNew>
        ) : !metrics ? (
          <CardNew>
            <div style={{ fontSize: 13, color: "var(--text-3)", padding: "4px 0" }}>Cargando métricas…</div>
          </CardNew>
        ) : (
          <>
            {/* KPIs del programa */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginBottom: 14 }}>
              <KpiCard
                label="Clicks (30 días)"
                value={String(metrics.program.clicks30d)}
                icon={MousePointerClick}
              />
              <div className="kpi">
                <div className="kpi__top">
                  <span className="kpi__label">Funnel global</span>
                </div>
                <div
                  className="mono"
                  style={{ fontSize: 16, fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  title={`${metrics.program.funnel.clicks} clicks → ${metrics.program.funnel.signups} registros → ${metrics.program.funnel.active} activas → ${metrics.program.funnel.paying} pagando`}
                >
                  {metrics.program.funnel.clicks} → {metrics.program.funnel.signups} → {metrics.program.funnel.active} → {metrics.program.funnel.paying}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6 }}>
                  clicks → registros → activas → pagando
                </div>
              </div>
              <KpiCard
                label="Comisiones pendientes"
                value={formatCurrency(metrics.program.commissionsPendingMxn)}
                icon={Wallet}
              />
              <KpiCard
                label="Comisiones pagadas"
                value={formatCurrency(metrics.program.commissionsPaidMxn)}
                icon={CheckCircle2}
              />
              <KpiCard
                label="Revenue traído"
                value={formatCurrency(metrics.program.revenueBroughtMxn)}
                icon={DollarSign}
              />
              <KpiCard
                label="MRR referido"
                value={formatCurrency(metrics.program.mrrReferredMxn)}
                icon={TrendingUp}
              />
            </div>

            {/* Bono por Clínicas Activas: cuántos afiliados van por cada hito.
                Es la alerta anticipada — un afiliado acercándose al escalón
                mayor es una salida grande que conviene ver venir. El criterio
                es EXACTAMENTE el que ve el afiliado en su panel: clínicas
                activas con las mensualidades pagadas que exigen los términos.
                Apagado el bono (o sin escalones), el bloque no aparece. */}
            {showMilestoneMetrics && (
              <div style={{ marginBottom: 14 }}>
                <CardNew
                  title="Bono por Clínicas Activas"
                  sub={`Afiliados que hoy alcanzan cada hito · cuenta cada clínica activa con al menos ${milestoneMetrics.minPaidInvoices} mensualidades pagadas`}
                >
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 190px), 1fr))",
                      gap: 12,
                    }}
                  >
                    {milestoneMetrics.tiers.map((t, i) => {
                      // El escalón mayor es el último (mismo criterio que la
                      // landing y que el panel): es el único con acento morado.
                      const isTop = i === milestoneMetrics.tiers.length - 1;
                      return (
                        <div
                          key={t.n}
                          style={{
                            padding: "12px 14px",
                            borderRadius: 12,
                            border: isTop ? "1px solid var(--border-brand)" : "1px solid var(--border-soft)",
                            background: isTop ? "var(--brand-soft)" : "var(--bg-elev-2)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ color: isTop ? "var(--violet-400)" : "var(--text-3)", display: "inline-flex" }}>
                              <Trophy size={14} aria-hidden />
                            </span>
                            <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                              {t.clinics} clínicas · {formatCurrency(t.mxn)}
                            </span>
                          </div>
                          <div
                            className="mono"
                            style={{
                              fontSize: 22,
                              fontWeight: 700,
                              letterSpacing: "-0.02em",
                              color: t.affiliates > 0 ? "var(--text-1)" : "var(--text-3)",
                              marginTop: 6,
                            }}
                          >
                            {t.affiliates}
                          </div>
                          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>
                            {t.affiliates === 1 ? "afiliado lo alcanza" : "afiliados lo alcanzan"}
                          </div>
                          <div
                            style={{
                              fontSize: 11.5,
                              color: t.committedMxn > 0 ? "var(--warning)" : "var(--text-3)",
                              marginTop: 8,
                              paddingTop: 8,
                              borderTop: "1px solid var(--border-soft)",
                            }}
                          >
                            Comprometido: <strong>{formatCurrency(t.committedMxn)}</strong>
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
                            {t.approaching === 0
                              ? "Nadie va cerca todavía"
                              : t.approaching === 1
                                ? "1 afiliado va cerca"
                                : `${t.approaching} afiliados van cerca`}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <p style={{ fontSize: 12, color: "var(--text-3)", lineHeight: 1.5, margin: "12px 0 0" }}>
                    Salida total si todos cobraran hoy:{" "}
                    <strong style={{ color: "var(--text-1)" }}>{formatCurrency(milestoneMetrics.committedMxn)}</strong>{" "}
                    · {milestoneMetrics.affiliatesWithQualifying}{" "}
                    {milestoneMetrics.affiliatesWithQualifying === 1
                      ? "afiliado tiene al menos una clínica que califica"
                      : "afiliados tienen al menos una clínica que califica"}
                    {milestoneMetrics.topQualifying > 0 && (
                      <> · el que va adelante lleva {milestoneMetrics.topQualifying}</>
                    )}
                    . El sistema <strong>no paga</strong> estos bonos: solo cuenta el avance, la entrega sigue
                    siendo manual.
                  </p>
                </CardNew>
              </div>
            )}

            {/* Top afiliados + inactivos */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 430px), 1fr))", gap: 14 }}>
              <CardNew noPad title="Top afiliados" sub="Por clínicas pagando y conversión">
                {metrics.top.length === 0 ? (
                  <div style={{ padding: "28px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
                    Aún no hay actividad de afiliados.
                  </div>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="table-new">
                      <thead>
                        <tr>
                          <th>Afiliado</th>
                          <th>Clicks</th>
                          <th>Registros</th>
                          <th>Pagando</th>
                          <th>Conversión</th>
                          <th>Pendiente</th>
                          <th>Pagado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.top.map((r) => (
                          <tr key={r.affiliateId}>
                            <td>
                              <div style={{ fontWeight: 600, color: "var(--text-1)", whiteSpace: "nowrap" }}>{r.name}</div>
                              <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>/socio/{r.slug}</div>
                            </td>
                            <td className="mono" style={{ color: "var(--text-2)" }}>{r.clicks}</td>
                            <td className="mono" style={{ color: "var(--text-2)" }}>{r.signups}</td>
                            <td className="mono" style={{ color: "var(--text-1)", fontWeight: 600 }}>{r.paying}</td>
                            <td className="mono" style={{ color: "var(--text-2)" }}>
                              {r.convPct === null ? "—" : `${r.convPct}%`}
                            </td>
                            <td className="mono" style={{ color: "var(--warning)" }}>{formatCurrency(r.pendingMxn)}</td>
                            <td className="mono" style={{ color: "var(--text-2)" }}>{formatCurrency(r.paidMxn)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardNew>

              <CardNew title="Inactivos (sin clicks en 30 días)">
                {metrics.inactive.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 0" }}>
                    Todos los afiliados aprobados tuvieron actividad reciente. 🎉
                  </div>
                ) : (
                  <div style={{ maxHeight: 320, overflowY: "auto" }}>
                    {metrics.inactive.map((r) => (
                      <div key={r.affiliateId} className="list-row" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, color: "var(--text-1)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.name}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {r.email}
                          </div>
                        </div>
                        <span className="mono" style={{ fontSize: 11, color: "var(--text-3)", whiteSpace: "nowrap" }}>
                          último click: {r.lastClickAt ? formatDate(r.lastClickAt) : "nunca"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardNew>
            </div>
          </>
        )}
      </div>

      {/* Filtros por estado */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n = f.key === "ALL" ? list.length : counts[f.key];
          return (
            <ButtonNew key={f.key} size="sm" variant={active ? "primary" : "ghost"} onClick={() => setFilter(f.key)}>
              {f.label}
              <span style={{ marginLeft: 6, opacity: 0.65 }}>{n}</span>
            </ButtonNew>
          );
        })}
      </div>

      {/* Tabla */}
      <CardNew noPad title={`Afiliados (${visible.length})`}>
        {visible.length === 0 ? (
          <div style={{ padding: "40px 18px", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>
            {filter === "ALL" ? "Aún no hay afiliados registrados." : "No hay afiliados con este estado."}
          </div>
        ) : (
          <table className="table-new">
            <thead>
              <tr>
                <th>Afiliado</th>
                <th>Contacto</th>
                <th>Código</th>
                <th>Comisión</th>
                <th>Clicks</th>
                <th>Clínicas</th>
                <th>Registrado</th>
                <th>Estado</th>
                <th style={{ textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const busy = busyId === a.id;
                const referred = a._count?.clinics ?? 0;
                return (
                  <Fragment key={a.id}>
                  <tr>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--text-1)" }}>{a.name}</div>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>/socio/{a.slug}</div>
                    </td>
                    <td>
                      <div style={{ fontSize: 13, color: "var(--text-2)" }}>{a.email}</div>
                      {a.payoutMethod && (
                        <div style={{ fontSize: 12, color: "var(--text-3)" }}>Pago: {a.payoutMethod}</div>
                      )}
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 12, color: "var(--text-1)", fontWeight: 600 }}>
                        {a.referralCode}
                      </span>
                    </td>
                    <td className="mono" style={{ color: "var(--text-2)", fontSize: 12 }}>
                      {a.effectivePct != null ? (
                        <>
                          {a.effectiveLevelLabel} · {a.effectivePct}%
                          {a.commissionPct !== a.effectivePct && (
                            <div style={{ fontSize: 10, color: "var(--text-3)" }}>legacy {a.commissionPct}%</div>
                          )}
                        </>
                      ) : (
                        <>{a.commissionPct}%</>
                      )}
                    </td>
                    <td className="mono" style={{ color: "var(--text-2)", fontSize: 12 }}>{a.totalClicks ?? 0}</td>
                    <td className="mono" style={{ color: "var(--text-2)", fontSize: 12 }}>{referred}</td>
                    <td className="mono" style={{ color: "var(--text-3)", fontSize: 12 }}>
                      {formatRelativeDate(a.createdAt)}
                    </td>
                    <td>
                      <BadgeNew tone={STATUS_TONE[a.status]} dot>
                        {STATUS_LABELS[a.status]}
                      </BadgeNew>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {ACTIONS[a.status].map((target) => {
                          const cfg = ACTION_CONFIG[target];
                          return (
                            <ButtonNew
                              key={target}
                              size="sm"
                              variant={cfg.btn}
                              disabled={busy}
                              onClick={() => applyStatus(a, target)}
                            >
                              {cfg.label}
                            </ButtonNew>
                          );
                        })}
                        <ButtonNew size="sm" variant="ghost" disabled={busy} onClick={() => markPaid(a)}>
                          Marcar pagadas
                        </ButtonNew>
                        <ButtonNew
                          size="sm"
                          variant={expandedTeam === a.id ? "secondary" : "ghost"}
                          onClick={() => toggleTeam(a.id)}
                        >
                          {expandedTeam === a.id ? "Ocultar equipo" : "Ver equipo"}
                        </ButtonNew>
                        {/* Ficha completa del afiliado (clínicas, comisiones, modalidad). */}
                        <Link
                          href={`/admin/affiliates/${a.id}`}
                          className="btn-new btn-new--secondary btn-new--sm"
                          style={{ textDecoration: "none" }}
                        >
                          Ver ficha
                        </Link>
                      </div>
                    </td>
                  </tr>
                  {expandedTeam === a.id && (
                    <tr>
                      <td colSpan={9} style={{ padding: 0, background: "var(--surface-2, rgba(255,255,255,0.02))" }}>
                        {renderTeam(a)}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </CardNew>

      {/* Niveles y comisiones del programa */}
      <div style={{ marginTop: 20 }}>
        <CardNew
          title="Niveles y comisiones del programa"
          sub="Bronce, Plata y Oro según las clínicas referidas con suscripción activa."
        >
          {!cfgLoading && !cfgExists && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 12,
                border: "1px solid rgba(245,158,11,0.35)",
                background: "rgba(245,158,11,0.08)",
                color: "var(--text-2)",
                fontSize: 13,
                lineHeight: 1.5,
                marginBottom: 14,
              }}
            >
              Niveles inactivos: corre <span className="mono">sql/afiliados-ventas.sql</span> en Supabase.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
            {CONFIG_FIELDS.map((f) => (
              <div className="field-new" key={f.key}>
                <label className="field-new__label" htmlFor={`cfg-${f.key}`}>{f.label}</label>
                <input
                  id={`cfg-${f.key}`}
                  type="number"
                  className="input-new"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={cfg[f.key]}
                  disabled={cfgLoading}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCfg((prev) => ({ ...prev, [f.key]: v }));
                  }}
                />
              </div>
            ))}
          </div>

          <p style={{ color: "var(--text-3)", fontSize: 12, lineHeight: 1.5, margin: "12px 0 0" }}>
            El % del nivel se aplica a las comisiones NUEVAS (no retroactivo). Nivel por clínicas referidas con
            suscripción activa.
          </p>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
            <ButtonNew
              variant="primary"
              disabled={!cfgExists || cfgLoading || cfgSaving}
              onClick={saveConfig}
            >
              {cfgSaving ? "Guardando…" : "Guardar"}
            </ButtonNew>
          </div>
        </CardNew>
      </div>

      {/* Esquema de pago (motor de comisiones) */}
      <div style={{ marginTop: 20 }}>
        <CardNew
          title="Esquema de pago"
          sub="Cuánto gana el afiliado por cada clínica: un fijo cada mes mientras pague, o un solo pago."
        >
          {!payLoading && !payExists && (
            <div style={{ ...AMBER_NOTE, marginBottom: 14 }}>
              Esquema de pago inactivo: corre <span className="mono">sql/afiliados-comisiones.sql</span> en Supabase.
            </div>
          )}

          {/* Estado del motor con las clínicas que ya están corriendo */}
          {payoutMetrics?.enabled && (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
                  gap: 14,
                  marginBottom: 12,
                }}
              >
                <KpiCard
                  label="Costo mensual comprometido"
                  value={formatCurrency(payoutMetrics.committedMonthlyMxn ?? 0)}
                  icon={Coins}
                />
                <KpiCard
                  label="% del MRR referido"
                  value={
                    payoutMetrics.committedPctOfMrr == null
                      ? "—"
                      : `${Number(payoutMetrics.committedPctOfMrr).toFixed(1)}%`
                  }
                  icon={Percent}
                />
                <div className="kpi">
                  <div className="kpi__top">
                    <span className="kpi__label">Clínicas por modalidad</span>
                    <div className="kpi__icon">
                      <Repeat size={17} strokeWidth={1.75} />
                    </div>
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: "var(--text-1)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={`${payoutMetrics.recurringClinics ?? 0} en fijo recurrente · ${payoutMetrics.onetimeClinics ?? 0} en pago único · ${payoutMetrics.onetimePaidClinics ?? 0} con el pago único ya entregado`}
                  >
                    {payoutMetrics.recurringClinics ?? 0} / {payoutMetrics.onetimeClinics ?? 0} /{" "}
                    {payoutMetrics.onetimePaidClinics ?? 0}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 6 }}>
                    recurrente / único / único ya pagado
                  </div>
                </div>
              </div>

              {payoutMetrics.byKindMxn && (
                <p style={{ color: "var(--text-3)", fontSize: 12, lineHeight: 1.5, margin: "0 0 16px" }}>
                  Comisiones generadas por tipo: % del nivel{" "}
                  {formatCurrency(payoutMetrics.byKindMxn.pct ?? 0)} · fijo recurrente{" "}
                  {formatCurrency(payoutMetrics.byKindMxn.recurring ?? 0)} · pago único{" "}
                  {formatCurrency(payoutMetrics.byKindMxn.onetime ?? 0)}.
                </p>
              )}
            </>
          )}

          {/* Montos por plan. La equivalencia sale del precio REAL del plan. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
              gap: 20,
            }}
          >
            <div>
              <div className="form-section__title">
                Fijo recurrente (MXN por mes)
                <span className="form-section__rule" />
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {PLAN_KEYS.map((plan) => renderAmountField(plan, "recurring"))}
              </div>
            </div>
            <div>
              <div className="form-section__title">
                Pago único (MXN, una sola vez)
                <span className="form-section__rule" />
              </div>
              <div style={{ display: "grid", gap: 12 }}>
                {PLAN_KEYS.map((plan) => renderAmountField(plan, "onetime"))}
              </div>
            </div>
          </div>

          {/* Aviso NO bloqueante: se puede guardar igual. */}
          {oneTimeWarnings.length > 0 && (
            <div style={{ ...AMBER_NOTE, marginTop: 14 }}>
              {oneTimeWarnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}

          {/* Reglas del programa */}
          <div style={{ marginTop: 22 }}>
            <div className="form-section__title">
              Reglas del programa
              <span className="form-section__rule" />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))",
                gap: 12,
              }}
            >
              <div className="field-new">
                <label className="field-new__label" htmlFor="payout-default-mode">
                  Cómo paga el programa
                </label>
                <select
                  id="payout-default-mode"
                  className="input-new"
                  value={payForm.defaultMode}
                  disabled={payLoading}
                  onChange={(e) =>
                    setPayForm((prev) => ({
                      ...prev,
                      defaultMode: e.target.value === "pct" ? "pct" : "fixed",
                    }))
                  }
                >
                  <option value="fixed">{PROGRAM_MODE_LABELS.fixed}</option>
                  <option value="pct">{PROGRAM_MODE_LABELS.pct}</option>
                </select>
              </div>

              <div className="field-new">
                <label className="field-new__label" htmlFor="payout-default-payout-mode">
                  Modalidad por defecto
                </label>
                <select
                  id="payout-default-payout-mode"
                  className="input-new"
                  value={payForm.defaultPayoutMode}
                  disabled={payLoading}
                  onChange={(e) =>
                    setPayForm((prev) => ({
                      ...prev,
                      defaultPayoutMode: e.target.value === "onetime" ? "onetime" : "recurring",
                    }))
                  }
                >
                  <option value="recurring">{PAYOUT_MODE_LABELS.recurring}</option>
                  <option value="onetime">{PAYOUT_MODE_LABELS.onetime}</option>
                </select>
              </div>

              <div className="field-new">
                <label className="field-new__label" htmlFor="payout-start-at">
                  La comisión empieza en el cobro #
                </label>
                <input
                  id="payout-start-at"
                  type="number"
                  className="input-new"
                  min={1}
                  max={12}
                  step={1}
                  value={payForm.startAtInvoiceNo}
                  disabled={payLoading}
                  onChange={(e) => setPayNum("startAtInvoiceNo", e.target.value)}
                />
                <span style={{ display: "block", fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.5, marginTop: 6 }}>
                  Solo aplica a las facturas de un mes. Las <strong>anuales</strong> se cobran a precio
                  completo (no llevan mes promocional), así que comisionan desde la primera: 12 meses
                  del fijo de golpe, o el pago único de inmediato.
                </span>
              </div>

              <div className="field-new">
                <label className="field-new__label" htmlFor="payout-onetime-at">
                  El pago único se entrega desde el cobro #
                </label>
                <input
                  id="payout-onetime-at"
                  type="number"
                  className="input-new"
                  min={1}
                  max={12}
                  step={1}
                  value={payForm.oneTimeAtInvoiceNo}
                  disabled={payLoading}
                  onChange={(e) => setPayNum("oneTimeAtInvoiceNo", e.target.value)}
                />
                <span style={{ display: "block", fontSize: 11.5, color: "var(--text-4)", lineHeight: 1.5, marginTop: 6 }}>
                  Es un piso, no una cita exacta: si la clínica no pasa por ese cobro, el pago único se
                  entrega en el siguiente y no se pierde. Sigue siendo uno solo por clínica.
                </span>
              </div>
            </div>

            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--text-2)",
                marginTop: 14,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={payForm.allowAffiliateChoice}
                disabled={payLoading}
                onChange={(e) =>
                  setPayForm((prev) => ({ ...prev, allowAffiliateChoice: e.target.checked }))
                }
                style={{ width: 15, height: 15, accentColor: "var(--brand)" }}
              />
              El afiliado puede elegir su modalidad desde su panel
            </label>

            <p style={{ color: "var(--text-3)", fontSize: 12, lineHeight: 1.5, margin: "12px 0 0" }}>
              El primer cobro MENSUAL de la clínica es el mes promocional, por eso el default es 2: la comisión
              arranca hasta el segundo cobro y el pago único se entrega ahí mismo. Las ventas ANUALES quedan fuera de
              esa espera (se cobran completas desde el día uno) y comisionan en su primera factura. La modalidad se
              congela por clínica cuando se da de alta, así que cambiarla solo afecta a las clínicas nuevas.
            </p>

            {/* Bono por Clínicas Activas: se anuncia en /afiliados con ESTE
                mismo nombre, y NADIE lo calcula todavía. */}
            <div style={{ marginTop: 22 }}>
              <div className="form-section__title">
                Bono por Clínicas Activas
                <span className="form-section__rule" />
              </div>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: "var(--text-2)",
                  marginBottom: 14,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={milForm.milestonesEnabled}
                  disabled={payLoading}
                  onChange={(e) =>
                    setMilForm((prev) => ({ ...prev, milestonesEnabled: e.target.checked }))
                  }
                  style={{ width: 15, height: 15, accentColor: "var(--brand)" }}
                />
                Anunciar el bono por clínicas activas en la página pública
              </label>

              <div
                style={{
                  display: "grid",
                  gap: 14,
                  // Apagados siguen siendo editables (se pueden dejar listos
                  // antes de encender la promoción), pero se ven apagados.
                  opacity: milForm.milestonesEnabled ? 1 : 0.55,
                }}
              >
                {MILESTONE_ROWS.map((row) => renderMilestoneRow(row))}
              </div>

              <p style={{ color: "var(--text-3)", fontSize: 12, lineHeight: 1.5, margin: "12px 0 0" }}>
                Son <strong>acumulables</strong>: quien llega al último habrá cobrado los tres,{" "}
                <strong>{formatCurrency(milestonesTotal)}</strong> en total. Se suman al fijo recurrente,
                no lo reemplazan. Los umbrales tienen que ir en aumento (1 &lt; 2 &lt; 3).{" "}
                <strong>El sistema no los calcula ni los paga</strong>: no hay contador de hitos ni
                registro de bonos entregados, el seguimiento es manual. Con el interruptor apagado el
                bloque desaparece de <span className="mono">/afiliados</span> y de{" "}
                <span className="mono">/terminos-afiliados</span>.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <ButtonNew
              variant="primary"
              disabled={!payExists || payLoading || paySaving}
              onClick={savePayoutConfig}
            >
              {paySaving ? "Guardando…" : "Guardar esquema"}
            </ButtonNew>
          </div>
        </CardNew>
      </div>

      {/* Simulador: usa los montos del formulario, no los guardados */}
      <div style={{ marginTop: 14 }}>
        <CardNew
          title="Simulador del esquema"
          sub="Con los montos que estás editando arriba (aunque todavía no los guardes)."
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
              gap: 12,
            }}
          >
            {PLAN_KEYS.map((plan) => {
              const price = planPrices[plan];
              return (
                <div className="field-new" key={plan}>
                  <label className="field-new__label" htmlFor={`sim-${plan}`}>
                    {SIM_COUNT_LABELS[plan]}
                  </label>
                  <input
                    id={`sim-${plan}`}
                    type="number"
                    className="input-new"
                    min={0}
                    step={1}
                    value={simCounts[plan]}
                    onChange={(e) => {
                      const v = e.target.value;
                      setSimCounts((prev) => ({ ...prev, [plan]: v }));
                    }}
                  />
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                    {planLabels[plan]} · {price ? `${formatCurrency(price)}/mes` : "—"}
                  </span>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))",
              gap: 14,
              marginTop: 18,
            }}
          >
            <div style={SIM_PANEL}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)", marginBottom: 6 }}>
                {simulation.clinics === 1 ? "1 clínica genera" : `${simulation.clinics} clínicas generan`}
              </div>
              {renderSimRow("Ingreso mensual", formatCurrency(simulation.revenueMonthlyMxn))}
              {renderSimRow("Ingreso del primer año", formatCurrency(simulation.revenueYearlyMxn))}
              <p style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5, margin: "8px 0 0" }}>
                Con los precios vigentes de cada plan.
              </p>
            </div>

            <div style={SIM_PANEL}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                  {PAYOUT_MODE_LABELS.recurring}
                </span>
                {payForm.defaultPayoutMode === "recurring" && <BadgeNew tone="brand">Por defecto</BadgeNew>}
              </div>
              {renderSimRow("Pagas al mes", formatCurrency(simulation.recurring.costMxn))}
              {renderSimRow("% del ingreso mensual", pctLabel(simulation.recurring.effectivePct))}
              <p style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5, margin: "8px 0 0" }}>
                Costo continuo: se paga mes con mes mientras la clínica siga pagando.
              </p>
            </div>

            <div style={SIM_PANEL}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>
                  {PAYOUT_MODE_LABELS.onetime}
                </span>
                {payForm.defaultPayoutMode === "onetime" && <BadgeNew tone="brand">Por defecto</BadgeNew>}
              </div>
              {renderSimRow("Pagas una vez", formatCurrency(simulation.onetime.costMxn))}
              {renderSimRow("% del ingreso del primer año", pctLabel(simulation.onetime.effectivePct))}
              {renderSimRow("Se recupera en", monthsLabel(simulation.onetime.paybackMonths))}
              <p style={{ fontSize: 11, color: "var(--text-3)", lineHeight: 1.5, margin: "8px 0 0" }}>
                Meses de ingreso de esas mismas clínicas que cuesta el pago único.
              </p>
            </div>
          </div>
        </CardNew>
      </div>
    </div>
  );
}
