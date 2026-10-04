-- ws1-t4 · vuelta 2 · F-01 — ajuste por clínica «Facturar a empresas con retención».
--
-- POR QUÉ: cuando una persona física de régimen 612 o 626 (RESICO) le factura a
-- una PERSONA MORAL, la empresa retiene ISR (10% en 612, art. 106 LISR; 1.25% en
-- RESICO, art. 113-J LISR) y, si el servicio está gravado, 2/3 del IVA (art. 1-A
-- LIVA y 3 RLIVA). El CFDI lo tiene que decir. CONFIRMAR CON CONTADOR antes de
-- encenderlo en una clínica.
--
-- APAGADO por defecto: mientras esté en false, sigue el candado de la Tanda 0
-- (no se timbra desde DaleControl a un RFC de 12 caracteres desde 612/626).
-- Lo enciende la propia clínica en Configuración → Facturación.
--
-- Idempotente. Sin DROP ni UPDATE: todas las clínicas nacen en false.

ALTER TABLE "clinics" ADD COLUMN IF NOT EXISTS "cfdiRetenciones" BOOLEAN NOT NULL DEFAULT false;
