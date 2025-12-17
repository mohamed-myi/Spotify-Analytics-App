-- CreateTable
CREATE TABLE "import_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_events" INTEGER NOT NULL DEFAULT 0,
    "processed_events" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_settings" (
    "user_id" TEXT NOT NULL,
    "is_public_profile" BOOLEAN NOT NULL DEFAULT false,
    "share_top_tracks" BOOLEAN NOT NULL DEFAULT true,
    "share_top_artists" BOOLEAN NOT NULL DEFAULT true,
    "share_listening_time" BOOLEAN NOT NULL DEFAULT true,
    "email_notifications" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "metadata_refresh_log" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "last_refreshed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_refresh_at" TIMESTAMP(3),
    "error_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "metadata_refresh_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_jobs_user_id_created_at_idx" ON "import_jobs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "metadata_refresh_log_next_refresh_at_idx" ON "metadata_refresh_log"("next_refresh_at");

-- CreateIndex
CREATE UNIQUE INDEX "metadata_refresh_log_entity_type_entity_id_key" ON "metadata_refresh_log"("entity_type", "entity_id");

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
