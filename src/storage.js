import { STORAGE_KEY } from "./constants.js";
import { createId, normalizeRepair } from "./model.js";

/** 首次使用时的示例数据，帮助用户理解字段。 */
export function defaultRepairs(now = Date.now()) {
  return [
    {
      id: createId(),
      location: "厨房",
      title: "水槽下方渗水",
      priority: "high",
      cost: 260,
      status: "todo",
      photo: "",
      note: "先检查软管接口",
      createdAt: now,
      updatedAt: now
    }
  ];
}

export function defaultState(now = Date.now()) {
  return {
    repairs: defaultRepairs(now),
    view: { status: "all", location: "all", priority: "all", search: "", sort: "priority" }
  };
}

/**
 * 从任意来源恢复状态：整体非对象、repairs 非数组、单条记录损坏、
 * 字段缺失或类型错误都不会抛异常，无法识别的记录被丢弃，其余照常恢复。
 */
export function parseStoredState(raw, now = Date.now()) {
  let parsed;
  if (raw == null) return defaultState(now);
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return defaultState(now);
    try {
      parsed = JSON.parse(text);
    } catch {
      return defaultState(now);
    }
  } else {
    parsed = raw;
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.repairs)) {
    return defaultState(now);
  }

  const seen = new Set();
  const repairs = [];
  parsed.repairs.forEach((item, index) => {
    const repair = normalizeRepair(item, now - (parsed.repairs.length - index) * 1000);
    if (!repair) return;
    if (seen.has(repair.id)) repair.id = createId();
    seen.add(repair.id);
    repairs.push(repair);
  });

  return {
    repairs,
    view: normalizeView(parsed.view)
  };
}

export function normalizeView(view) {
  const source = view && typeof view === "object" ? view : {};
  const allowedStatus = ["all", "todo", "doing", "done"];
  const allowedPriority = ["all", "high", "medium", "low"];
  const allowedSort = ["priority", "cost", "time"];
  return {
    status: allowedStatus.includes(source.status) ? source.status : "all",
    location: typeof source.location === "string" && source.location ? source.location : "all",
    priority: allowedPriority.includes(source.priority) ? source.priority : "all",
    search: typeof source.search === "string" ? source.search.slice(0, 100) : "",
    sort: allowedSort.includes(source.sort) ? source.sort : "priority"
  };
}

export class RepairStore {
  constructor(storage = globalThis.localStorage, key = STORAGE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  load(now = Date.now()) {
    if (!this.storage) return defaultState(now);
    let raw = null;
    try {
      raw = this.storage.getItem(this.key);
    } catch {
      return defaultState(now);
    }
    return parseStoredState(raw, now);
  }

  save(state) {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }
}
