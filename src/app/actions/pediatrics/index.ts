// Pediatrics — barrel export para server actions. Spec: §4.A.9

export {
  createPediatricRecord,
  updatePediatricRecord,
  getPediatricRecord,
  type CreatePediatricRecordInput,
} from "./record";

export {
  addGuardian,
  updateGuardian,
  setPrimaryGuardian,
  deleteGuardian,
  type AddGuardianInput,
} from "./guardian";

export {
  captureBehavior,
  getBehaviorHistory,
  deleteBehavior,
  type CaptureBehaviorInput,
} from "./behavior";

export {
  captureCambra,
  getCambraLatest,
  getCambraHistory,
  type CaptureCambraInput,
} from "./cambra";

export {
  addHabit,
  updateHabit,
  resolveHabit,
  deleteHabit,
  type AddHabitInput,
} from "./habits";

export {
  recordEruption,
  deleteEruption,
  type RecordEruptionInput,
} from "./eruption";

export {
  placeSealant,
  updateSealantRetention,
  reapplySealant,
} from "./sealant";

export {
  applyFluoride,
  getFluorideHistory,
  type ApplyFluorideInput,
} from "./fluoride";

export {
  placeMaintainer,
  updateMaintainerStatus,
  retireMaintainer,
} from "./maintainer";

export {
  recordEndoTreatment,
  getEndoHistory,
  type RecordEndoTreatmentInput,
} from "./endodontic";

export {
  generateConsent,
  signConsentByGuardian,
  signConsentByMinor,
  voidConsent,
} from "./consent";
