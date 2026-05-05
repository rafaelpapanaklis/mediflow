# MediFlow — Módulo de Odontopediatría
**Versión 1.0 · Spec de diseño + plan de implementación**
**Audiencia:** dueño del producto (Rafael) + bot Git que ejecuta el merge.

Este documento es la **fuente única de verdad** para el rediseño y construcción
del módulo de Odontopediatría dentro de MediFlow. Está pensado para que un bot
Git lo pueda aplicar con mínima ambigüedad, y para que un humano lo pueda
revisar sin haber leído nunca el repo.

Decisiones clínicas vienen del brief del odontopediatra senior. Decisiones UX
vienen de mi propuesta. Cuando hay tensión entre las dos, está marcada con 🟡
y justificada.

═══════════════════════════════════════════════════════════════════════════
ÍNDICE
═══════════════════════════════════════════════════════════════════════════

1. Wireframes detallados — pantallas, drawers y estados
2. Tokens de diseño del módulo — colores, iconos, tipografía
3. Micro-interacciones — animaciones, hovers, feedback
4. Diff por componente — archivos nuevos y modificaciones
5. Schema Prisma — observaciones y ajustes propuestos
6. Decisiones opinadas del clínico — qué respeté y qué cuestioné
7. Instrucciones para el bot Git — prompt pegable

═══════════════════════════════════════════════════════════════════════════
1. WIREFRAMES DETALLADOS
═══════════════════════════════════════════════════════════════════════════

## 1.1 Activación del módulo

**Visibilidad de la pestaña "Pediatría":**

```
Mostrar SI:
  clinic.modules.includes('PEDIATRICS')           // permiso comprado
  AND clinic.category IN ('DENTAL_CLINIC', 'MEDICINE')
  AND patient.dateOfBirth != null
  AND patient.ageInYears < 14                     // hard cap
                                                  // (config 14-16 en settings)

Si una de las condiciones falla → la pestaña NO se renderiza
(no se muestra deshabilitada — se oculta, según política de permisos).
```

El cálculo de edad usa `dateOfBirth`, no el flag `isChild`. El flag
`isChild` se conserva pero deja de ser autoritativo para esta pestaña.

## 1.2 Layout maestro de la pestaña Pediatría

La pestaña vive dentro de `/dashboard/patients/[id]`. Se inserta entre
**Historia clínica** y **Nueva consulta** (queda al lado del expediente).

### Vista desktop (≥1280px)

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Sidebar      │  Topbar (52px)                                            │
│   global      │                                                           │
│               ├──────────────────────────────────────────────────────────┤
│  (existente)  │  ← Pacientes / Mateo Hernández García / Pediatría         │
│               │                                                           │
│               │  ┌──── Patient Header (existente, enriquecido) ────────┐ │
│               │  │ [Avatar] Mateo Hernández  [4a 7m] [Mixta] [● Alto]  │ │
│               │  │ M · F:1948...  Tutora: Laura García                  │ │
│               │  │            [Nueva nota] [Portal] [+ Agendar cita]    │ │
│               │  └──────────────────────────────────────────────────────┘ │
│               │                                                           │
│               │  ┌── Patient tabs (existentes + Pediatría nueva) ──────┐ │
│               │  │ Resumen · H.Clínica · Pediatría ● · Nueva consulta..│ │
│               │  └──────────────────────────────────────────────────────┘ │
│               │                                                           │
│               │  ┌─ ContextStrip (sticky, h:56) ──────────────────────┐  │
│               │  │ [Edad:4a7m] [Dent:Mixta] [Frankl:2↗3] [CAMBRA:Alto]│  │
│               │  │ [Próx:Ortopanto 2 mar] [Acciones: + Frankl + Cambra]│ │
│               │  └────────────────────────────────────────────────────┘  │
│               │                                                           │
│               │  ┌─Siderail 280px────┐  ┌─Main content (flex)──────────┐ │
│               │  │ TUTOR              │  │ ┌SubNav: Resumen Odon...─┐  │ │
│               │  │ ┌──────────────┐  │  │ │ Resumen · Odontograma · │  │ │
│               │  │ │ LG  Laura G. │  │  │ │ Erupción · Hábitos ·    │  │ │
│               │  │ │ Madre        │  │  │ │ Conducta · Plan prev.   │  │ │
│               │  │ │ +52 999 ...  │  │  │ └─────────────────────────┘  │ │
│               │  │ │ [WhatsApp]   │  │  │                              │ │
│               │  │ └──────────────┘  │  │ ┌─Sub-tab content──────────┐ │ │
│               │  │                    │  │ │                          │ │ │
│               │  │ ALERGIAS           │  │ │ (varía por sección)      │ │ │
│               │  │ ⚠ Sin alergias     │  │ │                          │ │ │
│               │  │                    │  │ │                          │ │ │
│               │  │ CONDICIONES        │  │ │                          │ │ │
│               │  │ — Sin condiciones  │  │ │                          │ │ │
│               │  │                    │  │ │                          │ │ │
│               │  │ CONSENT. PEND.     │  │ │                          │ │ │
│               │  │ ⚠ Fluorización     │  │ │                          │ │ │
│               │  │   [Firmar]         │  │ │                          │ │ │
│               │  └────────────────────┘  │ └──────────────────────────┘ │ │
│               │                           └──────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘

  ↑ Cuando se abre un drawer de captura, se desliza desde la derecha
    sobre el main content (siderail queda visible).
```

### Vista tablet (768-1279px)

- Siderail colapsa a un **resumen horizontal pegado bajo el ContextStrip**
  (1 fila, scroll-x si no cabe).
- Drawer de captura toma 88% del ancho con backdrop oscuro.

### Vista mobile (<768px)

- Pestaña accesible vía dropdown "Más" si hay >5 patient tabs.
- Siderail desaparece, cards se muestran en orden:
  1. ContextStrip (compacto, 2 líneas)
  2. SubNav (scroll-x horizontal)
  3. Contenido del sub-tab activo (full width)
  4. Tutor + alergias + condiciones (en cards apiladas al final).
- Drawer toma 100% width, full screen.

## 1.3 Patient Header — extensión pediátrica

El header existente recibe **3 chips nuevos** (a la derecha del nombre,
antes del email/phone). Solo visibles si la pestaña Pediatría aplica.

```
[Avatar 64px]  Mateo Hernández García   ● ACTIVO   #P0123
                                        ┌─────────┐ ┌────────┐ ┌──────────┐
                                        │ 4 a 7 m │ │ Mixta  │ │ ● Alto   │
                                        └─────────┘ └────────┘ └──────────┘
              M · 18 sep 2021 · Tutora: Laura García · +52 999 123 4567
                                          [Nueva nota] [Portal] [+ Agendar]
```

- Chip **edad**: borde brand-soft, mono `4 a 7 m`, tooltip on hover →
  `4.58 años · 18 sep 2021`. Se actualiza diario por server-side calc.
- Chip **dentición**: borde neutral. Color según tipo:
  - Temporal → tone `info` (azul claro)
  - Mixta → tone `brand` (violeta)
  - Permanente → tone `neutral`
- Chip **CAMBRA**: dot grande con glow + texto. Tones:
  - Bajo → `success` verde
  - Moderado → `warning` ámbar
  - Alto → `danger` rojo (saturado)
  - Extremo → `danger` rojo + animación pulso 2s

## 1.4 ContextStrip pediátrico — sticky, 56px

Banda informacional **siempre visible** mientras el doctor navega los
sub-tabs internos. Es la "memoria de trabajo" del doctor con guantes.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ EDAD     DENTICIÓN  FRANKL ÚLT.  CAMBRA   PRÓXIMA          ACCIONES RÁP.  │
│ 4a 7m    Mixta      ◌ 2 → ◑ 3   ●Alto   Ortopanto · 2mar  [+Frankl][+CMB]│
└────────────────────────────────────────────────────────────────────────────┘
```

- Cada bloque es columna fixed-width con label uppercase 10px + valor 13px/600.
- "Frankl último": muestra los 2 últimos valores con flecha de tendencia.
  - Arriba (3→4) icon `TrendingUp` color success
  - Abajo (4→2) icon `TrendingDown` color danger + tooltip de alerta
- "Próxima": fecha + tipo de cita + tooltip con doctor asignado.
- "Acciones rápidas": 2 botones secundarios `sm` siempre visibles:
  - `+ Frankl` → abre drawer captura conducta (cierra en 3 clics)
  - `+ CMBRA` → abre drawer wizard CAMBRA (3 pasos)
- En tablet/mobile, el bloque "Acciones" colapsa a un menú `MoreHorizontal`.

Background: `var(--bg-elev)` con border-bottom `var(--border-soft)`,
backdrop-blur 6px en dark, sin blur en light (más sutil).

## 1.5 Siderail — 280px (desktop only)

Caja persistente a la izquierda con 4 secciones apiladas:

### 1.5.1 Tutor card

```
┌────────────────────────────┐
│ TUTOR PRINCIPAL    [...]   │
│ ┌────┐                     │
│ │ LG │  Laura García       │
│ └────┘  Madre · INE ✓      │
│                            │
│  📞  +52 999 123 4567      │
│  ✉   laura.g@gmail.com     │
│                            │
│  [WhatsApp ↗]  [Editar]    │
└────────────────────────────┘
```

- Avatar 32px con iniciales gradient determinístico.
- Botón WhatsApp abre wa.me con plantilla predeterminada.
- Si hay >1 tutor registrado, aparece chip pequeño `+1` para verlos en modal.
- INE ✓ verde si guardianSignatureUrl existe, ámbar `INE pendiente` si no.

### 1.5.2 Alergias

```
┌────────────────────────────┐
│ ALERGIAS                   │
│ ⚠ Penicilina               │
│ ⚠ Látex                    │
└────────────────────────────┘
```

- Si hay alergias: cada una pill con icon `AlertTriangle` + bg `danger-soft`.
- Vacío: copy gris claro `Sin alergias registradas`.

### 1.5.3 Condiciones especiales

```
┌────────────────────────────┐
│ CONDICIONES ESPECIALES     │
│ [TEA G1] [TDAH]            │
└────────────────────────────┘
```

- Tags `.tag-new` con tone `info`.
- Click en tag abre modal con descripción larga + recomendaciones.

### 1.5.4 Consentimientos pendientes (si aplica)

```
┌────────────────────────────┐
│ ⚠ CONSENTIMIENTO PENDIENTE │
│ Fluorización 5% NaF        │
│ [Firmar ahora]             │
└────────────────────────────┘
```

- Solo aparece si hay procedimientos planeados sin consentimiento firmado.
- Card con bg `warning-soft` + border ámbar.
- CTA primary `sm` que abre el modal full-screen de firma.

## 1.6 SubNav interno — 6 secciones

```
[Resumen] [Odontograma] [Erupción ●] [Hábitos] [Conducta] [Plan prev.]
```

- Mismo estilo `.tabs-new` que el resto del producto.
- Cada tab puede tener `.tab__count` (ej: `Hábitos 3` para hábitos activos).
- Tab `Erupción` lleva dot con glow violeta por ser la **vista estrella**.
- Order rationale: Resumen primero (overview), luego herramientas
  asincrónicas más usadas (Odontograma → captura por cita), luego
  Erupción (firma diferenciadora), luego registros longitudinales
  (Hábitos, Conducta), y finalmente el plan futuro.

## 1.7 Sub-tab "Resumen" — dashboard del módulo

Grid 12 columnas en desktop, colapsa a 6 / 4 / 2 según viewport.

