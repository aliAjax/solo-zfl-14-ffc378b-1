import { describe, expect, it } from "vitest";
import {
  cleanText,
  createRepair,
  fingerprint,
  formatMoney,
  getLocations,
  getStats,
  isHttpUrl,
  queryRepairs,
  sortRepairs,
  transitionStatus,
  updateRepair
} from "../../src/model.js";

const base = (overrides = {}) => ({
  id: overrides.id || `r-${Math.random().toString(16).slice(2)}`,
  location: "厨房",
  title: "水槽渗水",
  priority: "medium",
  cost: 100,
  status: "todo",
  photo: "",
  note: "",
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides
});

const validForm = (overrides = {}) => ({
  location: "卫生间",
  title: "水龙头漏水",
  priority: "high",
  cost: "120.5",
  status: "todo",
  photo: "",
  note: "联系物业",
  ...overrides
});

describe("createRepair / 输入校验", () => {
  it("合法输入创建成功并生成 id 与时间戳", () => {
    const { repair, errors } = createRepair(validForm(), 5000);
    expect(errors).toEqual({});
    expect(repair).toMatchObject({
      location: "卫生间",
      title: "水龙头漏水",
      priority: "high",
      cost: 120.5,
      status: "todo",
      note: "联系物业",
      createdAt: 5000,
      updatedAt: 5000
    });
    expect(repair.id).toMatch(/^[A-Za-z0-9_-]{4,64}$/);
  });

  it.each([
    ["空位置", { location: "   " }],
    ["空标题", { title: "" }],
    ["负数费用", { cost: "-1" }],
    ["非法费用", { cost: "abc" }],
    ["三位小数费用", { cost: "1.234" }],
    ["javascript 协议照片", { photo: "javascript:alert(1)" }],
    ["data 协议照片", { photo: "data:text/html,<script>alert(1)</script>" }],
    ["非法优先级", { priority: "urgent" }],
    ["非法状态", { status: "unknown" }]
  ])("拒绝非法输入：%s", (_name, patch) => {
    const { repair, errors } = createRepair(validForm(patch));
    expect(repair).toBeNull();
    expect(Object.keys(errors).length).toBeGreaterThan(0);
  });

  it("费用为空时按 0 处理", () => {
    const { repair, errors } = createRepair(validForm({ cost: "" }));
    expect(errors).toEqual({});
    expect(repair.cost).toBe(0);
  });

  it("清理控制字符并去除首尾空白", () => {
    const { repair } = createRepair(
      validForm({ title: "  门锁\u0000\u0007松动 ", note: "电话\t123\n备注" })
    );
    expect(repair.title).toBe("门锁松动");
    expect(repair.note).toBe("电话\t123\n备注");
  });

  it("超长文本被截断到上限", () => {
    const longLocation = "卫".repeat(50);
    const { repair } = createRepair(validForm({ location: longLocation }));
    expect(repair.location.length).toBe(30);
  });

  it("http/https 照片地址被接受", () => {
    expect(isHttpUrl("https://example.com/a.jpg")).toBe(true);
    expect(isHttpUrl("http://example.com/a.jpg")).toBe(true);
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("not a url")).toBe(false);
  });
});

describe("updateRepair / 编辑", () => {
  it("更新字段并保留 id 与创建时间", () => {
    const repair = base();
    const { repair: updated, errors } = updateRepair(repair, validForm({ cost: "999" }), 9000);
    expect(errors).toEqual({});
    expect(updated.id).toBe(repair.id);
    expect(updated.createdAt).toBe(1000);
    expect(updated.updatedAt).toBe(9000);
    expect(updated.cost).toBe(999);
  });

  it("编辑时非法输入被拒绝且原记录不变", () => {
    const repair = base();
    const { repair: updated, errors } = updateRepair(repair, validForm({ title: "" }));
    expect(updated).toBeNull();
    expect(errors.title).toBeTruthy();
    expect(repair.title).toBe("水槽渗水");
  });
});

describe("transitionStatus / 状态流转", () => {
  it("todo→doing→done→重新打开", () => {
    let r = base({ status: "todo" });
    r = transitionStatus(r, "doing", 100);
    expect(r.status).toBe("doing");
    expect(r.updatedAt).toBe(100);
    r = transitionStatus(r, "done", 200);
    expect(r.status).toBe("done");
    r = transitionStatus(r, "todo", 300);
    expect(r.status).toBe("todo");
  });

  it("非法状态或相同状态不产生新对象", () => {
    const r = base({ status: "todo" });
    expect(transitionStatus(r, "nope")).toBe(r);
    expect(transitionStatus(r, "todo")).toBe(r);
  });
});

