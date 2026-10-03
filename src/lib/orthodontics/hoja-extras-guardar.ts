// Ortodoncia — guardar con la hoja de control lo nuevo de ws1-t9 (M1 arco inferior, M2 ligas). Lo llaman
// saveTreatmentCardDraft y signTreatmentCard DESPUÉS de su transacción, igual que las columnas de la Ola 1: si falta el
// SQL o algo falla, la hoja (y su firma) ya quedaron; solo se pierde esto y se dice en el log.

import { z } from "zod";
import { idDeLaBase } from "@/lib/validation/id";
import { escribirArcoInferior, escribirLigasDeHoja, ligarMecanicasALaHoja } from "./hoja-extras-db";
import { LIGAS_MAXIMAS_POR_HOJA } from "./hoja-extras";

export const extrasDeHojaSchema = z
  .object({
    /** Solo cuando la hoja tiene los dos selectores. `undefined` = no se toca. */
    wireToLowerId: idDeLaBase().nullable().optional(),
    /** `undefined` = no se tocan las ligas guardadas. */
    ligas: z
      .array(
        z.object({
          tipo: z.string().min(1).max(80),
          color: z.string().max(80).nullable().optional(),
          arcada: z.enum(["SUPERIOR", "INFERIOR", "AMBAS"]),
          cambiadasHoy: z.boolean(),
        }),
      )
      .max(LIGAS_MAXIMAS_POR_HOJA)
      .optional(),
    /**
     * Las mecánicas que se colocaron / retiraron desde esta hoja ANTES de que tuviera id (hoja nueva sin guardar): al
     * guardarla quedan ligadas a ella. Solo se ligan las del mismo caso y clínica que aún no tenían hoja.
     */
    mecanicas: z
      .object({ altas: z.array(z.string().uuid()).max(50), retiros: z.array(z.string().uuid()).max(50) })
      .optional(),
  })
  .optional();

export type ExtrasDeHojaInput = z.infer<typeof extrasDeHojaSchema>;

export async function guardarExtrasDeLaHoja(args: {
  clinicId: string;
  patientId: string;
  planId: string;
  cardId: string;
  extras: ExtrasDeHojaInput;
}): Promise<void> {
  const e = args.extras;
  if (!e) return;
  try {
    if (e.wireToLowerId !== undefined) {
      await escribirArcoInferior({ clinicId: args.clinicId, planId: args.planId, cardId: args.cardId, wireToLowerId: e.wireToLowerId });
    }
    if (e.ligas !== undefined) {
      await escribirLigasDeHoja({ clinicId: args.clinicId, patientId: args.patientId, planId: args.planId, cardId: args.cardId, ligas: e.ligas });
    }
    const altas = e.mecanicas?.altas ?? [];
    const retiros = e.mecanicas?.retiros ?? [];
    if (altas.length > 0 || retiros.length > 0) {
      await ligarMecanicasALaHoja({ clinicId: args.clinicId, planId: args.planId, cardId: args.cardId, altas, retiros });
    }
  } catch (err) {
    console.warn("[ortho] hoja de control: no se guardaron el arco inferior o las ligas (la hoja sí):", err);
  }
}