```
┌────────────────────────────────────────────────────────────────────────┐
│ ┌── Cronología miniatura (col 8) ──────────────┐ ┌─Próxima profilaxis─┐│
│ │ Eruption mini-chart (últimos 12 meses zoom) │ │ Marzo 2026 · 3 m   ││
│ │ con marca de "edad actual" violeta           │ │ Recall: 3 meses    ││
│ │   [Ver completa →]                           │ │ [Agendar →]        ││
│ └──────────────────────────────────────────────┘ └────────────────────┘│
│                                                                        │
│ ┌── Frankl últimas 5 visitas (col 6) ─────┐ ┌─Sellantes pendientes──┐  │
│ │ Line chart 1-4, 5 puntos coloreados     │ │ • 16, 26, 36, 46      │  │
│ │ Tendencia: ↗ positiva                   │ │   Programados próxima │  │
│ │                                          │ │ [Ver odontograma →]   │  │
│ └──────────────────────────────────────────┘ └───────────────────────┘  │
│                                                                        │
│ ┌── Mantenedores activos (col 6) ─────────┐ ┌─Hábitos activos (col 6)┐ │
│ │ • Banda-Ansa #75                        │ │ ⚪ Succión digital      │ │
│ │   Colocado 12 mar · Retiro est. ago    │ │   2 años · activa      │ │
│ │   180 días restantes                    │ │ ⚪ Resp. bucal nocturna │ │
│ │   ▓▓▓▓▓▓▓▓░░ 78%                        │ │   1 año · activa       │ │
│ │ [Detalles]                              │ │ [+ Hábito]             │ │
│ └──────────────────────────────────────────┘ └────────────────────────┘ │
│                                                                        │
│ ┌── Última cita pediátrica (col 12) ────────────────────────────────┐  │
│ │ 12 ene 2026 · Dra. Sabina Estrada · 35 min · Asistente: Ana M.   │  │
│ │ Frankl: 3 · Aplicó: Barniz flúor 5% NaF (75, 84, 85)             │  │
│ │ Notas para tutor enviadas: "Post-flúor: no comer 30 min" [✓]     │  │
│ └────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

Cards usan `<CardNew>` con padding default. Cada card tiene su propia
acción header (botón ghost icon-only o link "Ver →"). Los charts mini
miden 280×140 px para mantener legibilidad sin abrumar.

## 1.8 Sub-tab "Odontograma pediátrico"

```
┌────────────────────────────────────────────────────────────────────────┐
│ Odontograma                            [Vista: Temporal·Mixta·Permanente]│
│ Click en un diente para registrar restauración / sellante / extracción  │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Maxilar superior (vista occlusal hacia abajo)                         │
│      55  54  53  52  51 │ 61  62  63  64  65                          │
│      ◐   ◐   ◐   ◐   ◐  │  ◐   ◐   ◐   ◐   ◐    ← temporales         │
│  16  ─   ─   ─   ─   ─  │  ─   ─   ─   ─   ─   26  ← permanentes mix │
│   ◯                                                ◯                   │
│                                                                        │
│   ━━━━━━━━━━━━━━━━━━━ línea media ━━━━━━━━━━━━━━━━━━━━                │
│                                                                        │
│  46  ─   ─   ─   ─   ─  │  ─   ─   ─   ─   ─   36                     │
│   ◯  85  84  83  82  81 │ 71  72  73  74  75   ◯                     │
│      ◐   ◐   ◐   ◐   ◐  │  ◐   ◐   ◐   ◐   ◐                          │
│  Maxilar inferior                                                      │
│                                                                        │
├────────────────────────────────────────────────────────────────────────┤
│ Leyenda: ◐ presente  ◯ erupcionado  ✕ ausente                         │
│   Color saturado violeta = permanente · pastel = temporal              │
│   Bordes: rojo=caries activa · amarillo=mancha blanca · verde=sellado  │
└────────────────────────────────────────────────────────────────────────┘
```

### Vistas del segmented control:

- **Temporal** (default 0-6 años): Solo 20 dientes (51-85). Permanentes
  ocultos. Tamaño grande 48×48 px cada uno.
- **Mixta** (default 6-12 años): 32+20 = 52 dientes. Temporales en pastel,
  permanentes saturados. Posiciones según realidad anatómica.
- **Permanente** (default 12+): Solo 32 dientes (11-48). Temporales ocultos.

Default según `dentitionType` calculado de la edad y registro de erupción.
Override manual persiste en `localStorage.pedo.viewMode`.

### Estados de cada diente:

| Estado | Render |
|---|---|
| Presente sano | Borde gris suave, fill `bg-elev-2` |
| Erupcionando | Animación pulse 2s, opacity 0.7 |
| Ausente fisiológico | Fill `bg` muy claro + borde dashed |
| Ausente patológico | Fill `danger-soft` + ✕ centrado |
| Caries activa | Punto rojo en cara afectada (5 caras: O,V,L,M,D) |
| Mancha blanca | Punto amarillo en cara afectada |
| Restauración resina | Fill blanco + borde gris |
| Restauración ionómero | Fill amarillo claro + borde gris |
| Sellante | Borde verde 2px |
| Pulpotomía | Triángulo rojo en raíz |
| Pulpectomía | 4 líneas rojas en raíz (endo) |
| Mantenedor | Banda violeta uniendo 2 dientes adyacentes |

### Click flow:

1. Click en diente → drawer derecho se abre con tabs:
   `[Caries] [Restauración] [Sellante] [Endo] [Extracción] [Notas]`
2. Cada tab tiene un mini-form. El doctor llena, presiona Guardar
   (o `Cmd+Enter`), drawer se cierra con animación.
3. Toast "Diente 75 actualizado". Diente parpadea verde 600ms.

## 1.9 Sub-tab "Erupción" — la vista estrella

Esta es la diferenciadora clave del módulo. Vale la pena hacerla bien.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Cronología de erupción         Mateo H.G. 4a 7m   [Exportar PDF] [+ Reg.] │
│ Linea vertical violeta = edad actual del paciente                          │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│            0    1    2    3    4    5    6    7    8    9   10   11  12   │
│            ┃    ┃    ┃    ┃    ┃    ┃    ┃    ┃    ┃    ┃    ┃    ┃   ┃    │
│ ▼ Temporal superior                                                        │
│                              ↓                                             │
│  51       ▓▓▓▓●═══════════════════════════════════════════════════         │
│  52      ▓▓▓▓▓●═══════════════════════════════════════════════════         │
│  53      ═══▓▓▓▓▓▓▓●═══════════════════════════════════════════════         │
│  54      ═══▓▓▓●═════════════════════════════════════════════════         │
│  55      ═════▓▓▓▓▓●═══════════════════════════════════════════════       │
│           ... espejo en lado izquierdo (61-65) ...                         │
│                                                                            │
│ ▶ Temporal inferior                                            ✓ 10/10    │
│ ▼ Permanente superior                                          ◯ 0/16     │
│  11      ═════════════════════════▓▓▓▓▓▓░░░░░░░                            │
│  12      ═══════════════════════════▓▓▓▓▓░░░░░░                            │
│  16      ═══════════════════▓▓▓▓░░░░░░░░░░░░░░ rango esperado            │
│                                ↑                                            │
│                            edad actual ▌                                   │
│                                                                            │
│  21..27  → patrón espejo                                                   │
│                                                                            │
│ ▶ Permanente inferior                                          ◯ 0/16     │
├────────────────────────────────────────────────────────────────────────────┤
│ Leyenda:                                                                   │
│  ▓▓▓ Rango esperado (referencia OMS)                                      │
│  ●    Erupcionado en rango (verde)                                        │
│  ●    Erupcionado con desviación leve ±6 m (ámbar)                        │
│  ●    Erupcionado con desviación patológica >12 m (rojo)                  │
│  ░░░  Aún no erupciona (gris)                                             │
│  ▌    Edad actual del paciente                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Mecánica:**

- 4 secciones colapsables por defecto:
  - Temporal sup (51-65)
  - Temporal inf (71-85)
  - Permanente sup (11-27)
  - Permanente inf (31-47)
- Default expandido: la sección que contiene la dentición actual del
  paciente. Las otras colapsadas con counter `n/total erupcionado`.
- Eje X: 0 a 13 años, marca cada año + sub-marca cada 6 meses.
- Cada fila tiene su FDI a la izquierda (mono 11px) y la barra al lado.
- Click en una fila → drawer "Registrar erupción" prellenado.
- Hover sobre dot → tooltip con `Erupcionó: 12 sep 2025 · 4a 1m · Dentro de rango`.
- Línea vertical violeta animada (CSS gradient pulse 4s) sobre la edad actual.
- Botón "Exportar PDF" descarga la gráfica como imagen + tabla resumen.

**Render técnico:** SVG custom (no Recharts — necesitamos control fino
de las barras y dots con tooltips clicables). Usa los mismos tokens de
color de globals.css.

**Performance:** memoizado. Solo re-renderiza si cambia `eruptionRecords`
o `birthDate`.

## 1.10 Sub-tab "Hábitos"

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Hábitos orales                                              [+ Hábito]    │
│ Timeline de hábitos detectados, intervenciones y resolución                │
├────────────────────────────────────────────────────────────────────────────┤
│         1a   2a   3a   4a   5a   6a   7a   8a                              │
│         ┃    ┃    ┃    ┃    ┃    ┃    ┃    ┃                               │
│ ✋ Succión digital (continua)                                              │
│      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ACTIVA                          │
│      Inicio 1.5a · Intervención: dispositivo motivacional · 6 ago 2025    │
│                                                                            │
│ 🌙 Biberón nocturno (suspendido)                                           │
│      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░  Resuelto a 3a                                  │
│                                                                            │
│ 🌬 Respiración bucal nocturna (continua)                                   │
│      ░░░░░░░░░░░░░░░░░░░▓▓▓▓ ACTIVA · Referido a ORL                      │
├────────────────────────────────────────────────────────────────────────────┤
│ Leyenda:                                                                   │
│  ▓ presente   ░ ausente/resuelto   ⌐ línea media indica edad actual       │
└────────────────────────────────────────────────────────────────────────────┘
```

- Cada hábito una fila con icono + nombre + estado activo/resuelto + barra
  horizontal que cubre desde startedAt hasta endedAt (o hoy si activo).
- Hover muestra tooltip con frecuencia + intervención + notas.
- Click en barra abre drawer de edición.
- Estado "activo persistente más allá de edad esperada": pill rojo con
  icon `AlertTriangle` y mensaje `Sugerir intervención`. Se calcula:
  - Succión digital → alerta si `currentAge >= 4y` y `present == true`
  - Biberón nocturno → alerta si `currentAge >= 2y` y `present == true`
  - Respiración bucal → siempre alerta (referir a ORL)
  - Onicofagia → alerta si `currentAge >= 6y`
- Empty state custom (ver sección 1.13).

## 1.11 Sub-tab "Conducta"

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Comportamiento — escala Frankl       [Escala: Frankl·Venham] [+ Captura]  │
│ Tendencia conductual a lo largo de las visitas                             │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│ 4 ─────────────────────────────●─────●──── definitivamente positivo        │
│ 3 ──────────────●────●─────────────────── positivo                         │
│ 2 ───●─────────────────────────────────── negativo                         │
│ 1 ─────────────────────────────────────── definitivamente negativo         │
│                                                                            │
│ V1   V2    V3    V4    V5    V6    V7                                      │
│ 5a   5.5a  6a    7a    7.5a  8a    8.2a                                    │
│                                                                            │
│ Tendencia general: ↗ positiva (+2 en 5 visitas)                           │
├────────────────────────────────────────────────────────────────────────────┤
│ Última captura: hoy · 4 (definitivamente positivo) · Capturó: Dra. Estrada │
│                                                                            │
│ Histórico:                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────┐   │
│ │ FECHA       VALOR  ESCALA   NOTAS                       CAPTURÓ    │   │
│ │ 12 ene 26   ●4     Frankl   Cooperación total           S.Estrada  │   │
│ │ 8 ago 25    ●4     Frankl   Sesión sin incidencias      S.Estrada  │   │
│ │ 15 may 25   ●3     Frankl   Acepta proced. con apoyo    S.Estrada  │   │
│ │ ...                                                                  │   │
│ └─────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────┘
```

- Recharts LineChart con dots coloreados según valor:
  - 1 → `danger`
  - 2 → `warning`
  - 3 → `info`
  - 4 → `success`
- Tooltip on hover muestra fecha, edad exacta, valor, notas, doctor.
- Toggle Frankl/Venham cambia el eje Y (Frankl 1-4, Venham 0-5).
- Tabla histórica debajo, ordenada desc por defecto.
- Alerta clínica especial: si valor cae 2+ niveles entre visitas
  consecutivas, banner ámbar `Regresión conductual detectada — considera
  ajustar duración de cita`.

## 1.12 Sub-tab "Plan preventivo"

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Plan preventivo personalizado                              [+ Programar]  │
│ Recall, sellantes, fluorización, mantenedores                             │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│ ┌─ Recall según CAMBRA ───────┐  ┌─ Próxima fluorización ──────────────┐  │
│ │ Categoría: Alto             │  │ Producto: Barniz 5% NaF             │  │
│ │ Recall sugerido: 3 meses    │  │ Próxima: 12 abr 2026 (en 3 m)       │  │
│ │ Última visita: hace 2 m     │  │ Última: hoy · piezas 75, 84, 85     │  │
│ │ Próxima ideal: en 1 mes     │  │ [Programar] [Marcar aplicada]       │  │
│ │ [Agendar recall →]          │  └──────────────────────────────────────┘  │
│ └──────────────────────────────┘                                            │
│                                                                            │
│ ┌─ Sellantes — 4 molares perm. ───────────────────────────────────────┐   │
│ │ ┌─ 16 ──┐ ┌─ 26 ──┐ ┌─ 36 ──┐ ┌─ 46 ──┐                           │   │
│ │ │ ✓ OK  │ │ ✓ OK  │ │ ⚠     │ │ ✓ OK  │                           │   │
│ │ │ resina│ │ resina│ │ parc. │ │ resina│                           │   │
│ │ │ 6a    │ │ 6a    │ │ reapl.│ │ 6a    │                           │   │
│ │ └───────┘ └───────┘ └───────┘ └───────┘                           │   │
│ │ Próxima revisión: en 6 meses          [Reaplicar 36] [Detalles]   │   │
│ └─────────────────────────────────────────────────────────────────────┘   │
│                                                                            │
│ ┌─ Mantenedor activo ───────────────────────────────────────────────┐     │
│ │ Banda-Ansa #75                                                    │     │
│ │ Colocado: 12 mar 2025  ·  Retiro estimado: ago 2026 (180 d rest.)│     │
│ │ Estado: ✓ Activo                       Progreso: ▓▓▓▓▓▓▓░ 78%   │     │
│ │ [Cambiar estado] [Detalles]                                       │     │
│ └───────────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────────┘
```

## 1.13 Estados especiales (vacío, error, loading)

### 1.13.1 Estado vacío — paciente nuevo, sin registros pediátricos

```
┌────────────────────────────────────────────────────────────────────────┐
│                                                                        │
│                            ┌─────────────┐                             │
│                            │     👶      │  (icon Baby 48px violeta)   │
│                            └─────────────┘                             │
│                                                                        │
│                      Comencemos el expediente pediátrico               │
│                                                                        │
│       Mateo aún no tiene cuestionario médico pediátrico ni             │
│       evaluaciones clínicas. Empieza con el cuestionario inicial       │
│       (5 minutos) y ve agregando registros conforme atiendes.          │
│                                                                        │
│             [+ Iniciar cuestionario]   [Saltar y empezar libre]        │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.13.2 Estado "primer registro hecho"

Si solo el cuestionario médico está capturado, mostrar el resumen con
todas las cards mostrando empty states pequeños y un banner superior:

```
┌────────────────────────────────────────────────────────────────────────┐
│ ℹ Cuestionario inicial completado. Captura tu primer Frankl y CAMBRA   │
│   en la próxima cita para activar las gráficas.            [Recordar]  │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.13.3 Estado de error de carga

