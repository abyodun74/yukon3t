// Test support only: a tiny in-memory stand-in for the parts of Prisma's findMany the feed tests rely on (AND / OR /
// NOT, equality, in / notIn, lt / lte / gt / gte, nested relation objects, orderBy, cursor + skip, take). It lets a
// route or action test run its real queries against a list of rows, so what is asserted is what a reader would see.

type Row = Record<string, unknown>;

const OPERATORS = new Set(["in", "notIn", "lt", "lte", "gt", "gte", "equals", "not"]);

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value);
}

function matchesField(actual: unknown, condition: unknown): boolean {
  if (isPlainObject(condition) && Object.keys(condition).some((k) => OPERATORS.has(k))) {
    const a = comparable(actual);
    return Object.entries(condition).every(([op, raw]) => {
      const v = comparable(raw);
      switch (op) {
        case "in":
          return (raw as unknown[]).map(comparable).includes(a);
        case "notIn":
          return !(raw as unknown[]).map(comparable).includes(a);
        case "lt":
          return (a as number) < (v as number);
        case "lte":
          return (a as number) <= (v as number);
        case "gt":
          return (a as number) > (v as number);
        case "gte":
          return (a as number) >= (v as number);
        case "equals":
          return a === v;
        case "not":
          return !matchesField(actual, raw);
        default:
          return false;
      }
    });
  }
  if (isPlainObject(condition)) return isPlainObject(actual) && matchesWhere(actual, condition);
  return comparable(actual) === comparable(condition);
}

export function matchesWhere(row: Row, where: unknown): boolean {
  if (!where) return true;
  if (Array.isArray(where)) return where.every((w) => matchesWhere(row, w));
  return Object.entries(where as Record<string, unknown>).every(([key, condition]) => {
    if (key === "AND") return matchesWhere(row, condition);
    if (key === "OR") return (condition as unknown[]).some((w) => matchesWhere(row, w));
    if (key === "NOT") {
      return Array.isArray(condition) ? condition.every((w) => !matchesWhere(row, w)) : !matchesWhere(row, condition);
    }
    return matchesField(row[key], condition);
  });
}

type FindManyArgs = {
  where?: unknown;
  orderBy?: Record<string, "asc" | "desc"> | Array<Record<string, "asc" | "desc">>;
  take?: number;
  skip?: number;
  cursor?: { id: string };
};

/** findMany over `rows`, returning the rows themselves (select / include are ignored). */
export function findManyInMemory<T extends Row>(rows: readonly T[], args: FindManyArgs = {}): T[] {
  let result = rows.filter((row) => matchesWhere(row, args.where));
  const orders = args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) : [];
  result = [...result].sort((a, b) => {
    for (const order of orders) {
      const [field, dir] = Object.entries(order)[0]!;
      const x = comparable(a[field]) as number | string;
      const y = comparable(b[field]) as number | string;
      if (x < y) return dir === "asc" ? -1 : 1;
      if (x > y) return dir === "asc" ? 1 : -1;
    }
    return 0;
  });
  if (args.cursor) {
    const at = result.findIndex((row) => row.id === args.cursor!.id);
    result = at >= 0 ? result.slice(at) : [];
  }
  if (args.skip) result = result.slice(args.skip);
  if (args.take !== undefined) result = result.slice(0, args.take);
  return result;
}
