import { describe, it, expect } from "vitest";
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from "kysely";
import { normName, searchWine } from "../wine.js";

/**
 * No DB here: a fake driver records each compiled query and answers from a
 * handler. What is under test is the query logic - which queries run, with
 * which parameters, and what comes back.
 */
function fakeDb(answer: (q: CompiledQuery) => unknown[]) {
  const seen: CompiledQuery[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
      seen.push(q);
      return { rows: answer(q) as R[] };
    },
    streamQuery() { throw new Error("not used"); },
  };
  const driver: Driver = {
    async init() {},
    async acquireConnection() { return connection; },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  };
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, seen };
}

const marlborough = { type: "appellation", id: 8621, name: "Marlborough", context: "NZ · GI", rank: 0.41 };
const isFallback = (q: CompiledQuery) => q.sql.includes("position(");
const isAndQuery = (q: CompiledQuery) => q.sql.includes("FROM wine.appellations") && q.sql.includes("@@");

describe("normName", () => {
  it("matches the loaders' name_norm", () => {
    expect(normName("Château Léoville-Las Cases")).toBe("chateau leoville las cases");
    expect(normName("Moscato d'Asti")).toBe("moscato dasti");
    expect(normName("Weißburgunder")).toBe("weissburgunder");
  });
});

describe("searchWine appellation fallback", () => {
  it("finds the appellation a mixed query names when the AND query finds none", async () => {
    const { db, seen } = fakeDb((q) => (isFallback(q) ? [marlborough] : []));
    const hits = await searchWine(db, { q: "Marlborough Sauvignon Blanc", type: "appellation" });
    expect(hits.map((h) => h.id)).toEqual([8621]);
    const fallback = seen.find(isFallback)!;
    expect(fallback.parameters).toContain(" marlborough sauvignon blanc ");
  });

  it("keeps the AND result and skips the fallback when it finds something", async () => {
    const { db, seen } = fakeDb((q) => (isAndQuery(q) ? [marlborough] : []));
    const hits = await searchWine(db, { q: "Marlborough", type: "appellation" });
    expect(hits.map((h) => h.id)).toEqual([8621]);
    expect(seen.some(isFallback)).toBe(false);
  });

  it("passes the country filter to the fallback", async () => {
    const { db, seen } = fakeDb(() => []);
    await searchWine(db, { q: "Marlborough Sauvignon Blanc", type: "appellation", country: "nz" });
    const fallback = seen.find(isFallback)!;
    expect(fallback.sql).toContain("a.country =");
    expect(fallback.parameters).toContain("NZ");
  });
});
