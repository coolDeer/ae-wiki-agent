# 260413 - Get Started with Hermes Agent Right Away

# Publisher

AI Disruption

“AI Disruption” Publication 9500 Subscriptions 20% Discount Offer Link.
![image](https://substackcdn.com/image/fetch/$s_!BfxQ!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F4d60deb2-25e7-4253-8d92-7cb56e7558e5_2436x1042.png)
Hermes may be a better fit for you than OpenClaw.
If you care more about the agent’s long-term evolutionary capabilities and want it to become smarter the more you use it, or if you are doing AI research and need to generate training trajectories or run reinforcement learning experiments, Hermes’ architecture is a much better match.
Hermes has a built-in server compatible with the OpenAI API, so it can be directly used as a backend for third-party interfaces such as Open WebUI.
The deployment threshold is also very low. A $5/month VPS is sufficient to run it. It supports Docker, SSH remote access, and serverless solutions like Modal. Installation can be completed with a single curl command.
Below is the installation process for Hermes Agent and my actual usage experience over the past few days.
Taking the Mac platform as an example.
Installing Hermes Agent only requires one command:
```
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
```
During installation, in addition to the Agent itself, Hermes will automatically download various third-party packages (such as ffmpeg), making it truly ready to use out of the box. You don’t need to manually download and configure a bunch of tools.
![image](https://substackcdn.com/image/fetch/$s_!p1Hx!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F4535e5a5-bbbf-4ed9-9e47-181b36d6fd91_1080x495.png)
After installation, reload your shell:
```
source ~/.bashrc   # or source ~/.zshrc
```
Hermes supports direct migration from OpenClaw. Simply reply Y and it will automatically migrate your OpenClaw configuration. During the process, it will show you exactly what was migrated.
However, this step can actually be skipped. You can let something like CodeX automatically read the OpenClaw configuration files and gradually migrate to Hermes.
![image](https://substackcdn.com/image/fetch/$s_!frbS!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffe069382-448e-4072-81ac-fddafbc18127_1080x531.png)
Choose Quick setup to complete the selection of models and conversation terminals.
![image](https://substackcdn.com/image/fetch/$s_!r2DV!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fa0d720b9-6a15-4afd-a3e3-5f6735ecae3e_1080x424.png)
I am using the free models officially provided by Hermes. It currently offers a free trial of Xiaomi’s models. After selecting the official model, it will automatically redirect you to its official webpage, where you complete basic login and credit card verification to start using it for free.
![image](https://substackcdn.com/image/fetch/$s_!sTJ2!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F53e0b55d-c838-4a65-82e1-51b3d603db75_1080x177.png)
Hermes supports almost all major chat tools on the market. This demonstration uses Telegram (TG).
![image](https://substackcdn.com/image/fetch/$s_!mok7!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7652312b-d889-416e-a539-1da44815efbe_1080x369.png)
![image](https://substackcdn.com/image/fetch/$s_!ujsu!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Ffcfdf64f-1d09-4b66-bb55-50cc3f61ff63_1080x656.png)
Once completed, it will display a series of command tools. Here’s a brief introduction to the most commonly used ones:
![image](https://substackcdn.com/image/fetch/$s_!pvwH!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fada9de5a-3bd8-4d39-8968-0ee525de468c_1080x359.png)
hermes version Verify that the command has been successfully added to your PATH. It should display version v0.8.0 or higher.
![image](https://substackcdn.com/image/fetch/$s_!MLtu!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F62110412-5e2c-4c3f-bb08-0a0980bbb570_1080x386.png)
hermes doctor The most critical command. It scans system dependencies (such as ffmpeg, npx, etc.) and provides repair suggestions. If the system crashes later, you can use the repair prompts here for further troubleshooting.
![image](https://substackcdn.com/image/fetch/$s_!C_j0!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5c799c61-754f-49b7-badc-eb08f82627fa_1080x638.png)
hermes setup Launches an interactive wizard to configure your LLM Provider and other settings. You can reuse this command later to add or modify configurations.
![image](https://substackcdn.com/image/fetch/$s_!bmHf!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fc28417b3-a1ca-4481-8cf1-4d84c2cc73d2_1080x662.png)
hermes tools Opens the TUI tool management interface, where you can select the toolsets you need (such as web, terminal, etc.).
![image](https://substackcdn.com/image/fetch/$s_!LiS2!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F39a04843-ea12-42ac-a86a-963f8d0c70b4_1080x336.png)
hermes chat -q "Hello" Performs a non-interactive query. If the AI responds, congratulations — your system is fully connected and working!
#### Model Provider Selection
Although Hermes Agent aims for one-click installation, it provides fine-grained modular switches internally to accommodate different computing power and compliance requirements.
Here are configuration recommendations for mainstream providers:
![image](https://substackcdn.com/image/fetch/$s_!wmxe!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F5b8d17a4-0708-427b-96d6-1634955e435f_1278x421.png)
Even if you mainly use local models, it is still recommended to add an OPENROUTER_API_KEY in your .env file. The OpenRouter platform offers a large number of free models. Currently, after recharging $10 or more, you can enjoy 1,000 free requests per day.
Moreover, Hermes will automatically use low-cost models like Gemini Flash to handle auxiliary tasks such as webpage summarization and image analysis — very practical!
#### Configuration System and Execution Environment
If you only want to use Hermes as a regular chatbot, the default configuration is sufficient.
However, if you want it to safely manage your server, execute code, and run long-term, you must understand its directory structure and execution backend configuration.
All of Hermes’ persistent state is strictly contained within your Home directory, making it easy to manually back up or migrate later:
```
~/.hermes/
├── config.yaml          # Global configuration center (model preferences, terminal backend, compression threshold)
├── .env                 # Sensitive environment variables (all API Keys must be stored here)
├── state.db             # Core database (SQLite WAL mode): stores sessions, messages, and FTS5 search index
├── SOUL.md              # Agent’s global “soul”: defines tone, communication principles, and taboos
├── memories/            # Long-term memory
│   ├── USER.md          # Personal preference records (e.g., habitually uses pnpm, timezone Asia/Shanghai)
│   └── MEMORY.md        # Objective project fact records (e.g., API Endpoint is v2)
├── skills/              # Skill library: each subdirectory is an independent skill module
├── cron/                # Cron task database and definition files
├── sessions/            # JSONL transcript backups of historical sessions
├── checkpoints/         # [Core Security] Automatically created Git shadow repository for /rollback file recovery
└── logs/                # Diagnostic logs (gateway.log for bot offline issues, errors.log for tool errors)
```
#### Terminal Backend Selection and Configuration
Hermes’s most powerful capability is executing terminal commands.
You can configure where these commands run through terminal.backend .
Security isolation is the core decision point here: whether the commands run directly on your host machine. This offers the fastest response but provides zero isolation .
Minimal viable configuration ( config.yaml ):
```
terminal:
  backend: local
  cwd: "."        # Default: current startup directory
  timeout: 180    # Script timeout limit (seconds)
```
Hermes’s CLI is not a simple chat window, but a full-featured console with autocomplete, rollback, compression, and multimodal capabilities.
To master this command-line tool, the most important thing is to become proficient with slash commands (/). They are the shortcut to increasing Agent efficiency by 10x.
When you type / in the interactive interface, an autocomplete menu will pop up. Below are the core commands organized by frequency of use:
![image](https://substackcdn.com/image/fetch/$s_!Z1U6!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F16472599-a1e8-4a10-b130-42b08cad9454_1585x670.png)
/new — Start a new task (when the environment is heavily polluted).
Clears the current context and resets the state of all loaded tools.
/undo — The AI just said something wrong or executed incorrect logic.
Rolls back one turn. Note : It only undoes the conversation, not file changes. To undo file modifications, use /rollback .
/retry — Output was interrupted, there was a network error, or you are unsatisfied with the response.
Asks the AI to regenerate the current turn. It is recommended to switch models before retrying.
#### Advanced Debugging and Optimization
/compress — The money-saving god-tier technique.
![image](https://substackcdn.com/image/fetch/$s_!qs2l!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fd0cac54e-c0e6-42cf-a876-cc3754804ffe_1080x410.png)
When the conversation becomes extremely long, and the AI starts to “go dumb,” manually run this command. It will summarize the middle turns into abstracts, keeping only the first 3 and last 4 turns.
According to official tests, this typically reduces 60%–80% of token consumption.
/verbose — Must-have for debugging.
![image](https://substackcdn.com/image/fetch/$s_!Iz2H!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2Fdf1ce5da-02ad-4f6c-a8a2-2a8e1436bdeb_1080x409.png)
By default, tool outputs are hidden. After running this, you can switch to all or verbose mode to observe the raw data of AI running commands like ls or curl in the background in real time.
/yolo — Trust mode
Temporarily disables dangerous command prompts. Enable this when you are certain you want the AI to perform large-scale automated refactoring, to avoid repeatedly pressing Enter to confirm.
/plugins — Status check
Lists all currently dynamically loaded plugins. If you find that a custom tool is not working, check here first to see if it is loaded.
The following are the built-in Tools of Hermes. You do not need to install any additional MCP tools.
![image](https://substackcdn.com/image/fetch/$s_!ShlU!,w_1456,c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F7eb32ab7-e69f-4e08-b053-59ade99c5ab8_1267x634.png)
#### Skills, Memory, and Sessions
Hermes’s closed-loop learning relies on a three-layer storage system: Skills (how to do things), Memory (what things are), and Sessions (what has been discussed).
Understanding how these three layers work together is the key to turning Hermes into a truly growing AI assistant.
Skills System
Skills are on-demand programmable knowledge. Like Claude Code or OpenClaw, Hermes’s Skills are general-purpose and reusable.
Memory System
Mainly consists of USER.md and MEMORY.md .
- USER.md: Personal preferences, identity, communication habits, and frequently used paths.For example, it can remember that you prefer concise code and dislike long-winded explanations.
- MEMORY.md: Project architecture facts, API versions, known bugs, etc.For example: “The database address for this project is 10.0.1.5, and we use v2.1 of the API.”
USER.md : Personal preferences, identity, communication habits, and frequently used paths. For example, it can remember that you prefer concise code and dislike long-winded explanations.
MEMORY.md : Project architecture facts, API versions, known bugs, etc. For example: “The database address for this project is 10.0.1.5, and we use v2.1 of the API.”
Session Search
If you forget something that was discussed in the past, you can directly use the built-in SQLite FTS5 full-text search engine:
Fuzzy search example: “What was our suggestion last month about performance optimization?”
Thanks to this technology, when Hermes detects that you are asking about past conversations, it will automatically call session_search . You don’t need to write any SQL manually.
Cron Timed Automation
Hermes has a built-in conversation-driven Cron scheduler.
Cron tasks run in a fresh session. You can set them up like this:
```
/cron add "every 6h" "Use the gh tool to check for new Issues in NousResearch/hermes-agent. If none, reply [SILENT]. If there are any, summarize them and push to my Telegram." --deliver telegram --name "RepoWatcher"
```
#### Browser Automation
This is a core feature introduced after Hermes v0.5.0. You no longer need to install a bunch of messy third-party browser control tools.
Using Accessibility Tree technology, the AI no longer simply scrapes HTML — it can observe and operate DOM elements like a real person.
The following example shows a fully automated GitHub review:
“Log into my GitHub, find PRs in the NousResearch repository that haven’t been replied to for over 24 hours, summarize your opinions, and send them to me.”
Typical internal steps:
- browser_navigate: Open github.com and check login status.
- browser_snapshot: Get page Ref IDs (e.g., @e15 represents the PR title).
- browser_click: Click the corresponding PR link.
- browser_vision: If there are complex charts or code diff images, take screenshots and analyze the content.
browser_navigate : Open github.com and check login status.
browser_snapshot : Get page Ref IDs (e.g., @e15 represents the PR title).
browser_click : Click the corresponding PR link.
browser_vision : If there are complex charts or code diff images, take screenshots and analyze the content.
#### Personal Best Practices
Division of Labor Between SOUL.md and AGENTS.md
- SOUL.md is placed at ~/.hermes/SOUL.md and takes effect globally. It defines what kind of personality this agent has.
- AGENTS.md is placed in the project root directory and defines the rules and conventions of this project.
SOUL.md is placed at ~/.hermes/SOUL.md and takes effect globally. It defines what kind of personality this agent has.
AGENTS.md is placed in the project root directory and defines the rules and conventions of this project.
The former is about identity, the latter is about context. The responsibilities of the two files do not overlap. This is much cleaner than many frameworks that cram everything into a single system prompt.
Lazy Loading Mechanism of AGENTS.md
The top-level AGENTS.md is injected directly into the system prompt at the start of a session.
AGENTS.md files in subdirectories are not pre-loaded. They are only injected when a tool call touches that directory (via subdirectory_hints.py ).
The advantage is that large monorepos won’t have all submodule specifications stuffed into the prompt from the very beginning.
Note : MEMORY.md has a soft limit of about 2200 characters, and USER.md about 1375 characters. Once full, the agent will automatically merge and compress the content. However, the compression logic is not transparent, and important information may be lost.
The official recommendation is to proactively say “clean up your memory” or specify which record to update, rather than letting the agent handle it automatically.
#### The Three-Piece Timed Suite
The combination I use most often is cron + web search + delegate_task . Every day, it automatically lets sub-agents fetch news on various topics in parallel.
You only need to write one cron prompt.
For example, clearly tell the agent: You are preparing a briefing for an independent developer who follows the open-source ecosystem. Skip pure commercial funding news and PR articles, and focus on technical details.
Use delegate_task to spawn three sub-agents running in parallel, each responsible for one direction. The main agent only handles summarization and formatting, then pushes the final report to Telegram.
The entire prompt is about 200 words. Set it once, and every day at 8 AM, the briefing automatically appears on your phone.
#### Parallel Tasks
For daily intelligence tasks, in the cron job:
First use execute_code to run web scraping and save the raw data to /tmp/data.json , then delegate a sub-agent specifically for analysis and report writing.
This keeps scraping and analysis clean and separate. Instead of stuffing dozens of search results into the main session, only the most important parts are extracted.
Thanks for reading AI Disruption! This post is public so feel free to share it.
Share