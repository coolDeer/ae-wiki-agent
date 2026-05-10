---
tags: [china-ai-compute, ai-accelerators, asic, gpgpu, inference]
view_side: neutral
time_horizon: medium_term
primary_entities:
  - industries/China-AI-Accelerators
  - companies/huawei
  - companies/cambricon
  - companies/haiguang
  - companies/muxi
  - companies/biren-technology
research_id: 69fd63ef53e932396ea3dff9
research_type: acecamp_article
markdown_url: https://aecapllc.s3.ap-southeast-1.amazonaws.com/research-reports/parsed/69fd63ef53e932396ea3dff9/69fd63ef53e932396ea3dff9_20260508121759.md
---

## Source Overview
This source is an expert Q&A on the domestic China AI accelerator market, focused on the competitive split between [[concepts/asic|ASIC]] and GPGPU architectures, the relative positions of [[companies/huawei|Huawei Ascend]], [[companies/cambricon|Cambricon]], [[companies/haiguang|Haiguang]], [[companies/muxi|Muxi]], [[companies/biren-technology|Biren]], [[companies/moore-threads|Moore Threads]], [[companies/iluvatar-corex|Iluvatar CoreX]], [[companies/kunlunxin|Kunlunxin]], and Alibaba's Pingtouge. It matters because the source gives concrete share, pricing, performance, and customer-adoption evidence for which China AI chip vendors may actually capture inference demand in 2026, rather than merely announcing benchmark compute.

## Entities Covered
- Companies: [[companies/huawei|Huawei]], [[companies/cambricon|Cambricon]], [[companies/haiguang|Haiguang]], [[companies/muxi|Muxi]], [[companies/biren-technology|Biren Technology]], [[companies/moore-threads|Moore Threads]], [[companies/iluvatar-corex|Iluvatar CoreX]], [[companies/kunlunxin|Kunlunxin]], [[companies/alibaba|Alibaba]], [[companies/tencent|Tencent]], [[companies/baidu|Baidu]], [[companies/bytedance|ByteDance]].
- Industries: [[industries/China-AI-Accelerators|China AI accelerators]], [[industries/AI-Infrastructure|AI infrastructure]], [[industries/Semiconductors|Semiconductors]].
- Concepts: [[concepts/asic|ASIC]], [[concepts/GPGPU|GPGPU]], [[concepts/CUDA|CUDA]], [[concepts/HBM3E|HBM3E]], [[concepts/AI-Inference|AI inference]], [[concepts/AI-Training|AI training]].
- Related thesis: None verified during this ingest test; potential future thesis work should be opened explicitly through `thesis:open`.

## Factual Claims And Data
| Entity | Metric / Claim | Period | Value | Unit | Source Quote | Why It Matters |
| --- | --- | --- | --- | --- | --- | --- |
| [[companies/huawei|Huawei]] + [[companies/cambricon|Cambricon]] | Combined domestic large AI accelerator market share | 2026E | >60 | pct | "合计占据约60%以上" | Confirms that the market is currently concentrated in two first-tier vendors. |
| [[companies/cambricon|Cambricon]] | Domestic market share | 2025A | <10 | pct | "去年不足10%" | Establishes the low base before 2026 share expansion. |
| [[companies/cambricon|Cambricon]] | Domestic market share | 2026E | ~20 | pct | "接近20%" | Supports Cambricon as the most visible share gainer among local vendors. |
| [[companies/huawei|Huawei Ascend 910B]] | Advertised compute | current | 376 | TFLOPS | "标称算力高达376T" | Shows why headline specs were insufficient versus actual usable performance. |
| [[companies/huawei|Huawei Ascend 910B]] | Price range | current | 100000-130000 | cny/card | "售价在10万至13万元之间" | Provides a reference price band for domestic accelerator cost comparison. |
| [[companies/iluvatar-corex|Iluvatar CoreX]] | ByteDance Tiangai 150 order volume | 2026E | 100000+ | cards | "十几万张天垓150" | Indicates that weaker products can still win volume through supply / project factors. |
| [[companies/iluvatar-corex|Iluvatar CoreX]] | Tiangai 150 card price | 2026E | 20000 | cny/card | "单价约为2万元" | Shows price tier below Huawei / Cambricon-class cards. |
| [[companies/muxi|Muxi]] | 500-series card price | current | 50000 | cny/card | "500系列芯片售价约为5万元/张" | Gives Muxi's current commercial price point. |
| [[companies/muxi|Muxi]] | 600-series card price | current | 70000 | cny/card | "600系列约为7万元/张" | Frames C600 as a higher-priced HBM3E differentiated product. |
| [[companies/muxi|Muxi C600]] | Approximate compute | 2026E | 300+ | TFLOPS | "算力约为300多TFLOPS" | Helps compare C600 against domestic second-tier alternatives. |

