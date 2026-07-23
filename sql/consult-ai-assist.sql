ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS "aiAssist" JSONB;
COMMENT ON COLUMN medical_records."aiAssist" IS 'Análisis del asistente IA adjuntado a la consulta (procedencia IA). Forma: { version, model, generatedAt, applied, appliedAt, appliedByUserId, result:{hallazgos,puntosAlerta[],plan,resumen}, disclaimer }';
