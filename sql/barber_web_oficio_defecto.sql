-- ═══════════════════════════════════════════════════════════════════════
-- ⛔ YA NO HACE FALTA — NO APLICAR (rama feat/barber-web-solo-tres, 16-nov).
-- Desde que Mi web ofrece SOLO Oficio, Barrio y Revista, una fila con
-- 'clasica' (o cualquiera de las doce viejas) se PINTA y se EDITA como
-- Oficio al leerla (plantillaOfrecidaBarberWeb en landing.ts): no hay que
-- escribir en la base. Se deja el archivo por historia; Rafael decide si
-- se borra.
-- ═══════════════════════════════════════════════════════════════════════
--
-- barber_web_oficio_defecto.sql — «Oficio» pasa a ser la plantilla de por
-- defecto de la página web de las barberías (ws6-t2, 16-nov-2026).
--
-- El código ya hace que una barbería SIN fila en barber_landing_configs
-- (plan Básico, o quien nunca abrió Mi web) se vea con Oficio. Pero el
-- editor de Mi web guarda SIEMPRE la plantilla en curso: una barbería que
-- abrió Mi web y guardó cualquier cosa (horario, WhatsApp, un texto) SIN
-- elegir plantilla quedó con template = 'clasica' escrito en su fila, y esa
-- seguiría viéndose con Clásica.
--
-- Según Rafael (16-nov) ninguna barbería real ELIGIÓ Clásica: todas las
-- 'clasica' que haya son la de arranque de entonces. Este script las pasa a
-- 'oficio'. NO lo aplica la terminal: se pega a mano.
--
-- PASO 1 — mirar antes (solo lectura). Si en la lista sale alguna que SÍ
-- eligió Clásica a propósito, quítala del UPDATE con su barbershopId.
SELECT b."name", b."slug", c."template", c."version", c."publishedAt", c."updatedAt"
FROM "barber_landing_configs" c
JOIN "barber_shops" b ON b."id" = c."barbershopId"
WHERE c."template" = 'clasica'
ORDER BY b."name";

-- PASO 2 — el cambio. Sube `version` como un guardado más: si alguien tiene
-- Mi web abierta, su guardado se FUNDE (fusionarPlantilla) y conserva 'oficio'.
BEGIN;
UPDATE "barber_landing_configs"
SET "template" = 'oficio',
    "version" = "version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "template" = 'clasica';
-- Debe decir 0 filas con 'clasica':
SELECT count(*) AS quedan_en_clasica FROM "barber_landing_configs" WHERE "template" = 'clasica';
COMMIT;

-- La página pública se cachea (ISR): cada barbería se ve con Oficio en
-- cuanto su página se revalida (o al guardar desde Mi web).
