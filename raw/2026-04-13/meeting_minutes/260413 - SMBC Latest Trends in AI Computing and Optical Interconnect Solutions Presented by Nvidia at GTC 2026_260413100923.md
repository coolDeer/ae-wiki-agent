# 260413 - SMBC Latest Trends in AI Computing and Optical Interconnect Solutions Presented by Nvidia at GTC 2026

# AI总结

## The Rise of Custom Chips (XPUs) and Their Impact
- **Hyperscalers' Custom Chips as NVIDIA Competitors**: Custom chips (XPUs) from hyperscalers like Google (TPU) and Amazon (AWS Trainium) are gaining significant traction as powerful alternatives to NVIDIA's GPUs.
  - Driving factors: Superior cost-performance (e.g., AWS claims 30-40% better) by cutting out NVIDIA's high profit margins, and alleviating NVIDIA's supply constraints.
  - Key players: Google and AWS are notable for selling their custom chip capacity externally, while Meta uses its chips internally. Microsoft remains the most dependent on NVIDIA.
- **Google's TPU Technology and Market Momentum**: Google's Tensor Processing Unit (TPU) showcases a unique and advanced architecture, driving significant market adoption.
  - Major contract: A large-scale, multi-year deal with Anthropic for 3.5 GW of TPU capacity, operational in 2027. This single deal is comparable to Microsoft's entire annual capacity expansion.
  - Unique Network Architecture:
    - Utilizes a proprietary switch-less protocol called ICI (Inter-Chip Interconnect) across the entire Superpod, unlike NVIDIA's use of InfiniBand/Ethernet with switches.
    - Employs software-based, pre-scheduled data routing ("deterministic execution") instead of relying on switch chips to read packet headers.
    - Adopts a 3D Torus topology for dense, direct chip-to-chip connections.
  - Key Technology Enablement (OCS): The deterministic network allows for the use of Optical Circuit Switches (OCS), which physically redirect light signals with mirrors.
    - Benefits: Saves nearly 90% of power by avoiding optical-electrical-optical conversions and eliminates associated latency.
    - Market Impact: Lumentum, which commercializes Google's custom OCS ("Paloma"), has seen its order backlog surge from a projected $10 million/quarter to over $400 million, indicating explosive demand from H2 2024.
- **AWS's Custom Chip Business Growth**: Amazon's custom chip division has become a major business with strong market demand.
  - Business scale: Achieved triple-digit growth, becoming a business with over $10 billion in annual revenue.
  - High demand: The latest generation chip, Trainium 3, is experiencing extremely high demand and was expected to be fully allocated (sold out) by mid-2024.

## NVIDIA's Strategy and New Rubin Platform from GTC 2024
- **The "Token Economy" as a Core Strategy**: NVIDIA's GTC 2024 focused on the concept that generating tokens is the primary driver of value and revenue in the AI economy.
  - Value of tokens: The price per token varies significantly by model quality, with premium models (e.g., Claude Mythos at $125/million tokens) costing 10-20x more than older ones. Efficiently generating high-quality tokens is directly linked to revenue.
  - Market shift: The market now prioritizes stable service delivery and high-quality token generation over low cost, as evidenced by the decline of DeepSeek after multiple system failures.
- **Introduction of the Rubin Platform and Disaggregation**: NVIDIA's next-generation Rubin platform, entering mass production in H2 2024, moves towards a disaggregated, hybrid system.
  - New rack components: The system is now based on five core rack types.
    - **LPU Rack**: Incorporates the new Language Processing Unit (LPU) specialized for high-speed token generation (inference).
    - **Tera CPU Rack / Vera CPU Rack**: A separate rack to orchestrate the entire large-scale node.
    - **AI-Native Storage Rack**: Provides storage for inference tasks that require referencing large amounts of background information.
    - Complemented by existing GPU and Spectrum-X Switch racks.
- **The LPU (Language Processing Unit) and Grok Acquisition**: The LPU, a core part of the Rubin platform, is based on technology acquired from Grok.
  - NVIDIA's investment: A massive $20 billion licensing deal with Grok to acquire its inference-specialized semiconductor technology and talent, effectively acquiring technology with Google TPU DNA (Grok's founder was a core designer of Google's first TPU).
  - LPU vs. GPU Design Philosophy:
    - **GPU**: Focuses on parallel processing of large data chunks at once, relying on large external HBM memory (e.g., 288 GB). Excels at tasks like loading large contexts.
    - **LPU**: Specialized for fast, sequential processing of small data chunks, ideal for the step-by-step nature of token generation (inference). It uses very little internal memory (e.g., 500 MB) but has much higher data transfer bandwidth.
  - LPU's Core Technology:
    - **Deterministic Execution**: Like the TPU, it uses a compiler to pre-schedule all data movements and calculations, eliminating latency from dynamic routing and collisions.
    - **Integrated Switch**: The C2C (chip-to-chip) communication module is integrated inside the LPU, allowing for direct, dense connections without external switch chips.
- **"NVIDIA Dynamo": The GPU + LPU Hybrid System**: NVIDIA's proposed optimal solution is a hybrid system combining the strengths of GPUs and LPUs.
  - Division of labor: The GPU handles memory-intensive tasks like loading the KV cache, while the LPU handles the actual high-speed token generation.
  - Performance and Revenue Impact: This combination is claimed to increase token generation efficiency by up to 35 times. NVIDIA argues that by enabling premium inference services, the Dynamo system can generate double the revenue of a Rubin GPU-only setup ($150 billion annually per gigawatt).
- **Demand Forecast and Future Roadmap**: The new hybrid system is expected to significantly increase demand for optical components.
  - LPU rack optics: LPU racks are projected to require more optical ports than GPU racks due to their dense connectivity needs.
  - OCS demand drivers: The ramp-up of Google's 3.5 GW TPU cluster and the deployment of NVIDIA's LPU rack systems are expected to be the main drivers of the explosive OCS demand from H2 2024.
  - Future roadmap (CPO): NVIDIA CEO Jensen Huang explicitly stated that by 2028, the "Feynman" platform will incorporate Co-Packaged Optics (CPO) for intra-rack communication.

## The Emergence of AI Agents and Broader Market Trends
- **AI Agents as the Next Major Trend**: 2024 is projected to be the year the AI agent market takes off explosively.
  - Open-Claw: An open-source program for creating custom AI agents using natural language, which saw explosive user adoption in just a few months. It allows users and companies to build their own agents using models like GPT or Claude.
  - Market boom: A significant movement, especially in China, has emerged around building businesses by renting out custom AI agents (a trend dubbed "raising lobsters").
  - Hardware impact: The practice of running agents on separate compact PCs for security has led to a surge in demand for devices like the Mac Mini and Raspberry Pi.
- **NVIDIA's Evolution to an Infrastructure Vendor**: NVIDIA is positioning itself as a full-stack infrastructure vendor for "AI Factories," not just a chip supplier.
  - AI Factory design: It uses virtual simulations to help clients design optimal data centers, incorporating an ecosystem of partner products from cooling to other components.
  - Space Data Centers: NVIDIA is exploring AI data centers in space, primarily to process the massive amounts of data collected by satellites in-orbit, overcoming the bottleneck of transmitting all the data back to Earth.

## Key Developments in the Optical Communications Industry (OFC 2024)
- **Industry-Wide Shift to Multi-Source Agreements (MSAs)**: A key theme at OFC 2024 was the establishment of numerous MSAs to combat severe and worsening supply constraints for optical components in AI computing.
  - Rationale: By creating common specifications from the outset, the industry aims to ensure an ecosystem of multiple suppliers, preventing bottlenecks that could disrupt production from H2 2024 onwards.
