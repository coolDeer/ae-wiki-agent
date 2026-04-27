import { hybridSearch } from "../src/core/search/hybrid.ts";
import { tokenizeForIndex, tokenizeForQuery } from "../src/core/tokenize.ts";
import { sql } from "../src/core/db.ts";

console.log("=== tokenizer probe ===");
console.log("  index 'NOW FY27 EPS 估值 11x EV/EBITDA':");
console.log("   ", tokenizeForIndex("NOW FY27 EPS 估值 11x EV/EBITDA"));
console.log("  query '存储超级周期':");
console.log("   ", tokenizeForQuery("存储超级周期"));
console.log("  query '半导体产能':");
console.log("   ", tokenizeForQuery("半导体产能"));

async function show(label, query) {
  console.log(`\n=== ${label} — q="${query}" ===`);
  const hits = await hybridSearch(query, { keywordOnly: true, limit: 5 });
  if (hits.length === 0) { console.log("  (no hits)"); return; }
  hits.forEach((h, i) => {
    console.log(`  ${i + 1}. [${h.score.toFixed(4)}] ${h.slug.padEnd(50)} kw=${h.keywordRank ?? "-"} | ${h.title?.slice(0, 50) ?? ""}`);
  });
}

// 中文短词
await show("中文：估值", "估值");
await show("中文：毛利率", "毛利率");
await show("中文：生物燃料", "生物燃料");
await show("中文短：储能", "储能");

// 中英混合
await show("混合：QSAI 估值", "QSAI 估值");
await show("混合：biofuel 合资", "biofuel 合资");

// 纯英文（应该和之前一样工作）
await show("英文：Euglena", "Euglena");
await show("英文：Petronas Malaysia", "Petronas Malaysia");

await sql.end();
