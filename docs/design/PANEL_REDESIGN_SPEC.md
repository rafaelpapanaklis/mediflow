# DaleControl Panel — Spec de rediseño (PILOTO) · 2026-07-14

> Contrato para TODOS los agentes del rediseño. Leer completo antes de editar.
> Dirección aprobada por Rafael: **evolución del violeta actual** con la marca
> nueva "105" (degradado morado→azul). NO revolución: las clínicas no deben
> desorientarse. Basado en el framework ui-ux-pro-max (prioridades 1-10).

## ✅ DECISIÓN 14-jul — VARIANTE A "Refinada" APROBADA
Rafael comparó dos prototipos y eligió la **Variante A** (sidebar claro, limpia).
**Referencia visual OBLIGATORIA:** `C:\Users\Rafael\ClauCode\MediFlow\prototipos-panel\variante-a.html`
(ábrelo/léelo antes de implementar — el resultado debe verse ASÍ). Decisiones
validadas en ese prototipo que se adoptan como parte de este spec:
- Degradado de marca SOLO en 4 lugares: CTA "+ Nueva cita", barra activa 3px
  del sidebar, chip del KPI primario y el logo. En todo lo demás, violeta plano.
- Sidebar claro #FFFFFF con los menús reales de sidebar.tsx (respetando gating
  por categoría/plan tal como está — NO tocar esa lógica).
- Agenda: citas coloreadas POR ESTADO (fondo soft + borde izquierdo 2px, los
  STATUS_LABELS canónicos de status-pipeline.ts); el doctor se indica con un
  PUNTO de color (paleta con contraste entre doctores). OJO Chrome: header y
  cuerpo del grid en contenedores separados (clamp de sticky, lección conocida).
- Pacientes: toolbar/chips/columnas exactas del código actual; saldo deudor
  --danger 700 tabular; avatares con la rampa violeta suave.
- Tipografía: IBM Plex Sans (números tabulares); Hanken Grotesk SOLO wordmark.
- La variante B (sidebar oscuro) queda DESCARTADA — no mezclar.

## Regla #0 — QUÉ NO TOCAR (crítico)
- **CERO cambios de lógica**: no tocar handlers, fetchers, estados, props,
  queries, permisos, `clinicId`, rutas ni nombres de exports/componentes.
- Solo: estilos inline, clases, tokens CSS, markup decorativo (spans/divs de
  presentación), iconos y microcopy visual (NO textos de negocio).
- `"use client"` se queda donde está. tsconfig NO es strict (no for...of sobre
  Map/Set). Responsive siempre (sin anchos fijos, ver reglas del repo).
- Dark mode DEBE seguir funcionando: todo color nuevo va vía tokens semánticos
  existentes (`--bg-*`, `--text-*`, `--border-*`, `--brand*`) o los nuevos de
  abajo. PROHIBIDO hex crudo en componentes (salvo que ya estuviera).
- No agregar dependencias. Iconos: SOLO lucide-react (ya instalada).

## Sistema (evoluciona `src/app/globals.css` — YA tiene tokens: leerlos)
El panel ya define `--bg/--bg-elev/--bg-elev-2/--bg-hover`, `--text-1..4`,
`--border-soft/strong/brand`, `--brand/--brand-soft(er)`, rampa `--violet-50..700`,
`--success/warning/danger/info(+soft)`, `--radius-sm/10/lg` y bloque `.dark`.

### Tokens NUEVOS a agregar en `:root` (+ ajuste en `.dark` donde aplique)
```css
--brand-grad: linear-gradient(90deg, #7C3AED, #2563EB);  /* marca 105: SOLO acentos (CTA primario, indicador activo, KPI hero, progress). Jamás texto sobre él <AA. */
--brand-blue: #2563EB;            /* punta azul de la marca; úsalo vía --info si ya existe */
--shadow-1: 0 1px 2px rgba(20,16,31,.05);                          /* reposo */
--shadow-2: 0 4px 12px -2px rgba(20,16,31,.08);                    /* hover/dropdown */
--shadow-3: 0 16px 40px -12px rgba(20,16,31,.18);                  /* modal/popover */
--ring: 0 0 0 3px rgba(124,58,237,.35);                            /* focus visible */
--dur-1: 150ms; --dur-2: 250ms; --ease: cubic-bezier(.2,.8,.4,1);
```
En `.dark`: sombras más profundas (`rgba(0,0,0,.4)` aprox) y `--ring` con
violet-400. Elevación consistente: usar SOLO estas 3 sombras (nada de valores
sueltos nuevos).

