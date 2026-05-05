# Storybook stories — Pediatrics

Stories CSF v3 compatibles. El repo aún **no tiene Storybook instalado**;
estos archivos están preparados para que cuando se agregue
(`npm i -D @storybook/react @storybook/nextjs && storybook init`),
se reconozcan automáticamente vía el patrón `src/**/*.stories.tsx`.

Cobertura mínima del MVP (spec §4 commit 20):

| Componente | Story |
|---|---|
| `Drawer` (design system) | `Drawer.stories.tsx` |
| `FranklDrawer` | `FranklDrawer.stories.tsx` |
| `EruptionChart` | `EruptionChart.stories.tsx` |
| `PediatricOdontogram` | `PediatricOdontogram.stories.tsx` |
| `RiskCard` | `RiskCard.stories.tsx` |
| `PediatricsContextStrip` | `PediatricsContextStrip.stories.tsx` |
| `ConsentModal` | `ConsentModal.stories.tsx` |

Las stories evitan importar tipos de `@storybook/react` para no requerir
deps. Cuando Storybook esté instalado, basta con reemplazar los `default`
exports por `Meta<typeof Component>` y los named exports por
`StoryObj<typeof Component>` para tener tipos completos.
