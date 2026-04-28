import { sql } from "../src/core/db.ts";

const rows = await sql`
  SELECT
    COUNT(*) FILTER (WHERE deleted = 0) AS total,
    COUNT(*) FILTER (WHERE deleted = 0 AND triage_decision = 'pending') AS pending
  FROM raw_files
`;

const byType = await sql`
  SELECT research_type, COUNT(*) AS count
  FROM raw_files
  WHERE deleted = 0
  GROUP BY research_type
  ORDER BY count DESC, research_type ASC
`;

const byDay = await sql`
  SELECT
    (create_time AT TIME ZONE 'Asia/Shanghai')::date AS sh_day,
    COUNT(*) AS count
  FROM raw_files
  WHERE deleted = 0
  GROUP BY 1
  ORDER BY 1 DESC
  LIMIT 10
`;

console.log(JSON.stringify({
  summary: rows[0],
  by_type: byType,
  by_day: byDay,
}, null, 2));
