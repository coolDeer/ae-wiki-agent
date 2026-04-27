#!/usr/bin/env bun
/**
 * MongoDB 连通性测试
 *
 * 直接用 mongodb 驱动连，跳过我们的 env validator（避免还要填 OpenAI/Anthropic key）。
 * Bun 自动加载 .env。
 *
 * 用法：bun run scripts/test-mongo.ts
 */

import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? "aecapllc-prod";
const collName = process.env.MONGODB_COLLECTION ?? "ResearchReportRecord";

if (!uri) {
  console.error("✗ MONGODB_URI 未配置");
  process.exit(1);
}

console.log(`连接到: ${uri.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@")}`);
console.log(`DB: ${dbName} / Collection: ${collName}\n`);

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
});

try {
  await client.connect();
  console.log("✓ 连接成功");

  const db = client.db(dbName);

  // 1. ping
  const pong = await db.command({ ping: 1 });
  console.log(`✓ ping ok: ${pong.ok === 1 ? "OK" : "FAIL"}`);

  // 2. 直接查目标集合（应用层不需要 listCollections 权限）
  const coll = db.collection(collName);

  // 3. 数总文档（estimatedDocumentCount 只读，权限要求最低）
  const total = await coll.estimatedDocumentCount();
  console.log(`✓ ${collName} 估算文档数: ${total.toLocaleString()}`);

  // 4. 数 parseStatus='completed' 的（fetch-reports 实际处理的范围）
  const completed = await coll.countDocuments({
    parseStatus: "completed",
    parsedMarkdownS3: { $ne: null },
  });
  console.log(`✓ parseStatus='completed' 且 parsedMarkdownS3 非空: ${completed.toLocaleString()}`);

  // 5. 看一条最新的样本
  const latest = await coll
    .find({ parseStatus: "completed" })
    .sort({ createTime: -1 })
    .limit(1)
    .next();

  if (latest) {
    console.log(`\n最新一条:`);
    console.log(`  _id: ${latest._id}`);
    console.log(`  researchId: ${latest.researchId}`);
    console.log(`  researchType: ${latest.researchType}`);
    console.log(`  title: ${latest.title}`);
    console.log(`  createTime: ${latest.createTime}`);
    console.log(`  orgCode: ${latest.orgCode ?? "(none)"}`);
    console.log(`  tags: ${JSON.stringify(latest.tags ?? [])}`);
    console.log(`  parsedMarkdownS3: ${latest.parsedMarkdownS3 ? "✓ 有" : "✗ 无"}`);
  }

  console.log(`\n✅ 全部检查通过`);
} catch (e) {
  console.error(`\n✗ 测试失败:`);
  console.error(e);
  process.exit(1);
} finally {
  await client.close();
}
