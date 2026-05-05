// Specialties — registro central de las keys del marketplace.
// Cada módulo expone su propia key como const aislada para evitar
// dependencias circulares; este archivo agrupa para imports cómodos.

export { PEDIATRICS_MODULE_KEY } from "@/lib/pediatrics/permissions";

/**
 * Key registrada en `modules.key` del marketplace para Endodoncia.
 * Coincide con prisma/seed.ts (SEED_MODULES). Antes estaba re-exportada
 * desde `@/app/actions/endodontics` pero eso forzaba el re-export de
 * `_helpers.ts` en el barrel de endo, que rompe el bundle del cliente
 * (lección Periodoncia commit 05bf50e). Movido aquí 2026-05-05.
 */
export const ENDODONTICS_MODULE_KEY = "endodontics" as const;

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
