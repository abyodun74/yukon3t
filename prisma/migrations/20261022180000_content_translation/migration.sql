-- Translate posts, comments and messages into the reader's language (src/lib/translation.ts). Generated with
-- `prisma migrate diff` from the previous schema; the CHECK constraint at the end was added by hand.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "autoTranslate" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ContentTranslation" (
    "id" TEXT NOT NULL,
    "postId" TEXT,
    "commentId" TEXT,
    "messageId" TEXT,
    "contentHash" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "sourceLang" TEXT NOT NULL,
    "translatedText" TEXT,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_postId_targetLang_contentHash_key" ON "ContentTranslation"("postId", "targetLang", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_commentId_targetLang_contentHash_key" ON "ContentTranslation"("commentId", "targetLang", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_messageId_targetLang_contentHash_key" ON "ContentTranslation"("messageId", "targetLang", "contentHash");

-- AddForeignKey
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every row belongs to exactly one post, comment or message (each cascades with it).
ALTER TABLE "ContentTranslation" ADD CONSTRAINT "ContentTranslation_one_source_check" CHECK (num_nonnulls("postId", "commentId", "messageId") = 1);
