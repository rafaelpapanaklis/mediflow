# MediFlow — Componentes reutilizables

Inventario de los componentes del design system (`src/components/ui/design-system/`)
y dashboard/admin (`src/components/dashboard/`, `src/app/admin/`). Usa estos,
no inventes paralelos.

---

## 1. Design system base (`ui/design-system/`)

### `<CardNew />`

```tsx
<CardNew title="Título" sub="Subtítulo" action={<ButtonNew>Ver</ButtonNew>} noPad>
  {children}
</CardNew>
```
- Props: `title?`, `sub?`, `action?: ReactNode` (right header), `noPad?` (quita
  padding del body), `className?`.
- Estructura: header opcional con separator, body con padding 18px.

### `<ButtonNew />`

```tsx
<ButtonNew variant="primary" icon={<Plus size={14} />}>Nuevo</ButtonNew>
```
- Props: `variant: "primary" | "secondary" | "ghost" | "danger"` (default
  `secondary`), `size?: "sm"`, `icon?: ReactNode` (izquierda), acepta todo
  `ButtonHTMLAttributes`.
- Altura 32px (sm 28px), icon 14px recomendado.

### `<BadgeNew />`

```tsx
<BadgeNew tone="success" dot>Completado</BadgeNew>
```
- Props: `tone: "success" | "warning" | "danger" | "info" | "brand" | "neutral"`
  (default `neutral`), `dot?: boolean` (puntito con glow a la izquierda).
- Texto automáticamente uppercase por CSS.

### `<AvatarNew />`

```tsx
<AvatarNew name="Sabina Estrada" size="lg" />
```
- Props: `name: string` (usado para iniciales + gradient determinístico),
  `size?: "sm" | "lg" | "xl"` (default 32px, sm 24, lg 64, xl 80).
- Gradient OKLCH determinístico: el mismo nombre siempre genera el mismo color.
  Algoritmo: hash de charCodes → hue 0-360, segundo color a +40°.

### `<KpiCard />`

```tsx
<KpiCard
  label="MRR Activo"
  value="$12,450"
  icon={DollarSign}
  delta={{ value: "+12%", direction: "up", sub: "vs mes anterior" }}
/>
```
- Props: `label`, `value` (string — formatear antes), `icon?: LucideIcon`,
  `delta?: { value, direction: "up"|"down", sub? }`.
- Icon container 28×28 con bg brand-softer.
- Value 26px Sora, delta mono con flecha ↑/↓.
- **Server-safe**: no tiene "use client", no hooks. Se puede usar en pages RSC.

---

## 2. Dashboard (`components/dashboard/`)

### `<Sidebar />`
- Sticky left, sticky top, collapse button bottom, user dropdown arriba.
- Props: `user`, `clinicName`, `clinicId`, `plan`, `clinicCategory`,
  `allClinics` (para dropdown multi-clínica), `onboardingCompleted`.
- Features: theme toggle, logout, collapse persistente (`localStorage
  sidebar-collapsed`), mobile off-canvas <lg.
- Sección PRINCIPAL y ADMIN separadas con label uppercase 10px.
- Active item: bg brand-soft + border brand + glow + barrita vertical
  pegada a la izquierda del sidebar.

### `<Topbar />`
- Height 52px, sticky top, blur bg.
- Props: `crumbs: string[]` (breadcrumbs separados por chevron), `right?`
  (slot derecho custom antes de los iconos).
- Contiene: breadcrumbs + (slot right) + buscador ⌘K + campana (con popover
  de actividad) + avatar usuario.

### `<CommandPalette />`
- Modal ⌘K para búsqueda global.
- Fetch `/api/dashboard/search?q=`, tres secciones: Pacientes / Citas / Facturas.
- Flechas navegan, Enter abre, Esc cierra.

### `<NotificationsPopover />`
- Popover anclado a la campana.
- Fetch `/api/dashboard/activity`, revalidate 60s.
- Tipos: `payment`, `patient_new`, `appointment_completed`.
- Badge rojo cuando `unreadCount > 0`.
- Marcar leído setea cookie `notifLastSeen`.

### `<TrialBanner />`
- Banner superior cuando `trialEndsAt` en futuro y sin suscripción activa.
- Countdown de días restantes, CTA a upgrade.

### `<GlobalAnnouncementBanner />`
- Banner que muestra el announcement global activo (creado desde /admin/announcements).
- Dismiss persistente por `announcementId`.

