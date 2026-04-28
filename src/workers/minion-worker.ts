/**
 * 兼容入口。
 *
 * 后续 runtime 结构向 gbrain 收敛时，真正的 worker 逻辑放在
 * `src/core/minions/worker.ts`。这里保留旧路径，避免现有脚本和用户命令失效。
 */

export { runWorker } from "~/core/minions/worker.ts";

import { runWorker } from "~/core/minions/worker.ts";

if (import.meta.main) {
  await runWorker();
}
