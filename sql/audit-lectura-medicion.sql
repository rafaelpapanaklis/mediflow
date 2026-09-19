-- Bitácora de LECTURA del expediente — MEDICIÓN (solo SELECT, no cambia nada).
--
-- La terminal no tiene acceso a la base, así que el «cuántas filas al día» lo
-- contesta esta consulta. Las lecturas YA se registraban antes de este cambio
-- (action = 'view'), así que lo que salga aquí es el tráfico real de hoy.
--
-- Cómo leerlo:
--   · entityType 'record'  + sin _read  → ficha abierta, formato ANTIGUO (una fila por render)
--   · entityType 'patient' + exportCda  → export CDA, formato antiguo
--   · changes->'_read'->'after'->>'kind' → formato NUEVO (ficha / nota_pdf / export_cda / export_arco)
-- Tras integrar, las filas de 'ficha' deben BAJAR respecto a las 'record' antiguas:
-- el dedupe de 5 min quita las que escribía cada re-render al guardar.

SELECT
  date_trunc('day', "createdAt")::date                         AS dia,
  "entityType",
  COALESCE(changes->'_read'->'after'->>'kind', '(antiguo)')    AS tipo,
  count(*)                                                     AS filas,
  count(DISTINCT "clinicId")                                   AS clinicas,
  count(DISTINCT "userId")                                     AS usuarios
FROM audit_logs
WHERE action = 'view'
  AND "createdAt" > now() - interval '14 days'
GROUP BY 1, 2, 3
ORDER BY 1 DESC, 4 DESC;

-- Y cuánto pesa 'view' frente al resto de la bitácora en esos 14 días:
SELECT action, count(*) AS filas
FROM audit_logs
WHERE "createdAt" > now() - interval '14 days'
GROUP BY 1
ORDER BY 2 DESC;
