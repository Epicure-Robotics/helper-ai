import { sql } from "drizzle-orm";
import { db } from "../client";

export const explainAnalyze = async <T extends { toSQL(): unknown } | { getSQL(): unknown }>(query: T): Promise<T> => {
  const rawQuery = "getSQL" in query ? query.getSQL() : query.toSQL();
  const debugResult = await db.execute(sql`EXPLAIN ANALYZE ${rawQuery}`);

  console.debug(debugResult);
  return query;
};
