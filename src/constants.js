export const STORAGE_KEY = "zfl-14-repairs";

export const STATUSES = {
  all: "全部",
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

export const FLOW_STATUSES = ["todo", "doing", "done"];

export const PRIORITIES = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export const SORTS = {
  priority: "按优先级",
  cost: "按费用",
  time: "按时间"
};

export const LIMITS = {
  locationMax: 30,
  titleMax: 100,
  noteMax: 500,
  costMax: 10_000_000
};

export const PHOTO_FALLBACK = "照片无法显示";
