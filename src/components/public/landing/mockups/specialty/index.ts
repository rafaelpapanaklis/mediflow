import React from "react";
import { OdontogramMock, OrthoMock, EndoMock, PerioMock } from "./dental-mocks";
import {
  GeneralMock,
  DermaMock,
  CardioMock,
  GinecoMock,
  PedsMock,
  OftalmoMock,
} from "./medical-mocks";
import { PsicoMock, PsiqMock } from "./mental-mocks";
import {
  NutriMock,
  FisioMock,
  EsteticaMock,
  AcupunturaMock,
  HomeopatiaMock,
} from "./wellness-mocks";

export type SpecialtyMockupKey =
  | "dental"
  | "ortho"
  | "endo"
  | "perio"
  | "general"
  | "derma"
  | "nutri"
  | "gineco"
  | "peds"
  | "cardio"
  | "oftalmo"
  | "psico"
  | "psiq"
  | "fisio"
  | "estetica"
  | "acupuntura"
  | "homeopatia";

const MAP: Record<SpecialtyMockupKey, React.FC> = {
  dental: OdontogramMock,
  ortho: OrthoMock,
  endo: EndoMock,
  perio: PerioMock,
  general: GeneralMock,
  derma: DermaMock,
  cardio: CardioMock,
  gineco: GinecoMock,
  peds: PedsMock,
  oftalmo: OftalmoMock,
  psico: PsicoMock,
  psiq: PsiqMock,
  nutri: NutriMock,
  fisio: FisioMock,
  estetica: EsteticaMock,
  acupuntura: AcupunturaMock,
  homeopatia: HomeopatiaMock,
};

export function getSpecialtyMockup(key: SpecialtyMockupKey): React.FC {
  return MAP[key] ?? GeneralMock;
}

export {
  OdontogramMock,
  OrthoMock,
  EndoMock,
  PerioMock,
  GeneralMock,
  DermaMock,
  CardioMock,
  GinecoMock,
  PedsMock,
  OftalmoMock,
  PsicoMock,
  PsiqMock,
  NutriMock,
  FisioMock,
  EsteticaMock,
  AcupunturaMock,
  HomeopatiaMock,
};
