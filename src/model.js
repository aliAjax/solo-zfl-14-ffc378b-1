import {
  FLOW_STATUSES,
  LIMITS,
  PRIORITIES,
  PRIORITY_RANK
} from "./constants.js";

let counter = 0;

export function createId() {
  counter += 1;
  const random =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `r-${Date.now().toString(36)}-${counter.toString(36)}-${random}`;
}

function removeControlChars(value) {
  let output = "";
  for (const char of String(value ?? "")) {
    const code = char.codePointAt(0);
    // 保留制表符与换行，其余控制字符一律剔除
    if ((code >= 32 && code !== 127) || code === 9 || code === 10) output += char;
  }
  return output;
}

export function cleanText(value, max) {
  const text = removeControlChars(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

export function isValidId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{4,64}$/.test(value);
}

export function isHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 将任意来源的单条记录规范化；字段缺失时回退到安全默认值。
 * 返回 null 表示该记录无法恢复（连问题描述都没有）。
 */
export function normalizeRepair(raw, fallbackTime = 0) {
  if (!raw || typeof raw !== "object") return null;

  const title = cleanText(raw.title, LIMITS.titleMax);
  if (!title) return null;

  const status = FLOW_STATUSES.includes(raw.status) ? raw.status : "todo";
  const priority = Object.hasOwn(PRIORITIES, raw.priority) ? raw.priority : "medium";
  const timestamp = Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : fallbackTime;

  let cost = Number(raw.cost);
  if (!Number.isFinite(cost)) cost = 0;
  cost = Math.min(LIMITS.costMax, Math.max(0, Math.round(cost * 100) / 100));

  return {
    id: isValidId(raw.id) ? raw.id : createId(),
    location: cleanText(raw.location, LIMITS.locationMax) || "未填写位置",
    title,
    priority,
    cost,
    status,
    photo: isHttpUrl(raw.photo) ? raw.photo.trim() : "",
    note: cleanText(raw.note, LIMITS.noteMax),
    createdAt: timestamp,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : timestamp
  };
}

/**
 * 校验表单输入。返回 { values, errors }；errors 为空时 values 可直接入库。
 */
export function validateRepairInput(data) {
  const errors = {};
  const values = {
    location: cleanText(data.location, LIMITS.locationMax),
    title: cleanText(data.title, LIMITS.titleMax),
    priority: String(data.priority ?? "medium"),
    cost: 0,
    status: String(data.status ?? "todo"),
    photo: cleanText(data.photo, 500),
    note: cleanText(data.note, LIMITS.noteMax)
  };

  if (!values.location) errors.location = "请填写位置";
  else if (values.location.length > LIMITS.locationMax)
    errors.location = `位置不能超过 ${LIMITS.locationMax} 个字`;

  if (!values.title) errors.title = "请填写问题描述";
  else if (values.title.length > LIMITS.titleMax)
    errors.title = `问题描述不能超过 ${LIMITS.titleMax} 个字`;

  if (!Object.hasOwn(PRIORITIES, values.priority)) errors.priority = "优先级不合法";
  if (!FLOW_STATUSES.includes(values.status)) errors.status = "状态不合法";

  const rawCost = String(data.cost ?? "").trim();
  if (rawCost === "") {
    values.cost = 0;
  } else if (!/^\d+(\.\d{1,2})?$/.test(rawCost)) {
    errors.cost = "费用需为不小于 0 的数字，最多两位小数";
  } else {
    values.cost = Math.min(LIMITS.costMax, Math.round(Number(rawCost) * 100) / 100);
    if (Number(rawCost) > LIMITS.costMax) errors.cost = "费用超出允许范围";
  }

  if (values.photo && !isHttpUrl(values.photo)) {
    errors.photo = "照片地址需为 http/https 链接";
  }

  if (values.note.length > LIMITS.noteMax) errors.note = `备注不能超过 ${LIMITS.noteMax} 个字`;

  return { values, errors };
}

export function createRepair(data, now = Date.now()) {
  const { values, errors } = validateRepairInput(data);
  if (Object.keys(errors).length) return { repair: null, errors };
  return {
    repair: { id: createId(), ...values, createdAt: now, updatedAt: now },
    errors: {}
  };
}

export function updateRepair(repair, data, now = Date.now()) {
  const { values, errors } = validateRepairInput(data);
  if (Object.keys(errors).length) return { repair: null, errors };
  return {
    repair: { ...repair, ...values, createdAt: repair.createdAt, updatedAt: now },
    errors: {}
  };
}

export function transitionStatus(repair, next, now = Date.now()) {
  if (!FLOW_STATUSES.includes(next) || next === repair.status) return repair;
  return { ...repair, status: next, updatedAt: now };
}

/** 搜索 + 状态/位置/优先级筛选；搜索词为空时视为不过滤。 */
export function queryRepairs(repairs, view = {}) {
  const { status = "all", location = "all", priority = "all", search = "" } = view;
  const keyword = cleanText(search, LIMITS.titleMax).toLocaleLowerCase("zh-CN");

  return repairs.filter((repair) => {
    if (status !== "all" && repair.status !== status) return false;
    if (location !== "all" && repair.location !== location) return false;
    if (priority !== "all" && repair.priority !== priority) return false;
    if (keyword) {
      const haystack = [repair.location, repair.title, repair.note]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

/** priority=高→低；cost=多→少；time=新→旧。同序按创建时间、id 兜底保证稳定。 */
export function sortRepairs(repairs, sort = "priority") {
  const copy = [...repairs];
  copy.sort((a, b) => {
    let result = 0;
    if (sort === "cost") result = b.cost - a.cost;
    else if (sort === "time") result = b.createdAt - a.createdAt;
    else result = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];

    if (result === 0) result = b.createdAt - a.createdAt;
    if (result === 0) result = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return result;
  });
  return copy;
}

export function getStats(repairs) {
  const stats = {
    unfinishedCount: 0,
    doingCount: 0,
    unfinishedCost: 0,
    doneSpent: 0
  };
  for (const repair of repairs) {
    if (repair.status === "done") {
      stats.doneSpent += repair.cost;
    } else {
      stats.unfinishedCount += 1;
      stats.unfinishedCost += repair.cost;
      if (repair.status === "doing") stats.doingCount += 1;
    }
  }
  stats.unfinishedCost = Math.round(stats.unfinishedCost * 100) / 100;
  stats.doneSpent = Math.round(stats.doneSpent * 100) / 100;
  return stats;
}

export function getLocations(repairs) {
  return [...new Set(repairs.map((repair) => repair.location))].sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );
}

export function formatMoney(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}

/** 防止同一条表单被重复提交：规范化后的内容在短时间内只接受一次。 */
export function fingerprint(values) {
  return [
    values.location,
    values.title,
    values.priority,
    values.cost,
    values.status,
    values.photo,
    values.note
  ].join("|");
}
