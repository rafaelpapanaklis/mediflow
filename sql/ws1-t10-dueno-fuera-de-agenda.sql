-- ═══════════════════════════════════════════════════════════════════════════
-- ws1-t10 · «Aparece en la agenda» del dueño en las clínicas YA creadas
-- Decisiones de Rafael (2-oct-2026, punto 8.1 y respuestas a ws1-t10):
--   · clínicas NUEVAS (registradas desde el 2-oct-2026): el dueño nace marcado (lo hace el código);
--   · clínicas YA creadas: sus SUPER_ADMIN quedan DESMARCADOS, SALVO que
--       a) el dueño sea el ÚNICO que atiende en su clínica (ningún DOCTOR ni ADMIN activo y marcado):
--          si él no sale, la Agenda se queda sin nadie → se queda MARCADO;
--       b) sea BEVADENT (clínica 'cmu7uttes000nq2n003bhxazo', Johnnifer lo pidió);
--       c) sea la Clínica de Prueba QA ('clinica_qa_prueba', sus 11 casos de ortodoncia la usan de tratante).
--
-- Solo toca users."agendaActive" (y "updatedAt") de filas con role = 'SUPER_ADMIN'. No borra nada,
-- no toca doctores, administradores, citas ni casos. Se vuelve a marcar desde Equipo → Editar.
--
-- «Ya creada» = clinics."createdAt" antes del 2-oct-2026 00:00 hora del centro de México (= 06:00 UTC).
-- La regla a) se evalúa AL PEGAR: si una de esas clínicas da de alta a un doctor antes, su dueño entra
-- en el cambio (el PASO 1 lo enseña). Volver a pegarlo no cambia nada más (solo toca a quien sigue marcado
-- y la regla a) no mira a otros SUPER_ADMIN).
--
-- Leído en solo lectura el 2-oct-2026 ~14:00: 17 clínicas (todas DENTAL), 17 SUPER_ADMIN activos y marcados,
-- 0 ADMIN. Esperado:
--   · se DESMARCAN 7: Clínica Dental Mariel, Clinica Dientitos Felices, Damaris Silva, Local Altabrisa,
--     Menta Dental, Rafael Clinica, thanos (todas conservan al menos un doctor en la Agenda);
--   · se quedan MARCADOS 10: los 8 donde el dueño es el único que atiende (Clinica 123, Clinica neto, dsa,
--     dsadas, dss, maedent, PonchoVida, Thanos rafa) + BEVADENT + Clínica de Prueba QA;
--   · ninguna clínica queda sin profesionales en la Agenda.
--
-- Pegar en el editor SQL de Supabase POR PASOS (el editor muestra solo el último resultado).
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── PASO 1 · ANTES (solo lectura) ─────────────────────────────────────────
-- Una fila por clínica ya creada: su dueño, qué le va a pasar y cuántos profesionales tiene en la Agenda
-- hoy y tras el PASO 2. «queda_sin_nadie» debe ser false en TODAS.
WITH dueno AS (
  SELECT u.id, u."clinicId", u."agendaActive",
         u."firstName" || ' ' || u."lastName" AS nombre,
         NOT EXISTS (SELECT 1 FROM public.users d
                      WHERE d."clinicId" = u."clinicId" AND d."isActive" AND d."agendaActive"
                        AND d.role IN ('DOCTOR', 'ADMIN')) AS unico_que_atiende
  FROM public.users u
  WHERE u.role = 'SUPER_ADMIN'
), plan AS (
  SELECT c.id AS clinic_id, c.name AS clinica, c."createdAt"::date AS alta, d.nombre AS dueno,
         d."agendaActive" AS marcado_hoy,
         CASE
           WHEN NOT d."agendaActive"                                       THEN 'ya desmarcado'
           WHEN c.id IN ('cmu7uttes000nq2n003bhxazo', 'clinica_qa_prueba') THEN 'se queda: BEVADENT / QA'
           WHEN d.unico_que_atiende                                        THEN 'se queda: único que atiende'
           ELSE 'SE DESMARCA'
         END AS que_pasa
  FROM public.clinics c
  JOIN dueno d ON d."clinicId" = c.id
  WHERE c."createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00-06'
)
SELECT p.*,
  (SELECT count(*) FROM public.users x
    WHERE x."clinicId" = p.clinic_id AND x."isActive" AND x."agendaActive"
      AND x.role IN ('DOCTOR', 'ADMIN', 'SUPER_ADMIN'))                                  AS en_agenda_hoy,
  (SELECT count(*) FROM public.users x
    WHERE x."clinicId" = p.clinic_id AND x."isActive" AND x."agendaActive"
      AND x.role IN ('DOCTOR', 'ADMIN', 'SUPER_ADMIN'))
    - CASE WHEN p.que_pasa = 'SE DESMARCA' THEN 1 ELSE 0 END                           AS en_agenda_tras_el_cambio,
  (SELECT count(*) FROM public.users x
    WHERE x."clinicId" = p.clinic_id AND x."isActive" AND x."agendaActive"
      AND x.role IN ('DOCTOR', 'ADMIN', 'SUPER_ADMIN'))
    - CASE WHEN p.que_pasa = 'SE DESMARCA' THEN 1 ELSE 0 END = 0                       AS queda_sin_nadie