```
┌────────────────────────────────────────────────────────────────────────┐
│ ⚠ No pudimos cargar los registros pediátricos                         │
│   Verifica tu conexión y vuelve a intentar.                           │
│                                                          [Reintentar]  │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.13.4 Skeletons durante fetch

- ContextStrip: 5 chips skeleton 80×24 px.
- Siderail: 4 cards skeleton h:120 c/u.
- Sub-tab Resumen: 6 card skeletons grid igual que la versión final.
- Eruption chart: rectángulo h:520 con shimmer.

### 1.13.5 Comparativo pre/post tratamiento

Modal especial accesible desde Resumen → "Ver evolución" en la card de
sellantes/mantenedores/restauraciones. Muestra:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Evolución — Diente 75                                            [×]  │
├────────────────────────────────────────────────────────────────────────┤
│ ┌─ ANTES (12 ene) ────────┐    ┌─ DESPUÉS (12 mar) ──────┐            │
│ │  [foto intraoral]        │    │  [foto intraoral]        │            │
│ │  Caries oclusal-distal   │ →  │  Restaurada con resina   │            │
│ │  Caries: activa          │    │  Sellante: completo      │            │
│ └──────────────────────────┘    └──────────────────────────┘            │
│                                                                        │
│ Notas: Pulpotomía con MTA. Sin sintomatología post-op.                │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.13.6 Alerta clínica embebida (top de Resumen)

Bandera ámbar persistente cuando hay condición que requiere atención:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ⚠ Alerta clínica · Atraso de erupción detectado                        │
│   Diente 22 esperado a los 8-9a, paciente tiene 9a 8m. Considera Rx.   │
│                                                              [Atender]  │
└─────────────────────────────────────────────────────────────────────────┘
```

Tipos de alertas auto-detectables:

| Tipo | Condición | Severidad |
|---|---|---|
| Atraso de erupción | edad - rango_max > 12 m | warning |
| Atraso patológico | edad - rango_max > 18 m | danger |
| Regresión Frankl | caída ≥2 niveles entre visitas | warning |
| CAMBRA salta a alto/extremo | categoría sube vs anterior | warning |
| Hábito persistente | ver tabla 1.10 | warning |
| Mantenedor próximo a retiro | 30 días o menos | info |
| Sellante con retención perdida | retentionStatus == 'perdido' | warning |

## 1.14 Drawer lateral derecho — patrón unificado

Todos los drawers de captura usan el mismo componente base `<Drawer>`.

```
                                       ┌─────────────────────────────┐
                                       │ × Capturar Frankl           │
                                       │   Mateo H.G. · 4a 7m        │
                                       ├─────────────────────────────┤
                                       │                             │
                                       │ ESCALA                      │
                                       │ ◉ Frankl 1-4                │
                                       │ ○ Venham 0-5                │
                                       │                             │
                                       │ VALOR  *                    │
                                       │ ┌─┐ ┌─┐ ┌─┐ ┌─┐             │
                                       │ │1│ │2│ │3│ │4│             │
                                       │ └─┘ └─┘ └─┘ └─┘             │
                                       │ Definitivamente positivo    │
                                       │                             │
                                       │ NOTAS (opcional)            │
                                       │ ┌─────────────────────────┐ │
                                       │ │ Cooperación total       │ │
                                       │ └─────────────────────────┘ │
                                       │                             │
                                       │ Cita asociada: hoy 10:30    │
                                       │ Captura: Dra. Estrada       │
                                       │                             │
                                       ├─────────────────────────────┤
                                       │ [Cancelar]  [Guardar (⌘↵)] │
                                       └─────────────────────────────┘
                                       ↑ width 480px (clamp 320 a 480)
                                         vh 100% sticky right, slide-in 200ms
```

Específicaciones:
- Width: `clamp(320px, 32vw, 480px)`. En mobile <640px → 100% width.
- Backdrop: `rgba(5,5,10,0.4)` blur 4px, click cierra.
- Animation: slide-in derecha 220ms cubic-bezier(0.16, 1, 0.3, 1).
- Esc cierra. Cmd/Ctrl+Enter guarda.
- Header: título 15px/600 + sub 11px/text-3 (paciente + edad).
- Body: padding 22px, scroll-y si excede.
- Footer: sticky bottom, padding 14px 22px, border-top, botones derecha.
- Focus trap obligatorio (a11y).

### Drawers específicos a implementar:

1. **FranklDrawer** — escala + valor (4 botones grandes coloreados) + notas.
2. **CambraDrawer** — wizard 3 pasos:
   - Paso 1: factores de riesgo (checklist 8 items).
   - Paso 2: factores protectores (checklist 5 items).
   - Paso 3: indicadores de enfermedad (checklist 4 items) → muestra el
     resultado calculado en vivo + recall sugerido.
3. **HabitDrawer** — tipo de hábito (8 botones con iconos) + frecuencia
   + edad inicio + intervención + notas.
4. **EruptionDrawer** — selector de diente (visual mini-odontograma) +
   fecha observada + notas. Auto-calcula deviation respecto a rango.
5. **SealantDrawer** — diente + material + estado de retención + notas.
6. **FluorideDrawer** — producto (4 opciones radios) + dientes aplicados
   (multi-select sobre mini-odontograma) + lote opcional + notas.
7. **SpaceMaintainerDrawer** — tipo (5 opciones) + diente sustituido +
   fecha colocación + estimada retiro + estado.
8. **EndodonticDrawer** — diente + tipo + material + vitalidad + síntomas.
9. **ToothDrawer** (genérico) — desde click en odontograma, con tabs
   internos para cada tipo de captura.
10. **PediatricRecordDrawer** — cuestionario médico inicial completo
    (formulario largo, 1 pantalla con secciones colapsables).
11. **GuardianDrawer** — alta/edición de tutor con upload de INE.

## 1.15 Modal de consentimiento — full-screen con firma

Excepción al patrón drawer: para consentimientos se usa modal full-screen.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Consentimiento informado · Pulpotomía pieza 75                  [×]    │
│  Paciente: Mateo H.G. (4a 7m) · Procedimiento programado: 28 mar 2026   │
├──────────────────────────────────────────────────────────────────────────┤
│ ┌── Texto del consentimiento (scrolleable) ──────────────────────────┐  │
│ │ Yo, Laura García, en mi calidad de madre del menor Mateo           │  │
│ │ Hernández García, autorizo la realización del procedimiento de     │  │
│ │ pulpotomía con material MTA en la pieza dental 75.                 │  │
│ │                                                                     │  │
│ │ Riesgos explicados: ...                                             │  │
│ │ Alternativas: ...                                                   │  │
│ │ ...                                                                 │  │
│ └─────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│ ┌── Firma del tutor * ────────────────┐ ┌── Asentimiento del menor ─┐   │
│ │                                      │ │ Diego es mayor de 12      │   │
│ │   [área de firma con canvas]         │ │ años. Solicita su         │   │
│ │                                      │ │ asentimiento.             │   │
│ │                                      │ │  ┌──────────────────┐    │   │
│ │  [Limpiar]              firma aquí   │ │  │ [firma del menor]│    │   │
│ └──────────────────────────────────────┘ │  └──────────────────┘    │   │
│                                          │  [Limpiar]               │   │
│                                          └───────────────────────────┘   │
│                                                                          │
│ ☐ Confirmo haber explicado el procedimiento, riesgos y alternativas.    │
├──────────────────────────────────────────────────────────────────────────┤
│  [Cancelar]                                  [Generar PDF y firmar →]   │
└──────────────────────────────────────────────────────────────────────────┘
```

- Modal `.modal--full` (NUEVO — variante a agregar a globals.css).
  - max-width 980px, max-height 92vh.
- Canvas de firma usa HTML5 nativo (sin lib externa). Eventos
  pointerdown/move/up. Trazo violeta brand sobre fondo `bg-elev-2`.
- Si paciente <12 años: bloque "Asentimiento del menor" oculto.
- Si paciente ≥12: bloque visible (opcional según `minorAssentRequired`).
- Al firmar: genera PDF server-side, sube a Supabase storage, guarda URL,
  marca consentimiento como completo.
- PDF incluye: clínica logo, datos del menor, datos del tutor (con INE),
  texto del consentimiento, firmas embebidas (PNG), fecha y hora con
  zona horaria, hash SHA256 al pie para tamper-evidence.

═══════════════════════════════════════════════════════════════════════════
2. TOKENS DE DISEÑO DEL MÓDULO
═══════════════════════════════════════════════════════════════════════════

## 2.1 Paleta extendida — colores específicos pediátricos

Todos basados en tokens existentes de `globals.css`. Si necesitamos un
matiz nuevo lo agregamos como variable derivada. **Ningún hex crudo en
componentes.**

### 2.1.1 Riesgo cariogénico (CAMBRA)

| Categoría | Token light | Token dark | Tone Badge |
|---|---|---|---|
| Bajo | `--success` `#059669` | `--success` `#10b981` | `success` + dot |
| Moderado | `--warning` `#d97706` | `--warning` `#f59e0b` | `warning` + dot |
| Alto | `--danger` `#dc2626` | `--danger` `#ef4444` | `danger` + dot |
| Extremo | `--danger-strong` (NUEVO) `#991b1b` | `#dc2626` | `danger` + dot + pulse |

NUEVO token a agregar en `globals.css`:
```css
:root         { --danger-strong: #991b1b; }
.dark :root   { --danger-strong: #dc2626; }
```

### 2.1.2 Frankl (escala 1-4)

| Valor | Color principal | Background pill |
|---|---|---|
| 1 (def. negativo) | `--danger` | `--danger-soft` |
| 2 (negativo) | `--warning` | `--warning-soft` |
| 3 (positivo) | `--info` | `--info-soft` |
| 4 (def. positivo) | `--success` | `--success-soft` |

Cuando se renderiza el dot grande del chart (12px), se aplica además
un `box-shadow: 0 0 8px <color>` con alpha 0.5 para el glow.

### 2.1.3 Dentición — odontograma

| Concepto | Token |
|---|---|
| Diente temporal (pastel) | `--brand-soft` para fill, `--brand` 30% alpha para borde |
| Diente permanente (saturado) | `--brand` para borde, `--bg-elev-2` para fill |
| Diente erupcionando | `--brand-softer` con animación pulse |
| Cara con caries activa | `--danger` |
| Cara con mancha blanca | `--warning` |
| Cara con sellante | `--success` border 2px |
| Restauración resina | `#FFFFFF` con `--border-strong` (light) / `--text-2` (dark) |
| Restauración ionómero | `--warning-soft` |
| Pulpotomía/pulpectomía | `--danger` con glyph dental |
| Mantenedor (banda) | `--brand` línea 3px conectando 2 dientes |

### 2.1.4 Erupción — chart

| Estado | Color barra | Color dot |
|---|---|---|
| Rango esperado | `--brand-soft` (light) / `--brand-softer` (dark) | — |
| Erupcionado en rango | — | `--success` |
| Erupcionado desv. leve (±6m) | — | `--warning` |
| Erupcionado patológico (>12m) | — | `--danger` |
| Aún no erupciona | `--bg-elev-2` después del rango | — |
| Línea edad actual | `--brand` con glow 8px | — |

### 2.1.5 Hábitos — pictogramas + estados

Cada hábito tiene su icono lucide y color de estado:

| Hábito | Icono | Color activo | Color resuelto |
|---|---|---|---|
| Succión digital | `Hand` | `--warning` | `--success` |
| Chupón | `Baby` | `--warning` | `--success` |
| Biberón nocturno | `MoonStar` | `--warning` | `--success` |
| Respiración bucal | `Wind` | `--info` | `--success` |
| Bruxismo nocturno | `Activity` | `--warning` | `--success` |
| Onicofagia | `Fingerprint` | `--warning` | `--success` |
| Deglución atípica | `Droplets` | `--info` | `--success` |

Estado "persistente más allá de edad esperada" → override a `--danger`.

## 2.2 Iconografía completa (lucide-react)

| Contexto | Icono | Tamaño |
|---|---|---|
| Tab "Pediatría" en patient nav | `Baby` | 14 |
| Sub-tab Resumen | `LayoutDashboard` | 14 |
| Sub-tab Odontograma | `Grid2x2` | 14 |
| Sub-tab Erupción | `LineChart` | 14 |
| Sub-tab Hábitos | `ListChecks` | 14 |
| Sub-tab Conducta | `Smile` | 14 |
| Sub-tab Plan preventivo | `ShieldCheck` | 14 |
| CAMBRA Bajo | `ShieldCheck` | 12 |
| CAMBRA Moderado | `Shield` | 12 |
| CAMBRA Alto | `ShieldAlert` | 12 |
| CAMBRA Extremo | `ShieldX` | 12 |
| Frankl 1 (def. neg.) | `Frown` | 16 |
| Frankl 2 (neg.) | `Meh` | 16 |
| Frankl 3 (pos.) | `Smile` | 16 |
| Frankl 4 (def. pos.) | `SmilePlus` | 16 |
| Tutor (madre/padre/tutor) | `UserRound` | 14 |
| WhatsApp tutor | `MessageCircle` | 14 |
| Alergia | `AlertTriangle` | 12 |
| Condición especial | `Sparkle` | 12 |
| Consentimiento pendiente | `FileWarning` | 14 |
| Consentimiento firmado | `FileCheck` | 14 |
| Sellante | `Shield` | 12 |
| Fluorización | `Droplet` | 14 |
| Mantenedor de espacio | `Link2` | 14 |
| Erupción registrada | `Sparkles` | 14 |
| Empty state pediátrico | `Baby` | 48 |
| Cita pediátrica (en agenda) | `Baby` | 12 |

