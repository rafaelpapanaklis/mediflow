import { prisma } from "@/lib/prisma";
import { hoyEnZona } from "@/lib/whatsapp/cobranza/sweep";
import { CATEGORIA_DE_ARCHIVO, fechaIsoValida, type RadiografiaDelPaciente, type TipoRadiografia } from "./plan-detalle";

// Ortodoncia — las radiografías TIPIFICADAS de los pacientes (panorámica y tele), para la «Reevaluación
// radiográfica» de Alertas y de la ficha (ws1-t12). Salen de los archivos del expediente por su categoría
// (`PatientFile.category`); «Mano» y «Scanner ATM» no tienen categoría propia y no se leen. `clinicId` de la
// sesión; los archivos quitados (`deletedAt`) no cuentan. Nunca lanza: sin datos, ninguna radiografía (la
// periodicidad entonces se cuenta desde el inicio del caso).

const TIPOS = Object.keys(CATEGORIA_DE_ARCHIVO) as TipoRadiografia[];

export async function cargarRadiografiasTipificadas(
  clinicId: string,
  patientIds: readonly string[],
  zona: string,
): Promise<Map<string, RadiografiaDelPaciente[]>> {
  const salida = new Map<string, RadiografiaDelPaciente[]>();
  const ids = [...new Set(patientIds.filter(Boolean))];
  if (!clinicId || ids.length === 0) return salida;
  try {
    const archivos = await prisma.patientFile.findMany({
      where: {
        clinicId,
        patientId: { in: ids },
        deletedAt: null,
        category: { in: TIPOS.map((t) => CATEGORIA_DE_ARCHIVO[t]!) as never[] },
      },
      select: { patientId: true, category: true, takenAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    for (const a of archivos) {
      const tipo = TIPOS.find((t) => CATEGORIA_DE_ARCHIVO[t] === String(a.category));
      if (!tipo) continue;
      const fecha = fechaIsoValida(hoyEnZona(a.takenAt ?? a.createdAt, zona));
      if (!fecha) continue;
      const l = salida.get(a.patientId) ?? [];
      l.push({ tipo, fecha });
      salida.set(a.patientId, l);
    }
  } catch (e) {
    console.warn("[ortodoncia:plan] no se pudieron leer las radiografías del expediente:", e);
  }
  return salida;
}
