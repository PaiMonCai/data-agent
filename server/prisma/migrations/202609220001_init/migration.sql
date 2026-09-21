CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
  "id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "otp_codes" (
  "id" TEXT NOT NULL,
  "verification_id" TEXT NOT NULL,
  "user_id" TEXT,
  "email" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "datasets" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "columns" JSONB NOT NULL,
  "row_count" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dataset_rows" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "dataset_id" TEXT NOT NULL,
  "row_index" INTEGER NOT NULL,
  "data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dataset_rows_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analyses" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "dataset_id" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "plan" JSONB,
  "result" JSONB NOT NULL,
  "summary" TEXT,
  "model" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
CREATE UNIQUE INDEX "otp_codes_verification_id_key" ON "otp_codes"("verification_id");
CREATE INDEX "otp_codes_email_purpose_created_at_idx" ON "otp_codes"("email", "purpose", "created_at");
CREATE INDEX "otp_codes_expires_at_idx" ON "otp_codes"("expires_at");
CREATE INDEX "datasets_user_id_created_at_idx" ON "datasets"("user_id", "created_at");
CREATE UNIQUE INDEX "dataset_rows_dataset_id_row_index_key" ON "dataset_rows"("dataset_id", "row_index");
CREATE INDEX "dataset_rows_user_id_dataset_id_row_index_idx" ON "dataset_rows"("user_id", "dataset_id", "row_index");
CREATE INDEX "analyses_user_id_dataset_id_created_at_idx" ON "analyses"("user_id", "dataset_id", "created_at");

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "otp_codes"
  ADD CONSTRAINT "otp_codes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "datasets"
  ADD CONSTRAINT "datasets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "dataset_rows"
  ADD CONSTRAINT "dataset_rows_dataset_id_fkey"
  FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "analyses"
  ADD CONSTRAINT "analyses_dataset_id_fkey"
  FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
