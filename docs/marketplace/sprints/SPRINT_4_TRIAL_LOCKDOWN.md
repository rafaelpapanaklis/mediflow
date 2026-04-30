# Sprint 4 — Trial Lockdown (banners + expiry + bloqueos)

> **Objetivo:** Implementar todo el sistema de control de acceso post-trial: bloqueos visuales, pantalla de trial expirado, sugerencias inteligentes y enforcement en módulos existentes.
>
> **Tiempo estimado:** 2 días
>
> **Pre-requisitos:** Sprint 3 ✅ DONE

---

## Contexto del sprint

Hasta ahora la clínica puede comprar módulos, pero **nada los obliga a hacerlo** cuando expira el trial. Este sprint cierra el círculo: aplica `canAccessModule()` en los módulos existentes de MediFlow, muestra la pantalla de bloqueo, y genera recomendaciones basadas en uso real.

Lee `BRIEF.md` sección 1.2 (reglas del trial) y la pantalla 5 del JSX (TrialExpiredScreen) antes de empezar.

---

## Tareas

### Tarea 4.1 — Logging de uso de módulos

**`lib/marketplace/usage-logger.ts`**

```ts
import { prisma } from '@/lib/prisma';

export async function logModuleUsage(
  clinicId: string,
  moduleKey: string,
  action: 'view' | 'create_record' | 'upload_photo' | 'edit',
  userId?: string
) {
  // No bloquear el flujo principal si esto falla
  prisma.moduleUsageLog.create({
    data: { clinicId, moduleKey, action, userId }
  }).catch(err => console.error('[usage-logger]', err));
}
```

**Identificar dónde llamarlo:** Pregúntale a Rafael cuáles son los módulos que YA existen en MediFlow. Por cada uno, agregar `logModuleUsage()` en:

- Server Action de creación de registro (action: `'create_record'`)
- Subida de foto/archivo (action: `'upload_photo'`)
- Edición (action: `'edit'`)
- Page.tsx del módulo (action: `'view'`) — opcional, puede ser ruidoso

> **NOTA:** Si MediFlow ya tiene un sistema de auditoría (mencionaste `audit_logs`), considera reutilizarlo en lugar de crear logs paralelos. Pregúntale a Rafael.

### Tarea 4.2 — Aplicar `canAccessModule()` en módulos existentes

Para cada módulo que YA existe en MediFlow:

```tsx
// app/(clinic)/orthodontics/layout.tsx (ejemplo)
import { canAccessModule } from '@/lib/marketplace/access-control';
import { redirect } from 'next/navigation';
import { getCurrentClinic } from '@/lib/auth';

export default async function OrthodonticsLayout({ children }) {
  const clinic = await getCurrentClinic();
  if (!clinic) redirect('/login');

  const access = await canAccessModule(clinic.id, 'orthodontics');
  if (!access.hasAccess) {
    redirect(`/marketplace?expired=true&module=orthodontics`);
  }

  return <>{children}</>;
}
```

**Pregúntale a Rafael** la lista exacta de módulos existentes y sus paths. No asumir.

### Tarea 4.3 — Recomendaciones post-trial

**`app/actions/recommendations.ts`**

```ts
'use server'
import { prisma } from '@/lib/prisma';

export async function getTrialRecommendations(clinicId: string, limit = 3) {
  // Top N módulos por número de logs en los últimos 14 días
  const usage = await prisma.moduleUsageLog.groupBy({
    by: ['moduleKey'],
    where: {
      clinicId,
      createdAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
    },
    _count: true,
    orderBy: { _count: { moduleKey: 'desc' } },
    take: limit
  });

  if (usage.length > 0) {
    return prisma.module.findMany({
      where: {
        key: { in: usage.map(u => u.moduleKey) },
        isActive: true
      }
    });
  }

  // Fallback: si la clínica nunca usó nada, recomendar por especialidad
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: { specialty: true } // o como se llame el campo
  });

  return prisma.module.findMany({
    where: { category: clinic?.specialty || 'Dental', isActive: true },
    orderBy: { sortOrder: 'asc' },
    take: limit
  });
}
```

### Tarea 4.4 — Pantalla de Trial Expirado

**`app/(clinic)/marketplace/trial-expired/page.tsx`**

Server Component que:

1. Verifica que el trial efectivamente esté expirado (sino redirige a `/marketplace`)
2. Carga las recomendaciones con `getTrialRecommendations()`
3. Cuenta `pacientes / citas / fotos` registrados durante el trial (queries a las tablas existentes de MediFlow)
4. Renderiza `<TrialExpiredContent />` con todo eso

Extraer del JSX el componente `TrialExpiredScreen` y migrarlo a `<TrialExpiredContent />` Client Component.

### Tarea 4.5 — Modal bloqueante (`ExpiredOverlay`)

Cuando el trial expira y el usuario intenta navegar a cualquier parte del panel:

**`components/trial/ExpiredOverlay.tsx`**

```tsx
'use client'
export function ExpiredOverlay() {
  // Modal full-screen no dismissable
  // CTA: "Elegir mis módulos" → /marketplace/trial-expired
}
```

**Dónde renderizarlo:**

En `app/(clinic)/layout.tsx`, después del `TrialBanner`:

```tsx
import { getTrialStatus } from '@/lib/marketplace/access-control';

export default async function ClinicLayout({ children }) {
  const clinic = await getCurrentClinic();
  const trialStatus = await getTrialStatus(clinic.id);

  // Verificar si tiene al menos un módulo activo
  const hasActiveModules = await prisma.clinicModule.count({
    where: { clinicId: clinic.id, status: 'active' }
  }) > 0;

  const showOverlay = trialStatus?.isExpired && !hasActiveModules;

  return (
    <div>
      <TrialBanner />
      {showOverlay && <ExpiredOverlay />}
      <div className="flex">
        <Sidebar />
        <main className={showOverlay ? 'pointer-events-none' : ''}>
          {children}
        </main>
      </div>
    </div>
  );
}
```