- **Major Technology and Standards Announcements**:
  - **1.6 Tera Era**: The industry has officially entered the 1.6 Tera era, with multiple companies announcing solutions.
  - **XPO Form Factor**: A new, large transceiver module standard led by Arista, designed for ultra-high-density AI clusters. It integrates eight MPO connectors, handling up to 1024 fibers in a single module.
  - **Open Compute Interconnect (OCI)**: An MSA (Microsoft, Broadcom, Meta, etc., with NVIDIA joining) that standardizes the physical layer (connectors, modulation) for scale-up optical solutions to ensure supply stability, while remaining protocol-agnostic (can be used for NVLink, Ethernet, etc.).
  - **Multi-Core Fiber MSA**: An agreement between Fujikura, Corning, Sumitomo Electric, and others to standardize multi-core fiber, which can carry four times the information of a standard fiber, to support the exponential growth in optical cabling for TPUs and LPUs.
  - **Silicon Photonics Democratization**: TSMC has released a comprehensive Process Design Kit (PDK) for silicon photonics, enabling a wider range of companies to design and manufacture custom silicon photonics chips using its foundry services.

## Long-Haul Market and Overall Industry Outlook
- **Surging Demand in Long-Haul Networks**: Demand is growing not just within data centers but also for long-haul networks connecting them.
  - Lumen's AI network: The company is receiving huge orders for its PCF (dedicated AI network), where hyperscalers pre-pay construction costs for rapid fiber deployment. The network is being progressively upgraded to 800G and 1.6T.
  - Construction boom: Dycom, the largest optical cable company, is experiencing historic sales growth and holds a large order backlog to support this build-out.
- **Prediction of a Historic "Super Cycle"**: The convergence of demand from AI data centers and government-funded projects (like the BEAD project) is expected to create unprecedented growth.
  - Timing: The optical fiber industry is projected to enter a historic super cycle starting from the second half of 2024.

## Q&A Session
- **Will the LPU replace the CPU?**: No, their roles are fundamentally different.
  - A CPU is a general-purpose command center that orchestrates an entire system.
  - An LPU is a highly specialized chip designed for the single task of high-speed token generation, consisting of simple memory, vector/matrix units, and communication modules.
- **Will Samsung manufacture the LPU and what is the impact on HBM?**:
  - **LPU Manufacturing**: It is highly probable that Samsung's foundry will manufacture the LPU, as its simpler design does not require TSMC's most advanced processes.
  - **HBM Impact**: HBM demand will not decrease. The GPU+LPU (Dynamo) system relies on role-sharing; the GPU still requires massive amounts of HBM (e.g., 288 GB) to load large contexts, while the LPU handles computation. HBM demand is expected to continue growing strongly.
- **Will the value of older GPUs like Hopper decline?**: This is not a major concern.
  - There is still strong demand for previous generations like Hopper and H100.
  - Different services have varying inference needs, and smaller companies can adequately build systems with older-generation GPUs for less demanding models. No signs of a price collapse have been observed.
- **What is the outlook for CPO (Co-Packaged Optics) in 2028?**: The mainstream approach will likely involve an external laser source.
  - Separating the light source from the hot ASIC (switch chip) is crucial for reliability and maintainability, as the heat from the ASIC can damage the laser. The industry trend is towards pluggable optical engines separate from the ASIC.
- **Who has the upper hand: GPU+LPU hybrid vs. XPUs?**: It's a competitive race.
  - **NVIDIA (GPU+LPU)**: Likely has the edge in raw computational power relative to the power budget. NVIDIA is still strong.
  - **XPUs (e.g., Google TPU)**: Have an advantage in cost-performance. The XPU camp is rapidly increasing its presence, as shown by Google's massive 3.5 GW deal with Anthropic, and is building an "encirclement of NVIDIA."
- **Will CPO adoption cause the copper cable business (DACs, ACCs) to decline?**: Yes.
  - As intra-rack wiring for AI clusters shifts from metal to optical, the demand for copper cables in this application is expected to decline significantly, similar to how fiber replaced copper in telephone lines.
- **What is the supply capacity outlook for optical fiber?**: The situation is very tight, and a shortage is very possible.
  - Leading suppliers like Corning, Fujikura, and Furukawa are working to expand production.
  - Sumitomo has the most potential to increase production, as it currently has surplus preform and fiber capacity that it is supplying to competitors like Corning.
