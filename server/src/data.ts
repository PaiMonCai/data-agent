import { Hono } from "hono";
import { z } from "zod";
import { ApiError, authRequired, jsonError, prisma, type AppEnv } from "./lib.js";

const router = new Hono<AppEnv>();
router.use("*", authRequired);

const tableSchema = z.enum(["datasets", "dataset_rows", "analyses"]);

function parseJsonParam<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError(400, "query_invalid", "查询参数不是有效 JSON");
  }
}

function parsePaging(c: any) {
  const range = parseJsonParam<[number, number] | null>(c.req.query("range"), null);
  const limitRaw = Number.parseInt(c.req.query("limit") || "", 10);

  if (range) {
    const from = Math.max(0, Number(range[0]) || 0);
    const to = Math.max(from, Number(range[1]) || from);
    return { skip: from, take: Math.min(2000, to - from + 1) };
  }

  return {
    skip: 0,
    take: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(1000, limitRaw) : 1000,
  };
}

function parseSelect(raw: string | undefined) {
  if (!raw || raw === "*") return null;
  return raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function pick(record: Record<string, any>, fields: string[] | null) {
  const safe = { ...record };
  delete safe.user_id;

  if (!fields) return safe;
  const out: Record<string, any> = {};
  for (const field of fields) {
    if (field === "user_id") continue;
    if (Object.prototype.hasOwnProperty.call(safe, field)) out[field] = safe[field];
  }
  return out;
}

function parseEq(raw: string | undefined) {
  const value = parseJsonParam<Record<string, unknown>>(raw, {});
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "query_invalid", "eq 参数格式不正确");
  }
  return value;
}

function parseOrder(raw: string | undefined) {
  const value = parseJsonParam<{ column?: string; ascending?: boolean } | null>(raw, null);
  if (!value) return null;
  if (!value.column) throw new ApiError(400, "query_invalid", "order.column 不能为空");
  return value;
}

function allowedEq(table: string, eq: Record<string, unknown>) {
  const allowed =
    table === "datasets"
      ? new Set(["id", "source"])
      : table === "dataset_rows"
        ? new Set(["id", "dataset_id", "row_index"])
        : new Set(["id", "dataset_id", "kind"]);

  for (const key of Object.keys(eq)) {
    if (!allowed.has(key)) throw new ApiError(400, "query_invalid", `不允许按字段 ${key} 查询`);
  }
}

async function ensureDatasetOwned(userId: string, datasetId: string) {
  const ds = await prisma.dataset.findFirst({
    where: { id: datasetId, user_id: userId },
    select: { id: true },
  });
  if (!ds) throw new ApiError(403, "dataset_forbidden", "无权访问该数据集");
}