**Excepción importante:** El overlay NO debe aparecer en `/marketplace`, `/marketplace/cart`, `/marketplace/trial-expired`, `/marketplace/success`. Esos son los únicos lugares donde el usuario puede actuar para resolver la situación.

```tsx
// Detectar la ruta actual y omitir overlay si está en marketplace:
import { headers } from 'next/headers';
const pathname = headers().get('x-pathname') || '';
const isOnMarketplace = pathname.startsWith('/marketplace');
const showOverlay = trialStatus?.isExpired && !hasActiveModules && !isOnMarketplace;
```

> **NOTA:** Para que `headers().get('x-pathname')` funcione, Rafael probablemente ya tiene un middleware que setea `x-pathname`. Si no, créalo en `middleware.ts`:
>
> ```ts
> export function middleware(request: NextRequest) {
>   const response = NextResponse.next();
>   response.headers.set('x-pathname', request.nextUrl.pathname);
>   return response;
> }
> ```

### Tarea 4.6 — Sidebar mini-status del trial

Modificar el `Sidebar` existente de MediFlow para incluir una card pequeña que muestra el estado del trial. Tres variantes según `daysLeft`:

- **Días 14-8:** card morada con dot violet
- **Días 7-4:** card amarilla con dot amber
- **Días 3-1:** card roja con dot red
- **Expirado:** card roja con candado

Copiar el diseño exacto del JSX (`Sidebar` component, sección "Mini status del trial en sidebar").

### Tarea 4.7 — Endpoint API: trial status

**`app/api/clinic/trial-status/route.ts`**

```ts
import { NextResponse } from 'next/server';
import { getCurrentClinic } from '@/lib/auth';
import { getTrialStatus } from '@/lib/marketplace/access-control';

export async function GET() {
  const clinic = await getCurrentClinic();
  if (!clinic) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const status = await getTrialStatus(clinic.id);
  const hasActiveModules = await prisma.clinicModule.count({
    where: { clinicId: clinic.id, status: 'active' }
  }) > 0;

  return NextResponse.json({
    ...status,
    hasActiveModules,
  });
}
```

Útil para que el frontend pueda hacer polling si quiere actualizar el banner en tiempo real (opcional).

### Tarea 4.8 — Cards bloqueadas en marketplace

Actualizar `ModuleCard.tsx` (creado en Sprint 2) para que cuando `trialExpired === true && !purchased`:

- Mostrar candado en esquina superior derecha
- Aplicar `opacity-75` y `grayscale` al ícono
- Cambiar el texto del botón a "Comprar para desbloquear"
- Cambiar el badge a "Bloqueado" (rojo)

Copiar la lógica exacta del JSX (sección `ModuleCard` con `isLocked`).

### Tarea 4.9 — Verificación manual

Crea una clínica de test con `trial_ends_at = NOW() - 1 day` (forzando trial expirado) y verifica:

- [ ] Al entrar al panel sin módulos comprados → aparece `ExpiredOverlay`
- [ ] Click "Elegir mis módulos" → lleva a `/marketplace/trial-expired`
- [ ] Esa página muestra stats del trial (pacientes, fotos, etc.)
- [ ] Recomendaciones aparecen basadas en uso (probar con clínica que tenga logs)
- [ ] Si la clínica no tiene logs, fallback a su especialidad funciona
- [ ] Después de comprar 1 módulo: el overlay desaparece, el módulo es accesible, los demás están bloqueados
- [ ] Intentar entrar directo al URL de un módulo no comprado → redirige a marketplace
- [ ] Sidebar muestra "Prueba expirada" en rojo

Crea otra clínica con `trial_ends_at = NOW() + 5 days` (5 días restantes):

- [ ] Sidebar muestra card amarilla "Trial · 5d restantes"
- [ ] TrialBanner aparece amarillo (warning)
- [ ] Todos los módulos accesibles
- [ ] Cards muestran estado "Trial activo"

---

## Criterios de "DONE"

✅ `logModuleUsage()` integrado en todos los módulos existentes de MediFlow
✅ `canAccessModule()` aplicado en layouts de todos los módulos
✅ Pantalla `/marketplace/trial-expired` funcional con recomendaciones
✅ `ExpiredOverlay` global con excepciones para rutas de marketplace
✅ Sidebar con mini-status del trial
✅ Cards bloqueadas en marketplace post-trial
✅ Endpoint `/api/clinic/trial-status` funcional
✅ Pruebas manuales con clínicas de diferentes estados pasando
✅ `PROGRESS.md` actualizado

---

## Notas importantes

- 🚨 **NO BLOQUEES la lectura de datos antiguos.** Si un paciente tiene una nota creada con módulo Ortodoncia durante el trial, el doctor **debe** poder ver esa nota aunque no compre Ortodoncia (NOM-024). Lo que se bloquea es la **creación de NUEVOS** registros.
   - Implementación: `canAccessModule()` debería tener un parámetro `mode: 'read' | 'write'`. En modo `read`, ser más permisivo si los datos existen.
   - Discutir con Rafael cómo quiere manejar esto exactamente.

- 🚨 **El logging de uso debe ser asíncrono.** Si la BD se cae, los registros del paciente deben seguir guardándose. Por eso el `.catch()` que solo loguea.

- 🚨 **No mostrar el `ExpiredOverlay` durante el flujo de checkout.** Sería contradictorio bloquear al usuario que está pagando.

---

## Después de terminar

1. Actualiza `PROGRESS.md` (Sprint 4 ✅ DONE)
2. **DETÉNTE** y avisa a Rafael.
