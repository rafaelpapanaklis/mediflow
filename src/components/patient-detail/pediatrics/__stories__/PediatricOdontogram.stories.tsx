// Pediatrics — Storybook story para PediatricOdontogram. Spec: §1.8, commit 20

import { PediatricOdontogram } from "../odontogram/PediatricOdontogram";

export default {
  title: "Pediatrics/Odontogram/PediatricOdontogram",
  component: PediatricOdontogram,
  parameters: { layout: "centered" },
};

export const Temporal = {
  render: () => <PediatricOdontogram defaultView="temporal" />,
};

export const Mixta = {
  render: () => <PediatricOdontogram defaultView="mixta" />,
};

export const Permanente = {
  render: () => <PediatricOdontogram defaultView="permanente" />,
};

export const ConSellantesYCaries = {
  render: () => (
    <PediatricOdontogram
      defaultView="mixta"
      toothStates={{
        16: { state: "erupted", hasSealant: true },
        26: { state: "erupted", hasSealant: true },
        36: { state: "erupted", hasSealant: true, caries: true },
        46: { state: "erupted", hasSealant: true },
        75: { state: "missing-patho" },
      }}
    />
  ),
};
