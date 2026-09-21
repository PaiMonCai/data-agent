import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // prisma generate does not connect, so CI can use this harmless fallback.
    url: process.env.DATABASE_URL ?? "postgresql://data_agent:dev@127.0.0.1:5432/data_agent",
  },
});
