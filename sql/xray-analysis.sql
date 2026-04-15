-- CreateTable
CREATE TABLE "xray_analyses" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "severity" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "modelUsed" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "xray_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "xray_analyses_fileId_key" ON "xray_analyses"("fileId");

-- CreateIndex
CREATE INDEX "xray_analyses_clinicId_idx" ON "xray_analyses"("clinicId");

-- CreateIndex
CREATE INDEX "xray_analyses_patientId_idx" ON "xray_analyses"("patientId");

-- CreateIndex
CREATE INDEX "xray_analyses_severity_idx" ON "xray_analyses"("severity");

-- AddForeignKey
ALTER TABLE "xray_analyses" ADD CONSTRAINT "xray_analyses_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "patient_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xray_analyses" ADD CONSTRAINT "xray_analyses_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xray_analyses" ADD CONSTRAINT "xray_analyses_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

