# Toggle de módulos del marketplace por clínica

`/admin/clinics/[id]` → tab **Módulos** permite al SUPER_ADMIN
activar/desactivar manualmente los módulos del marketplace para una
clínica específica, sin pasar por Stripe.

## Diseño (Caso C — aprobado 2026-05-05)

Se descartó agregar un campo paralelo `Clinic.modules: String[]`. En su
lugar, el toggle escribe directamente sobre la tabla `ClinicModule` que
ya usa el marketplace. Esto evita una segunda fuente de verdad y deja
`canAccessModule()` funcionando sin cambios.

| Acción | Operación de DB |
| --- | --- |
| **Activar** | `upsert` con `status="active"`, `paymentMethod="admin"`, `pricePaidMxn=0`, `currentPeriodEnd=2099-12-31` |
| **Desactivar** | `update` a `status="cancelled"`, `cancelledAt=now`. NO `delete` — se conserva historia y FKs (`stripeSubscriptionId`, `paypalSubscriptionId`). |

`paymentMethod="admin"` es el marcador que distingue una activación
manual de una suscripción real. **Reportes financieros del marketplace
deben filtrar `paymentMethod != "admin"`** para no inflar el ingreso.

Si la clínica luego compra el mismo módulo en `/dashboard/marketplace`,
el flow normal de Stripe upsertea el row con `paymentMethod="stripe"`
+ `stripeSubscriptionId`, reemplazando el grant admin.

## Auth

`isAdminAuthed()` — cookie `admin_token` comparada contra
`process.env.ADMIN_SECRET_TOKEN`. Mismo patrón que
`/api/admin/clinics/[id]/route.ts`. Los SUPER_ADMIN no son `User` rows,
por eso esta acción NO usa `prisma.auditLog` (requiere `userId`).

## Audit

Cada toggle emite `console.log(JSON.stringify({...}))` con esta forma:

```json
{
  "type": "admin.clinic.module.toggled",
  "clinicId": "...",
  "moduleKey": "endodontics",
  "enabled": true,
  "at": "2026-05-05T12:00:00.000Z",
  "by": "admin",
  "previousStatus": "cancelled",
  "previousPaymentMethod": "stripe"
}
```

Visible en Vercel Logs. Mismo precedente que `DELETE
/api/admin/clinics/[id]`.

## Estructura del código

- `src/app/actions/admin/toggle-clinic-module-core.ts` — lógica pura
  (zod, validación, decisión activar/cancelar). Sin Prisma. 11 tests
  unitarios en `toggle-clinic-module-core.test.ts` (`npm run
  test:admin-modules`).
- `src/app/actions/admin/toggle-clinic-module.ts` — wrapper `"use
  server"` que cablea Prisma + `cookies()` + `revalidatePath()` al
  core. Espeja el patrón de `evaluateAccess` /
  `canAccessModule` en `src/lib/marketplace/`.
- `src/components/admin/clinic-modules-tab.tsx` — UI cliente con un
  toggle por módulo. Lee del catálogo de `Module` filtrado por
  `isActive=true && category="Dental"` y del array `clinic.clinicModules`.

## Scope actual

Solo los **6 módulos dentales** del seed
(`pediatric-dentistry`, `endodontics`, `periodontics`, `orthodontics`,
`implants`, `general-dentistry`). Si en el futuro se activan los
módulos de `FUTURE_MODULES` en `prisma/seed.ts`, aparecerán
automáticamente en el panel para clínicas de su categoría.
