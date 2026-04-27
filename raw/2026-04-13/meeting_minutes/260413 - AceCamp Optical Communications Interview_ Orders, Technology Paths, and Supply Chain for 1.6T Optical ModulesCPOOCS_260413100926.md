# 260413 - AceCamp Optical Communications Interview: Orders, Technology Paths, and Supply Chain for 1.6T Optical ModulesCPOOCS

# AI总结

## 1.6T Optical Module Supply Chain and Forecast
- **Key Component Shortages and Impact on Forecast**
  - Core bottlenecks: The primary components in short supply for 1.6T modules are 200G EML chips and Faraday rotators.
  - EML supply status: Lumentum is currently the main global volume producer of 200G EMLs, with a projected capacity of 30-40 million units this year, which is only sufficient for about 5 million 1.6T modules. Other suppliers are just beginning to ramp up.
  - Broad industry scarcity: The entire optical communications supply chain is experiencing shortages, including optical fibers and internal glass components.
  - Forecast considerations: The industry forecast of 15 million 1.6T units for this year has already factored in these supply constraints. A significant increase beyond this number is unlikely without a massive new supply of EMLs.
- **Component Requirements and Shortages by Architecture**
  - EML-based FR modules: Face a triple shortage of EMLs, Faraday rotators, and filters. Consequently, production of DR modules is expected to outpace FR modules this year.
  - Silicon Photonics (SiPh) modules: Primarily constrained by the shortage of Faraday rotators. They do not use EMLs or filters.
  - CW Lasers: Not considered a bottleneck due to a diverse supplier base, including multiple domestic Chinese and international companies. There are approximately 12 potential suppliers in the market.

## EML vs. Silicon Photonics (SiPh) Architecture
- **Technology Adoption and Market Share in 1.6T**
  - Market split: For 1.6T modules, SiPh architecture is expected to account for 60-70% of the market, a significant increase from its ~40% share in the 800G generation. EML architecture will make up the remaining 30-40%.
  - Application scope: FR (long-reach) modules are currently all based on EML architecture.
- **Core Technical and Component Differences**
  - Laser source:
    - An EML-based 1.6T module uses eight individual EML chips.
    - A SiPh-based 1.6T module uses four 100mW CW laser sources.
  - Modulation:
    - SiPh uses a Photonic Integrated Circuit (PIC) for modulation.
    - EML architecture relies on modulation from the DSP or TIA.
- **Long-Term Technology Trends and Use Cases**
  - Coexistence, not replacement: EML architecture will not be fully replaced by SiPh.
  - EML's future role: It will remain the mainstream solution for longer-reach applications (500m to 2km) and for future higher speeds like 3.2T (requiring 400G per lane), as SiPh is limited by material properties to ~200G per lane.
  - SiPh's future role: Primarily for shorter-reach DR applications (30m to 500m). Future intra-rack applications will be dominated by SiPh-based technologies like NPO and CPO (optical engines).
  - Overcoming SiPh limits: To achieve speeds beyond 200G per lane, SiPh would require expensive heterogeneous integration with materials like thin-film lithium niobate (TFLN) or indium phosphide.

## Cost Structure and Competitive Landscape of 1.6T Modules
- **Cost Comparison: EML vs. SiPh**
  - Overall cost advantage: A 1.6T SiPh module has a Bill of Materials (BOM) cost that is $120-$130 lower than its EML counterpart, leading to a selling price that is over $100 cheaper (e.g., ~$1,000 for SiPh vs. ~$1,200 for EML).
  - Source of savings: The main cost difference comes from the laser source. Four CW lasers for a SiPh module cost ~$20 in total, whereas eight EML chips cost ~$160.
- **Cost Breakdown of a 1.6T EML DR Module**
  - BOM cost: Estimated to be around $550-$580.
    - 8 x 200G EML Chips: ~$160
    - 1.6T DSP: ~$160
    - PCBA: ~$60
    - TIA and other components: ~$60
    - PD Array (8 channels): ~$56
    - Passive Components (connectors, etc.): ~$30-$40
  - Selling price: Approximately $1,100 - $1,200, indicating a gross margin in the tens of percent.
  - Future cost trend: The BOM cost is expected to decrease by about $100 to ~$450 by 2028 due to volume scaling and price reductions in components like DSPs and EMLs.
- **Market Share and Competitive Dynamics**
  - 1.6T market share (this year):
    - InnoLight: ~50%
    - Eoptolink: ~25%
    - Coherent: ~22%
    - Lumentum: ~5%
    - *Note: This excludes Nvidia's internal supply through Mellanox.*
  - Future evolution: InnoLight's dominant share is expected to moderate to ~40% as tier-2 vendors enter the market, a typical pattern for new technology cycles. Coherent and Eoptolink are likely to maintain their respective shares.
- **CSP Procurement Model**
  - CSPs utilize a "binding" model for critical components. They negotiate and secure a volume of a scarce component (e.g., EMLs) from a supplier and then instruct their module vendors to purchase from that allocated supply for their orders.

## CPO, NPO, and the Evolving Value Chain
- **Market Opportunity and Application**
  - Purely incremental market: CPO/NPO for on-board (intra-rack) applications is considered a new market, as it replaces traditional copper interconnects which are unviable at 1.6T and higher speeds over required distances.
  - Limited replacement of pluggables: CPO is not expected to replace pluggable modules in inter-rack applications in the near term due to limited TCO benefits and low CSP enthusiasm for this use case.
- **Shift in the Value Chain**
  - Optical module vendors: Competitiveness may diminish as the critical PIC/EIC bonding process requires semiconductor foundry capabilities, which they lack. They will still see volume but with less pricing power.
  - Semiconductor foundries: Their role and power will increase as they control the core bonding technology.
- **External Light Source (ELS/PLS) Dynamics**
  - Key players: Coherent, Lumentum, InnoLight, Eoptolink, and TFC are the main competitors.
  - Strategic advantage: Coherent and Lumentum, as primary manufacturers of high-power CW lasers, have a significant advantage. They can prioritize their own ELS/PLS production, creating a supply bottleneck for competitors who rely on them for chips.
- **FAU Components for CPO**
  - Higher requirements: CPO applications demand FAUs with extremely high temperature resistance (for reflow soldering), greater complexity (including Prism Microlens Arrays), and significantly higher value ($150+ in mass production).
  - Supply chain impact: Current FAU makers for pluggable modules may become sub-component suppliers to firms like TFC and Coherent, who will perform the final complex assembly for CPO FAUs.

## Upstream Supply Chain: Strategy and Bottlenecks
- **Indium Phosphide (InP) Substrate Situation**
  - Scarcity dynamics: The current shortage and price hikes for InP are concentrated in North America. This is primarily driven by Chinese export controls and longer review periods for exporters like AXT, rather than a fundamental global production deficit. China is simultaneously expanding its domestic InP capacity.
  - Strategic motivation: This is seen as a strategic move by China to leverage its control over upstream materials to foster the growth and adoption of its domestic midstream component suppliers (e.g., EML chips), similar to the strategy used with rare earths and Faraday rotators.
- **Overall Supply Chain Bottlenecks**
  - Chain reaction: The entire EML supply chain is constrained. The shortage starts with insufficient upstream InP wafer supply to meet the massive increase in EML demand, and is compounded by a shortage of downstream manufacturing equipment like MOCVD machines. The expansion cycle for the entire chain is estimated at 18-20 months.

## Optical Circuit Switch (OCS) Technology and Market
- **Adoption Outlook and TCO Benefits**
  - Inevitable adoption: All major CSPs are expected to adopt OCS for building large AI clusters due to its significant TCO reduction and efficiency gains, which are considered more impactful than those from CPO.
  - Proven TCO reduction: Google's deployment demonstrated a 40% reduction in total TCO, 40-50% power savings, and 70% lower latency by replacing electrical switches at the Spine layer with OCS.
- **Market Demand and Growth**
  - Strong demand forecast:
    - Current Year: ~18,000 units for Google and ~2,000 for Microsoft.
    - Next Year: Forecasted demand of over 40,000 units, led by Google's request for 30,000 units.
  - Growth projection: A CAGR of 30-50% is considered realistic as initial deployments prove successful and expand.
- **Competitive Landscape and Technology Barriers**
  - Current duopoly: The market is dominated by Coherent and Lumentum.
  - Coherent's advantage: Coherent's solution is based on proprietary liquid crystal technology, which it produces in-house and is a major barrier to entry for competitors.
  - Challenger technologies: Other technologies like MEMS, waveguide, and piezoelectric are not yet competitive. MEMS solutions are at least 1.5 years from mass production, while others face critical issues with cost or performance (insertion loss).
  - Market outlook: Coherent and Lumentum are expected to control the market for at least the next 1.5 years.

# QA总结

