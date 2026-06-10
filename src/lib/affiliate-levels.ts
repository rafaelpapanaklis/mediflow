// Niveles bronce/plata/oro del programa de afiliados.
// El % de comisión por nivel vive en AffiliateProgramConfig (fila id=1,
// editable en /admin/affiliates). Si la tabla aún NO existe en la BD
// (sql/afiliados-ventas.sql sin correr), getProgramConfig() devuelve null y
// el caller debe caer a modo legacy (Affiliate.commissionPct) sin romper.
// El % del nivel se usa al GENERARSE la comisión (no retroactivo).
import { prisma } from "@/lib/prisma";

export type AffiliateLevel = "bronze" | "silver" | "gold";

export type ProgramConfig = {
  bronzePct: number;
  silverPct: number;
  goldPct: number;
  silverMinActive: number;
  goldMinActive: number;
};

export const DEFAULT_PROGRAM_CONFIG: ProgramConfig = {
  bronzePct: 10,
  silverPct: 12,
  goldPct: 15,
  silverMinActive: 3,
  goldMinActive: 10,
};

export const LEVEL_LABELS: Record<AffiliateLevel, string> = {
  bronze: "Bronce",
  silver: "Plata",
  gold: "Oro",
};

export type LevelInfo = {
  legacy: boolean; // true = tabla de config inexistente → pct viene de Affiliate.commissionPct
  level: AffiliateLevel;
  pct: number; // % de comisión vigente
  activeCount: number; // clínicas referidas ACTIVAS (subscriptionStatus "active")
  nextLevel: AffiliateLevel | null;
  nextPct: number | null;
  nextThreshold: number | null; // clínicas activas necesarias para el siguiente nivel
  missing: number | null; // cuántas le faltan
};

// Devuelve la fila id=1 de affiliateProgramConfig (o DEFAULT_PROGRAM_CONFIG
// si la fila no existe pero la tabla sí). Si la TABLA no existe
// (P2021 / cualquier throw), devuelve null (modo legacy).
export async function getProgramConfig(): Promise<ProgramConfig | null> {
  try {
    const row = await prisma.affiliateProgramConfig.findUnique({ where: { id: 1 } });
    if (!row) return DEFAULT_PROGRAM_CONFIG;
    return {
      bronzePct: row.bronzePct,
      silverPct: row.silverPct,
      goldPct: row.goldPct,
      silverMinActive: row.silverMinActive,
      goldMinActive: row.goldMinActive,
    };
  } catch {
    // Tabla inexistente (sql/afiliados-ventas.sql sin correr) u otro error.
    return null;
  }
}

// bronce < silverMinActive ≤ plata < goldMinActive ≤ oro.
export function computeLevel(activeCount: number, cfg: ProgramConfig): AffiliateLevel {
  if (activeCount >= cfg.goldMinActive) return "gold";
  if (activeCount >= cfg.silverMinActive) return "silver";
  return "bronze";
}

export function levelPct(level: AffiliateLevel, cfg: ProgramConfig): number {
  return level === "gold" ? cfg.goldPct : level === "silver" ? cfg.silverPct : cfg.bronzePct;
}

// Clínicas referidas con suscripción ACTIVA. "active" es el valor exacto que
// escribe el webhook de Stripe al activarse (checkout.session.completed y
// sub.status de customer.subscription.*). Nunca lanza: en error devuelve 0.
export async function countActiveReferred(affiliateId: string): Promise<number> {
  try {
    return await prisma.clinic.count({
      where: { affiliateId, subscriptionStatus: "active" },
    });
  } catch {
    return 0;
  }
}

// Combina lo anterior. Si getProgramConfig() === null → legacy (pct fijo de
// Affiliate.commissionPct, sin barra de progreso). Si hay config → nivel +
// pct del nivel + datos del siguiente nivel (gold → next null).
export async function getAffiliateLevelInfo(
  affiliateId: string,
  legacyPct: number,
): Promise<LevelInfo> {
  const [config, activeCount] = await Promise.all([
    getProgramConfig(),
    countActiveReferred(affiliateId),
  ]);

  if (!config) {
    return {
      legacy: true,
      level: "bronze",
      pct: legacyPct,
      activeCount,
      nextLevel: null,
      nextPct: null,
      nextThreshold: null,
      missing: null,
    };
  }

  const level = computeLevel(activeCount, config);
  const pct = levelPct(level, config);

  if (level === "gold") {
    return {
      legacy: false,
      level,
      pct,
      activeCount,
      nextLevel: null,
      nextPct: null,
      nextThreshold: null,
      missing: null,
    };
  }

  const nextLevel: AffiliateLevel = level === "bronze" ? "silver" : "gold";
  const nextThreshold = nextLevel === "silver" ? config.silverMinActive : config.goldMinActive;
  return {
    legacy: false,
    level,
    pct,
    activeCount,
    nextLevel,
    nextPct: levelPct(nextLevel, config),
    nextThreshold,
    missing: Math.max(0, nextThreshold - activeCount),
  };
}
