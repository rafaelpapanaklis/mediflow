# MediFlow — Sitemap completo

Producto SaaS multi-tenant para clínicas médicas en México. Dos dominios
principales de rutas: `/dashboard/*` (panel de la clínica) y `/admin/*`
(super-admin interno de MediFlow).

---

## Layout global

Todas las páginas de `/dashboard` y `/admin` comparten:

- Sidebar izquierdo (sticky, `clamp(180px, 14vw, 232px)` — mobile off-canvas)
- Topbar superior 52px (breadcrumbs + búsqueda ⌘K + campana + usuario)
- Main content area con grid background violeta (tokens en 01-design-system.md)

---

## /dashboard (panel de clínica)

Segmentado en 2 secciones del sidebar: **PRINCIPAL** (todos los usuarios) y
**ADMIN** (solo SUPER_ADMIN / ADMIN de la clínica).

### Principal

| Ruta | Página | Descripción |
|---|---|---|
| `/dashboard` | Home | KPIs del día (citas, ingresos, pacientes nuevos), calendario próximas citas, últimos pacientes, accesos rápidos, onboarding checklist si aún no completo |
| `/dashboard/appointments` | Agenda | Vista semanal/diaria con citas por doctor, drag-and-drop, filtros por estado, modal de nueva cita con integración WhatsApp |
| `/dashboard/patients` | Pacientes | Tabla paginada con búsqueda, filtros (doctor, estado, tag), acciones: nuevo paciente, importar Excel/CSV, exportar |
| `/dashboard/patients/[id]` | Detalle paciente | Tabs: Info personal / Historial clínico / Citas / Facturas / Odontograma (dental) / Consentimientos / Radiografías / Portal |
| `/dashboard/clinical` | Expedientes | Lista cronológica de notas clínicas SOAP firmadas por doctor |
| `/dashboard/treatments` | Tratamientos | Catálogo de servicios con precios, duración, comisiones por doctor |
| `/dashboard/before-after` | Antes/Después | Galería fotos paciente — disponible en DERMATOLOGY, AESTHETIC_MEDICINE, BEAUTY_CENTER, HAIR_* |
| `/dashboard/formulas` | Fórmulas | Fórmulas magistrales / recetas de coloración (BROW_LASH, HAIR_SALON, ALTERNATIVE_MEDICINE) |
| `/dashboard/walk-in` | Lista de espera | Pacientes sin cita esperando atención (HAIR_SALON, NAIL_SALON) |
| `/dashboard/exercises` | Ejercicios | Plan de ejercicios prescriptos (PHYSIOTHERAPY, PODIATRY) |
| `/dashboard/orthotics` | Ortesis | Plantillas ortopédicas custom (PODIATRY) |
| `/dashboard/xrays` | Radiografías | Upload y análisis con IA (Claude) de radiografías |
| `/dashboard/ai-assistant` | IA Asistente | Chat con Claude para consultas clínicas, dx diferencial, dosis, notas SOAP. Muestra tokens restantes del mes. |
| `/dashboard/teleconsulta` | Teleconsulta | Lista de citas con link de videollamada, pagos online |

### Admin (rol ADMIN / SUPER_ADMIN)

| Ruta | Página | Descripción |
|---|---|---|
| `/dashboard/packages` | Paquetes | Bundles de tratamientos con descuento (estética, spa, etc) |
| `/dashboard/resources` | Recursos/Salas | Gestión de consultorios, equipos, salas |
| `/dashboard/billing` | Facturación | Lista de facturas CFDI 4.0, emisión, cancelación, exportación |
| `/dashboard/inventory` | Inventario | Productos con stock, alertas low-stock, consumo por tratamiento |
| `/dashboard/whatsapp` | WhatsApp | Estado de conexión, plantillas de mensaje, historial |
| `/dashboard/team` | Equipo | Gestión de doctores/staff, roles, colores de calendario |
| `/dashboard/reports` | Reportes | KPIs avanzados, ingresos por período, performance por doctor, exportable Excel |
| `/dashboard/procedures` | Procedimientos | Protocolos/plantillas de procedimientos |
| `/dashboard/landing` | Página web | Editor de la landing pública de la clínica (slug.mediflow.mx) |
| `/dashboard/settings` | Configuración | Datos clínica, horarios, fiscal CFDI, integraciones, plan/suscripción, 2FA |
| `/dashboard/suspended` | Suspendido | Pantalla cuando el trial venció o la suscripción está past_due |

### Categorías de clínica (mapping de features)

El sidebar muestra solo los items habilitados por categoría:

| Categoría | Features extra destacadas |
|---|---|
| DENTAL, MEDICINE | Odontograma, radiografías, inventario, procedimientos |
| NUTRITION, PSYCHOLOGY | Sin inventario/rx — sólo clínico + tratamientos |
| DERMATOLOGY | Before-after, paquetes |
| AESTHETIC_MEDICINE | Before-after, paquetes |
| HAIR_RESTORATION | Before-after |
| BEAUTY_CENTER | Before-after, paquetes |
| BROW_LASH, HAIR_SALON | Fórmulas, walk-in, paquetes |
| MASSAGE, SPA | Paquetes, recursos/salas |
| LASER_HAIR_REMOVAL | Before-after, paquetes |
| NAIL_SALON | Walk-in |
| PHYSIOTHERAPY, PODIATRY | Ejercicios, ortesis (podo), inventario |
| ALTERNATIVE_MEDICINE | Fórmulas, tratamientos |
| OTHER | Todo básico |

