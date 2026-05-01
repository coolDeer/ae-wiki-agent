/**
 * 时间格式化通用工具。
 *
 * 设计：
 *   - 数据库 / API 一律存 UTC（ISO 字符串或 Date 对象）；这层只管"展示给人看"。
 *   - 默认时区是上海（Asia/Shanghai），可通过 `WIKI_DISPLAY_TZ` env 覆盖。
 *   - 接受 `Date | string | number | null | undefined`，无效输入返回空字符串
 *     （而非抛错或显示 "Invalid Date"），UI 层可放心用。
 *
 * 使用：
 *   import { formatTime, formatDate, formatDateTime } from "~/core/datetime.ts";
 *
 *   formatDateTime(page.create_time)     // → "2026-05-01 01:04:09"（默认 SH）
 *   formatDate(p.event_date)              // → "2026-05-01"
 *   formatTime(turn.ts)                   // → "01:04:09"
 *   formatDateTime(d, { tz: "UTC" })      // → 显式覆盖时区
 *   formatDateTime(d, { sep: "T" })       // → "2026-05-01T01:04:09"
 */

const DEFAULT_TZ = "Asia/Shanghai";

/** 读 env 一次缓存 —— 不在 hot path 反复读 process.env */
let cachedDefaultTz: string | null = null;
function getDefaultTz(): string {
  if (cachedDefaultTz !== null) return cachedDefaultTz;
  const fromEnv = process.env.WIKI_DISPLAY_TZ;
  cachedDefaultTz = fromEnv && fromEnv.trim().length > 0 ? fromEnv.trim() : DEFAULT_TZ;
  return cachedDefaultTz;
}

export interface FormatOptions {
  /** IANA timezone name（如 "Asia/Shanghai" / "America/New_York" / "UTC"）。
   *  不传则用 `WIKI_DISPLAY_TZ` env，再 fallback `Asia/Shanghai`。*/
  tz?: string;
  /** 日期与时间之间的分隔符。默认 " "（空格）。常用："T" / " " */
  sep?: string;
}

type TimeLike = Date | string | number | null | undefined;

/** 把任意时间值标准化成 Date 对象；无法解析返回 null。 */
function toDate(value: TimeLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 内部：取目标时区下的 year/month/day/hour/minute/second 字符串。 */
function getParts(date: Date, tz: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  return {
    year: parts.year ?? "0000",
    month: parts.month ?? "01",
    day: parts.day ?? "01",
    // Intl 在午夜返回 "24" 而不是 "00"，规范化一下
    hour: parts.hour === "24" ? "00" : (parts.hour ?? "00"),
    minute: parts.minute ?? "00",
    second: parts.second ?? "00",
  };
}

/** "YYYY-MM-DD HH:MM:SS"（默认上海时区）。无效输入返回空字符串。 */
export function formatDateTime(
  value: TimeLike,
  opts: FormatOptions = {}
): string {
  const date = toDate(value);
  if (!date) return "";
  const tz = opts.tz ?? getDefaultTz();
  const sep = opts.sep ?? " ";
  const p = getParts(date, tz);
  return `${p.year}-${p.month}-${p.day}${sep}${p.hour}:${p.minute}:${p.second}`;
}

/** "YYYY-MM-DD"（默认上海时区当日）。 */
export function formatDate(
  value: TimeLike,
  opts: Pick<FormatOptions, "tz"> = {}
): string {
  const date = toDate(value);
  if (!date) return "";
  const tz = opts.tz ?? getDefaultTz();
  const p = getParts(date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "HH:MM:SS"（默认上海时区当下时刻）。 */
export function formatTime(
  value: TimeLike,
  opts: Pick<FormatOptions, "tz"> = {}
): string {
  const date = toDate(value);
  if (!date) return "";
  const tz = opts.tz ?? getDefaultTz();
  const p = getParts(date, tz);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** 当前时间（默认上海时区）。等价 `formatDateTime(new Date(), opts)`。 */
export function nowString(opts: FormatOptions = {}): string {
  return formatDateTime(new Date(), opts);
}

/** 取目标时区下的"今天"日期字符串（YYYY-MM-DD）。 */
export function todayString(opts: Pick<FormatOptions, "tz"> = {}): string {
  return formatDate(new Date(), opts);
}

/**
 * 给客户端 inline `<script>` 用的 helper code snippet。
 * 服务端渲染 HTML 时直接 inline 一个 JS 函数到页面里。
 *
 * 用法（服务端）：
 *   <script>
 *     ${clientSideTimeFormatter()}
 *     // 然后 fmt(new Date()) 在浏览器里返回上海时区字符串
 *   </script>
 */
export function clientSideTimeFormatter(): string {
  const tz = getDefaultTz();
  return `
    function formatLocalTime(d) {
      if (!d) return '';
      const date = (d instanceof Date) ? d : new Date(d);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleString('zh-CN', { timeZone: ${JSON.stringify(tz)}, hour12: false }).replace(/\\//g, '-');
    }
  `.trim();
}
