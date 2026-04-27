import { defineConfig } from "drizzle-kit";
import "dotenv/config";

export default defineConfig({
  schema: "./src/core/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // 我们用 init-v2.sql 部署 schema，不用 drizzle-kit push
  // 这里仅用于 drizzle studio 浏览数据
  verbose: true,
  strict: true,
});
