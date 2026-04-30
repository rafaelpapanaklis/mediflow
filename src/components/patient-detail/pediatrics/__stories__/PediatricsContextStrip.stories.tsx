// Pediatrics — Storybook story para PediatricsContextStrip. Spec: §1.4, commit 20

import { PediatricsContextStrip } from "../PediatricsContextStrip";

export default {
  title: "Pediatrics/ContextStrip",
  component: PediatricsContextStrip,
};

const noop = () => undefined;

export const MateoMixta = {
  render: () => (
    <PediatricsContextStrip
      ageFormatted="4 a 7 m"
      dentition="mixta"
      latestFranklValues={[
        { value: 2, date: new Date("2026-01-12") },
        { value: 3, date: new Date("2026-04-08") },
      ]}
      latestCambraCategory="alto"
      nextAppointmentLabel="Ortopanto · 2 mar"
      onCaptureFrankl={noop}
      onCaptureCambra={noop}
    />
  ),
};

export const SinDatos = {
  render: () => (
    <PediatricsContextStrip
      ageFormatted="3 a 0 m"
      dentition="temporal"
      latestFranklValues={[]}
      latestCambraCategory={null}
      onCaptureFrankl={noop}
      onCaptureCambra={noop}
    />
  ),
};

export const ExtremoConRegresion = {
  render: () => (
    <PediatricsContextStrip
      ageFormatted="6 a 4 m"
      dentition="mixta"
      latestFranklValues={[
        { value: 4, date: new Date("2026-01-12") },
        { value: 1, date: new Date("2026-04-08") },
      ]}
      latestCambraCategory="extremo"
      nextAppointmentLabel="Sedación · 12 mayo"
      onCaptureFrankl={noop}
      onCaptureCambra={noop}
    />
  ),
};
