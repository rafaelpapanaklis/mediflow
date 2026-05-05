// Pediatrics — Storybook story para RiskCard. Spec: §4.A.8, commit 20

import { RiskCard } from "../cards/RiskCard";

export default {
  title: "Pediatrics/RiskCard",
  component: RiskCard,
};

export const Empty = {
  render: () => <div style={{ width: 280 }}><RiskCard category={null} /></div>,
};

export const Bajo = {
  render: () => (
    <div style={{ width: 280 }}>
      <RiskCard category="bajo" recallMonths={6} scoredAt={new Date("2026-04-01")} />
    </div>
  ),
};

export const Moderado = {
  render: () => (
    <div style={{ width: 280 }}>
      <RiskCard category="moderado" recallMonths={6} scoredAt={new Date("2026-03-15")} />
    </div>
  ),
};

export const Alto = {
  render: () => (
    <div style={{ width: 280 }}>
      <RiskCard category="alto" recallMonths={4} scoredAt={new Date("2026-04-10")} nextDueAt={new Date("2026-08-10")} />
    </div>
  ),
};

export const Extremo = {
  render: () => (
    <div style={{ width: 280 }}>
      <RiskCard category="extremo" recallMonths={3} scoredAt={new Date("2026-04-20")} nextDueAt={new Date("2026-07-20")} />
    </div>
  ),
};
