import type { Config } from "tailwindcss";

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
        sans: ["var(--font-sora)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
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
        violet:           "hsl(var(--violet) / <alpha-value>)",
        indigo:           "hsl(var(--indigo) / <alpha-value>)",
        teal:             "hsl(var(--teal) / <alpha-value>)",
        surface:          "hsl(var(--surface))",
        "surface-elevated": "hsl(var(--surface-elevated))",
        brand: {
          50:  "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
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