## Core Views
- View: Domestic AI accelerator competition is not mainly about theoretical TOPS; actual customer acceptance is determined by usable throughput, stability, deployment support, and supply assurance.
  Evidence: The source says customers benchmark practical inference output, using metrics such as tokens/s in simplified internal production-like scenarios, rather than trusting vendor-reported peak compute.
  Affected entities: [[companies/huawei|Huawei]], [[companies/cambricon|Cambricon]], [[companies/muxi|Muxi]], [[companies/biren-technology|Biren]], [[companies/moore-threads|Moore Threads]], [[companies/iluvatar-corex|Iluvatar CoreX]].
  Confidence: high

- View: [[companies/huawei|Huawei]] has repaired part of the 910B credibility problem through the 950-series strategy, especially inference-specific 950PR design, better pricing, open software interfaces, and a strategic pivot from competing with internet platforms toward selling compute.
  Evidence: The source attributes Huawei 950 adoption at ByteDance, Tencent, and Alibaba to die-size optimization, training/inference product segmentation, LPDDR5-based lower-cost inference SKUs, and improved customer support posture.
  Affected entities: [[companies/huawei|Huawei]], [[companies/bytedance|ByteDance]], [[companies/tencent|Tencent]], [[companies/alibaba|Alibaba]].
  Confidence: medium

- View: [[companies/cambricon|Cambricon]] remains the strongest non-Huawei domestic ASIC contender because its Siyuan 590 and planned 690 reportedly outperform same-generation Huawei cards at the single-card design level, while customer traction at ByteDance and Tencent is increasing.
  Evidence: The source states Cambricon's 2026 share may approach 20% from less than 10% in 2025, driven by product maturity and large-customer deployment.
  Affected entities: [[companies/cambricon|Cambricon]], [[companies/bytedance|ByteDance]], [[companies/tencent|Tencent]].
  Confidence: medium

- View: In the second tier, [[companies/muxi|Muxi]] screens best among Shanghai GPGPU vendors, while [[companies/biren-technology|Biren]] has hardware potential but is held back by software and domestic advanced-process yield risk.
  Evidence: Muxi is described as having the strongest R&D lineage and product progress among Muxi / Moore Threads / Iluvatar, while Biren's BR200 is framed as promising but constrained by Huahong N+2 yield and weak software ecosystem.
  Affected entities: [[companies/muxi|Muxi]], [[companies/biren-technology|Biren]], [[companies/moore-threads|Moore Threads]], [[companies/iluvatar-corex|Iluvatar CoreX]].
  Confidence: medium

## Investment Mechanism
The investment mechanism is a shift from "who can announce domestic replacement" to "who can deliver stable inference throughput at acceptable cost under constrained supply." If domestic internet platforms are primarily using local accelerators for inference rather than frontier LLM training, then vendors with practical deployment support, inference-specific SKUs, and guaranteed capacity should capture near-term orders first. This benefits [[companies/huawei|Huawei]] and [[companies/cambricon|Cambricon]] as first-tier suppliers, with [[companies/muxi|Muxi]] as the most credible second-tier GPGPU candidate. It is less supportive of vendors that rely on government smart-compute-center projects without mainstream internet customer validation, because project orders may not translate into durable commercial share.