### `<NewPatientModal />`
- Modal estándar para crear paciente rápido.
- Form: firstName, lastName, email, phone, dob, gender, isChild.

### `<ImportPatientsModal />` *(a implementar — ver prompts)*
- 3 pasos: Upload → Preview → Commit.

### `<OnboardingChecklist />` / `<OnboardingMini />`
- Checklist de pasos iniciales: crear doctor, horarios, primer paciente, primera
  cita, primer expediente, primera factura, conectar WhatsApp.
- Progress bar + items con ícono completado/pendiente.

### `<TodayStrip />` *(obsoleto — quitado del layout global)*
- Quedó en el repo por si se reusa en home.

### `<QuickActionsBar />` *(obsoleto — quitado del layout global)*
- Quedó por si se reusa en home.

### `<RevenueAreaChart />` / `<RevenueChart />`
- Recharts area/line con gradient violeta.
- Usado en home del dashboard y en /admin/reports.

### `<ThemeToggle />`
- Sol/luna, alterna `.dark` en `<html>`, persiste en localStorage.

### `<SubscriptionTab />`
- Tab de suscripción en settings. Info del plan actual, métodos de pago,
  historial, botón de downgrade/upgrade.

---

## 3. Admin (`app/admin/admin-nav.tsx`)

### `<AdminSidebar />`
- Props: `counts: { clinics, atRisk }` (para badges en nav items).
- Secciones MAIN / GROWTH / SYSTEM con items labeled.
- Bottom: avatar + botón logout que hace POST `/api/admin/logout`.

---

## 4. Patrones no-componentizados (inline)

### Input with icon
```tsx
<div className="search-field">
  <Search size={14} />
  <input placeholder="Buscar..." />
</div>
```

### Filter chip
```tsx
<button className="btn-new btn-new--secondary btn-new--sm">
  <Filter size={12} /> Clínica: Todas
</button>
```

### Stat grid (página de clínica/dashboard)
4 KPI cards en grid `repeat(4, minmax(0,1fr))` con gap 14px. En <900px
colapsa a 2×2 con `minmax(280px, 1fr)` via `auto-fit`.

### Tabla con selección masiva
- Checkbox header + por fila, banner "N seleccionados" + botón "Acciones"
  cuando count > 0 (ver `/admin/payments`).

### Tabs horizontales
`.tabs-new` con `.tab-new` + `.tab-new--active`. Cada uno puede tener
`.tab__count` mono con número.

### Empty state
- Icono 48px bg brand-softer rounded-2xl
- H3 15-16px, p 13px text-3
- Botón CTA debajo si aplica

### Loading skeleton
Usa `.skel-new` con width/height inline. No uses spinners salvo para acciones
de pocos ms (submit).

---

## 5. Iconografía

**Librería única: `lucide-react`.** Nunca metas SVG inline o iconos de otras
libs. Tamaños recomendados:

| Contexto | Tamaño |
|---|---|
| Breadcrumbs separator | 12 |
| Button icon | 14 |
| Sidebar nav | 16 |
| Card header action | 14 |
| KPI icon | 14 |
| Empty state illustration | 32-48 |
| Avatar fallback | automático (iniciales) |

Iconos recurrentes por feature:

- `LayoutDashboard` — home
- `Calendar` — agenda
- `Users` — pacientes
- `Stethoscope` — clínico
- `Activity` — tratamientos
- `Camera` — before/after
- `FlaskConical` — fórmulas
- `Clock` — walk-in / espera
- `Dumbbell` — ejercicios
- `Footprints` — ortesis
- `FileImage` — radiografías
- `Sparkles` — IA
- `Video` — teleconsulta
- `Package` — inventario / paquetes
- `Gift` — paquetes
- `DoorOpen` — recursos/salas
- `CreditCard` — billing / pagos
- `MessageCircle` — whatsapp
- `UserCog` — equipo
- `BarChart2/3` — reportes
- `Globe` — landing
- `Settings` — configuración
- `Building2` — clínicas
- `TrendingUp/Down` — métricas
- `DollarSign` — dinero
- `CheckCircle/CheckCircle2` — completado
- `AlertTriangle` — warning
- `XCircle` — error
- `Ticket` — cupones
- `Megaphone` — anuncios
- `Bell` — notificaciones
