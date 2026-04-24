# MediFlow — Design System (fuente única de verdad)

Extraído de `src/app/globals.css`. Si algo aquí diverge del CSS real, gana el CSS.

## Modo (CRÍTICO)

**MediFlow soporta light mode y dark mode como ciudadanos de primera clase.**
Ningún modo es "el default" — el producto respeta la preferencia del sistema
(`prefers-color-scheme`) o la elección manual guardada en `localStorage.theme`.
Los usuarios toggle entre ambos desde el sidebar ("Modo claro" / "Modo oscuro").

**Reglas obligatorias al diseñar:**

1. **Cada pantalla y componente debe funcionar idéntico en ambos modos.** Si
   propones un rediseño, valida visualmente ambas variantes antes de entregar.
2. **Nunca uses colores hex crudos.** Siempre `var(--bg)`, `var(--text-1)`, etc.
   Los tokens ya tienen la variante correcta para cada modo definida.
3. **Cuando un screenshot de referencia esté en light mode**, la versión dark
   se deriva automáticamente de los tokens — NO redibujes. Solo asegúrate de
   que el contraste funciona (texto legible, borders visibles).
4. **Cuando un screenshot esté en dark mode**, idem inverso.
5. **Si un color específico rompe contraste en un modo**, agrega un override
   `.dark .mi-clase { ... }` o `:root:not(.dark) .mi-clase { ... }`, no
   hardcodees.

**Cómo se activa cada modo:**
- Class `.dark` en `<html>` → dark mode (ej: `<html class="dark">`)
- Sin class → light mode
- Bootstrap en `src/app/layout.tsx`: script inline lee `localStorage.theme`
  o `prefers-color-scheme`.

**En los screenshots del paquete encontrarás capturas de ambos modos**
(nombradas `*-light.png` y `*-dark.png` cuando se requiera diferenciar).
Usa ambas como referencia.

---

## 1. Tokens de color

### Fondos

| Token | Dark | Light | Uso |
|---|---|---|---|
| `--bg` | `#0B0815` | `#F8F7FC` | Fondo de página |
| `--bg-elev` | `#121020` | `#FFFFFF` | Cards, modales, inputs |
| `--bg-elev-2` | `#1A1630` | `#F0EEF7` | Nested, hover de cards |
| `--bg-hover` | `rgba(255,255,255,0.03)` | `rgba(124,58,237,0.04)` | Hover states |

### Bordes

| Token | Dark | Light | Uso |
|---|---|---|---|
| `--border-soft` | `rgba(255,255,255,0.06)` | `rgba(15,10,30,0.08)` | Bordes estándar |
| `--border-strong` | `rgba(255,255,255,0.10)` | `rgba(15,10,30,0.14)` | Hover, secondary buttons |
| `--border-brand` | `rgba(124,58,237,0.30)` | idem | Focus, acentos brand |

### Brand (violeta — mismo en ambos modos)

| Token | Valor |
|---|---|
| `--brand` | `#7c3aed` |
| `--brand-soft` | `rgba(124,58,237,0.12)` dark / `.10` light |
| `--brand-softer` | `rgba(124,58,237,0.06)` dark / `.04` light |

### Texto

| Token | Dark | Light | Uso |
|---|---|---|---|
| `--text-1` | `#E8E8EC` | `#14101F` | Headings, body primary |
| `--text-2` | `#A0A0AB` | `#4A4560` | Body secondary |
| `--text-3` | `#6B6B78` | `#7D7892` | Labels, captions |
| `--text-4` | `#45454F` | `#A8A4B8` | Placeholders, disabled |

### Semánticos

| Token | Dark | Light |
|---|---|---|
| `--success` | `#10b981` | `#059669` |
| `--warning` | `#f59e0b` | `#d97706` |
| `--danger` | `#ef4444` | `#dc2626` |
| `--info` | `#3b82f6` | `#2563eb` |

Cada uno tiene su `-soft` con alpha `.12` dark / `.10` light (para backgrounds).

---

## 2. Tipografía

| Fuente | Uso | Pesos |
|---|---|---|
| **Sora** | UI general, headings, body | 400, 500, 600, 700 |
| **JetBrains Mono** | Números, folios, IDs, kbd, código | 400, 500 |

Variables CSS: `var(--font-sora, 'Sora', sans-serif)` y
`var(--font-jetbrains-mono, 'JetBrains Mono', monospace)`.

Escala (en px, pero con `html { font-size: clamp(13px, 0.55vw + 10.5px, 16px) }`
todo es fluido según viewport):

