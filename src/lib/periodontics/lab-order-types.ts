// Periodontics — taxonomía de órdenes de laboratorio perio. SPEC §8, COMMIT 5.

import { z } from "zod";
import type { LabOrderType } from "@prisma/client";

/** Slugs públicos perio (estables). */
export const PERIO_LAB_ORDER_KIND = [
  "ferulizacion",
  "injerto_personalizado",
  "planchas_mantenimiento",
] as const;

export type PerioLabOrderKind = (typeof PERIO_LAB_ORDER_KIND)[number];

/** Mapeo a valor del enum schema (añadidos en migración 20260505160000). */
export const PERIO_LAB_ORDER_TYPE_TO_SCHEMA: Record<PerioLabOrderKind, LabOrderType> = {
  ferulizacion: "perio_splint",
  injerto_personalizado: "perio_custom_graft",
  planchas_mantenimiento: "perio_maintenance_tray",
};

export const PERIO_LAB_ORDER_LABEL: Record<PerioLabOrderKind, string> = {
  ferulizacion: "Ferulización periodontal",
  injerto_personalizado: "Injerto personalizado",
  planchas_mantenimiento: "Planchas de mantenimiento",
};

// ─────────────────────────────────────────────────────────────────────
// Schemas zod por subtype — guardados en LabOrder.spec (Json)
// ─────────────────────────────────────────────────────────────────────

const fdiSchema = z
  .number()
  .int()
  .refine(
    (n) =>
      (n >= 11 && n <= 18) ||
      (n >= 21 && n <= 28) ||
      (n >= 31 && n <= 38) ||
      (n >= 41 && n <= 48),
    "FDI inválido (11-48)",
  );

/**
 * Ferulización: alambre o fibra unida con composite. Indicar dientes a
 * ferulizar y técnica para que el laboratorio prepare el diseño/imagen
 * digital o la matriz si aplica.
 */
export const SplintSpecSchema = z.object({
  technique: z.enum(["alambre_composite", "fibra_vidrio_composite", "metal_colado"]),
  teethFdi: z.array(fdiSchema).min(2, "Mínimo 2 dientes").max(8),
  surfaces: z.enum(["lingual", "vestibular", "ambas"]).default("lingual"),
  shadeGuide: z.string().max(8).optional(),
  scanFileUrl: z.string().url().max(2048).optional(),
  notes: z.string().max(500).optional(),
});

/**
 * Injerto personalizado: alograft/xenograft moldeado a forma del defecto.
 * El laboratorio recibe modelo digital o impresión y molde el bloque a
 * medida. Para autoinjertos NO se usa esta orden (se obtiene en quirófano).
 */
export const CustomGraftSpecSchema = z.object({
  graftType: z.enum(["allograft", "xenograft", "synthetic"]),
  defectMorphology: z.enum(["1_pared", "2_paredes", "3_paredes", "circunferencial", "horizontal"]),
  receiverSiteFdi: fdiSchema,
  approxVolumeMm3: z.number().positive().max(2000).optional(),
  membraneRequired: z.boolean().default(false),
  membraneType: z.enum(["colageno_reabsorbible", "ptfe_no_reabsorbible"]).optional(),
  scanFileUrl: z.string().url().max(2048).optional(),
  notes: z.string().max(500).optional(),
});

/**
 * Planchas de mantenimiento: cubetas blandas para auto-aplicación de gel
 * (clorhexidina 0.2%, fluoruro 1.1% o tetraciclina). Pacientes con perio
 * crónica en mantenimiento las usan 5-10 minutos diarios.
 */
export const MaintenanceTraySpecSchema = z.object({
  arch: z.enum(["superior", "inferior", "ambas"]),
  impressionType: z.enum(["digital_scan", "silicona", "alginato"]),
  thicknessMm: z.number().min(0.5).max(3).default(1.5),
  reservoir: z.enum(["sin_reservorio", "fluoruro", "clorhexidina", "tetraciclina"]),
  scanFileUrl: z.string().url().max(2048).optional(),
  notes: z.string().max(500).optional(),
});

export type SplintSpec = z.infer<typeof SplintSpecSchema>;
export type CustomGraftSpec = z.infer<typeof CustomGraftSpecSchema>;
export type MaintenanceTraySpec = z.infer<typeof MaintenanceTraySpecSchema>;

/** Selecciona el schema correcto según el slug. */
export function getPerioLabSpecSchema(kind: PerioLabOrderKind) {
  switch (kind) {
    case "ferulizacion":
      return SplintSpecSchema;
    case "injerto_personalizado":
      return CustomGraftSpecSchema;
    case "planchas_mantenimiento":
      return MaintenanceTraySpecSchema;
  }
}

/**
 * Resumen de una línea de la orden para UI (lista de órdenes pendientes).
 */
export function summarizePerioLabSpec(
  kind: PerioLabOrderKind,
  spec: unknown,
): string {
  const parsed = getPerioLabSpecSchema(kind).safeParse(spec);
  if (!parsed.success) return "Spec inválido";
  const data: SplintSpec | CustomGraftSpec | MaintenanceTraySpec = parsed.data;
  switch (kind) {
    case "ferulizacion": {
      const s = data as SplintSpec;
      return `${s.technique.replaceAll("_", " ")} · ${s.teethFdi.length} dientes (${s.teethFdi.join("-")})`;
    }
    case "injerto_personalizado": {
      const s = data as CustomGraftSpec;
      return `${s.graftType} · defecto ${s.defectMorphology.replaceAll("_", " ")} · D${s.receiverSiteFdi}`;
    }
    case "planchas_mantenimiento": {
      const s = data as MaintenanceTraySpec;
      return `${s.arch} · ${s.thicknessMm}mm · ${s.reservoir.replaceAll("_", " ")}`;
    }
  }
}