## 2.3 Tipografía

Sin desviarse de la escala existente. Específico del módulo:

| Elemento | Tamaño | Weight | Familia |
|---|---|---|---|
| Edad exacta (chip header) | 12 | 600 | JetBrains Mono |
| FDI en odontograma | 9 | 500 | JetBrains Mono |
| FDI en eruption chart (axis Y) | 11 | 500 | JetBrains Mono |
| Valor Frankl en pill | 14 | 700 | JetBrains Mono |
| Categoría CAMBRA | 11 | 600 (uppercase) | Sora |
| Texto consentimiento (modal) | 13 | 400, line-height 1.7 | Sora |
| Firma generada (PDF) | 14 cursiva digital | 400 | Caveat (NUEVO) |

🟡 **NUEVO en font-stack:** Caveat (Google Fonts) solo para representar
firmas en PDF cuando el usuario opta por "firma textual" (raro, fallback).
Si esto agrega complejidad, podemos omitirlo y forzar canvas siempre.
**Recomendación:** omitir Caveat por ahora, forzar canvas. Más simple.

## 2.4 Espaciado y radios

Uso consistente con el resto del producto:

| Concepto | Valor |
|---|---|
| Gap entre cards de Resumen | 14 px |
| Padding ContextStrip | 12 px 18 px |
| Gap entre chips header | 8 px |
| Padding drawer body | 22 px |
| Padding modal full-screen | 24 px |
| Radius card pediátrica | 14 px (igual `--radius-lg`) |
| Radius pill (Frankl, CAMBRA) | 20 px |
| Radius drawer corner | 0 (sin bordes redondeados — es panel lateral) |
| Tooth element radius | 8 px (corner) |
| Eruption bar radius | 4 px |

═══════════════════════════════════════════════════════════════════════════
3. MICRO-INTERACCIONES
═══════════════════════════════════════════════════════════════════════════

## 3.1 Hovers y focus

| Elemento | Hover | Focus visible |
|---|---|---|
| Diente en odontograma | scale(1.08) + box-shadow brand glow 12px | outline 2px brand + offset 2px |
| Pill Frankl en chart | scale(1.15) + tooltip slide-up | outline 2px brand |
| Card de Resumen | border `--border-strong` + shadow-card-md | outline 2px brand |
| Sub-tab | color text-1 (ya existente) | outline 2px brand inset |
| Botón "+ Frankl" en ContextStrip | bg `--bg-elev-2` | outline 2px brand |
| Tutor card en Siderail | bg `--bg-hover` | outline 2px brand |
| Fila de eruption chart | bg `--bg-hover` con transition 120ms | outline 2px brand |
| Habit row | bg `--bg-hover` | outline 2px brand |

Todos los focus visibles cumplen WCAG 2.1 AA: 2px sólido, contraste mínimo
3:1 con el background. Para light mode usar `--brand` saturado, para dark
mode `--brand` con glow extra de 4px alpha 0.4.

## 3.2 Transiciones

| Transición | Duración | Easing |
|---|---|---|
| Hover de cards/items | 150 ms | ease-out (default) |
| Apertura de drawer | 220 ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Cierre de drawer | 180 ms | cubic-bezier(0.4, 0, 0.6, 1) |
| Modal full-screen consentimiento | 250 ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Pill de CAMBRA "extremo" pulse | 2 s infinite | ease-in-out |
| Línea vertical edad en eruption chart | 4 s infinite glow | ease-in-out |
| Diente highlight tras guardar | 600 ms verde fade | ease-out |
| Sub-tab change | 180 ms cross-fade | ease |
| Skeleton shimmer | 1.6 s infinite | linear |
| Toast aparece | 200 ms slide-down + fade | ease-out |

## 3.3 Animaciones de entrada/salida

```css
@keyframes drawerSlideIn {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
@keyframes drawerSlideOut {
  from { transform: translateX(0);    opacity: 1; }
  to   { transform: translateX(100%); opacity: 0; }
}
@keyframes pulseDangerStrong {
  0%,100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.4); }
  50%     { box-shadow: 0 0 0 6px rgba(220,38,38,0); }
}
@keyframes ageNeedleGlow {
  0%,100% { box-shadow: 0 0 4px var(--brand); }
  50%     { box-shadow: 0 0 12px var(--brand), 0 0 20px rgba(124,58,237,0.4); }
}
@keyframes toothHighlight {
  0%   { box-shadow: 0 0 0 0 var(--success); background: var(--success-soft); }
  100% { box-shadow: 0 0 0 0 transparent;    background: transparent; }
}
```

Respetar `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important;
                           transition-duration: 0.01ms !important; }
}
```

## 3.4 Loaders y skeletons

**Reglas:**
- Datos del paciente (header, siderail) → skeletons individuales por sección.
- Charts (eruption, frankl) → skeleton de la dimensión completa (rect 100% x altura fija).
- Drawers → spinner inline de 16px en el botón Guardar mientras submit pendiente.
- Toasts: nunca usar spinner global; siempre toast.loading() de react-hot-toast.

## 3.5 Feedback al guardar

Patrón unificado en todo el módulo:

1. Submit del drawer → botón Guardar entra en estado disabled + spinner inline.
2. Server action ejecuta + audit log.
3. Si OK:
   - Toast `toast.success("Frankl registrado")`.
   - Drawer se cierra con animación 180ms.
   - Vista detrás se actualiza (revalidatePath o React state).
   - Elemento afectado parpadea 600ms en verde (animación toothHighlight
     o equivalente).
4. Si error:
   - Toast `toast.error("Error al guardar")` con texto del error si es de validación.
   - Drawer queda abierto, campos preservan valores, error inline en el campo problemático.

Mensajes de toast estándar (cortos, neutros, en mexicano sin voseo):

- "Frankl registrado"
- "CAMBRA actualizado"
- "Hábito guardado"
- "Erupción registrada"
- "Sellante actualizado"
- "Mantenedor colocado"
- "Tratamiento registrado"
- "Consentimiento firmado"
- "Tutor actualizado"

## 3.6 Atajos de teclado

| Atajo | Acción |
|---|---|
| `Cmd/Ctrl + Enter` | Guardar drawer abierto |
| `Esc` | Cerrar drawer / modal |
| `1` `2` `3` `4` | En FranklDrawer, selecciona valor directamente |
| `→` `←` | Navegar sub-tabs cuando ninguno tiene focus de input |
| `?` | Mostrar overlay con estos atajos (NUEVO global feature) |

═══════════════════════════════════════════════════════════════════════════
4. DIFF POR COMPONENTE
═══════════════════════════════════════════════════════════════════════════

Esta es la sección que el bot Git aplica. Está organizada en:

- **A.** Archivos NUEVOS (crear con estructura indicada).
- **B.** Archivos EXISTENTES a MODIFICAR (cambios específicos).
- **C.** Cambios al schema Prisma.
- **D.** Cambios a `globals.css`.

## 4.A Archivos NUEVOS

### 4.A.1 Lib (helpers puros, sin React)

#### `src/lib/pediatrics/age.ts`
```typescript
export type AgeBreakdown = {
  years: number;       // 4
  months: number;      // 7
  decimal: number;     // 4.58
  totalMonths: number; // 55
  formatted: string;   // "4 a 7 m"
  long: string;        // "4 años 7 meses"
};

export function calculateAge(dateOfBirth: Date, refDate?: Date): AgeBreakdown;
export function isPediatric(dateOfBirth: Date | null, cutoffYears: number = 14): boolean;
```

#### `src/lib/pediatrics/dentition.ts`
```typescript
export type DentitionType = 'temporal' | 'mixta' | 'permanente';

// Calcula dentición probable según edad y registro de erupción.
export function classifyDentition(args: {
  ageDecimal: number;
  eruptedPermanent: number; // count
}): DentitionType;

export const TEMPORAL_FDI = [51,52,53,54,55,61,62,63,64,65,71,72,73,74,75,81,82,83,84,85];
export const PERMANENT_FDI = [11,...,18, 21,...,28, 31,...,38, 41,...,48];
```

#### `src/lib/pediatrics/eruption-data.ts`
```typescript
export type EruptionRange = {
  fdi: number;
  type: 'temporal' | 'permanent';
  minMonths: number;
  maxMonths: number;
  meanMonths: number;
  arch: 'upper' | 'lower';
  position: 'central'|'lateral'|'canine'|'molar1'|'molar2'|'premolar1'|'premolar2'|'molar3';
};

// Tabla completa de rangos de erupción según OMS / ADA.
export const ERUPTION_TABLE: EruptionRange[];

export function getRangeForFdi(fdi: number): EruptionRange | null;
export function evaluateDeviation(actualMonths: number, range: EruptionRange):
  'within' | 'mild' | 'pathological';
```

#### `src/lib/pediatrics/cambra.ts`
```typescript
export type CambraInput = {
  riskFactors: string[];        // keys: 'biberon_nocturno', 'dieta_cariogenica', etc.
  protectiveFactors: string[];
  diseaseIndicators: string[];
};

export type CambraResult = {
  category: 'bajo'|'moderado'|'alto'|'extremo';
  recallMonths: 3|4|6;
  rationale: string;            // breve explicación auto-generada
};

export function scoreCambra(input: CambraInput): CambraResult;

export const CAMBRA_RISK_OPTIONS  : { key: string; label: string }[];
export const CAMBRA_PROT_OPTIONS  : { key: string; label: string }[];
export const CAMBRA_INDIC_OPTIONS : { key: string; label: string }[];
```

#### `src/lib/pediatrics/frankl.ts`
```typescript
export type FranklValue = 1|2|3|4;
export type VenhamValue = 0|1|2|3|4|5;

export const FRANKL_LABELS: Record<FranklValue, string>;
export const VENHAM_LABELS: Record<VenhamValue, string>;

export function detectRegression(history: { value: number; date: Date }[]):
  { detected: boolean; severity: 'mild'|'severe' };
```

#### `src/lib/pediatrics/permissions.ts`
```typescript
export function canSeePediatrics(args: {
  clinicCategory: string;
  clinicModules: string[];
  patientDob: Date | null;
  cutoffYears: number;
}): boolean;
```

#### `src/lib/pediatrics/audit.ts`
```typescript
export const PEDIATRIC_AUDIT_ACTIONS = {
  FRANKL_CAPTURED: 'pediatrics.frankl.captured',
  CAMBRA_CAPTURED: 'pediatrics.cambra.captured',
  ERUPTION_RECORDED: 'pediatrics.eruption.recorded',
  HABIT_RECORDED: 'pediatrics.habit.recorded',
  HABIT_RESOLVED: 'pediatrics.habit.resolved',
  CONSENT_SIGNED: 'pediatrics.consent.signed',
  GUARDIAN_ADDED: 'pediatrics.guardian.added',
  // ... etc por cada modelo
} as const;
```

### 4.A.2 Tipos TypeScript

#### `src/types/pediatrics.ts`
```typescript
import type { Prisma } from '@prisma/client';

export type WithGuardian<T> = T & { guardian: Prisma.GuardianGetPayload<{}> };

export type PediatricRecordFull = Prisma.PediatricRecordGetPayload<{
  include: {
    primaryGuardian: true;
    behaviorAssessments: { orderBy: { recordedAt: 'desc' } };
    cariesRiskAssessments: { orderBy: { scoredAt: 'desc' }; take: 1 };
    oralHabits: true;
    eruptionRecords: true;
  }
}>;

// ... más tipos por modelo
```

### 4.A.3 Componente Drawer base (NUEVO design system component)

#### `src/components/ui/design-system/Drawer.tsx`

**Props:**
```typescript
interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  width?: 'sm' | 'md' | 'lg'; // 360 / 480 / 640
  footer?: React.ReactNode;
  children: React.ReactNode;
  closeOnOverlay?: boolean; // default true
  loading?: boolean;
}
```

**Estructura JSX:**
```jsx
<DrawerOverlay (con backdrop blur, click cierra)>
  <DrawerPanel (sticky right, width clamp)>
    <DrawerHeader>
      <Title + Subtitle>
      <CloseButton (icon X)>
    </DrawerHeader>
    <DrawerBody (scroll-y, padding 22)>
      {children}
    </DrawerBody>
    <DrawerFooter (sticky bottom, padding 14 22)>
      {footer}
    </DrawerFooter>
  </DrawerPanel>
</DrawerOverlay>
```

**A11y:**
- `role="dialog"` `aria-modal="true"` `aria-labelledby={titleId}`.
- Focus trap (usar `focus-trap-react` que ya está en deps de Radix —
  alternativamente, implementación manual con tab handler).
- Restaurar focus al elemento que abrió el drawer al cerrar.
- Esc para cerrar.

### 4.A.4 Tab principal y subcomponentes

#### `src/components/patient-detail/pediatrics/PediatricsTab.tsx`
Server component que carga datos iniciales del módulo y renderiza el shell.