**Q: What are the key component shortages for 1.6T optical modules, and how does this affect this year's production forecast?**
A: The main shortages and their impact are as follows:
1.  **Key Shortage Component:** The most scarce component is the 200G EML chip. Lumentum is currently the only major global supplier shipping in large quantities.
2.  **Production Volume Impact:** The limited EML supply significantly constrains 1.6T module production. This year's global 200G EML output is estimated to be 30-40 million units, which is only sufficient to produce about 5 million 1.6T modules.
3.  **Overall Supply Chain:** The entire optical communication supply chain is experiencing shortages, including optical fibers and internal glass components.
4.  **Forecast Consideration:** The market forecast of 15 million 1.6T modules for this year has already taken these component shortages into account. The production capacity for the year is largely fixed, and significant increases are unlikely without a major new supply of EMLs.

**Q: What are the main differences between EML and silicon photonics (SiPh) architectures for 1.6T modules, and how do component shortages affect their production?**
A: The differences and impacts are:
1.  **Core Architecture:**
    *   **SiPh:** Uses a Photonic Integrated Circuit (PIC) for modulation and outputs the signal through a standard MT ferrule. It typically uses four 100mW CW laser sources for a 1.6T module.
    *   **EML:** Modulation is handled by the DSP or TIA. It uses eight EML chips for a 1.6T module.
2.  **Module Type Applicability:**
    *   **DR Modules:** Can use either EML or SiPh architecture.
    *   **FR Modules:** Are currently all EML-based; there is no SiPh version. About 7 to 7.5 million of this year's 15 million forecast will be EML-based FR modules.
3.  **Impact of Shortages:**
    *   **EML-based FR Modules:** Face shortages of three key components: EMLs, Faraday rotators, and filters.
    *   **SiPh-based DR Modules:** Use Faraday rotators (which are in short supply) but do not require EMLs or filters, making them less constrained by those specific bottlenecks.
    *   **Production Mix:** Due to component availability, it is likely that more DR modules will be produced this year compared to FR modules.

**Q: What are the long-term adoption trends for silicon photonics versus EML architecture, particularly for future generations like 3.2T?**
A: The long-term trends are as follows:
1.  **Accelerating SiPh Adoption:** The adoption of silicon photonics is accelerating. Its share is expected to grow from ~40% in 800G modules to 60-70% in 1.6T modules.
2.  **EML's Continued Relevance:** EML will not be completely replaced and will remain crucial for specific applications.
    *   **Long-Haul Applications:** EML is superior for longer distances (500m to 2km), while SiPh is primarily used for shorter-reach DR applications (30m to 500m).
    *   **Higher Speeds (3.2T and beyond):** Future 3.2T inter-rack modules will likely use 400G per lane, which is beyond the capability of silicon photonics due to material limitations (current upper limit is 200G per lane). EML is expected to be the mainstream solution for these higher-speed applications. To achieve higher speeds, SiPh would require costly heterogeneous integration with materials like thin-film lithium niobate.
3.  **Application-Specific Architectures:**
    *   **Inter-rack:** EML will likely remain the dominant technology for high-speed (3.2T+) inter-rack connections.
    *   **Intra-rack:** SiPh-based solutions like NPO and CPO (optical engines) will emerge for short-distance, on-board applications.

**Q: What is the cost structure of a 1.6T optical module, and what are the key cost differences between EML and silicon photonics solutions?**
A: The cost structure and differences are:
1.  **Overall Cost Comparison:** The silicon photonics solution is significantly cheaper. A 1.6T DR SiPh module's Bill of Materials (BOM) cost is around $400+, while the EML version is about $100-200 more expensive, with a BOM cost of approximately $550-$580.
2.  **EML Module BOM Breakdown (~$550):**
    *   **EML Chips:** 8 units at ~$20 each = $160
    *   **DSP:** ~$160
    *   **PCBA:** ~$60
    *   **TIA & Driver:** ~$60
    *   **PD Array:** 8 units at ~$7 each = $56
    *   **Passive Components (FA, connectors, etc.):** ~$30-40
3.  **Selling Price:** The current selling price for an EML-based 1.6T DR module is $1,100-$1,200, while the SiPh version sells for around $1,000.
4.  **Primary Cost Driver:** The main cost difference comes from the laser source. The eight EML chips cost $160, whereas the four CW lasers in the SiPh version cost only $20, resulting in a $140 saving on the light source alone.
5.  **Future Cost Reduction:** By 2028, the BOM cost is expected to decrease by about $100 to around $450, driven by price drops in components like the DSP (to ~$120) and EMLs (to ~$10-15).

**Q: What is the competitive landscape and market share evolution for major optical module vendors from 800G to 1.6T?**
A: The market landscape is evolving as follows:
1.  **800G Market Share:** InnoLight (~40%), Coherent (~20%), Eoptolink (~20-25%), with the remainder held by other players.
2.  **1.6T Market Share (Current Year):**
    *   **InnoLight:** Holds the largest share at ~50%.
    *   **Eoptolink:** ~25%.
    *   **Coherent:** ~22%.
    *   **Lumentum:** ~5%.
    *   *Note: This does not include Nvidia's internal supply via Mellanox, which accounts for an additional 20% of the market.*
3.  **Future Market Share Trend (towards 2027-2028):** InnoLight's dominant share is expected to decrease to around 40% as more Tier-2 vendors enter the 1.6T market. Coherent and Eoptolink are expected to maintain their stable shares of 20-25%. This follows a typical pattern where an early leader (InnoLight had 70-90% share initially) sees its share moderate as the market matures.

**Q: How do Cloud Service Providers (CSPs) secure EML chip supply, and what is the status of Source Photonics' EML production?**
A: The procurement model and supplier status are:
1.  **CSP Procurement Model:** CSPs do not directly purchase EML chips. Instead, they engage in "supply binding." A CSP negotiates and secures a specific volume of chips from a supplier (e.g., Lumentum) and then directs its designated optical module vendors (e.g., InnoLight) to purchase from that secured allocation to build modules for them.
2.  **Source Photonics' EML Status:**
    *   **Reputation:** Their EML chips have a very good reputation in the industry.
    *   **Capacity Claims:** The claim of achieving 100 million units of capacity this year is likely their *end-of-year production capability* after expansion, not the total supply for 2024.
    *   **Market Impact:** The real market impact of their expanded capacity is expected next year.
    *   **Current Use:** They are currently using most of their EML output for their own optical modules. Mass external supply is not expected until Q4 at the earliest, as bringing new equipment online and qualifying for a major customer takes time.

**Q: What is the market opportunity for Co-Packaged Optics (CPO), and how will it change the value chain for optical module manufacturers?**
A: CPO presents both an opportunity and a shift in the value chain:
1.  **Market Opportunity:** CPO is considered a purely incremental market for optical component and module makers. It addresses on-board (intra-rack) connectivity, replacing traditional copper cables which are becoming impractical at speeds of 1.6T and beyond.
2.  **Value Chain Shift:** The rise of CPO will shift power dynamics in the industry.
    *   **Core Capability:** The critical manufacturing step for CPO optical engines is bonding the Photonic Integrated Circuit (PIC) with the Electronic Integrated Circuit (EIC). This is a semiconductor process that traditional module makers like InnoLight and Eoptolink do not possess and must outsource to foundries like TSMC or ASE.
    *   **Shift in Competitiveness:** As a result, the competitiveness of semiconductor vendors will increase, while the market power of traditional optical module vendors may diminish. Although it is new business for them, they will not hold the same monopolistic power as they do in pluggable modules.
    *   **External Light Source (ELS):** The ELS, a key CPO component, relies on high-power CW lasers. Here, suppliers with their own chip technology (Coherent, Lumentum) have a strategic advantage over those who must source chips externally.

**Q: What are the new requirements and competitive landscape for Fiber Array Units (FAUs) in CPO applications?**
A: The requirements and landscape for CPO FAUs are distinct from those for pluggable modules:
1.  **High Value and Complexity:** CPO FAUs are highly complex and expensive, costing $150-$160 in mass production and over $200 during sampling.
2.  **Significant Technical Barriers:**
    *   **High-Temperature Resistance:** The component must withstand the high temperatures of the CPO reflow process (500-600°C), requiring specialized coatings.
    *   **Complex Structure:** It is not a simple FAU but a complex assembly that includes a Prism Microlens Array and must be pluggable.
3.  **Evolving Competitive Landscape:** It will be difficult for current FAU makers for pluggable modules to enter the CPO market directly. The landscape is expected to shift:
    *   **Tiered Supply Chain:** Domestic Chinese FAU makers may become sub-component suppliers to companies like TFC or Coherent.
    *   **Final Assembly:** TFC and Coherent will likely perform the final assembly of the complete CPO FAU and sell it to end customers like NVIDIA.
    *   **Entry Barriers:** New entrants will need to possess specific platforms (like Prism Microlens Array) and advanced coating capabilities to compete.