| Rol | Tamaño | Weight | Token CSS |
|---|---|---|---|
| H1 página | 22 (clamp `clamp(16px, 1.4vw, 22px)`) | 600 | `var(--text-1)` |
| H2 sección | 18 | 600 | `var(--text-1)` |
| Card title | 13 | 600 | `var(--text-1)` |
| Body | 13 | 400 | `var(--text-2)` |
| Subtitle / sub | 11 | 400 | `var(--text-3)` |
| Label (uppercase) | 10-11, letter-spacing `0.04em-0.06em`, `uppercase` | 500-600 | `var(--text-3)` |
| KPI value | 26 | 600, letter-spacing `-0.02em` | `var(--text-1)` |
| Badge | 10, uppercase, letter-spacing `0.02em` | 600 | — |
| Kbd / mono small | 10-11 | 500 | JetBrains Mono |

Line-heights: body 1.65, headings 1.2-1.3.

Clase utility `.mono` aplica JetBrains Mono. Usarla en: folios (P-2026-4218),
fechas cortas (20 abr), horas (09:00), cantidades ($850.00), IDs, contadores.

---

## 3. Radios

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | 6px | Badges, tags, pagination buttons |
| `--radius` | 10px | (default, raro de usar) |
| `--radius-lg` | 14px | Cards, modales, KPIs |

Otros hardcodeados comunes: 8px (buttons, inputs, nav items), 20px (badges pill),
50% (avatars, dots).

---

## 4. Espaciado

Unidades hardcodeadas más comunes (tu sistema NO usa una escala 4/8 estricta,
pero estos son los valores recurrentes):

- Gaps pequeños: 4, 6, 8, 10 px
- Gaps medianos: 12, 14, 16 px
- Gaps grandes: 18, 20, 22, 24, 28 px
- Paddings de card: 14px 18px (header), 18px (body)
- Padding horizontal de páginas: `clamp(12px, 1.5vw, 28px)`
- Padding vertical de páginas: `clamp(14px, 1.6vw, 28px)`
- Max-width contenido: 1280-1400px

---

## 5. Sombras

| Clase utility | Dark | Light |
|---|---|---|
| `.shadow-card` | `0 1px 3px rgba(0,0,0,0.3)` | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` |
| `.shadow-card-md` | `0 4px 16px rgba(0,0,0,0.4)` | `0 4px 16px rgba(0,0,0,0.08)` |
| Modal | `0 24px 60px -12px rgba(0,0,0,0.6)` | — |
| Button primary | `0 0 0 1px rgba(124,58,237,0.5), 0 4px 16px -4px rgba(124,58,237,0.5), inset 0 1px 0 rgba(255,255,255,0.15)` | — |

Glow violeta recurrente: `box-shadow: 0 0 20px rgba(124,58,237,0.4)` en logos
y elementos brand destacados.

---

## 6. Fondo global (grid + radial)

Definido en `body` (light) y `.dark body`:

```css
.dark body {
  background-image:
    radial-gradient(ellipse 1200px 600px at 50% -10%, rgba(124,58,237,0.10), transparent 70%),
    radial-gradient(ellipse 800px 400px at 90% 10%, rgba(168,85,247,0.06), transparent 70%),
    linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px);
  background-size: auto, auto, 32px 32px, 32px 32px;
  background-attachment: fixed;
}
```

Cells 32×32px. Grid visible SOLO si ningún wrapper encima pone background sólido.
Por eso los layouts de dashboard y admin NO deben setear `background` en su div
raíz (quitado explícitamente).

---

## 7. Clases utility del sistema

### `.card` — contenedor base
```css
background: var(--bg-elev);
border: 1px solid var(--border-soft);
border-radius: var(--radius-lg);      /* 14px */
overflow: hidden;
```
Subelementos: `.card__header` (14px 18px, border-bottom), `.card__title`
(13px/600), `.card__sub` (11px/text-3), `.card__body` (padding 18px).

### `.kpi` — KPI card
```css
background: var(--bg-elev);
border: 1px solid var(--border-soft);
border-radius: 14px;
padding: 18px;
```
- `.kpi__label` — 11px uppercase, letter-spacing 0.04em, text-3
- `.kpi__icon` — 28×28px, border-radius 8px, bg var(--brand-softer), color `#c4b5fd`
- `.kpi__value` — 26px/600, letter-spacing -0.02em, Sora
- `.kpi__delta--up` (success color) / `.kpi__delta--down` (danger), mono font

### `.badge-new`
- Altura 20px, padding `0 8px`, border-radius 20px (pill)
- Font: 10px/600 uppercase, letter-spacing 0.02em
- Tones: `success | warning | danger | info | brand | neutral`
- Opcional `.badge-new__dot` (5×5 px con glow)

