-- Heatmap: marcar los clicks capturados sobre elementos fixed/sticky.
--
-- El tracker guardaba SIEMPRE pageY (= clientY + scrollY). Para un sidebar o un
-- header pegajoso —que no se mueven con el scroll— eso registra el click cientos
-- de px más abajo de donde se ve, y en el mapa cae fuera de su elemento.
-- Ahora, si el click cayó en una capa fixed/sticky, "y" guarda clientY (relativo
-- al viewport) y esta bandera lo indica para que el visor lo dibuje tal cual.
--
-- Aditivo y con DEFAULT: el código anterior sigue funcionando sin tocarlo.
-- Los clicks YA guardados no se pueden recuperar (se anotó un pageY que no
-- corresponde a lo que se veía); esto arregla los NUEVOS.
-- Idempotente: si la columna ya existe, no falla.

ALTER TABLE "analytics_events"
  ADD COLUMN IF NOT EXISTS "yFixed" BOOLEAN NOT NULL DEFAULT false;
