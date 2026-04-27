# 260414 - AceCamp Ascend Channel Check ByteDance and Tencent Demand Shifts 950PR Capacity Estimates Competitive Landscape Changes with Cambricon and Hygon

# AI总结

## Demand and Order Updates from Key Customers
- **Significant increase in demand from major tech companies**: Since March, major tech firms have been aggressively increasing their orders for AI accelerator cards.
  - ByteDance: Total order has grown to nearly 300,000 cards.
  - Tencent: Order has increased from 50,000 at the start of the year to a current level of 130,000-140,000 cards. Due to shortages, Tencent is accepting a batch of 920C cards as a supplement.

## Production Capacity and Forecast
- **Strategies to meet increased demand**: A multi-pronged approach is being used to increase production capacity.
  - Using 920C cards as a temporary supplement for urgent orders.
  - Securing new fabrication capacity for the 950 chip.
  - Freeing up domestic N+2 process capacity at the southern fab (SMIC) by shifting mobile SoC production to internal facilities.
  - Securing overseas fabrication capacity, primarily with Samsung.
- **Annual production forecast**:
  - 920C: The forecast remains at approximately 350,000 units. Production has ceased, but a small supplementary batch may be produced if new orders arise.
  - 950: The forecast is approximately 850,000 units. This figure already includes the newly added domestic and overseas capacity.
- **Overseas production capacity (Samsung)**:
  - Volume: Targeting an average of 1,000 wafers per month.
  - Process: 6nm technology, which will result in a slight performance improvement for the 950 chips produced there.
  - Timeline: Expected to be fully operational by the end of Q2.
  - Product Focus: Primarily for the 950 PR, with a portion of 950 GT production to be allocated later.
  - Stability: The capacity is considered reliable, as other Chinese companies (e.g., Hygon, Kexin) have also secured stable capacity from Samsung.
- **Domestic production capacity (Southern Fab - SMIC)**:
  - Current Capacity: Stable at 7,000 wafers per month.
  - Capacity Expansion: The expansion is ahead of schedule, with new capacity expected by early Q3 (late June/early July) instead of the end of Q3.
  - Allocation of New Capacity: Of the newly added 5,000 wafers, the company expects to receive less than 2,000, a smaller share than initially anticipated. Cambricon and Hygon will receive larger portions.
  - Yield Rate: Improvement remains slow, with less than a one-percentage-point increase over the past month. The year-end goal of a five-point increase is considered challenging.

## Chip Allocation and Delivery Schedule
- **920C allocation (350,000 units total)**:
  - Tencent: 30,000-40,000 cards.
  - ByteDance: 20,000-30,000 cards.
  - Remainder: Allocated to telecom operators and local government projects.
- **950 PR allocation (out of 850,000 units total)**:
  - Internal Use: Approximately 250,000 units.
  - Tencent: Approximately 110,000 units.
  - Alibaba: Approximately 120,000-130,000 units, almost exclusively the PR version.
- **920C delivery schedule**:
  - 150,000 units were delivered in Q1.
  - Deliveries will continue through Q2 and Q3, with the pace dictated by the bidding schedules of government and enterprise clients.
  - Major tech companies have largely completed their 920C procurement and are now awaiting the 950.
- **950 delivery schedule and production ramp-up**:
  - April: 20,000-30,000 units.
  - May: 50,000-60,000 units.
  - June: 70,000-80,000 units.
  - H2 2024: Monthly volume will start at ~80,000 units and is expected to increase to ~95,000 units with new capacity coming online.
  - Total Potential Capacity: Theoretical calculations suggest a potential output of 1.4-1.5 million units for the year, but this is an optimistic scenario that does not fully account for capacity fluctuations and supply chain stability.
  - Production Lead Time: The entire back-end process takes approximately 1.5 months, meaning production from November/December will likely be delivered in 2025.

## Supply Chain Analysis and Bottlenecks
- **Back-end packaging**:
  - Capacity: Considered tight but sufficient to support shipments of approximately 1.2 million units this year.
  - Key Suppliers & Allocation:
    - Shenghe Jingwei: Currently handles ~60% of the company's volume, utilizing ~4,400 wafers/month of their >6,000 wafer/month capacity.
    - TFME: Utilized for ~1,500 wafers/month.
    - Quliang: Utilized for ~1,000 wafers/month due to lower yield rates.
  - Future Strategy: Plan to shift more volume to Quliang and provide support to improve their yield. The future allocation target is Shenghe (~45%), Quliang (40-45%), and TFME handling the rest.
- **HBM (High Bandwidth Memory)**:
  - **Status: The primary bottleneck and biggest source of uncertainty.**
  - Supply Constraint: The 950 chip is designed for HBM3, but supply is extremely tight. Initial batches will use the company's existing inventory of HBM2E.
  - Impact on Shipments: The HBM shortage is expected to reduce the neutral shipment forecast for the year from 1.2 million to approximately 1.1 million units.
  - Customer Acceptance: Major tech companies strongly prefer overseas HBM3 but are willing to accept HBM2E configurations at a lower price for urgent needs. Telecom and government clients are less sensitive to the HBM type.
  - Domestic HBM: Domestic HBM is ready for mass production and is considered a viable alternative, but its performance still lags behind overseas products. It is seen as a key part of the long-term solution.
- **Back-end testing**:
  - Main Partner: Wice remains the primary testing partner, handling ~70% of the volume.
  - Equipment: There is a shift towards domestic testing equipment (e.g., from Changchuan, Huafeng) as purchasing new equipment from overseas suppliers like Advantest faces restrictions.
  - Bottleneck Risk: Testing is not considered a significant bottleneck at present, as the performance and capacity of domestic equipment are deemed adequate.

## Server Components Supply Chain Update
- **Connectors**:
  - New Supplier: AVIC Jonhon has been added to the supply chain.
  - Market Share Reshuffle: AVIC Jonhon will take share primarily from Huafeng Tech. Luxshare (Jinghong) will remain a key supplier.
  - Expected 2024 Share: Huafeng (50%), Luxshare (30%), AVIC Jonhon (20%).
- **Optical Modules**:
  - Supplier Stability: The supplier base is largely unchanged.
  - Market Share: HGTECH and Accelink are the dominant players (combined ~65%). Innolight is the third largest (~20%), followed by Source Photonics and internal supply.
  - 800G Modules: The main suppliers for 800G optical modules are HGTECH and Innolight.

## Supernode (Large-Scale Cluster) Status and Adoption
- **Customer adoption and challenges**:
  - Adoption Rate: Adoption remains low, estimated at 20-30% for the current year.
  - Key Barriers: High cost and concerns about technical stability, particularly system downtime. A 384-card cluster currently requires a reboot approximately every 15 days, which is not well-received by customers.
  - Customer Response: Some large customers, like ByteDance, are developing their own large-scale cluster solutions to reduce costs.
- **Use cases and performance limitations**:
  - Primary Applications: Supernodes are mainly used for reinforcement learning (e.g., model distillation) and complex inference tasks (e.g., multi-modal and Agent-based models).
  - Performance Weakness: The platform struggles significantly with multi-modal inference (e.g., text-to-image, text-to-video). This is primarily a software compatibility issue rather than a hardware limitation.
  - Optimization Roadmap: An estimated 3-5 months of software optimization (e.g., expanding operator libraries) is required to improve multi-modal capabilities. The company expects to achieve this faster than competitors like Cambricon.

