# Performance — runbook

## Connection pooling (Supabase + Prisma + Vercel)

`prisma/schema.prisma` ya está configurado con `url + directUrl`:

```
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")   // pooled (pgbouncer)
  directUrl = env("DIRECT_URL")     // direct (para migrations)
}
```

Lo que tiene que estar en Vercel env vars:

```
DATABASE_URL = "postgresql://postgres.<ref>:<pwd>@aws-X-region.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL   = "postgresql://postgres.<ref>:<pwd>@aws-X-region.pooler.supabase.com:5432/postgres"
```

Notas:
- Puerto **6543** = pgbouncer (transaction mode).
- Puerto **5432** = direct connection.
- `?pgbouncer=true` le dice a Prisma que está atrás de un pooler — desactiva
  prepared statements automáticamente (transaction mode no los soporta).
- `connection_limit=1` por function instance evita que un cold start abra
  100 conexiones a la vez.
- `DIRECT_URL` solo se usa para `prisma migrate` y `prisma db push`. En
  runtime de Vercel solo se usa `url` (pooled).

Verificar en Supabase:
```
Project Settings → Database → Connection string → "Connection pooling"
```

Si el preview corre lento, el primer sospechoso es que `DATABASE_URL` esté
apuntando al puerto 5432 (direct) y no al 6543 (pooled). Cada cold start
abre una conexión nueva sin reciclar — degrada brutalmente bajo carga.

## Indexes aplicados

Migración `20260430000000_perf_indexes` agrega índices compuestos para las
queries calientes. Aplicar con `prisma migrate deploy` contra el DB del
entorno (el build script de Vercel solo hace `prisma generate + next build`,
NO migrate).

## Loading skeletons

`src/app/dashboard/*/loading.tsx` renderiza skeletons al instante mientras
los server components hacen su query inicial. Next.js usa el Suspense
boundary automático del segmento. No hay que envolver nada manualmente
mientras el segmento tenga `loading.tsx` vecino.

## Queries a evitar

- `prisma.X.findMany()` sin `select` explícito en endpoints calientes —
  trae todas las columnas (incluye Json grandes como `vitals`,
  `specialtyData`, `annotations`).
- Loops `for await` sobre relaciones (N+1). Preferir `groupBy` + map en JS,
  o `_count` con relations.
- `findUnique` redundantes cuando `loadClinicSession()` ya cargó la clinic
  con un select que cubre lo necesario.

## TODOs identificados pero NO arreglados (riesgo/scope)

1. **Cache de doctores y resources**: cambian rara vez (días/semanas).
   `/api/agenda/range` los re-fetcha en cada navegación de día. Candidatos
   a SWR `revalidate: 600` o cache cliente con `useSWR`.

2. **Denormalizar `Patient.lastVisitDate` y `Patient.balance`**: hoy se
   computan en JS post-fetch a partir de records + invoices. Causa la rama
   "post-fetch path" en `/api/patients` que carga hasta 5000 rows. Si se
   denormalizan (trigger SQL o background job), la query usa solo el
   compuesto `(clinicId, status, createdAt)` y pagina nativo en DB.

3. **Streaming SSR con Suspense + 2 server children**: `/dashboard/agenda`
   espera 5 queries en `Promise.all` antes de renderizar (`appointments`,
   `doctors`, `resources`, `pendingValidation`, `waitlistCount`). Se podría
   dividir en shell + 2 streamed children: shell rápido con doctors+resources
   (cachable), child con appointments del día.

4. **Removed unused dynamic deps**: `@daily-co/daily-js`, `@daily-co/daily-react`,
   `daily-co` no aparecen importados en `src/`. Probablemente legacy de la
   feature de teleconsulta. Vale `npm uninstall` si confirma que no se usan.
