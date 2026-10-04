-- ws1-t8 · auditoría de uso C-114 (decisión 10): una clínica oculta también
-- cierra su reserva web. Columna nueva en `clinics`, ABIERTA por defecto para
-- que ninguna clínica pierda su reserva al pegar esto: se cierra al ocultar la
-- clínica desde Configuración → Mi clínica (o con el interruptor «Reserva web
-- en línea»). Idempotente; no reescribe filas existentes. La tabla ya tiene RLS.
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS "reservaWebAbierta" boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.clinics."reservaWebAbierta" IS
  'C-114: false = /reservar/<slug> y el widget de la página no toman citas. Se apaga al ocultar la clínica.';