### Ritmo y jerarquía
- Espaciado en múltiplos de 4px (4/8/12/16/24/32). Secciones: 24-32px.
- Tipografía (IBM Plex Sans ya cargada): page title 20-22/700, section 15-16/600,
  body 13.5-14/400, meta 12/500, KPI number 26-30/700 **tabular-nums**.
- Jerarquía por tamaño/peso/espacio, no solo color. Texto mínimo 12px.

### Estados (todos los interactivos)
- hover: `background: var(--bg-hover)` o elevación +1; transición `var(--dur-1) var(--ease)`.
- focus-visible: `box-shadow: var(--ring)` (NUNCA quitar outline sin reemplazo).
- active/pressed: scale(.98) o tono +1 de fondo.
- disabled: opacity .45 + cursor-not-allowed.
- Táctil: targets ≥40px (44px ideal) — el panel se usa en tablet/celular.

### Iconografía (disciplina)
- lucide-react, strokeWidth 1.75 uniforme, tamaños 16 (inline), 18 (nav), 20 (acciones).
- Icono + label en navegación (no icon-only). aria-label en botones de solo icono.
- Sin emojis como iconos estructurales (los que existan en UI del panel → lucide).

### Motion
- Micro: 150ms; entradas/overlays: 250ms ease-out; salidas ~60% del enter.
- Solo transform/opacity. `@media (prefers-reduced-motion: reduce)` → sin animación.

## Componentes chrome (Fase 1)
1. **Sidebar** (`src/components/dashboard/sidebar.tsx`): fondo `--bg-elev` con
   borde derecho `--border-soft`; grupos con eyebrow 11px/700 uppercase
   `--text-3` + espaciado 24px entre secciones; item activo = fondo
   `--brand-soft` + **barra indicadora 3px con `--brand-grad`** a la izquierda +
   texto `--brand` 600; hover `--bg-hover`; iconos 18px alineados; contador/badges
   con `--brand-soft`. Botón "+ Nueva cita" (o CTA principal si existe) =
   `--brand-grad` con shadow-2. El bloque de clínica/usuario arriba: avatar con
   degradado de marca, nombre 600, plan como badge pequeño.
2. **Layout/topbar** (`src/app/dashboard/layout.tsx`): fondo global `--bg`;
   contenido máx legible; breadcrumb/título de página consistente.
3. **Design system base** (`src/components/ui/design-system/*` + `src/components/ui/card.tsx`,
   `button.tsx`, `badge.tsx`, `input.tsx`): aplicar sombras/estados/radius
   nuevos; `kpi-card.tsx` = número tabular grande + delta con flecha y color
   semántico + icono en chip `--brand-soft` (NO degradado en todos: solo el KPI
   primario de cada grupo puede llevar acento `--brand-grad`).
4. Tablas (patrón, donde exista en las páginas del piloto): header 12px/600
   uppercase `--text-3` fondo `--bg-elev-2` sticky si ya lo era; filas 44-48px;
   hover `--bg-hover`; divisores `--border-soft`; números tabulares a la derecha.

## Páginas del piloto (Fase 2 — en paralelo, NO tocar archivos de otra página)
- **Home** (`src/components/dashboard/home/*.tsx` + `src/app/dashboard/page.tsx`
  solo si es markup visual): saludo como hero compacto (nombre 22/700 + fecha
  `--text-3`); fila de KPI cards del sistema; secciones con headers consistentes;
  listas de próximas citas como filas con hora en chip `--brand-soft`.
- **Agenda** (`src/app/dashboard/agenda/agenda-page-client.tsx`): toolbar como
  barra única (view switcher segmentado con fondo `--bg-elev-2` y opción activa
  blanca con shadow-1; filtros como chips con contador en `--brand`); chips de
  estado de cita con colores semánticos soft + borde izquierdo 2px sólido;
  celda hoy con fondo `--brand-softer`.
- **Pacientes lista** (`src/app/dashboard/patients/patients-client.tsx` +
  `patients.module.css`): patrón de tabla del sistema; filtros como chips
  scrollables; saldo deudor en `--danger` 700 tabular; avatar iniciales con
  fondos de la rampa violet suaves; estado Activo = badge `--success-soft`.

## Checklist final por agente (antes de terminar)
- [ ] Cero hex nuevos fuera de tokens · [ ] dark mode revisado mentalmente
- [ ] focus-visible en todo lo interactivo · [ ] contraste AA (4.5:1 texto)
- [ ] sin cambios de lógica/props/exports · [ ] sin console.log ni TODOs
- [ ] responsive: nada de anchos fijos nuevos; flex/grid con minmax
