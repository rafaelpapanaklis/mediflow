# MediFlow — Patrones de diseño recurrentes

Plantillas concretas que Claude Design debe seguir al proponer páginas nuevas
o rediseños. Todo referenciado a tokens de `01-design-system.md` y componentes
de `03-components-spec.md`.

---

## 1. Estructura estándar de una página de dashboard

```
┌──────────────────────────────────────────────┐
│ Topbar 52px (sticky)                         │
├──────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────┐ │
│ │ Header de página                         │ │
│ │  ├── H1 + subtitle                       │ │
│ │  └── Actions (derecha): botones          │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Barra de filtros (opcional)              │ │
│ │  Search + Chips filter + Vista toggle    │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ Contenido principal                       │ │
│ │  (KPI grid / Tabla / Cards / Chart)      │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

Código base:

```tsx
<div style={{ maxWidth: 1280, margin: "0 auto", padding: "clamp(14px, 1.6vw, 28px)" }}>
  {/* Header */}
  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 22, gap: 24, flexWrap: "wrap" }}>
    <div>
      <h1 style={{ fontSize: "clamp(16px, 1.4vw, 22px)", fontWeight: 600, margin: 0, color: "var(--text-1)" }}>
        Título de la página
      </h1>
      <p style={{ color: "var(--text-3)", fontSize: 13, marginTop: 4, margin: 0 }}>
        Subtítulo descriptivo
      </p>
    </div>
    <div style={{ display: "flex", gap: 8 }}>
      <ButtonNew variant="secondary" icon={<Filter size={14} />}>Filtros</ButtonNew>
      <ButtonNew variant="primary" icon={<Plus size={14} />}>Nuevo</ButtonNew>
    </div>
  </div>

  {/* Filtros (opcional) */}
  <div style={{ display: "flex", gap: 8, marginBottom: 18, alignItems: "center" }}>
    <div className="search-field"><Search size={14} /><input placeholder="Buscar..." /></div>
    <ButtonNew size="sm" variant="secondary" icon={<Filter size={12} />}>Estado: Todos</ButtonNew>
  </div>

  {/* Contenido */}
  <CardNew noPad>...</CardNew>
</div>
```

---

## 2. Grid de KPIs (4 tarjetas arriba)

Patrón usado en `/dashboard`, `/admin`, `/dashboard/reports`:

```tsx
<div style={{
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 14,
  marginBottom: 20
}}>
  <KpiCard label="MRR Activo" value="$12,450" icon={DollarSign}
    delta={{ value: "12 clínicas", direction: "up" }} />
  <KpiCard label="MRR Potencial" value="$18,200" icon={TrendingUp} />
  <KpiCard label="Cobrado mes" value="$9,800" icon={CheckCircle}
    delta={{ value: "$2,400 pendiente", direction: "down" }} />
  <KpiCard label="Nuevas" value="5" icon={Building2} />