### `.btn-new`
- Altura 32px (default), 28px (`.btn-new--sm`)
- Padding `0 12px`, border-radius 8px, font 12px/500
- Variantes: `primary | secondary | ghost | danger`
- `primary` con glow violeta + inset highlight

### `.input-new`
- Altura 34px, padding 8px 12px, border-radius 8px, font 12px
- Focus: border `rgba(124,58,237,0.5)` + ring `rgba(124,58,237,0.15)` 3px

### `.table-new`
- Font 12px, border-collapse
- Thead: 10px uppercase, letter-spacing 0.06em, text-3, bg `rgba(255,255,255,0.015)`
- Td: padding 12px 14px, border-bottom `border-soft`
- Row hover: `var(--bg-hover)`

### `.tabs-new` / `.tab-new`
- Tab: padding 10px 14px, font 12px/500, text-3
- Active: text-1 + glow line abajo (brand color, 2px alto, border-radius 2px 2px 0 0)

### `.segment-new` (segmented control)
- Container: bg-elev, border-soft, border-radius 8px, padding 3px
- Btn: padding 5px 10px, font 11px, border-radius 6px
- Active: bg `rgba(255,255,255,0.06)`, color text-1

### `.sidebar-new`
- Width `clamp(180px, 14vw, 232px)` — colapsa a 68px con `--collapsed`
- Background `rgba(10,10,15,0.6)` + backdrop-blur 8px
- Sticky top 0, height 100vh
- En ≤1280px, width 196px

### `.nav-item-new` (items del sidebar)
- Padding 7px 10px, border-radius 8px, font 13px/500, color text-2
- Active: bg `brand-soft` + border brand + glow violeta (20px, inset shadow)
- Active tiene `::before` — barrita vertical 2×16px a la izquierda del item con glow

### `.topbar-new`
- Height 52px, sticky, bg `rgba(10,10,15,0.6)` + blur 8px
- Padding horizontal `clamp(12px, 1.5vw, 24px)`

### `.icon-btn-new`
- 32×32 px, border-radius 8px, bg-elev, border border-soft
- Hover: bg-elev-2, color text-1
- Dot rojo (`.icon-btn-new__dot`): 6px top-right, brand color con glow

### `.modal` / `.modal-overlay`
- Overlay: `rgba(5,5,10,0.72)` + blur 6px, grid/center, padding 24px
- Modal: max-width 540px (`modal--wide` = 680px), border-radius 14px,
  max-height 90vh, shadow grande, animación `slideUp 0.25s`
- Mobile ≤640px: overlay padding 12px, modal max-height 94vh

### `.switch`
- 36×20 px pill, track `rgba(255,255,255,0.1)`, thumb 16×16 blanco
- ON: brand color + glow `rgba(124,58,237,0.3)`

### `.skel-new` (skeleton loading)
- Shimmer gradient blanco alpha, animación 1.6s infinite

### `.pagination` / `.pagination__btn`
- 28×28 px min, border-radius 6px, font 11px mono, bg-elev

---

## 8. Animaciones

- `fadeUp` — opacity 0→1 + translateY(6→0), 0.2s ease-out
- `slideUp` — usado en modales, 0.25s cubic-bezier(0.16, 1, 0.3, 1)
- `shimmer-new` — 1.6s infinite para skeletons
- Default transition de hover: `all .15s`

---

## 9. Reglas prácticas al diseñar

1. **Nunca hex crudos.** Usa `var(--x)`. Si necesitas un color nuevo, agrégalo
   primero a globals.css como token con variante light + dark.
2. **Ambos modos son iguales de importantes.** Entrega diseños que funcionen
   idéntico en light y dark. Si una decisión cambia entre modos, documenta
   por qué (ej: glow violeta más sutil en light).
3. **Números SIEMPRE en `.mono`.** Folios, fechas, precios, horas, IDs.
4. **Border-radius jerarquía clara:** pill (20px+) para badges, 8px para
   controles, 14px para cards/modales. No mezcles arbitrariamente.
5. **Glow violeta es la firma de marca.** Úsalo con moderación — solo en
   elementos brand y active states. En light mode el glow se ve más sutil
   pero **mantenlo**, es el sello visual.
6. **Backdrop blur** en sidebar, topbar y modal-overlay. En dark refuerza la
   profundidad espacial del fondo morado; en light mantiene cohesión visual.
7. **Iconos Lucide React**, tamaño 12-16 px según contexto. Nunca inventes SVGs.
8. **Padding fluido** con `clamp()` en contenedores de página para responsivo.