## Competitive Landscape and Foundry Strategy
- **Cambricon**:
  - MLU-690 Status: Also performs poorly in multi-modal scenarios. Its mass production and delivery schedule is estimated to be about two months behind the 950.
  - Foundry Capacity: Has approximately 1,000-1,200 wafers/month of overseas capacity (TSMC and Samsung). The TSMC portion is stable, but they are facing issues retrieving wafers from Samsung, possibly due to design-related problems.
- **Second-tier domestic chip makers (e.g., Iluvatar CoreX, Muxi)**:
  - Market Dynamics: Gaining traction with major customers like ByteDance due to the severe supply-demand imbalance in the market.
  - Strengths: They are more flexible on adaptation costs and are highly motivated to create successful benchmark cases with key clients. Iluvatar has reportedly achieved good results with text-to-image models for ByteDance.
  - Challenges: They face significant bottlenecks in production capacity (relying on limited overseas foundry access), HBM procurement, and are restricted to domestic packaging vendors.
- **Overseas foundry strategy (Samsung)**:
  - Policy Dependence: Access to overseas capacity is highly sensitive to US policy.
  - Differentiated Access: Major CSPs like Alibaba and ByteDance have an advantage in securing direct, more stable capacity from Samsung due to their large, consistent order volumes and ability to navigate compliance.
  - Limited Access for Others: Second-tier manufacturers like Iluvatar and Muxi have very limited access (e.g., <400 wafers/month) and often rely on intermediaries.

# QA总结

**Q: What is the current state of demand from large tech companies, and have there been any significant changes since March?**
A: Demand from major tech companies has been increasing strongly since mid-March. Key updates include:
1.  **ByteDance:** Total order has grown to nearly 300,000 cards.
2.  **Tencent:** Order has increased significantly from 50,000 cards at the beginning of the year to a current level of about 130,000 to 140,000 cards. Due to shortages, Tencent is requesting immediate stock and has accepted a batch of 920C cards as a supplement.
Overall, procurement from major tech companies is very aggressive.

