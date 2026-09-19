-- ============================================================
-- Plantillas de documentos — PASO 1 de 2: el enum.
-- Aplicar manualmente en Supabase SQL editor, ANTES que
-- sql/document-templates-2-tablas.sql y en un Run APARTE.
--
-- Por qué aparte: Supabase envuelve cada Run en una transacción y Postgres
-- no deja usar un valor de enum en la misma transacción en que se crea.
--
-- SQL plano a propósito (sin bloques DO): CREATE TYPE no tiene IF NOT EXISTS,
-- así que este archivo se corre UNA sola vez. Si lo corres dos veces falla
-- con «type "DocumentTemplateKind" already exists» y no pasa nada: ya estaba.
-- ============================================================

CREATE TYPE "DocumentTemplateKind" AS ENUM ('NOTA_EVOLUCION', 'CONSENTIMIENTO');
