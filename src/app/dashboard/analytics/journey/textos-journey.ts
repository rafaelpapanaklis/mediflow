// Textos de «Recorrido del paciente» en el idioma del usuario.
//
// El API (`/api/analytics/journey`) devuelve etapas y pasos del embudo con su
// `id` y un texto de respaldo; antes ese texto venía escrito en el código con
// los estados en inglés («Checked-out», «CHECKED_IN → IN_CHAIR»). Aquí se
// reemplaza por el diccionario según el `id`; un id que no se conozca conserva
// el texto de respaldo. Puro (sin React) para poder probarlo.

type T = (key: string, vars?: Record<string, string | number>) => string;

interface PasoEmbudo { id: string; label: string; count: number }
interface Etapa { id: string; label: string; from: string; to: string; avgMin: number; sample: number }
interface Recorrido {
  totalAppts: number;
  funnel: PasoEmbudo[];
  dropOffs: { cancelled: number; noShow: number };
  stages: Etapa[];
  bottleneck: Etapa | null;
}

/** Etapa → [hito donde empieza, hito donde termina]. */
const HITOS: Record<string, [string, string]> = {
  wait: ["arrived", "inChair"],
  "in-chair": ["inChair", "consultStart"],
  consult: ["consultStart", "consultEnd"],
  checkout: ["consultEnd", "checkout"],
};

const PREFIJO = "analytics.journeyClient";

function conTexto(t: T, key: string, respaldo: string): string {
  const v = t(key);
  // El proveedor devuelve la llave tal cual cuando falta; entonces vale el respaldo.
  return v && v !== key ? v : respaldo;
}

export function traducirRecorrido<R extends Recorrido>(data: R, t: T): R {
  const etapa = (e: Etapa): Etapa => {
    const hitos = HITOS[e.id];
    return {
      ...e,
      label: conTexto(t, `${PREFIJO}.stage.${e.id}`, e.label),
      from: hitos ? conTexto(t, `${PREFIJO}.milestone.${hitos[0]}`, e.from) : e.from,
      to: hitos ? conTexto(t, `${PREFIJO}.milestone.${hitos[1]}`, e.to) : e.to,
    };
  };
  return {
    ...data,
    funnel: data.funnel.map((p) => ({ ...p, label: conTexto(t, `${PREFIJO}.funnel.${p.id}`, p.label) })),
    stages: data.stages.map(etapa),
    bottleneck: data.bottleneck ? etapa(data.bottleneck) : null,
  };
}