**Q: What are the biggest bottlenecks in the optical communication supply chain, particularly for EMLs, CW lasers, and Indium Phosphide (InP) substrates?**
A: The key bottlenecks are concentrated in specific areas:
1.  **Major Bottlenecks:**
    *   **EML Chips:** 200G EMLs are extremely scarce, with Lumentum being the primary volume supplier currently.
    *   **Faraday Rotators:** This is another critical component in short supply.
2.  **Not a Bottleneck:**
    *   **CW Lasers:** Supply is not constrained. There are approximately 12 global suppliers, including five in China, ensuring sufficient capacity.
3.  **Upstream Bottleneck - InP Substrates:**
    *   **Current Shortage:** There is a global shortage, as demand (700-800k wafers/month) significantly exceeds supply (~400k wafers/month). This has led to price increases in North America.
    *   **Geopolitical Factors:** The situation is exacerbated by China's export controls (extending review times for AXT), which creates market uncertainty.
    *   **China's Strategy:** This appears to be a strategic move to control the upstream supply chain to accelerate the localization of midstream components like EMLs, similar to the strategy used with rare earths to boost domestic Faraday rotator production.
    *   **Future Outlook:** China is aggressively expanding its domestic InP production capacity. Once this capacity comes online, the bottleneck may ease, and prices could potentially fall if exports are permitted.

**Q: What is the adoption timeline and market outlook for Optical Circuit Switches (OCS), and what are their key benefits?**
A: The adoption and benefits of OCS are significant:
1.  **Adoption Outlook:** OCS adoption is considered inevitable for all major CSPs, including NVIDIA, as it offers substantial and proven benefits over traditional electrical switches.
2.  **Demand Forecast:**
    *   **2024:** Google is forecasted to deploy 18,000 units, with Microsoft adding 2,000.
    *   **2025:** Demand is expected to surge, with Google alone requiring over 30,000 units and other CSPs at least 2,000 each, totaling over 40,000 units.
    *   **Growth Rate:** A compound annual growth rate (CAGR) of 30-50% is considered realistic.
3.  **Key Benefits:** OCS replaces electrical switches at the Spine layer of the network architecture.
    *   **TCO Reduction:** Google reported a 40% reduction in Total Cost of Ownership (TCO) in a large cluster deployment.
    *   **Power Savings:** Power consumption was reduced by 40-50%.
    *   **Latency Improvement:** Latency was reduced by 70%.

**Q: Who are the main competitors in the OCS market, and what are the technological barriers for new entrants?**
A: The competitive landscape is currently very concentrated:
1.  **Current Leaders:** The market is dominated by Coherent and Lumentum, who supply full systems to major customers like Google.
2.  **Technological Barriers & Alternatives:**
    *   **Coherent's Liquid Crystal:** This is a proven, reliable technology. Its core advantage is the proprietary liquid crystal material, which Coherent produces in-house, preventing others from replicating the solution.
    *   **MEMS:** Many companies are developing MEMS-based solutions. However, they are still in early stages and have not yet delivered samples ready for the rigorous year-and-a-half testing process required for mass production. New MEMS-based entrants are unlikely to impact the market before the second half of next year.
    *   **Other Technologies:** Alternative approaches like waveguide and piezoelectric ceramics face significant challenges with high insertion loss, low port counts, or prohibitively high costs.

**Q: What are the prospects for thin-film lithium niobate (TFLN) technology in optical modules?**
A: The main factor governing TFLN's prospects is cost.
1.  **Primary Barrier:** The cost of TFLN modulators is currently too high for widespread adoption in cost-sensitive data center applications. A single modulator can cost several thousand RMB.
2.  **Technology Readiness:** The technology itself has been developed by major players like InnoLight and Eoptolink.
3.  **Adoption Condition:** TFLN will only become a viable alternative if its cost becomes competitive with other high-speed solutions. For example, if a 400G TFLN modulator becomes price-comparable to a 400G EML chip in the future, it may see adoption. Until then, its use will be limited.

# 原文提炼

**speaker1:** Hold on, let me take off my headphones and use my phone.

**speaker2:** Hello, can you hear me now? Yes, it's much clearer than before. I couldn't quite catch what the key piece of equipment was that you mentioned.

**speaker2:** The equipment is called a coating machine.

**speaker1:** Oh, a coating machine.

**speaker2:** Yes, that's right.

**speaker1:** I see. And the current shortages are for EML chips and emitters, is that correct?

**speaker2:** For 200G EMLs, Lumentum is likely the only one producing in large quantities globally right now; another company has just started.

**speaker2:** So this year, at best, they might produce 30 to 40 million units. And 30 to 40 million units don't make many 1.6T modules.

**speaker2:** Even if you produce 40 million units, that's only enough for 5 million modules.

**speaker2:** Right?

**speaker1:** Mm-hmm.

**speaker2:** So the quantity is still insufficient.

**speaker2:** Currently, we haven't seen any other company in the industry shipping 200G EMLs in large volumes.

**speaker2:** They are slowly starting to ship. So, EML is the most scarce component for 1.6T modules. You might say, what about silicon photonics? But currently, most 1.6T modules are discrete modules, and the vast majority of those use EMLs.

**speaker1:** Oh.

**speaker2:** For 1.6T optical modules, about 60% are silicon photonics and 40% are EML.

**speaker1:** I understand. So I'd like to ask, does the forecast you mentioned earlier of 15 million units for this year already take into account the current shortages of components like EML?

**speaker2:** Yes, yes, we have considered that. Oh, so it seems this shortage situation is unlikely to change within this year, right?

**speaker2:** The production capacity of each company has been basically planned out for this year based on the current expansion plans. The numbers we've heard are based on each company's planned capacity, considering the entire material supply chain. If you want to go higher, the only way is if a massive new supply of EMLs becomes available.

**speaker2:** Then all the production lines and materials would need to align. Otherwise, it's very difficult. What we are seeing now is that all materials in the entire industry chain related to optical communication and optical modules are in short supply.

**speaker1:** I see.

**speaker2:** This has led to a market where everything is scarce, including optical fibers and even the glass components inside.

**speaker1:** Understood. You mentioned the silicon photonics architecture. What are the core component differences compared to the EML architecture?

**speaker2:** In a silicon photonics architecture, for a DR module, it uses a PIC for modulation.

**speaker2:** After modulation, the signal goes out directly through a standard MT ferrule. That's the silicon photonics approach.

**speaker2:** For a DR optical module, comparing EML to silicon photonics, the EML approach doesn't have PIC modulation but uses modulation from the DSP or TIA.

**speaker2:** The passive components are basically similar.

**speaker2:** There is another core difference. A 1.6T silicon photonics module typically uses four 100mW CW laser sources.

**speaker2:** Four CW lasers, whereas a 1.6T EML module uses eight EML chips.

**speaker2:** So, the number of lenses and isolators used inside is different.

**speaker2:** This is the difference between silicon photonics and EML within DR optical modules.

**speaker2:** Another point is that for FR modules, there is currently no silicon photonics version.

**speaker1:** Mm-hmm.

**speaker2:** All FR optical modules are EML-based.

**speaker2:** So for the 15 million units this year, about 7 to 7.5 million will be EML-based FR optical modules.

**speaker2:** And these FR modules will use a large number of filters, as I mentioned.

**speaker2:** Both silicon photonics and EML modules use isolators.

**speaker1:** Right.

**speaker2:** Yes. And FR modules use EMLs, Faraday rotators, and filters—all three are in short supply.

**speaker2:** Silicon photonics modules use Faraday rotators, but not EMLs or filters.

**speaker2:** So, this year will likely see fewer FR modules and more DR modules being produced.

**speaker1:** I see. Looking at the long-term trend, at which generation will the adoption of silicon photonics architecture accelerate?

**speaker2:** Actually, it's already accelerating with 1.6T.

**speaker2:** For 800G, silicon photonics was only about 40%. For 1.6T, it's expected to reach 60% to 70%.

**speaker1:** 60% to 70%.

**speaker1:** I see. But in the long run, the EML route won't be completely replaced by silicon photonics, correct?

**speaker2:** Correct, it won't be. From our perspective, for longer-reach applications in the future, EML will still be used because silicon photonics currently cannot solve the long-distance problem.

**speaker2:** That's why silicon photonics is mainly for DR, covering distances from 30 to 500 meters.

**speaker2:** For distances from 500 meters to 2 kilometers, it's almost all EML.

**speaker2:** So, looking ahead to 3.2T, it might move to 400G per lane using 400G EMLs or 400G DSPs, which silicon photonics can't handle.

