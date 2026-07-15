import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Safelist: las clases de icono del marketplace vienen de BD (Module.iconBg
  // y Module.iconColor son strings poblados por el seed, ver prisma/seed.ts).
  // Tailwind purga lo que no aparece literal en el source — sin safelist, los
  // íconos quedarían sin color en producción.
  safelist: [
    { pattern: /^bg-(blue|cyan|violet|pink|red|orange|purple|green|fuchsia)-50$/ },
    { pattern: /^text-(blue|cyan|violet|pink|red|orange|purple|green|fuchsia)-600$/ },
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      colors: {
        background:       "hsl(var(--background))",
        foreground:       "hsl(var(--foreground))",
        muted:            { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        border:           "hsl(var(--border) / <alpha-value>)",
        input:            "hsl(var(--border) / <alpha-value>)",
        ring:             "hsl(var(--primary) / <alpha-value>)",
        card:             { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        primary:          { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        accent:           { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive:      { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        popover:          { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        secondary:        { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--foreground))" },
        sidebar: {
          DEFAULT:         "hsl(var(--sidebar))",
          foreground:      "hsl(var(--sidebar-foreground))",
          border:          "hsl(var(--sidebar-border) / <alpha-value>)",
          accent:          "hsl(var(--sidebar-accent) / <alpha-value>)",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
        },
        // Un color PLANO aquí pisa la escala 50-950 entera de Tailwind (violet-600
        // etc. dejan de compilarse en TODO el repo). Conservar escala + DEFAULT.
        violet:           { ...colors.violet, DEFAULT: "hsl(var(--violet) / <alpha-value>)" },
        indigo:           { ...colors.indigo, DEFAULT: "hsl(var(--indigo) / <alpha-value>)" },
        teal:             { ...colors.teal,   DEFAULT: "hsl(var(--teal) / <alpha-value>)" },
        surface:          "hsl(var(--surface))",
        "surface-elevated": "hsl(var(--surface-elevated))",
        // brand-* resuelve vía variables (globals.css): :root = AZUL del funnel
        // público (landing, login/signup, marketing); body:has(.dashboard-shell)
        // remapea la rampa a VIOLETA de marca en los paneles internos (decisión
        // 14-jul). Triplets HSL + <alpha-value> para conservar bg-brand-950/40.
        brand: {
          50:  "hsl(var(--brand-50) / <alpha-value>)",
          100: "hsl(var(--brand-100) / <alpha-value>)",
          200: "hsl(var(--brand-200) / <alpha-value>)",
          300: "hsl(var(--brand-300) / <alpha-value>)",
          400: "hsl(var(--brand-400) / <alpha-value>)",
          500: "hsl(var(--brand-500) / <alpha-value>)",
          600: "hsl(var(--brand-600) / <alpha-value>)",
          700: "hsl(var(--brand-700) / <alpha-value>)",
          800: "hsl(var(--brand-800) / <alpha-value>)",
          900: "hsl(var(--brand-900) / <alpha-value>)",
          950: "hsl(var(--brand-950) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "0.75rem",
        xl: "1rem",
        "2xl": "1.25rem",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
