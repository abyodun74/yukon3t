-- Per-language versions of a "What's new" announcement (src/lib/announcement-translations.ts). Additive only: one new
-- table, nothing existing is altered, so every announcement already posted keeps showing its own (English) title and
-- body to everyone. Hand-written to match what `prisma migrate diff` produces for the schema change; it holds no DROP
-- INDEX for the hand-written HNSW indexes.

-- CreateTable
CREATE TABLE "AnnouncementTranslation" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementTranslation_announcementId_locale_key" ON "AnnouncementTranslation"("announcementId", "locale");

-- CreateIndex
CREATE INDEX "AnnouncementTranslation_locale_idx" ON "AnnouncementTranslation"("locale");

-- AddForeignKey
ALTER TABLE "AnnouncementTranslation" ADD CONSTRAINT "AnnouncementTranslation_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