**speaker2:** The upper limit for silicon photonics is 200G per lane, which is determined by the material properties of silicon itself.

**speaker2:** So if you want to use silicon photonics for 400G or higher speeds, you would have to use what's hot in the market now, called heterogeneous integration.

**speaker2:** That means using special materials like thin-film lithium niobate or indium phosphide for heterogeneous integration, which makes the cost very high.

**speaker1:** Mm-hmm.

**speaker2:** So that's the market trend we are seeing. In the future, for 3.2T or higher speeds in inter-rack applications, EML will likely remain the mainstream choice.

**speaker2:** For intra-rack applications, things like NPO and CPO will emerge.

**speaker2:** These will use optical engines. For example, Nvidia and others are making 3.2T or 1.6T optical engines, which are based on silicon photonics with configurations like 200G x 8 or 200G x 16.

**speaker2:** This solves the intra-rack problem because the distance is short, so there's no need to use EMLs.

**speaker2:** That's the rationale.

**speaker1:** I understand. What is the approximate cost structure of a 1.6T optical module right now? And does the silicon photonics solution offer significant cost savings?

**speaker2:** Yes, for a 1.6T DR module, the silicon photonics solution is about $100 to $200 cheaper than the EML version, at least $100 cheaper.

**speaker2:** I remember seeing that the cost for a silicon photonics solution was around $400-plus, while the EML solution was around $500-plus.

**speaker1:** Oh, so the EML cost is $500. Can you break down this $500-plus cost?

**speaker2:** It's over $500, probably around $560 to $580, if I recall correctly.

**speaker1:** $560 to $580, I see. Could you provide a detailed breakdown of this structure?

**speaker2:** For a 200G per lane EML-based DR module, you have 8 EML chips. At about $20 each, that's $160.

**speaker2:** Then the 1.6T DSP, if I'm not mistaken, is about $160. That brings the total to $320.

**speaker2:** Add the PCBA, which is about $60.

**speaker2:** So that's $380. Then you have the TIA and another component... those two together are about $60, so that brings us to $440.

**speaker2:** Then you add the PD.

**speaker2:** The PD is a PD array of 8. I think a single PD is about $7. So 8 of them would be $56. That brings the total to around $490.

**speaker2:** Then you add the passive components like the FA, optical interfaces, and connectors, which all together are about $30 to $40.

**speaker2:** That's the price.

**speaker2:** This is the material cost. On top of that, you have your assembly and testing costs.

**speaker2:** So the current selling price for a DR optical module is around $1,100 to $1,200.

**speaker1:** $1,100 to $1,200... What's the difference between that and the $560 to $580 you mentioned? I'm a bit confused.

**speaker2:** That's the BOM, the bill of materials cost.

**speaker1:** Oh.

**speaker2:** Yes, yes, that's how it is.

**speaker2:** So the gross margin is in the tens of percent.

**speaker2:** But this is what we see. It's possible that major players like InnoLight and Eoptolink, due to their large volumes, might get a slightly better price on the DSP.

**speaker2:** Maybe $10 to $20 cheaper, but other components won't be much cheaper.

**speaker2:** So a basic BOM cost of around $550 would be a reasonable estimate.

**speaker1:** The BOM cost is around $550, correct?

**speaker2:** Yes, the material cost.

**speaker1:** I see.

**speaker1:** I missed a point earlier. Is the CW laser also in short supply right now?

**speaker2:** That was for the EML version.

**speaker2:** The CW laser is for the silicon photonics version.

**speaker2:** For silicon photonics, a 100mW CW laser... you need four of them, and the total cost is only $20.

**speaker2:** Compare that to the eight EMLs we discussed earlier, which cost $160. This alone saves you $140.

**speaker1:** Right.

**speaker1:** Oh.

**speaker2:** The costs for the other components like the PIC and DSP are roughly similar.

**speaker2:** The savings are primarily from the laser source.

**speaker2:** Also, in optics, as I said, the optical components for EML are about $40, while for silicon photonics, they are about $30.

**speaker1:** I understand.

**speaker2:** So this is where you save about $120 to $130.

**speaker1:** Oh, so that's the main cost difference.

**speaker2:** Yes, that's the main part.

**speaker1:** Mm-hmm.

**speaker2:** Yes.

**speaker2:** That's why the selling price of a silicon photonics module is also about $100-plus cheaper than an EML one.

**speaker2:** For example, if an EML DR module is close to $1,200, the silicon photonics version would be around $1,000. So there's a difference of over $100.

**speaker1:** And this is based on the current situation, right? Looking forward to 2028, as mass production continues, how much room is there for the BOM cost to decrease?

**speaker2:** Let me think. The DSP, currently at $160, will likely drop to $120.

**speaker2:** The EML, from $20, will drop to $10-$12, or maybe $15.

**speaker2:** It's hard to say for sure.

**speaker2:** Recently, there's been talk of a 30% price hike for EMLs.

**speaker1:** Right.

**speaker1:** Because of the shortage, right?

**speaker2:** Yes, exactly.

**speaker2:** Other components like the driver and PD will also see price drops. With large volumes, you can expect a 15% to 20% reduction.

**speaker2:** So looking ahead, the final BOM cost should be around $450. There's still room for it to drop by about $100.

**speaker1:** I see, that's clear.

**speaker1:** In terms of the competitive landscape, looking at the major players—Coherent, Lumentum, and the Chinese companies InnoLight and Eoptolink—how do you see the market share evolving from 800G to 1.6T?

**speaker2:** Well, let's start with 800G. InnoLight has about 40% of the global market share. Coherent has about 20%, and Eoptolink also has about 20% to 25%.

**speaker2:** The remaining players account for about 15% of the market.

**speaker2:** That's the overall market picture.

**speaker2:** Now, for 1.6T, InnoLight has basically secured about 60% of the entire market.

**speaker1:** Mm-hmm.

**speaker2:** Yes, that's right. Oh, let me calculate... 15 million units, 7 million... oh, it's less than 60%.

**speaker2:** It's probably around 50%.

**speaker2:** Yes, Coherent still has over 20%, and Eoptolink also has over 20%.

**speaker2:** Lumentum has a small share this year, about 5%.

**speaker2:** So for this year, InnoLight has the largest share.

**speaker2:** Coherent has about 22%, and Eoptolink has around 25%.

**speaker2:** Lumentum has 5%, and the rest belongs to InnoLight.

**speaker1:** Hmm. Oh, sorry, one more point.

**speaker2:** I should clarify that my calculation excludes Nvidia's own supply through Mellanox, which accounts for another 20%. We didn't include that.

**speaker1:** And that's also not part of the 15 million unit forecast, correct?

**speaker2:** Roughly, yes, that's correct.

**speaker1:** Mm-hmm.

**speaker1:** Understood. Yes, because this... go ahead.

**speaker2:** Yes, what I mean is, as production ramps up from this year to 2027-2028, what kind of changes do you expect in the market share for each company? Specifically, is there room for InnoLight and Eoptolink to grow their share?

**speaker2:** I don't think the shares will change much. InnoLight's share will likely decrease.

**speaker2:** This is because tier-2 1.6T vendors will enter the market.

**speaker2:** Coherent, Lumentum, and Eoptolink will likely maintain their current volumes.

**speaker2:** Lumentum will probably stay where it is. InnoLight's share is just too large right now.

**speaker2:** As other players enter, Coherent and Eoptolink will likely stay between 20% and 25%.

**speaker2:** InnoLight will probably drop to around 40%.

**speaker2:** That's the kind of share distribution we expect. Lumentum will be around 5%, and then others like Source Photonics will come in.

**speaker2:** It fluctuates, but the basic structure will remain.

**speaker2:** You can see this trend with every new generation of technology.

**speaker1:** I see. So, at the very beginning of a new generation, InnoLight tends to have the highest market share, and then it moderates?

**speaker2:** Exactly. Last year, out of 1.5 million units, InnoLight accounted for 70% to 80% of the share.

**speaker1:** Wow.

**speaker2:** Maybe even 80% to 90%. They were basically the only ones making them because they had a generational lead when it first came out.

**speaker2:** This year, Coherent, Lumentum, and Eoptolink are taking market share from them.

**speaker1:** I see. Are there some CSPs that procure EML chips themselves and then provide them to the optical module vendors?

**speaker2:** It's a different model. I understand what you're asking. It's not exactly procurement, it's more like "binding."

**speaker2:** The CSP secures the volume and then directs its optical module vendors to buy from that secured supply.

**speaker1:** Oh.

**speaker1:** I see. So it's not considered contract manufacturing?

**speaker2:** It's a binding agreement.

**speaker2:** Yes, they bind the supply. It's like the CSP steps in to negotiate on their behalf. For example, the CSP negotiates for 2 million units and then tells the module vendor to go buy those 2 million units and make modules for them. This is the same model used for Faraday rotators now.