---

## /admin (super-admin MediFlow interno)

Panel global del negocio. Sólo accesible con `ADMIN_SECRET_TOKEN` (cookie
`admin_token`). No es parte de ninguna clínica.

Sidebar secciones: **MAIN**, **GROWTH**, **SYSTEM**.

### Main

| Ruta | Página | Descripción |
|---|---|---|
| `/admin` | Dashboard | MRR activo, MRR potencial, cobrado del mes, nuevas clínicas, growth %, lista resumida de clínicas recientes con alertas |
| `/admin/clinics` | Clínicas | Tabla de todas las clínicas con filtros: estado suscripción, categoría, plan. Acciones: ver, impersonar, suspender |
| `/admin/clinics/[id]` | Detalle clínica | Info, owner, pagos históricos, uso de features, notas internas, botón "Ver como clínica" (impersonate) |
| `/admin/payments` | Pagos | Registros de pagos de suscripciones, selección múltiple, filtros por método/estado/fechas, bulk actions |
| `/admin/payments/[id]/cfdi` | CFDI pago | Emisión de factura fiscal de pago de suscripción |
| `/admin/churn` | Retención | Clínicas en riesgo, churn por mes, motivos, drill-down |
| `/admin/onboarding` | Onboarding | Pipeline de clínicas nuevas (registradas, paymentMethod setup, primer doctor creado, primera cita, etc) |

### Growth

| Ruta | Página | Descripción |
|---|---|---|
| `/admin/reports` | Reportes | MRR trend, nuevas vs churned por mes, conversión, chart de líneas. Export Excel |
| `/admin/announcements` | Anuncios | Banner global para todas las clínicas (mantenimiento, features nuevas) |
| `/admin/coupons` | Cupones | Códigos de descuento con validez, uso, reembolso |

### System

| Ruta | Página | Descripción |
|---|---|---|
| `/admin/settings` | Configuración | Planes y precios, variables de entorno, datos fiscales MediFlow, 2FA admin |

### /admin/login

Pantalla de login separada con campo de `ADMIN_SECRET_TOKEN` + 2FA TOTP si
habilitado. Sin sidebar.

---

## Públicas (fuera de panel, pero parte del producto)

| Ruta | Página | Descripción |
|---|---|---|
| `/` | Landing home | Marketing general MediFlow |
| `/[slug]` | Landing por clínica | Landing pública de cada clínica (agendar cita, contacto) |
| `/[categoria]` | Landing por especialidad | SEO pages (dental, medicina-estetica, etc) |
| `/pricing` | Precios planes | BASIC, PRO, CLINIC |
| `/features` | Features | Lista de capacidades del producto |
| `/contact` | Contacto | Form de demo |
| `/signup` | Registro | Multi-step (cuenta → clínica → plan+pago) |
| `/login` | Login | Email/password o magic link |
| `/auth/confirm` | Confirmación email | Después del signup/reset |
| `/consentimiento/[token]` | Firma consentimiento | Link único para paciente firma digital |
| `/portal/[token]` | Portal paciente | Link para ver su expediente, agendar, pagar |
| `/teleconsulta/[id]` | Videollamada | Sala de teleconsulta (paciente + doctor) |
| `/pago/[appointmentId]` | Pago cita | Stripe checkout |
| `/pago/exitoso` | Pago OK | Confirmación post-checkout |
| `/pago/cancelado` | Pago cancelado | — |

---

## Permisos por rol (dentro de /dashboard)

| Rol | Ve |
|---|---|
| `SUPER_ADMIN` | Todo lo anterior + configuración fiscal + suscripción |
| `ADMIN` | Todo excepto suscripción/billing clínica |
| `DOCTOR` | Principal + solo sus pacientes/citas (isDoctor filter en queries) |
| `RECEPTIONIST` | Principal sin clínico + agenda completa |
| `ACCOUNTANT` | Billing + reportes financieros |

---

## Notas de navegación

- **Multi-clínica**: un usuario puede pertenecer a N clínicas (un registro `User`
  por clínica con mismo `supabaseId`). El sidebar tiene un selector de clínica
  arriba (dropdown en la brand area). Al cambiar, se setea cookie HMAC-signed
  `activeClinicId` y se refresca todo el contexto.
- **Modo oscuro/claro**: toggle en el footer del sidebar (botón "Modo claro"/
  "Modo oscuro"). Persiste en `localStorage.theme`. Aplicado con class `.dark`
  en `<html>`. **Cada página debe renderizar correctamente en AMBOS modos** —
  los screenshots del paquete incluyen `-light.png` y `-dark.png` por pantalla.
- **Responsivo**: ≥1024px sidebar sticky visible. <1024px se convierte en
  off-canvas con hamburger en topbar móvil (h-14 fixed).