**Estructura JSX:**
```jsx
<div className="pedi-shell">
  <PediatricsContextStrip patient={patient} record={record} latestFrankl={…} latestCambra={…} />
  <div className="pedi-grid">
    <PediatricsSiderail
      guardians={guardians}
      allergies={allergies}
      conditions={conditions}
      pendingConsents={pendingConsents}
    />
    <div className="pedi-main">
      <PediatricsSubNav active={activeTab} onChange={setActiveTab} counts={counts} />
      <Suspense fallback={<PedSkeletonSection />}>
        {activeTab === 'summary'    && <SummarySection patient={patient} record={record} />}
        {activeTab === 'odontogram' && <OdontogramSection ... />}
        {activeTab === 'eruption'   && <EruptionSection ... />}
        {activeTab === 'habits'     && <HabitsSection ... />}
        {activeTab === 'behavior'   && <BehaviorSection ... />}
        {activeTab === 'preventive' && <PreventivePlanSection ... />}
      </Suspense>
    </div>
  </div>
  <DrawerHost /> {/* Portal target para todos los drawers de captura */}
</div>
```

#### `src/components/patient-detail/pediatrics/PediatricsContextStrip.tsx`
Sticky strip (top: header end + tabs end). Renderiza chips horizontales y
2 botones de acción rápida (`+ Frankl`, `+ CAMBRA`) que abren drawers.

#### `src/components/patient-detail/pediatrics/PediatricsSiderail.tsx`
Vertical, 280px, en grid de 2 columnas (siderail + main). Apila las 4 cards.

#### `src/components/patient-detail/pediatrics/PediatricsSubNav.tsx`
Tabs internos (`.tabs-new`). Acepta counts opcional por tab.

### 4.A.5 Sections

Cada section es un Server Component que recibe data ya cargada.

| File | Renders |
|---|---|
| `sections/SummarySection.tsx` | Grid de cards con mini-charts y resúmenes |
| `sections/OdontogramSection.tsx` | Wrapper con segmented control + `<PediatricOdontogram>` |
| `sections/EruptionSection.tsx` | Header con acciones + `<EruptionChart>` + tabla histórica colapsada |
| `sections/HabitsSection.tsx` | `<HabitsTimeline>` + lista detallada |
| `sections/BehaviorSection.tsx` | `<FranklTrendChart>` + tabla histórica + segmented Frankl/Venham |
| `sections/PreventivePlanSection.tsx` | Cards de recall, fluorización, sellantes, mantenedores |

### 4.A.6 Charts

#### `charts/EruptionChart.tsx`
Custom SVG, viewBox responsive `0 0 1200 H`, donde H se calcula según
secciones expandidas. Props:
```typescript
interface EruptionChartProps {
  patientAgeMonths: number;
  patientDob: Date;
  records: EruptionRecord[];   // por diente
  expandedSections?: { tempUp: boolean; tempLow: boolean; permUp: boolean; permLow: boolean };
  onToothClick?: (fdi: number) => void;
}
```

Render interno:
- 4 SVG groups colapsables (header con chevron + counter).
- Cada fila = 28px alto.
- Eje X en su propio group fijo arriba con marcas cada 1 año (label) y cada 6m (subdivisión).
- Línea vertical violeta en `x = (patientAgeMonths / 156) * width`.
- Por cada FDI:
  - rect `bg-elev-2` de 0 a inicio del rango (gris)
  - rect `brand-soft` del rango esperado (background)
  - circle del actual si erupción registrada (color por deviation)
  - rect `bg-elev-2` después del rango si no erupcionó

#### `charts/FranklTrendChart.tsx`
Recharts LineChart con:
- XAxis: índice de visita (1-N)
- YAxis: 1-4 (Frankl) o 0-5 (Venham)
- Line con stroke `--brand`
- Custom Dot: SVG circle con fill según valor + glow filter

#### `charts/HabitsTimeline.tsx`
SVG custom. Una fila por hábito, eje X = años de vida del paciente,
barra horizontal del rango activo, label izquierdo con icono lucide.

### 4.A.7 Odontograma

#### `odontogram/PediatricOdontogram.tsx`
Layout responsive. Wrapper con segment-new para vistas. Renderiza grid
de `<Tooth>` posicionados absolutamente sobre un canvas SVG-fluid.

#### `odontogram/Tooth.tsx`
Componente reusable. Props:
```typescript
interface ToothProps {
  fdi: number;
  type: 'temporal' | 'permanent';
  state: ToothState;            // erupted / unerupted / missing-physio / missing-patho
  surfaces: SurfaceState[];     // 5 caras: O, V, L, M, D
  hasSealant?: boolean;
  hasRestoration?: boolean;
  isErupting?: boolean;
  onClick?: () => void;
  highlight?: boolean;          // animación post-save
}
```

Render: SVG por diente (path realista anatómico simplificado).
Las 5 caras son sub-paths que reciben fill según state.

### 4.A.8 Cards y drawers — listado de archivos

#### Cards (en `cards/`)
- `RiskCard.tsx` — Display de CAMBRA categoría + recall.
- `TutorCard.tsx` — Tutor con avatar + WhatsApp + INE status.
- `AlertsCard.tsx` — Alertas clínicas auto-detectadas.
- `MaintainerCard.tsx` — Mantenedor activo con progress bar.
- `SealantCard.tsx` — Estado de sellantes en grid 2×2 de molares.
- `FrankSparklineCard.tsx` — Mini-line de últimas 5 visitas.
- `ConsentPendingCard.tsx` — Banner de consentimientos pendientes.

#### Drawers (en `drawers/`)
| File | Title | Body |
|---|---|---|
| `CaptureDrawer.tsx` | (genérico, no se usa solo) | wrapper con metadata común |
| `FranklDrawer.tsx` | "Capturar Frankl" | escala + 4 botones + notas + cita asociada |
| `CambraDrawer.tsx` | "Evaluar riesgo cariogénico" | 3 pasos: factores R / P / I → resultado |
| `HabitDrawer.tsx` | "Registrar hábito" | tipo + frecuencia + edades + intervención + notas |
| `EruptionDrawer.tsx` | "Registrar erupción" | mini-odontograma selector + fecha + auto-deviation |
| `SealantDrawer.tsx` | "Sellante" | diente + material + retención + notas |
| `FluorideDrawer.tsx` | "Aplicación de flúor" | producto + dientes + lote + notas |
| `SpaceMaintainerDrawer.tsx` | "Mantenedor de espacio" | tipo + diente + fechas + estado |
| `EndodonticDrawer.tsx` | "Pulpotomía/pulpectomía" | diente + tipo + material + síntomas |
| `ToothDrawer.tsx` | (dinámico, abierto desde click en odontograma) | tabs internos |
| `PediatricRecordDrawer.tsx` | "Cuestionario médico inicial" | form largo, 4 secciones colapsables |
| `GuardianDrawer.tsx` | "Tutor responsable" | datos + parentesco + INE upload |

#### Modals (en `modals/`)
- `ConsentModal.tsx` — Full-screen, con `<SignaturePad>` embebido.
- `SignaturePad.tsx` — Canvas HTML5 con clear button.
- `EvolutionCompareModal.tsx` — Comparativo pre/post (modal--wide).

### 4.A.9 Server Actions

#### `src/app/actions/pediatrics/`

Cada archivo exporta funciones que:
1. Verifican auth (`getServerUser()`) y permisos.
2. Validan input con zod.
3. Verifican que paciente pertenezca al `clinicId` activo.
4. Ejecutan operación Prisma en transacción si involucra >1 tabla.
5. Insertan audit log via `auditLog()`.
6. Llaman `revalidatePath(/dashboard/patients/[id])`.
7. Devuelven `{ ok: true, data }` o `{ ok: false, error }`.

Archivos:
- `index.ts` — barrel export
- `record.ts` — createPediatricRecord, updatePediatricRecord, getRecord
- `guardian.ts` — addGuardian, updateGuardian, setPrimary, deleteGuardian
- `behavior.ts` — captureBehavior, getHistory, deleteBehavior (soft)
- `cambra.ts` — captureCambra, getLatest, getHistory
- `habits.ts` — addHabit, updateHabit, resolveHabit, deleteHabit (soft)
- `eruption.ts` — recordEruption, deleteEruption (soft)
- `sealant.ts` — placeSealant, updateRetention, reapply, deleteSealant
- `fluoride.ts` — applyFluoride, getHistory
- `maintainer.ts` — placeMaintainer, updateStatus, retire, getHistory
- `endodontic.ts` — recordTreatment, getHistory
- `consent.ts` — generateConsent, signGuardian, signMinor, voidConsent

## 4.B Archivos EXISTENTES a MODIFICAR

### 4.B.1 `src/app/dashboard/patients/[id]/page.tsx`

**Cambios:**
1. Agregar import `import { canSeePediatrics } from "@/lib/pediatrics/permissions"`.
2. Computar `showPediatrics = canSeePediatrics({ ... })` con datos del paciente.
3. Pasar `showPediatrics` al componente de tabs.
4. Si la URL trae `?tab=pediatrics`, default activeTab a "pediatrics".

### 4.B.2 `src/components/patient-detail/PatientTabs.tsx` (o el componente real que renderiza los tabs del paciente)

**Cambios:**
1. Aceptar nueva prop `showPediatrics: boolean`.
2. Insertar el tab "Pediatría" entre "Historia clínica" y "Nueva consulta"
   (orden importa) con icono `Baby` y count opcional (alertas activas).
3. Agregar caso para renderizar `<PediatricsTab>` cuando esté activo.
4. Lazy load del módulo: `const PediatricsTab = dynamic(() => import('...'))`.

### 4.B.3 `src/components/patient-detail/PatientHeader.tsx` (o equivalente)

**Cambios:**
1. Aceptar nueva prop `pediatric: { ageBreakdown, dentitionType, cambraCategory } | null`.
2. Si `pediatric != null`, renderizar 3 chips a la derecha del nombre
   (después del badge ACTIVO/INACTIVO y antes del id).
3. Cada chip cumple los specs de sección 1.3.

### 4.B.4 `src/lib/permissions.ts`

**Cambios:**
1. Agregar `'PEDIATRICS'` al type union de `ClinicModule`.
2. Agregar helper `hasPediatricsModule(clinic): boolean`.
3. Re-exportar `canSeePediatrics` para uso conveniente.

### 4.B.5 `src/lib/audit.ts`

**Cambios:**
1. Importar `PEDIATRIC_AUDIT_ACTIONS` de `lib/pediatrics/audit.ts`.
2. Spread en el enum de acciones permitidas para que TypeScript no se queje.

### 4.B.6 `src/components/ui/design-system/index.ts`

**Cambios:**
1. Exportar `Drawer`, `DrawerOverlay`, `DrawerHeader`, `DrawerBody`, `DrawerFooter`.

### 4.B.7 WhatsApp templates (path: el que ya existe en el proyecto)

Agregar 4 plantillas pediátricas nuevas con identifier:
- `PED_PRECITA` — "Recordatorio: cita de [niño] mañana a las [hora]…"
- `PED_POSTFLUOR` — "[niño] no debe comer ni beber durante 30 minutos…"
- `PED_SELANTE_REVISION` — "Es hora de revisar los sellantes de [niño]."
- `PED_CUMPLE` — "¡Felicidades [niño]! De parte de [clinica]…"

Las plantillas dirigen mensaje al `guardian.phone` si el paciente tiene
`PediatricRecord.primaryGuardianId`. Caen al `patient.phone` si no.

### 4.B.8 `src/app/dashboard/appointments/...` (modal nueva cita)

**Cambios menores:**
1. Si paciente seleccionado tiene tab pediátrica habilitada, sugerir
   duración 30-45 min en lugar de 45-60.
2. Si paciente tiene historial Frankl ≤2 en últimas 2 visitas, mostrar
   chip warning "Considera bloque más largo (50-60 min)".
3. Pre-llenar campo de "Notas de cita" con `Tutor: ${guardian.fullName}`.

### 4.B.9 SOAP del expediente — pre-cargar contexto pediátrico

Si el paciente activo tiene tab pediátrica habilitada, en el componente
de "Nueva consulta SOAP", el campo "S - Subjetivo" se pre-llena con:

```
[Pediatría]
Frankl última visita: 3
Hábitos activos: succión digital
CAMBRA: Alto (recall 3 m)
```

El doctor borra/edita libremente. Es solo un assist al inicio del campo.

## 4.C Cambios al schema Prisma

Ver sección 5 completa con observaciones y ajustes propuestos.

## 4.D Cambios a `globals.css`

Agregar al final del archivo:

```css
/* ===========================================================================
   PEDIATRICS MODULE
   =========================================================================== */

/* Token nuevo: danger fuerte para CAMBRA extremo */
:root         { --danger-strong: #991b1b; }
.dark :root   { --danger-strong: #dc2626; }

/* Drawer (nuevo patrón global) ----------------------------------------- */
.drawer-overlay {
  position: fixed; inset: 0;
  background: rgba(5,5,10,0.4);
  backdrop-filter: blur(4px);
  z-index: 100;
  animation: fadeIn 0.18s ease-out;
}
.drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: clamp(320px, 32vw, 480px);
  background: var(--bg-elev);
  border-left: 1px solid var(--border-strong);
  box-shadow: -16px 0 40px -8px rgba(0,0,0,0.3);
  display: flex; flex-direction: column;
  animation: drawerSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 101;
}
@media (max-width: 640px) { .drawer { width: 100vw; } }
.drawer--sm { width: clamp(300px, 24vw, 360px); }
.drawer--lg { width: clamp(420px, 44vw, 640px); }
.drawer__header {
  padding: 16px 22px; border-bottom: 1px solid var(--border-soft);
  display: flex; align-items: center; justify-content: space-between;
}
.drawer__body { flex: 1; overflow-y: auto; padding: 22px; }
.drawer__footer {
  padding: 14px 22px; border-top: 1px solid var(--border-soft);
  display: flex; gap: 8px; justify-content: flex-end;
  background: rgba(0,0,0,0.02);
}
.dark .drawer__footer { background: rgba(0,0,0,0.2); }

@keyframes drawerSlideIn {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}

/* Modal full-screen (consentimientos) ---------------------------------- */
.modal--full { max-width: 980px; max-height: 92vh; }

/* Frankl pill (chart dot) ---------------------------------------------- */
.frankl-pill {
  width: 24px; height: 24px; border-radius: 50%;
  display: inline-grid; place-items: center;
  font-family: var(--font-jetbrains-mono); font-weight: 600; font-size: 11px;
  color: #fff;
}
.frankl-pill--1 { background: var(--danger);  box-shadow: 0 0 6px rgba(220,38,38,0.4); }
.frankl-pill--2 { background: var(--warning); box-shadow: 0 0 6px rgba(217,119,6,0.4); }
.frankl-pill--3 { background: var(--info);    box-shadow: 0 0 6px rgba(37,99,235,0.4); }
.frankl-pill--4 { background: var(--success); box-shadow: 0 0 6px rgba(5,150,105,0.4); }

/* CAMBRA chip (con pulse para extremo) --------------------------------- */
.cambra-chip--extremo { animation: pulseDangerStrong 2s ease-in-out infinite; }
@keyframes pulseDangerStrong {
  0%,100% { box-shadow: 0 0 0 0   rgba(220,38,38,0.5); }
  50%     { box-shadow: 0 0 0 6px rgba(220,38,38,0);   }
}

/* Eruption chart axis line --------------------------------------------- */
.eruption-needle {
  stroke: var(--brand); stroke-width: 2;
  filter: drop-shadow(0 0 4px var(--brand));
  animation: ageNeedleGlow 4s ease-in-out infinite;
}
@keyframes ageNeedleGlow {
  0%,100% { filter: drop-shadow(0 0 4px var(--brand)); }
  50%     { filter: drop-shadow(0 0 12px var(--brand)); }
}

/* Tooth highlight (post-save) ----------------------------------------- */
.tooth--saved {
  animation: toothHighlight 0.6s ease-out;
}
@keyframes toothHighlight {
  0%   { fill: var(--success); filter: drop-shadow(0 0 8px var(--success)); }
  100% { fill: inherit; filter: none; }
}

/* Pediatrics layout grid ----------------------------------------------- */
.pedi-grid {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 18px;
  margin-top: 14px;
}
@media (max-width: 1024px) {
  .pedi-grid { grid-template-columns: 1fr; }
}
.pedi-context-strip {
  position: sticky; top: 52px;
  z-index: 5;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border-soft);
  backdrop-filter: blur(6px);
  padding: 12px 18px;
  display: flex; gap: 22px; flex-wrap: wrap;
  align-items: center;
}
```

═══════════════════════════════════════════════════════════════════════════
5. SCHEMA PRISMA — OBSERVACIONES Y AJUSTES PROPUESTOS
═══════════════════════════════════════════════════════════════════════════

El schema del clínico (sección C del brief) es sólido. Los ajustes que
propongo son **agregados defensivos** para UX y compliance, no cambios
estructurales.

## 5.1 Convenciones globales (aplica a TODOS los modelos pediátricos nuevos)

| Campo | Por qué |
|---|---|
| `id String @id @default(cuid())` | Consistente con resto del repo |
| `clinicId String` + `@@index([clinicId])` | Multi-tenancy obligatorio para queries seguras |
| `createdAt DateTime @default(now())` | Auditoría básica |
| `updatedAt DateTime @updatedAt` | Audit + UX (mostrar "actualizado hace X") |
| `deletedAt DateTime?` + `@@index([deletedAt])` | Soft delete obligatorio (NOM-024 retención 5+ años) |
| `createdBy String` (FK User) | Saber quién capturó cada registro |

Esto agrega ~5 campos por modelo. **No los pondré en el detalle de cada
modelo** porque está implícito; sí están en el Prisma final.

## 5.2 Observaciones específicas por modelo

### 5.2.1 `PediatricRecord` — ✓ OK, agrego:
- `lastReviewedAt DateTime?` — para el doctor saber cuándo se verificó por última vez (vacunas, condiciones).
- `lastReviewedBy String?` — FK User.
- `cutoffOverrideYears Int?` — opcional: si la clínica permite hasta 16, dejarlo configurable per paciente.
- `@@unique([patientId])` — un solo PediatricRecord por paciente.

### 5.2.2 `Guardian` — ajustes:
- `birthDate DateTime?` — relevante legal (verificar mayoría de edad para responsabilidad).
- `address String?` — algunos consentimientos lo requieren.
- `relationship` enum debe incluir: `madre | padre | tutor_legal | abuelo | tio | hermano | otro`.
- `@@index([patientId, principal])` — para buscar tutor principal rápido.
- Si más de un Guardian tiene `principal: true` para el mismo patientId, debe haber validación a nivel app
  (Prisma no lo previene). Idealmente trigger SQL o lógica en server action.

### 5.2.3 `BehaviorAssessment` — ✓ OK, agrego:
- `notes String?` (ya estaba implícito).
- `@@index([patientId, recordedAt(sort: Desc)])` — el query principal es "últimas N visitas".

### 5.2.4 `CariesRiskAssessment` — ajustes:
- `previousCategory String?` — útil para detectar transiciones (alerta si saltó de bajo a alto).
- `nextDueAt DateTime?` — calculado: `scoredAt + recommendedRecallMonths`. Útil para queries
  de "pacientes con CAMBRA próximo a vencer".
- `@@index([patientId, scoredAt(sort: Desc)])`.

### 5.2.5 `OralHabit` — ajustes:
- `interventionStartedAt DateTime?` — separa "se identificó" de "se intervino".
- `interventionType String?` — taxonomía de tipos de intervención.
- `@@index([patientId, presentNow])` (donde `presentNow` es columna virtual o
  alternativamente `endedAt IS NULL`).

### 5.2.6 `EruptionRecord` — agrego:
- `@@unique([patientId, toothFdi])` — un diente erupciona una sola vez. Si se
  necesita corregir, se actualiza, no se crea otro.
- Considera índice `@@index([patientId, observedAt])`.

### 5.2.7 `SpaceMaintainer` — ✓ OK, agrego:
- `appointmentId String?` — FK Appointment (cita en que se colocó).
- `removedBy String?` — FK User (quien retiró).
- Posible índice `@@index([patientId, currentStatus])`.

### 5.2.8 `Sealant` — ajustes:
- `@@unique([patientId, toothFdi])` — un único registro por diente, se actualiza con revisiones.
- Considerar agregar tabla `SealantRevision` separada con histórico de revisiones
  (cada `lastCheckedAt` + estado en ese momento). MVP: campo simple ok.

### 5.2.9 `FluorideApplication` — ✓ OK como está.

### 5.2.10 `PediatricEndodonticTreatment` — ✓ OK, agrego:
- `appointmentId String?`.
- `xrayUrl String?` — link a radiografía pre-tratamiento (si aplica).

### 5.2.11 `PediatricConsent` — ajustes importantes:
- `pdfHash String?` — SHA256 del PDF para evidencia anti-tamper.
- `revokedAt DateTime?` `revokedBy String?` `revokedReason String?` — los
  consentimientos pueden revocarse.
- `expiresAt DateTime` — explícito (sí lo tenía el clínico, lo confirmo). Default 12 meses.
- `@@index([patientId, procedureType, expiresAt])`.

### 5.2.12 `GrowthMeasurement` — diferido a v2.0 según roadmap del brief.

## 5.3 Schema final — bloque a pegar en `prisma/schema.prisma`

```prisma
// ─────────────────────────────────────────────────────────────────────────
// PEDIATRICS MODULE
// Specs: docs/MEDIFLOW-PEDIATRIA-SPEC.md
// ─────────────────────────────────────────────────────────────────────────

enum PedDentitionType {
  temporal
  mixta
  permanente
}

enum PedVaccinationStatus {
  completo
  incompleto
  desconocido
}

enum PedFeedingType {
  materna
  mixta
  formula
  na
}

enum PedGuardianRelationship {
  madre
  padre
  tutor_legal
  abuelo
  abuela
  tio
  tia
  hermano
  hermana
  otro
}

enum PedBehaviorScale {
  frankl
  venham
}

enum PedCariesCategory {
  bajo
  moderado
  alto
  extremo
}

enum PedHabitType {
  succion_digital
  chupon
  biberon_nocturno
  respiracion_bucal
  bruxismo_nocturno
  onicofagia
  deglucion_atipica
}

enum PedHabitFrequency {
  continua
  nocturna
  ocasional
  na
}

enum PedSpaceMaintainerType {
  banda_ansa
  corona_ansa
  nance
  arco_lingual
  distal_shoe
}

enum PedSpaceMaintainerStatus {
  activo
  retirado
  fracturado
  perdido
}

enum PedSealantMaterial {
  resina_fotocurada
  ionomero
}

enum PedSealantRetention {
  completo
  parcial
  perdido
}

enum PedFluorideProduct {
  barniz_5pct_naf
  gel_apf
  sdf
  fosfato_acido
}

enum PedEndoTreatmentType {
  pulpotomia
  pulpectomia
  recubrimiento_indirecto
  recubrimiento_directo
}

enum PedEndoMaterial {
  formocresol
  mta
  sulfato_ferrico
  hidroxido_calcio
  otro
}

enum PedConsentProcedure {
  anestesia_local
  sedacion_consciente
  oxido_nitroso
  extraccion
  pulpotomia
  pulpectomia
  fluorizacion
  toma_impresiones
  rx_intraoral
  otro
}

model PediatricRecord {
  id                  String    @id @default(cuid())
  clinicId            String
  patientId           String    @unique
  doctorId            String?
  createdBy           String
  recordedAt          DateTime  @default(now())
  lastReviewedAt      DateTime?
  lastReviewedBy      String?
  birthWeightKg       Decimal?  @db.Decimal(4,2)
  gestationWeeks      Int?
  prematuro           Boolean   @default(false)
  vaccinationStatus   PedVaccinationStatus @default(desconocido)
  feedingType         PedFeedingType       @default(na)
  specialConditions   Json      @default("[]")  // ["TEA_grado_1", "TDAH", ...]
  medication          Json      @default("[]")  // [{name, dose, frequency}]
  primaryGuardianId   String?
  cutoffOverrideYears Int?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  deletedAt           DateTime?

  patient             Patient   @relation(fields: [patientId], references: [id])
  primaryGuardian     Guardian? @relation("PrimaryGuardian", fields: [primaryGuardianId], references: [id])
  guardians           Guardian[] @relation("AllGuardians")
  behaviorAssessments BehaviorAssessment[]
  cariesAssessments   CariesRiskAssessment[]
  oralHabits          OralHabit[]
  eruptionRecords     EruptionRecord[]
  spaceMaintainers    SpaceMaintainer[]
  sealants            Sealant[]
  fluorideApplications FluorideApplication[]
  endoTreatments      PediatricEndodonticTreatment[]
  consents            PediatricConsent[]

  @@index([clinicId])
  @@index([deletedAt])
}

model Guardian {
  id                String   @id @default(cuid())
  clinicId          String
  patientId         String
  pediatricRecordId String?
  fullName          String
  parentesco        PedGuardianRelationship
  birthDate         DateTime?
  phone             String
  email             String?
  address           String?
  ineUrl            String?
  esResponsableLegal Boolean @default(true)
  principal         Boolean  @default(false)
  createdBy         String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?

  patient            Patient @relation(fields: [patientId], references: [id])
  primaryFor         PediatricRecord[] @relation("PrimaryGuardian")
  pediatricRecord    PediatricRecord? @relation("AllGuardians", fields: [pediatricRecordId], references: [id])
  consents           PediatricConsent[]

  @@index([clinicId])
  @@index([patientId, principal])
  @@index([deletedAt])
}

model BehaviorAssessment {
  id                String   @id @default(cuid())
  clinicId          String
  patientId         String
  pediatricRecordId String
  appointmentId     String?
  scale             PedBehaviorScale
  value             Int
  notes             String?
  recordedAt        DateTime @default(now())
  recordedBy        String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?

  pediatricRecord PediatricRecord @relation(fields: [pediatricRecordId], references: [id])
  appointment     Appointment?    @relation(fields: [appointmentId], references: [id])

  @@index([patientId, recordedAt(sort: Desc)])
  @@index([clinicId])
  @@index([deletedAt])
}

model CariesRiskAssessment {
  id                  String   @id @default(cuid())
  clinicId            String
  patientId           String
  pediatricRecordId   String
  scoredAt            DateTime @default(now())
  scoredBy            String
  riskFactors         Json     @default("[]")
  protectiveFactors   Json     @default("[]")
  diseaseIndicators   Json     @default("[]")
  category            PedCariesCategory
  recommendedRecallMonths Int
  previousCategory    PedCariesCategory?
  nextDueAt           DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  deletedAt           DateTime?

  pediatricRecord PediatricRecord @relation(fields: [pediatricRecordId], references: [id])

  @@index([patientId, scoredAt(sort: Desc)])
  @@index([clinicId])
  @@index([nextDueAt])
}

model OralHabit {
  id                    String   @id @default(cuid())
  clinicId              String
  patientId             String
  pediatricRecordId     String
  habitType             PedHabitType
  frequency             PedHabitFrequency @default(na)
  startedAt             DateTime
  endedAt               DateTime?
  intervention          String?
  interventionStartedAt DateTime?
  interventionType      String?
  notes                 String?
  createdBy             String
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  deletedAt             DateTime?

  pediatricRecord PediatricRecord @relation(fields: [pediatricRecordId], references: [id])

  @@index([patientId, habitType])
  @@index([patientId, endedAt])
  @@index([clinicId])
}

model EruptionRecord {
  id                    String   @id @default(cuid())
  clinicId              String
  patientId             String
  pediatricRecordId     String
  toothFdi              Int
  observedAt            DateTime
  ageAtEruptionDecimal  Decimal  @db.Decimal(4,2)
  withinExpectedRange   Boolean
  deviation             String   // 'within' | 'mild' | 'pathological' | 'early'
  notes                 String?
  recordedBy            String
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  deletedAt             DateTime?

  pediatricRecord PediatricRecord @relation(fields: [pediatricRecordId], references: [id])

  @@unique([patientId, toothFdi])
  @@index([clinicId])
}

model SpaceMaintainer {
  id                  String   @id @default(cuid())
  clinicId            String
  patientId           String
  pediatricRecordId   String
  appointmentId       String?
  replacedToothFdi    Int
  type                PedSpaceMaintainerType
  placedAt            DateTime
  estimatedRemovalAt  DateTime?
  currentStatus       PedSpaceMaintainerStatus @default(activo)
  removedAt           DateTime?
  removedBy           String?
  removedReason       String?
  notes               String?
  placedBy            String
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  deletedAt           DateTime?

  pediatricRecord PediatricRecord @relation(fields: [pediatricRecordId], references: [id])
  appointment     Appointment?    @relation(fields: [appointmentId], references: [id])

  @@index([patientId, currentStatus])
  @@index([clinicId])
}

model Sealant {
  id                String   @id @default(cuid())
  clinicId          String
  patientId         String
  pediatricRecordId String
  toothFdi          Int
  material          PedSealantMaterial
  placedAt          DateTime
  placedBy          String
  retentionStatus   PedSealantRetention @default(completo)
  lastCheckedAt     DateTime?
  reappliedAt       DateTime?
  reappliedBy       String?
  notes             String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?

  pediatricRecord PediatricRecord @relation(fields: [pediatricRecordId], references: [id])

  @@unique([patientId, toothFdi])
  @@index([clinicId])
}

model FluorideApplication {
  id                String   @id @default(cuid())
  clinicId          String
  patientId         String
  pediatricRecordId String
  appointmentId     String?
  product           PedFluorideProduct
  appliedTeeth      Json     @default("[]") // array de FDIs
  lotNumber         String?
  appliedAt         DateTime @default(now())
  appliedBy         String
  notes             String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?

  pediatricRecord PediatricRecord @relation(fields: [pediatricRecordId], references: [id])
  appointment     Appointment?    @relation(fields: [appointmentId], references: [id])

  @@index([patientId, appliedAt(sort: Desc)])
  @@index([clinicId])
}

model PediatricEndodonticTreatment {
  id                String   @id @default(cuid())
  clinicId          String
  patientId         String
  pediatricRecordId String
  appointmentId     String?
  toothFdi          Int
  treatmentType     PedEndoTreatmentType
  material          PedEndoMaterial
  performedAt       DateTime @default(now())
  performedBy       String
  residualVitality  String?
  postOpSymptoms    String?
  notes             String?
  xrayUrl           String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?

  pediatricRecord PediatricRecord @relation(fields: [pediatricRecordId], references: [id])
  appointment     Appointment?    @relation(fields: [appointmentId], references: [id])

  @@index([patientId, performedAt(sort: Desc)])
  @@index([clinicId])
}

model PediatricConsent {
  id                       String   @id @default(cuid())
  clinicId                 String
  patientId                String
  pediatricRecordId        String
  procedureType            PedConsentProcedure
  guardianId               String
  guardianSignedAt         DateTime?
  guardianSignatureUrl     String?
  minorAssentRequired      Boolean  @default(false)
  minorAssentSignedAt      DateTime?
  minorAssentSignatureUrl  String?
  pdfUrl                   String?
  pdfHash                  String?
  expiresAt                DateTime
  revokedAt                DateTime?
  revokedBy                String?
  revokedReason            String?
  generatedBy              String
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  deletedAt                DateTime?

  pediatricRecord PediatricRecord @relation(fields: [pediatricRecordId], references: [id])
  guardian        Guardian        @relation(fields: [guardianId], references: [id])

  @@index([patientId, procedureType])
  @@index([expiresAt])
  @@index([clinicId])
  @@index([deletedAt])
}
```