</div>
```

En móvil (`<640px`), colapsa a 1 columna. En tablet (`640-1024px`), 2 columnas.

---

## 3. Tabla estándar con paginación

```tsx
<CardNew noPad>
  <table className="table-new">
    <thead>
      <tr>
        <th>Fecha</th>
        <th>Folio</th>
        <th>Paciente</th>
        <th>Monto</th>
        <th>Estado</th>
        <th></th>
      </tr>
    </thead>
    <tbody>
      {rows.map(r => (
        <tr key={r.id}>
          <td className="mono">{r.date}</td>
          <td className="mono">{r.folio}</td>
          <td>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <AvatarNew name={r.patientName} size="sm" />
              {r.patientName}
            </div>
          </td>
          <td className="mono" style={{ fontWeight: 500 }}>${r.amount}</td>
          <td><BadgeNew tone="success" dot>Completado</BadgeNew></td>
          <td style={{ textAlign: "right" }}>
            <button className="icon-btn-new"><MoreHorizontal size={14} /></button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
  <div className="pagination">
    <span className="pagination__info">Mostrando 1-20 de 450</span>
    <div className="pagination__pages">
      <button className="pagination__btn">‹</button>
      <button className="pagination__btn pagination__btn--active">1</button>
      <button className="pagination__btn">2</button>
      <button className="pagination__btn">3</button>
      <button className="pagination__btn">›</button>
    </div>
  </div>
</CardNew>
```

Reglas:
- **Números siempre en `.mono`.** Folios, fechas, montos, IDs.
- **Badges de estado** con `tone` y `dot`.
- **Última columna** con `icon-btn-new` de acciones (3 puntitos).
- **Hover row** automático con `.table-new`.
- **Overflow horizontal** en móvil: wrap la table en
  `<div style={{ overflowX: "auto" }}>`.

---

## 4. Selección masiva (bulk actions)

Cuando el usuario selecciona filas, reemplazar la barra de filtros con:

```tsx
<div style={{
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 14px",
  background: "var(--brand-soft)",
  border: "1px solid var(--border-brand)",
  borderRadius: 8,
  marginBottom: 14
}}>
  <span style={{ fontSize: 12, color: "var(--text-1)" }}>
    <strong className="mono">{selectedCount}</strong> seleccionados
  </span>
  <ButtonNew variant="primary" size="sm">Acciones</ButtonNew>
</div>
```

---

## 5. Modal de form

```tsx
<div className="modal-overlay" onClick={closeOnBackdrop}>
  <div className="modal" onClick={e => e.stopPropagation()}>
    <div className="modal__header">
      <div>
        <div className="card__title">Nuevo paciente</div>
        <div className="card__sub">Registra un paciente en tu clínica</div>
      </div>
      <button className="icon-btn-new" onClick={close}><X size={14} /></button>
    </div>

    <div style={{ padding: 22 }}>
      {/* Form grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            Nombre
          </label>
          <input className="input-new" style={{ marginTop: 6 }} />
        </div>
        {/* ... */}
      </div>
    </div>

    <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border-soft)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
      <ButtonNew variant="ghost" onClick={close}>Cancelar</ButtonNew>
      <ButtonNew variant="primary" onClick={submit}>Crear</ButtonNew>
    </div>
  </div>
</div>
```

**Variantes**: `.modal--wide` (680px) para forms más densos. Mobile responsive
ya built-in (94vh max-height, padding 12px).

---

## 6. Wizard multi-step (signup, import, onboarding)

Patrón de 3 pasos como signup o import Excel:

```
┌────────────────────────────────────────┐
│  Stepper superior (dots + line)        │
│    ●───●───○   Paso 2 de 3             │
├────────────────────────────────────────┤
│  Contenido del paso                    │
│                                        │
├────────────────────────────────────────┤
│  ← Atrás              Continuar →      │
└────────────────────────────────────────┘
```

Indicador de pasos:
```tsx
<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 22 }}>
  {[1,2,3].map(i => (
    <Fragment key={i}>
      <div style={{
        width: 24, height: 24, borderRadius: "50%",
        background: i <= current ? "var(--brand)" : "var(--bg-elev-2)",
        color: i <= current ? "#fff" : "var(--text-3)",
        display: "grid", placeItems: "center",
        fontSize: 11, fontWeight: 600,
        boxShadow: i === current ? "0 0 12px rgba(124,58,237,0.4)" : "none"
      }}>{i}</div>
      {i < 3 && <div style={{ flex: 1, height: 2, background: i < current ? "var(--brand)" : "var(--bg-elev-2)", borderRadius: 1 }} />}
    </Fragment>
  ))}
</div>
```

---

## 7. Estado vacío (empty state)

```tsx
<CardNew>
  <div style={{ textAlign: "center", padding: "48px 24px" }}>
    <div style={{
      width: 56, height: 56,
      borderRadius: 14,
      background: "var(--brand-softer)",
      border: "1px solid var(--border-brand)",
      color: "#c4b5fd",
      display: "inline-grid", placeItems: "center",
      marginBottom: 16
    }}>
      <Users size={24} />
    </div>
    <h3 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0, marginBottom: 6 }}>
      Sin pacientes todavía
    </h3>
    <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0, marginBottom: 20, maxWidth: 320, marginInline: "auto" }}>
      Registra tu primer paciente o importa desde Excel para empezar.
    </p>
    <div style={{ display: "inline-flex", gap: 8 }}>
      <ButtonNew variant="secondary" icon={<Upload size={14} />}>Importar Excel</ButtonNew>
      <ButtonNew variant="primary" icon={<Plus size={14} />}>Nuevo paciente</ButtonNew>
    </div>
  </div>
