import "server-only";
import { prisma } from "@/lib/prisma";
import { crearInterruptor, FLAG_MENU_DOS_NIVELES } from "./interruptor-core";

/**
 * ¿La clínica activa ve el rediseño (menú de dos niveles)? El `clinicId` sale
 * SIEMPRE de la sesión (el layout se lo pasa desde getCurrentUser), nunca del
 * cliente. Misma respuesta en todas las pantallas: espera a la base, sin tope
 * de tiempo.
 *
 * ENCENDIDO POR DEFECTO: sin tabla, sin fila, o con error sin respuesta previa
 * → `true`, el rediseño. Se apaga a propósito y de dos maneras: la fila de esa
 * clínica con `enabled = false` (solo ella, sin desplegar), o la variable de
 * entorno `REDISENO_APAGADO` (todas, sin mirar la base). Detalles y el porqué
 * de cada caso, en interruptor-core.ts.
 */
export const menuDosNivelesEncendido = crearInterruptor({
  // to_regclass devuelve NULL si la tabla no existe: no lanza ni ensucia el log.
  tablaExiste: async () => {
    const filas = await prisma.$queryRaw<{ existe: boolean }[]>`
      SELECT to_regclass('public.clinic_feature_flags') IS NOT NULL AS existe`;
    return filas[0]?.existe === true;
  },
  leer: (clinicId) =>
    prisma.clinicFeatureFlag.findUnique({
      where: { clinicId_flag: { clinicId, flag: FLAG_MENU_DOS_NIVELES } },
      select: { enabled: true },
    }),
});