**speaker2:** For instance, InnoLight or Eoptolink will secure the supply from a Faraday rotator vendor, and then have the isolator manufacturer purchase those rotators.

**speaker1:** Mm-hmm.

**speaker1:** Mm-hmm.

**speaker2:** That's how it works.

**speaker1:** I understand. From your perspective, what is the status of Source Photonics' EML chips in terms of mass production and certification?

**speaker2:** You mean Source Photonics?

**speaker1:** EML chips.

**speaker2:** Source Photonics' EML chips are good; they have a very good reputation in the industry.

**speaker1:** They are still expanding capacity, right? What is the progress on that, and what are the potential bottlenecks they might face?

**speaker2:** They claim they will have 100 million units this year, but I'm not sure if that's achievable. If they really manage to produce 100 million units, that's an incredible volume. They would quickly capture a significant portion of the market.

**speaker1:** Yes, that's what I wanted to ask about.

**speaker2:** We don't think they will reach 100 million units this year.

**speaker2:** From what we see now, their actual 100-million-unit capacity might only come online in the second half of the year or Q4, with real market impact next year. From what we understand, their current claims are based on post-expansion capacity.

**speaker2:** Right now, they aren't selling their EMLs externally; they are mostly using them for their own optical modules. You can calculate it based on their own module shipment volume.

**speaker2:** If they ship 200,000 or 300,000 modules a month, you can figure it out.

**speaker1:** Right. I see.

**speaker2:** So their 100-million-unit figure is likely their production capability by the end of the year, not the total supply for this year.

**speaker2:** Yes, and for example, if they are in talks with Coherent and Coherent places an order, they will tell Coherent when they can start supplying. They have MOCVD machines, but to make these chips, they need to bring another machine online. Starting from scratch to final output for Coherent would take until at least Q3 or Q4. From what we see now, it would be Q4 at the earliest.

**speaker1:** I see.

**speaker1:** Understood.

**speaker1:** I'd also like to ask about CPO. It seems that NPU is becoming a transitional path for Chinese vendors to enter the CPO market. How should we understand this process?

**speaker2:** I believe that for both CPO and NPU, it's not just about Chinese vendors. For optical module manufacturers, CPO and NPU are essentially optical engines. What optical module vendors can do is the optical engine part. This involves bonding the PIC and EIC using semiconductor processes. This capability... even a company like TFC doesn't have it in-house; they outsource the bonding. InnoLight and Eoptolink also don't have this bonding capability.

**speaker2:** They all have to find a foundry to do it. So, we believe that while they can handle the upper and lower level auto-coupling, they lack the core bonding capability. Ultimately, this work has to go to foundries in Taiwan or other semiconductor companies that can do the bonding.

**speaker2:** We think that in the NPO and CPO era, the competitiveness of optical module vendors will diminish.

**speaker2:** The competitiveness of semiconductor vendors will increase. However, this is a new market segment for them, so for Chinese optical module makers, it's all incremental business.

**speaker2:** Right? But to say they will have a monopolistic position like they do in pluggable modules, that logic doesn't hold. We can say they will have volume, but they might not have as much say or power. More power will shift to semiconductor companies.

**speaker2:** Yes, because of the bonding step you mentioned, right? Yes, that's right. You need to have this capability. This is why in the future, for NPO, CPO, and similar technologies, companies like TSMC, ASE, and their ecosystem partners, and even TowerJazz, might get involved. They will become direct competitors.

**speaker2:** Yes, this is what we see in the industry. It's not to say that the module makers are incapable, but this is something that requires platform accumulation.

**speaker2:** That's for the optical engine side. Then there's the ELS and PLS side. PLS, whether it's for CPO or NPO, requires an external light source, right? Looking at the PLS, first, the CW laser. Currently, Coherent and Lumentum are the main players. Sumitomo has very little capacity. Chinese vendors are still facing challenges with producing 400mW lasers.

**speaker1:** Mm-hmm.

**speaker2:** So the main supply is from Coherent and Lumentum. The most crucial part is that if these two companies decide to make the PLS modules themselves, then other players like InnoLight, Eoptolink, and TFC would need the end customer to tell Coherent or Lumentum to allocate a certain amount of CW lasers to them. Otherwise, they won't get any. However, Lumentum is not very involved in making PLS modules because they produce few optical modules. But in the future, it's possible. Coherent, on the other hand... the PLS is essentially the transmit side of an optical module.

**speaker2:** For TFC, InnoLight, and Eoptolink, this is their area of expertise.

**speaker2:** It's also Coherent's strength. So, this will still be a game for the mainstream players.

**speaker1:** I see. So a PLS is essentially a packaged CW laser, correct?

**speaker2:** Yes, that's right.

**speaker2:** It's packaged together. Inside, you have eight lasers, sixteen photodiodes, and eight isolators. The output is eight PM fibers that you just connect.

**speaker2:** And that connects to the on-board optics. That's the structure.

**speaker2:** So, the issue with something like an ELS is that...

**speaker2:** if Coherent and Lumentum decide to make them in-house...

**speaker2:** meaning they use their own CW laser capacity to produce the ELS...

**speaker2:** then the other three companies will be under a lot of pressure. They would have to find other suppliers for the CW lasers.

**speaker2:** That's the logic.

**speaker1:** I see.

**speaker2:** So, that's the underlying logic.

**speaker2:** Moving forward, with the ELS, it's currently these four or five companies in the game.

**speaker2:** Coherent, Lumentum, InnoLight, Eoptolink, and TFC.

**speaker1:** Mm-hmm.

**speaker2:** And one of these units costs about $480 or $500 right now.

**speaker2:** So if Nvidia says they need 5 million units next year, everyone will just divide up the market.

**speaker2:** Right? Lumentum and Coherent will naturally get the first cut. Whatever is left over will go to InnoLight, Eoptolink, and TFC.

**speaker2:** That's the concept.

**speaker2:** That's one thing. Secondly, further down the chain, you have the FAU, MPU, or MTP connectors.

**speaker2:** That's where the domestic Chinese passive component manufacturers come in.

**speaker2:** Right?

**speaker1:** Mm-hmm.

**speaker2:** This part remains in China because the domestic passive component industry is very strong.

**speaker2:** That's the situation.

**speaker2:** Taiwanese companies like PCL and Shang-Jyh trying to compete in this area honestly can't beat the mainland Chinese companies.

**speaker2:** So this business will stay in China.

**speaker2:** So, looking at the entire NPU and CPO landscape...

**speaker2:** First, on the optical engine side, more competitors will enter.

**speaker2:** Second, on the ELS side, it's a field for traditional optical module players.

**speaker2:** They have some advantages, but the logic is the same as with optical modules: if you can get the chip, you can ship. If you can't, you're out.

**speaker2:** That's the logic, right?

**speaker1:** Mm-hmm.

**speaker2:** And Coherent and Lumentum have an advantage because they can make the chips themselves, so they will have priority.

**speaker1:** Mm-hmm.

**speaker1:** It sounds like the core of the ELS is the availability of the CW laser, right?

**speaker2:** And then the packaging.

**speaker2:** Yes, exactly. It's the same principle as with current optical modules.

**speaker2:** For example, with silicon photonics modules, the CW lasers are widely available from domestic suppliers in China.

**speaker2:** So supply isn't constrained. But with something like EML...

**speaker2:** if, for instance, only Lumentum or Coherent could make 200G EMLs...

**speaker2:** and Lumentum decided to make its own optical modules, they would sell fewer chips.

**speaker2:** Right? And if other domestic Chinese companies don't have access to these EMLs, they would be in a very tough spot.

**speaker2:** No matter how capable you are, without the EML chip, you can't build anything.

**speaker2:** That's the logic.

**speaker1:** I understand.

**speaker1:** Another question. You mentioned...

**speaker1:** about price hikes.

**speaker1:** You said earlier that CPO, for the optical module vendors, is entirely an incremental market. Is that correct?

**speaker2:** Yes, for on-board applications, we believe CPO or NPU is purely incremental.

**speaker2:** Because previously, it was all copper.

**speaker2:** Now it's a shift from copper to optics.

**speaker1:** Oh, I see.

**speaker2:** Right? In the past, connections for 200G, 400G, or 800G were mostly copper. Now, with 1.6T or higher speeds, like 3.2T in the future, you can't use copper anymore.

**speaker2:** At 1.6T, a copper cable can only reach about 0.7 meters. You can't even connect the top and bottom of a rack. It's unusable. So, you have to use optics.

**speaker2:** Right? And the logic behind using optics...

**speaker2:** inside the rack is that it's all new business for these manufacturers. That's how we see it.

**speaker2:** It's also new business for fiber optic cable manufacturers. It used to be copper, now it's fiber, so the volume is huge.

