-- ════════════════════════════════════════════════════════════════════════════
-- Backfill _prisma_migrations en producción
--
-- Causa raíz: el equipo aplicaba SQL idempotente directo en Supabase en lugar
-- de `prisma migrate deploy`. Por eso la tabla _prisma_migrations nunca se
-- creó y cada sprint se necesitaba un nuevo SQL manual para sincronizar.
--
-- Este script:
--   1. Crea la tabla _prisma_migrations (estructura idéntica a la que crea
--      `prisma migrate deploy` en su primera ejecución).
--   2. Inserta una fila por cada migración local cuya estructura ya está en
--      prod (verificado con scripts/diagnose-prisma-migrations.mts y
--      scripts/verify-drop-only-migrations.mts).
--
-- IDEMPOTENTE — re-correrlo es seguro:
--   * CREATE TABLE IF NOT EXISTS
--   * INSERT ... WHERE NOT EXISTS por migration_name
--
-- Después de aplicar este script:
--   $env:DATABASE_URL = "..."
--   npx prisma migrate status   # esperado: "Database schema is up to date"
--
-- Generado por scripts/generate-backfill-sql.mts — no editar a mano.
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS _prisma_migrations (
    id                      VARCHAR(36) PRIMARY KEY NOT NULL,
    checksum                VARCHAR(64) NOT NULL,
    finished_at             TIMESTAMPTZ,
    migration_name          VARCHAR(255) NOT NULL,
    logs                    TEXT,
    rolled_back_at          TIMESTAMPTZ,
    started_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    applied_steps_count     INTEGER NOT NULL DEFAULT 0
);

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'a7f2c5fc5f5911ad919643901868703451e57ddf30d88de5f3fef8c6b976c8d9', '20260424120000_fase_4_agenda', '2026-04-24T12:00:00.000Z'::timestamptz, '2026-04-24T12:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260424120000_fase_4_agenda');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'ee779f4d58ebc9b20aa88471c346f0bde49635f03e685805db882c2ea9b8a836', '20260425130000_drop_legacy_appt_columns', '2026-04-25T13:00:00.000Z'::timestamptz, '2026-04-25T13:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260425130000_drop_legacy_appt_columns');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '724f882865a229dd616061de6bc4f75b52b07ba98276a58386d2240da8cb6ec9', '20260426120000_user_agenda_active', '2026-04-26T12:00:00.000Z'::timestamptz, '2026-04-26T12:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260426120000_user_agenda_active');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '960659a3d28324d55743a8a7a4fb2fadfa8ea36d0dbf316109400c39e5f731f4', '20260427120000_odontogram_entry', '2026-04-27T12:00:00.000Z'::timestamptz, '2026-04-27T12:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260427120000_odontogram_entry');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '2f12b9577006d832387b4d166f42260baa3b165ce55f34676cb628fcb78c5303', '20260427180000_odontogram_snapshot', '2026-04-27T18:00:00.000Z'::timestamptz, '2026-04-27T18:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260427180000_odontogram_snapshot');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'bd5a3a784c8f4df32c8cffed2d79a0a91abc0ec3d177e012e4c7749fb8bfb449', '20260427210000_inbox_reminders', '2026-04-27T21:00:00.000Z'::timestamptz, '2026-04-27T21:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260427210000_inbox_reminders');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '7704b201a0e87eb7338e8fe5155f906cdfa51d33334cbd4ba5b95fa99a1176bb', '20260428000000_xray_annotations', '2026-04-28T00:00:00.000Z'::timestamptz, '2026-04-28T00:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428000000_xray_annotations');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '9368f69f1206e9040e09fcb56157c0da0964f29789d1b10cb76dc260d675d6c6', '20260428100000_clinic_layout', '2026-04-28T10:00:00.000Z'::timestamptz, '2026-04-28T10:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428100000_clinic_layout');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '2d62f472d4f41780f64b2ceed084eb414aa1808850b4b6f247b921730cd0418d', '20260428200000_analytics_v1', '2026-04-28T20:00:00.000Z'::timestamptz, '2026-04-28T20:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428200000_analytics_v1');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '4e61503f998269beee456da9d88226f8817a382c679e2179d561d32198cd80a9', '20260428210000_compliance_a1_identification', '2026-04-28T21:00:00.000Z'::timestamptz, '2026-04-28T21:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428210000_compliance_a1_identification');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '00ea2eac178d2136da46357369ce427d9bfefb9a9a478c528a498dd9d4cbff84', '20260428220000_compliance_a2_antecedentes', '2026-04-28T22:00:00.000Z'::timestamptz, '2026-04-28T22:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428220000_compliance_a2_antecedentes');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '06af805ff88be87ffd5d51a6b99247be5195606d06cb5f92926cfc23d51867d5', '20260428230000_compliance_a4_arco', '2026-04-28T23:00:00.000Z'::timestamptz, '2026-04-28T23:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428230000_compliance_a4_arco');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'e036cbd670f0feadb9abe7655cb92a3454d281edbfa6517787691b9ab3d12aa6', '20260428240000_compliance_b1_cie10', '2026-04-29T00:00:00.000Z'::timestamptz, '2026-04-29T00:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428240000_compliance_b1_cie10');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'd64ba36a4d9bdae81e09b0863b66d49b2b3f543c1f41a9f3e218ead48a3adda7', '20260428250000_compliance_b2_cums', '2026-04-29T01:00:00.000Z'::timestamptz, '2026-04-29T01:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428250000_compliance_b2_cums');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '965ee3124213c18e55530b2cbbc51550c72b1f7537684c9fb75deb541978f703', '20260428260000_compliance_b3_cie9', '2026-04-29T02:00:00.000Z'::timestamptz, '2026-04-29T02:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428260000_compliance_b3_cie9');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '0608cca088bb5e4ea833e52ac7ce47bd9e421219677a7f2c91dbd0898c2a0cb8', '20260428270000_compliance_c1_signature', '2026-04-29T03:00:00.000Z'::timestamptz, '2026-04-29T03:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428270000_compliance_c1_signature');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'a9c62331fce834d46db581ecf5243fd43a1a68720b3c7272e60088e1ce21baed', '20260428280000_compliance_c2_referrals', '2026-04-29T04:00:00.000Z'::timestamptz, '2026-04-29T04:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260428280000_compliance_c2_referrals');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '016d501b57181594ca153e5ea92b3121a69a5f99bfdf8da285848fe1cce78b8a', '20260429000000_xray_doctor_notes', '2026-04-29T00:00:00.000Z'::timestamptz, '2026-04-29T00:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260429000000_xray_doctor_notes');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '40d6c701d2f2d520570e990b13d22633e1b95845d6be5188a7911b5aaac88fad', '20260430000000_perf_indexes', '2026-04-30T00:00:00.000Z'::timestamptz, '2026-04-30T00:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260430000000_perf_indexes');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'd17b111bb87b5bfede0d1707442de7463efd49d6e2e8bbbb3288366f7b3c5726', '20260430120000_arco_anonymization', '2026-04-30T12:00:00.000Z'::timestamptz, '2026-04-30T12:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260430120000_arco_anonymization');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'd746fa3cbd340fcb2519c69cc7c23df07d45bd5a1c4b2907ebea42cfbe3da486', '20260430140000_marketplace_foundation', '2026-04-30T14:00:00.000Z'::timestamptz, '2026-04-30T14:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260430140000_marketplace_foundation');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '64c795e420c3786b8fd616c532d88f92f80fc06124069399cf8134f6c6d3362e', '20260430160000_pediatrics_module', '2026-04-30T16:00:00.000Z'::timestamptz, '2026-04-30T16:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260430160000_pediatrics_module');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '83f87ff79130ee5b8fbecaeb90dbbc179c3d55f5cb866d55b4a8cba906532dd9', '20260504100000_endodontics_module', '2026-05-04T10:00:00.000Z'::timestamptz, '2026-05-04T10:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260504100000_endodontics_module');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'd98282d62a3c825be25a17d7adf1d3d309081a26e182fe0938e8e275ee78cc81', '20260504160000_periodontics_module', '2026-05-04T16:00:00.000Z'::timestamptz, '2026-05-04T16:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260504160000_periodontics_module');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '05e919fcbdd90e8be05339ad8af919dc3d294b7acdab6486fd7956f646653133', '20260504200000_implants_module', '2026-05-04T20:00:00.000Z'::timestamptz, '2026-05-04T20:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260504200000_implants_module');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '7bc64eb700c10bb6e765294a357eec6a6edfea411c4175c7896ceb287391e9b2', '20260504210000_drop_implant_traceability_trigger', '2026-05-04T21:00:00.000Z'::timestamptz, '2026-05-04T21:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260504210000_drop_implant_traceability_trigger');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'f3660607fc20be0128ddf7bf444173fd715c016995aa50b504b30e7c730bb268', '20260505000000_orthodontics_module', '2026-05-05T00:00:00.000Z'::timestamptz, '2026-05-05T00:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260505000000_orthodontics_module');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'db617361067e3b2647cf619cb7a57c58883dfdca1143a5da2d7fdcc931d02f72', '20260505100000_dental_cross_modules', '2026-05-05T10:00:00.000Z'::timestamptz, '2026-05-05T10:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260505100000_dental_cross_modules');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'e2aafc0b8f73173510d8bda470058c4b70a1df30d7b2d3fa288830515fdd175f', '20260505140000_clinical_shared_modules', '2026-05-05T14:00:00.000Z'::timestamptz, '2026-05-05T14:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260505140000_clinical_shared_modules');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'c01cd5862bccb599825bfee71d5bce59125203f83c926ddb6abe09124506b119', '20260505150000_perio_photo_types_extension', '2026-05-05T15:00:00.000Z'::timestamptz, '2026-05-05T15:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260505150000_perio_photo_types_extension');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'a2694dd77e7099eccf60715aff44eae7300f36c0bdfec8489079d12d28002441', '20260505160000_perio_lab_order_types_extension', '2026-05-05T16:00:00.000Z'::timestamptz, '2026-05-05T16:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260505160000_perio_lab_order_types_extension');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '1aeae708b45d38c43fe226976a56f94c260f78429e76e587369980eba33dd715', '20260505170000_perio_maintenance_reminder_types', '2026-05-05T17:00:00.000Z'::timestamptz, '2026-05-05T17:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260505170000_perio_maintenance_reminder_types');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), 'dd375b5b92450cb0e9bafd670a8e354331b05a00ab6ccdd289d5b90d79d9ef9e', '20260505210000_implants_photo_types', '2026-05-05T21:00:00.000Z'::timestamptz, '2026-05-05T21:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260505210000_implants_photo_types');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '5abbaee76d3d0fe3cc8af1371e16f4e679ea0930f6d2b2bbc33483f1adc91ad0', '20260505220000_implants_reminder_types', '2026-05-05T22:00:00.000Z'::timestamptz, '2026-05-05T22:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260505220000_implants_reminder_types');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '8cd69ab0d639d138c5406e02618e02fc8bbb13e1a54d5f95baa44e0a3eb7e46c', '20260505230000_implant_catalog_models', '2026-05-05T23:00:00.000Z'::timestamptz, '2026-05-05T23:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260505230000_implant_catalog_models');

INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
SELECT gen_random_uuid(), '5d6f930a365f0a27efaedd7669ed8f48de9731b33543b58e871e4908fad09371', '20260506000000_ortho_patient_redesign_fase1', '2026-05-06T00:00:00.000Z'::timestamptz, '2026-05-06T00:00:00.000Z'::timestamptz, 1
WHERE NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20260506000000_ortho_patient_redesign_fase1');

-- Verificación:
-- SELECT migration_name, finished_at, applied_steps_count
-- FROM _prisma_migrations ORDER BY started_at;
