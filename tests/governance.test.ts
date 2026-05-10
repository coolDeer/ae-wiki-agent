import { describe, expect, test } from "bun:test";

function ensureTestEnv() {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/ae_wiki_test";
  process.env.MONGODB_URI ??= "mongodb://localhost:27017";
  process.env.MONGODB_DB ??= "ae_wiki_test";
  process.env.OPENAI_API_KEY ??= "test-key";
}

function sourceNarrative(extra = ""): string {
  const filler =
    "This section preserves concrete investment reasoning, linked evidence, and analyst judgement so downstream wiki pages can be updated without rereading the raw report.";
  return [
    "---",
    "research_id: test-rid",
    "research_type: test_type",
    "markdown_url: https://example.com/report.md",
    "tags: [semiconductor]",
    "view_side: neutral",
    "time_horizon: medium_term",
    "primary_entities:",
    "  - companies/Micron",
    "  - industries/Memory",
    "---",
    "",
    "## Source Overview",
    `${filler} ${filler}`,
    "",
    "## Entities Covered",
    `Companies include [[companies/Micron|Micron]] and [[companies/Samsung Electronics|Samsung Electronics]]. ${filler}`,
    "",
    "## Factual Claims And Data",
    `The source is qualitative in this fixture and has no explicit numeric facts. ${filler}`,
    "",
    "## Core Views",
    `View: supply discipline supports memory pricing. Evidence: channel checks. Implication: margins can improve. ${filler}`,
    "",
    "## Investment Mechanism",
    `Tighter supply moves through pricing, revenue, gross margin, and valuation. ${filler} ${filler}`,
    "",
    "## Expectation Gap",
    `Consensus expects normalization, while the source suggests earlier pricing support. ${filler}`,
    "",
    "## Investment Implications",
    `Monitor long beneficiaries and short laggards as catalysts appear. ${filler}`,
    "",
    "## Relation To Existing Knowledge",
    "### New Information",
    `Adds a new channel-check read on memory pricing. ${filler}`,
    "### Confirms Existing View",
    `Confirms the wiki view that supply discipline matters. ${filler}`,
    "### Contradictions / Revisions",
    `No major contradiction in this fixture. ${filler}`,
    "",
    "## Follow-up Research Tasks",
    `Pull next quarter pricing data and compare against company guidance. ${filler}`,
    extra,
  ].join("\n");
}