router.get("/:table", async (c) => {
  try {
    const tableParsed = tableSchema.safeParse(c.req.param("table"));
    if (!tableParsed.success) throw new ApiError(404, "table_not_found", "数据表不存在");

    const table = tableParsed.data;
    const user = c.get("user");
    const eq = parseEq(c.req.query("eq"));
    allowedEq(table, eq);

    const order = parseOrder(c.req.query("order"));
    const { skip, take } = parsePaging(c);
    const fields = parseSelect(c.req.query("select"));

    if (table === "datasets") {
      if (order && !["created_at", "name", "row_count"].includes(order.column!)) {
        throw new ApiError(400, "query_invalid", "datasets 不支持该排序字段");
      }
      const rows = await prisma.dataset.findMany({
        where: {
          user_id: user.id,
          ...(eq.id ? { id: String(eq.id) } : {}),
          ...(eq.source ? { source: String(eq.source) } : {}),
        },
        orderBy: order
          ? ({ [order.column!]: order.ascending ? "asc" : "desc" } as any)
          : undefined,
        skip,
        take,
      });
      return c.json(rows.map((r) => pick(r as any, fields)));
    }

    if (table === "dataset_rows") {
      if (order && !["row_index", "created_at"].includes(order.column!)) {
        throw new ApiError(400, "query_invalid", "dataset_rows 不支持该排序字段");
      }
      const rows = await prisma.datasetRow.findMany({
        where: {
          user_id: user.id,
          ...(eq.id ? { id: String(eq.id) } : {}),
          ...(eq.dataset_id ? { dataset_id: String(eq.dataset_id) } : {}),
          ...(eq.row_index !== undefined ? { row_index: Number(eq.row_index) } : {}),
        },
        orderBy: order
          ? ({ [order.column!]: order.ascending ? "asc" : "desc" } as any)
          : undefined,
        skip,
        take,
      });
      return c.json(rows.map((r) => pick(r as any, fields)));
    }

    if (order && !["created_at", "kind", "question"].includes(order.column!)) {
      throw new ApiError(400, "query_invalid", "analyses 不支持该排序字段");
    }
    const rows = await prisma.analysis.findMany({
      where: {
        user_id: user.id,
        ...(eq.id ? { id: String(eq.id) } : {}),
        ...(eq.dataset_id ? { dataset_id: String(eq.dataset_id) } : {}),
        ...(eq.kind ? { kind: String(eq.kind) } : {}),
      },
      orderBy: order
        ? ({ [order.column!]: order.ascending ? "asc" : "desc" } as any)
        : undefined,
      skip,
      take,
    });
    return c.json(rows.map((r) => pick(r as any, fields)));
  } catch (e) {
    return jsonError(c, e);
  }
});

router.post("/:table", async (c) => {
  try {
    const tableParsed = tableSchema.safeParse(c.req.param("table"));
    if (!tableParsed.success) throw new ApiError(404, "table_not_found", "数据表不存在");

    const user = c.get("user");
    const body = await c.req.json().catch(() => null);
    const rows = body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ApiError(400, "request_invalid", "rows 必须是非空数组");
    }

    if (tableParsed.data === "datasets") {
      if (rows.length !== 1) throw new ApiError(400, "request_invalid", "每次只能创建一个数据集");
      const input = rows[0] || {};
      if (!input.name || !Array.isArray(input.columns)) {
        throw new ApiError(400, "request_invalid", "数据集缺少 name 或 columns");
      }

      const created = await prisma.dataset.create({
        data: {
          user_id: user.id,
          name: String(input.name).slice(0, 60),
          source: String(input.source || "file").slice(0, 30),
          columns: input.columns,
          row_count: Math.max(0, Number(input.row_count) || 0),
        },
      });
      return c.json([pick(created as any, null)], 201);
    }

    if (tableParsed.data === "dataset_rows") {
      if (rows.length > 500) throw new ApiError(400, "request_too_large", "单次最多写入 500 行");

      const datasetIds = [...new Set(rows.map((r: any) => String(r.dataset_id || "")).filter(Boolean))];
      if (datasetIds.length !== 1) {
        throw new ApiError(400, "request_invalid", "一批数据行必须属于同一个数据集");
      }
      await ensureDatasetOwned(user.id, datasetIds[0]);

      const prepared = rows.map((row: any) => {
        if (!Number.isInteger(Number(row.row_index))) {
          throw new ApiError(400, "request_invalid", "row_index 必须是整数");
        }
        return {
          user_id: user.id,
          dataset_id: datasetIds[0],
          row_index: Number(row.row_index),
          data: row.data ?? {},
        };
      });

      await prisma.datasetRow.createMany({ data: prepared });
      return c.json([], 201);
    }

    if (rows.length > 50) throw new ApiError(400, "request_too_large", "单次最多写入 50 条分析记录");

    const created = [];
    for (const input of rows) {
      const datasetId = String(input.dataset_id || "");
      await ensureDatasetOwned(user.id, datasetId);

      const row = await prisma.analysis.create({
        data: {
          user_id: user.id,
          dataset_id: datasetId,
          question: String(input.question || "").slice(0, 4000),
          kind: String(input.kind || "analysis").slice(0, 100),
          plan: input.plan ?? undefined,
          result: input.result ?? {},
          summary: input.summary == null ? null : String(input.summary).slice(0, 20000),
          model: input.model == null ? null : String(input.model).slice(0, 200),
        },
      });
      created.push(pick(row as any, null));
    }

    return c.json(created, 201);
  } catch (e) {
    return jsonError(c, e);
  }
});