FROM plan p
ORDER BY p.que_pasa, p.clinica;


-- ─── PASO 2 · EL CAMBIO ─────────────────────────────────────────────────────
-- Devuelve una fila por dueño desmarcado (la lista de clínicas afectadas). Esperado: 7 filas.
UPDATE public.users u
SET "agendaActive" = false,
    "updatedAt"    = now()
FROM public.clinics c
WHERE c.id = u."clinicId"
  AND u.role = 'SUPER_ADMIN'
  AND u."agendaActive" = true
  AND c."createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00-06'
  AND c.id NOT IN ('cmu7uttes000nq2n003bhxazo', 'clinica_qa_prueba')
  AND EXISTS (SELECT 1 FROM public.users d
               WHERE d."clinicId" = u."clinicId" AND d."isActive" AND d."agendaActive"
                 AND d.role IN ('DOCTOR', 'ADMIN'))
RETURNING c.name AS clinica, c.id AS clinic_id, u.id AS user_id,
          u."firstName" || ' ' || u."lastName" AS dueno_desmarcado;


-- ─── PASO 3 · DESPUÉS, por clínica (solo lectura) ──────────────────────────
-- Esperado: 7 «desmarcado» y 10 «marcado»; profesionales_en_agenda > 0 en todas.
SELECT
  c.name                                   AS clinica,
  u.id                                     AS user_id,
  u."firstName" || ' ' || u."lastName"     AS dueno,
  CASE WHEN u."agendaActive" THEN 'marcado' ELSE 'desmarcado' END AS aparece_en_la_agenda,
  (SELECT count(*) FROM public.users d
    WHERE d."clinicId" = c.id AND d."isActive" AND d."agendaActive"
      AND d.role IN ('DOCTOR', 'ADMIN', 'SUPER_ADMIN'))                 AS profesionales_en_agenda
FROM public.users u
JOIN public.clinics c ON c.id = u."clinicId"
WHERE u.role = 'SUPER_ADMIN'
  AND c."createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00-06'
ORDER BY aparece_en_la_agenda DESC, c.name;


-- ─── PASO 4 · CONTEOS DESPUÉS (solo lectura) ───────────────────────────────
-- Esperado: dueños_marcados 10, dueños_desmarcados 7, clinicas_sin_nadie_en_agenda 0.
SELECT
  count(*) FILTER (WHERE u."agendaActive")      AS duenos_marcados,
  count(*) FILTER (WHERE NOT u."agendaActive")  AS duenos_desmarcados,
  (SELECT count(*) FROM public.clinics c2
    WHERE c2."createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00-06'
      AND NOT EXISTS (SELECT 1 FROM public.users d
                       WHERE d."clinicId" = c2.id AND d."isActive" AND d."agendaActive"
                         AND d.role IN ('DOCTOR', 'ADMIN', 'SUPER_ADMIN')))  AS clinicas_sin_nadie_en_agenda
FROM public.users u
JOIN public.clinics c ON c.id = u."clinicId"
WHERE u.role = 'SUPER_ADMIN'
  AND c."createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00-06';


-- ─── DESHACER (solo si hiciera falta; NO pegar junto con lo de arriba) ─────
-- Hoy (antes del PASO 2) los 17 dueños están marcados, así que deshacer = volver a marcar a todos:
-- UPDATE public.users u SET "agendaActive" = true, "updatedAt" = now()
-- FROM public.clinics c
-- WHERE c.id = u."clinicId" AND u.role = 'SUPER_ADMIN' AND u."agendaActive" = false
--   AND c."createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00-06';