**speaker1:** Mm-hmm.

**speaker1:** But in certain scenarios, could it also replace some pluggable optical modules?

**speaker2:** In some scenarios, let me think... if CPO is used in inter-rack applications, for example, at the ToR or Leaf layer, could it replace optical modules?

**speaker1:** But that's not the main application, right?

**speaker2:** Right, the volume is very small. CSPs are not... let's say, not very enthusiastic or aggressive about this.

**speaker2:** That's one reason. Secondly, for inter-rack applications, putting CPO into an electrical switch doesn't significantly improve the overall TCO.

**speaker2:** This has led to the current situation where...

**speaker2:** CSPs are not very keen on using CPO for inter-rack connections. In contrast, for on-board applications, everyone is adopting it because, for one, you don't need a DSP.

**speaker2:** If you use a pluggable optical module, you definitely need a DSP. So you save that cost.

**speaker2:** Secondly, the optical engine is very close to the ASIC, so your overall latency, insertion loss, and efficiency are all improved. This is what everyone sees. And the volume for on-board applications is 5 to 10 times larger than for inter-rack applications.

**speaker1:** Mm-hmm.

**speaker2:** So you can understand it this way: we believe that...

**speaker2:** the incremental growth is much larger in on-board applications. That's how we see it.

**speaker1:** I understand.

**speaker1:** That's very clear.

**speaker2:** Yes, that's right.

**speaker1:** You mentioned the FAU component earlier. What is the current competitive landscape for that? Is TFC still the leader?

**speaker2:** Yes, TFC and Coherent.

**speaker1:** Mm-hmm.

**speaker1:** Do you expect any changes in the future?

**speaker2:** There could be some changes. Juguang and Pro-way from Taiwan are trying to enter this space. We'll have to see if they can succeed. The window of opportunity is wide open right now.

**speaker1:** Mm-hmm.

**speaker2:** Yes, that's right.

**speaker1:** I see.

**speaker1:** For CPO applications, what are the new requirements for FAUs and how does their value change?

**speaker2:** The FAUs for CPO are actually very expensive. For example, a 36-channel FAU...

**speaker2:** costs over $200 during the sampling phase.

**speaker2:** That's over 1,000 RMB per unit.

**speaker1:** Mm-hmm.

**speaker2:** Yes, around $220-$230. And even in mass production...

**speaker2:** it will still be close to $150 or $160.

**speaker1:** In USD, right?

**speaker2:** Yes, USD, not RMB.

**speaker2:** And its structure is extremely complex. It's a completely different thing compared to the ones in optical modules.

**speaker1:** I see. My question was, in the context of CPO, will the competitive landscape remain the same, or will there be changes?

**speaker2:** When it comes to CPO, I think it will be quite difficult for the current players who make FAUs for optical modules to enter the CPO or NPU FAU market.

**speaker2:** It's not that easy to get in. There are several barriers. First, the operating temperature is very high. Second, it's not a simple FAU; it includes a Prism Microlens Array. It's essentially two components assembled together, and it has to be pluggable.

**speaker1:** Mm-hmm.

**speaker2:** So, the domestic FAU makers might end up supplying components to companies like TFC. A CPO FAU consists of two parts: a Prism Microlens Array and a traditional FAU like the one in an optical module. So, the domestic players who make FAUs for optical modules might become suppliers to companies like TFC or Coherent. They would then assemble the final component and sell it to NVIDIA. That's the logic.

**speaker2:** As for new players, like Pro-way or Juguang from Taiwan, it will depend on who has the right platform, for example, the Prism Microlens Array platform. That's one thing. Second is whether they can handle the coating requirements. Because in the CPO reflow process, the temperature is very high, like 500-600 degrees Celsius. Can your component withstand that temperature? Optical modules don't face such high temperatures, so the coating requirements are not as strict. But for CPO FAUs, the temperature resistance requirement for the coating is very high. These are all barriers to entry.

**speaker2:** They are different from optical modules. So it's not an entirely new product, but if you have the existing platform, you need to overcome these challenges to enter the market. The landscape might change in that the domestic FAU makers will supply sub-components. TFC or others will then assemble the final FAU component and sell it to NVIDIA. That's the concept. For these domestic passive component makers who produce FAUs...

**speaker2:** for them, the impact won't be that significant. It depends on whether they are willing to upgrade. If not, they might be phased out.

**speaker1:** I understand.

**speaker2:** They would have a hard time entering the CPO and NPU market directly.

**speaker1:** I see. So, to summarize the biggest bottlenecks in the supply chain we've discussed, they are EML and Faraday rotators, correct?

**speaker2:** Not CW lasers. The bottlenecks are EML and Faraday rotators.

**speaker1:** Oh, Faraday rotators. So CW lasers are not a bottleneck at present?

**speaker2:** CW lasers are not in short supply. Let me tell you, for domestic CW laser suppliers, let me count... there's Yuanjie, Minxun, Dingxing, Shijia, and Changguang Huaxin. All these companies claim they can mass-produce them. It just depends on their individual capabilities. That's one thing.

**speaker2:** These are the domestic players, so there are five of them. As for foreign suppliers, they are not producing much because the price is too low, but they certainly have the capacity. They could make a lot if they wanted to. Source Photonics can also make them but chooses not to because they don't want to compete on price.

**speaker2:** Then you have the Japanese companies: Sumitomo, Furukawa, and Mitsubishi. That's three. And Broadcom. That's four. In total, there are about 12 companies in the market that can produce them. There won't be a shortage.

**speaker1:** Mm-hmm.

**speaker2:** Yes, that's right.

**speaker2:** EML, on the other hand... for 100G EMLs, you have Lumentum, Broadcom, Sumitomo, Mitsubishi, and Source Photonics. But their volume is limited, so the output is limited. For 200G EMLs, it's currently just Lumentum. In the future, maybe Broadcom and Sumitomo will join.

**speaker2:** As for Source Photonics, we'll have to see if they can mass-produce. They might be able to make samples now, but it's unclear when they can reach mass production. This is why 200G EMLs are extremely scarce.

**speaker1:** I see. Understood.

**speaker2:** Yes, exactly.

**speaker1:** I see. And moving further up the chain, Indium Phosphide (InP) substrates are also quite scarce now, right? I've seen prices are increasing.

**speaker2:** The price increase for InP substrates is happening in North America.

**speaker2:** In China, we don't expect such a price hike. I think prices in China will actually decrease in the future.

**speaker2:** Companies like SICC and another one, some "Yao" semiconductor company, and ZY are all making them.

**speaker2:** Once these domestic capacity expansions and furnaces come online, there will be a flood of supply.

**speaker2:** Abroad, the only Chinese company currently allowed to export to North America is AXT.

**speaker2:** AXT exports to North America. Japan has another one called Sumitomo. These two are the main suppliers to North America because most of the demand is there. Chinese suppliers can't easily export.

**speaker2:** That's why prices have gone up a bit in line with the international market. In the future, we think prices might fall. It depends on whether China will allow more exports. If they do, we don't think InP will be a bottleneck.

**speaker1:** I see. So it's not a fundamental shortage, but rather...

**speaker1:** ...an issue of export restrictions.

**speaker2:** Yes, if China, for example, were to restrict AXT, North America would be in trouble.

**speaker2:** They would have a very hard time.

**speaker2:** They would have to buy from Sumitomo.

**speaker2:** AXT isn't being completely blocked, but the approval period is being extended.

**speaker2:** For example, from one month to three months.

**speaker2:** If they manage it themselves, everyone will start hoarding. That's what happens.

**speaker2:** It doesn't mean your supply is cut off, but it creates a lot of panic.

**speaker2:** That's why prices go up, right?

**speaker1:** Will this be a long-term situation? From an industry chain perspective, our policy is creating a shortage of InP in North America.

**speaker1:** But won't that in turn create problems for our imports of EMLs and other components? Am I understanding this correctly?

**speaker2:** Your understanding is correct.

**speaker2:** But this situation could also spur the development of domestic EML chip production in China.

**speaker2:** It's like with Faraday rotators. Once we restricted Japan, domestic manufacturers in China stepped up, and now they are entering the North American supply chain.

**speaker1:** Oh, I see.

**speaker2:** So, we are essentially controlling the most upstream part of the supply chain to accelerate the localization of the midstream components, is that right?

**speaker2:** That's basically the idea.

**speaker2:** Yes, it really depends on how the country wants to play this.

**speaker2:** For Faraday rotators, the plan was always to have domestic production by 2025.

**speaker2:** Once they succeeded, they immediately restricted rare earth exports to Japan last October.

**speaker2:** So Japan had to cut production.

**speaker2:** Right?

**speaker2:** And that created an opportunity for domestic Chinese manufacturers to enter the market.

