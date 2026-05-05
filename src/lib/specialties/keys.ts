// Specialties — registro central de las keys del marketplace.
// Cada módulo expone su propia key como const aislada para evitar
// dependencias circulares; este archivo agrupa para imports cómodos.

export { PEDIATRICS_MODULE_KEY } from "@/lib/pediatrics/permissions";
export { ENDODONTICS_MODULE_KEY } from "@/app/actions/endodontics";

/**
 * Key registrada en `modules.key` del marketplace para Periodoncia.
 * Coincide con prisma/seed.ts (SEED_MODULES). SPEC §2 constante.
 */
export const PERIODONTICS_MODULE_KEY = "periodontics" as const;

/**
 * Key registrada en `modules.key` del marketplace para Ortodoncia.
 * Pricing $329 MXN/mes (tier intermedio: Perio $279 < Orto $329 < Implant $349).
 * Coincide con prisma/seed.ts (SEED_MODULES). SPEC §1.15.
 */
export const ORTHODONTICS_MODULE_KEY = "orthodontics" as const;