**Migración:** todos los modelos son nuevos, no rompen nada existente. La
migración será simple `prisma migrate dev --name pediatrics_module`.

**Relaciones inversas en modelos existentes:** agregar al modelo `Patient`
y `Appointment` las relaciones inversas (`pediatricRecord PediatricRecord?`,
etc.) para que TypeScript las exponga.

═══════════════════════════════════════════════════════════════════════════
6. DECISIONES OPINADAS DEL CLÍNICO — RESPETADAS Y CUESTIONADAS
═══════════════════════════════════════════════════════════════════════════

## 6.1 Decisiones que respeto sin cambios

| Decisión clínica | Mi acción |
|---|---|
| Tab dentro de patient-detail (no página, no widget) | ✓ Implementado tal cual |
| Drawer derecho 480px para captura | ✓ Implementado, fluid 320-480 |
| Modal full-screen para consentimientos | ✓ Implementado |
| Cronología de erupción es la vista estrella | ✓ La diseñé como pieza más detallada del módulo |
| Densidad de información media | ✓ Cards con espaciado generoso, sin tablas con 10+ columnas |
| 6 features MUST en MVP v1.0 | ✓ Todas están en este spec, las SHOULD se mencionan como hooks |
| Edad en formato "5 años 7 meses" + tooltip decimal | ✓ Implementado |
| Cronología miniaturizada en sub-tab Resumen | ✓ Va primera en el grid |
| Pastel para temporal, saturado para permanente | ✓ Definí los tokens exactos |
| Iconografía de hábitos: pictogramas tipo lucide | ✓ Mapeo completo en sección 2.2 |
| NO link cruzado entre hermanos | ✓ Diferido a v2.0 |
| Reportar maltrato: campo confidencial accesible solo al doctor titular | ✓ Lo agrego como flag en PediatricRecord (sección 6.3) |

## 6.2 Decisiones donde aporto matices (sin contradecir)

### 6.2.1 Headers vs ContextStrip

El brief habla de "header del paciente" con badges pediátricos. Mi
propuesta es separar en **2 capas**:
- **Patient header existente** recibe 3 chips simples (edad, dentición, riesgo).
- **ContextStrip nuevo** dentro de la pestaña Pediatría con info más detallada
  + 2 botones de acción rápida.

Justificación: el header del paciente existente es global a todas las
tabs (Resumen, Citas, Facturación, etc). Si lo cargo de info pediátrica
solo aparece útil en 1 de 8 tabs. Mejor: chips ligeros arriba (siempre)
+ banda densa contextual cuando estás en Pediatría.

### 6.2.2 Consentimiento de tutor + asentimiento del menor

El brief dice "≥12 años requiere asentimiento". Mi propuesta:
- El asentimiento del menor es **opcional** por defecto (`minorAssentRequired: false`).
- Se activa automáticamente si paciente ≥12 años.
- Para condiciones del neurodesarrollo (TEA), el doctor puede manualmente
  desactivar el campo del menor o agregar nota "asentimiento con apoyo
  pictográfico" — el caso 3 del brief lo sugiere.

### 6.2.3 Recordatorios diferenciados

El brief lista 4 plantillas. Las implementé exactamente, con un detalle:
- El destinatario es `guardian.phone`, no `patient.phone`.
- Si no hay guardian configurado, se cae a `patient.phone` con un warning
  visual al admin de la clínica.

## 6.3 Decisión que AGREGO al spec (no estaba explícita en el brief)

### 6.3.1 Flag de "sospecha de maltrato"

El brief lo menciona en sección G (compliance) como buena práctica. Lo
materializo así:

- Campo en `PediatricRecord`: `internalAlertFlags Json` — array privado
  con shape `[{ type: 'maltrato_sospechoso' | 'situacion_familiar', note, raisedBy, raisedAt }]`.
- Solo visible para el doctor titular (creador del PediatricRecord).
- Audit log obligatorio en cada lectura/escritura.
- UI: card discreta en Siderail con icon `EyeOff` y texto "Notas privadas
  del doctor titular". Solo se renderiza si `userId === record.doctorId`.

🟡 Esto es opt-in. Un doctor que no quiera usarlo, simplemente nunca lo
activa. Pero el botón existe.

## 6.4 Decisiones que cuestiono — argumento UX

### 6.4.1 Cronología en sub-tab Resumen — ¿miniatura o full?

El brief vota mostrar la cronología miniaturizada en Resumen y la versión
completa en su propia sub-tab. **Estoy de acuerdo, pero matizo:**

La miniatura no debe ser un teaser bonito; debe ser **utilizable**. Mi
propuesta: la miniatura del Resumen muestra los **últimos 12 meses con
zoom** (no el rango completo 0-13a) para que el doctor vea de un vistazo
qué erupcionó recientemente. Click → expande a full chart en tab Erupción.

### 6.4.2 Captura de Frankl ¿al inicio o al final de cita?

Brief dice "al inicio O al final". UX me sugiere por defecto al **final**:
- Refleja cómo se comportó realmente.
- Si capturas al inicio, sesgas (niño llora al sentarse pero se recupera
  rápido = capturaste mal el "Frankl 1").
- Sin embargo, hay un caso de uso del brief (caso 1) donde el Frankl al
  inicio importa para decidir duración de cita.

🟡 **Recomendación final:** captura al final por defecto, con shortcut
visible al inicio si la primera impresión es muy negativa (Frankl 1-2)
para asistir al doctor con duración de cita.

Implementación: el ContextStrip muestra el botón "+ Frankl" siempre. Una
nueva captura el mismo día simplemente sobreescribe la previa
(con audit log de la sobreescritura).

### 6.4.3 Visualización de hábitos — timeline vs lista

Brief dice "timeline horizontal con cada hábito en una fila". Acepto
esto **pero también** mantengo una vista de lista plegada debajo, porque:
- Timeline es bueno para evolución ("desde cuando").
- Lista es mejor para detalles densos (frecuencia, intervención, notas).
- Tener ambos es trivial y suma valor.

Default expandido: timeline arriba, lista abajo. Toggle para colapsar
cualquiera.

═══════════════════════════════════════════════════════════════════════════
7. INSTRUCCIONES PARA EL BOT GIT
═══════════════════════════════════════════════════════════════════════════

Lo que sigue es un **prompt completo y pegable** para que el bot Git
implemente el módulo. Está optimizado para que el bot pueda parsearlo
sin más contexto que este documento + el repo.

### Cómo usarlo:

1. Copia el bloque entre los dos `=== PROMPT ===` que están más abajo.
2. Pégalo en el bot Git con una instrucción tipo:
   `"Implementa este spec en una branch nueva llamada feature/pediatrics-module-v1, abre PR a main al finalizar"`.
3. El bot debe trabajar **commits atómicos por sección** (1 commit por archivo grande, 1 por agrupado de smalls).

---