**speaker2:** Before, around 2020-2021, domestic players like InnoLight and Eoptolink wouldn't even use free samples of Chinese-made Faraday rotators.

**speaker2:** Now, they are begging them to expand production.

**speaker2:** Think about that, it's just been a year.

**speaker2:** They've turned the tables and are now in charge.

**speaker2:** So this all depends on the grand strategy.

**speaker2:** For example, with InP in the future, if companies like SICC and that other semiconductor company...

**speaker2:** I can't recall the specific name... something "Yao"...

**speaker2:** Right?

**speaker2:** Anyway, that company and ZY, they are all expanding capacity aggressively.

**speaker2:** I remember ZY bought over 200 furnaces.

**speaker2:** When all these companies ramp up...

**speaker2:** and the volume becomes really large...

**speaker2:** then it's simple. China can start exporting and drive the prices down.

**speaker1:** Mm-hmm.

**speaker2:** Yes, because the capacity isn't fully ramped up yet, so you don't have that leverage.

**speaker1:** I understand.

**speaker2:** It should ramp up in the second half of this year.

**speaker2:** So this depends on the national policy.

**speaker2:** For instance, if in the future the government decides to, say, clamp down on AXT.

**speaker2:** And stop their exports.

**speaker2:** Then North America would be in a very difficult position.

**speaker2:** Their chip supply would be constrained, right? They would have to rely on Sumitomo.

**speaker2:** But China now restricts the export of indium and gallium compounds to Japan. So Sumitomo would have to find its own way. If they can manage, fine. If not, and domestic Chinese chips come online, then those chips can be sold abroad.

**speaker2:** Because selling chips is not a problem.

**speaker1:** Mm-hmm.

**speaker2:** Yes, that's a different logic.

**speaker1:** I see.

**speaker2:** The analogy you made with rare earths and Faraday rotators...

**speaker2:** ...helps me understand. It's the same logic. So this all depends on the level of domestic capability, I think. The stock market is full of companies we can't be sure about, but it's best to look at their financial reports. There are a lot of rumors and conflicting reports about orders being placed or not. It's hard to get a clear picture. There are a lot of "short essays" (rumors) out there, we think. But from another angle, your analysis suggests that the high price of InP in North America is likely to be sustained, right? If you can sell to the North American market, you should be able to make money. Is that correct? Yes, that should be correct. The price of InP substrate in North America, from last year to this year, has probably gone up 70%. First 30-40%, now 70%. And recently, EML prices are set to rise another 30%. It's crazy. So for companies like AXT, with their production capacity in China, are their exports proceeding normally? Currently, they are normal, just with a longer review time because China hasn't blocked them. I see. Blocking them would be unreasonable, right? If they were to block them... It would be the same logic as before. If they were blocked, Coherent and Lumentum would have no substrates. Sumitomo couldn't supply enough either. Then the chip supply would be in trouble. Right? So what would domestic players like InnoLight and Eoptolink do? Right? How would they get their EMLs? But if, say, a domestic company like Sowa really expands to 300 million units next year... a genuine 300 million... then there would be nothing to fear. I see. So the timing might not be right to impose such strict restrictions yet. Yes, and it also depends on US-China relations. Right? For example, in the future, if China's relationship with France... with that French company that makes Faraday rotators, that uses Gallium... if the relationship sours, China could restrict Gallium exports to France, the US, and everyone, and just keep it for domestic circulation. Then China would dominate the global Faraday rotator market. I see. For the InP substrate, what is the supply-demand situation for the epitaxy step? Is it tight? The epitaxy on InP substrate is for EMLs. Since EMLs are in short supply, the entire... what you're referring to as the InP wafer, the substrate wafer, is currently in short supply. It is. Because everyone is expanding their capacity, and it's not ramping up fast enough. For example, let's say the total market demand for 3-inch or 4-inch wafers is 400,000 pieces a month. But this year, the total market can only supply 400,000 pieces, while the actual demand from various companies is 700,000 or 800,000 pieces. So there's a shortage. That's why everyone is frantically expanding production. So looking at these stages of the supply chain, the most critical bottleneck is the upstream wafer shortage, right? Not the downstream processing like epitaxy?

**speaker2:** Well, it's two things. Previously, the InP substrate supply was only enough for, say, 60 or 80 million EMLs.

**speaker2:** Now, the market demands 200 million EMLs.

**speaker2:** So, the downstream EML manufacturers will definitely go to their upstream suppliers and say, "Hey, I need to expand production, I need this much InP from you." They have to plan ahead.

**speaker2:** Right? Because they need the substrate to start their process.

**speaker2:** So, the existing capacity was already insufficient, which creates a market shortage of perhaps 50%.

**speaker2:** Then, at the downstream end, the equipment for making EMLs, like MOCVD machines, is also in short supply.

**speaker2:** It's a chain reaction. You look at the whole chain, and the expansion takes 18 to 20 months. That's the process.

**speaker1:** I see.

**speaker1:** Mm-hmm.

**speaker2:** Yes, it's not a single isolated effect.

**speaker2:** That's the underlying logic we see.

**speaker1:** Mm-hmm.

**speaker1:** I have another question for you regarding Optical Circuit Switches (OCS). What is the expected adoption timeline for this technology?

**speaker1:** I know Google has provided a forecast. From your perspective, what does the adoption timeline look like going forward?

**speaker2:** I believe that in the future, all CSPs will use OCS.

**speaker2:** Every single CSP will use them.

**speaker2:** Including NVIDIA and everyone else. It's inevitable.

**speaker2:** Because OCS can genuinely bring down TCO costs and improve efficiency for CSPs, much more so than CPO. It's a sure thing.

**speaker1:** Do you have any quantitative figures for this? For example, after it's adopted for replacement.

**speaker2:** Yes, very simple. This year, Google has 18,000 units, and Microsoft has 2,000. Others like Amazon, NVIDIA, and Meta are all in discussions about how many they can get.

**speaker2:** That's the current demand.

**speaker2:** Next year, Google alone will have 30,000 units. Other CSPs have indicated at least 2,000 units each. So that's over 40,000 units, not even counting the others.

**speaker2:** Right? So that's over 40,000 units for next year.

**speaker2:** And going forward, this will definitely increase. Once a CSP deploys 2,000 units and sees that it works well, they will surely expand its use. There's no doubt about it.

**speaker2:** Because in the future, for on-board applications, the goal is to build larger and larger clusters. And larger clusters require more OCS.

**speaker2:** So we believe a 30% or even 50% compound annual growth rate for OCS is not an exaggeration.

**speaker1:** Understood.

**speaker1:** How much TCO is saved by replacing traditional electrical switches?

**speaker2:** It doesn't exactly... it replaces traditional electrical switches at the Spine layer.

**speaker2:** Yes, at the Spine layer, it replaces traditional electrical switches.

**speaker2:** For example, Google's architecture with 16 pods, which is 9,216 multiplied by 16, so about 140,000 to 150,000 cards in one large cluster. They use a total of 1,024 OCS units, and their entire TCO is reduced by 40%.

**speaker1:** 40%.

**speaker2:** The total TCO is reduced by 40%. That's real money.

**speaker1:** I see.

**speaker2:** Yes. How many OCS units did you say they used?

**speaker2:** 1,024 units.

**speaker1:** That corresponds to 9,216 TPU chips, right?

**speaker2:** No, it's 150,000 cards. One pod has 9,216, and they use 16 pods.

**speaker2:** 16 pods. So it's 16 times 9,216, which is close to 150,000 cards in one large cluster. They used a total of 1,024 OCS units. Compared to using electrical switches, their total TCO was reduced by 40%.

**speaker1:** I see, I understand.

**speaker2:** That's a real, tangible cost reduction. In North America, power consumption is a big deal. They said power savings were around 40% or 50%.

**speaker2:** And latency was reduced by 70%.

**speaker2:** So, the overall TCO, the cost, came down by 40%.

**speaker2:** It's staggering.

**speaker1:** Mm-hmm. Can this technology be extended to lower layers of the network in the future? To connect more...

**speaker2:** Yes, the current OCS architecture is like this...

**speaker2:** In the traditional Clos architecture, you have ToR-Leaf-Spine, right?

**speaker1:** Mm-hmm.

**speaker2:** So it's ToR-Leaf, and above that is the OCS.

**speaker2:** That's the current three-tier architecture. Other CSPs are buying OCS and using it in two places: one is at the Spine layer in the ToR-Leaf-Spine inter-rack architecture.

**speaker2:** The other is a two-tier architecture, where the ToR connects directly to the OCS above it.

**speaker2:** This is how CSPs are connecting their racks now.

**speaker1:** Is this like what Oracle is doing?

**speaker2:** Yes, it's similar to Oracle, but...

