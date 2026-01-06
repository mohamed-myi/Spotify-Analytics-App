-- CreateTable
CREATE TABLE "track_resolution_cache" (
    "id" TEXT NOT NULL,
    "track_name" TEXT NOT NULL,
    "artist_name" TEXT NOT NULL,
    "normalized_key" TEXT NOT NULL,
    "spotify_track_id" TEXT,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_resolution_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "track_resolution_cache_normalized_key_key" ON "track_resolution_cache"("normalized_key");

-- CreateIndex
CREATE INDEX "track_resolution_cache_normalized_key_idx" ON "track_resolution_cache"("normalized_key");

