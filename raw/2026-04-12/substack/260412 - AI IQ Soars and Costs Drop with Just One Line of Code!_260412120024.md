# 260412 - AI IQ Soars and Costs Drop with Just One Line of Code!

# Publisher

AI Disruption

“AI Disruption” Publication 9400 Subscriptions 20% Discount Offer Link.
> Anthropic Has Made Another Move: Implementing a “Advisor Strategy” on the Claude Platform
Anthropic Has Made Another Move: Implementing a “Advisor Strategy” on the Claude Platform
The main goals are to reduce costs and boost the intelligence of lighter models. Recently, many users have reported that Claude seems to have become “dumber.” It’s increasingly clear that Anthropic’s top-tier models are prioritizing B2B and internal iteration use cases, becoming less friendly to individual C-end (consumer) users. One has to wonder whether Anthropic has been secretly using this kind of “Advisor Strategy” internally for a while already.
![image](https://substackcdn.com/image/fetch/$s_!Ao3L!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7a2ea82d-447c-45a3-9ab8-9de1a4b6a6cf_1080x597.webp)
In simple terms, the most powerful Opus model acts as an Advisor in the background, while a lightweight Sonnet or Haiku model serves as the Executor . With this combination, developers can instantly give their agents near-Opus-level intelligence at extremely low cost.
In the past, many developers had to figure out this “large + small model collaboration” pattern on their own to balance intelligence and cost. Today, Anthropic has officially turned this hard-earned experience into a ready-to-use tool on the Claude platform. You can enable it by changing just one line of code in your API call.
The mechanism behind this strategy is very clever.
Under the Advisor Strategy, the Sonnet or Haiku model acts as the Executor and runs the entire task from start to finish — calling tools, reading results, and continuously trying to solve the problem. However, when the Executor encounters an extremely difficult key decision and feels stuck, it will call upon Opus, the Advisor, for guidance.
Once called, Opus reads the shared context between both models and provides a clear plan, a correction suggestion, or even a stop signal. The Executor then takes the advice and continues working. Importantly, the Advisor never calls any tools itself, nor does it generate the final output shown to the user. Its sole responsibility is to provide high-level strategic guidance to the Executor.
This approach completely reverses the most common “sub-agent” pattern currently used in the industry. Previously, people would use one massive model as the orchestrator to break down tasks and assign them to smaller “worker” models. In the Advisor Strategy, however, a small, extremely cheap model takes on the dominant role and handles upward reporting. There’s no need for complex task decomposition logic or a large pool of worker models. The most powerful reasoning capability is used only where it matters most — intervening only when the Executor is truly stuck. For the vast majority of the runtime, everything stays on an extremely low-cost baseline.
#### Real-world test data proves how powerful this approach is.
On the SWE-Bench Multilingual benchmark, the Sonnet Executor paired with an Opus Advisor achieved a score 2.7 percentage points higher than Sonnet running alone, while the average cost per task actually decreased by 11.9% .
![image](https://substackcdn.com/image/fetch/$s_!rDP3!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F56a41075-3bb5-464c-8b7c-7935096821d9_1080x600.webp)
In the BrowseComp and Terminal Benchmark 2.0 tests, the Sonnet + Opus Advisor combination not only improved scores across the board, but also cost less than using Sonnet by itself.
![image](https://substackcdn.com/image/fetch/$s_!JqMn!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa289e32d-82c4-4b27-a5a6-3e63bdebe481_1080x603.webp)
If you switch the Executor to the smallest model, Haiku , the effect is even more dramatic. In the BrowseComp benchmark, Haiku with the Advisor scored 41.2% , more than double its solo score of 19.7%. Although this combination still lags behind a solo Sonnet by 29%, its per-task cost dropped by a staggering 85% . While adding the Advisor does introduce some extra overhead for Haiku, the total cost remains only a small fraction of running Sonnet alone. For applications that need a certain level of intelligence while facing massive high-concurrency demands, this is an extremely compelling cost-performance option.
![image](https://substackcdn.com/image/fetch/$s_!oSu9!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F8f080cf9-fd15-4a1d-8e52-4b0dfc2bab9d_1080x607.webp)
This Advisor tool has now entered Beta testing on the Claude platform.
Developers simply need to declare advisor-20260301 in their Messages API request, and the entire handoff between models will be handled automatically within the same API call. No extra network round-trips are required, and developers don’t need to manually manage complex context switching.
The Executor model itself decides when it needs to call the Advisor. Once triggered, the system automatically forwards the organized context to the Advisor in the background. After receiving the plan, the Executor seamlessly continues execution. The whole process is smooth and efficient.
The core code configuration is very simple:
```
response = client.messages.create(
    model="claude-sonnet-4-6",
    tools=[
        {
            "type": "advisor_20260301",
            "name": "advisor",
            "model": "claude-opus-4-6",
            "max_uses": 3,
        },
    ],
    messages=[...]
)
```
The billing is also very clear: the Advisor’s tokens are charged at the high-end Opus rate, while the Executor’s tokens are charged at the lightweight model rate. Since the Advisor typically only outputs a short guidance plan of 400–700 tokens, and the heavy, long-form final output is all handled by the cheap Executor, the overall cost is kept well below running the full, powerful model for the entire task.
In addition, Anthropic has built-in cost control features. You can limit the maximum number of Advisor calls per request using the max_uses parameter. The system also separately lists the Advisor’s token consumption in the usage details, making it easy to track exactly where every dollar is going.
This new tool is fully compatible with your existing tech stack. The Advisor tool is essentially just a new entry in your API tools list. Your agent can continue searching the web, writing and testing code, and when it hits a dead end, simply consult Opus — all within the same seamless loop.
To start using it right away, you only need to follow these three steps:
- Add the Beta feature header in your request:anthropic-beta: advisor-tool-2026-03-01
- Add the advisor_20260301 tool in your Messages API request.
- Adjust your system prompt slightly according to your specific use case.
Add the Beta feature header in your request: anthropic-beta: advisor-tool-2026-03-01
Add the advisor_20260301 tool in your Messages API request.
Adjust your system prompt slightly according to your specific use case.
Anthropic officially recommends that developers immediately run comparison tests on their own evaluation datasets — comparing solo Sonnet, the Advisor Strategy combination, and solo Opus — to see the concrete differences in performance and cost.
Thanks for reading AI Disruption! This post is public so feel free to share it.
Share