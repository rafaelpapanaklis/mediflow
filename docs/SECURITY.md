# MediFlow — Seguridad y aislamiento multi-tenant

MediFlow es multi-tenant: muchas clínicas comparten la misma base de datos y los datos de una clínica nunca deben filtrarse a otra. Este documento describe la arquitectura de seguridad que protege ese aislamiento.

## Arquitectura de 3 capas

El aislamiento de datos por clínica está protegido por **tres capas independientes**. Si una falla, las otras dos siguen conteniendo el blast radius.

### Capa 1 — Filtros manuales en código (activa hoy)

Cada API route obtiene el `clinicId` de la sesión (nunca del request body) y lo pasa explícitamente como filtro en cada query de Prisma:

```ts
const ctx = await getAuthContext();
if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

const patients = await prisma.patient.findMany({
  where: { clinicId: ctx.clinicId },
});
```

Helpers como `buildPatientWhere`, `buildAppointmentWhere`, `buildRecordWhere` en `src/lib/auth-context.ts` encapsulan este patrón y además aplican filtros adicionales por rol (un doctor solo ve sus propios pacientes, etc.).

**Limitación:** depende 100% de que el desarrollador no se olvide del filtro. Una sola query sin `where: { clinicId }` rompe el aislamiento.

### Capa 2 — Contexto por request en AsyncLocalStorage (infraestructura lista, sin uso aún)

Cada API route del dashboard envolverá su lógica en `withClinicContext(ctx, async () => { ... })`. Esto guarda el `clinicId` en un `AsyncLocalStorage` de Node, accesible desde cualquier punto del request sin tener que pasarlo como parámetro.

Un extension de Prisma (`$extends`) intercepta cada operación. Si hay un `ClinicContext` activo, envuelve la query en una transacción que primero setea la variable de sesión `app.current_clinic_id` con `set_config(..., true)` (variante local a la transacción, requerida porque PgBouncer en modo transaction reutiliza conexiones).

```sql
BEGIN;
SELECT set_config('app.current_clinic_id', '<clinicId>', true);
SELECT * FROM patients WHERE ...;  -- la query original
COMMIT;
```

Esto solo importa cuando se active la Capa 3. Por sí solo no aísla nada, solo prepara el terreno.

### Capa 3 — Row Level Security en PostgreSQL (Sesión 2 — pendiente)

Cada tabla con `clinicId` tendrá una policy de RLS:

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;

CREATE POLICY clinic_isolation ON patients
  USING (clinic_id = current_setting('app.current_clinic_id', true));
```

Con esto, aunque alguien escriba `prisma.patient.findMany()` sin `where: { clinicId }`, PostgreSQL solo devuelve las filas de la clínica activa según `app.current_clinic_id`. La base de datos es la última línea de defensa.

## `prisma` vs `prismaAdmin`

Hay dos clientes de Prisma. Elige correctamente:

| Cliente | Importar de | Cuándo usarlo |
|---|---|---|
| `prisma` | `@/lib/prisma` | API routes del dashboard, server components autenticados, cualquier flujo con sesión de clínica activa. Pasa por el extension de RLS. |
| `prismaAdmin` | `@/lib/prisma-admin` | Cron jobs, webhooks de terceros (Stripe, WhatsApp), endpoints públicos validados por token (portal del paciente, consent forms), operaciones del super admin que cruzan clínicas. **NO** pasa por el extension. |

Regla simple: si el código corre dentro de un request donde ya hiciste `getAuthContext()` y tienes una clínica activa, usa `prisma`. Si no hay sesión de clínica (cron, webhook, token público), usa `prismaAdmin` y valida la autorización por otros medios.

## Patrón de uso de `withClinicContext`

```ts
import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { withClinicContext } from "@/lib/with-clinic-context";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return withClinicContext(ctx, async () => {
    const patients = await prisma.patient.findMany({
      where: { clinicId: ctx.clinicId }, // sigue siendo necesario en Capa 1
    });
    return NextResponse.json(patients);
  });
}
```

Notas:
- Los filtros `where: { clinicId }` siguen estando ahí. La Capa 3 (RLS) es defensa en profundidad, no reemplaza la Capa 1.
- `withClinicContext` solo cambia el comportamiento dentro de la callback. Fuera de ella, las queries no llevan contexto.
- Para webhooks o crons usa `withClinicId(clinicId, async () => { ... })` cuando ya validaste manualmente a qué clínica pertenece el request.

## Estado del rollout

- [x] **Sesión 1 — Infraestructura** (este commit)
  - `prismaAdmin` separado para bypasses legítimos
  - `clinic-context.ts` con `AsyncLocalStorage`
  - `with-clinic-context.ts` con helpers `withClinicContext` / `withClinicId`
  - `prisma.ts` con extension `$extends` que setea `app.current_clinic_id` en transacción (compatible con PgBouncer)
  - Sin cambios en API routes existentes — todo sigue funcionando vía Capa 1
- [ ] **Sesión 2 — Migrar API routes y crear policies**
  - Envolver cada route del dashboard en `withClinicContext`
  - Migrar crons/webhooks/endpoints públicos a `prismaAdmin`
  - Crear policies de RLS en Supabase para cada tabla con `clinicId`
  - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- [ ] **Sesión 3 — Tests y hardening**
  - Tests automatizados que intenten cross-clinic access
  - Auditoría de queries para detectar usos incorrectos de `prismaAdmin`
  - Documentar el modelo de amenazas y el procedimiento de incidentes

## Rollback de la Sesión 1

Esta sesión solo agrega infraestructura nueva y modifica `src/lib/prisma.ts` para añadir el extension. Como no hay policies de RLS activas, todo sigue funcionando exactamente igual que antes — el extension es un no-op cuando no hay `ClinicContext` en `AsyncLocalStorage`, y nadie lo está seteando todavía.

Para revertir:

```bash
git revert <commit-sha-de-la-sesion-1>
```

Eso restaura `src/lib/prisma.ts` al cliente original sin extension y borra los archivos nuevos (`prisma-admin.ts`, `clinic-context.ts`, `with-clinic-context.ts`, este documento). No hay migraciones de base de datos que revertir porque la Sesión 1 no toca Supabase.
