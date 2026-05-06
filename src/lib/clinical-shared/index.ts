/**
 * Barrel — clinical-shared (cross-cutting features).
 *
 * Solo re-exporta archivos puros de tipos/helpers; los archivos `*.actions.ts`
 * con server actions deben importarse directamente desde su path completo
 * (regla del proyecto: barrels NO re-exportan archivos `"use server"`).
 */
export * from "./types";
export * from "./photo-gallery";
export * from "./evolution-templates";
export * from "./referral-letters";
export * from "./lab-orders";
export * from "./treatment-link";
export * from "./share-tokens";
export * from "./reminder-rules";
