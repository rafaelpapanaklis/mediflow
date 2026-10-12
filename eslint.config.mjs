// Next 16 quitó `next lint`: el lint se corre con ESLint directo (`npm run lint`).
// Config plana (flat config) que reproduce el gate que había con
// `.eslintrc.json` ({ "extends": "next/core-web-vitals" }) sobre las mismas
// carpetas que revisaba `next lint` (aquí: src).
//
// eslint-config-next 16 añade las reglas del React Compiler (react-hooks v7:
// set-state-in-effect, refs, purity, static-components…). No existían en el gate
// de Next 14 y marcan ~800 sitios de código que funciona: se apagan para que el
// gate siga midiendo lo mismo que antes (rules-of-hooks y exhaustive-deps se
// quedan). Encenderlas es una tarea aparte, no parte de la actualización.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const REGLAS_DEL_COMPILADOR = [
  "react-hooks/set-state-in-effect",
  "react-hooks/refs",
  "react-hooks/static-components",
  "react-hooks/error-boundaries",
  "react-hooks/purity",
  "react-hooks/preserve-manual-memoization",
  "react-hooks/immutability",
  "react-hooks/use-memo",
  "react-hooks/globals",
  "react-hooks/component-hook-factories",
  "react-hooks/unsupported-syntax",
  "react-hooks/incompatible-library",
  "react-hooks/config",
  "react-hooks/gating",
  "react-hooks/void-use-memo",
];

const config = [
  ...nextCoreWebVitals,
  {
    ignores: [".next/**", "node_modules/**", "public/**", "next-env.d.ts"],
  },
  {
    rules: {
      ...Object.fromEntries(REGLAS_DEL_COMPILADOR.map((r) => [r, "off"])),
      // En 14 solo miraba un directorio pages/ que aquí no existe.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
];

export default config;