describe("queryRepairs / 筛选与搜索", () => {
  const repairs = [
    base({ id: "a", location: "厨房", priority: "high", status: "todo", title: "渗水", note: "软管" }),
    base({ id: "b", location: "卫生间", priority: "low", status: "doing", title: "漏水", note: "" }),
    base({ id: "c", location: "客厅", priority: "medium", status: "done", title: "灯具损坏", note: "换灯泡" })
  ];

  it("按状态筛选", () => {
    expect(queryRepairs(repairs, { status: "todo" }).map((r) => r.id)).toEqual(["a"]);
    expect(queryRepairs(repairs, { status: "doing" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("按位置筛选", () => {
    expect(queryRepairs(repairs, { location: "厨房" }).map((r) => r.id)).toEqual(["a"]);
  });

  it("按优先级筛选", () => {
    expect(queryRepairs(repairs, { priority: "low" }).map((r) => r.id)).toEqual(["b"]);
  });

  it("多条件同时生效", () => {
    expect(
      queryRepairs(repairs, { status: "todo", location: "厨房", priority: "high" }).map((r) => r.id)
    ).toEqual(["a"]);
    expect(queryRepairs(repairs, { status: "done", priority: "high" })).toEqual([]);
  });

  it("搜索匹配位置、标题与备注，大小写不敏感", () => {
    expect(queryRepairs(repairs, { search: "厨房" }).map((r) => r.id)).toEqual(["a"]);
    expect(queryRepairs(repairs, { search: "软管" }).map((r) => r.id)).toEqual(["a"]);
    expect(queryRepairs(repairs, { search: "灯" }).map((r) => r.id)).toEqual(["c"]);
    expect(queryRepairs(repairs, { search: "不存在" })).toEqual([]);
  });
});

describe("sortRepairs / 排序", () => {
  const repairs = [
    base({ id: "x", priority: "low", cost: 50, createdAt: 100 }),
    base({ id: "y", priority: "high", cost: 500, createdAt: 200 }),
    base({ id: "z", priority: "high", cost: 900, createdAt: 300 })
  ];

  it("按优先级高到低，同优先级新的在前", () => {
    expect(sortRepairs(repairs, "priority").map((r) => r.id)).toEqual(["z", "y", "x"]);
  });

  it("按费用多到少", () => {
    expect(sortRepairs(repairs, "cost").map((r) => r.id)).toEqual(["z", "y", "x"]);
  });

  it("按时间新到旧", () => {
    expect(sortRepairs(repairs, "time").map((r) => r.id)).toEqual(["z", "y", "x"]);
  });

  it("不修改原数组顺序", () => {
    sortRepairs(repairs, "cost");
    expect(repairs.map((r) => r.id)).toEqual(["x", "y", "z"]);
  });
});

describe("getStats / 统计", () => {
  it("准确汇总四项指标", () => {
    const repairs = [
      base({ status: "todo", cost: 100 }),
      base({ status: "doing", cost: 200.5 }),
      base({ status: "done", cost: 300 })
    ];
    expect(getStats(repairs)).toEqual({
      unfinishedCount: 2,
      doingCount: 1,
      unfinishedCost: 300.5,
      doneSpent: 300
    });
  });

  it("空数据全部为 0", () => {
    expect(getStats([])).toEqual({
      unfinishedCount: 0,
      doingCount: 0,
      unfinishedCost: 0,
      doneSpent: 0
    });
  });
});

describe("防重复提交指纹", () => {
  it("规范化后相同内容产生相同指纹", () => {
    const a = createRepair(validForm()).repair;
    const b = createRepair(validForm()).repair;
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(a.id).not.toBe(b.id);
  });
});

describe("工具函数", () => {
  it("cleanText 处理 null/undefined", () => {
    expect(cleanText(null, 10)).toBe("");
    expect(cleanText(undefined, 10)).toBe("");
    expect(cleanText(12345, 10)).toBe("12345");
  });

  it("formatMoney 格式化人民币", () => {
    expect(formatMoney(0)).toBe("¥0");
    expect(formatMoney(1234.5)).toBe("¥1,234.5");
  });

  it("getLocations 去重并排序", () => {
    const repairs = [base({ location: "厨房" }), base({ location: "客厅" }), base({ location: "厨房" })];
    expect(getLocations(repairs)).toEqual(["厨房", "客厅"]);
  });
});
