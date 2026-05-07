# Flow de migraciones Prisma — MediFlow

## Antes (problema)

Hasta el sprint mayo 2026 el equipo NO usaba `prisma migrate deploy` en producción. Cada modelo nuevo en `schema.prisma` se acompañaba de un SQL idempotente manual (`scripts/apply-*-prod.sql`) que el operador ejecutaba a mano contra Supabase via SQL Editor.

Síntomas visibles:

- 4+ scripts manuales aplicados directamente en prod en mayo 2026 (`scripts/apply-clinical-modules-prod.sql`, `scripts/apply-ortho-redesign-fase1-prod.sql`, etc.).
- La tabla `_prisma_migrations` no existía en prod, así que Prisma no tenía registro de qué se aplicó.
- `npx prisma migrate status` fallaba porque no encontraba la tabla — había que confiar en chequeos manuales contra `information_schema`.
- Riesgo de drift dev/prod: una columna o enum-value nuevo en `schema.prisma` podía olvidarse en el SQL manual y no aparecer en prod hasta que un usuario disparara el bug (caso real: `clinical_reminders` reportado en logs como P2021).

## Después (correcto)

```
[ developer ]
   1. Edita prisma/schema.prisma (agrega modelo / columna / enum)
   2. npx prisma migrate dev --name short_descriptive_name --create-only
      (genera prisma/migrations/<timestamp>_<name>/migration.sql)
   3. Revisa el SQL generado y ajusta si hace falta (índices, defaults, etc.)
   4. git commit + push

[ deployment ]
   5. CI o post-deploy hook ejecuta:
        $env:DATABASE_URL = "..."
        $env:DIRECT_URL   = "..."
        npx prisma migrate deploy

[ Prisma migrate deploy ]
   - Detecta migraciones en prisma/migrations que NO están en _prisma_migrations.
   - Las aplica en orden cronológico (sort lexicográfico del nombre).
   - Registra cada una en _prisma_migrations con su checksum SHA-256.
   - Si una migración falla, deja la fila con finished_at=NULL y aborta.
```

`prisma migrate deploy` NO requiere shadow database (a diferencia de `migrate dev`), por eso es seguro contra prod.

## Cómo se logró

PR `chore/prisma-migrations-backfill-and-cleanup` (mayo 2026):

1. **Diagnóstico** (`scripts/diagnose-prisma-migrations.mts`): introspeccionó las 36 migraciones locales contra prod parseando cada `migration.sql` y verificando tablas/enums/columnas/enum-values en `information_schema` y `pg_catalog`. Confirmó que las 36 ya estaban aplicadas materialmente (33 introspectables + 3 drop-only verificadas con `scripts/verify-drop-only-migrations.mts`).

2. **Backfill** (`scripts/backfill-prisma-migrations.sql`, generado por `scripts/generate-backfill-sql.mts`):
   - `CREATE TABLE IF NOT EXISTS _prisma_migrations` con la estructura exacta de Prisma 5.x.
   - `INSERT ... WHERE NOT EXISTS` por cada migración local con su checksum SHA-256.
   - Idempotente — re-correrlo es no-op.

3. **Aplicación**: `npx tsx scripts/apply-backfill-prisma-migrations.mts` ejecutó el SQL contra Supabase prod. Resultado: `_prisma_migrations` poblado con 36 filas, todos los checksums correctos.

4. **Verificación**: `npx prisma migrate status` reportó "Database schema is up to date" — los 36 checksums calculados coinciden con los esperados por Prisma.

5. **Test E2E**: se creó una migración no-op (`SELECT 1;`), se aplicó con `prisma migrate deploy` (37→36 al limpiar), y se confirmó que el flow nuevo funciona.

## Si algo se rompe

| Síntoma | Diagnóstico | Acción |
|---|---|---|
| `prisma migrate status` reporta migraciones pendientes que YA están en prod | Drift entre `_prisma_migrations` y la realidad — alguien aplicó SQL fuera de banda | Re-correr `scripts/diagnose-prisma-migrations.mts`, identificar las migraciones nuevas, regenerar `backfill-prisma-migrations.sql` con `generate-backfill-sql.mts` y aplicar. |
| `prisma migrate status` reporta drift por checksum (migration X has been modified since it was applied) | Alguien editó un `migration.sql` ya aplicado | NO editar migrations aplicadas. Para cambiar algo, crear una migración nueva. Si fue accidental, restaurar el archivo desde git. |
| `prisma migrate deploy` falla con "shadow database" | Estás corriendo `migrate dev` en lugar de `migrate deploy` | `migrate deploy` no usa shadow DB. Verificar el comando. |
| `prisma migrate deploy` cuelga en pgbouncer transaction mode (port 6543) | Prisma necesita `DIRECT_URL` para migrate, y la URL pooled bloquea por advisory locks | Configurar `DIRECT_URL` apuntando al session pooler (port 5432) o a la conexión directa. |
| Necesitamos marcar una migración como aplicada manualmente | Caso edge: una migración se aplicó vía SQL fuera de banda y quedó pendiente | `npx prisma migrate resolve --applied <migration_name>` agrega una fila a `_prisma_migrations` sin re-ejecutar el SQL. |
| Backfill desde scratch (caso original mayo 2026) | `_prisma_migrations` no existe o está corrupta | Re-correr `scripts/generate-backfill-sql.mts` + `scripts/apply-backfill-prisma-migrations.mts`. Es idempotente. |

## URLs de Supabase relevantes

- `DATABASE_URL` (runtime de la app): pooler transaction mode, port 6543, `?pgbouncer=true&connection_limit=1`.
- `DIRECT_URL` (Prisma migrate, seed, introspect): pooler session mode, port 5432, sin `?pgbouncer=true`. Requerido por advisory locks que pgbouncer transaction mode no soporta.

Ambas URLs deben estar en Vercel env vars y en `.env.local` para desarrollo.