The source also reframes software ecosystem risk. CUDA compatibility helps migration, but the expert argues it is not decisive once customers invest engineering resources and scripts into deployment. That means the market may tolerate non-CUDA ASIC stacks if the final inference result is strong enough, especially for large customers with in-house engineering teams. For investment work, this weakens a simple "CUDA compatibility wins" thesis and raises the importance of customer-specific benchmark evidence, tokens/s, cluster stability, and post-sale support.

## Expectation Gap
- Consensus / prior view: Domestic AI chip competition is often discussed through peak compute, CUDA compatibility, government support, or broad import-substitution slogans.
- New evidence: The source emphasizes practical inference tokens/s, stability, supply assurance, customer support posture, and actual buyer validation. It also says domestic AI chips are still basically not used for large-model training by internet companies, with adoption concentrated in inference.
- Investment implication: The investable direction should focus less on nominal product announcements and more on evidence of production inference deployment at ByteDance, Tencent, Alibaba, Baidu, operators, and smart-compute-center projects. Cambricon share gains and Muxi C600 customer testing are higher-signal datapoints than generic GPGPU positioning.

## Investment Implications
| Direction | Entity | Setup | Catalyst | Risk / Invalidation |
| --- | --- | --- | --- | --- |
| monitor / long-bias | [[companies/cambricon|Cambricon]] | Strongest listed pure-play domestic AI accelerator exposure in the source, with potential share gain toward ~20% in 2026. | Confirmation of Siyuan 690 shipment ramp, ByteDance / Tencent repeat orders, and inference throughput benchmarks. | Huawei 950 family absorbs most inference demand; Cambricon cannot secure enough capacity or software stability. |
| monitor | [[companies/muxi|Muxi]] | Best-positioned second-tier GPGPU vendor in the source, supported by AMD-derived team and C500 / C600 roadmap. | Tencent C600 order conversion, C600 small-batch delivery in 2H26, and evidence that HBM3E form factor matters for inference. | C600 power draw or N+1 supply constraints limit scale; Alibaba and other customers continue to rely on internal chips. |
| avoid / high-risk monitor | [[companies/biren-technology|Biren]] | Hardware capability is credible, but software and Huahong N+2 yield are material bottlenecks. | BR200 validation improves and software stack catches up with customer requirements. | Low yield or weak software prevents mainstream customer orders. |
| monitor | [[companies/huawei|Huawei]] ecosystem | Huawei 950PR may be the strongest near-term domestic inference product, but Huawei is not directly listed in a simple equity form. | More internet-platform acceptance, open software interfaces, and stable supply of 950-series products. | Customer concerns return if Huawei re-enters competing cloud / model businesses or support quality deteriorates. |
| watchlist | [[companies/iluvatar-corex|Iluvatar CoreX]] / [[companies/moore-threads|Moore Threads]] | Project / government order-driven vendors may have volume but less mainstream internet validation. | Evidence of durable commercial orders outside local-government smart-compute projects. | Orders remain policy-driven and do not convert into sustainable product-market fit. |

## Relation To Existing Knowledge
### New Information
Compared with [[sources/acecamp_article-882af4-260430|the prior Ascend / Cambricon / CoWoS source]] and [[sources/acecamp_article-882af9-260430|the earlier domestic AI chip architecture source]], this source adds a clearer 2026 vendor hierarchy for China domestic AI accelerators: Huawei and Cambricon as the first tier with over 60% combined share, Muxi as the more credible GPGPU second-tier name, Biren as hardware-strong but software/yield-constrained, and Iluvatar / Moore Threads as more dependent on specific projects. It also adds explicit price and performance anchors for Huawei 910B, Muxi 500 / 600 series, and Iluvatar Tiangai 150.

