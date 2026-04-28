---
name: ae-thesis-track
description: 投资论点状态机维护——开仓 / 写 Bull-Bear / 更新 conviction / 标 catalyst 命中 / 关仓归档。ingest 与 worker 会产出相关 signal；agent 再据此执行 thesis review。core 不调 LLM，agent 当 PM 助手。
metadata:
  short-description: 维护 active thesis 的状态机
---

# ae-thesis-track

## 这个 skill 解决什么

投资 wiki 的核心独特价值就是**论点闭环**——把"我看好 NVDA FY27 EPS 上修"这种判断变成：
1. 结构化的 thesis（direction / conviction / 催化剂 / 验证条件）
2. 半自动跟踪：ingest / worker 先产出相关 signal，agent 再判断是否命中验证条件或出现反例
3. 周期性 review，按证据动态调整 conviction
4. 触发关仓：validated / invalidated / stop_loss

`$ae-thesis-track` 是这个闭环的入口。

**All newly written thesis narratives should be in English.** Chinese may remain in source titles, aliases, or direct quotes only when that is the clearest form.

## 何时调用

| 场景 | 推荐操作 |
|---|---|
| PM 路演 / 用户说"我看好 X / 看空 Y" | `$ae-thesis-track open` 帮他结构化 |
| 跑完 `$ae-research-ingest` 触及某 active thesis 的 target | 看有没有新 signal，触发 review |
| 用户问"我 NVDA 的论点最近怎么样" | `$ae-thesis-track show <id>` 出诊断 |
| 月度 review / 早会 | `$ae-thesis-track list --status active` 全清单 |
| 关仓决策 | `$ae-thesis-track close --reason validated/invalidated/stop_loss` |

## 命令清单

```bash
ae-wiki thesis:list [--status active|monitoring|closed|invalidated]
ae-wiki thesis:show <pageId>                       # 含 target 的 facts + signals
ae-wiki thesis:open --target <slug> --direction long --name "X"
                    [--conviction high|medium|low] [--owner X]
                    [--price-open X] [--date-opened YYYY-MM-DD]
ae-wiki thesis:write <pageId>                      # stdin narrative
ae-wiki thesis:update <pageId> [flags]
ae-wiki thesis:close <pageId> --reason X [flags]
```

---

## 完整工作流

### A. 开仓（PM 表达观点 → 结构化论点）

```
[user] 我看好 Euglena 的微藻油 algal oil 长期故事，2030 后能起来
[agent]
  1. 先确认 target 在 wiki 里：
     get_page("companies/Euglena") → 存在 ✓

  2. 帮 PM 结构化追问（PM 经常省略关键维度）：
     - direction：是 long / short / pair / neutral？
     - 时间周期：5 年 / 3 年 / 1 年？
     - conviction：high / medium / low？
     - 关键催化剂：哪些事件会推动？日期？
     - 验证条件：什么发生了证明你对？什么发生了证明错？
     - stop loss：跌到什么价位认输？

  3. bun src/cli.ts thesis:open \
       --target companies/Euglena \
       --direction long \
       --conviction medium \
       --name "Euglena 微藻油长期 LONG" \
       --owner "PM:levin" \
       --date-opened 2026-04-27
     → {pageId: 99, slug: "theses/euglena-wei-zao-you-chang-qi-long"}

  4. 按下列论点结构写 narrative（skill 自身即模板源，不依赖额外 templates 文件）：

     ## Core Thesis
     [[companies/Euglena|Euglena]] 当前估值反映 healthcare cash cow 视角，
     完全没定价 algal oil 的 optionality。如果 2028 Petronas JV 投产顺利，
     2030 后 algal oil 商业化突破，公司从"日本保健品 + 化肥"跃迁为
     "sustainable raw material supplier"，估值范式重置。

     ## Bull Case
     - Petronas JV 2028 Q1 投产，2030 满产，~30B JPY 收入 / 20% margin
     - algal oil 商业化突破时，公司有 stable cash cow 兜底，可以 patient capital
     - paramylon B2B 故事正在起量（[[companies/Alinamin_Pharma|Alinamin]] 已用）

     ## Bear Case
     - Q'SAI PE drag-along sale → P&L 砍半 + 短期股价压力
     - SAF 政策落地慢于预期 → 20% margin 假设 break
     - algal oil 5+ 年 horizon 太长，机会成本

     ## Key Assumptions
     1. Petronas JV 不延期超 6 个月
     2. SAF 价格 2030 前不跌破 ~$2/L
     3. paramylon 免疫宣称 2026 年内通过

     ## Validation / Falsification Conditions
     | 条件 | 状态 | 最新证据 |
     |---|---|---|
     | Petronas JV 2028 Q1 投产 | pending | (1x1 路演 2026-04-17) |
     | algal oil 中试装置 2027 跑通 | pending | - |
     | paramylon 免疫宣称获批 | pending | - |

     ## Catalyst Timeline
     - 2026-2027：免疫宣称申报进展
     - 2028 Q1：Petronas JV 投产
     - 2030：JV 满产 / algal oil 阶段性 milestone
     - 任何时点：Q'SAI drag-along sale（risk catalyst）

     ## Risk Management
     - stop loss：股价跌破 1000 yen 重新评估
     - re-evaluate：Q'SAI 真的卖了之后

     ## Thesis Evolution
     2026-04-27：开仓，medium conviction

     ## Sources
     - [[sources/meeting_minutes-20bfde-260427|260417 - Euglena CEO 1x1]]

  5. bun src/cli.ts thesis:write 99 < /tmp/narrative-99.md

  6. 把验证条件 + 催化剂日历也塞进数据库（结构化，便于后续自动检查）：
     bun src/cli.ts thesis:update 99 \
       --add-catalyst '{"date":"2028-01-01","event":"Petronas JV 投产","expected_impact":"validate biofuel revenue model"}' \
       --reason "open"

     bun src/cli.ts thesis:update 99 \
       --mark-condition "Petronas JV 2028 Q1 投产:pending" \
       --reason "open"
```