**speaker2:** actually, it's not just Oracle. All CSPs are doing it this way. Meta, Huawei, they all connect this way.

**speaker1:** I see.

**speaker2:** So, if I have fewer cards, I can have a ToR layer with OCS above it. If I have more cards, I can add another layer of OCS on top.

**speaker2:** This would allow me to connect even more, right?

**speaker1:** Oh, you can do that? So you can just add another layer on top.

**speaker2:** Yes, you can.

**speaker2:** Then my cluster can be made very large.

**speaker2:** Before this, the architecture was ToR, then Leaf, then Spine, and maybe another layer of Spine on top.

**speaker2:** Those are all electrical switches. The latency from the electrical switching between each layer is unavoidable. You have optical-to-electrical and electrical-to-optical conversions. With one electrical switch...

**speaker2:** an optical module goes in, one conversion, another conversion inside, so it's three O-E-O conversions.

**speaker1:** Ah, three O-E-O conversions.

**speaker2:** Yes, three O-E-O conversions to get the signal out.

**speaker1:** I see.

**speaker2:** So this is the tangible benefit of OCS. After other CSPs tested it, they confirmed that it does indeed help reduce their overall costs.

**speaker2:** This is why...

**speaker2:** someone like NVIDIA, they are currently designing custom port configurations.

**speaker1:** Mm-hmm.

**speaker2:** They are designing their own custom ports for OCS.

**speaker2:** They don't want to use 64 ports, or 288 ports.

**speaker2:** Right? Oracle, for example, uses 288-port OCS.

**speaker2:** Meta is now considering 288 as well. Microsoft might be looking at 64. So each company has different needs depending on their own architecture and how they want to connect things.

**speaker1:** I understand.

**speaker1:** The 30,000 units for Google next year you mentioned, is that a reliable figure?

**speaker2:** Yes, the data we have is not calculated based on their TPU shipments or anything like that. It's based on the forecast they gave us, or the capacity they asked us to reserve.

**speaker2:** The capacity.

**speaker1:** Oh, I see.

**speaker2:** Yes, that's how it's done. Because sometimes the market... like recently, some people might say Google will have 10 million, 6 million, or 8 million TPUs next year.

**speaker2:** If you calculate based on that, you could be way off. It's hard to say.

**speaker2:** How do you know for sure they can get that many TPUs? Right?

**speaker2:** You might say 4 million, but what if they get 5 million? So you never know.

**speaker2:** Nobody in the market really knows exactly how many TPU chips Google gets.

**speaker2:** Right?

**speaker2:** So, the demand we receive is based on Google's three-pronged approach.

**speaker2:** Google's OCS strategy has three parts. First is their in-house design.

**speaker2:** For their in-house design, Coherent supplies components, for example, the FAU.

**speaker2:** They will give you a forecast: this is the monthly volume for March, this is for July, this is for September, and this for January next year. You can just plot it out and get the total quantity.

**speaker2:** Right? That's for their in-house solution.

**speaker2:** Then there's the full system solution, which they source from Coherent and Lumentum. For example, 3,000 or 4,000 units from each.

**speaker2:** You just add it all up, and you get their total demand.

**speaker1:** Mm-hmm.

**speaker2:** Yes. They haven't approached companies like Polatis yet because their prices are too high.

**speaker2:** So that's the current situation. In the future, if Coherent and Lumentum can't deliver, they might go to Polatis. It's hard to say.

**speaker1:** I see.

**speaker1:** What is the competitive landscape for OCS between Lumentum and Coherent right now?

**speaker1:** And are there any other players who might be able to enter the market?

**speaker2:** From what we see now, it's basically just Coherent and Lumentum.

**speaker2:** For Google's external procurement, it's basically these two. As for other solutions, like the waveguide approach, they are currently facing some problems.

**speaker2:** We believe its insertion loss is too high, and the port count is too small.

**speaker2:** These are the issues they need to solve: insertion loss and large port counts. This is what the waveguide solution needs to address.

**speaker2:** It will likely be very difficult to solve these issues within the next one or two years. That's the current situation.

**speaker2:** As for the piezoelectric ceramic solution, the problem is that the cost is too high.

**speaker1:** Mm-hmm.

**speaker2:** For a 384-port switch, you would need 768 piezoelectric ceramics. Each one costs one or two thousand RMB. If you do it this way...

**speaker2:** Right?

**speaker1:** Mm-hmm.

**speaker2:** The cost becomes very high. And you still need to add other components. So that's the problem they are facing now. That's one thing.

**speaker2:** Secondly...

**speaker2:** other domestic companies are working on MEMS or liquid crystal solutions. Globally, only Coherent is doing liquid crystal.

**speaker2:** Many companies are now working on MEMS solutions. We feel that, as you may have seen in China, many listed companies are promoting MEMS.

**speaker2:** But right now, they can only provide samples, and some don't even have a demo sample.

**speaker2:** The samples you can actually send to customers for testing are not even ready. They might have shown a sample at OFC, but to go from a prototype to mass production, you can't do it without a year and a half of running tests.

**speaker1:** Mm-hmm.

**speaker2:** So from now until the middle of next year, or even until the end of next year, it will basically be just Coherent's full systems.

**speaker1:** I see. New players might only be able to enter in the second half of next year.

**speaker1:** It seems the liquid crystal solution has proven its advantages in stability and reliability, is that right?

**speaker2:** Yes.

**speaker1:** I don't quite understand why other companies aren't trying this solution or developing it.

**speaker2:** The main problem is they don't have the liquid crystal.

**speaker2:** It's not that other companies don't want to do it. They do, but they don't have the liquid crystal. It's a proprietary technology unique to Coherent.

**speaker2:** It's not that they don't want to. They do, but without the liquid crystal technology, you can't do it.

**speaker1:** Oh, I see. So it's not something you can buy off the shelf?

**speaker2:** It's like a chip.

**speaker2:** They make it themselves.

**speaker2:** Yes, they make it themselves.

**speaker2:** They make it in Suzhou. They acquired a company called Oclaro before. This liquid crystal technology is actually five years old.

**speaker1:** I see. That's the core of it.

**speaker2:** Yes, that's the core. As for MEMS, many companies are promoting it now because many can make it. They can just buy the chip and build a full system.

**speaker1:** I see.

**speaker2:** That's the logic. So this is also why in the market now, you might find it strange... why only Coherent is promoting liquid crystal and no one else. This is the reason.

**speaker2:** For MEMS, many can do it. You can just do a tape-out and it's pretty much done. So that's the concept.

**speaker1:** OK, I understand.

**speaker1:** One last thing, you mentioned thin-film lithium niobate earlier. What are its prospects? How do you see it?

**speaker2:** Thin-film lithium niobate right now is just too expensive. The cost is too high. From what we see, it's probably not the first choice for the industry. Yes, if in the future, a 400G single-channel EML costs the same as a thin-film lithium niobate modulator, then people might use it. I understand that a single thin-film lithium niobate modulator can cost several thousand RMB. It's very, very expensive.

**speaker1:** So it's mainly a price issue, right?

**speaker2:** Yes, it's mainly a price issue. Companies like InnoLight and Eoptolink have probably already developed the technology for silicon and thin-film lithium niobate modulation.

**speaker1:** I see.

**speaker2:** They've already done it. But the price is too high, so they can't use it. If, for example, a 400G EML is also very expensive, then they might promote it.

**speaker1:** Oh, I understand.

**speaker2:** It's all about comparison. For example, if for a future 2T module, a 400G EML costs only $200, and a 400G DSP is $200, $250, or $300, but your thin-film lithium niobate modulator alone costs $500, who would want to play with that?

**speaker1:** Right.

**speaker1:** Mm-hmm.

**speaker2:** So we believe that's the concept. Right now, in the industry, people are working on silicon-lithium niobate integration and silicon-indium phosphide integration.

**speaker2:** They are all working on it. It mainly comes down to cost. In a data center, optical modules are not like in coherent applications. For data center optical modules, our understanding is that when the volume is large, the price has to come down. If your volume is huge but your price can't come down, nobody will use it.

**speaker2:** Coherent optical modules are different. The volume is small, but they transmit over long distances. The usage isn't as high, so people can accept a higher price.

**speaker2:** That's how it is.

**speaker1:** Understood.

**speaker2:** Mm-hmm.

**speaker1:** Alright, I think that's all my questions. You've answered them all very clearly.

**speaker2:** Let's wrap it up for today. If I have more questions later...

**speaker2:** These are just my personal opinions and some observations from the market.

**speaker1:** I understand. We were mainly discussing the general situation of the industry, right?

**speaker2:** Yes, exactly.

**speaker1:** Okay, great. Thank you.

**speaker2:** Mm-hmm.

**speaker1:** Okay, bye-bye.

**speaker2:** Alright, okay, bye-bye.