### Confirms Existing View
The source confirms prior wiki coverage in [[sources/acecamp_article-882717-260430|the AI chip vendor shipment / T800 source]] that [[companies/cambricon|Cambricon]] and [[companies/haiguang|Haiguang]] are central in domestic AI chip discussions, but it sharpens the near-term application mix: domestic accelerators are primarily inference tools today, not mainstream large-model training tools for internet companies. It also confirms that customer validation from [[companies/bytedance|ByteDance]], [[companies/tencent|Tencent]], [[companies/alibaba|Alibaba]], and [[companies/baidu|Baidu]] is more important than paper specifications.

### Contradictions / Revisions
The source pushes back against any simple view that GPGPU architecture or CUDA-like software compatibility automatically wins. It says software migration ease is useful but not decisive, while final production performance and stable deployment matter more. It also revises the earlier negative read on [[companies/huawei|Huawei]] 910B by suggesting the 950-series strategy may have addressed some of the product and customer-support failures.

## Follow-up Research Tasks
- Task: Verify whether [[companies/cambricon|Cambricon]] 690 shipment ramp and 2026 share gain toward ~20% are reflected in channel checks or procurement data.
  Priority: high
  Needed source or data: ByteDance / Tencent order data, server vendor commentary, Cambricon capacity constraints.
- Task: Track whether [[companies/muxi|Muxi]] C600 converts Tencent testing interest into firm orders.
  Priority: high
  Needed source or data: Tencent procurement, Muxi shipment data, HBM3E availability, C600 power/performance feedback.
- Task: Separate government smart-compute-center demand from mainstream internet inference demand for second-tier vendors.
  Priority: medium
  Needed source or data: Customer-level order breakdown for Moore Threads, Iluvatar, Biren, Kunlunxin, and Haiguang.
- Task: Build a domestic AI accelerator comparison table covering architecture, process node, memory, price, tokens/s benchmark evidence, supply risk, and verified customers.
  Priority: medium
  Needed source or data: product specs, customer benchmarks, procurement announcements, and channel checks.

<!-- facts
- entity: companies/huawei
  metric: ascend_910b_advertised_compute
  period: current
  value: 376
  unit: tflops
  source_quote: "标称算力高达376T"
- entity: companies/huawei
  metric: ascend_910b_price_low
  period: current
  value: 100000
  unit: cny_per_card
  source_quote: "售价在10万至13万元之间"
- entity: companies/huawei
  metric: ascend_910b_price_high
  period: current
  value: 130000
  unit: cny_per_card
  source_quote: "售价在10万至13万元之间"
- entity: companies/cambricon
  metric: domestic_ai_accelerator_share
  period: 2025A
  value: "<10%"
  unit: pct
  source_quote: "去年（2025年）不足10%"
- entity: companies/cambricon
  metric: domestic_ai_accelerator_share
  period: 2026E
  value: "~20%"
  unit: pct
  source_quote: "接近20%"
- entity: industries/China-AI-Accelerators
  metric: first_tier_combined_share
  period: 2026E
  value: ">60%"
  unit: pct
  source_quote: "合计占据约60%以上"
- entity: companies/iluvatar-corex
  metric: tiangai_150_bytedance_order
  period: 2026E
  value: "100000+"
  unit: cards
  source_quote: "十几万张天垓150"
- entity: companies/iluvatar-corex
  metric: tiangai_150_price
  period: 2026E
  value: 20000
  unit: cny_per_card
  source_quote: "单价约为2万元"
- entity: companies/muxi
  metric: series_500_price
  period: current
  value: 50000
  unit: cny_per_card
  source_quote: "500系列芯片售价约为5万元/张"
- entity: companies/muxi
  metric: series_600_price
  period: current
  value: 70000
  unit: cny_per_card
  source_quote: "600系列约为7万元/张"
- entity: companies/muxi
  metric: c600_compute
  period: 2026E
  value: "300+"
  unit: tflops
  source_quote: "算力约为300多TFLOPS"
-->
