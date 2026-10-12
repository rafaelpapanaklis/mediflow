// Next 16 quitó `next lint`: el lint se corre con ESLint directo (`npm run lint`).
// Config plana (flat config) con el mismo conjunto de reglas que tenía
// `.eslintrc.json` ({ "extends": "next/core-web-vitals" }).
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextCoreWebVitals,
  {
    ignores: [".next/**", "node_modules/**", "public/**", "next-env.d.ts"],
  },
];

export default config;