router.patch("/:table", async (c) => {
  try {
    const tableParsed = tableSchema.safeParse(c.req.param("table"));
    if (!tableParsed.success) throw new ApiError(404, "table_not_found", "数据表不存在");

    const user = c.get("user");
    const body = await c.req.json().catch(() => null);
    const patch = body?.patch;
    const eq = body?.eq;

    if (!patch || typeof patch !== "object" || !eq || typeof eq !== "object") {
      throw new ApiError(400, "request_invalid", "patch 和 eq 都必须是对象");
    }
    allowedEq(tableParsed.data, eq);

    if (tableParsed.data === "datasets") {
      if (!eq.id) throw new ApiError(400, "request_invalid", "更新数据集必须指定 id");
      const data: Record<string, any> = {};
      if (patch.name !== undefined) data.name = String(patch.name).slice(0, 60);
      if (patch.source !== undefined) data.source = String(patch.source).slice(0, 30);
      if (patch.columns !== undefined) data.columns = patch.columns;
      if (patch.row_count !== undefined) data.row_count = Math.max(0, Number(patch.row_count) || 0);

      const result = await prisma.dataset.updateMany({
        where: { id: String(eq.id), user_id: user.id },
        data,
      });
      return c.json({ updated: result.count });
    }

    throw new ApiError(400, "update_not_supported", "当前只允许更新 datasets");
  } catch (e) {
    return jsonError(c, e);
  }
});

router.delete("/:table", async (c) => {
  try {
    const tableParsed = tableSchema.safeParse(c.req.param("table"));
    if (!tableParsed.success) throw new ApiError(404, "table_not_found", "数据表不存在");

    const user = c.get("user");
    const body = await c.req.json().catch(() => null);
    const eq = body?.eq;
    if (!eq || typeof eq !== "object" || Array.isArray(eq) || Object.keys(eq).length === 0) {
      throw new ApiError(400, "request_invalid", "删除操作必须提供非空 eq 条件");
    }
    allowedEq(tableParsed.data, eq);

    if (tableParsed.data === "datasets") {
      if (!eq.id) throw new ApiError(400, "request_invalid", "删除数据集必须指定 id");
      const result = await prisma.dataset.deleteMany({
        where: { id: String(eq.id), user_id: user.id },
      });
      return c.json({ deleted: result.count });
    }

    if (tableParsed.data === "dataset_rows") {
      if (!eq.dataset_id && !eq.id) {
        throw new ApiError(400, "request_invalid", "删除数据行必须指定 dataset_id 或 id");
      }
      const result = await prisma.datasetRow.deleteMany({
        where: {
          user_id: user.id,
          ...(eq.id ? { id: String(eq.id) } : {}),
          ...(eq.dataset_id ? { dataset_id: String(eq.dataset_id) } : {}),
        },
      });
      return c.json({ deleted: result.count });
    }

    if (!eq.dataset_id && !eq.id) {
      throw new ApiError(400, "request_invalid", "删除分析记录必须指定 dataset_id 或 id");
    }
    const result = await prisma.analysis.deleteMany({
      where: {
        user_id: user.id,
        ...(eq.id ? { id: String(eq.id) } : {}),
        ...(eq.dataset_id ? { dataset_id: String(eq.dataset_id) } : {}),
      },
    });
    return c.json({ deleted: result.count });
  } catch (e) {
    return jsonError(c, e);
  }
});

export default router;