</CardNew>
```

---

## 8. Loading states

**Skeleton** (preferido para cargas >200ms):
```tsx
<div className="card">
  <div className="card__body">
    <div className="skel-new" style={{ height: 20, width: "40%", marginBottom: 12 }} />
    <div className="skel-new" style={{ height: 14, width: "70%", marginBottom: 8 }} />
    <div className="skel-new" style={{ height: 14, width: "60%" }} />
  </div>
</div>
```

**Spinner** solo para:
- Submit de forms (< 500 ms esperados)
- Botones durante acción (inline en el botón)

```tsx
<ButtonNew variant="primary" disabled>
  <Loader2 size={14} className="animate-spin" /> Guardando...
</ButtonNew>
```

---

## 9. Toast notifications

**Librería**: `react-hot-toast` ya configurada en `app/layout.tsx`:
```tsx
<Toaster position="top-right" toastOptions={{ className: "text-sm font-medium" }} />
```

Patrones:
```tsx
toast.success("Paciente creado");
toast.error("Error al guardar");
toast.loading("Procesando…");  // devuelve id → toast.dismiss(id)
```

Diseñar siempre mensajes **cortos** (2-5 palabras). Sin emojis en el mensaje
mismo (react-hot-toast ya pone íconos).

---

## 10. Forms — reglas consistentes

1. **Label** arriba, 11px uppercase, letter-spacing 0.04em, color text-3.
2. **Input** `.input-new`, margin-top 6px del label.
3. **Helper text** debajo, 11px text-3, margin-top 4.
4. **Error**: border `var(--danger)` + helper text color `var(--danger)`.
5. **Required**: asterisco `*` después del label, color `var(--danger)`.
6. **Grid 2 columnas** en desktop para campos cortos, 1 columna para textarea/
   address largos.
7. **Botones footer** siempre: ghost (cancelar) izquierda, primary (submit) derecha.
8. **Disabled state** de submit mientras validación no pasa.

---

## 11. Detail page pattern (paciente, clínica, cita)

```
┌───────────────────────────────────────────┐
│ [← Volver]  Breadcrumb                    │
├───────────────────────────────────────────┤
│ ┌─Avatar─┐ Nombre grande + tags           │
│ │  AB    │ Email, phone, fecha alta       │
│ └────────┘  Acciones: [Editar][Menú]      │
├───────────────────────────────────────────┤
│ [Tab 1][Tab 2][Tab 3][Tab 4]              │
├───────────────────────────────────────────┤
│ Contenido del tab activo                  │
└───────────────────────────────────────────┘
```

- Avatar 64px (`size="lg"`).
- Nombre 22px Sora 600.
- Tabs con `.tabs-new` + contador opcional `.tab__count`.

---

## 12. Color coding semántico

Uso consistente (no variar):

| Concepto | Tone |
|---|---|
| Completado / Pagado / Activo | `success` (verde) |
| Pendiente / En curso / Trial | `warning` (ámbar) |
| Cancelado / Vencido / Error | `danger` (rojo) |
| Información / En teleconsulta | `info` (azul) |
| Nuevo / Destacado / Premium | `brand` (violeta) |
| Neutral / Otro | `neutral` (gris) |

No inventes colores. Si un nuevo concepto no encaja, úsalo como `neutral` o
agrega un token nuevo a globals.css.

---

## 13. Responsive breakpoints

Manejados con Tailwind + CSS inline:

| Breakpoint | Tailwind | Uso |
|---|---|---|
| Mobile | `<640px` | 1 columna, sidebar off-canvas |
| Tablet | `sm: 640px+` | 2 columnas KPI |
| Desktop | `md: 768px+` | 2-3 columnas |
| Large | `lg: 1024px+` | Sidebar sticky visible, 4 columnas KPI |
| XL | `xl: 1280px+` | Max-width content |

Preferir **fluid sizing** con `clamp()` sobre breakpoints duros cuando se pueda.
