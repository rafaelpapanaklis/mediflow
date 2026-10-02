-- ═══════════════════════════════════════════════════════════════════════════
-- ws1-t10 · «Aparece en la agenda» del dueño en las clínicas YA creadas
-- Decisión de Rafael (2-oct-2026, punto 8.1):
--   · clínicas NUEVAS (registradas desde el 2-oct-2026): el dueño nace marcado (lo hace el código);
--   · clínicas YA creadas: TODOS sus SUPER_ADMIN quedan DESMARCADOS,
--     EXCEPTO el dueño de BEVADENT (Johnnifer Benítez Valencia, users.id = 'cmu7uttet000oq2n0g0ucee1q',
--     clínica 'cmu7uttes000nq2n003bhxazo'), que pidió aparecer.
--
-- Solo toca users."agendaActive" (y "updatedAt") de filas con role = 'SUPER_ADMIN'. No borra nada,
-- no toca doctores, administradores, citas ni casos. Se puede volver a marcar a cualquiera desde
-- Equipo → Editar → «Aparece en la agenda».
--
-- «Ya creada» = clinics."createdAt" antes del 2-oct-2026 00:00 hora del centro de México
-- (= 06:00 UTC; México ya no cambia de horario). Si se pega días después, las clínicas registradas
-- desde el 2-oct se quedan marcadas, como manda la decisión.
--
-- Leído en solo lectura el 2-oct-2026 ~13:30: 17 clínicas, todas DENTAL, 17 SUPER_ADMIN activos y
-- marcados. Este UPDATE debería tocar 16 filas (todas menos Johnnifer).
--
-- Pegar en el editor SQL de Supabase en TRES pasos (el editor muestra solo el último resultado).
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── PASO 1 · ANTES (solo lectura) ─────────────────────────────────────────
-- Cada clínica ya creada con su dueño y cuántos profesionales quedarían en la Agenda tras el paso 2
-- (doctores y administradores activos y marcados + Johnnifer). «queda_sin_nadie» = la Agenda de
-- esa clínica se quedaría sin columnas hasta que alguien marque la casilla en Equipo.
SELECT
  c.name                                                    AS clinica,
  c.id                                                      AS clinic_id,
  c."createdAt"::date                                       AS alta,
  string_agg(DISTINCT CASE WHEN u.role = 'SUPER_ADMIN'
             THEN u."firstName" || ' ' || u."lastName" || ' (' ||
                  CASE WHEN u."agendaActive" THEN 'marcado' ELSE 'desmarcado' END || ')' END, ', ')
                                                            AS duenos_hoy,
  count(*) FILTER (WHERE u."isActive" AND u."agendaActive"
                   AND u.role IN ('DOCTOR', 'ADMIN', 'SUPER_ADMIN'))         AS en_agenda_hoy,
  count(*) FILTER (WHERE u."isActive" AND u."agendaActive"
                   AND (u.role IN ('DOCTOR', 'ADMIN') OR u.id = 'cmu7uttet000oq2n0g0ucee1q'))
                                                            AS en_agenda_tras_el_cambio,
  count(*) FILTER (WHERE u."isActive" AND u."agendaActive"
                   AND (u.role IN ('DOCTOR', 'ADMIN') OR u.id = 'cmu7uttet000oq2n0g0ucee1q')) = 0
                                                            AS queda_sin_nadie
FROM public.clinics c
LEFT JOIN public.users u ON u."clinicId" = c.id
WHERE c."createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00-06'
GROUP BY c.id, c.name, c."createdAt"
ORDER BY queda_sin_nadie DESC, c.name;


-- ─── PASO 2 · EL CAMBIO ─────────────────────────────────────────────────────
-- Devuelve una fila por dueño desmarcado (la lista de clínicas afectadas). Esperado: 16 filas.
-- Volver a pegarlo no hace nada (solo toca a quien sigue marcado).
UPDATE public.users u
SET "agendaActive" = false,
    "updatedAt"    = now()
FROM public.clinics c
WHERE c.id = u."clinicId"
  AND u.role = 'SUPER_ADMIN'
  AND u."agendaActive" = true
  AND u.id <> 'cmu7uttet000oq2n0g0ucee1q'
  AND c."createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00-06'
RETURNING c.name AS clinica, c.id AS clinic_id, u.id AS user_id,
          u."firstName" || ' ' || u."lastName" AS dueno_desmarcado;


-- ─── PASO 3 · DESPUÉS (solo lectura) ───────────────────────────────────────
-- Esperado: todos los SUPER_ADMIN de clínicas ya creadas en «desmarcado», salvo Johnnifer en «marcado».
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


-- ─── DESHACER (solo si hiciera falta; NO pegar junto con lo de arriba) ─────
-- UPDATE public.users u SET "agendaActive" = true, "updatedAt" = now()
-- FROM public.clinics c
-- WHERE c.id = u."clinicId" AND u.role = 'SUPER_ADMIN' AND u."agendaActive" = false
--   AND c."createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00-06';
