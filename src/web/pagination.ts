/**
 * 分页 helper — 与 aecapllc-service `PageRequest` / `PageUtils<T>` 命名一致。
 *
 * 入参（URL search params）：
 *   pageSize   每页条数；默认 10；非法 / <=0 → 重置 10
 *   currPage   当前页（1-based）；默认 1；非法 / <=0 → 重置 1
 *   sortField  排序字段；视图层各自维护白名单
 *   sortOrder  ASC | DESC（大小写不敏感；其它值忽略）
 *
 * 出参：
 *   totalCount / pageSize / totalPage / currPage / list / hasNext
 */

export interface PageRequest {
  pageSize: number;
  currPage: number;
  sortField?: string;
  sortOrder?: "ASC" | "DESC";
}

export interface PageResult<T> {
  totalCount: number;
  pageSize: number;
  totalPage: number;
  currPage: number;
  list: T[];
  hasNext: boolean;
}

export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 200;

/** 从 URL 查询参数解析 PageRequest，做校验 + 上限保护。 */
export function parsePageRequest(
  params: URLSearchParams,
  defaultPageSize: number = DEFAULT_PAGE_SIZE
): PageRequest {
  const rawSize = params.get("pageSize");
  let pageSize = rawSize ? parseInt(rawSize, 10) : defaultPageSize;
  if (!Number.isFinite(pageSize) || pageSize <= 0) pageSize = defaultPageSize;
  if (pageSize > MAX_PAGE_SIZE) pageSize = MAX_PAGE_SIZE;

  const rawPage = params.get("currPage");
  let currPage = rawPage ? parseInt(rawPage, 10) : 1;
  if (!Number.isFinite(currPage) || currPage <= 0) currPage = 1;

  const sortField = params.get("sortField") || undefined;
  const orderRaw = (params.get("sortOrder") || "").toUpperCase();
  const sortOrder = orderRaw === "ASC" || orderRaw === "DESC" ? (orderRaw as "ASC" | "DESC") : undefined;

  return { pageSize, currPage, sortField, sortOrder };
}

/** SQL 偏移量（0-based）。 */
export function offsetOf(req: PageRequest): number {
  return (req.currPage - 1) * req.pageSize;
}

/** 给视图选择 ORDER BY 子句时用：检查 sortField 是否在白名单。 */
export function pickSortField<T extends string>(
  req: PageRequest,
  whitelist: readonly T[],
  fallback: T
): { field: T; order: "ASC" | "DESC" } {
  const field =
    req.sortField && (whitelist as readonly string[]).includes(req.sortField)
      ? (req.sortField as T)
      : fallback;
  const order = req.sortOrder ?? "DESC";
  return { field, order };
}

export function buildPageResult<T>(
  list: T[],
  totalCount: number,
  req: PageRequest
): PageResult<T> {
  const totalPage = req.pageSize > 0 ? Math.ceil(totalCount / req.pageSize) : 0;
  return {
    totalCount,
    pageSize: req.pageSize,
    totalPage,
    currPage: req.currPage,
    list,
    hasNext: req.currPage < totalPage,
  };
}

/**
 * 渲染页脚 HTML（prev / 页码 / next + 总数 + size 选择）。
 * @param basePath 基础 URL（不含 query），如 "/entities"
 * @param keptParams 需保留的其它 query 参数（如 type/sector/confidence）
 */
export function renderPagination<T>(
  result: PageResult<T>,
  basePath: string,
  keptParams: Record<string, string | undefined> = {}
): string {
  if (result.totalCount === 0) return "";

  const buildUrl = (page: number, sizeOverride?: number): string => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(keptParams)) {
      if (v !== undefined && v !== "" && v !== null) p.set(k, String(v));
    }
    p.set("currPage", String(page));
    p.set("pageSize", String(sizeOverride ?? result.pageSize));
    return `${basePath}?${p.toString()}`;
  };

  const sizes = [10, 30, 50, 100];
  const sizeSelect = sizes
    .map(
      (s) =>
        `<option value="${s}"${s === result.pageSize ? " selected" : ""}>${s}/page</option>`
    )
    .join("");

  const prevHref = result.currPage > 1 ? buildUrl(result.currPage - 1) : null;
  const nextHref = result.hasNext ? buildUrl(result.currPage + 1) : null;

  // 紧凑的页码段：当前页前后各 2 个，加首末
  const pageNums: number[] = [];
  const window = 2;
  const start = Math.max(1, result.currPage - window);
  const end = Math.min(result.totalPage, result.currPage + window);
  if (start > 1) pageNums.push(1);
  if (start > 2) pageNums.push(-1); // ellipsis sentinel
  for (let i = start; i <= end; i++) pageNums.push(i);
  if (end < result.totalPage - 1) pageNums.push(-1);
  if (end < result.totalPage) pageNums.push(result.totalPage);

  const pageLinks = pageNums
    .map((n) => {
      if (n === -1) return `<span class="page-ellipsis">…</span>`;
      if (n === result.currPage)
        return `<span class="page-num page-current">${n}</span>`;
      return `<a class="page-num" href="${buildUrl(n)}">${n}</a>`;
    })
    .join("");

  // SizeChange 用纯 HTML form（无 JS）— 用一个独立 <form> 提交保留其他参数
  const hiddenParams = Object.entries(keptParams)
    .filter(([, v]) => v !== undefined && v !== "" && v !== null)
    .map(
      ([k, v]) =>
        `<input type="hidden" name="${k}" value="${escapeHtml(String(v))}">`
    )
    .join("");

  return `<div class="pagination">
  <span class="page-info">${result.totalCount} total · page ${result.currPage}/${result.totalPage || 1}</span>
  <span class="page-controls">
    ${prevHref ? `<a class="page-num" href="${prevHref}">← prev</a>` : `<span class="page-num page-disabled">← prev</span>`}
    ${pageLinks}
    ${nextHref ? `<a class="page-num" href="${nextHref}">next →</a>` : `<span class="page-num page-disabled">next →</span>`}
  </span>
  <form class="page-size" method="get" action="${escapeHtml(basePath)}">
    ${hiddenParams}
    <input type="hidden" name="currPage" value="1">
    <select name="pageSize" onchange="this.form.submit()">${sizeSelect}</select>
  </form>
</div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
