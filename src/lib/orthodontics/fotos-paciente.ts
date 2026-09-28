// Ortodoncia — las fotos de seguimiento que manda el PACIENTE desde su portal
// (ws1-t5, ronda 6, hallazgo 96 de la revisión de lógica de uso).
//
// El portal le decía al paciente «Enviada. Tu clínica la revisará», y en la
// clínica nadie se enteraba: la foto solo se veía si alguien abría ese caso y
// bajaba hasta «Alineadores y cumplimiento». Esto arma el aviso para Alertas
// del módulo y para la campana.
//
// PURO: sin Prisma. El cargador vive en `fotos-paciente-db.ts`.

/** Una foto pendiente de revisar, tal como sale de la base. */
export interface FotoPendiente {
  id: string;
  treatmentPlanId: string;
  patientId: string;
  patientName: string;
  /** "FRONTAL" | "LATERAL" | "SMILE" | "INTRAORAL" | "OTHER". */
  angle: string;
  patientNote: string | null;
  submittedAt: Date;
}

/** Un caso con fotos del paciente sin revisar. Una fila por CASO. */
export interface FotosPorRevisarEntry {
  treatmentPlanId: string;
  patientId: string;
  patientName: string;
  /** Cuántas fotos siguen sin revisar. */
  pendientes: number;
  /** Cuándo mandó la más reciente. */
  ultimaAt: Date;
  /** Cuándo mandó la más vieja que sigue sin revisar: lo que lleva esperando. */
  primeraAt: Date;
  /** Lo último que escribió el paciente junto a una foto, si escribió algo. */
  nota: string | null;
}

export const ANGULOS_DE_FOTO: Record<string, string> = {
  FRONTAL: "de frente",
  LATERAL: "de perfil",
  SMILE: "de sonrisa",
  INTRAORAL: "intraoral",
  OTHER: "",
};

/** «foto de frente», «foto» si el ángulo no dice nada. */
export function nombreDeLaFoto(angle: string): string {
  const a = ANGULOS_DE_FOTO[angle] ?? "";
  return a ? `foto ${a}` : "foto";
}

/**
 * Agrupa las fotos pendientes por caso. Primero el caso que lleva MÁS tiempo
 * esperando: es el que más urge contestar.
 */
export function agruparFotosPorRevisar(fotos: FotoPendiente[]): FotosPorRevisarEntry[] {
  const porCaso = new Map<string, FotosPorRevisarEntry & { notaAt: number }>();
  for (const f of fotos) {
    const nota = (f.patientNote ?? "").trim();
    const t = f.submittedAt.getTime();
    const e = porCaso.get(f.treatmentPlanId);
    if (!e) {
      porCaso.set(f.treatmentPlanId, {
        treatmentPlanId: f.treatmentPlanId,
        patientId: f.patientId,
        patientName: f.patientName,
        pendientes: 1,
        ultimaAt: f.submittedAt,
        primeraAt: f.submittedAt,
        nota: nota || null,
        notaAt: nota ? t : -1,
      });
      continue;
    }
    e.pendientes += 1;
    if (t > e.ultimaAt.getTime()) e.ultimaAt = f.submittedAt;
    if (t < e.primeraAt.getTime()) e.primeraAt = f.submittedAt;
    if (nota && t > e.notaAt) {
      e.nota = nota;
      e.notaAt = t;
    }
  }
  return Array.from(porCaso.values())
    .sort((a, b) => a.primeraAt.getTime() - b.primeraAt.getTime())
    .map(({ notaAt: _notaAt, ...e }) => e);
}

/** «3 fotos sin revisar» / «1 foto sin revisar». */
export function resumenDeFotos(pendientes: number): string {
  return `${pendientes} foto${pendientes === 1 ? "" : "s"} sin revisar`;
}

/** Recorta la nota del paciente para una fila de lista, sin partir a media palabra si se puede. */
export function notaCorta(nota: string | null, max = 90): string | null {
  const limpia = (nota ?? "").replace(/\s+/g, " ").trim();
  if (!limpia) return null;
  if (limpia.length <= max) return limpia;
  const corte = limpia.slice(0, max);
  const espacio = corte.lastIndexOf(" ");
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).trimEnd()}…`;
}

/** Un aviso para la campana del panel. */
export interface AvisoDeFoto {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  at: Date;
}

/**
 * Un aviso por CASO (no uno por foto: cuatro fotos seguidas son un solo
 * aviso), fechado con la foto más reciente, que lleva a la pestaña de
 * Ortodoncia de la ficha, donde se revisan.
 */
export function avisosDeFotos(fotos: FotoPendiente[], max = 10): AvisoDeFoto[] {
  return agruparFotosPorRevisar(fotos)
    .sort((a, b) => b.ultimaAt.getTime() - a.ultimaAt.getTime())
    .slice(0, max)
    .map((e) => ({
      id: `orto-foto-${e.treatmentPlanId}-${e.ultimaAt.getTime()}`,
      title:
        e.pendientes === 1
          ? `Foto de seguimiento — ${e.patientName}`
          : `${e.pendientes} fotos de seguimiento — ${e.patientName}`,
      subtitle: notaCorta(e.nota, 60) ? `Ortodoncia · «${notaCorta(e.nota, 60)}»` : "Ortodoncia · por revisar",
      href: `/dashboard/patients/${e.patientId}?tab=ortodoncia`,
      at: e.ultimaAt,
    }));
}
