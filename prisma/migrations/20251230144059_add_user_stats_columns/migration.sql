-- AlterTable
ALTER TABLE "users" ADD COLUMN     "total_listening_ms" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "total_play_count" INTEGER NOT NULL DEFAULT 0;
