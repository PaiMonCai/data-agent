ALTER TABLE "users"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

CREATE INDEX "users_role_idx" ON "users"("role");

CREATE TABLE "system_settings" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);
