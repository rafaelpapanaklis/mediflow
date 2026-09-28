// Catálogo de materiales y calibres de arco, separado de `DrawerWireStep.tsx`
// para que se pueda importar sin arrastrar el componente (y su hoja de
// estilos): las pruebas de `__tests__/wire-options.test.ts` corren en Node,
// que no sabe leer un `.module.css`. El contenido es el mismo, movido tal cual.

export const WIRE_MATERIAL_OPTIONS: ReadonlyArray<{
  key: string;
  label: string;
  hint: string;
}> = [
  {
    key: "NITI_SUPER",
    label: "NiTi superelástico",
    hint: "Alineación inicial · fuerzas constantes ligeras",
  },
  {
    key: "NITI_THERMO",
    label: "NiTi termoactivado",
    hint: "Activación por temperatura corporal",
  },
  {
    key: "NITI_CONV",
    label: "NiTi convencional",
    hint: "Casos rutinarios estándar",
  },
  { key: "SS", label: "Acero (SS)", hint: "Mecánicas de cierre y working" },
  { key: "TMA", label: "TMA / β-titanio", hint: "Detalles, finishing, springs" },
  {
    key: "MULTI",
    label: "Multi-stranded",
    hint: "Trenzado · arcos retención provisional",
  },
  { key: "CRCO", label: "Cr-Co (Elgiloy)", hint: "Quad-helix, Nance, custom" },
];

export const WIRE_GAUGE_ROUND = [
  { key: "014", label: ".014" },
  { key: "016", label: ".016" },
  { key: "018", label: ".018" },
] as const;

export const WIRE_GAUGE_RECT = [
  { key: "16x22", label: "16x22" },
  { key: "17x25", label: "17x25" },
  { key: "19x25", label: "19x25" },
] as const;
