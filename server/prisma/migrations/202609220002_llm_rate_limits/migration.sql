CREATE TABLE "llm_rate_buckets" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "bucket_kind" TEXT NOT NULL,
  "bucket_start" TIMESTAMP(3) NOT NULL,
  "request_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "llm_rate_buckets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "llm_rate_buckets_user_id_bucket_kind_bucket_start_key"
  ON "llm_rate_buckets"("user_id", "bucket_kind", "bucket_start");

CREATE INDEX "llm_rate_buckets_bucket_start_idx"
  ON "llm_rate_buckets"("bucket_start");

ALTER TABLE "llm_rate_buckets"
  ADD CONSTRAINT "llm_rate_buckets_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
