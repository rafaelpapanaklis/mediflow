// Endodontics — plantillas de receta NOM-024 para post-TC, post-TC con
// absceso y post-cirugía apical. Spec §10.6

export type EndoPrescriptionKey =
  | "postTcStandard"
  | "postTcWithAbscess"
  | "postApicalSurgery";

export interface EndoPrescriptionTemplate {
  key: EndoPrescriptionKey;
  label: string;
  description: string;
  body: string;
}

/**
 * Plantillas de receta endodónticas (es-MX neutro). NOM-024 obliga
 * responsabilidad del prescriptor: el doctor SIEMPRE puede editar antes
 * de imprimir/enviar. Estos textos son punto de partida, no escritos
 * en piedra.
 */
export const ENDO_PRESCRIPTION_TEMPLATES: EndoPrescriptionTemplate[] = [
  {
    key: "postTcStandard",
    label: "Pos-TC estándar",
    description: "Manejo de dolor pos-tratamiento de conductos sin signos de infección.",
    body: [
      "Ibuprofeno 600 mg, vía oral, cada 8 h por 3 días.",
      "Paracetamol 500 mg, vía oral, cada 6 h en caso de dolor adicional (rescate, máximo 4 dosis al día).",
    ].join("\n"),
  },
  {
    key: "postTcWithAbscess",
    label: "Pos-TC con absceso",
    description: "TC en presencia de absceso apical agudo o celulitis incipiente.",
    body: [
      "Amoxicilina 875 mg + ácido clavulánico 125 mg, vía oral, cada 12 h por 7 días.",
      "Ibuprofeno 600 mg, vía oral, cada 8 h por 3 días.",
      "Indicaciones: tomar con alimentos. Si presenta erupción cutánea o diarrea severa, suspender y comunicarse al consultorio.",
    ].join("\n"),
  },
  {
    key: "postApicalSurgery",
    label: "Pos-cirugía apical",
    description: "Antibiótico, antiinflamatorio y colutorio post-apicectomía.",
    body: [
      "Amoxicilina 875 mg + ácido clavulánico 125 mg, vía oral, cada 12 h por 7 días.",
      "Ibuprofeno 600 mg, vía oral, cada 8 h por 5 días.",
      "Clorhexidina 0.12% colutorio, 15 ml, enjuagar 60 segundos cada 12 h por 7 días (no comer ni beber 30 min posteriores).",
      "Indicaciones: dieta fría y blanda 24 h, no escupir ni hacer enjuagues vigorosos las primeras 24 h, frío local intermitente las primeras 6 h.",
    ].join("\n"),
  },
];

const TEMPLATE_BY_KEY: ReadonlyMap<EndoPrescriptionKey, EndoPrescriptionTemplate> =
  new Map(ENDO_PRESCRIPTION_TEMPLATES.map((t) => [t.key, t] as const));

export function getEndoPrescriptionTemplate(
  key: EndoPrescriptionKey,
): EndoPrescriptionTemplate {
  const t = TEMPLATE_BY_KEY.get(key);
  if (!t) throw new Error(`Plantilla endodóntica desconocida: ${key}`);
  return t;
}