**Q: With increased demand, particularly from Tencent, how are you allocating extra cards and securing the necessary production capacity?**
A: We are addressing the increased demand through two main strategies:
1.  **Short-term Supplement:** We are using some 920C cards to fulfill immediate needs.
2.  **New Fabrication Capacity:** For our 950 chip, we are actively seeking supplementary fabrication capacity to increase the total order volume by tens of thousands of units. This involves:
    *   **Domestic Capacity Adjustment:** We are shifting the fabrication of our mobile phone SoCs from the southern fab (SMIC's N+2 process) to our own internal facilities. This frees up N+2 capacity for our large AI processors.
    *   **Overseas Fabrication:** We are pursuing fabrication options with Samsung, using their 6nm process, and are making progress.

**Q: What are the full-year delivery forecasts for the 920C and 950 chips, and does this include the newly secured capacity?**
A: Yes, the forecasts include the newly added capacity. The projected delivery volumes for this year are:
1.  **920C:** The forecast remains at about 350,000 units.
2.  **950:** We project we can reach about 850,000 units.

**Q: Could you provide details on the new overseas (Samsung) and expanded domestic production capacity?**
A: The capacity situation is as follows:
1.  **Overseas (Samsung):**
    *   **Volume:** We are aiming for an average of 1,000 wafers per month.
    *   **Process:** 6nm technology, which will result in slightly better performance for the 950 chip.
    *   **Timeline:** The production line is expected to be fully operational by the end of Q2.
    *   **Stability:** We believe the capacity is reliable, as other domestic companies like Hygon and Kexin also have stable capacity there.
    *   **Products:** This capacity will be used for the 950 PR initially, with a portion allocated to the 950 GT version later.
2.  **Domestic (Southern Fab):**
    *   **Current Capacity:** Remains at 7,000 wafers per month.
    *   **Expansion Timeline:** The expansion is progressing faster than planned. New capacity will come online by the beginning of Q3 (late June/early July), instead of the end of Q3.
    *   **Allocation:** Our share of the newly expanded 5,000 wafers has been adjusted down. We will now get a little less than 2,000 wafers, while Cambricon will receive between 1,000 and 2,000. Hygon will also get a share. Despite the reduced proportion, our absolute volume remains the largest.
    *   **Yield Rate:** Improvement is slow, with less than a 1 percentage point increase in the last month. The goal of another five-point increase by year-end is considered difficult.

**Q: How will the forecasted 350,000 units of 920C and 850,000 units of 950 be allocated among customers?**
A: The allocation plans are as follows:
1.  **920C (350,000 units):**
    *   **Tencent:** Approximately 30,000 to 40,000 cards.
    *   **ByteDance:** Approximately 20,000 to 30,000 cards.
    *   **Other:** The remainder will go to telecom operators and local government projects. Production of the 920C has largely ceased, with this year's volume being the final batch.
2.  **950 PR (portion of 850,000 total 950 units):**
    *   **Internal Use:** Approximately 250,000 units.
    *   **Tencent:** Approximately 110,000 units.
    *   **Alibaba:** Approximately 120,000 to 130,000 units (almost exclusively taking the PR version).

**Q: What are the test results for the 950 chip from major internet companies, and how does it compare to competitors?**
A: The testing phase for the 950 is nearly complete with both first-tier and second-tier tech companies, and its capabilities are well-recognized.
1.  **Validation Status:** Comprehensive performance tests, including single-rack (64 cards) and multi-rack configurations, have been completed with major customers like ByteDance, Tencent, and Alibaba. They have clear metrics and confidence in its performance.
2.  **Performance Benchmark:** While many companies want to compare it with the NVIDIA H100, there is still a significant performance gap. A more realistic comparison is with the NVIDIA H20.
3.  **Software Optimization:** Further optimization, especially for the CUDA ecosystem, will be a long-term process conducted mutually with customers after the cards are deployed at scale. We will handle low-level hardware alignment, while customers focus on adapting their models.

**Q: What are the delivery schedules for the 920C and 950 chips for the remainder of the year?**
A: The delivery timelines are as follows:
1.  **920C:** 150,000 cards were delivered in Q1. Deliveries will continue through Q2 and Q3, with the pace tied to the bidding schedules of government and enterprise clients. Major tech companies are largely finished with 920C orders and are awaiting the 950.
2.  **950:** Deliveries will ramp up through Q2 and stabilize in the second half of the year.
    *   **April:** 20,000 to 30,000 units.
    *   **May:** 50,000 to 60,000 units.
    *   **June:** 70,000 to 80,000 units.
    *   **H2 2024:** Starting at around 80,000 units per month, with a conservative estimate of reaching 95,000 per month after new capacity comes online.

**Q: What are the primary bottlenecks in the back-end supply chain (packaging, testing, HBM), and how do they impact this year's shipment forecast?**
A: The main bottlenecks are HBM and packaging.
1.  **Packaging:** Capacity is tight but can support about 1.2 million units this year, making it a smaller bottleneck.
2.  **HBM:** Supply is very tight and less stable, representing the biggest uncertainty. Our existing inventory (mostly HBM2E) provides a safety net, but we need to procure HBM3 from suppliers like Samsung and SK Hynix and are looking towards domestic supply chains as a long-term solution.
3.  **Impact on Forecast:** Factoring in the HBM constraint, the neutral shipment forecast for the year drops from 1.2 million to around 1.1 million units.

**Q: How are you managing the HBM supply issue, particularly the transition from HBM2E to HBM3 for the 950 chip, and what is the customer response?**
A: The situation is managed as follows:
1.  **Supply Strategy:** The initial batches of the 950 chip will use our existing inventory of HBM2E, with a gradual transition to HBM3 as supply becomes available. We are hopeful about using domestic HBM in the future, which is ready for mass production but still has a performance gap compared to overseas products.
2.  **Customer Acceptance:**
    *   **Major Tech Companies (CSPs):** They strongly insist on using overseas HBM. However, for urgent deliveries, they are willing to accept the HBM2E configuration if we inform them in advance and adjust the price accordingly.
    *   **Telecom Operators & Supercomputing Centers:** These clients are less sensitive to the specific HBM configuration.

**Q: Who are your main domestic packaging and testing vendors, and what is your allocation strategy?**
A: Vendor details and strategy are as follows:
1.  **Packaging:**
    *   **Current Vendors & Allocation:** We primarily use Shenghe (handling ~60% of our volume, using ~4,400 of their 6,000+ wafer/month capacity), TFME (~1,500 wafers/month), and Quliang (~1,000+ wafers/month). Shenghe's yield is currently the best.
    *   **Future Strategy:** We plan to shift more business to Quliang, a company we are actively supporting. Our goal is to help them improve their CoWoS yield rate to ~70%. The future allocation is estimated to be Shenghe at 45%, Quliang at 40-45%, and the rest to TFME.
2.  **Testing:**
    *   **Current Vendors & Allocation:** Wice is our main partner, handling about 70% of our volume. JCET accounts for over 10%, with TFME also having a share.
    *   **Equipment:** We are using less new Advantest equipment due to restrictions and are relying more on domestic equipment from Changchuan and Huafeng (8600 model). Currently, testing is not a significant bottleneck.

**Q: What are the recent changes and expected future shares for server component suppliers like connectors and optical modules?**
A: The supplier landscape is evolving:
1.  **Connectors:**
    *   **New Supplier:** AVIC Jonhon has entered our supply chain.
    *   **Expected 2024 Share:** Huafeng (50%), Luxshare (Jinghong) (30%), and AVIC Jonhon (20%). AVIC Jonhon's entry will reduce Huafeng's share.
2.  **Optical Modules:**
    *   **Supplier Shares:** HGTECH and Accelink remain the largest, with a combined share of about 65%. Innolight is third with about 20%. The remaining 15% is split between Source Photonics and our internal supply.
    *   **800G Modules:** The main suppliers for 800G optical modules are HGTECH and Innolight.

**Q: What is the current status of the supernode (large-scale cluster), including customer adoption, performance, and primary use cases?**
A: The supernode is still in early adoption with several challenges:
1.  **Adoption Rate:** The adoption rate this year is only around 20% to 30%. Acceptance is low due to high costs and technical stability concerns.
2.  **Performance:** Our 384-card supernode currently requires a system reboot approximately every 15 days, which is not well-accepted by customers.
3.  **Customer Strategy:** Many customers, like ByteDance, are developing their own large-scale cluster solutions to manage costs, despite potential performance gaps compared to our technology.
4.  **Use Cases:** The two main application categories are:
    *   **Reinforcement Learning:** Used for post-training tasks like model distillation for custom models.
    *   **Complex Inference:** Evolved for multi-modal and Agent-based inference, which demand high cluster capability and memory bandwidth.

**Q: In which application scenarios do Ascend chips excel, where do they struggle, and what is the plan for improvement?**
A: Performance varies by scenario:
1.  **Strengths:** We perform best in common scenarios like recommendation algorithms and Agent models that do not involve multi-modality (e.g., task distribution, office automation).
2.  **Weaknesses:** We have significant difficulty with multi-modal tasks, particularly text-to-image and text-to-video generation. Both our 950 and Cambricon's 690 currently perform poorly in these scenarios.
3.  **Reason for Weakness:** The issue is primarily software-related, including compatibility issues and architectural instability when running resource-intensive multi-modal models. The hardware itself is relatively mature.
4.  **Improvement Plan:** We are actively working on software optimization, including expanding operator library coverage and optimizing low-level calls. We expect this will take about three to five months, and we believe our pace will be faster than Cambricon's, as our 950 is already in mass production.

**Q: Why are second-tier chip manufacturers like Iluvatar and Muxi gaining traction, and what are their main challenges?**
A: Their rise is driven by several factors:
1.  **Market Environment:** The severe supply-demand imbalance in the domestic market creates opportunities for all suppliers.
2.  **Advantages:**
    *   **Focused Adaptation:** They can dedicate significant resources to adapting their chips for specific benchmark models at key clients. For example, Iluvatar has worked for nearly half a year to optimize for text-to-image models at ByteDance and has secured orders.
    *   **Lower Cost & Agility:** They have lower cost considerations for adaptation and are eager to establish benchmark cases, allowing them to focus heavily on major clients like ByteDance.
3.  **Challenges:** They face the same major bottlenecks as larger players:
    *   **Production Capacity:** They rely heavily on overseas foundries (Samsung, TSMC) through various channels, and their capacity is very limited (e.g., Iluvatar gets less than 400 wafers/month).
    *   **HBM:** They use high-end HBM3, and while their smaller volumes make the bottleneck less severe, they still face procurement constraints.
    *   **Packaging:** They must use domestic vendors like TFME or JCET, as finished chips cannot be imported.

# 原文提炼

**speaker1:** Okay, let's begin. I remember we spoke around March, and I'd like to get an update from you today. First, regarding the demand side, what is the current state of demand from large tech companies, small to medium-sized internet firms, and telecom operators?

**speaker1:** And have there been any significant changes on the demand side since March?

**speaker2:** Yes, certainly. Since mid-March, we've seen the major tech companies continuously increasing their orders. For instance, ByteDance's total order has now grown to nearly 300,000 cards.

**speaker2:** Tencent's order has also increased from 50,000 cards at the beginning of the year, to nearly 100,000, and is now at a level of about 130,000 to 140,000 cards. It's clear that the demand from these large companies is very strong.

**speaker2:** Due to the card shortage, Tencent is requesting immediate stock and has accepted a batch of 920C cards to supplement their computing power.

**speaker2:** So, you can see that the procurement from major tech companies is currently quite aggressive.

**speaker1:** Okay. So, compared to before, Tencent has significantly increased its orders, correct?

**speaker2:** Yes, that's right.

**speaker1:** Okay. But I recall our previous orders were already quite large. For an increase like Tencent's, do we have extra cards to allocate to them, or what is the current situation?

**speaker2:** The situation is twofold. On one hand, we are using some 920C cards as a supplement. On the other hand, for our 950 chip, we are also looking for new supplementary fabrication capacity. This will allow us to increase our total order volume by tens of thousands of units.

**speaker1:** Increase by tens of thousands of units.

**speaker2:** That's right.

**speaker1:** Okay.

**speaker1:** So, for this year so far, the main deliveries are still the 920C, correct?

**speaker2:** Yes, that's correct.

**speaker1:** Okay.

**speaker1:** I recall from our last conversation that the delivery forecast for the 920C this year was around 300,000-plus units. What's the current delivery estimate?

**speaker2:** The volume for the 920C remains at the previous level, about 350,000 units.

**speaker2:** For the 950, we project we can reach about 850,000 units.

**speaker1:** 850,000 units.

**speaker1:** Okay.

**speaker1:** Could you break down the customer allocation for these two types of chips? With Tencent's increased volume, how are we meeting their new demand? Are we finding new production capacity for them, or are we reallocating orders from other customers?

**speaker2:** Let's first talk about how we are meeting Tencent's demand.

**speaker2:** Firstly, we are actively adjusting production capacity in the south [referring to SMIC].

**speaker2:** As you may know, our mobile phone SoCs also use the N+2 process capacity.

**speaker2:** We are now planning to shift the fabrication of our mobile SoCs to our own internal facilities.

**speaker2:** This will free up some of the N+2 capacity in the south, which we can then use for our large AI processors to meet some of the demand.

**speaker2:** That's the most critical part.

**speaker2:** Besides swapping out the SoC production, we are also pursuing fabrication options overseas, particularly with Samsung. We are making progress on that front.

**speaker2:** These are the two main channels that can contribute production capacity for Tencent.

**speaker1:** I see. So the figures you mentioned—350,000 for the 920C and 850,000 for the 950—already account for the capacity freed up by the SoC shift at the southern fab and the overseas fabrication, correct?

**speaker2:** Yes, that's correct. These figures already include that newly added capacity.

**speaker1:** How much capacity can we secure from overseas?

**speaker2:** Overseas, we are primarily trying to go through Samsung. I estimate the capacity would be around 1,000 wafers per month.

**speaker1:** 1,000 wafers a month. What does that mean in practical terms? Is that a potential average of 1,000 wafers every month?

**speaker2:** Yes, we are aiming to achieve an average of 1,000 wafers per month.

**speaker1:** Okay, and what process technology would this be?

**speaker2:** At Samsung, we are using... well, overall, it should be the 6nm process.

**speaker1:** Okay. So, if we use this overseas capacity to produce the 950, can I assume its performance would be better than the domestically produced 950?

**speaker2:** Yes, the performance would be a bit better.

**speaker1:** A bit better, okay. When did this 1,000-wafer overseas capacity become available? How stable is it, and is it primarily for producing the 950?

**speaker2:** The overseas production line is not fully operational yet. We expect it to be fully running by the end of Q2. Therefore, the additional orders we can fulfill for Tencent will likely only be available from the end of Q2, which is a key piece of information. As for the stability of the capacity, we believe it is quite reliable. Firstly, besides us, other domestic companies like Hygon and Kexin are also securing sustained and relatively stable capacity there. So, looking at the overall situation, we are confident we can maintain a stable output of 1,000 wafers per month from Samsung.

**speaker1:** This 1,000 wafers per month would start from the end of Q2 until the end of the year, correct?

**speaker2:** Yes, from the end of Q2 to the end of the year.

**speaker1:** Okay, and this is all for producing the 950 chip, specifically the 950 PR?

**speaker2:** Yes, for the 950 PR. The GT version will also be produced there. However, since the GT version will be ready later, we will first validate it at the southern fab. Once that process is complete and the overall design is finalized, we will allocate a portion of the GT production to Samsung as well.

**speaker1:** I see, so a portion of the GT production will also be allocated to Samsung.

**speaker1:** Okay.

**speaker1:** And domestically, the capacity is still 7,000 wafers per month, correct?

**speaker2:** Yes, that's still the figure for now.

**speaker1:** Okay.

**speaker1:** 7,000 wafers.

**speaker1:** Regarding this year, I remember you mentioned last time that the domestic capacity would increase in late Q3 or Q4.

**speaker1:** Could you update me on the pace of this increase and the yield rate situation? Have there been any changes?

**speaker2:** Yes, the expansion is progressing faster than previously planned.

**speaker2:** Originally, we expected the new capacity in the south to come online at the end of Q3.

**speaker2:** Now, it looks like we will get new capacity there by the beginning of Q3, around late June or early July.

**speaker2:** However, the volume we get might be adjusted.

**speaker2:** Previously, we expected to get the largest share. Now, of the newly expanded 5,000 wafers, we might only get a little less than 2,000.

**speaker1:** Oh, so who might be getting a larger share? Cambricon?

**speaker2:** Yes, Cambricon will get more, mainly because they have been lobbying for it.

**speaker1:** How much can Cambricon get? Can they get 2,500?

**speaker2:** Not that much. They'll likely get between 1,000 and 2,000.

**speaker2:** In terms of proportion, our share has decreased from at least half to now less than half.

**speaker2:** However, in terms of absolute volume, our share is still likely the largest.

**speaker1:** Okay.

**speaker1:** If Cambricon gets less than 2,000, what about the rest? Does it all go to Hygon, or will others get some as well?

**speaker2:** Hygon will get some. Others will probably have to wait until Q4 as per the original plan.

**speaker1:** Okay.

**speaker1:** Has there been any change in the yield rate? What are the expectations?

**speaker2:** The improvement in yield rate is still quite slow.

**speaker2:** Compared to last month, the overall yield has improved by less than one percentage point.

**speaker2:** The overall goal is to achieve another five-point increase by the end of this year.

**speaker2:** But I feel that will be quite difficult.

**speaker1:** Okay.

**speaker1:** Are you still producing the 920C, or has production already fully shifted to the 950?

**speaker2:** Production of the 920C has stopped. If there are some additional orders from customers later, we might produce a small supplementary batch. But overall, production of the 920C will completely cease this year.

**speaker1:** So the 350,000 units of 920C for this year is a firm number, but the customer allocation might change later?

**speaker2:** Yes, that's correct.

**speaker1:** How is the 350,000 units of the 920C allocated?

**speaker2:** As mentioned, Tencent will get about 30,000 to 40,000 cards. ByteDance will probably get between 20,000 and 30,000. The rest will go to telecom operators and local government projects.

**speaker1:** Okay.

**speaker1:** Operators and local governments.

**speaker1:** What about the 950, specifically the 950 PR?

**speaker2:** For the 950, the current plan for the PR version is that a large portion goes to customers. I estimate our internal use will be around 250,000 units of the 950 PR. Tencent will likely get around 110,000 units. Alibaba will almost exclusively take the PR version, which should be around 120,000 to 130,000 units. That's the current allocation model for the top-tier companies.

**speaker1:** If the volume for the 950 is adjusted later, what factors might cause that? Could it be affected by the results of ongoing tests?

**speaker2:** That's unlikely. The testing phase is basically wrapping up for both first-tier and second-tier tech companies. We have already conducted comprehensive performance tests, including single-rack tests with 64 cards and multi-rack configurations. Based on what we've seen, everyone has a pretty clear understanding and confidence in the performance of the 950 card.

**speaker1:** What are the test results from the major and smaller internet companies? Do you have any comparison data between the 950 PR and Cambricon's MLU-690? And what are the core applications for it going forward?

**speaker2:** Generally, the capabilities of the PR are quite well-recognized. We have completed validation with all our major customers, and everyone is...

**speaker2:** ...everyone has very clear metrics to confirm its performance. They are not going to delay or postpone validation due to any concerns.

**speaker1:** So, ByteDance, Tencent, and Alibaba have all completed their validation?

**speaker2:** Yes.

**speaker1:** Which chips are they comparing it against?

**speaker1:** And what do you mean when you say its "capabilities are recognized"?

**speaker2:** Many companies still want to compare it with the H100, which is also our target.

**speaker2:** However, in reality, there is still a significant performance gap with the H100. We can probably only compare it to the H20.

**speaker1:** Okay.

**speaker1:** Will there be continued debugging in the software domain? Is there still room for performance improvement?

**speaker2:** The debugging process will likely continue for some time. Based on our experience, there are a few points. First...

**speaker2:** ...especially with integration into the CUDA ecosystem and low-level CUDA optimizations, that process will likely take a long time.

**speaker2:** However, this will probably begin after all the cards are deployed on-site.

**speaker2:** Once there is a more large-scale validation or deployment, these debugging and optimization activities will gradually start. It's not something that would be done during the initial validation phase.

**speaker1:** Okay.

**speaker1:** So, subsequent debugging will happen after the cards are delivered in bulk to the customer sites.

**speaker2:** Yes, optimization happens after the cards arrive.

**speaker1:** Will this optimization be done primarily by the customers, or will we assist them?

**speaker2:** We will be involved. If customers were to do it themselves, it might not be...

**speaker2:** ...well, on one hand, they would be concerned about the investment cost. On the other hand, there would be uncontrollable factors, for example, their understanding of the underlying hardware layer during performance optimization.

**speaker2:** It wouldn't be as deep as ours. So, our hope is that customers will focus on adapting their models to our cards, while we actively align our cards with the model interfaces. It will be a mutual optimization effort.

**speaker1:** Okay.

**speaker1:** Mutual optimization.

**speaker1:** Okay.

**speaker1:** I'd like to confirm with you again: for the 920C, what is the delivery schedule for the 350,000 units this year? When do you expect the deliveries to be completed?

**speaker2:** We will actually start delivering the 950 in small quantities at the end of this month. We will probably deliver about 20,000 cards in April.

**speaker2:** Then in May, the delivery volume will be in the range of 50,000 to 60,000.

**speaker1:** You are talking about the 950, right?

**speaker2:** Yes, that's right.

**speaker1:** I'm sorry, I might have misheard. Were you asking about the 950?

**speaker1:** No, I was first asking about the 920C. When will the 350,000 units be fully delivered? Will it be done by April?

**speaker2:** You mean the 350,000 units of the 920C?

**speaker1:** Yes.

**speaker2:** Oh, no. In the first quarter, we only delivered 150,000 cards. Deliveries will continue through Q2 and Q3.

**speaker1:** What are the factors influencing the delivery pace of the 920C?

**speaker2:** It's mainly because the customers for the 920C in Q1 were primarily large tech companies.

**speaker2:** In Q2 and Q3, customers from telecom operators will emerge.

**speaker2:** So, the pace is closely tied to the bidding schedules of government and enterprise clients.

**speaker1:** I see. So, for example, if Tencent needs cards urgently, is it possible for us to reallocate some of the 920C cards originally intended for operators or government clients to Tencent?

**speaker2:** It's possible, but my feeling is that Tencent isn't that enthusiastic about the 920C anymore.

**speaker2:** They'll probably take a few tens of thousands of cards, and that will be it. Once they receive around 50,000 to 60,000 units, they likely won't ask for more.

**speaker1:** Okay. So overall, the major tech companies are done with their 920C orders and are now waiting for the 950.

**speaker2:** Yes, that's right.

**speaker1:** Okay. And for the 950, you said how many units for April?

**speaker2:** About 20,000 to 30,000 units.

**speaker1:** Okay, and 50,000 to 60,000 in May.

**speaker2:** Yes, that's correct.

**speaker1:** And what about after that? How many can you reach in June?

**speaker2:** In June, I estimate the monthly volume could reach 70,000 to 80,000.

**speaker2:** After that, the regular monthly volume should stabilize at around 80,000 units.

**speaker1:** But at a rate of 80,000 per month, it doesn't seem like you can deliver over 800,000 for the full year.

**speaker1:** If you deliver 80,000 per month in the second half of the year, that's less than 500,000.

**speaker1:** Adding the 20,000-30,000 from April and 50,000-60,000 from May, the total seems to be around 600,000-plus.

**speaker1:** Hello? Can you hear me?

**speaker2:** Oh, sorry, I think I accidentally muted myself.

**speaker2:** The 80,000 per month in the second half is a starting point. As I mentioned, we will be getting some new production capacity in Q3.

**speaker2:** So, 80,000 is what we can achieve with the current capacity. If we calculate 80,000 per month for the second half, that's about 500,000 units.

**speaker2:** Then there's April, May, and June. If we deliver 30,000 in April, 50,000 in May, and about 70,000 in June, that's another 150,000. So, we're looking at a total of around 650,000 units.

**speaker2:** Factoring in the additional capacity I mentioned, we should conservatively reach about 95,000 per month in the second half.

**speaker1:** Could you please walk me through the calculation? For example, with 7,000 wafers per month, how many dies can be produced per wafer, and how does that translate to the final 80,000-plus cards?

**speaker1:** And does this calculation include the overseas capacity?

**speaker2:** Yes. So, currently, we can get about 40 dies from a single wafer.

**speaker2:** This doesn't account for yield loss in the back-end process. After accounting for that, it's probably around 36 or 37 dies.

**speaker2:** That corresponds to about 18 of our 950 chips, right?

**speaker2:** So, if we calculate based on 18 chips per wafer, and an average of 7,000 wafers per month, that would be... I calculated it before, it should be about 125,000 per month.

**speaker2:** If we calculate based on, say, 10 months of production for the year...

**speaker2:** ...that would give us a volume of about 1.25 million units.

**speaker2:** That's from 7,000 wafers per month.

**speaker2:** But this is already a discounted figure because we only calculated for 10 months.

**speaker2:** In reality, the production run is longer, but this doesn't factor in utilization rate fluctuations.

**speaker2:** If we account for fluctuations in the fab utilization rate, I estimate we can still reliably produce around 1.2 million units.

**speaker1:** But I assume this doesn't yet include the capacity from Samsung overseas, right?

**speaker2:** Correct. If we add another 1,000 wafers from Samsung...

**speaker2:** ...let's assume one of their wafers can yield 55 dies.

**speaker2:** After back-end yield loss, that's maybe 50 dies.

**speaker2:** So, one wafer yields 25 complete 950 chips.

**speaker2:** With 1,000 wafers a month, that's 25,000 chips per month. If we start production in July, for the rest of the year...

**speaker2:** ...that would be another hundred thousand-plus chips.

**speaker1:** Okay, a hundred thousand-plus. So adding it all up, it seems that optimistically, you could reach 1.4 to 1.5 million units this year.

**speaker2:** Yes, that's the total potential capacity. But in reality...

**speaker2:** ...first, as I mentioned, there will be fluctuations in capacity.

**speaker2:** And also, some capacity, like Samsung's, might have stability issues.

**speaker2:** We feel it's somewhat guaranteed now, but we can't be 100% certain.

**speaker1:** I see.

**speaker1:** Okay.

**speaker1:** Currently, from the moment a wafer leaves the foundry, goes through packaging and testing, and considering constraints like HBM, what is the total lead time until final delivery?

**speaker2:** From tape-out at the foundry...

**speaker2:** ...to the final product delivery, right?

**speaker1:** Yes, the entire back-end process takes about one and a half months under the current tight schedule.

**speaker1:** Okay, I understand.

**speaker1:** So, conservatively, the production from November or December of this year might only be delivered in 2025, right?

**speaker2:** Yes, that's correct.

**speaker1:** Okay.

**speaker1:** Understood.

**speaker1:** Looking at the back-end supply chain—packaging, testing, HBM—will these areas impact shipments currently or in the second half of the year? What are the main uncertainties right now?

**speaker2:** For the back-end, packaging capacity is quite tight.

**speaker2:** Considering our back-end suppliers and their expansion plans...

**speaker2:** ...we are fairly confident we can secure capacity for about 1.2 million units.

**speaker2:** It's hard to be confident about anything beyond that.

**speaker2:** As for HBM, we have some existing inventory from the past.

**speaker2:** This can serve as a supplement.

**speaker2:** However, the supply is still very tight, and we still need to procure HBM through various channels from suppliers like Samsung and SK Hynix.

**speaker2:** So, to summarize, both HBM and packaging are bottlenecks. The packaging bottleneck is slightly smaller, allowing us to ship 1.2 million units.

**speaker2:** But the HBM supply is less stable.

**speaker2:** Our current inventory provides a safety net.

**speaker2:** However, in the long run, we will need alternative solutions for HBM, such as domestic supply chains.

**speaker1:** Is the current HBM inventory mainly HBM2 series, or do you have some HBM3?

**speaker2:** It's mostly HBM2E, with a very small amount of HBM3.

**speaker1:** HBM2E. But I understand the 950 is intended to primarily use HBM3, right?

**speaker2:** Yes, the 950 will use a significant amount of HBM3.

**speaker1:** So, the initial batches of the 950 will be equipped with HBM2E?

**speaker2:** Yes.

**speaker1:** And later you will gradually transition to HBM3.

**speaker1:** What are the potential solutions for HBM3 supply currently? Is domestic production a viable option in the short to medium term?

**speaker2:** In the short term, we believe there are still some challenges.

**speaker2:** This is mainly related to performance; compared to overseas products, there are still some shortcomings.

**speaker2:** However, the validation of domestic HBM has reached a fairly good stage, and it is ready for mass production.

**speaker2:** It's just that there's still a performance gap compared to overseas suppliers.

**speaker2:** But it is usable.

**speaker1:** How do customers, especially top internet companies like ByteDance and Tencent, feel about using cards with HBM2E or potentially domestic HBM3?

**speaker2:** The major tech companies strongly insist that we use overseas HBM.

**speaker2:** However, clients like telecom operators and local supercomputing centers are not as sensitive about this.

**speaker1:** Oh, they don't care as much about these configuration details.

**speaker1:** But the initial deliveries of the 950 are primarily for the major CSPs, aren't they?

**speaker2:** Yes, that's correct.

**speaker2:** For the major tech companies, we can meet their needs with our small inventory.

**speaker2:** For some really urgent deliveries, we will use HBM2E, but we will inform them of this configuration change in advance. The customers will then re-evaluate the price based on our configuration.

**speaker1:** Okay, so they are willing to accept it.

**speaker1:** So they can accept this configuration as long as the price is relatively lower, right?

**speaker2:** Yes, that's right.

**speaker1:** Given the HBM bottleneck, which might affect this year's deliveries... you mentioned the packaging capacity is for 1.2 million units. If we factor in the HBM constraint, what would be a neutral forecast for this year's deliveries?

**speaker2:** Factoring in HBM, the number would probably drop to around 1.1 million. So HBM represents a shortfall of about 100,000-plus units.

**speaker1:** Okay.

**speaker1:** And for HBM, you are hoping to fill the gap with domestic suppliers, correct?

**speaker2:** Yes, we are more hopeful about domestic options.

**speaker1:** Okay, I understand.

**speaker1:** To confirm about packaging, which domestic vendors do you rely on? For example, for Shenghe Jingwei, what is their individual CoWoS capacity, and what share of that can be allocated to us?

**speaker2:** In China, we mainly use Shenghe, TFME, and Quliang. We account for the largest share of Shenghe Jingwei's capacity; I believe we take up over 80% of their total capacity.

**speaker2:** So, we have a relatively large capacity allocation there.

**speaker1:** We take up 80% of Shenghe's capacity?

**speaker2:** Yes, we are the main client.

**speaker1:** So, what percentage of our total shipments does Shenghe handle?

**speaker2:** You mean what percentage of our shipments Shenghe accounts for? I didn't quite catch that.

**speaker1:** Yes, you said Ascend chips take up over 80% of Shenghe's capacity. How much of Ascend's total output does that represent?

**speaker2:** You're asking about Shenghe's share of our total volume, right?

**speaker1:** Correct.

**speaker2:** Shenghe's share is around... probably a bit less than 70%, maybe around 60%.

**speaker1:** A bit less than 70%.

**speaker1:** Okay.

**speaker1:** Do you have information on their specific CoWoS capacity?

**speaker2:** Their total capacity should be over 6,000 wafers per month.

**speaker2:** And we are using nearly 4,400 of that.

**speaker1:** 4,400.

**speaker1:** This is for Shenghe?

**speaker2:** Yes, Shenghe.

**speaker1:** Okay, what about TFME and Quliang?

**speaker2:** We don't know TFME's total capacity, but we use about 1,500 wafers from them.

**speaker2:** Quliang's total capacity is close to 4,000, but their yield rate is currently lower.

**speaker2:** So our usage of their capacity is not very high yet.

**speaker1:** 4,000.

**speaker1:** So Quliang is about 1,000, maybe a little more?

**speaker2:** Yes, about that.

**speaker1:** Okay, a little over 1,000.

**speaker1:** What is your allocation strategy going forward?

**speaker2:** We plan to shift more business to Quliang.

**speaker2:** Since Quliang is a company we are actively supporting, we will give them a larger share in the future.

**speaker1:** Regarding Quliang's ability to take on more, do you expect a significant improvement in their yield rate?

**speaker2:** Yes, we expect so. In the future, everyone will be moving towards CoWoS.

**speaker2:** We believe Quliang's yield rate for CoWoS can reach a relatively good state, perhaps around 70%.

**speaker1:** Will Quliang's CoWoS be better than Shenghe Jingwei's and TFME's?

**speaker2:** Well, right now it's definitely not as good. We have a plan to see if we can use our capabilities to assist them in improving their yield rate.

**speaker2:** Currently, our yield rate, or rather Shenghe's, is the best.

**speaker1:** Okay. So if you help them, what is the expected future allocation of packaging business?

**speaker2:** You're asking how the capacity would be distributed if we get involved, right?

**speaker1:** Yes, for example, after you help Quliang improve its capacity, what would the packaging vendor allocation look like?

**speaker1:** Just your personal estimate.

**speaker2:** I estimate Shenghe's share will drop significantly, but will still be around 45%.

**speaker2:** Quliang would also be in the 40% to 45% range, and the rest would go to TFME. That's the likely proportion.

**speaker1:** So Quliang could increase that much.

**speaker2:** Yes.

**speaker1:** What about testing? What is the situation there?

**speaker2:** For testing, the majority is still handled by Wice. Wice probably accounts for about 70% of our total volume; they are still the main partner.

**speaker2:** Then, JCET might account for over 10%, and TFME also has some share. That's the general picture.

**speaker1:** So Wice is the main one.

**speaker1:** Do you foresee any bottlenecks in testing in the future?

**speaker2:** Testing seems fine for now. But one thing to note is that everyone is shifting towards domestic testing equipment. However, domestic equipment is still a bit weaker in terms of testing time and efficiency. That's one point to consider.

**speaker1:** For instance, this year, there were rumors that Huawei can't use Advantest equipment. Is that true? Are we limited to using Changchuan's equipment for testing?

**speaker2:** Yes, we are using less Advantest equipment now, but we are still using the machines we've already purchased.

**speaker2:** However, purchasing new equipment from them might face some restrictions.

**speaker2:** Besides Changchuan's equipment, we are also using equipment from Huafeng.

**speaker1:** Is that the Huafeng 8600?

**speaker2:** Yes, the 8600.

**speaker1:** But isn't that still in the pilot stage?

**speaker2:** Yes, it hasn't been deployed at scale yet.

**speaker2:** Small-batch validation has been done.

**speaker2:** For SoCs and memory, I think it's already being used at scale.

**speaker2:** But not yet for large AI chips.

**speaker1:** I have a hypothetical question. If Wice uses an Advantest 93K to test Ascend chips, would that be a problem?

**speaker2:** We have evaluated it. The performance of the 93K meets our requirements. However, there are two key issues. First, the number of units it can test simultaneously is relatively small.

**speaker2:** Second, the testing time is relatively long.

**speaker1:** Okay, so we are mainly relying on Changchuan's equipment for testing now.

**speaker2:** Yes.

**speaker1:** Okay, and currently, Changchuan's equipment has not created a significant bottleneck in the testing area?

**speaker2:** Correct. Both its performance and capacity are okay from our perspective.

**speaker1:** Okay.

**speaker1:** Understood.

**speaker1:** Looking further ahead, will we continue to rely on Wice for testing?

**speaker2:** Yes, they will likely remain our key partner and handle the largest share. We will continue to cooperate with them.

**speaker1:** Okay.

**speaker1:** Understood.

**speaker1:** So, we've covered packaging, testing, and HBM.

**speaker1:** It seems that overall, the main bottleneck and biggest uncertainty lies with HBM, especially HBM3, right?

**speaker2:** Yes, that's correct.

**speaker1:** Okay.

**speaker1:** Understood.

**speaker1:** Regarding the server components, like connectors and optical modules, do you see any potential changes there?

**speaker2:** For connectors, we have a new supplier coming in.

**speaker2:** However, their share has not been finalized yet. We expect to determine the specific allocation next month.

**speaker2:** The new supplier is AVIC Jonhon; they have entered our connector supply chain.

**speaker1:** AVIC Jonhon, okay.

**speaker2:** Yes.

**speaker1:** When they come in next month, whose share will they take?

**speaker1:** Will they take share from Huafeng Tech?

**speaker2:** Yes, Huafeng's share will decrease, but the largest share will still go to Luxshare (Jinghong).

**speaker1:** Taking share from Huafeng.

**speaker1:** Okay.

**speaker1:** For the future, what is the expected market share for, say, 24G connectors?

**speaker1:** In the medium term.

**speaker2:** For this year, it will probably be Huafeng at 50%, Luxshare (Jinghong) at 30%, and AVIC Jonhon at 20%. That's the likely ratio.

**speaker1:** Okay, Huafeng 50%, Luxshare 30%.

**speaker1:** Understood.

**speaker1:** What about optical modules?

**speaker2:** There are fewer changes in optical modules. HGTECH and Accelink still hold the largest shares.

**speaker2:** Innolight has also entered the picture now and probably has the third-largest share.

**speaker2:** Then there's Source Photonics, and our own supply.

**speaker1:** For these suppliers you mentioned, what are the expected shares? How much will Innolight take, and whose share will be affected?

**speaker2:** HGTECH and Accelink together will have about 65%, with one at 30% and the other at 35%.

**speaker2:** Innolight will have about 20%. So these three together make up about 85%.

**speaker2:** The rest is split about evenly between us and Source Photonics.

**speaker1:** Okay.

**speaker1:** Understood. This is the current expected share distribution, right?

**speaker2:** Yes, that's correct.

**speaker1:** Okay. For 800G optical modules, are there any main, dominant suppliers?

**speaker2:** For 800G, it's mainly HGTECH and Innolight.

**speaker1:** Okay, HGTECH and Innolight are the main two?

**speaker2:** Yes.

**speaker1:** Okay.

**speaker1:** Understood.

**speaker1:** What is the current status of the supernode (large-scale cluster)? What is the adoption rate among domestic CSPs?

**speaker2:** For the supernode, our plans are still... well, we are still continuously in discussions with clients.

**speaker2:** But looking at this year, the adoption rate for supernodes is still around 20% to 30%.

**speaker2:** Customers' acceptance of the supernode is still not very high. On one hand, the price is still very expensive. On the other hand, there are still technical stability concerns. When you're dealing with a cluster of over 8,000 or even 1,000 cards, customers are very concerned about the downtime cycle. So right now, many customers are developing their own solutions while waiting for the technology to stabilize and for costs to come down further. So this year, the adoption rate is probably just 20%, but next year, the volume and proportion of supernodes could increase very quickly.

**speaker1:** When you say customers are developing their own solutions, do you mean they are developing their own large-scale clusters?

**speaker2:** Yes.

**speaker2:** For example, ByteDance has plans to develop its own supernode.

**speaker1:** But in the field of communications, can the large tech companies do better than Huawei?

**speaker2:** In terms of communication technology, they are definitely weaker than us, but they have a cost advantage. By building it themselves, they can manage their suppliers and lower the costs.

**speaker1:** But I would think they would prioritize performance more, such as high availability and low downtime. If they build it themselves, would their downtime rate be better than Huawei's supernode?

**speaker2:** The supernode technology has very high requirements for communication. Many of these large companies don't have much experience in this area, so they have to rely entirely on suppliers. So, overall, if they build it themselves, their performance might get close to ours, but there will still be a gap. They will, however, have a cost advantage over us. That's the situation.

**speaker1:** What is the current downtime rate for Huawei's Ascend supernode, and what is the customer's tolerance for such downtime?

**speaker2:** For our 384-card supernode, we currently need to reboot the system about every 15 days.

**speaker1:** Every 15 days.

**speaker2:** Yes.

**speaker1:** Is this level of uptime acceptable to customers?

**speaker2:** Honestly, the acceptance level is not that great.

**speaker1:** Okay.

**speaker1:** What kind of tasks are customers primarily using our supernode for?

**speaker2:** In terms of scenarios, I see two main categories. The first is reinforcement learning, for post-training tasks.

**speaker2:** Many custom models from domestic companies are using it. For example, some top-tier companies are using our supernode for tasks like model distillation and reinforcement learning.

**speaker2:** The other category is inference, but this has evolved into more complex tasks like multi-modal and Agent-based inference. These tasks have higher demands on the cluster's capabilities, as well as on memory bandwidth and capacity.

**speaker1:** I see.

**speaker1:** For this inference, is it only for specific scenarios, or are there things it currently can't do? What's the status?

**speaker2:** Yes, we can only handle specific models.

**speaker2:** We have to perform targeted optimizations for these models. If we don't, we will run into issues from a usability standpoint.

**speaker1:** I see.

**speaker1:** So for the 920C and the upcoming 950, which scenarios, especially in inference, are they well-suited for, and which ones still require a lot of adaptation work?

**speaker2:** The common scenarios, including recommendation algorithms, are where we perform best.

**speaker2:** However, we have a lot of difficulty with text-to-image and text-to-video generation.

**speaker2:** But for Agent models, as long as they don't involve multi-modal capabilities—for tasks like task distribution or office automation—we perform quite well. Our weakness is in anything related to multi-modality.

**speaker1:** I see.

**speaker1:** Is this weakness due to hardware limitations or software issues?

**speaker2:** It's mainly a software-level problem. There are some hardware issues as well, but the main cause is software. On the hardware side, we are quite mature, and we have made several optimizations in areas like precision and on-chip design. But at the software level, we still have many compatibility issues with multi-modal models.

**speaker2:** When multi-modal models involve images or video, they consume a lot of underlying resources. Furthermore, our existing architecture's stability can be poor when running these models.

**speaker1:** Okay, so that means in the short to medium term, customers are unlikely to use Ascend chips, including the 950, for multi-modal inference tasks.

**speaker2:** Yes, multi-modal use cases will be rare.

**speaker1:** Okay. Are you aware of the testing situation for Cambricon's MLU-690 at CSP clients, especially at ByteDance?

**speaker2:** At ByteDance, we have also made some attempts at multi-modal validation and optimization, but the results were not good. So, our adaptation for this is still in progress and not yet complete.

**speaker1:** And do you know if the Cambricon MLU-690 might also be used for multi-modal inference?

**speaker2:** It seems their 690 is also not very well-suited for it. When it's deployed, it will likely require deep software-level optimization. Currently, both our 950 and Cambricon's 690 perform poorly in multi-modal scenarios.

**speaker1:** Okay.

**speaker1:** In that case, will companies like ByteDance continue to work with us on software optimization, or will they seek other hardware solutions for multi-modal inference?

**speaker2:** We will continue to work on optimizing this. We are quite confident because multi-modal models are constantly evolving. Our cards were designed a while ago, without specific consideration for these capabilities. But we will gradually add these capabilities later on.

**speaker1:** Okay. Do you have an estimate of how long it might take to add these capabilities?

**speaker2:** This will involve things like expanding the operator library coverage and optimizing low-level calls.

**speaker2:** Overall, it could take about three to five months.

**speaker1:** Okay, three to five months.

**speaker1:** So, at most, half a year.

**speaker1:** One to two quarters.

**speaker2:** Yes.

**speaker1:** Will Cambricon's 690 have a similar optimization timeline, or could they be faster?

**speaker2:** I think we will be faster. We are already working on this for our 950. The 690, I believe, has not even started mass production yet. So, I think our pace will be faster.

**speaker1:** Is that mainly because your 950's mass production schedule is faster?

**speaker2:** Yes, that's right.

**speaker1:** I thought the Cambricon 690 was already in mass production.

**speaker2:** No, not yet.

**speaker2:** Based on shipment information, the 690 should be ready by the end of Q2.

**speaker1:** Shouldn't the 690 have been delivered by the end of Q2?

**speaker2:** Right, I mean delivery by the end of Q2. We are probably two months, or a bit more, ahead of them in terms of delivery.

**speaker1:** Okay.

**speaker1:** Regarding other third-party chip makers in China, recently we've been hearing more from companies like Iluvatar CoreX and Muxi.

**speaker1:** Is this because the domestic supply-demand situation has become extremely imbalanced, or is there another reason?

**speaker1:** How should we view the demand from major companies like ByteDance for these second-tier manufacturers? What are their main needs?

**speaker2:** I think the second-tier manufacturers have two advantages, but the overarching environment is indeed the severe supply-demand imbalance.

**speaker2:** The demand side is very aggressive right now, pushing hard on all metrics, whether it's delivery time or price.

**speaker2:** So, many manufacturers hope to seize this opportunity.

**speaker2:** Companies like Iluvatar and Muxi...

**speaker2:** Both of them are making some noise at ByteDance. I believe Iluvatar has done a lot of adaptation work, particularly for text-to-image models.

**speaker2:** Muxi is working on adapting to both text-to-image and common large language models.

**speaker2:** However, Iluvatar's performance on text-to-image models is reportedly more stable, and ByteDance has placed some orders with them.

**speaker2:** But it took Iluvatar nearly half a year of adaptation to reach this good state.

**speaker2:** Another good thing about these second-tier manufacturers is that their cost considerations for adaptation are not as heavy.

**speaker2:** They are also eager to create benchmark cases.

**speaker2:** So they are focusing heavily on ByteDance.

**speaker2:** They hope to optimize their benchmark models to be relatively stable.

**speaker2:** So their goals are different from ours.

**speaker1:** Okay.

**speaker1:** For second-tier manufacturers like Iluvatar and Muxi, are production capacity, packaging, and HBM also major challenges for them?

**speaker2:** Yes. First is production capacity.

**speaker2:** Iluvatar, I believe, has to rely on overseas foundries.

**speaker2:** They don't have much capacity in the south [SMIC].

**speaker2:** And the capacity from Hua Hong is not yet stable.

**speaker2:** So they still need to find overseas foundries through various channels.

**speaker2:** It's the same for Muxi. So both companies have capacity bottlenecks.

**speaker2:** As for HBM, their HBM configurations are very high-end, all using HBM3.

**speaker2:** But their volumes are relatively small, so the HBM bottleneck doesn't seem as severe, but they still face procurement constraints.

**speaker2:** For packaging, it's the same for everyone. They all have to do it in China.

**speaker2:** They can't package overseas because the finished product can't be imported.

**speaker2:** So they all use domestic vendors like TFME or JCET.

**speaker1:** Okay.

**speaker1:** A related question: it seems many companies are now seeking overseas capacity, especially from Samsung.

**speaker1:** With expectations of volume ramp-up in the second half of the year...

**speaker1:** Do you have any insight into Samsung's capacity allocation for Chinese companies?

**speaker1:** For CSPs and chip design firms...

**speaker1:** what is Samsung's general stance towards Chinese suppliers? And what are the future uncertainties regarding overseas supply?

**speaker2:** The overseas production capacity is strongly correlated with policy and US intervention.

**speaker2:** When policies are strict, capacity shrinks; when they loosen, it increases.

**speaker2:** However, everyone manages to get some capacity through various workarounds.

**speaker2:** But in terms of volume, each company gets very little.

**speaker2:** For example, we know Iluvatar's average capacity is probably less than 400 wafers per month.

**speaker1:** Okay.

**speaker1:** But it seems that CSPs like Alibaba, ByteDance, and Baidu (Kunlunxin) are expecting to get quite high capacity.

**speaker2:** Yes. Compared to second-tier manufacturers, they have a big advantage. First, there's the issue of compliance, which overseas manufacturers are very concerned about. Large companies like ByteDance can circumvent these issues through various means. Also, their order volumes are relatively stable, so Samsung is willing to allocate some capacity to them.

**speaker2:** But for companies like Muxi or Iluvatar, it's very difficult for them to negotiate directly with Samsung. They probably have to go through intermediary channel partners.

**speaker1:** Okay. How much overseas capacity does Cambricon have?

**speaker2:** In total, between TSMC and Samsung, they have about 1,000 to 1,200 wafers.

**speaker1:** That much?

**speaker2:** Yes, but there are some issues. At TSMC, they might only have 500 wafers. They have more at Samsung, but they seem to be having significant problems with getting the wafers back from Samsung. I believe they still haven't resolved this.

**speaker1:** Okay, so the TSMC capacity is the main source for now, but there are issues with getting wafers back from Samsung.

**speaker2:** Yes, that's right.

**speaker1:** Looking ahead six months, can the Samsung issue be resolved? And can the 500-wafer capacity at TSMC be sustained?

**speaker2:** I think the TSMC capacity should be fine in the short term. But the issue with Samsung seems to be related to their design, which may need to be revised.

**speaker1:** Okay.

**speaker1:** Alright.

**speaker1:** Understood.

**speaker1:** That's all the questions I have for today. I may need to digest some of this information, and if I have more questions, I'll schedule another call with you. Thank you very much for your time today.

**speaker2:** Alright. Thank you.

**speaker1:** Bye.

**speaker2:** Bye.