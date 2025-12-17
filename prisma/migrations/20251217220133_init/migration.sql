-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "spotify_id" TEXT NOT NULL,
    "display_name" TEXT,
    "email" TEXT,
    "image_url" TEXT,
    "country" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_ingested_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spotify_auth" (
    "user_id" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "last_refresh_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "spotify_auth_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "tracks" (
    "id" TEXT NOT NULL,
    "spotify_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "album_id" TEXT,
    "preview_url" TEXT,

    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artists" (
    "id" TEXT NOT NULL,
    "spotify_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_url" TEXT,
    "genres" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "albums" (
    "id" TEXT NOT NULL,
    "spotify_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "image_url" TEXT,
    "release_date" TEXT,

    CONSTRAINT "albums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_artists" (
    "track_id" TEXT NOT NULL,
    "artist_id" TEXT NOT NULL,

    CONSTRAINT "track_artists_pkey" PRIMARY KEY ("track_id","artist_id")
);

-- CreateTable
CREATE TABLE "listening_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "played_at" TIMESTAMP(3) NOT NULL,
    "ms_played" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'api',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listening_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_track_stats" (
    "user_id" TEXT NOT NULL,
    "track_id" TEXT NOT NULL,
    "play_count" INTEGER NOT NULL DEFAULT 0,
    "total_ms" BIGINT NOT NULL DEFAULT 0,
    "last_played_at" TIMESTAMP(3),

    CONSTRAINT "user_track_stats_pkey" PRIMARY KEY ("user_id","track_id")
);

-- CreateTable
CREATE TABLE "user_artist_stats" (
    "user_id" TEXT NOT NULL,
    "artist_id" TEXT NOT NULL,
    "play_count" INTEGER NOT NULL DEFAULT 0,
    "total_ms" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "user_artist_stats_pkey" PRIMARY KEY ("user_id","artist_id")
);

-- CreateTable
CREATE TABLE "user_time_bucket_stats" (
    "user_id" TEXT NOT NULL,
    "bucket_type" TEXT NOT NULL,
    "bucket_date" TIMESTAMP(3) NOT NULL,
    "play_count" INTEGER NOT NULL DEFAULT 0,
    "total_ms" BIGINT NOT NULL DEFAULT 0,
    "unique_tracks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "user_time_bucket_stats_pkey" PRIMARY KEY ("user_id","bucket_type","bucket_date")
);

-- CreateTable
CREATE TABLE "user_hour_stats" (
    "user_id" TEXT NOT NULL,
    "hour" INTEGER NOT NULL,
    "play_count" INTEGER NOT NULL DEFAULT 0,
    "total_ms" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "user_hour_stats_pkey" PRIMARY KEY ("user_id","hour")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_spotify_id_key" ON "users"("spotify_id");

-- CreateIndex
CREATE UNIQUE INDEX "tracks_spotify_id_key" ON "tracks"("spotify_id");

-- CreateIndex
CREATE INDEX "tracks_spotify_id_idx" ON "tracks"("spotify_id");

-- CreateIndex
CREATE UNIQUE INDEX "artists_spotify_id_key" ON "artists"("spotify_id");

-- CreateIndex
CREATE INDEX "artists_spotify_id_idx" ON "artists"("spotify_id");

-- CreateIndex
CREATE UNIQUE INDEX "albums_spotify_id_key" ON "albums"("spotify_id");

-- CreateIndex
CREATE INDEX "albums_spotify_id_idx" ON "albums"("spotify_id");

-- CreateIndex
CREATE INDEX "listening_events_user_id_played_at_idx" ON "listening_events"("user_id", "played_at" DESC);

-- CreateIndex
CREATE INDEX "listening_events_user_id_created_at_idx" ON "listening_events"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "listening_events_user_id_track_id_played_at_key" ON "listening_events"("user_id", "track_id", "played_at");

-- CreateIndex
CREATE INDEX "user_track_stats_user_id_play_count_idx" ON "user_track_stats"("user_id", "play_count" DESC);

-- CreateIndex
CREATE INDEX "user_artist_stats_user_id_play_count_idx" ON "user_artist_stats"("user_id", "play_count" DESC);

-- CreateIndex
CREATE INDEX "user_time_bucket_stats_user_id_bucket_type_bucket_date_idx" ON "user_time_bucket_stats"("user_id", "bucket_type", "bucket_date" DESC);

-- AddForeignKey
ALTER TABLE "spotify_auth" ADD CONSTRAINT "spotify_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_album_id_fkey" FOREIGN KEY ("album_id") REFERENCES "albums"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_artists" ADD CONSTRAINT "track_artists_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_artists" ADD CONSTRAINT "track_artists_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_events" ADD CONSTRAINT "listening_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listening_events" ADD CONSTRAINT "listening_events_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_track_stats" ADD CONSTRAINT "user_track_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_track_stats" ADD CONSTRAINT "user_track_stats_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_artist_stats" ADD CONSTRAINT "user_artist_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_artist_stats" ADD CONSTRAINT "user_artist_stats_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_time_bucket_stats" ADD CONSTRAINT "user_time_bucket_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_hour_stats" ADD CONSTRAINT "user_hour_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
