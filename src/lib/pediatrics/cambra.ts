// Pediatrics — algoritmo CAMBRA simplificado para riesgo cariogénico. Spec: §1.3, §4.A.1

export type CambraCategory = "bajo" | "moderado" | "alto" | "extremo";
export type CambraRecallMonths = 3 | 4 | 6;

export type CambraInput = {
  riskFactors: string[];
  protectiveFactors: string[];
  diseaseIndicators: string[];
};

export type CambraResult = {
  category: CambraCategory;
  recallMonths: CambraRecallMonths;
  rationale: string;
};

type Option = { key: string; label: string };

export const CAMBRA_RISK_OPTIONS: Option[] = [
  { key: "biberon_nocturno", label: "Biberón nocturno con líquidos azucarados" },
  { key: "dieta_cariogenica", label: "Dieta alta en carbohidratos fermentables" },
  { key: "snacks_frecuentes", label: "Snacks azucarados >3 veces/día" },
  { key: "higiene_deficiente", label: "Higiene oral deficiente" },
  { key: "placa_visible", label: "Placa visible al examen" },
  { key: "necesidades_especiales", label: "Niño con necesidades especiales" },
  { key: "saliva_disminuida", label: "Flujo salival disminuido" },
  { key: "aparatologia", label: "Aparatología fija u ortopedia" },
  { key: "padres_caries_activa", label: "Madre/cuidador con caries activa" },
];

export const CAMBRA_PROT_OPTIONS: Option[] = [
  { key: "agua_fluorada", label: "Agua fluorada en casa" },
  { key: "pasta_fluor", label: "Pasta dental con flúor 2x/día" },
  { key: "barniz_6m", label: "Barniz de flúor cada 6 meses" },
  { key: "selladores", label: "Selladores en molares permanentes" },
  { key: "xilitol", label: "Uso de xilitol regular" },
  { key: "supervision_higiene", label: "Higiene supervisada por adulto" },
];

export const CAMBRA_INDIC_OPTIONS: Option[] = [
  { key: "lesion_cavitaria", label: "Lesión cavitaria reciente" },
  { key: "mancha_blanca", label: "Mancha blanca activa" },
  { key: "restauraciones_recientes", label: "Restauraciones en últimos 12m" },
  { key: "esmalte_inicial", label: "Lesión incipiente en esmalte" },
];

const RECALL_BY_CATEGORY: Record<CambraCategory, CambraRecallMonths> = {
  bajo: 6,
  moderado: 6,
  alto: 4,
  extremo: 3,
};

export function scoreCambra(input: CambraInput): CambraResult {
  const indicators = input.diseaseIndicators.length;
  const risks = input.riskFactors.length;
  const prots = input.protectiveFactors.length;

  let category: CambraCategory;

  if (indicators >= 2 || (indicators >= 1 && risks >= 3)) {
    category = "extremo";
  } else if (indicators === 1 || risks >= 3) {
    category = "alto";
  } else if (risks === 2 || (risks === 1 && prots <= 1)) {
    category = "moderado";
  } else {
    category = "bajo";
  }

  if (prots >= 4 && indicators === 0 && category !== "bajo") {
    category = category === "extremo" ? "alto" : category === "alto" ? "moderado" : "bajo";
  }

  const recallMonths = RECALL_BY_CATEGORY[category];
  const rationale = buildRationale({ indicators, risks, prots, category });

  return { category, recallMonths, rationale };
}

function buildRationale(args: {
  indicators: number;
  risks: number;
  prots: number;
  category: CambraCategory;
}): string {
  const parts: string[] = [];
  if (args.indicators > 0) parts.push(`${args.indicators} indicador${args.indicators === 1 ? "" : "es"} de enfermedad`);
  if (args.risks > 0) parts.push(`${args.risks} factor${args.risks === 1 ? "" : "es"} de riesgo`);
  if (args.prots > 0) parts.push(`${args.prots} factor${args.prots === 1 ? "" : "es"} protector${args.prots === 1 ? "" : "es"}`);
  if (parts.length === 0) parts.push("sin factores significativos");
  return `Riesgo ${args.category}: ${parts.join(", ")}.`;
}