### B. ingest 新 source 后 review

每次跑完 `$ae-research-ingest`，agent 应该：

```
1. bun src/cli.ts thesis:list --status active
   → 拿 active thesis 清单

2. 如需连 monitoring 一起看，再单独跑：
   bun src/cli.ts thesis:list --status monitoring

3. 对每个 thesis：
   if 新 source 的 entities 包含 thesis.target：
     bun src/cli.ts thesis:show <pageId>
     → 看 target 的 recentFacts、最新 signals
     
     检查每个 validation_condition：有没有新证据？
       - 命中 → bun src/cli.ts thesis:update <pageId> \
                  --mark-condition "条件:met:signal_id" \
                  --reason "ingest #<rawFileId> 提供证据"
       - 反例 → mark unmet 或 invalidated
     
     检查 conviction 是否需要调整：
       - 多条件命中 → bump high
       - 多条件 unmet → drop low 或 status=monitoring
       - 关键条件 invalidated → close --reason invalidated

4. 如果有重大变化，告诉用户："论点 X 需要你 review"
```

### C. 主动 review（用户问 / 周期性）

```
[user] 我 Euglena 的论点最近怎么样
[agent]
  1. bun src/cli.ts thesis:show 99
     输出：thesis 字段 + target recentFacts + 关联 signals

  2. 综合评估：
     - 哪些 validation_conditions 状态有变化
     - 哪些催化剂临近（按 date 倒推）
     - 是否触发 stop_loss 风险
     - 最近 ingest 的 sources 有没有新论据 / 反例

  3. 给 PM 一个简短 brief：
     "Euglena LONG 论点（开仓 2026-04-27，medium conviction）：
        ✅ Petronas JV 进度按计划（最新 source: ... 2026-04-17）
        ⚠️ Q'SAI PE drag-along risk 仍未消除，需要继续监控
        ⏰ 下一个关键 milestone：2026 内 paramylon 免疫宣称申报
        建议：维持 medium conviction，下次 Q'SAI 更新前不 bump"

  4. 必要时建议下一步：thesis:update / thesis:close
```

### D. 关仓

```
[user] Euglena 论点关掉，Q'SAI 卖了我跟着卖
[agent]
  bun src/cli.ts thesis:close 99 \
    --reason invalidated \
    --price-close 850 \
    --note "Q'SAI drag-along sale 触发，论点核心假设 1（保留 Q'SAI 现金流）破产。
            退出价 850 vs 开仓 1100，亏损 ~23%。
            Lesson：股权结构不确定的标的，开仓前应给 Q'SAI risk 更高权重，
            原 medium conviction 应该是 low-medium。"
```

retrospective note 会被 append 到 page.content，方便未来读老 thesis 时一眼看到收尾。

---

## 数据结构（agent 要懂）

### catalysts JSONB 数组

```jsonc
[
  {
    "date": "2028-01-01",
    "event": "Petronas JV 投产",
    "expected_impact": "validate biofuel revenue model"
  },
  {
    "date": "2026-12-31",
    "event": "paramylon 免疫宣称申报",
    "expected_impact": "B2B story 加速"
  }
]
```

### validation_conditions JSONB 数组

```jsonc
[
  {
    "condition": "Petronas JV 2028 Q1 投产",
    "status": "pending",          // pending | met | unmet | invalidated
    "last_checked": "2026-04-27",
    "evidence_signal_id": "42"   // 可选：指向触发状态变化的 signal
  }
]
```

CLI 接受简化字符串：`--mark-condition "条件:status[:signal_id]"`，函数内部解析。

---

## 与其他 skill 的关系

```
fetch-reports
   ↓
research-ingest          ──→ 写 facts / signals
   ↓
   每次 ingest 完成     →  产出可供 thesis review 的 facts / signals
                       →  agent 用这个 skill 决定是否调 thesis:update mark-condition
                       
enrich                   ──→ 补全 target entity 后让论点更可读
                       
daily-review             ──→ 综合 7 问，可能引出新 thesis（→ thesis:open）
daily-summarize          ──→ PM 简报必读 active thesis 状态
```

## 不在本 skill 范围

- 价格自动追踪：当前 price_at_open / price_at_close 由 agent 手填，没接行情 API
- 自动 stop_loss 触发：当前需要 PM 手动 close
- consensus drift / earnings_surprise 检测：那是 worker `detect_signals` 干的，本 skill 是消费者

## 故障排查

| 症状 | 原因 | 解决 |
|---|---|---|
| `thesis:open` 报 target page 不存在 | target 还没 enrich 或 slug 拼错 | 先 `$ae-enrich` 或核对 slug |
| catalysts/conditions 看起来没更新 | JSONB 字段 update 是覆盖式 | 用 `--add-catalyst` / `--mark-condition` 而不是手改 JSON |
| `thesis:show` 输出 signals 列表为空 | 没有 ingest 触及 target，或 worker 还没跑 detect_signals | 跑一次 worker，或 ingest 一份新 source |

## Write 前自检

- target slug 是否确实存在且是你要跟踪的标的
- narrative 是否把 Bull / Bear / 验证条件 / 风险管理区分清楚
- `validation_conditions` 写的是可验证条件，不是模糊愿景
- `catalysts` 写的是事件，不是泛泛叙事
- conviction 调整是否有证据，不是情绪
- close note 是否真的写清了 thesis 为什么结束，以及复盘教训是什么