- **What is the price outlook for optical products?**: Prices are already rising and are expected to increase more significantly in H2 2024.
  - This trend is seen across semiconductors (e.g., Intel's price hikes).
  - For optical devices, a bottleneck in indium phosphide capacity is expected. Hyperscalers will likely use their financial power to secure supply, driving prices up.

# QA总结

**Q: What are the latest developments and key characteristics of custom chips (XPUs) from hyperscalers like Google and AWS, and how do they compete with NVIDIA?**
A: The key developments are as follows:
1.  **Market Momentum**: Hyperscalers are increasingly developing their own custom chips (XPUs) as powerful alternatives to NVIDIA's GPUs, driven by NVIDIA's supply constraints and the superior cost-performance of custom solutions. Google (TPU) and Amazon (AWS Trainium) are leading this trend by also offering their chips for external sales.
2.  **Google's TPU and Major Contracts**: Google's TPU is gaining significant traction, highlighted by a massive, multi-year contract with Anthropic for 3.5 GW of computing capacity, set to be operational in 2027. This single deal is nearly equivalent to the annual capacity expansion of Microsoft, a major AI service provider.
3.  **AWS Custom Chip Business**: Amazon announced that its custom chip business (featuring Trainium) is now a business with triple-digit growth, exceeding $10 billion in annual revenue. They claim 30-40% better cost-performance compared to GPUs by eliminating NVIDIA's high profit margins (65% operating margin). Demand for the latest Trainium 3 is so high it is expected to be fully allocated by mid-2024.
4.  **Google TPU's Unique Architecture**:
    *   **Proprietary Interconnect (ICI)**: Unlike NVIDIA which uses NVLink and InfiniBand/Ethernet, the TPU uses a unique protocol called ICI (Inter-Chip Interconnect) for all communication.
    *   **Deterministic Networking**: ICI does not use switch chips. Instead, a software program pre-schedules all data transmission paths and timings, ensuring a smooth, predictable data flow. This is known as deterministic execution.
    *   **Enabling Optical Circuit Switches (OCS)**: This software-controlled networking is a key feature that enables the use of OCS, which physically redirects optical signals using micro-mirrors.
    *   **OCS Benefits**: OCS saves nearly 90% of power and eliminates latency by avoiding optical-to-electrical-to-optical signal conversions that occur in traditional switches. This has led to a surge in demand for OCS, with Lumentum's order backlog exploding from a $10 million quarterly business to over $400 million, primarily driven by Google's custom "Paloma" OCS.
    *   **Superpod Topology**: The TPU Superpod uses a 3D Torus topology, with TPUs connected directly to each other, requiring a very large amount of optical cabling.

**Q: What was NVIDIA's core strategy revealed at GTC 2024, particularly regarding its next-generation "Rubin" platform?**
A: NVIDIA's strategy is centered on dominating the "token economy" and evolving from a chip supplier to a full AI infrastructure vendor. Key elements include:
1.  **Focus on the "Token Economy"**: The central theme was that generating tokens directly translates to revenue. Premium AI models command significantly higher prices per token (e.g., $150/million) compared to commodity models (e.g., $3/million), and NVIDIA's new platforms are designed to maximize the generation of these high-value tokens.
2.  **Next-Generation "Rubin" Platform**: The "Rubin" platform, entering mass production in the second half of this year, is a disaggregated, hybrid system.
3.  **Introduction of New Specialized Racks**: The system is now based on five core rack types, moving beyond just GPUs:
    *   **LPU Rack**: A new rack featuring inference-specialized LPUs (Language Processing Units) for high-speed token generation, positioned as a counter to XPUs/TPUs.
    *   **Tera CPU Rack**: A dedicated rack to act as the orchestrator for large-scale nodes.
    *   **AI-Native Storage Rack**: To handle the large volumes of background information needed for inference.
    *   These are integrated with the existing **GPU Rack** and **Spectrum-X Switch Rack**. This disaggregation makes the inter-rack communication managed by the Spectrum-X switch even more critical.

**Q: Can you provide a detailed comparison between NVIDIA's GPUs and the new LPUs (from Grok), including their architecture, design philosophy, and how they are combined in NVIDIA's "Dynamo" system?**
A: The comparison and combination are as follows:
1.  **Acquisition of LPU Technology**: NVIDIA effectively acquired the LPU technology and talent from Grok (a company founded by a Google TPU designer) through a major $20 billion licensing deal.
2.  **Opposite Design Philosophies**:
    *   **GPU**: Designed for massive parallel processing. It excels at processing very large chunks of data at once, making it ideal for training. It relies on large amounts of HBM (e.g., 288 GB), and its production is bottlenecked by TSMC's CoWoS packaging.
    *   **LPU**: Designed for high-speed sequential processing, which is characteristic of inference (generating one token after another). It uses a tiny amount of on-chip SRAM (e.g., 500 MB) but has a data transfer bandwidth seven times faster than a GPU. It achieves high throughput by processing small chunks of data at extremely high speeds. Its manufacturing process is very simple, making it easy to mass-produce.
3.  **Deterministic Execution**: Similar to Google's TPU, the LPU's key feature is its compiler, which pre-schedules all data movements and calculation timings. This "deterministic execution" eliminates delays and jitter. The LPU chip integrates its own chip-to-chip (C2C) communication protocol, allowing LPUs to be connected directly without external switch chips.
4.  **"NVIDIA Dynamo" Hybrid System**:
    *   **Role Division**: NVIDIA's proposed solution is a hybrid system called "Dynamo" that combines GPUs and LPUs. The GPU, with its large memory, handles memory-intensive tasks like loading the context (KV cache). The LPU then takes over the actual high-speed process of generating tokens.
    *   **Performance Gain**: By letting each component do what it does best, NVIDIA claims this system can increase token generation efficiency by up to 35 times compared to a GPU-only system.
    *   **Business Case**: NVIDIA argues that this system has a high ROI, as it enables the premium inference workloads that generate significantly higher revenue (potentially double that of a Rubin-only setup).

**Q: What is the market outlook for LPUs and their impact on demand for optical components like Optical Circuit Switches (OCS)?**
A: The outlook is very strong, with LPUs expected to significantly boost demand for optical components.
1.  **LPU Deployment Forecast**: It is forecasted that for a standard hyperscaler inference pod, the number of LPU racks will be close to half or slightly more than the number of GPU racks (NVIDIA proposed a 5 LPU to 8 GPU rack ratio).
2.  **Increased Optical Port Demand**: An LPU rack system is expected to be equipped with more optical ports than GPU racks due to its dense connectivity requirements. Each LPU rack has multiple transceiver ports for inter-rack communication, leading to a net increase in overall optical demand from the hybrid GPU+LPU system.
3.  **Driving OCS Demand**: The explosive growth in demand for Optical Circuit Switches (OCS) starting in the second half of this year is expected to be driven by two main factors:
    *   The ramp-up of Google's 3.5 GW TPU cluster.
    *   The deployment of these new LPU rack systems, which, like TPUs, benefit from the OCS architecture.

**Q: What is the future roadmap for NVIDIA's platforms, and what significant trends, like AI agents, were highlighted at GTC?**
A: NVIDIA's roadmap points towards deeper optical integration, and the market is rapidly moving towards AI agents.
1.  **Future Roadmap and CPO Adoption**: NVIDIA CEO Jensen Huang explicitly stated that by 2028, the "Feynman" platform will use optical CPO (Co-packaged Optics) even for intra-rack NVLink switches. This signals a clear move towards full optical integration within the rack, starting with scale-out CPO this year and scale-up CPO within two years.
2.  **AI Agents as the Next Big Wave**: GTC's overarching theme was the rise of AI agents. 2024 is projected to be the year this market takes off explosively.
3.  **Open-Claw**: This open-source program for creating custom AI agents has seen explosive growth in just a few months, especially in China, where a trend of "raising lobsters" (the Open-Claw motif) has emerged for building businesses around AI agents. This trend is also driving demand for small, dedicated PCs (like Mac Mini) to run agents securely.

**Q: What were the key takeaways from OFC 2024 regarding the optical communications industry's response to AI-driven demand?**
A: The industry is responding to severe supply constraints by standardizing and accelerating technology adoption.
1.  **Proliferation of MSAs**: A key trend was the establishment of numerous Multi-Source Agreements (MSAs). The industry is proactively creating common specifications to ensure a multi-vendor ecosystem and prevent supply bottlenecks for critical AI computing components.
2.  **Key MSA Initiatives**:
    *   **Open Compute Interconnect**: An MSA involving Microsoft, Broadcom, Meta, NVIDIA, and others to standardize the physical layer (connectors, modulation) for scale-up optical solutions.
    *   **Multi-Core Fiber MSA**: Launched by Fujikura, Corning, and Sumitomo Electric to standardize multi-core fiber, which can carry four times the information of a standard fiber and is becoming critical to support the exponential increase in cabling for TPUs and LPUs.
3.  **Technology Acceleration**:
    *   **1.6 Tera Era**: Solutions for 1.6T are already being announced by multiple companies.
    *   **New Form Factors**: Arista is leading a new standard for ultra-high-density transceiver modules (XPO) designed for AI clusters.
    *   **Democratization of Silicon Photonics**: TSMC has released a comprehensive Process Design Kit (PDK), enabling more companies to design and manufacture silicon photonics chips using its foundry.

**Q: Beyond the data center, what is happening in the long-haul network market, and what is the overall outlook for the optical fiber industry?**
A: The demand is extending to long-haul networks, signaling a massive growth cycle for the entire industry.
1.  **Long-Haul AI Networks**: Companies like Lumen are receiving huge orders for dedicated AI networks (PCF), with hyperscalers pre-paying the massive construction costs to ensure rapid build-out. These networks are being progressively upgraded to 800 Gbps and 1.6 Tbps.
2.  **Supply Chain Growth**: Optical communication cable companies like Dycom are experiencing historic sales growth and hold large order backlogs to support this construction.
3.  **"Historic Super Cycle"**: The consensus is that starting from the second half of 2024, the combination of demand from AI data centers, long-haul network build-outs, and government projects (like the BEAD project) will push the optical fiber industry into a historic super cycle.

**Q: Based on the Q&A session, what are the key clarifications on LPU manufacturing, its impact on HBM, and its role compared to a CPU?**
A: The following clarifications were made:
1.  **LPU vs. CPU**: They serve fundamentally different purposes. A CPU is a complex command center that orchestrates an entire system. An LPU is a very simple chip specialized for the sole purpose of generating tokens at high speed and is designed for direct, dense interconnection with other LPUs, not through a switch.
2.  **LPU Manufacturing**: The LPU chip has a simple design and does not require the most advanced processes. There is a very high probability it will be manufactured by Samsung's foundry, as it is fully capable of producing it.
3.  **Impact on HBM Demand**: The rise of the LPU will **not** reduce the demand for HBM. The GPU+LPU "Dynamo" is a hybrid system where each component is essential. The GPU, with its massive 288 GB of HBM, is still absolutely necessary for memory-intensive tasks like loading large contexts. HBM demand is expected to continue growing strongly.

**Q: What is the competitive outlook between NVIDIA's GPU+LPU system and the hyperscalers' XPUs, and what is the future for older GPU generations?**
A: The competitive landscape is intensifying, but the market can support multiple solutions.
1.  **GPU+LPU vs. XPU**:
    *   **NVIDIA**: The GPU+LPU hybrid system likely has an advantage in terms of computational power relative to its power budget. NVIDIA remains in a very strong position.
    *   **XPU Camp**: XPUs (like Google's TPU) have an advantage in cost-performance. The XPU camp is mounting a serious offensive and rapidly increasing its presence, as shown by Google's massive contract with Anthropic and Meta's custom chip roadmap. The encirclement of NVIDIA is steadily being constructed.
2.  **Value of Older GPUs**: There is still very strong demand for previous generations like the Hopper (H100). There is a wide range of inference needs, and smaller companies or less demanding models can be adequately served by these GPUs. NVIDIA is also selling models like the H200 to markets like China. No price collapse for older models has been observed.

**Q: What is the outlook for CPO adoption, copper cabling, optical fiber supply, and the pricing of optical components?**
A: The outlook points to a shift to optical, potential supply shortages, and rising prices.
1.  **CPO in 2028**: The mainstream approach for CPO will likely involve an external laser source separated from the ASIC. This is for better thermal management (as the switch chip's heat can damage the laser) and improved maintainability.
2.  **Decline of Copper Cables**: For AI clusters, the demand for copper cables (like DACs and ACCs) will decline as intra-rack wiring continues to shift from metal to optical fiber.
3.  **Optical Fiber Supply Capacity**: A supply shortage is very possible. While Corning, Fujikura, and Furukawa are working to expand production, their capacity is tight. Sumitomo is seen as having the most potential to increase production, as it has surplus fiber capacity.
4.  **Price Outlook**: Prices for both optical fiber and devices are already rising and are expected to increase more significantly in the second half of this year. Bottlenecks in key materials (like indium phosphide) and immense demand from hyperscalers with strong purchasing power will drive prices up.

# 原文提炼

**speaker1:** It is now 11:30. Thank you for joining the SMBC Nikko Securities Lunchtime Seminar.

**speaker1:** Today, we are pleased to welcome Mr. Hasegawa, CEO and founder of JST Consulting, who will speak for an hour on the optical fiber market.

**speaker1:** Recently, the stock prices of related companies have been very strong, for example, Lumentum, Corning, and in Japan, Furukawa and Fujikura. I believe today's talk will shed considerable light on what is behind this strength.

**speaker1:** Mr. Hasegawa, thank you again for joining us.

**speaker1:** As usual, he will present for about 55 minutes. During that time, please feel free to type your questions into the Q&A box. I will read them out at the end for the Q&A session.

**speaker1:** Mr. Hasegawa, please begin when you are ready.

**speaker2:** This is Hasegawa from JST Consulting. Thank you for having me today.

**speaker2:** Last month, in March, GTC 2024 was held in Silicon Valley, an event that can now be described as the world's largest tech event. Today, I'd like to focus on the content from that event to examine what is happening in the AI industry and its impact on the optical communications market.

**speaker2:** First, before we look at the main contender, NVIDIA, I would like to start by examining the market for XPUs, the custom chips developed independently by hyperscalers, which are rapidly increasing their presence as competitors to NVIDIA's GPUs.

**speaker2:** Page 3. It all began last October when Google and Anthropic announced a massive cloud contract, which rapidly drew attention to Alphabet.

**speaker2:** Page 4 shows the stock prices of NVIDIA and Alphabet. You can see that Alphabet's stock price has been soaring since around last summer.

**speaker2:** Amid this situation, a series of large contracts for Google's TPUs has led to speculation that they could become a powerful alternative to NVIDIA for AI computing solutions. Since last year, there has been a lot of attention on whether TPUs, which are more specialized for inference compared to NVIDIA's general-purpose GPUs, can carve out a piece of NVIDIA's market.

**speaker2:** Page 5 provides a simple summary of the custom chips from various hyperscalers, including Google, Amazon, and Meta. Our firm is particularly focused on Google and Amazon, as they have expanded their business to include external sales.

**speaker2:** Among these, the recently announced large-scale, multi-year contract between Google and Anthropic for 3.5 GW is particularly noteworthy. This contract, set to become operational in 2027, is a major deal that will generate enormous demand.

**speaker2:** To put this in perspective, the computing capacity that Microsoft launched from October to December of last year was 1 GW. This single deal is nearly equivalent to the annual capacity expansion of Microsoft, the largest AI service provider. Google is essentially providing a nation-state-level AI data center to Anthropic.

**speaker2:** Originally, Anthropic used a system built on AWS's custom chip, Trainium. However, that capacity was completely insufficient, and they have now adopted a dual-strategy approach using both AWS and Google.

**speaker2:** Now, let's look at AWS, Anthropic's original partner, and their custom chip business. On page 6, during their earnings announcement in February, Amazon revealed that their custom chip business has become a business with triple-digit growth, exceeding $10 billion in annual revenue. They stated that it achieves 30 to 40% better cost-performance compared to GPUs.

**speaker2:** NVIDIA's operating profit margin is said to be around 65% and its gross margin is 75%. By cutting out this middleman profit, custom chips can achieve high cost-performance.

**speaker2:** The rapid expansion of the custom chip market is due to two factors: one is NVIDIA's supply constraints, and the other is undoubtedly the market's acceptance of this superior cost-performance.

**speaker2:** Demand for the latest generation, Trainium 3, is extremely high, and Amazon has stated that it is expected to be almost fully allocated, essentially sold out, by the middle of this year.

**speaker2:** With the growing demand for custom chips, today I want to do a deep dive into what can be considered the pinnacle of this technology: the TPU.

**speaker2:** I will be referencing Google's presentation from the OCP Global Summit last October.

**speaker2:** Although the TPU has been in development for 10 years, we are particularly interested in the fourth generation and beyond, since 2022. The most significant feature of the TPU is its proprietary communication technology.

**speaker2:** While NVIDIA uses NVLink within a rack and InfiniBand or Ethernet between racks, the TPU uses a unique protocol called ICI, or Inter-Chip Interconnect, for all communication across the entire Superpod.

**speaker2:** Typically, with NVLink or Ethernet, a switch chip reads the header information at the front of a data packet to determine the destination, route, and timing for sending the data. It organizes this traffic to form the network.

**speaker2:** However, ICI does not use a switch chip at all. Instead, a software program pre-schedules the order and path for data transmission, ensuring a constant, smooth flow of data. Using software to control network paths without going through a router is becoming mainstream in high-speed networking, and this is precisely what has been brought into the AI cluster. This programmatic network control is the biggest feature of the TPU.

**speaker2:** The greatest benefit this provides is that it enables the introduction of the OCS, or Optical Circuit Switch.

**speaker2:** As I explained in my last presentation, an OCS is a switch that physically redirects signals from one fiber to another by changing the angle of microscopic mirrors.

**speaker2:** This avoids the process of converting an optical signal to an electrical signal, performing calculations within a chip to determine the route and timing, and then converting it back from electrical to optical. By eliminating the power consumed by transceivers and chips in this process, it can save nearly 90% of the power. Not only that, but it also thoroughly eliminates the latency incurred during these steps.

**speaker2:** This is all made possible by what is called deterministic execution—transferring data according to a pre-set schedule. This is a unique feature of the TPU's network architecture.

**speaker2:** At Lumentum's earnings call in February, they reported a surge in demand for OCS. What was once a $10 million per quarter milestone has now turned into an order backlog exceeding $400 million, with the majority scheduled to ship in the second half of this year. This means OCS demand, originally projected at $10 million per quarter, is now exploding, backed by a $400 million backlog.

**speaker2:** As for this OCS, Google has been the only one in the industry to deploy its own custom-designed OCS, called "Paloma," since 2022. Google handled the design, while Lumentum managed the commercialization and mass production, which has supported Lumentum's OCS business until now. The market is set to grow explosively from the second half of this year through the second half of 2026. We will gradually explore what is driving this.

**speaker2:** In any case, the Google TPU Superpod uses a 3D Torus topology. This requires densely connecting adjacent TPUs. Unlike NVLink, where a GPU always connects to another GPU via a switch chip, TPUs connect directly to each other to form the configuration. A Superpod is constructed using 9,200 TPUs, comprised of 144 racks with 64 chips each. This system uses a very large amount of optical cabling. Although the slide says it requires transceivers, the use of OCS on the switch side has significantly reduced the number of transceivers needed. This benefit allows it to claim an overall power-saving advantage over GPU systems.

**speaker2:** On page 13, I have summarized the latest trends in custom chips for Google, AWS, Meta, and also Microsoft. The two camps with their own chips, Google and AWS, are currently showing strong momentum in the custom chip space. Meta primarily uses its chips for its own clusters, while Microsoft is the camp most dependent on NVIDIA.

**speaker2:** Furthermore, while Meta and Microsoft use traditional Ethernet, which relies on packet headers and switches for data exchange, AWS and Google are on a different path, using their own unique topologies. I hope you will keep this in mind as we conclude Chapter 1.

**speaker2:** Now that we've looked at the latest trends in TPUs, a competitor to NVIDIA's GPUs, let's see what kind of strategy NVIDIA unveiled at GTC.

**speaker2:** This year's GTC was relentlessly focused on the "token economy." The message was that tokens are what create value and drive the economy, emphasizing how many tokens can be generated. That was the central theme of the keynote speech.

**speaker2:** After promoting the evolution of his company's GPU calculation capabilities, CEO Jensen Huang referred to himself as the "king of inference" and the "king of tokens," boasting about NVIDIA's strength.

**speaker2:** A key point that was emphasized is that token generation directly leads to a company's revenue. Therefore, for an engineer, their value is determined by how much they can increase productivity within a limited token generation quota. That was the impression given.

**speaker2:** And indeed, the economy driven by tokens has become a massive market. In another session, Jensen Huang mentioned that if an engineer with a salary of $500,000 a year doesn't incur at least half of that, $250,000, in token costs, then that engineer has a serious problem. Their qualifications as an engineer would be questioned. It's gotten to the point where, for hyperscaler-level companies, the token cost for their own development is said to be approaching 100 or 200 billion yen per month. The value created and consumed by tokens has become immense.

**speaker2:** Page 17. To demonstrate that "tokens are currency," I've compiled a price list for input and output from Anthropic, OpenAI, and Google. The more premium the model, the higher the price per token.

**speaker2:** The latest model, Claude Mythos, which was just announced last week, costs $125 per million tokens. This is 10 to 20 times the price of older models, showing how much the value has increased. Efficiently generating tokens for premium services is now directly linked to a company's revenue.

**speaker2:** Looking at this chart, it's striking how cheap the tokens for DeepSeek are, the company that caused the "DeepSeek Shock" a year ago. However, we hardly hear about DeepSeek anymore, and they are continuously losing users.

**speaker2:** From what I know, the background to this is that DeepSeek has had about six system failures since last year. The failure in March was particularly bad; the service went down for about six hours. For companies that have built systems and are providing services using DeepSeek, such a disruption causes significant losses. No matter how cheap the tokens are, the market has shifted to demand stable service delivery and high-quality token generation. DeepSeek was able to create a model on top of OpenAI, but they failed to provide a stable service, and so they have faded away.

**speaker2:** The role demanded of GPUs, TPUs, and XPUs has become centered on providing services that can generate tokens for these premium AI models.

**speaker2:** Amidst this, on page 18, NVIDIA announced the final form of its next-generation platform, Rubin, which will go into mass production in the second half of this year.

**speaker2:** Three new types of rack systems were introduced. First, the LPU rack, which incorporates the much-talked-about LPU and is specialized for high-speed token generation. This can be seen as their trump card against the XPU and TPU camp.

**speaker2:** As nodes get larger, a new Tera CPU rack has been systemized as a separate rack to act as the orchestrator for the entire node.

**speaker2:** Additionally, for inference, which constantly needs to reference large volumes of background information, an AI-native storage rack has been added. With these three new racks, the system configuration is now based on five core rack types, including the GPU rack and the switch rack.

**speaker2:** Right now, there is a shortage of flash memory, and prices have doubled compared to the previous quarter. This memory shortage is becoming severe, and it is precisely this AI computing demand that is now consuming memory at an explosive rate.

**speaker2:** Looking at the overall system, NVIDIA proposed a Superpod configuration example with eight NVL72 GPU racks. To complement this, there are five LPU racks, plus eight CPU racks. In addition, there is one Vera CPU rack as the orchestrator and one storage rack. This forms a very large-scale node.

**speaker2:** Because the number and variety of racks have increased so much, the role of the Spectrum-X switch rack, which handles inter-rack communication, has become even more critical.

**speaker2:** On page 20, I have summarized the features and specifications of each rack, from the GPU rack to the LPU and CPU racks. This summary is presented from our firm's unique perspective. What we want to highlight is the newly introduced LPU rack and the CPU rack that manages the overall communication. We believe these racks are particularly important components of the system.

**speaker2:** In this way, NVIDIA is now shifting towards a hybrid system through disaggregation, where functions that were once all handled by the GPU are now separated.

**speaker2:** With that in mind, I want to take a deeper look at the LPU and the company that created it, Grok.

**speaker2:** Grok first gained widespread public attention at the end of last year with an article announcing a major licensing agreement with them. As part of the deal, executives including CEO Jonathan Ross joined NVIDIA, allowing them to acquire Grok's inference-specialized semiconductor technology and talent.

**speaker2:** On page 22, I have listed NVIDIA's past investments and acquisitions. I've updated the slide from the distributed version to include Coherent and Lumentum. As you can see, this deal, at $20 billion or 3.2 trillion yen, vastly surpasses the acquisition of Mellanox, which turned NVIDIA into the world's largest networking company. This shows just how badly NVIDIA wanted to acquire this technology.

**speaker2:** Incidentally, the $20 billion investment in Coherent and Lumentum announced last month was, in a sense, a move to lock in and ensure a stable supply of external lasers and other optical devices required for AI clusters like Rubin. By making these "anchor investments," they provide capital upfront for production expansion or pre-purchase products to secure a stable supply. Or they invest to acquire technology. NVIDIA has been aggressively pursuing these strategies in 2024.

**speaker2:** Now, let's take a closer look at the noteworthy company, Grok.

**speaker2:** Grok was founded by Jonathan Ross, a core designer of Google's first-generation TPU. He started the company because he felt that GPU architecture was becoming too complex and not well-suited for high-speed operations like inference. He aimed to create a simpler processing method more appropriate for inference.

**speaker2:** In 2024, Grok attracted rapid attention by demonstrating an order-of-magnitude faster token generation speed.

**speaker2:** What's unique about Grok is that instead of just selling LPU chips with their low-latency characteristics, they launched Grok Cloud to provide inference capabilities using LPUs that deliver overwhelming performance for autonomous agents. They started a cloud business called "Language as a Service" or LaaS.

**speaker2:** This LaaS model was so well-received by developers that available slots filled up almost instantly upon launch. It established the reputation of "NVIDIA for training, Grok for inference," earning high praise from the market.

**speaker2:** In this context, NVIDIA's $20 billion investment can be seen as acquiring LPU technology that carries the DNA of Google's TPU. In a way, they used a massive investment to acquire Google's technology.

**speaker2:** Now, let's compare the GPU and the LPU.

**speaker2:** I've summarized the comparison in a table on page 24. The fundamental design philosophies are completely different. The GPU focuses on the scale of its computational power by processing a large amount of data in parallel at once.

**speaker2:** In contrast, the world of inference involves generating one token and then using that token to generate the next. It's a step-by-step sequential process. Therefore, the LPU is a system specialized in maximizing the speed of this sequential processing.

**speaker2:** Another point to note is that GPUs rely on HBM high-bandwidth memory, which is currently in short supply, and the GPU packaging process, TSMC's CoWoS, which is facing capacity shortages and creating supply bottlenecks. In contrast, the LPU chip itself can be manufactured with a very simple process, making it easy to mass-produce and procure.

**speaker2:** On page 25, I provide a more detailed comparison of the two. What I want to highlight here is this part. The GPU has an overwhelming 288 GB of HBM memory, while the LPU has a mere 500 MB—an order of magnitude smaller. However, in terms of data transfer bandwidth, the LPU is actually seven times faster than the GPU.

**speaker2:** In other words, while the GPU excels at processing very large chunks of data all at once, the LPU achieves high overall throughput by processing small chunks of data at extremely high speeds. They have completely opposite design approaches.

**speaker2:** Supporting the LPU's computing is a software component called a compiler, which you can see at the bottom of the slide. Think of it as software for running AI models quickly and efficiently. In LPU computing, the compiler pre-schedules all data movements, calculation timings, and data transfer paths down to the millisecond, and the computations proceed exactly according to that schedule.

**speaker2:** Therefore, if you look at the internal breakdown of the LPU chip, one key feature is that memory modules make up the majority of the semiconductor. Another feature is that the C2C module, which handles data transfer and acts as a switch, is integrated inside the LPU. This C2C is a proprietary LPU protocol for chip-to-chip communication.

**speaker2:** This is just like the TPU, where LPU chips are connected directly to each other to build a network, without going through a switch chip.

**speaker2:** Unlike Ethernet, which uses dynamic routing where a switch determines the destination and finds an available path, the LPU compiler's scheduling enables ultra-low latency computing that completely eliminates sources of delay like reception collisions and jitter. In the AI industry, this is called deterministic execution. This is the LPU's greatest feature, and in a way, I believe the strength of the LPU lies in the immense value of its compiler.

**speaker2:** So, how is an LPU rack configured? An LPU rack is extremely dense, with 32 trays installed in a single rack. One rack contains a total of 256 LPU chips.

**speaker2:** For inter-chip connections, the backplane uses metal C2C connectors, similar to the NVL72. For communication between racks, it uses the four optical transceiver ports on the front panel.

**speaker2:** What's noteworthy here is that although there are only four transceiver ports, the specification says "32 LPU C2C Optical Links."

**speaker2:** Unlike GPUs and NVLink, the C2C topology allows for a very large number of connections, even with 96 chips per chip. Also, because each individual piece of data is small, a transceiver, which typically has eight lanes (eight light sources and EMLs) to constitute an 800G or 1.6T module, doesn't need that much capacity per link. So, the transceiver lanes are split, and communication is performed using 32 links (8 lanes x 4 ports). In other words, the wiring prioritizes dense connectivity between TPUs rather than the size of the data being transported.

**speaker2:** If you think of a GPU as slowly transporting data in a large drum, the LPU is like a rapid, seamless bucket brigade, moving small amounts of data. However, for inference, how finely you can break down the data into steps is crucial, so the bucket brigade approach has an overwhelming advantage in inference.

**speaker2:** Amidst this, the final form that NVIDIA is proposing is a hybrid system of GPUs and LPUs. NVIDIA is presenting this combination as "NVIDIA Dynamo."

**speaker2:** Processes that require large amounts of memory, such as the large KV cache needed for loading context during inference, are handled by the GPU. The process of actually generating tokens is then offloaded to the LPU. By dividing the roles this way and letting each component handle what it does best, they improve generation efficiency. NVIDIA explains that with this system, they succeeded in increasing token generation efficiency by up to 35 times.

**speaker2:** In this way, NVIDIA has incorporated the DNA of Google's TPU technology and combined it with its own GPUs to demonstrate that it can achieve high inference performance.

**speaker2:** In the slide where I mentioned that tokens are currency, I explained that the ability to generate tokens for premium services leads to revenue. Here, NVIDIA explains that a premium model costs $150 per million tokens, whereas a commodity inference might be around $3. There is a huge price difference.

**speaker2:** To perform this premium inference, there are increasingly demanding and heavy workloads that are challenging even for Rubin. To handle this, the combination of a Vera Rubin GPU rack and an LPU, the Dynamo system, is optimal. By adopting Dynamo, the potential revenue is double that of a Rubin-only setup.

**speaker2:** The expected revenue per gigawatt shows a massive difference of $150 billion annually, which NVIDIA uses to argue that the LPU is a valuable system with a high return on investment.

**speaker2:** Now, to what extent will LPUs actually be deployed? On page 30, we at our firm have used AI simulations and other methods to produce a forecast. For a standard hyperscaler inference pod, we expect the number of LPU racks to be close to the number of GPU racks. NVIDIA proposed a ratio of five LPU racks to eight GPU racks, so we estimate it will be around half or slightly more.

**speaker2:** If that's the case, each rack has four ports, and an entire LPU rack setup would have 144 transceiver ports. Additionally, each rack has network interface card ports for communication with the CPU switch rack. Taking that into account, we believe that the LPU system will be equipped with more optical ports than the GPU racks. Therefore, we think this GPU plus LPU hybrid system will further boost overall demand.

**speaker2:** Furthermore, as mentioned in Chapter 1, the demand for Optical Circuit Switches will be significantly pushed up from the second half of this year. We believe this will be driven by the ramp-up of the TPU cluster from Google's large-scale contract—that 3.5 GW of TPU—plus this LPU rack system. These two factors will be the main drivers pushing up OCS demand in the second half of this year.

**speaker2:** Now that we've seen that the Rubin platform will generate even greater demand for optical devices and cabling than previously expected, let's look at the future roadmap.

**speaker2:** Page 31 summarizes the roadmap that NVIDIA presented. There's a lot I could talk about in detail, but I'll focus on one point. It was clearly stated by CEO Jensen Huang that in 2028, even the intra-rack NVLink switches will be made optical with CPO. He explicitly declared that within the "Feynman" platform, intra-rack communication will be optical.

**speaker2:** So, while some analysts in Japan say that CPO adoption is still far off, our view is that scale-out CPO will begin this year, and in two years, scale-up, or intra-rack optics, will also advance.

**speaker2:** Also at this GTC, NVIDIA demonstrated that it is no longer just a chip supplier. Using its expertise in virtual space simulations, it showcased a system that designs optimal "AI Factories" for clients in a virtual environment, using a product ecosystem of partners ranging from cooling systems to various other components. NVIDIA has shown the world that it has become an infrastructure vendor for AI factories.

**speaker2:** Simultaneously, on page 33, NVIDIA also discussed the concept of a space data center. The primary objective isn't, as some might explain, the infinite availability of solar power in space. The main goal is to process the vast amounts of data acquired in space.

**speaker2:** There are currently over 10,000 SpaceX satellites in low Earth orbit, and the massive amount of data they collect cannot be fully transmitted to Earth. This bottleneck means the data is not being effectively utilized. The idea is to run inference directly in space to analyze, compress, and extract data, sending only the valuable information back to Earth. That is the primary aim of an AI data center in space.

**speaker2:** Some also say that cooling is not a concern in space, but that's a big misunderstanding. On the contrary, because there is no air in space, cooling is the biggest technical hurdle for a space data center. Since cooling can only be done through infrared radiation, the challenge for a space data center is how to dissipate the heat.

**speaker2:** So far, we've talked about NVIDIA's inference and the Rubin system. But if I had to pick one single overarching theme from this GTC, it would be AI agents. I think 2024 can truly be called the year the AI agent market will explosively take off.

**speaker2:** In Jensen Huang's various sessions, the topic of Open-Claw was everywhere. It was a very strong impression.

**speaker2:** Open-Claw is an open-source program that allows you to create an AI agent on a client's PC using natural language instructions. It's not an AI model itself; rather, think of it as a program for building your own unique AI agent using models like GPT, Gemini, or Claude.

**speaker2:** A time is fast approaching when companies and individual users will build their own AI agents that work tirelessly to generate tokens.

**speaker2:** So, how did Open-Claw come about? It was developed by an entrepreneur from Europe/Australia, Mr. Peter Steinberger, who started development in November of last year. It was only released in January, so it's a system that has only been public for two or three months.

**speaker2:** However, as shown in the graph I mentioned earlier, it has achieved in just a few months the kind of adoption that took open platforms like Linux nearly a decade. It has grown explosively, acquiring more users than other open models.

**speaker2:** Mr. Steinberger said in an interview this month that this will be the year of the AI agent. He said AI will shift from being a passive tool to a proactive entity.

**speaker2:** The boom is particularly strong in China. Using Open-Claw, there's a movement to build businesses around renting out custom AI agents. Since the Open-Claw motif is a lobster, the term "raising lobsters" has even emerged to describe this trend.

**speaker2:** Page 36. This is from a Bloomberg article on March 10th. It says that in China's tech industry, everyone is going crazy for Open-Claw. The background is that for the past year, China has been searching for a breakthrough in AI comparable to the success of DeepSeek. They see the opportunity for that breakthrough in Open-Claw. It has become such a huge boom in just the last two months that cities and local governments are announcing massive subsidies for startups one after another.

**speaker2:** Also, on page 37, if you install and run Open-Claw on your main computer, you essentially give control of your PC to Open-Claw. If the AI makes a wrong decision or action, it could cause critical problems. Because of this, it has become standard practice to run these AI agents on a separate compact PC. This has led to a rapid surge in popularity for small devices like the Mac Mini and Raspberry Pi, and their delivery times are getting longer.

**speaker2:** At this GTC, NVIDIA itself was promoting the sale of small terminals for running its own version of an Open-Claw-like AI agent, showing that this is connecting to significant business opportunities.

**speaker2:** Now, having looked at NVIDIA's new GPU system, Rubin, and its competitors like the XPU and TPU custom chips, let's examine what's happening in the optical communications industry that supports this AI computing, based on what we saw at OFC 2024, which was held in the same area.

**speaker2:** The most noteworthy thing from this OFC was the establishment of various Multi-Source Agreements (MSAs). Amid supply constraints, an MSA enables large-volume procurement from multiple sources. To prevent these supply constraints from happening in the first place, industry participants are intentionally avoiding competition on standards and instead establishing common specifications from the outset. This creates an ecosystem with multiple suppliers from the beginning.

**speaker2:** The fact that so many MSAs were launched in March indicates that optical solutions for AI computing are facing such a severe supply constraint that if things continue as they are, it will become an even more serious bottleneck from the second half of this year onwards. The move is to agree on common specifications from the start to avoid future disruptions.

**speaker2:** In addition to this trend, Fujikura announced a 300 billion yen investment in the US and Europe. This confirms that a massive demand for optical communications is emerging. I have summarized other features, which you can refer to later.

**speaker2:** What I want to convey first from OFC is that the era of 1.6 Tera is already here. Here, I have summarized the 1.6 Tera solutions that were announced at OFC. There were moves from all these different companies.

**speaker2:** Another thing is that LPO technology is now rapidly gaining attention. New transceivers like this are being noticed for use in systems from TPU, LPU, and Meta. I will skip the details for today, but if you are interested, I would be happy to explain more in a separate meeting.

**speaker2:** What I do want to pick up from OFC is the announcement of a new optical transceiver module standard, or form factor. This is a new standard being led by Arista.

**speaker2:** Conventional transceivers had one MPO connector per transceiver. This is changing to a giant module transceiver with eight MPO connectors. One module is about the size of eight conventional ones. This is a new transceiver targeted at ultra-high-density, multi-core optical solutions for AI clusters, handling up to 1024 fibers.

**speaker2:** The details of this XPO standard, which were also announced at OFC, are summarized on page 49.

**speaker2:** Another major MSA launched is on page 50. It's called the Open Compute Interconnect. Microsoft, Broadcom, Meta, AMD, and others are participating. This defines the physical layer for scale-up optical solutions—the connectors, modulation schemes, and so on. It's important to note this is only a physical layer definition. The protocol used can be anything, whether it's NVLink, a competitor's, or even Ethernet.

**speaker2:** The goal is to avoid supply constraints at the physical layer by standardizing the specifications. The fact that NVIDIA also joined this suggests that they have abandoned their proprietary approach in order to prevent supply bottlenecks.

**speaker2:** Another significant MSA is for multi-core fiber. Fujikura, Corning, Sumitomo Electric, and Terahop, a transceiver maker related to InnoLight, which has close ties with Sumitomo, have launched an MSA for multi-core fiber.

**speaker2:** Corning also unveiled a 1.6 Tera multi-core fiber optical transceiver. With the adoption of TPUs and LPUs, the number of optical cables is increasing exponentially. To support this, multi-core fiber, which can carry four times the signal information of a conventional fiber in a single strand, is now rapidly entering the commercialization phase.

**speaker2:** Similarly, in the connector field, the MMC connector has been introduced for improved usability and workability. There have also been announcements about the rapidly growing demand for low-latency hollow-core fiber for communication between distant regions. CrossTech has even featured hollow-core fiber, showing how much attention it is gaining within the industry.

**speaker2:** The silicon photonics technology that underpins all of this optical communication is being heavily promoted. To support it, TSMC has released a nearly complete Process Design Kit (PDK) for silicon photonics. This kit includes a very wide range of components, from waveguides to photodiodes, modulators, couplers, and phase shifters. We are entering an era where any company can use TSMC's foundry to create silicon photonics chips.

**speaker2:** Finally, moving quickly, I'd like to look at the long-haul and metro-haul markets.

**speaker2:** What I want to highlight here is Lumen, which has a very large presence in the long-haul network market in the United States. In their latest earnings call, they mentioned they are receiving huge orders for PCF, their ultimate dedicated network for AI.

**speaker2:** This is a project where hyperscalers pre-pay the massive construction costs for laying the fiber, which allows for very speedy network construction. They have already exceeded their targets for orders, and demand from hyperscalers continues to grow.

**speaker2:** The system is supported by Corning's Flow cable. As summarized on page 62, Lumen is rapidly building out its high-speed data network across the United States. Furthermore, they have announced projects to progressively upgrade this network to 800 Gbps and 1.6 Tbps.

**speaker2:** To support this construction, Dycom, the largest optical communication cable company, is also experiencing historic sales growth and has stated that it holds a large order backlog.

**speaker2:** So, it's not just data centers creating demand. According to Dycom, demand from the BEAD project will start in earnest from the second half of this year. Our firm believes that starting from the second half of 2024, the optical fiber industry will enter a historic super cycle.

**speaker2:** That's all. The full presentation is about 150 pages. Please feel free to look through the materials later, and if you have any questions, you can ask Mr. Yamaguchi or contact our firm for a private meeting.

**speaker2:** Mr. Yamaguchi, I'll now hand it over to you for the Q&A.

**speaker1:** Yes, understood. Thank you very much. For those of you interested in topics like Fujikura's optical fiber shortage, there are details from customs statistics in the latter half of the materials. Please take a look later. It mentions specific company names, so it should be easy to understand. Please do review it.

**speaker1:** Okay, we have quite a few questions. We may run a little over time, but I ask for your understanding.

**speaker1:** The first question is: "The role of the LPU seems similar to a CPU. Will it replace the CPU? Will the on-chip SRAM capacity be sufficient in the future? If more capacity is needed, will it also use external memory?"

**speaker2:** First, the LPU and CPU are completely different things. A CPU handles various tasks and orchestrates the entire system; it's a command center. The LPU's computation is very simple. It's a highly simple configuration consisting only of memory, vector and matrix operation modules, and communication modules. It is a chip specialized for the sole purpose of generating tokens at explosive speeds.

**speaker2:** Also, a CPU always communicates through a switch chip, whereas LPUs are designed to be densely connected directly to each other, forming their own network cluster. Their roles are fundamentally different. Is that clear?

**speaker1:** Yes. The second question: "There are discussions that Samsung's foundry will manufacture the LPU. Based on your channel checks, what is your assessment? Also, are there any implications, such as which manufacturers will benefit from increased SRAM production or the impact on HBM demand?"

**speaker2:** Okay. First, regarding the LPU, to put it simply, it doesn't need to be made by TSMC. It's simple enough that, and I don't mean this disrespectfully, Samsung is fully capable of manufacturing it. So I think there's a very high probability it will be made by Samsung.

**speaker2:** Now, regarding the idea that HBM might no longer be necessary, my conclusion is that this is incorrect. The roles of the LPU and GPU are completely different. Their memory sizes are on different planets—500 MB versus 288 GB. The GPU is absolutely necessary for loading the context, which can be millions of chips' worth of information. The Dynamo system is designed for them to share roles effectively. So, I don't see the HBM bottleneck being resolved anytime soon. Recent earnings reports from Micron and SK Hynix also show that HBM demand is growing even further. Our analysis supports this.

**speaker2:** I haven't included it in the slides, but our firm does a lot of analysis on semiconductor-related topics. We are seeing clear quantitative data on price increases and bit rate growth. So I do not believe at all that HBM demand will taper off.

**speaker1:** Understood. I will skip similar questions. Next: "I feel that the value of past data centers based on older GPUs, like Hopper, will be diminished. Is this concern unnecessary? If there are any concerning developments, such as price cuts for Hopper-based data centers, please let us know."

**speaker2:** Well, even now, NVIDIA's earnings report states that there is still very strong demand for previous generations like Hopper. The point is, there's a wide range of inference needs, from medium to ultra. Different services require different things. Smaller companies can build their systems using H100s, which are perfectly adequate for less demanding models. There is also the H200 which is starting to be sold to China. So, I have not observed a situation where prices are about to collapse.

**speaker1:** Okay, understood. This next one may be difficult to answer, I'm not sure myself. "Do you think Furukawa's liquid cooling thermal solution is feasible for use in space? And what would the optical design for a cooling system in space look like?"

**speaker2:** I'm afraid I cannot comment on Furukawa's specific products. As for cooling systems in space, I am still in the process of gathering information and analysis, so I may be able to pick that up as a topic sometime in the future.

**speaker1:** Just a few more. "Regarding the use of CPO in 2028, what kind of CPO do you envision? Will it be a configuration where optics are placed close to the ASIC I/O, or will it be a transitional form using OBO or an external laser source?"

**speaker2:** I believe the mainstream approach will be a design that uses an external laser, separating the light source from the ASIC. The reason is that the switch chip itself generates a lot of heat, and this heat can destroy the laser. For maintainability, it makes sense to separate the module, the light source, and the ASIC. There are new MSAs aiming to create individual pluggable optical engines that can be replaced via a socket, but fundamentally, I believe the separation of ASIC and light source will continue in 2028.

**speaker1:** I see. We are running well over time, so just three more questions. "In the inference era, between the GPU+LPU combination and the XPUs you discussed, which do you think has the upper hand?" This is an interesting question.

**speaker2:** First, in terms of cost-performance, the XPU has an advantage. In terms of computational power relative to the power budget, the GPU hybrid system likely has the edge. However, the fact that Google won a massive 3.5-gigawatt contract shows that the next-generation TPU's performance is improving significantly. The fact that Anthropic is embracing the TPU so strongly suggests that the XPU camp is mounting a serious offensive. Meta also announced a four-generation roadmap for their custom chips this March. The encirclement of NVIDIA is steadily being constructed. The question for me is how NVIDIA will defend its position over the next two years.

**speaker2:** In conclusion, NVIDIA is still strong, but the XPU camp is in a phase of rapidly increasing its presence.

**speaker1:** Okay. We have many more interesting questions, but I'll have to select. "With the spread of CPO, will the business of copper cable companies, for things like DACs and ACCs, decline?"

**speaker2:** The short answer is yes. For AI clusters, intra-rack wiring is shifting from metal to optical. I believe we will see the same phenomenon that occurred when telephone lines shifted from copper to fiber, and the demand for copper telephone wire completely vanished.

**speaker1:** Yes, the share of data center cables in global copper demand is probably less than a few percent, but a decline is a decline. It will have an impact.

**speaker1:** Okay, I will make this the last question. Regarding the materials, please contact your salesperson or me.

**speaker1:** "How do you view the supply capacity for optical fiber? Which companies have the capacity? Can they really meet the strong demand over the next two to three years?" I also think this is a very interesting question.

**speaker2:** First, my assessment is that Corning, Fujikura, and Furukawa are currently in a very tight situation, working hard to expand production. On the other hand, Sumitomo is a player whose preform and fiber production capacity far exceeds its own cabling capacity. In the past, Sumitomo used to sell preforms to India and Korea, and fiber to Europe, but as they lost market share to Chinese and Indian competitors, they now have surplus fiber capacity which they are supplying to Corning. So, personally, I think Sumitomo has the most potential to increase its production capacity.

**speaker2:** Prysmian is also starting to purchase from China for the US market. So, for the time being, the market will manage by using Chinese and Indian fiber where premium quality isn't necessary. Ultimately, how much each company can increase its productivity will depend on their individual corporate efforts, which we will continue to monitor and analyze.

**speaker1:** Yes, Corning's expansion is about three years out, right? And Fujikura's Sakura plant is also a ways off. So a shortage is a real possibility, isn't it?

**speaker2:** I think it's very possible.

**speaker1:** Okay, last one, I really want to ask this. "What is your price outlook for optical products, including passive components and lasers?" This will be the final question.

**speaker2:** Prices for both fiber and devices are already starting to rise. I expect price increases to become more pronounced in the second half of this year. This is happening across all semiconductor products; Intel is implementing large-scale price hikes on all its products. For optical devices, indium phosphide capacity will definitely be a bottleneck. When that happens, the hyperscalers will just use their financial power to buy up the supply, which will drive prices up. I believe the same phenomenon will occur here.

**speaker1:** Understood. Thank you very much. We have gone over time, so we will end here. Thank you all for participating.

**speaker2:** Thank you.

**speaker1:** Thank you. Please feel free to exit the session.

**speaker1:** Ah, but questions are still coming in one after another. I apologize.

**speaker1:** This one is about Mithos, or rather, the TPU. "It seems to be trained on something like that. What is your view on the future demand and competitive environment for NVIDIA's GPUs?" Well, that's similar to a previous question.

**speaker1:** Yes. The gist is that the latecomers have some momentum now, so competition is likely to emerge.

**speaker2:** Yes. Right now, Claude is... Anthropic has the most momentum. Their revenue growth is also incredible, growing at a rate of 10x.

**speaker1:** I see. Furukawa is increasing their cooling capacity by 10 times.

**speaker1:** To our investors, this is the end of the session, we will not be speaking further, so please exit the meeting.