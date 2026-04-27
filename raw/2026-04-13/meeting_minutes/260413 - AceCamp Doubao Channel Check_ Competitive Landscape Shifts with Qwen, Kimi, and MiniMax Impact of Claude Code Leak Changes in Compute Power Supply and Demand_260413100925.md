# 260413 - AceCamp Doubao Channel Check: Competitive Landscape Shifts with Qwen, Kimi, and MiniMax Impact of Claude Code Leak Changes in Compute Power Supply and Demand

# AI总结

## Domestic and International Large Model Competition
- **Three-tiered Structure of the Domestic Chinese Market**: The domestic market is categorized into three distinct types of players based on their resources, model capabilities, and business models.
  - **Big Companies (e.g., Alibaba's Qwen)**: Resource-rich with strong cloud platforms and business operations. Qwen holds a dominant position, particularly in the enterprise sector, with a market share estimated at around 1/3 for internal enterprise use.
  - **Vertical Model Companies (e.g., Kimi, Zhipu, MiniMax)**: Well-funded companies that are no longer startups. They are currently following a market rhythm similar to the US in 2023-2024, focusing on leveraging model capabilities to provide services. Their rapid development is significantly supported by technical contributions from the open-source model DeepSeek.
  - **Catch-up Big Companies (e.g., ByteDance, Tencent)**: Possess ample resources and business operations but have relatively weaker base models. ByteDance's base model has struggled to achieve a breakthrough despite continuous training, leading to significant team attrition (60-70 people).
- **Widening Capability Gap between China and the US**: The gap in core functionality between top US and Chinese models has grown significantly, while the gap in technical performance remains at about one generation.
  - **Core Functionality Gap**: Chinese models cannot replicate the distinct, advanced functionalities of the top three US players.
    - **Google (Gemini)**: Possesses an end-to-end multimodal base model, which no Chinese company has successfully replicated.
    - **OpenAI (GPT series)**: Features extremely strong agent capabilities, allowing direct building of custom user memory and integration of multimodal functions within its chatbot.
    - **Anthropic (Claude)**: Focuses on an "Agent-as-a-Service" model, providing advanced solutions for business, office, and programming scenarios (e.g., Code, Work, Skills).
  - **Technical Performance Gap ("Cultural Level")**: Chinese models are approximately 6 to 12 months (one generation) behind their US counterparts, roughly reaching the level of the Claude 3 series or GPT-4.
- **Diverging Future Focus**: Top US companies are advancing towards enhancing model usability through multimodal interaction and agent-based applications, while the Chinese market still primarily relies on text-based interaction.

## The Role and Impact of Model Distillation
- **Value and Low Risk of Distillation**: Distillation is and will remain a valuable practice for improving model capabilities due to the structural nature of large models and the low risk involved (at most, an API ban and minor financial loss).
- **Three Major Benefits of Distillation**: Distillation provides significant advantages across different scenarios for technically mature model companies.
  - **Training Efficiency**: It improves model quality while saving significant time and compute resources during pre-training and post-training stages. For example, Kimi's reduced reliance on rented GPUs from ByteDance in H2 2025 suggests a heavy use of distillation.
  - **Data Flywheel Supplement**: It helps level the playing field by providing access to valuable data from competitors who have established strong positive feedback loops. For instance, distilling Claude's coding data allows competitors to catch up on agent development insights.
  - **R&D and Architectural Insight**: It allows companies to analyze a competitor's data usage and underlying architecture, providing critical R&D insights without necessarily using the data for direct model training.
- **Adoption of Distillation by Chinese Companies**: The practice of distillation varies among major Chinese AI players.
  - **ByteDance**: Has strictly prohibited all distillation since the Spring Festival of 2025.
  - **Alibaba**: Engages in very little distillation.
  - **Tencent**: Actively distills, as indicated by frequent API violation flags from AWS and Google Cloud.
  - **Vertical Model Companies (Kimi, Zhipu)**: Confirmed to be using distillation.
- **Future Outlook on the Capability Gap**: The performance gap in model intelligence is expected to remain stable at around one generation. However, the cost of distillation is set to rise as companies like DeepSeek and OpenAI actively develop countermeasures.

## ByteDance's Large Model Strategy, Challenges, and Roadmap
- **Internal Challenges and Talent Rotation**: ByteDance is facing challenges with its base model and is experiencing an industry-wide talent rotation.
  - **Talent Attrition**: High-level personnel are leaving due to difficult cross-border collaboration schedules, while other staff are leaving due to internal equity issues (lack of secondary stock options).
  - **Strategic Hiring**: To address its weakness in base model development, ByteDance is actively hiring core personnel from competitors like Zhipu, Kimi, and Qwen.
- **Strategic Roadmap for 2024**: ByteDance has set two critical milestones for its base model development this year, with a contingency plan to shift R&D overseas if goals are not met.
  - **May-June Milestone (C 2.5)**: To release a new base model that matches Kimi 2.5's capabilities in long-context reasoning, speed, precision, and native multimodal architecture. This is intended to fix the architectural flaws of the current C 2.0 model.
  - **September-October Milestone ("Leapfrog")**: To launch a model with capabilities similar to Google's Gemini 1.5 in an attempt to surpass competitors.
- **Key Focus Areas**: ByteDance is prioritizing the development of native multimodality, agent capabilities, and coding to catch up with industry leaders.
  - **Native Multimodality and Agents**: Inspired by Kimi's architecturally sound model, the focus is on integrating native visual understanding (like image OCR) into the base model and developing the ability to automatically generate and run agent code.
  - **Coding**: A dedicated team was formed in Q2 with the high-priority goal of developing a coding model that scores at least 85 (on a scale where Claude is 90+) by the end of the quarter, correcting a past strategic error of focusing on applications over core model capability.
- **Challenges with Cost-Effectiveness and Innovation**: ByteDance faces difficulties in implementing advanced features like token value calculation and is not pursuing radical architectural innovations.
  - **Inference Cost (Token Value)**: While planning to promote cost-effectiveness, the implementation will likely be vague due to the complexity of its vast internal systems and the instability of its current model's performance and costs.
  - **Model Architecture**: The company is currently focused on micro-innovations on existing theories rather than developing new architectures like Kimi's Mew.

## Summary of the Domestic AI Competitive Landscape
- **Key Player Strengths and Strategies**: The domestic market is characterized by a few key players with distinct strengths and challenges.
  - **Alibaba (Qwen)**: The most comprehensively strong player, with overall performance consistently above an 85-point threshold.
  - **DeepSeek**: Possesses great technical depth, with its next-generation model having the potential to match OpenAI/Anthropic's performance at a very low inference cost.
  - **Kimi**: Strong foundation in text models, achieving good stability and generalization by leveraging DeepSeek's architecture. Its leadership is defined by a sound architecture integrating long-context, native multimodality, and agent generation capabilities.
  - **Zhipu**: Also references DeepSeek's modules and has a long-established strength in programming, cultivated through B2B projects since 2023. It is considered the domestic leader in coding.
  - **MiniMax**: Shows rapid progress at the base model level but is severely constrained by a lack of GPUs, which limits its ability to compete in its most profitable areas like text-to-video.
- **Dynamics of the Coding Market**: Zhipu is the domestic leader, but the market dynamics differ from the global landscape dominated by Anthropic's Claude.
  - **Zhipu's Position**: Its performance is close to the Claude 3.5 series level. Despite longer inference times, it is considered the most cost-effective option compared to Alibaba, which bundles other services.
  - **Misconceptions and Market Reality**: It's a misconception to directly map Anthropic's global success to China. The domestic B2B market is evolving from workflow to intelligent entities, which does not always require a standalone coding service. The recent growth in the coding market has come from a new segment of non-technical B2B companies, and the full size of this segment is still unknown.

## Future Trends in China's AI Market and Applications
- **B2B as the Primary Growth Driver**: The B2B market is experiencing rapid organic growth, with a clear evolutionary path from workflow automation to interactive intelligent entities and eventually to full-fledged agents.
  - **Market Segmentation**: Vertical model companies like Kimi and Zhipu are well-positioned to serve small and medium-sized enterprises (SMEs), while large corporations will continue to rely on major players like ByteDance and Alibaba.
  - **Opportunities for Vertical Players**: The mismatch between large companies having weak/expensive coding models and smaller companies having strong coding capabilities creates a significant market opportunity for vertical specialists.
- **C-end Market Dominated by ByteDance**: The C-end application landscape in China is largely considered settled, with ByteDance's Doubao poised for long-term dominance.
  - **Doubao's Competitive Edge**: Its success is built on catering to Chinese user habits with "pacifier" functions, massive resource investment, permanent user memory storage, and deep integration with ByteDance's ecosystem (Douyin, e-commerce, novels).
  - **Strategy and Competition**: Doubao's free-for-a-year strategy, followed by a move to a functional subscription model in 2025, makes it nearly impossible for vertical model companies to compete. Tencent is also considered to have a very slim chance of challenging this dominance.
- **Future Token Consumption Growth Areas**: The next wave of significant token consumption is expected to come from B2B applications in the second half of the year.
  - **H1 2024 Drivers**: Growth was primarily driven by programming and the adoption of intelligent entities.
  - **H2 2024 Expectations**:
    1.  **Expansion of Platform AI Services**: Comprehensive AI service suites integrated into platforms like Douyin for advertising, live stream monitoring, and content generation.
    2.  **Upgrade from Intelligent Entities to Agents**: As B2B users mature, they will add execution capabilities to their systems, leading to a massive increase in token consumption.

## Compute Power Shortage and Its Industry-Wide Impact
- **Severe and Widespread GPU Shortage**: There is an extreme shortage of high-end GPUs (NVIDIA H100, H800, A100) across the entire Chinese market, impacting all major players.
  - **ByteDance's Situation**: Actively buying back used H-series GPUs at 2-3x the price. The shortage affects its international business and forces it to charge massive prepayments for GPU-intensive services like the C-DANCE 2.0 video model.
  - **Tencent's Desperation**: Lacking H100/H800 GPUs, Tencent has been forced to purchase Hygon's 10,000-card cluster, a system largely ignored by other commercial companies, highlighting its critical shortage of training compute.
  - **Market-wide Deficit**: The C-end chatbot market alone is estimated to require 400,000 A100 GPUs, but fewer than 300,000 were imported into China. Vertical companies like Kimi and Zhipu are short thousands of H100s needed for coding, with no way to acquire them.
- **Outlook and Reliance on Domestic Chips**: By the end of 2024, all available NVIDIA GPUs in China are expected to be fully utilized, forcing a reliance on domestic alternatives which have significant limitations.
  - **Full Utilization**: H20 utilization will exceed 75% (effectively full), while A100/A800 will be at 100%. Future growth in 2025 will depend entirely on domestic cards.
  - **Domestic Chip Capabilities**:
    - **Ascend 910B**: Cannot handle video generation alone; its supercluster can only offload the prefill stage of inference. It is suitable for text inference but not training.
    - **Cambricon 690**: Can handle text inference for smaller models (~64B) and image generation, but is not powerful or cost-effective enough for competitive C-end applications. It cannot generate video.
    - **Conclusion**: For video generation, the industry must rely on the Ascend 384-node supercluster, which highlights the performance gap with NVIDIA hardware.

## Text-to-Video and Text-to-Image Competition
- **Text-to-Video: A Fast-Cycling, GPU-Intensive Race**: The text-to-video domain is characterized by short technology cycles and low technical ceilings for each stage, making sustained leadership difficult.
  - **Current Tech Cycle**: The current focus on storyboarding and multimodal reference will soon be commoditized with upcoming releases from Alibaba (Vientiane) and Google (VLOGGER).
  - **Next Tech Cycle (H2 2024)**: The competition will shift towards "one model for multiple scenes," such as generating both comics and short videos.
  - **Key Competitors**: The race will likely remain among Vientiane, Kling (Kuaishou), C-Dance (ByteDance), and Google's VLOGGER. MiniMax's Hailuo may also be a contender.
  - **Google's Hardware Advantage**: Google could use its superior GPU resources to launch a "dimensional strike" by supporting capabilities like 2-minute 4K video, which Chinese companies cannot match due to the compute shortage.
- **Text-to-Image: An Underinvested Market**: Despite having a potentially larger user base than text-to-video, the text-to-image market is not seeing heavy investment from most companies.
  - **ByteDance's Leadership**: ByteDance's C-Dream is a leader in the domestic text-to-image space, with a new version planned to include stronger photo editing and web search capabilities.

# QA总结

**Q: What is your perspective on the competition in large models, both domestically in China and internationally, and what is the outlook for divergence in their capabilities?**
A: The competition can be analyzed from several perspectives:
1.  **Domestic Chinese Market Structure:** The market is divided into three main categories:
    *   **Big Company Model (e.g., Alibaba's Qwen):** These are dominant players with strong resources, cloud platforms, and business operations. Qwen holds a significant market share, estimated at around 1/3 for enterprise use across all clouds.
    *   **Vertical Model Companies (e.g., Kimi, Zhipu, MiniMax):** These are well-funded companies following a development rhythm similar to the US market in 2023-2024, focusing on using model capabilities to provide services. Their rapid development is significantly aided by technical contributions from open-source models like DeepSeek. They are expected to see sustained growth.
    *   **Catch-up Big Companies (e.g., ByteDance, Tencent):** These companies have ample resources but possess relatively weaker base models. ByteDance has more GPUs but has faced stalled progress in base model training for three quarters and significant team turnover (60-70 people). Its C-DANCE 2.0 text-to-video model has a temporary advantage, but this is expected to diminish as the technology cycle iterates.
2.  **Comparison with Top US Models (Functionality):** The functional gap between Chinese models and the top three US models (Google, OpenAI, Anthropic) has widened significantly.
    *   **Google's Gemini:** Possesses a true end-to-end multimodal base model, which no company in China can currently replicate.
    *   **OpenAI's GPT-4.5:** Features extremely strong agent capabilities, integrating multimodal functions and custom user memory within ChatGPT, a capability absent in Chinese models.
    *   **Anthropic's Claude:** Focuses on an "Agent-as-a-Service" model, achieving breakthroughs in business, office, and programming scenarios that Chinese models have not matched.
3.  **Comparison with Top US Models (Intelligence/Performance):** In terms of the model's core intelligence or "cultural level," Chinese models are approximately one generation (6-12 months) behind, capable of reaching the performance levels of the Claude 3 series or GPT-4.
4.  **Future Focus:** The top US models are advancing towards enhanced usability, such as multimodal interaction and agent-based applications. This is a step ahead of the Chinese market, which still primarily relies on text-based interaction.

**Q: To what extent has distillation from top US models contributed to the capabilities of Chinese companies like Kimi, and is this a sustainable strategy?**
A: Distillation's value and sustainability can be summarized as follows:
1.  **Conclusion on Value and Risk:** Distillation is and will continue to be a valuable strategy. This is because US companies lack effective technical or legal methods to prevent it, beyond API monitoring. The risk is low, typically limited to an API ban and a minor financial loss.
2.  **Benefits of Distillation:** It offers three major advantages for a technically mature model company:
    *   **Training Efficiency:** It improves model quality while saving significant time and compute resources during pre-training and post-training. For example, Kimi's shift away from renting large GPU clusters from ByteDance in the second half of 2025 suggests a heavy reliance on distillation for its model releases.
    *   **Data Flywheel Supplement:** It helps close the data gap with leaders like Claude, especially in programming. Distillation provides access to high-quality output data, compensating for the lack of direct user feedback.
    *   **R&D Insights:** It allows companies to analyze the data usage and architecture of leading models, providing crucial R&D intelligence.
3.  **Adoption Among Chinese Companies:**
    *   ByteDance has a strict no-distillation policy since the Spring Festival of 2025.
    *   Alibaba engages in very little distillation.
    *   Tencent is confirmed to be using distillation, as evidenced by frequent API violation flags from cloud providers.
    *   Vertical model companies like Kimi and Zhipu are widely understood to use this method.
4.  **Future Sustainability:** While the intelligence gap will likely remain stable at around one generation, the cost of distillation is expected to increase. Companies like DeepSeek and OpenAI are actively developing methods to counter it, which may lead to technological blocks in the future.

**Q: What is the impact of the recent staff turnover in ByteDance's large model team on its future model iterations?**
A: The impact is multifaceted, involving a talent rotation and a revised development roadmap:
1.  **Talent Rotation:** The industry is experiencing a talent rotation. People are leaving ByteDance for Tencent and Alibaba due to factors like the China-US work time difference and internal equity issues. Simultaneously, ByteDance is hiring core base model talent from Zhipu, Kimi, and Qwen to address its weaknesses.
2.  **ByteDance's 2025 Roadmap:** The company has two key milestones for this year, with development split between two teams and heavy involvement from US and Singapore R&D centers.
    *   **Milestone 1 (May-June):** Launch C 2.5, a text-focused base model aiming to match Kimi 2.5's capabilities and architectural soundness. The goal is to replace the current flawed C 2.0 architecture with a native multimodal one similar to Gemini 1.5.
    *   **Milestone 2 (September-October):** A "leapfrog" attempt to launch a model with capabilities comparable to Gemini 1.5.
3.  **Contingency Plan:** If both model development tracks fall short of expectations, the R&D for the base model may be shifted to be centered overseas.

**Q: What are ByteDance's key focus areas for its models, and how does it benchmark against competitors like Kimi in areas like multimodality and agents?**
A: ByteDance is benchmarking against Kimi and focusing on specific strategic areas:
1.  **Kimi as a Benchmark:** Kimi is considered a leader in China due to its sound base model architecture, which integrates three key features:
    *   **Core Capabilities:** Long-context reasoning, high speed, and good precision, with a genuine parameter count of over 1 trillion.
    *   **Native Multimodality:** Integration of native vision understanding, such as image OCR, directly into the base model.
    *   **Agent Capability:** The model can automatically generate and execute agent code, including multi-agent collaboration.
2.  **ByteDance's Strategic Focus:**
    *   **Native Multimodality:** The priority is on the base model's comprehension and visual understanding capabilities, not separate text-to-image or text-to-video models.
    *   **Agent Domain:** This is a key development area.
    *   **Coding Domain:** This is a high-priority area where efforts are being concentrated. An independent team was formed in Q2 with the goal of developing a model that scores at least 85 (where Claude is 90+) by the end of the quarter.

**Q: Will ByteDance prioritize inference cost-effectiveness and adopt new architectures like Kimi's KDA?**
A: ByteDance will promote the concept of "token value" and cost-effectiveness, but the implementation is expected to be vague and likely not very effective. There are two main difficulties:
1.  **System Complexity:** The vastness of ByteDance's internal systems makes it very difficult to accurately calculate the value of internal tokens.
2.  **Model Instability:** The limited capabilities, inconsistent underlying versions, and fluctuating costs and performance of its external models make such calculations unreliable.

**Q: Is ByteDance developing any new, innovative model architectures?**
A: No, there are no radical architectural innovations on the level of Kimi's Mew architecture. Current work is limited to micro-innovations on existing theories.

**Q: How do the major domestic Chinese model companies compare in terms of their core strengths?**
A: Each major player has distinct strengths:
1.  **Qwen (Alibaba):** Possesses the strongest comprehensive capabilities, scoring above 85 on overall performance metrics.
2.  **DeepSeek:** Has great technical depth. Its next-generation model has the potential to reach the performance of top international models with very low inference costs.
3.  **Kimi:** Has a strong foundation in text models, achieving good stability and generalization by leveraging DeepSeek's architecture.
4.  **Zhipu:** Is a leader in programming, a strength developed since 2023 through B2B projects and industry-specific agent creation.
5.  **MiniMax:** Is quick to adopt new technologies but is significantly constrained by a lack of GPUs, which limits its ability to compete, especially as its profitable models (text-to-video, speech synthesis) overlap with ByteDance's.

**Q: What are the key trends shaping the domestic B2B and C-end markets for large models in China?**
A: The B2B and C-end markets are evolving differently:
1.  **B2B Market Trends:**
    *   **Growth Driver:** The B2B market is seeing fast organic growth, driven by an evolution in enterprise usage from "workflow" to "intelligent entity" and eventually to "agent."
    *   **Market Opportunity for Verticals:** This evolution creates opportunities for vertical model companies like Kimi and Zhipu to provide specialized agent and programming services to enterprises, as large players like ByteDance have weaker coding models and Alibaba is expensive.
2.  **C-end Market Outlook:**
    *   **ByteDance's Dominance:** The C-end market is expected to be dominated by ByteDance's Doubao in the long term. Vertical companies are unlikely to be competitive.
    *   **User Habits:** Doubao's success stems from its alignment with Chinese user habits, which favor simple, integrated "pacifier" functions, and ByteDance's strength in product operations.
    *   **Ecosystem Integration:** Doubao benefits from massive investment, a user memory data flywheel, and deep integration with the ByteDance ecosystem (Douyin, e-commerce, etc.). It plans to remain free this year and introduce a subscription model in 2025.
    *   **Tencent's Chances:** Tencent's chances to compete in the C-end are considered very slim due to the scale of ByteDance's investment and ecosystem advantages.

**Q: Is there a significant compute power (GPU) shortage in China, and how does it affect the major players?**
A: Yes, the compute power shortage is severe and affects all players:
1.  **ByteDance's Situation:** The company is extremely short on high-end GPUs. It is actively buying back H100/H800 cards on the second-hand market at a 2-3x premium. This shortage has led to service queues for its base model and high prepayment requirements (1M-10M RMB) for access to its C-DANCE 2.0 video model on Volcano Engine.
2.  **Market-wide Shortage:**
    *   The C-end chatbot market alone has a demand gap of over 100,000 A100-level GPUs.
    *   Tencent is extremely short on training-capable cards (H100/H800), forcing it to purchase a Hygon cluster that other commercial companies avoided.
    *   Vertical companies like Kimi and Zhipu lack the ~10,000 H100s needed for their coding focus and have no way to acquire them.
3.  **Future Outlook:** By the end of this year, all of ByteDance's NVIDIA cards (H20, A100/A800) are expected to be fully utilized. Future growth will depend on the performance of domestic cards like Ascend and Hygon.

**Q: Can domestic chips like Huawei's Ascend 910B and Cambricon's 690 support advanced tasks like video inference?**
A: The capabilities of current domestic chips are limited:
1.  **Ascend 910B:** It cannot handle video generation on its own. It is an inference card primarily positioned to handle the prefill stage of inference, which can alleviate some load from NVIDIA GPUs but cannot replace them for core computation. It is not a training card.
2.  **Cambricon 690:** It is a hybrid card that can handle image generation and text inference for models up to ~64B parameters. It cannot generate video. It is not cost-effective for high-performance C-end applications due to high power consumption but is feasible for less competitive traditional industry scenarios.
3.  **Video Generation Solution:** For video generation using domestic hardware, the only viable option is the 384-node Ascend cluster.

**Q: Is the current leadership of models like C-Dance in the text-to-video domain sustainable?**
A: The lead is not guaranteed to be sustainable due to the nature of the technology:
1.  **Short Technology Cycles:** The technology for text-to-video evolves in short cycles with a relatively low technical ceiling for each stage. The current cycle, focused on storyboarding and multimodal reference, is nearing its end.
2.  **Next Iteration:** The next cycle is expected to focus on "one model for multiple scenes" (e.g., generating both comics and short videos), which will reset the competition.
3.  **Future Competitive Landscape:** The field will likely remain a tight, GPU-dependent race between Kling (Kuaishou), Vientiane (Alibaba), C-Dance (ByteDance), and VLOGGER (Google). Google could potentially use its superior hardware access to gain a significant advantage (e.g., supporting 2-minute 4K video).

**Q: In which scenarios is the next wave of exponential growth in token consumption expected?**
A: The next significant growth is expected to come from the B2B sector in the second half of the year:
1.  **H1 2025 Growth Drivers:** The primary growth areas were programming and the adoption of "intelligent entities" by enterprises.
2.  **H2 2025 Expected Growth Drivers (B2B-focused):**
    *   **Platform AI Service Suites:** Major platforms like Volcano Engine are expected to revamp and expand their AI service suites for business users, such as AI-powered ad delivery and live stream monitoring. This is seen as an industry-wide trend.
    *   **Upgrade from Intelligent Entities to Agents:** As technical services mature, more enterprises will upgrade their systems from simple intelligent entities to agents with full execution capabilities, which will drive massive token consumption.
3.  **C-end Potential:** The probability of similar growth from the C-end is lower, though there may be some consumption from custom agents for advertisers or creators.

# 原文提炼

**speaker1:** I'd like to start by confirming your perspective on the competition in large models, both domestically and internationally. Since the beginning of this year, overseas models like those from OpenAI and Anthropic's Claude have been iterating very quickly, with recent updates and a new model from OpenAI seemingly on the way. Here in China, companies like Kimi, MiniMax, and Zhipu have also been continuously updating their models. However, ByteDance seems to have been relatively quiet recently after some updates early in the year. From your point of view, how do you see this competition between domestic and international large models? It feels like the pace of iteration has accelerated again in 2024. What are the driving factors behind this, and looking ahead, will the capabilities of these models, especially the domestic ones, start to diverge? I'm particularly interested in the impact Kimi, MiniMax, and Zhipu might have on the industry. Could you share your insights?

**speaker2:** I think this involves a few key points. First, I would summarize the domestic model landscape as having at least three categories or business models.

**speaker2:** The first type is the big company model, like Alibaba's Qwen. They have resources, a cloud platform, and strong business operations. Qwen's model has a very high market share, especially on the enterprise side. We've heard from third-party statistics that for official internal use in enterprises, across all clouds including private deployments, Qwen's market share might be around 1/3. So that's the first category: a major player that dominates across the board, somewhat similar to Google.

**speaker2:** The second category, as you mentioned, includes companies like Kimi, Zhipu, and even MiniMax. I don't think we can call them startups anymore. They are either listed or very well-funded; Kimi's cash flow is quite strong. We can consider them vertical model companies. Their development follows a healthy market rhythm. They have two main characteristics. First, their current stage is very similar to the US market in 2023-2024. Back then, US companies prioritized using their model capabilities to provide services and make users aware of their models. Our domestic vertical companies are following a similar rhythm now. From this perspective, I believe they will continue to see good development this year and have sustained opportunities into next year.

**speaker2:** But why are they developing so quickly? It's largely thanks to the technical contributions of DeepSeek. DeepSeek is likely to release an update this month, so for the next year, these companies might continue to benefit from this dividend if DeepSeek continues its open-source strategy. So, that's the second category. Since DeepSeek is open-source, I see it as a contributor in this commercial competition, not one of the three main categories for now.

**speaker2:** Then there are companies like ByteDance and Tencent. From a subjective view, ByteDance and Tencent are really in the same camp. They have great business operations and ample resources. ByteDance's only advantage over Tencent is having more GPUs in China. In terms of model capabilities, they are not in the first tier. C-DANCE 2.0 did perform well, but in the text-to-video domain, the technical ceiling for each stage is relatively low. It's very likely that by May or June this year, text-to-video will enter its next technological iteration cycle, and C-DANCE 2.0's advantage will be gone as everyone competes anew.

**speaker2:** As for the base model, there are indeed problems. ByteDance's base model has been in continuous training for three quarters without a breakthrough. I saw some media reports saying 60 to 70 people from the large model team have left ByteDance, and that number is fairly accurate. So, the current situation is that ByteDance and Tencent are in one camp: big companies with relatively weak base models, playing catch-up. So, that's the three-tiered structure in our domestic market.

**speaker2:** This is the basic situation, so I agree that the market landscape will change as you suggested. The vertical model companies might gain more service opportunities, similar to North America in 2023-2024. It's also highly possible that a general-purpose model will emerge from one of these companies.

**speaker2:** That's one aspect. On another level, if we compare domestic models with the top three in the US, we have to look at it from two angles. From the first angle, which is core functionality, the gap is quite large and has actually widened significantly.

**speaker2:** First, Google's Gemini is a multimodal base model. No company in China can replicate this end-to-end. Qwen 3.5 has replicated it in form, but it's not end-to-end, and even though it's just one dimension short, the difference is huge. A year has passed since Gemini 1.5 was released in early 2024, and we still haven't replicated it. So that's Google's advantage.

**speaker2:** Then there's GPT-4.5, or even before we look at 5.5 or 6, its agent capabilities are extremely strong. It can integrate its own multimodal model capabilities, and within ChatGPT, we can directly build custom user memory, essentially using the chatbot as an agent. This kind of service capability will indeed impact a large number of software companies, but none of our domestic models have this ability.

**speaker2:** It's the same with Anthropic; it's a company focused on applications. Besides API access, it provides users with what I'd call a new term: "Agent-as-a-Service." It used to be "Software-as-a-Service." Anthropic has always wanted to build this "Agent-as-a-Service" model. So its products like Code, Work, and future offerings will all be "Agent-as-a-Service," including breakthroughs in business, office, and programming scenarios with products like Claude, Skills, and Work.

**speaker2:** These three companies each have absolute advantages in functionality, and we in China cannot replicate any of them right now. So the gap has widened. Before, we were just comparing the "cultural level" of the base models, and the functions were pretty much the same. Now, these three have their own distinct advantages.

**speaker2:** The other angle is the technical performance of the model, what we often call its "cultural level" or intelligence. On this front, we in China are about one generation behind. For example, Claude's current model is the Opus from the Claude 3 series, and we can basically touch the edge of the Claude 3 series' capabilities. It's similar with GPT; we are probably at the GPT-4 level. So on this level, the gap is probably between 6 to 12 months, which is not too bad.

**speaker2:** So that's the general situation when comparing China and the US. Looking further ahead, the US Big Three are clearly focusing more on model usability. Intelligence is one thing, but aspects like multimodal interaction, Anthropic's agent-as-an-application, and the small cases we see from GPT, which are also moving towards multimodal input and interaction, are likely what they value for the future. This is clearly a step ahead of us in China, where we still primarily rely on text interaction and have only just started to see some benefits in programming. There's a definite gap between the two.

**speaker1:** OK. And another point, specifically regarding pure-play model companies, including the unlisted Kimi. There has been talk that a large part of their success comes from distilling top US models, which has, for example, helped them achieve excellent performance in the coding domain. From your perspective, to what extent can distillation improve a model's capability in a specific area or application scenario? And is this something that large companies like ByteDance, Alibaba, and Tencent also do? Can this form of distillation sustainably help Chinese large model companies improve their capabilities?

**speaker2:** On the topic of distillation, let me start with the conclusion: distillation is and will continue to be valuable. This is due to the inherent structural characteristics of large models. The top three US companies don't have a good solution for it. All they can do is put a wrapper around their APIs for various monitoring, analysis, and risk control. They don't have a better fix. So the conclusion is that distillation remains effective, as long as you don't get banned. The risk is also very low. There are currently no laws to protect the outputting party. The most they can do is claim you violated the API terms of use and refuse to refund your money. That's it, just a small cash loss.

**speaker2:** So that's the conclusion. However, the effect it brings to the party acquiring the data through distillation varies across different scenarios. For instance, in a training scenario, especially during the continued pre-training or post-training stages, the direct effect is not just an improvement in model quality, but it's also faster in terms of time and saves on compute resources. This is a significant advantage.

**speaker2:** Let me give you a personal example of how dramatic this can be. Kimi rented GPUs from ByteDance in both 2024 and 2025 for large-scale pre-training. Everyone knows Alibaba is their shareholder, so why not go to Alibaba Cloud? The reason is that Alibaba Cloud couldn't free up a cluster of 12,000 to 15,000 GPUs for a period of 3 to 4 weeks for them. They needed at least A100-level cards, or H100s preferably. That was Kimi's requirement; since it's a text model, it's relatively less resource-intensive. But Alibaba couldn't provide such concentrated resources. So, they came to ByteDance for pre-training in 2024 and 2025. But they haven't since the second half of 2025. That's a pretty noticeable change. And in the second half of 2025, they released their 2.2 and 2.5 models. This suggests that distillation must account for a significant portion of their process. This is the first point: it ensures quality while saving time and compute.

**speaker2:** There's another point, using programming as an example. It also supplements the data flywheel. The logic is that programming is one of the few areas in large model training where user input data is valuable. For instance, with chatbots, we generally don't look at user inputs because they are mostly questions, offering little for the model to learn. But programming is different. First, the context provided by the user is valuable in itself. Second, when the model provides a suggestion and the user accepts it, that's a form of labeling. So, it can enter a positive feedback loop in the data flywheel.

**speaker2:** Right now, Claude's advantage in this area is overwhelming. It's not just about writing an app or a webpage, for which users might pick the cheapest model. The logic now is that programmers trust Claude's model the most. For developing new things like agents, whether it's for AutoGen or other frameworks, you need a model to develop them. This code is now concentrated on Claude; other models don't get to see it. So Claude has entered a very strong positive feedback loop, almost a 2.0 era. Its model gets to see how programmers develop agents ahead of everyone else. That's a real-world example. So, if we distill its data, it means we get the data without getting the direct user feedback, which helps close the gap. Claude is extremely unhappy about this, right? It's their established advantage, and you're undermining it. So this is the second scenario, where it's not about being faster and better, but about leveling the playing field.

**speaker2:** The third real-world scenario is that we don't necessarily use this data for reinforcement learning or fine-tuning our own model. We purely want to see their data, to understand how they use data and what their basic architecture looks like, not just how they respond to certain questions. This is also very important for a company with its own R&D capabilities. So these are the three major benefits of distillation for a technically mature model company. And it's a channel that's hard to shut down.

**speaker1:** OK. So if domestic models are all engaging in some form of distillation, does that mean the capability gap between Chinese models and top US models won't widen too much? For instance, you mentioned we are currently about one generation behind. Can we assume this gap will remain at most one to 1.5 generations?

**speaker2:** Yes, that's right. So, a couple of additional points here. One is that ByteDance has confirmed it does not distill at all. Since the Spring Festival of 2025, ByteDance has not done any distillation; it's very strictly managed within the company. Alibaba does very little. Tencent does distill. This is certain. In their overseas business, Tencent frequently has its API access flagged for violations by AWS and Google Cloud. This indicates they are likely distilling; otherwise, they wouldn't have so many irregular API calls. That's the situation for the big companies. As for the vertical model companies, they've already been called out, so there's not much more to say. That information is accurate.

**speaker2:** And for the future, you are right. As I mentioned, if we look at the models' intelligence and performance, the gap will likely remain around one generation. So if DeepSeek V4 gives us another round of architectural advantages, then for models focused on basic language interaction capabilities, the gap shouldn't widen. However, DeepSeek's CEO seems quite aggressive. They've set up a dedicated team to counter distillation. GPT has also started doing this because data is becoming more and more expensive. So we can say that the cost of our distillation will increase, and there's even a possibility of it being technologically blocked. That's the general outlook.

**speaker1:** OK. Understood. You also mentioned at the beginning that a lot of people from the large model team have left ByteDance. How significant of an impact could this have on ByteDance's future large model iterations, especially on the multimodal side?

**speaker2:** On this front, I think what's happening in China now is a rotation. The ones primarily hiring people from ByteDance, or who have the ability to hire them, are Alibaba and Tencent. Kimi might hire a few, but because Kimi only focuses on text models, its appeal is smaller. So it's a rotation. Right now, professional talent from Kimi and Zhipu is flowing to ByteDance, while people from ByteDance are going to Tencent and Alibaba. This talent flow is also quite interesting.

**speaker2:** Two types of people are leaving ByteDance. One group consists of very high-level individuals. They have many options, and ByteDance's current internal collaboration involves a time difference between China and the US. Most of our high-level people here are older, have children, and so on, so they can't accept this setup. The other group consists of people who were transferred to the large model team from ByteDance's former AML and machine learning teams. They don't have secondary stock options, so it's an issue of internal equity distribution that causes them to leave. At the same time, ByteDance is hiring core base model personnel from Zhipu, Kimi, and even Qwen, because this is ByteDance's weak spot.

**speaker2:** So, the industry is currently undergoing a round of talent rotation. That's the basic situation. Another point is that we have two key assessment points this year. The first is in May-June, when we will update our base model, still focusing on the large language model direction, primarily text-based. We are aware that the current C 2.0 has issues. It's based on the same base model as the previous 1.6 and 1.8 versions; the architectural upgrade was not successful. Furthermore, its vision capability is neither native multimodal nor end-to-end; it's just two parts stitched together. This functionality is fine for users, but it's completely unreasonable from a technical standpoint, so we want to replace it with a native multimodal architecture, something with capabilities like Gemini 1.5. So, the goal for May-June, boiled down, is for our C 2.5 model to be on par with Kimi 2.5's capabilities. The final content generation performance might be slightly better than Kimi's in terms of adherence and comprehension.

**speaker2:** That's one milestone. The second milestone is an attempt to leapfrog the competition. Because even if we align with Kimi by mid-year, it's meaningless. It would be a public admission that we are more than half a year behind Kimi, not even comparing ourselves to others like DeepSeek V4. So we want a leapfrog moment, which is planned for around September-October this year, to launch a model similar to Gemini 1.5. This is another milestone, and the two teams are developing them separately, with little overlap. Both of these models now have significant involvement from our R&D teams in the US and Singapore.

**speaker2:** If the progress of both these models falls short of expectations, the R&D for our base model may shift to be centered overseas. That's the contingency plan.

**speaker1:** So, for multimodal in China, would you say Kimi is currently the leader with its Kimi 2.5?

**speaker2:** Oh, that refers to the architectural soundness of the base model, which is quite good. It has three key features: long-context reasoning, high speed, and good precision. These are essential for a base model. And its parameter count is genuinely over 1 trillion. Look at our C model, we've been cagey, saying we've reached 1 trillion parameters, but we haven't. We just added all the vision parameters to the count. So that's one point: the rationality of the basic architecture design.

**speaker2:** The second is input, which is image reading. We don't even require video reading, really. That's more of a gimmick right now. If we can achieve native multimodality, we might separate the video model. That is, video understanding would be a standalone model, while the base model would have basic vision capabilities. The leadership would be fine with that. So the second part is native multimodality, especially integrating native vision understanding capabilities like image OCR into the base model.

**speaker2:** The third point is agent capability. Right now, with everyone's models, users can have multi-turn interactions and ask the model to perform simple tasks like opening a website. That's not a leading feature anymore. But Kimi has a leading edge: its model can automatically generate agent code and run that agent directly in the model's environment. Kimi can also handle multi-agent collaboration. That's the third aspect: the ability to generate agents.

**speaker2:** Kimi has integrated these three points quite well into its base model from a technical perspective, with a sound architecture. So, as I said, the first goal for C 2.5, the version to be released in May-June, is to at least reach Kimi's level in terms of architectural soundness in these areas. That's the expectation.

**speaker1:** OK, so to understand correctly, ByteDance will be focusing its efforts on multimodality, especially native multimodality, and the agent domain?

**speaker2:** Yes, but this is multimodality for the base model, not text-to-image or text-to-video. It's about the base model's comprehension, so visual understanding capability is very important.

**speaker1:** OK, I understand. And will we also be strengthening our capabilities in the so-called coding domain?

**speaker2:** The coding domain is an area we value highly. We say we value it because we were one of the earliest in the industry to work on it and invested a lot. But to put it simply, we were focusing our efforts in the wrong direction. We kept focusing on the application side—apps, IDE software—and neglected the model's capability. So that's a problem.

**speaker2:** In the second quarter of this year, a small, independent team was established for coding. The goal is, for example, if we rate Claude at over 90 points and domestic models like Zhipu are between 85 and 90, our goal is for this coding team to use three months, by the end of Q2 in May-June, to create a model that scores at least 85. This is a high priority right now. So while we haven't mentioned it recently, we are concentrating our efforts on it behind the scenes.

**speaker1:** OK. Understood. And will we also focus more on things like inference cost-effectiveness and adopt models like Kimi's new KDA architecture to prioritize the cost-performance ratio of inference or input-output?

**speaker2:** Regarding this matter, which is essentially about token value, right? What you're talking about is calculating token value. Currently, ByteDance faces two difficulties. So, to give you the conclusion first: we will also promote this, but the final implementation might be rather vague. It's a bit like our model releases; to put it plainly, we'll fuzzily let everyone see that we have this thing, but you won't be able to understand it clearly. That's the feeling.

**speaker2:** There are two underlying difficulties. The first is that our system is too vast, making it very hard to accurately calculate the internal token value. That's one problem. The other is that for the externally delivered token value, our model capabilities are limited, and the iteration pace, the underlying versions, and the costs are all unstable, as is the performance. So, calculating this is something we'll do since others are doing it, and we are pushing for it now. But the final result will likely be as I described: the effect probably won't be very good.

**speaker1:** I see. Is ByteDance working on any new model architectures?

**speaker2:** At this level, there are no radical innovations, for instance, nothing on the level of Kimi's Mew architecture. Currently, we're only making micro-innovations on existing theories. That's all I can say.

**speaker1:** Understood. So, to summarize the domestic landscape, the most comprehensively strong player is still Qwen, while some of the newly prominent large model companies like MiniMax and Zhipu perform better in their respective niches. Can I understand it that way?

**speaker2:** Yes. Essentially, the competition among domestic models revolves around a few points. First, Qwen's comprehensive capability is very strong. It's the type that scores above 85 overall. But DeepSeek has great depth. The next generation of DeepSeek could very well push its basic performance to the level of OpenAI, possibly reaching the performance of Anthropic's fourth-generation model, with extremely low inference costs.

**speaker2:** So in terms of actual technology, these two are quite good. As for Kimi, its accumulation in text is solid. Its text model capability is very strong, and by leveraging DeepSeek's basic architecture, it has achieved good stability and generalization. So it's quite good. Zhipu is similar; it's also referencing various modules from DeepSeek. Zhipu's strength in programming wasn't achieved overnight; it didn't just suddenly emerge this year. Starting around 2023, Zhipu began doing private deployments for B2B projects and also created many industry-specific agents for those enterprises, which included small programming bots based on Zhipu's own programming model. From the second half of 2023 to 2024, whether it was Zhipu's standalone small 8B/9B programming models or the programming performance of its large base model, it has consistently been a leader in China.

**speaker2:** As for companies like MiniMax, I think their progress, including their adoption of technologies from foreign open-source communities like attention mechanisms, has been quite fast at the base model level. But the reality is that starting this year in China, model technology is one aspect, but the number of GPUs is another huge competitive factor. For example, MiniMax's most profitable models are text-to-video (Hailuo) and its speech synthesis. But both of these models have complete market overlap with ByteDance. So if MiniMax wants to rent GPUs from Volcano Engine, it definitely won't be able to. And Alibaba Cloud doesn't have that many to spare either. So, we often see MiniMax making some noise, especially on OpenRouter, but ultimately, its participation in the domestic competition might be limited simply because it lacks GPUs.

**speaker1:** Looking ahead at the domestic model competition, it seems that after this wave led by long-context models, everyone is paying a lot of attention to the performance of Coding and Agents. Especially after the rise of Anthropic's Claude, and with Claude's code being leaked, it feels like the development of Agents, especially in China, might be very rapid.

**speaker2:** Yes, indeed. Regarding the development trend in China this year, we've touched on it a bit. Vertical model companies like Kimi and Zhipu will most likely capture a certain market share, which is different from previous years. That's one change.

**speaker2:** Another change is on the agent front. Our domestic market structure and what we've observed, for example from Volcano Engine's perspective, is that B2B growth has been very fast this year, especially in procurement, and it's organic traffic. This means it doesn't require aggressive sales pushes. Enterprises, particularly small and medium-sized ones, are proactively making purchases. And the market structure or enterprise usage habits in China show an evolution from workflow to intelligent entity, and from intelligent entity to agent.

**speaker2:** What does this mean in practice? We've seen a real example with manufacturers like Haier and Gree. They used to collect logs from smart home appliances and perform big data processing. This allowed for personalized settings for each user's home appliances, but it was offline. That's a workflow: it operates according to a predefined model, calculations are run daily or weekly, and then suggested temperature or other settings are pushed to the device. Now, they want to upgrade to intelligent entities. For example, a user with the air conditioner's app can just say, "I'm sick with a fever today, I'm home alone," and the bedroom AC adjusts the temperature automatically. It's becoming interactive.

**speaker2:** The demand for this is huge, the market size is large. And if it's a vertical company, one that specializes in a particular service rather than a large conglomerate, it's highly likely to choose services from Kimi or Zhipu. We have many such enterprises in China, given the size of the country. This is one change.

**speaker2:** Then there are the super-large corporations, like Haier and Gree. They tend to choose ByteDance or Alibaba because their needs are more complex, involve large volumes, and have higher security requirements. So this has created a mismatch. The mismatch is that ByteDance's coding is poor, Alibaba's is okay but expensive. And the smaller companies don't have cloud services but have good programming capabilities. So these vertical enterprises will purchase the relevant agent or programming services from them. This is a change, and this market trend is likely to continue for at least another year. Especially if DeepSeek V4 is released and these vertical model companies can leverage it well and reduce their costs, for example, making their coding services significantly cheaper than Alibaba's or Qwen's, that could become a characteristic of our domestic market, as we have a large traditional industrial base.

**speaker2:** Another point is the various real-world agent scenarios. In this area, the advantages of large companies are actually diminishing. This is based on my personal collation of information. The logic behind this weakening is that with the rise of OpenAI and Claude, we large companies tried again and found that the C-end market is still not buying in. In other words, our standalone C-end applications market has not yet matured.

**speaker2:** To put it simply, ByteDance is probably the only company in China providing C-end agent services, with the Coze website. The daily active users of this website have consistently remained around 100,000 to 200,000, peaking at 300,000. This shows the size of the market. So the C-end is definitely not taking off. Now, the three companies—ByteDance, Alibaba, and Tencent—are very clearly transitioning their OpenAI/Claude-like services towards B2B private deployments. This private deployment can be on the user's own servers or on their cloud's ECS; both are possible. They are moving in this direction, and it seems these large companies are quite focused on returns.

**speaker2:** So now, when pushing these B2B agents, the purpose is extremely clear. It's either for what we call industry solutions—mobile phones, cars, various terminals, which is ByteDance's strength, including scenario-based applications in Douyin and advertising. Or it's directly creating solutions for a specific industry, like finance or media. So the push towards B2B is heading in this direction.

**speaker2:** My personal summary here is that when large companies push these agent services, they are not heavily reliant on programming, and they are doing it in a very conservative way. This is not a huge market growth driver; it's more of a slight market transition. So, it's quite possible that companies like Kimi and Zhipu might partner with the top one or two companies in a certain industry to explore new collaboration models. That's a strong possibility.

**speaker2:** On the matter of coding, I think there's a bit of a misconception right now. The misconception is that people see Anthropic's tremendous growth, especially with coding becoming an increasingly large part of its total revenue, and think we can map this to China and find a similar company, which currently appears to be Zhipu due to its rapid growth in programming.

**speaker2:** But on the coding front, as I explained partly before, our domestic progression is from workflow to intelligent entity to agent. In this process, coding is not necessarily a must-have. The platform service provider might just package the technical work inside, offering low-code solutions or something similar. That's one issue. Another issue is that Anthropic's programming business earns money from the entire world. Even many C-end users in China pay for it. So, we have to ask how Zhipu can pry these customers away from Anthropic. The bar is actually quite high.

**speaker2:** At the same time, there's another issue. Looking at the first quarter, the growth of the programming market was higher than expected, but the area of outperformance is limited. Initially, we, the major platforms providing programming services, thought the market was just two segments: C-end and large B-end, especially those making bulk purchases of programming services, like top internet companies or top software companies like Chinasoft. Later, we discounted the C-end because its value is too low. So we were left with just the small B-end segment. The recent outperformance in programming has only come from this B-end segment, where some non-technical but well-funded companies have also started purchasing programming services. So, while the market seems to be developing vigorously, we are not yet entirely sure how large this new segment that exceeded our research from last year really is.

**speaker1:** Let me just confirm, you mentioned that some domestic large model companies can offer prices that are cheaper than the major players. Is this mainly due to their model architecture, smaller number of activated parameters, or some other reason? Because if we look at compute power, they are also renting it, whereas the big domestic companies have purchased their own GPUs. So from a compute perspective, their access to GPUs should be less than the big players, right? Is their advantage mainly in model architecture innovation?

**speaker2:** The term "cheaper" actually has two different definitions here. The first is that for small and medium-sized enterprises, their usage is more flexible. For example, they offer pay-as-you-go models or various trial options. Since these companies primarily offer mass-market API services, for SMEs, flexibility itself is a form of being cheaper. This is unlike mature cloud platforms where, if I want to use a service, I first have to set up a whole suite of other services, and often get discounts only if I use their servers. So that's one difference.

**speaker2:** Another aspect is that in terms of long-term procurement packages, they do offer discounts. Alibaba offers the fewest, while Volcano Engine and these vertical companies offer more. So it's from these two perspectives.

**speaker1:** OK, I see. But as you mentioned, Claude has already formed a data flywheel in coding and is the strongest globally. Domestically, are there any clear leaders? And looking forward, will it still be Claude globally and Zhipu or Alibaba domestically?

**speaker2:** Domestically, it's really Zhipu. The thing is, we first have to exclude the areas where Claude has an absolute advantage. The first is in developing the new ecosystem brought about by large models. This is an area where China is indeed quite weak. Another is in computer-use operational tasks, which is what Anthropic's Work does. The user tells Work what they want to do, and it actually writes Mac scripts. We in China are not good at any of these.

**speaker2:** If we exclude these advanced parts, Zhipu is probably at the level of the Claude 3 series. Their own people rate it higher; they believe they're past the 3 series and in the 4 series era. But in actual use, it's really at the 3.5 series level, close to that performance. Compared to Alibaba, there are some small gaps. The biggest problem is that it thinks for too long, which indirectly makes it expensive. Even though its list price might be 10% to 20% lower than Alibaba's, its inference time might be more than double, so the cost-effectiveness isn't great. Alibaba's logic is similar; its thinking time is also a bit longer than Claude's. Plus, if you want to use it a lot, Alibaba's sales team will push other services on you. If you don't buy them, the package price or preferential rates will go up. So in the end, Zhipu turns out to be the most cost-effective, and it even has the leverage to raise prices. That's the situation in China.

**speaker1:** OK, I understand. And regarding the B2B and C2C application scenarios, if we compare OpenAI and Anthropic in the US, one seems to focus on C-end and the other on B-end. Currently, the B-end seems to be doing much better than the C-end, especially looking at the recent growth rates of these two top overseas companies. Does this offer any inspiration or lessons for China? For domestic companies, should they also focus more on B2B development if they want to monetize?

**speaker2:** In China, the situation is this. With Anthropic, for example, whether it's programming or co-work, or even Claude, C-end users can find many use cases. Its base model performance is also strong. In China, I can only summarize the current situation and future expectations. For the current domestic situation, I think companies like Kimi, Zhipu, and MiniMax should probably not participate in the C-end competition at all, because it looks like the C-end will be dominated by ByteDance's Doubao for the long term.

**speaker2:** The situation is that we've summarized a characteristic of domestic users: their usage habits are completely different from those of ChatGPT users. At least for the whole of 2023, users primarily used integrated functions, even things like the translation button in Doubao. I personally find it odd to need a button for translation; you could just input English and tell it to output Chinese. But features like the translation button are used by millions of users every day. This means Chinese users' approach is what we call "pacifier" functions—it's the classic internet product playbook.

**speaker2:** So, given Doubao's stickiness, user base, and the underlying agent engineering, which is what we've always done and was later conceptualized by Anthropic, Doubao is actually an entire system, not just a chatbot. The resources invested in it are enormous. Combining these factors—the functions, the resources, and the fact that you can now watch Douyin, listen to novels, and soon do e-commerce within Doubao—the vertical model companies have absolutely no competitive strength. And Doubao fits the usage habits of Chinese people.

**speaker2:** Doubao has already made it clear that it will not charge for the entire year, and in 2025, it will start charging based on functions and scenarios, moving towards a C-end AI subscription model. So I personally conclude that the C-end landscape is basically fixed, unless a truly super-amazing startup or a brilliant new model appears to challenge Doubao. Otherwise, the C-end in China is pretty much set. ByteDance's greatest strength is still the C-end and product operations.

**speaker2:** On the B-end, there are currently three categories, and DeepSeek might become the fourth. But the three we see now are Volcano Engine, Qwen, and other vertical companies. I think these other vertical companies have great potential and a lot of room for imagination in the 2B space; they could indeed become the "Anthropic of China." The biggest difference between Volcano and Qwen is that Volcano started as a PaaS and SaaS-focused cloud service. It was the latest to start and primarily serves users around advertising, social media, and multimedia.

**speaker2:** In the large model domain, Volcano is still following this trend. For example, last year, of the Doubao large model tokens sold by Volcano—I mean real, effective tokens—text-based ones accounted for over 70%, around 77%. Multimodal accounted for 23%. This year's goal is to push multimodal to 30% or even over 35%, to shift that ratio. That's one distinction.

**speaker2:** Another is the continued focus on PaaS output. Whether it's AI monitoring for live streaming rooms, AI-powered ad delivery, or regular mass-market services, everything is shifting towards multimodal. It's obvious that our base model's capabilities are limited right now, so in the short term, you definitely can't beat those vertical model companies in text. When enterprises use the models, they test them practically and pay real money for them, so Doubao's base model has limited market influence at the moment. It mainly relies on multimodal and ByteDance-ecosystem services. That's the second category.

**speaker2:** Qwen is the third category. It's highly likely to leverage the capabilities of its traditional Alibaba Cloud business to convert more medium to large enterprises to use its services. So that's roughly the B2B landscape in China.

**speaker1:** Regarding the C-end, do you think Tencent still has a chance?

**speaker2:** We believe Tencent's chances are very slim. There's a key factor here: ByteDance's investment in the C-end is enormous, especially the behind-the-scenes investment that ordinary users don't see. We can summarize it into two advantages. The first is continuous investment. Doubao permanently stores user memory, meaning all user conversation histories are saved, and user history memory is incrementally updated on a T+1 basis. This is an indirect data flywheel. Although it's not very useful for the model itself, it works like Douyin's recommendation engine: the more data I have, the more accurate my Doubao service feels.

**speaker2:** The second advantage is that Doubao has confirmed it will integrate with Douyin, Toutiao, audiobooks (novels), and e-commerce this year. This attracts two types of people. One group is various creators who use Doubao to generate videos and distribute content on Douyin, including hobbyists who run their own social media accounts and people who listen to audiobooks. The other group is on the e-commerce side, where it will provide precise e-commerce discovery for highly detailed descriptions. For example, a very frugal mom wanting to buy a pair of super high-value sneakers for her child. Doubao will prioritize supporting these kinds of queries. This caters to the upgraded "lazy" needs of Chinese users. For Tencent to challenge this, it would probably take more than a 3 billion RMB red envelope campaign. And spending 30 billion is not in Tencent's style.

**speaker1:** Understood. On the topic of compute power support, have you felt a significant shortage of compute this year?

**speaker2:** Oh, regarding compute, the situation from ByteDance's perspective, and extending outward, is roughly as follows. First, for ByteDance right now, we are willing to pay 2 to 3 times the price for H100 and H800 GPUs. The seller must provide an official invoice because we only buy compliant cards. We look at the condition, pay on the spot, and take them away immediately. So we've been buying back high-end H-series cards on the second-hand market. This has been going on for almost two months, and we've collected enough for about 1,000+ cabinets. This is likely to continue throughout the year.

**speaker2:** So, we are extremely short on cards right now. And the H100 shortage directly affects our international business. The base model serves only domestic users, but now there's a queue even at 4-5 AM. Many of our VTs have complained. They used to work from 4 AM to 4 PM, but now they say there's a queue even at 4 AM. They're asking what we did, and on top of that, we've raised the price for the base model packages.

**speaker2:** That's from the base model's perspective. The situation at Volcano Engine is even more extreme. For C-DANCE 2.0's video generation and some of C-DREAM's image generation scenarios—primarily C-DANCE 2.0—we require ordinary small and medium-sized users who are not old or key account clients to prepay 1 million RMB. This payment is exclusively for this model; other services cost extra. And for major key accounts like JD.com, which partners with us, they have to commit to 10 million RMB in annual spending to use C-DANCE 2.0. So that's how bad the card shortage is, because C-DANCE 2.0 can only run on H100 and H800.

**speaker2:** Looking at the long term, by the end of this year, the utilization rate of all H20 GPUs in China should exceed 75%, approaching 80%. For large enterprises, an 80% server utilization rate is considered full, because you need a buffer for fluctuations from events. You can't let it run above 90%, or a 10% spike would cause a crash. So this year, for the H20 series, even though we probably have the largest stockpile in China with over 300,000 units, the expected utilization rate for all of them will reach over 75%.

**speaker2:** Additionally, the A100 and A800 will also be at 100% utilization. This means that by the end of this year, some scenarios will have to use Ascend—we have the 920B and 920C—or Hygon chips for inference. Lower efficiency just means using more cards; you just don't make a profit. So by the end of this year, all of ByteDance's NVIDIA cards should be fully utilized. If business continues to grow next year, there will be no NVIDIA cards available, and we will have to rely on domestic cards to step up.

**speaker2:** Expanding this to the broader market, the situation is this: C-end chatbots, since it's clear that Baidu's Yuanbao and Alibaba's Qwen are not giving up, will definitely have at least two more rounds of major promotions this year. So we expect the total daily active users for C-end chatbots to reach 300 million. The demand behind this is at least 300,000 A100 GPUs. If you want good concurrency and mix in high-frequency scenarios like shopping, e-commerce, and food delivery, plus some image generation, this market actually needs 400,000 A100s. But the total number of A100s imported into China is less than 300,000. So there's a huge gap in the market, and this gap will likely fall on Tencent.

**speaker2:** Furthermore, Tencent has almost no H100s or H800s, but future video generation and base model training will become increasingly complex. So Tencent also lacks training cards. This explains why Tencent was willing to buy Hygon's 10,000-card cluster, which no one else was looking at. The only other customer for that cluster was the Chinese Academy of Sciences, no commercial companies. But Tencent had no choice. The fact that they chose it shows they are extremely short on training compute. So, working backward from the market, even a company like Tencent is desperately short on cards.

**speaker2:** And if we look at Kimi or Zhipu, for the coding domain they are focused on, we estimate they are short about 10,000 H100s. But the total number of H100s in China is only 200,000, even fewer than A100s. So they have no way of finding these 10,000 H100s, especially since ByteDance is now buying up used cards. And even if Alibaba Cloud has gray-market cards, they can't rent them out, because those can only be used internally. So at this level, including the development of Kuaishou's Kling 3.0 in China, there is currently no solution. We can only wait for domestic superclusters plus Ascend to be available for large-scale application. The card shortage in China is quite severe.

**speaker1:** Can the Ascend 910B and Cambricon 690 support the generation for video inference?

**speaker2:** It works like this: the 910B definitely cannot. Even the 910B supercluster cannot. It can only handle a part of the process. Huawei themselves have said that their 910B cluster is primarily for handling a portion of the prefill stage in inference. That's its positioning. So even when combined in a 384-node cluster, it can only save a large portion of NVIDIA cards by handling the bulky prefill work. The core computation and high-frequency diffusion still require NVIDIA. It can only alleviate some pressure. But for text, the 910B cluster is perfectly capable. However, the 910B is an inference card; it's not for training. For training, you have to wait for the 910B DT.

**speaker2:** As for Cambricon, its 590 and 690 are both hybrid cards. The 590 can only handle inference for text models under 32B parameters, so it can't even do image generation. The 690 can handle models with roughly double the parameters, say 64B. This means it can't handle typical commercial chatbots like Doubao or Qwen because these C-end applications are highly competitive and require an output of over 4,000 tokens per second per user. The 690 can't do that. Or rather, it might be able to reach that level, but you'd need many machines and a lot of electricity, so it's not cost-effective. For applications like assistants in the apps of the four major banks, using the 690 for text inference is feasible because the activated parameters are usually around 40B. The 690 has progressed to this level, and it can also generate images. But since it's a hybrid card, using it only for inference results in high power consumption. Hygon's DCU series is positioned similarly to the 690.

**speaker2:** Also, there's likely a production capacity issue with the 910B. ByteDance placed an order for 100,000 cards, and Alibaba also ordered 100,000. Huawei said they couldn't fulfill both deliveries. It seems after some three-way negotiation, they prioritized Alibaba. That's why ByteDance is now considering Hygon's DCU-3 and DCU-4.

**speaker1:** OK, so Cambricon's 690 is usable but not cost-effective, right?

**speaker2:** Exactly. But for some traditional scenarios, what we call traditional industries that don't face intense competition, it is feasible.

**speaker1:** So if the 690's performance is okay, and there are no other options for the C-end, would it be considered for inference?

**speaker2:** Oh no, the 690 can only generate images, not video. So for video generation, if we're looking at domestic cards, we have to rely on the 384-node Ascend cluster.

**speaker1:** I see. You also mentioned at the beginning that text-to-video models like C-Dance are still in a sort of early development stage. So, C-Dance's current lead doesn't mean it will still be leading in three or six months, is that correct?

**speaker2:** Yes, it's not that it's in an early stage, but that the technology cycle for text-to-video is short. The technical ceiling for each stage is low. For instance, the competition in this current round of technology is about one thing, or maybe two: storyboarding and multimodal reference. Audio-visual synchronization was mostly solved by everyone late last year. So, the first half of this year is about storyboarding and full-modality reference. Now we're just waiting for Alibaba's Vientiane and Google's VLOGGER to be released. Once those two are out, this technology cycle is over.

**speaker2:** The next cycle will be about one model for multiple scenes. Recently there was a paper called "Happy House," which is a representative example. The logic is to use one model to generate comics without that "cinematic" feel, and preferably also generate short videos, because short videos are 30 frames per second. One model to handle it all. So in the next cycle, everyone will likely iterate in this direction. That will be the upgrade for the second half of this year.

**speaker1:** OK. But for the first half of this year, is it still hard to say which models will take the lead?

**speaker2:** It really depends on where everyone's focus is. For text-to-video, it will likely remain a tight race, and it's very possible that MiniMax's Hailuo 0.3 will join in. The contenders will likely still be Vientiane, Kling, C-Dance, and VLOGGER. And Google might very well use its GPU advantage for a dimensional strike against us. Google's model might have similar functions to ours, but they could support 2-minute 4K video. If they do that, it's a pure hardware advantage attack, and we in China won't be able to match it. We can only compete on effects within 15 seconds. So, the text-to-video landscape will basically be Kling, Alibaba, ByteDance, and Google. If MiniMax is willing to continue investing, Hailuo should have further iterations after 0.3, which is about to be released. So the landscape for text-to-video is unlikely to change much. These companies have turned it into a money-burning game that relies on GPUs. Without GPUs, you can't get good results.

**speaker2:** But in other areas, there might be differences. For example, text-to-image. This is something I personally don't quite understand. The basic situation is that text-to-image should have a larger user base than text-to-video. Even if it charges less, its market is definitely bigger. Right now, in text-to-image, ByteDance's C-Dream is a leader in China. And around the end of this month or early next month, there will be a new version of C-Dream, 5.0 official, with stronger photo editing capabilities and the ability to search the web for information. But other companies don't seem very willing to invest in this direction.

**speaker1:** OK. I have one last question. Looking ahead, in which scenarios do you personally expect to see another significant, exponential growth in token consumption?

**speaker2:** I think in the first half of this year, the noticeable growth came from two areas: programming and intelligent entities. We can't look directly at image or video generation because their technical structure inherently means a single image or video consumes a lot of tokens. So the significant growth is in intelligent entities, not full-fledged agents, because most of these enterprises have just evolved to the intelligent entity level, and their execution capabilities are still weak. It's mainly an upgrade of their workflows. The second is programming.

**speaker2:** For the second half of the year, I have expectations for two directions. The first is for platforms like Volcano Engine. Volcano Engine originally designed a PaaS system around Douyin's short video ads. Simply put, when users generate data on ByteDance's platforms, whether it's content or ads, the data structure is fixed by ByteDance. Users can't change it, but they can use agents to perform various analyses and summaries, and even help with ad delivery. This initiative did not meet expectations in the first half of the year or Q1. So, Volcano Engine's consumption, without the growth from its Coze platform, was actually below expectations. Coze brought a short-term growth spurt. We will be revamping this in the second half of the year.

**speaker2:** We will continuously revise and comprehensively expand in this direction. The expansion means that even for a lead-generation ad where an advertiser inserts a form into a Douyin video, there might be a whole AI service suite behind it. This is a growth area, and I think it's an industry-wide concept. Once ByteDance does this, other companies like Tencent and Alibaba will probably follow. This also includes the previously mentioned monitoring of live streaming rooms, and even automatic ad placement in live streams. All of this is included. This area didn't take off in the first half of the year, but there's a high probability it will in the second half.

**speaker2:** The second change is the upgrade from intelligent entities to agents. As these platforms, both mature ones and the vertical model companies, provide increasingly sophisticated technical services, more and more B2B enterprise users will iterate towards agents, adding execution capabilities. When one company starts executing tasks, the consumption will be huge. So that's the second possibility. I think both of these directions are B2B-focused. The probability for C-end is smaller.

**speaker2:** Different companies have various trial plans. For example, ByteDance is also thinking of providing custom agents for advertisers and content creators. We can imagine it like providing a quantitative trading tool to a retail stock investor. The transaction volume would definitely go up. So ByteDance has plans, for example, to provide an ad delivery assistant to advertisers. It might tell you, "Your ad's performance is projected to be great today, you should quickly add more money to the campaign." I think this is possible, but it might not meet expectations.

**speaker1:** OK. Great. I don't have any other questions. Thank you very much for today. I'll review this, and if I need more information, I'll schedule another call with you. Thank you so much for your time.

**speaker2:** Alright, you're welcome.

**speaker1:** OK, goodbye.