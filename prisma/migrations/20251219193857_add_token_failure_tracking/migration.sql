-- AlterTable
ALTER TABLE "spotify_auth" ADD COLUMN     "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_failure_at" TIMESTAMP(3),
ADD COLUMN     "last_failure_reason" TEXT;