function mergePage(overrides: Partial<import("../src/skills/merge-candidates/index.ts").MergeCandidatePageMeta> = {}) {
  return {
    id: "1",
    sourceId: "default",
    slug: "companies/Micron",
    type: "company",
    title: "Micron Technology",
    confidence: "medium",
    completenessScore: 0.5,
    backlinks: 1,
    aliases: ["MU"],
    content: "## Company Overview\nMicron sells memory chips into AI servers.",
    contentChars: 55,
    updateBlocks: 0,
    sectionCount: 1,
    createTime: "2026-01-01T00:00:00.000Z",
    updateTime: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function pageRow(overrides: Partial<import("../src/skills/page-merge/index.ts").PageRow> = {}) {
  return {
    id: 1n,
    sourceId: "default",
    slug: "companies/Micron",
    type: "company",
    title: "Micron",
    displayName: null,
    aliases: ["MU"],
    frontmatter: {},
    content: "## Company Overview\nMicron sells memory chips.",
    confidence: "medium",
    deleted: 0,
    ...overrides,
  };
}

function entityRow(overrides: Partial<import("../src/skills/entity-refresh/index.ts").EntityRow> = {}) {
  return {
    pageId: "1",
    slug: "companies/Micron",
    type: "company" as const,
    title: "Micron",
    confidence: "medium",
    completenessScore: 0.7,
    updatedAt: "2026-05-01T00:00:00.000Z",
    latestEvidenceAt: "2026-05-09T00:00:00.000Z",
    daysBehind: 8,
    newSources: 1,
    newFacts: 0,
    newTimelineEntries: 0,
    newSignals: 0,
    ...overrides,
  };
}

describe("page review gate", () => {
  test("source template can pass without timeline and only warns on missing facts block", async () => {
    ensureTestEnv();
    const { buildReviewReport } = await import("../src/skills/review/index.ts");

    const report = buildReviewReport(
      {
        id: 1n,
        slug: "sources/test",
        type: "source",
        title: "Test Source",
        contentHash: null,
        frontmatter: {},
      },
      sourceNarrative()
    );

    expect(report.status).toBe("pass");
    expect(report.issues.some((issue) => issue.code === "missing_facts_block")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "relation_missing_specific_links")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "missing_timeline_marker")).toBe(false);
    expect(report.issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  test("warns when timeline uses placeholder dates for forecast periods", async () => {
    ensureTestEnv();
    const { buildReviewReport } = await import("../src/skills/review/index.ts");

    const report = buildReviewReport(
      {
        id: 1n,
        slug: "sources/test",
        type: "source",
        title: "Test Source",
        contentHash: null,
        frontmatter: {},
      },
      `${sourceNarrative()}\n\n<!-- timeline -->\n\n- entity: companies/Micron\n  date: 2026-07-01\n  event_type: product_launch\n  summary: Muxi C600 was expected to start small-batch supply in 2H26 according to the source.`
    );

    expect(report.issues.some((issue) => issue.code === "approximate_timeline_date")).toBe(true);
  });

  test("warns when relation section has only one concrete link", async () => {
    ensureTestEnv();
    const { buildReviewReport } = await import("../src/skills/review/index.ts");

    const narrative = sourceNarrative().replace(
      "Adds a new channel-check read on memory pricing.",
      "Adds a new channel-check read versus [[sources/prior-memory-note]]."
    );
    const report = buildReviewReport(
      {
        id: 1n,
        slug: "sources/test",
        type: "source",
        title: "Test Source",
        contentHash: null,
        frontmatter: {},
      },
      narrative
    );

    expect(report.issues.some((issue) => issue.code === "relation_too_few_specific_links")).toBe(true);
  });

  test("warns when relation section links only concepts", async () => {
    ensureTestEnv();
    const { buildReviewReport } = await import("../src/skills/review/index.ts");

    const narrative = sourceNarrative()
      .replace(
        "Adds a new channel-check read on memory pricing.",
        "Adds a new read on [[concepts/Memory Pricing]] and [[concepts/Supply Discipline]]."
      )
      .replace(
        "Confirms the wiki view that supply discipline matters.",
        "Confirms [[concepts/Supply Discipline]] remains important."
      );
    const report = buildReviewReport(
      {
        id: 1n,
        slug: "sources/test",
        type: "source",
        title: "Test Source",
        contentHash: null,
        frontmatter: {},
      },
      narrative
    );

    expect(report.issues.some((issue) => issue.code === "relation_missing_comparable_page_links")).toBe(true);
  });

  test("old source headings fail the new investment compiler profile", async () => {
    ensureTestEnv();
    const { buildReviewReport } = await import("../src/skills/review/index.ts");

    const report = buildReviewReport(
      {
        id: 1n,
        slug: "sources/old",
        type: "source",
        title: "Old Source",
        contentHash: null,
        frontmatter: {
          research_id: "rid",
          research_type: "type",
          markdown_url: "https://example.com/report.md",
        },
      },
      [
        "## Source Overview",
        "This is long enough ".repeat(80),
        "## Key Takeaways",
        "Old template content ".repeat(80),
        "## Important Data Points",
        "Old template content ".repeat(80),
      ].join("\n")
    );

    expect(report.status).toBe("fail");
    expect(report.issues.some((issue) => issue.message.includes("Entities Covered"))).toBe(true);
  });
});

describe("stage 4 alias labels", () => {
  test("accepts safe Chinese company display labels as aliases", async () => {
    ensureTestEnv();
    const { candidateAliasFromLinkLabel } = await import("../src/skills/ingest/stage-4-links.ts");

    expect(candidateAliasFromLinkLabel("沐曦")).toBe("沐曦");
    expect(candidateAliasFromLinkLabel("tracks: 沐曦")).toBe("沐曦");
  });

  test("rejects competitor lists as aliases", async () => {
    ensureTestEnv();
    const { candidateAliasFromLinkLabel } = await import("../src/skills/ingest/stage-4-links.ts");

    expect(candidateAliasFromLinkLabel("中际旭创/新易盛")).toBeNull();
    expect(candidateAliasFromLinkLabel("隆基、晶澳、天合")).toBeNull();
    expect(candidateAliasFromLinkLabel("Muxi")).toBeNull();
  });
});

describe("ingest slug naming", () => {
  test("source slug uses research type plus full research id without date", async () => {
    ensureTestEnv();
    const { buildRawFilePageSlug } = await import("../src/skills/ingest/stage-1-skeleton.ts");

    expect(
      buildRawFilePageSlug({
        slugDir: "sources",
        researchType: "acecamp_article",
        researchId: "69fd63ef53e932396ea3dff9",
        rawFileId: 123n,
      })
    ).toBe("sources/acecamp_article-69fd63ef53e932396ea3dff9");
  });

  test("slug naming sanitizes unsafe separators but preserves stable id", async () => {
    ensureTestEnv();
    const { buildRawFilePageSlug } = await import("../src/skills/ingest/stage-1-skeleton.ts");

    expect(
      buildRawFilePageSlug({
        slugDir: "briefs",
        researchType: "chat brilliant",
        researchId: "rid/with:bad#chars",
        rawFileId: 456n,
      })
    ).toBe("briefs/chat-brilliant-rid-with-bad-chars");
  });
});

describe("stage 5 fact values", () => {
  test("evidence context expands source quote with surrounding narrative", async () => {
    ensureTestEnv();
    const { buildEvidenceContext } = await import("../src/skills/ingest/stage-5-facts.ts");

    const context = buildEvidenceContext(
      "Cambricon was below last year. 去年（2025年）不足10%，但今年可能接近20%，主要受益于大客户部署。",
      "去年（2025年）不足10%",
      18
    );

    expect(context).toContain("去年（2025年）不足10%");
    expect(context).toContain("今年可能接近20%");
  });

  test("evidence context ignores generated facts block and can match parenthetical variants", async () => {
    ensureTestEnv();
    const { buildEvidenceContext } = await import("../src/skills/ingest/stage-5-facts.ts");

    const content = [
      "| Entity | Metric | Value |",
      "| Cambricon | Domestic share | 去年不足10%，今年接近20% |",
      "",
      "<!-- facts",
      '- entity: companies/cambricon',
      "  metric: domestic_ai_accelerator_share",
      "  source_quote: \"去年（2025年）不足10%\"",
      "-->",
    ].join("\n");

    const context = buildEvidenceContext(content, "去年（2025年）不足10%", 24);

    expect(context).toContain("Domestic share");
    expect(context).toContain("今年接近20%");
    expect(context).not.toContain("source_quote");
  });

  test("qualified numeric strings are preserved as text", async () => {
    ensureTestEnv();
    const { parseFactValue } = await import("../src/skills/ingest/stage-5-facts.ts");

    expect(parseFactValue("300+", "c600_compute", "tflops")).toEqual({
      valueNumeric: null,
      valueText: "300+",
    });
    expect(parseFactValue(">60%", "share", "pct")).toEqual({
      valueNumeric: null,
      valueText: ">60%",
    });
    expect(parseFactValue("100000-130000", "price_range", "cny_per_card")).toEqual({
      valueNumeric: null,
      valueText: "100000-130000",
    });
  });

  test("plain numeric strings still land as numeric and pct normalizes", async () => {
    ensureTestEnv();
    const { parseFactValue } = await import("../src/skills/ingest/stage-5-facts.ts");

    expect(parseFactValue("50,000", "series_500_price", "cny_per_card")).toEqual({
      valueNumeric: "50000",
      valueText: null,
    });
    expect(parseFactValue(20, "gross_margin", "pct")).toEqual({
      valueNumeric: "0.2",
      valueText: null,
    });
  });
});

describe("stage 5 tier C validation", () => {
  test("extracts allowed wikilink slugs for Tier C entity whitelist", async () => {
    ensureTestEnv();
    const { extractWikilinkSlugs } = await import("../src/skills/ingest/stage-5-tier-c.ts");

    expect(
      extractWikilinkSlugs(
        "Compare [[companies/cambricon|Cambricon]], [[companies/huawei]], and [[theses/not-allowed]]."
      )
    ).toEqual(["companies/cambricon", "companies/huawei"]);
  });

  test("validates source_quote by normalized exact substring", async () => {
    ensureTestEnv();
    const { validateSourceQuote } = await import("../src/skills/ingest/stage-5-tier-c.ts");

    expect(validateSourceQuote("market share may approach 20%", "Cambricon market   share may approach 20% in 2026.")).toBe(true);
    expect(validateSourceQuote("invented 50% share", "Cambricon market share may approach 20% in 2026.")).toBe(false);
  });

  test("accepts numeric and qualified numeric values only", async () => {
    ensureTestEnv();
    const { isStructuredFactValue } = await import("../src/skills/ingest/stage-5-tier-c.ts");

    expect(isStructuredFactValue(123)).toBe(true);
    expect(isStructuredFactValue("50,000")).toBe(true);
    expect(isStructuredFactValue(">60%")).toBe(true);
    expect(isStructuredFactValue("<10%")).toBe(true);
    expect(isStructuredFactValue("~20%")).toBe(true);
    expect(isStructuredFactValue("300+")).toBe(true);
    expect(isStructuredFactValue("10-13")).toBe(true);
    expect(isStructuredFactValue("dominant market share")).toBe(false);
  });

  test("filters hallucinated entities, duplicate tuples, non-facts, and bad quotes", async () => {
    ensureTestEnv();
    const { validateTierCFacts } = await import("../src/skills/ingest/stage-5-tier-c.ts");
    const content = "Cambricon share may approach 20%. Huawei price is 100000.";
    const result = validateTierCFacts(
      [
        {
          entity: "companies/cambricon",
          metric: "market_share",
          period: "2026E",
          value: "~20%",
          unit: "pct",
          source_quote: "share may approach 20%",
        },
        {
          entity: "companies/not-linked",
          metric: "market_share",
          period: "2026E",
          value: "10",
          unit: "pct",
          source_quote: "share may approach 20%",
        },
        {
          entity: "companies/huawei",
          metric: "quote",
          value: "dominant",
          source_quote: "Huawei price is 100000",
        },
        {
          entity: "companies/huawei",
          metric: "price",
          value: 100000,
          source_quote: "invented quote",
        },
        {
          entity: "companies/huawei",
          metric: "price",
          period: "current",
          value: 100000,
          source_quote: "Huawei price is 100000",
        },
      ],
      {
        content,
        allowedEntities: ["companies/cambricon", "companies/huawei"],
        alreadyExtracted: new Set(["companies/huawei|price|current"]),
      }
    );

    expect(result.kept).toEqual([
      {
        entity: "companies/cambricon",
        metric: "market_share",
        period: "2026E",
        value: "~20%",
        unit: "pct",
        source_quote: "share may approach 20%",
        confidence: 0.7,
      },
    ]);
    expect(result.stats).toEqual({
      droppedSchema: 1,
      droppedEntity: 1,
      droppedHallucinated: 1,
      droppedDup: 1,
    });
  });
});

describe("merge candidates", () => {
  test("canonical choice prefers confidence, backlinks, completeness, then aliases", async () => {
    ensureTestEnv();
    const { chooseCanonical } = await import("../src/skills/merge-candidates/index.ts");
    const weak = mergePage({ id: "1", confidence: "low", backlinks: 1, completenessScore: 0.4 });
    const strong = mergePage({ id: "2", confidence: "high", backlinks: 0, completenessScore: 0.1 });

    expect(chooseCanonical(weak, strong)[0].id).toBe("2");
  });

  test("long duplicate narrative is routed to human review", async () => {
    ensureTestEnv();
    const { classifyNarrativeRisk } = await import("../src/skills/merge-candidates/index.ts");
    const canonical = mergePage({ contentChars: 1000, content: "a ".repeat(500) });
    const duplicate = mergePage({
      id: "2",
      contentChars: 9000,
      sectionCount: 10,
      content: "unique standalone content ".repeat(500),
    });

    const risk = classifyNarrativeRisk(canonical, duplicate, 0.1);

    expect(risk.mergeMode).toBe("human_review");
    expect(risk.narrativeRisk).toBe("high");
  });

  test("alias and narrative overlap helpers detect duplicate evidence", async () => {
    ensureTestEnv();
    const { aliasOverlapScore, narrativeOverlapScore, isLikelyDuplicateByNames } =
      await import("../src/skills/merge-candidates/index.ts");
    const a = mergePage({ title: "Tencent Holdings", aliases: ["腾讯", "700.HK"] });
    const b = mergePage({ id: "2", title: "Tencent", aliases: ["腾讯"] });

    expect(aliasOverlapScore(a, b)).toBeGreaterThan(0);
    expect(narrativeOverlapScore(a, b)).toBeGreaterThan(0);
    expect(isLikelyDuplicateByNames(a, b, 0.3)).toBe(true);
  });
});

describe("page merge helpers", () => {
  test("merged aliases are case-insensitive and include titles and slug names", async () => {
    ensureTestEnv();
    const { buildMergedAliases } = await import("../src/skills/page-merge/index.ts");
    const canonical = pageRow({ aliases: ["MU", "Micron"] });
    const duplicate = pageRow({
      id: 2n,
      slug: "companies/Micron Technology",
      title: "Micron Technology",
      aliases: ["mu", "Micron Tech"],
    });

    expect(buildMergedAliases(canonical, duplicate)).toEqual([
      "MU",
      "Micron",
      "Micron Tech",
      "Micron Technology",
    ]);
  });

  test("narrative delta strips Updates and skips already-contained duplicate body", async () => {
    ensureTestEnv();
    const { buildNarrativeMergeDelta } = await import("../src/skills/page-merge/index.ts");
    const duplicate = pageRow({
      id: 2n,
      slug: "companies/Micron Technology",
      title: "Micron Technology",
      content: [
        "## Company Overview",
        "Micron sells memory chips.",
        "## Updates",
        "### 2026-05-09",
        "Do not merge this update block.",
      ].join("\n"),
    });

    expect(buildNarrativeMergeDelta(pageRow(), duplicate)).toBe("");
    const delta = buildNarrativeMergeDelta(pageRow({ content: "## Company Overview\nDifferent body." }), duplicate);
    expect(delta).toContain("Merged context from [[companies/Micron Technology|Micron Technology]]");
    expect(delta).not.toContain("Do not merge this update block");
  });
});

describe("output review", () => {
  test("daily review fixture passes structural checks with short/ref warnings only", async () => {
    const { reviewOutputContent } = await import("../src/skills/output-review/index.ts");
    const sections = [
      "Q1: Biggest Change In Understanding Today",
      "Q2: Most Contrarian Data Point / Expectation Gap",
      "Q3: Cross-Sector Connections",
      "Q4: Highest-Conviction Long",
      "Q5: Highest-Conviction Short / Reduce",
      "Q6: Knowledge Gaps And Next Ingest Priorities",
      "Q7: Red Team / Bias Check",
      "Sources",
    ];
    const content = [
      "---",
      "type: output",
      "subtype: daily-review",
      "title: Daily Review",
      "date: 2026-05-09",
      "sources: [sources/test]",
      "tags: [daily-review]",
      "last_updated: 2026-05-09",
      "---",
      "",
      ...sections.flatMap((section) => [`## ${section}`, `Body for ${section} with [[sources/test]] reference.`]),
    ].join("\n");

    const report = reviewOutputContent("daily-review-2026-05-09.md", content);

    expect(report.status).toBe("pass");
    expect(report.metrics.qRefCount).toBe(7);
    expect(report.issues.every((issue) => issue.severity === "warn")).toBe(true);
  });
});

describe("facts coverage", () => {
  test("table artifacts with zero facts are high risk", async () => {
    ensureTestEnv();
    const { analyzeFactsCoverageRow } = await import("../src/skills/facts/coverage.ts");
    const row = analyzeFactsCoverageRow({
      page_id: "1",
      slug: "sources/test",
      type: "source",
      title: "Test",
      content: "Revenue was 123 in FY2026.\n<!-- facts\n-->",
      facts_count: 0,
      table_count: 2,
    });

    expect(row?.coverageRisk).toBe("high");
    expect(row?.hasFactsBlock).toBe(true);
  });

  test("pages with enough landed facts are not backlog rows", async () => {
    ensureTestEnv();
    const { analyzeFactsCoverageRow } = await import("../src/skills/facts/coverage.ts");
    expect(
      analyzeFactsCoverageRow({
        page_id: "1",
        slug: "sources/test",
        type: "source",
        title: "Test",
        content: "Revenue was 123.",
        facts_count: 2,
        table_count: 0,
      })
    ).toBeNull();
  });
});

describe("enrich backlog", () => {
  test("low confidence with backlinks is enrich_now", async () => {
    ensureTestEnv();
    const { mapEnrichBacklogRow } = await import("../src/skills/enrich/backlog.ts");
    const row = mapEnrichBacklogRow({
      page_id: "1",
      slug: "companies/Stub",
      type: "company",
      title: "Stub",
      confidence: "low",
      completeness_score: "0.20",
      backlinks: 3,
      last_enrich_at: null,
      new_backlinks_since_enrich: 0,
      in_flight: false,
    });

    expect(row.recommendedAction).toBe("enrich_now");
    expect(row.priority).toBeGreaterThan(0);
  });

  test("new backlinks on incomplete page retrigger enrichment", async () => {
    ensureTestEnv();
    const { mapEnrichBacklogRow } = await import("../src/skills/enrich/backlog.ts");
    const row = mapEnrichBacklogRow({
      page_id: "2",
      slug: "companies/Known",
      type: "company",
      title: "Known",
      confidence: "medium",
      completeness_score: "0.45",
      backlinks: 3,
      last_enrich_at: "2026-05-01T00:00:00.000Z",
      new_backlinks_since_enrich: 2,
      in_flight: false,
    });

    expect(row.recommendedAction).toBe("retrigger");
  });
});

describe("thesis backlog", () => {
  test("stale thesis with unresolved conditions is review_now", async () => {
    ensureTestEnv();
    const { mapThesisBacklogRow } = await import("../src/skills/thesis/backlog.ts");
    const row = mapThesisBacklogRow(
      {
        page_id: "1",
        slug: "theses/test",
        title: "Test Thesis",
        status: "active",
        conviction: "medium",
        target_slug: "companies/Micron",
        days_since_update: 30,
        unresolved_conditions: 2,
        recent_signals: 1,
      },
      21
    );

    expect(row.recommendedAction).toBe("review_now");
    expect(row.priority).toBe(17);
  });
});

describe("entity refresh", () => {
  test("source backlinks only become refresh evidence when they carry signal value", async () => {
    ensureTestEnv();
    const { isHighValueSourceEvidence } = await import("../src/skills/entity-refresh/index.ts");

    expect(isHighValueSourceEvidence({ linkType: "mention" })).toBe(false);
    expect(isHighValueSourceEvidence({ linkType: "confirms" })).toBe(true);
    expect(isHighValueSourceEvidence({ linkType: "mention", hasFacts: true })).toBe(true);
    expect(isHighValueSourceEvidence({ linkType: "mention", hasTimeline: true })).toBe(true);
    expect(isHighValueSourceEvidence({ linkType: "mention", hasSignals: true })).toBe(true);
  });

  test("company update candidates infer impacted sections from new evidence", async () => {
    ensureTestEnv();
    const { inferSuggestedSections } = await import("../src/skills/entity-refresh/index.ts");

    expect(inferSuggestedSections("company", entityRow({ newFacts: 1, newSignals: 1 }))).toEqual([
      "Sources",
      "Financial Summary",
      "Risk Factors",
      "Catalysts",
    ]);
  });

  test("refresh append block includes new facts and source provenance", async () => {
    ensureTestEnv();
    const { buildRefreshAppendBlock } = await import("../src/skills/entity-refresh/index.ts");
    const block = buildRefreshAppendBlock(
      { slug: "companies/Micron", type: "company", title: "Micron" },
      {
        pageType: "company",
        sources: [
          {
            id: "10",
            slug: "sources/test",
            title: "Test Source",
            type: "source",
            create_time: "2026-05-09T00:00:00.000Z",
          },
        ],
        facts: [
          {
            metric: "revenue",
            period: "FY2027E",
            valueNumeric: "123",
            valueText: null,
            unit: "usd_m",
            ingestedAt: new Date("2026-05-09T00:00:00.000Z"),
            sourcePageId: 10n,
            source: { slug: "sources/test", title: "Test Source" },
          },
        ],
        timeline: [],
        signals: [],
      }
    );

    expect(block).toContain("Entity refresh for [[companies/Micron|Micron]]");
    expect(block).toContain("revenue (FY2027E): 123 usd_m via [[sources/test|Test Source]]");
  });
});

describe("alias conflicts formatter", () => {
  test("formats conflict rows and suggested actions", async () => {
    ensureTestEnv();
    const { formatAliasConflictReport } = await import("../src/skills/alias-conflicts/index.ts");
    const formatted = formatAliasConflictReport({
      generatedAt: "2026-05-09T00:00:00.000Z",
      filters: { type: null, limit: 10 },
      totalAliasesInConflict: 1,
      rows: [
        {
          alias: "腾讯",
          pageCount: 2,
          pages: [
            { pageId: "1", slug: "companies/Tencent", title: "Tencent", type: "company", confidence: "high" },
            { pageId: "2", slug: "companies/Tencent Holdings", title: "Tencent Holdings", type: "company", confidence: "low" },
          ],
        },
      ],
    });

    expect(formatted).toContain('"腾讯" → 2 pages');
    expect(formatted).toContain("Suggested actions:");
  });
});

describe("enrich display name gate", () => {
  test("requires enrich skill to provide canonical display name for entity pages", async () => {
    ensureTestEnv();
    const { normalizeDisplayName, requiresDisplayNameForEnrich } = await import(
      "../src/skills/enrich/index.ts"
    );

    expect(requiresDisplayNameForEnrich({ type: "company", displayName: null })).toBe(true);
    expect(requiresDisplayNameForEnrich({ type: "industry", displayName: "" })).toBe(true);
    expect(requiresDisplayNameForEnrich({ type: "concept", displayName: "ASIC" })).toBe(false);
    expect(requiresDisplayNameForEnrich({ type: "source", displayName: null })).toBe(false);
    expect(normalizeDisplayName("  Huawei   Technologies  ")).toBe("Huawei Technologies");
    expect(normalizeDisplayName("   ")).toBe("");
  });
});