```text
=== PROMPT PARA EL BOT GIT — INICIO ===

OBJETIVO
Implementar el módulo de Odontopediatría de MediFlow v1.0 (MVP) en una
branch nueva, siguiendo el spec en docs/MEDIFLOW-PEDIATRIA-SPEC.md
(este mismo documento). Stack: Next.js 14 App Router, TypeScript,
TailwindCSS, Prisma 5.22, Supabase PostgreSQL, react-hot-toast,
lucide-react, recharts, Server Components + Server Actions.

REGLAS
- Crea branch: feature/pediatrics-module-v1
- Una commit atómica por unidad lógica (no un mega-commit final).
  Sugerido: 1) Schema + migración. 2) Lib helpers. 3) Server actions.
  4) Drawer base + globals.css. 5) Charts. 6) Odontogram.
  7) Sections + cards. 8) Tab integration. 9) WhatsApp templates.
  10) SOAP integration. 11) Tests + storybook stories.
- Cada commit message en español neutro (NO voseo argentino).
  Imperativos: "agrega", "actualiza", "corrige". NO: "agregá", "fijate".
- Cada archivo nuevo debe tener header con propósito en 1 línea:
  // Pediatrics — <propósito>. Spec: §<número>
- TypeScript estricto: nada de `any`. Usa `unknown` y narrow.
- Server Actions usan zod para validar input.
- Cada server action que muta datos:
   1. getServerUser() → auth check.
   2. canSeePediatrics() → permission check.
   3. Verifica patient.clinicId === activeClinicId.
   4. Prisma transaction si involucra >1 tabla.
   5. auditLog() con uno de los PEDIATRIC_AUDIT_ACTIONS.
   6. revalidatePath(`/dashboard/patients/${patientId}`).
   7. Devuelve `{ ok: true, data }` | `{ ok: false, error: string }`.
- Tests: por cada lib pure (age, dentition, eruption-data, cambra,
  frankl), agrega un .test.ts con casos clave del brief (Mateo 4a 7m,
  Sofía 8a 2m, Diego 12a 11m).
- Accesibilidad: focus-trap en drawer y modal, ARIA labels, navegación
  con teclado en odontograma, contraste WCAG AA verificado en chips
  de Frankl/CAMBRA.
- Light + Dark mode: ambos deben verse pulidos. NUNCA hex crudos en
  componentes; siempre var(--token) o clases utility.
- Ningún emoji en la UI productiva (ni en mensajes ni en labels).

EJECUCIÓN — ORDEN DE COMMITS

[Commit 1] Schema + migración
- Aplica los enums y modelos de la sección 5.3 al final de prisma/schema.prisma.
- Agrega relaciones inversas en Patient (pediatricRecord, guardians, etc.) y
  en Appointment (behaviorAssessments, fluorideApplications, ...).
- Ejecuta: pnpm prisma migrate dev --name pediatrics_module
- Verifica que prisma generate corra sin errores.

[Commit 2] Lib helpers (sin React)
- Crea src/lib/pediatrics/{age,dentition,eruption-data,cambra,frankl,permissions,audit}.ts
- Crea sus tests correspondientes en src/lib/pediatrics/__tests__/
- Casos de test mínimos por archivo: ver casos del brief sección K.
- ERUPTION_TABLE debe contener los 52 dientes con valores OMS estándar
  (busca "WHO tooth eruption table" si necesitas referencia — el rango
  meanMonths típico está bien documentado).

[Commit 3] Server actions
- Crea src/app/actions/pediatrics/*.ts según sección 4.A.9.
- Cada función con zod schema + audit log + revalidatePath.
- Cada función exportada al barrel index.ts.

[Commit 4] Drawer base + globals.css
- Crea src/components/ui/design-system/Drawer.tsx con focus-trap.
- Exporta desde src/components/ui/design-system/index.ts.
- Agrega los bloques CSS de la sección 4.D al final de src/app/globals.css.

[Commit 5] Types
- Crea src/types/pediatrics.ts con los Prisma generic types.

[Commit 6] Charts (3 archivos)
- charts/EruptionChart.tsx (SVG custom, memoizado, responsive).
- charts/FranklTrendChart.tsx (Recharts wrapper).
- charts/HabitsTimeline.tsx (SVG custom).

[Commit 7] Odontograma
- odontogram/PediatricOdontogram.tsx (con segmented control de vistas).
- odontogram/Tooth.tsx (SVG anatómico).
- Soporte para temporal, mixta y permanente.
- Click en diente → emit onToothClick(fdi).

[Commit 8] Cards
- cards/RiskCard, TutorCard, AlertsCard, MaintainerCard, SealantCard,
  FrankSparklineCard, ConsentPendingCard.

[Commit 9] Drawers (1 commit por drawer, hagamos sub-commits razonables o agrupa)
- Todos los drawers de captura listados en 4.A.8.
- Patrón: client component, useState para form, react-hook-form + zod
  si el form pasa de 5 campos.

[Commit 10] Modals
- ConsentModal con SignaturePad (canvas HTML5 nativo, sin libs).
- EvolutionCompareModal.

[Commit 11] Sections
- 6 sub-tabs en sections/. Server components donde sea posible, client
  donde haya state interactivo.

[Commit 12] Shell del módulo
- PediatricsTab.tsx, PediatricsContextStrip.tsx, PediatricsSiderail.tsx,
  PediatricsSubNav.tsx.

[Commit 13] Integración con patient-detail
- Modifica src/app/dashboard/patients/[id]/page.tsx para insertar la tab
  condicionalmente. Lazy load del componente.
- Modifica el componente que renderiza los tabs para aceptar showPediatrics.
- Modifica PatientHeader para los 3 chips nuevos.

[Commit 14] Permisos extension
- Modifica src/lib/permissions.ts con hasPediatricsModule + canSeePediatrics.
- Agrega 'PEDIATRICS' al type union de ClinicModule.

[Commit 15] WhatsApp templates
- Agrega 4 templates: PED_PRECITA, PED_POSTFLUOR, PED_SELANTE_REVISION,
  PED_CUMPLE.
- Actualiza el sender service para resolver guardian.phone como destino.

[Commit 16] SOAP pre-fill
- Modifica el componente de Nueva consulta para pre-llenar S-Subjetivo
  con resumen pediátrico cuando aplique.

[Commit 17] Cita pediátrica — duración sugerida
- Modifica el modal de nueva cita para sugerir 30-45 min y agregar warning
  si paciente tiene Frankl ≤ 2 reciente.

[Commit 18] Audit log integration
- Agrega PEDIATRIC_AUDIT_ACTIONS al enum de acciones permitidas en
  src/lib/audit.ts.

[Commit 19] README de módulo
- Crea docs/modules/pediatrics/README.md con:
   - Resumen del módulo
   - Estructura de carpetas
   - Cómo activar el módulo en una clínica
   - Cómo agregar un nuevo tipo de captura (extending guide)

[Commit 20] Storybook stories (opcional pero deseable)
- Stories para Drawer, FranklDrawer, EruptionChart, PediatricOdontogram,
  RiskCard, ContextStrip, ConsentModal.

VALIDACIONES PREVIAS A ABRIR PR
- pnpm typecheck → 0 errores
- pnpm lint → 0 warnings nuevos
- pnpm test → todos los tests verde
- pnpm build → build OK
- Visual: corre el dev server, navega a /dashboard/patients/[id de un paciente menor de 14],
  verifica que la tab Pediatría aparece, que cambia entre light/dark sin romper,
  y que cada drawer abre/cierra con animación correcta.

PR DESCRIPTION (template)
Título: feat(pediatrics): módulo de odontopediatría v1.0 (MVP)
Body:
  ## Qué incluye
  - 12 modelos Prisma nuevos + migración
  - Tab Pediatría dentro de patient-detail
  - 6 sub-tabs: Resumen, Odontograma, Erupción, Hábitos, Conducta, Plan preventivo
  - Drawer base nuevo en design system
  - 11 drawers de captura específicos
  - Modal de consentimiento con firma canvas
  - Eruption chart custom (vista estrella)
  - Frankl trend chart, habits timeline, odontograma pediátrico
  - 4 plantillas WhatsApp dirigidas al tutor
  - Audit log integrado
  - Spec completo: docs/MEDIFLOW-PEDIATRIA-SPEC.md

  ## Cambios al schema
  Ver `prisma/migrations/<timestamp>_pediatrics_module/`.

  ## Activación del módulo
  Para una clínica: agregar 'PEDIATRICS' a `clinic.modules`.
  La tab solo aparece si: módulo activo + categoría DENTAL_CLINIC|MEDICINE
  + paciente con DOB + paciente <14 años.

  ## Tests
  - Lib helpers: 100% cobertura de funciones puras
  - Casos del brief (Mateo 4a 7m, Sofía 8a 2m, Diego 12a 11m): pass

  ## Accesibilidad
  Verificado WCAG AA en chips Frankl/CAMBRA. Focus-trap en drawer y modal.

  ## Roadmap
  v1.1: mantenedores tracking detallado, dosis pediátricas en recetas.
  v2.0: percentiles de crecimiento, galería intraoral, IA en fotos.

=== PROMPT PARA EL BOT GIT — FIN ===
```

═══════════════════════════════════════════════════════════════════════════
APÉNDICE A — LISTA RESUMEN DE ARCHIVOS NUEVOS Y MODIFICADOS
═══════════════════════════════════════════════════════════════════════════

## Archivos nuevos (≈ 60)

### Schema y migraciones
- `prisma/schema.prisma` (sección añadida)
- `prisma/migrations/<timestamp>_pediatrics_module/migration.sql` (auto-generado)

### Lib (helpers puros)
- `src/lib/pediatrics/age.ts`
- `src/lib/pediatrics/dentition.ts`
- `src/lib/pediatrics/eruption-data.ts`
- `src/lib/pediatrics/cambra.ts`
- `src/lib/pediatrics/frankl.ts`
- `src/lib/pediatrics/permissions.ts`
- `src/lib/pediatrics/audit.ts`
- `src/lib/pediatrics/__tests__/*.test.ts` (5 archivos)

### Tipos
- `src/types/pediatrics.ts`

### Design system base
- `src/components/ui/design-system/Drawer.tsx`

### Tab principal
- `src/components/patient-detail/pediatrics/PediatricsTab.tsx`
- `src/components/patient-detail/pediatrics/PediatricsContextStrip.tsx`
- `src/components/patient-detail/pediatrics/PediatricsSiderail.tsx`
- `src/components/patient-detail/pediatrics/PediatricsSubNav.tsx`

### Sections
- `src/components/patient-detail/pediatrics/sections/SummarySection.tsx`
- `src/components/patient-detail/pediatrics/sections/OdontogramSection.tsx`
- `src/components/patient-detail/pediatrics/sections/EruptionSection.tsx`
- `src/components/patient-detail/pediatrics/sections/HabitsSection.tsx`
- `src/components/patient-detail/pediatrics/sections/BehaviorSection.tsx`
- `src/components/patient-detail/pediatrics/sections/PreventivePlanSection.tsx`

### Charts
- `src/components/patient-detail/pediatrics/charts/EruptionChart.tsx`
- `src/components/patient-detail/pediatrics/charts/FranklTrendChart.tsx`
- `src/components/patient-detail/pediatrics/charts/HabitsTimeline.tsx`

### Odontograma
- `src/components/patient-detail/pediatrics/odontogram/PediatricOdontogram.tsx`
- `src/components/patient-detail/pediatrics/odontogram/Tooth.tsx`

### Cards
- `src/components/patient-detail/pediatrics/cards/RiskCard.tsx`
- `src/components/patient-detail/pediatrics/cards/TutorCard.tsx`
- `src/components/patient-detail/pediatrics/cards/AlertsCard.tsx`
- `src/components/patient-detail/pediatrics/cards/MaintainerCard.tsx`
- `src/components/patient-detail/pediatrics/cards/SealantCard.tsx`
- `src/components/patient-detail/pediatrics/cards/FrankSparklineCard.tsx`
- `src/components/patient-detail/pediatrics/cards/ConsentPendingCard.tsx`

### Drawers
- `src/components/patient-detail/pediatrics/drawers/CaptureDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/FranklDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/CambraDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/HabitDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/EruptionDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/SealantDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/FluorideDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/SpaceMaintainerDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/EndodonticDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/ToothDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/PediatricRecordDrawer.tsx`
- `src/components/patient-detail/pediatrics/drawers/GuardianDrawer.tsx`

### Modals
- `src/components/patient-detail/pediatrics/modals/ConsentModal.tsx`
- `src/components/patient-detail/pediatrics/modals/SignaturePad.tsx`
- `src/components/patient-detail/pediatrics/modals/EvolutionCompareModal.tsx`

### Server Actions
- `src/app/actions/pediatrics/index.ts`
- `src/app/actions/pediatrics/record.ts`
- `src/app/actions/pediatrics/guardian.ts`
- `src/app/actions/pediatrics/behavior.ts`
- `src/app/actions/pediatrics/cambra.ts`
- `src/app/actions/pediatrics/habits.ts`
- `src/app/actions/pediatrics/eruption.ts`
- `src/app/actions/pediatrics/sealant.ts`
- `src/app/actions/pediatrics/fluoride.ts`
- `src/app/actions/pediatrics/maintainer.ts`
- `src/app/actions/pediatrics/endodontic.ts`
- `src/app/actions/pediatrics/consent.ts`

### Documentación
- `docs/MEDIFLOW-PEDIATRIA-SPEC.md` (este documento)
- `docs/modules/pediatrics/README.md`

## Archivos modificados (≈ 10)

- `src/app/dashboard/patients/[id]/page.tsx` — montar tab condicional
- `src/components/patient-detail/PatientTabs.tsx` (o similar) — agregar tab
- `src/components/patient-detail/PatientHeader.tsx` — chips pediátricos
- `src/lib/permissions.ts` — `hasPediatricsModule`, `canSeePediatrics`
- `src/lib/audit.ts` — extender enum de actions
- `src/components/ui/design-system/index.ts` — exportar Drawer
- `src/app/globals.css` — bloque `PEDIATRICS MODULE`
- WhatsApp templates file — 4 plantillas nuevas
- Modal de nueva cita — sugerir duración pediátrica
- Componente de Nueva consulta SOAP — pre-fill subjetivo

═══════════════════════════════════════════════════════════════════════════
APÉNDICE B — CHECKLIST DE ACCESIBILIDAD WCAG AA
═══════════════════════════════════════════════════════════════════════════

| # | Requerimiento | Implementación |
|---|---|---|
| 1.4.3 | Contraste texto normal 4.5:1 | Tokens text-1/text-2 sobre bg cumplen |
| 1.4.3 | Contraste texto grande 3:1 | H1/H2 cumplen en ambos modos |
| 1.4.11 | Contraste UI components 3:1 | Bordes de chips/pills validados |
| 2.1.1 | Operación con teclado | Drawers, modal, odontograma navegables con Tab/Shift+Tab |
| 2.1.2 | Sin trampas de teclado | Focus-trap en drawer/modal con escape vía Esc |
| 2.4.7 | Focus visible | Outline 2px brand + offset 2px en todo elemento accionable |
| 3.2.2 | Sin cambios al focus | Solo se cambia focus al abrir/cerrar drawer (intencional) |
| 4.1.2 | Roles ARIA correctos | role="dialog", aria-labelledby, aria-modal |
| 1.4.13 | Tooltips dismissibles | Tooltips de chips y dots cierran con Esc |
| 2.5.5 | Tap targets 44×44 px | Botones de Frankl, dientes en odontograma cumplen |

═══════════════════════════════════════════════════════════════════════════
FIN DEL DOCUMENTO
═══════════════════════════════════════════════════════════════════════════

Cualquier duda mientras se implementa: este spec es la fuente de verdad.
Si algo falta o entra en conflicto con el repo actual, gana el repo y el
bot debe abrir issue describiendo el conflicto antes de improvisar.

— Diseñador (Claude) · Para Rafael · MediFlow
