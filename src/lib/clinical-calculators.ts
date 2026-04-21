export interface ClinicalCalculatorInfo {
  id: string;
  name: string;
  description: string;
  specialty: string[];
  component: string;
}

export const CLINICAL_CALCULATORS: ClinicalCalculatorInfo[] = [
  { id: "cha2ds2vasc", name: "CHA₂DS₂-VASc", description: "Riesgo de ictus en fibrilación auricular", specialty: ["cardiología","medicina general"], component: "Cha2ds2VascCalculator" },
  { id: "glasgow", name: "Glasgow (GCS)", description: "Nivel de conciencia", specialty: ["urgencias","medicina general","neurología"], component: "GlasgowComaScaleCalculator" },
  { id: "apgar", name: "APGAR", description: "Vitalidad del recién nacido", specialty: ["pediatría","ginecología"], component: "ApgarCalculator" },
  { id: "nyha", name: "NYHA", description: "Clasificación funcional en insuficiencia cardíaca", specialty: ["cardiología"], component: "NyhaClassificationCalculator" },
  { id: "childpugh", name: "Child-Pugh", description: "Pronóstico en cirrosis hepática", specialty: ["gastroenterología","medicina general"], component: "ChildPughCalculator" },
  { id: "framingham", name: "Framingham", description: "Riesgo cardiovascular a 10 años", specialty: ["cardiología","medicina general"], component: "FraminghamRiskCalculator" },
  { id: "meld", name: "MELD / MELD-Na", description: "Severidad de enfermedad hepática terminal", specialty: ["gastroenterología"], component: "MeldCalculator" },
  { id: "wells", name: "Wells Score", description: "Probabilidad de TEP / TVP", specialty: ["urgencias","medicina general"], component: "WellsScoreCalculator" },
];
