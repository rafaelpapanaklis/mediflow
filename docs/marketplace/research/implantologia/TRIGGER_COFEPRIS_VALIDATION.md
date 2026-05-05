# Validación del trigger COFEPRIS — runbook

> Trigger: `protect_implant_traceability` (BEFORE UPDATE en `implants`)
> Spec §1.9, §10.2 · Migración: `prisma/migrations/20260504200000_implants_module/migration.sql` §5

## Por qué

El trigger valida que cualquier UPDATE en `brand` / `lotNumber` / `placedAt`
solo se ejecute si la sesión tiene activo el flag
`app.implant_mutation_justified = 'true'`. La server action
`updateImplantTraceability` ejecuta `SET LOCAL app.implant_mutation_justified='true'`
**dentro de la misma transacción** justo antes del UPDATE.

El riesgo conocido: **algunos poolers (notablemente pgbouncer en
transaction mode, que es lo que usa Supabase por defecto) pueden no
respetar `SET LOCAL`**. En ese caso la action genuina rompe junto con
el bypass malicioso, y hay que decidir si el trigger sigue valiendo la
pena.

## Opción A — Validar automatizado vía test E2E

```bash
cd C:/Users/Rafael/Documents/GitHub/mediflow-implant
DATABASE_URL="<URL del pooler — el mismo que usa la app en producción>" \
DIRECT_URL="<URL directo — bypassea el pooler>" \
npx tsx --test src/lib/implants/__tests__/trigger-cofepris.test.ts
```

El test ejecuta 4 casos sobre un implante temporal en la clínica
DENTAL con módulo `implants` activo. Cada caso:

1. **UPDATE de `lotNumber` SIN flag → debe FALLAR** con error que mencione "COFEPRIS" o "insufficient_privilege".
2. **UPDATE de `lotNumber` CON flag dentro de transacción → debe PASAR.**
3. **UPDATE de `notes` (no COFEPRIS) sin flag → debe PASAR.**
4. **DELETE → debe FALLAR** por el trigger gemelo `block_implant_delete`.

> Si el caso 2 falla con "permission denied" / "insufficient_privilege"
> y los demás casos pasan, **el pooler está ignorando SET LOCAL**.
> Pasar a la sección "Si el trigger no funciona con el pooler".

## Opción B — Validar manual en Supabase SQL Editor

En el SQL Editor de Supabase, sustituyendo `<implant-id>` por el id
de cualquier implante existente (idealmente uno de los seeds):

```sql
-- Caso 1: UPDATE sin flag — debe fallar
BEGIN;
UPDATE "implants"
SET "lotNumber" = 'HACK_TEST_001'
WHERE id = '<implant-id>';
-- esperado: ERROR  COFEPRIS: brand/lotNumber/placedAt son inmutables...
ROLLBACK;

-- Caso 2: UPDATE con flag dentro de transacción — debe pasar
BEGIN;
SET LOCAL app.implant_mutation_justified = 'true';
UPDATE "implants"
SET "lotNumber" = 'AUDITED_TEST_001'
WHERE id = '<implant-id>';
-- esperado: UPDATE 1
ROLLBACK;  -- ROLLBACK para no contaminar la DB

-- Caso 3: UPDATE de notes sin flag — debe pasar
BEGIN;
UPDATE "implants" SET notes = 'Sin valor COFEPRIS — debe pasar' WHERE id = '<implant-id>';
ROLLBACK;

-- Caso 4: DELETE — debe fallar
BEGIN;
DELETE FROM "implants" WHERE id = '<implant-id>';
-- esperado: ERROR  COFEPRIS: DELETE en implants prohibido. Use UPDATE...
ROLLBACK;
```

## Si el trigger NO funciona con el pooler

Síntoma: el caso 2 (con `SET LOCAL`) falla igual que el caso 1, lo que
significa que el pooler resetea el flag entre el `SET LOCAL` y el
`UPDATE` (rompiendo la app real, no solo el test).

Resolución:

```sql
-- Eliminar el trigger; mantener block_implant_delete
DROP TRIGGER IF EXISTS protect_implant_traceability_trg ON "implants";
```

La validación queda solo en la capa de aplicación, que sigue siendo
robusta:

- **Capa 1 — zod**: `updateImplantTraceabilitySchema` exige
  `justification.length >= 20`.
- **Capa 2 — server action**: `updateImplantTraceability` rechaza el
  UPDATE si la justificación no cumple, registra audit log con
  `cofeprisTraceability:true` + before/after + cédula del doctor.
- **Capa 3 — audit log inmutable**: la query
  `SELECT * FROM "audit_logs" WHERE changes->>'_meta' LIKE '%cofeprisTraceability%'`
  devuelve la cadena completa de modificaciones para defensa legal.

Lo que se pierde: defensa contra UPDATE manual desde consola SQL del
admin de Supabase. No se pierde defensa contra modificaciones desde
la aplicación.

Después de eliminar el trigger, agregar este commit follow-up:

```
chore(implant): elimina trigger protect_implant_traceability — pooler ignora SET LOCAL

El pooler de Supabase (pgbouncer transaction mode) no respeta SET LOCAL,
por lo que el trigger rompía updateImplantTraceability en producción.
Validación queda en capa de aplicación: zod ≥20 chars + audit log con
cofeprisTraceability:true. Suficiente para defensa COFEPRIS — la única
pérdida es la defensa contra UPDATE directo desde consola SQL del admin.
```

## Si el trigger SÍ funciona con el pooler

Documenta en este archivo la fecha de validación + el id del implante
de prueba que usaste, y cierra el issue. El test E2E se queda en
`src/lib/implants/__tests__/trigger-cofepris.test.ts` para CI futuro
(skipped si DATABASE_URL no está definido).

## Bitácora

| Fecha | Operador | Resultado | Notas |
|-------|----------|-----------|-------|
|       |          |           |       |
