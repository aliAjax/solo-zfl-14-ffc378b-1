import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";

function memoryStorage(initial = {}) {
  let map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => {
      map = new Map();
    },
    dump: () => Object.fromEntries(map)
  };
}

function setup() {
  const storage = memoryStorage();
  const root = document.createElement("div");
  document.body.appendChild(root);
  let clock = 1_000_000;
  const app = createApp(root, { storage, now: () => ++clock });
  const tick = (ms = 1000) => {
    clock += ms;
  };
  return { root, storage, app, tick };
}

function form(root) {
  return root.querySelector("#repair-form");
}

function fillForm(root, data) {
  const f = form(root);
  for (const [name, value] of Object.entries(data)) {
    f.elements[name].value = value;
  }
  return f;
}

function submitForm(root, data) {
  const f = fillForm(root, data);
  f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  return f;
}

const validData = (overrides = {}) => ({
  location: "卫生间",
  title: "水龙头漏水",
  priority: "high",
  cost: "120",
  status: "todo",
  photo: "",
  note: "联系物业",
  ...overrides
});

function cards(root) {
  return [...root.querySelectorAll(".repair")];
}

function cardByTitle(root, title) {
  return cards(root).find((card) => card.textContent.includes(title));
}

function stat(root, key) {
  return root.querySelector(`[data-stat="${key}"]`).textContent;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("新增 / 校验", () => {
  it("提交合法表单后新增事项并更新统计", () => {
    const { root, app } = setup();
    expect(cards(root)).toHaveLength(1);

    submitForm(root, validData());
    app.flush();

    expect(cards(root)).toHaveLength(2);
    const card = cardByTitle(root, "水龙头漏水");
    expect(card).toBeTruthy();
    expect(card.querySelector("h3").textContent).toBe("卫生间");
    expect(card.querySelector(".priority").textContent).toBe("高优先级");
    expect(stat(root, "unfinishedCount")).toBe("2");
    expect(stat(root, "unfinishedCost")).toBe("¥380");
  });

  it("必填项为空时显示错误且不产生记录", () => {
    const { root } = setup();
    submitForm(root, validData({ location: "", title: "" }));
    expect(cards(root)).toHaveLength(1);
    expect(form(root).querySelector('[data-error="location"]').textContent).toContain("位置");
    expect(form(root).querySelector('[data-error="title"]').textContent).toContain("问题描述");
  });

  it("危险链接被拒绝并显示照片错误", () => {
    const { root } = setup();
    submitForm(root, validData({ photo: "javascript:alert(1)" }));
    expect(cards(root)).toHaveLength(1);
    expect(form(root).querySelector('[data-error="photo"]').textContent).toContain("http/https");
  });

  it("相同内容连续提交两次只产生一条记录", () => {
    const { root, app } = setup();
    const data = validData();
    submitForm(root, data);
    submitForm(root, data);
    app.flush();
    expect(cards(root)).toHaveLength(2);
    expect(root.querySelector('[data-role="form-message"]').textContent).toContain("重复提交");
  });
});

describe("编辑 / 删除", () => {
  it("进入编辑后回填字段，保存后更新同一条记录", () => {
    const { root, app } = setup();
    submitForm(root, validData({ title: "待编辑事项", cost: "100" }));
    const card = cardByTitle(root, "待编辑事项");
    const id = card.dataset.id;

    card.querySelector('[data-action="edit"]').click();
    expect(root.querySelector(".panel h2").textContent).toBe("编辑维修事项");
    expect(form(root).elements.title.value).toBe("待编辑事项");
    expect(form(root).querySelector('input[name="id"]').value).toBe(id);

    fillForm(root, { title: "已编辑事项", cost: "180" });
    form(root).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    app.flush();

    expect(cards(root)).toHaveLength(2);
    const updated = cardByTitle(root, "已编辑事项");
    expect(updated.dataset.id).toBe(id);
    expect(updated.textContent).toContain("¥180");
    expect(cardByTitle(root, "待编辑事项")).toBeFalsy();
    expect(root.querySelector(".panel h2").textContent).toBe("新增维修事项");
  });

  it("编辑时校验失败保留编辑态", () => {
    const { root } = setup();
    submitForm(root, validData({ title: "待编辑事项" }));
    cardByTitle(root, "待编辑事项").querySelector('[data-action="edit"]').click();
    fillForm(root, { title: "   " });
    form(root).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(cards(root)).toHaveLength(2);
    expect(cardByTitle(root, "待编辑事项")).toBeTruthy();
    expect(form(root).querySelector('[data-error="title"]').textContent).toContain("问题描述");
  });

  it("取消编辑回到新增表单", () => {
    const { root } = setup();
    cardByTitle(root, "水槽下方渗水").querySelector('[data-action="edit"]').click();
    root.querySelector('[data-action="cancel-edit"]').click();
    expect(root.querySelector(".panel h2").textContent).toBe("新增维修事项");
    expect(form(root).querySelector('input[name="id"]')).toBeNull();
  });

  it("编辑表单中 name=id 控件遮蔽 form.id 时仍拦截原生提交并更新同一条记录", () => {
    // 真实浏览器里具名表单控件会遮蔽 HTMLFormElement 的内建 id 属性，
    // 使 form.id 返回该 input 节点而非字符串；happy-dom 不模拟这一点，这里手动复现。
    const { root, app } = setup();
    submitForm(root, validData({ title: "待编辑事项", cost: "100" }));
    const card = cardByTitle(root, "待编辑事项");
    const id = card.dataset.id;
    card.querySelector('[data-action="edit"]').click();

    const editForm = form(root);
    const hiddenIdInput = editForm.querySelector('input[name="id"]');
    expect(hiddenIdInput).toBeTruthy();
    Object.defineProperty(editForm, "id", { value: hiddenIdInput, configurable: true });
    expect(editForm.id).toBe(hiddenIdInput);

    const nativeSubmit = vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
    fillForm(root, { title: "遮蔽后仍能保存", cost: "160" });
    const notCanceled = editForm.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true })
    );

    // 原生提交被 preventDefault 拦截（dispatchEvent 返回 false），且未调用 form.submit()
    expect(notCanceled).toBe(false);
    expect(nativeSubmit).not.toHaveBeenCalled();
    app.flush();

    const updated = cardByTitle(root, "遮蔽后仍能保存");
    expect(updated).toBeTruthy();
    expect(updated.dataset.id).toBe(id);
    expect(cards(root)).toHaveLength(2);
    expect(updated.textContent).toContain("¥160");
    expect(cardByTitle(root, "待编辑事项")).toBeFalsy();
  });

  it("删除后列表与存储同步更新", () => {
    const { root, app, storage } = setup();
    expect(cards(root)).toHaveLength(1);
    cardByTitle(root, "水槽下方渗水").querySelector('[data-action="delete"]').click();
    app.flush();
    expect(cards(root)).toHaveLength(0);
    expect(root.querySelector(".empty").textContent).toContain("没有符合条件");

    const root2 = document.createElement("div");
    document.body.appendChild(root2);
    createApp(root2, { storage });
    expect(cards(root2)).toHaveLength(0);
  });
});

describe("状态流转与统计", () => {
  it("待处理→处理中→已完成→重新打开，统计随之变化", () => {
    const { root, app, tick } = setup();
    // 默认示例事项：待处理、¥260
    expect(stat(root, "unfinishedCount")).toBe("1");
    expect(stat(root, "doingCount")).toBe("0");
    expect(stat(root, "unfinishedCost")).toBe("¥260");
    expect(stat(root, "doneSpent")).toBe("¥0");

    const card = () => cardByTitle(root, "水槽下方渗水");
    card().querySelector('[data-action="flow"]').click();
    expect(card().querySelector(".status").textContent).toBe("处理中");
    expect(stat(root, "doingCount")).toBe("1");

    tick();
    card().querySelector('[data-action="flow"]').click();
    expect(card().querySelector(".status").textContent).toBe("已完成");
    expect(stat(root, "unfinishedCount")).toBe("0");
    expect(stat(root, "unfinishedCost")).toBe("¥0");
    expect(stat(root, "doneSpent")).toBe("¥260");

    tick();
    card().querySelector('[data-action="flow"]').click();
    expect(card().querySelector(".status").textContent).toBe("待处理");
    expect(stat(root, "unfinishedCount")).toBe("1");
    app.flush();
  });

  it("处理中和已完成支出可同时准确汇总", () => {
    const { root } = setup();
    submitForm(root, validData({ title: "处理中事项", status: "doing", cost: "200.5" }));
    submitForm(root, validData({ title: "已完成事项", status: "done", cost: "99" }));
    expect(stat(root, "unfinishedCount")).toBe("2");
    expect(stat(root, "doingCount")).toBe("1");
    expect(stat(root, "unfinishedCost")).toBe("¥460.5");
    expect(stat(root, "doneSpent")).toBe("¥99");
  });
});

describe("筛选 / 排序 / 搜索", () => {
  function seed(root) {
    submitForm(root, validData({ location: "卫生间", title: "漏水", priority: "low", cost: "50", status: "doing" }));
    submitForm(root, validData({ location: "客厅", title: "灯具损坏", priority: "medium", cost: "500", status: "done" }));
    submitForm(root, validData({ location: "厨房", title: "墙砖脱落", priority: "high", cost: "300", status: "todo" }));
  }

  it("按状态分段筛选", () => {
    const { root } = setup();
    seed(root);
    expect(cards(root)).toHaveLength(4);

    root.querySelector('[data-value="done"]').click();
    expect(cards(root).map((c) => c.textContent)).toEqual([
      expect.stringContaining("灯具损坏")
    ]);

    root.querySelector('[data-value="doing"]').click();
    expect(cards(root)).toHaveLength(1);
    expect(cards(root)[0].textContent).toContain("漏水");

    root.querySelector('[data-value="all"]').click();
    expect(cards(root)).toHaveLength(4);
  });

  it("按位置筛选", () => {
    const { root } = setup();
    seed(root);
    const select = root.querySelector('[data-control="filter-location"]');
    select.value = "客厅";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cards(root)).toHaveLength(1);
    expect(cards(root)[0].textContent).toContain("灯具损坏");
  });

  it("按优先级筛选", () => {
    const { root } = setup();
    seed(root);
    const select = root.querySelector('[data-control="filter-priority"]');
    select.value = "high";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cards(root).every((c) => c.textContent.includes("高优先级") || c.textContent.includes("墙砖脱落") || c.textContent.includes("渗水"))).toBe(true);
    expect(cards(root)).toHaveLength(2);
  });

  it("按费用从高到低排序", () => {
    const { root } = setup();
    seed(root);
    const select = root.querySelector('[data-control="sort"]');
    select.value = "cost";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const titles = cards(root).map((c) => c.querySelector("p").textContent);
    expect(titles).toEqual(["灯具损坏", "墙砖脱落", "水槽下方渗水", "漏水"]);
  });

  it("按时间从新到旧排序", () => {
    const { root } = setup();
    seed(root);
    const select = root.querySelector('[data-control="sort"]');
    select.value = "time";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cards(root)[0].textContent).toContain("墙砖脱落");
    expect(cards(root)[cards(root).length - 1].textContent).toContain("水槽下方渗水");
  });

  it("搜索实时过滤且刷新后保留搜索词与结果", () => {
    const { root, app, storage } = setup();
    seed(root);
    const input = root.querySelector('[data-control="search"]');
    input.value = "漏水";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(cards(root)).toHaveLength(1);
    expect(cards(root)[0].textContent).toContain("漏水");
    app.flush();

    const root2 = document.createElement("div");
    document.body.appendChild(root2);
    createApp(root2, { storage });
    expect(root2.querySelector('[data-control="search"]').value).toBe("漏水");
    expect(cards(root2)).toHaveLength(1);
  });

  it("被筛选位置的事项删除后筛选自动复位", () => {
    const { root } = setup();
    seed(root);
    const select = root.querySelector('[data-control="filter-location"]');
    select.value = "客厅";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    expect(cards(root)).toHaveLength(1);
    cards(root)[0].querySelector('[data-action="delete"]').click();
    expect(root.querySelector('[data-control="filter-location"]').value).toBe("all");
    expect(cards(root).length).toBeGreaterThan(1);
  });
});

describe("持久化", () => {
  it("刷新后数据仍在", () => {
    const { root, app, storage } = setup();
    submitForm(root, validData({ title: "刷新后还在" }));
    app.flush();

    const root2 = document.createElement("div");
    document.body.appendChild(root2);
    createApp(root2, { storage });
    expect(cardByTitle(root2, "刷新后还在")).toBeTruthy();
    expect(cards(root2)).toHaveLength(2);
  });

  it("存储内容损坏时不崩溃并回退默认数据", () => {
    const storage = memoryStorage({ "zfl-14-repairs": "@@@not-json@@@" });
    const root = document.createElement("div");
    document.body.appendChild(root);
    expect(() => createApp(root, { storage })).not.toThrow();
    expect(cards(root)).toHaveLength(1);
    expect(cardByTitle(root, "水槽下方渗水")).toBeTruthy();
  });

  it("存储中部分记录损坏时只丢弃坏记录", () => {
    const payload = JSON.stringify({
      repairs: [
        { title: "好记录", location: "阳台" },
        { title: "" },
        null,
        42
      ],
      view: {}
    });
    const storage = memoryStorage({ "zfl-14-repairs": payload });
    const root = document.createElement("div");
    document.body.appendChild(root);
    createApp(root, { storage });
    expect(cards(root)).toHaveLength(1);
    expect(cardByTitle(root, "好记录")).toBeTruthy();
  });
});

describe("照片失败兜底", () => {
  it("有效照片地址渲染图片；加载失败时替换为替代内容", () => {
    const { root } = setup();
    submitForm(root, validData({ title: "带照片事项", photo: "https://broken.example.test/x.jpg" }));
    const card = cardByTitle(root, "带照片事项");
    const img = card.querySelector("img[data-photo]");
    expect(img).toBeTruthy();
    expect(img.getAttribute("src")).toBe("https://broken.example.test/x.jpg");
    expect(card.querySelector(".photo-fallback")).toBeNull();

    img.dispatchEvent(new Event("error", { bubbles: true }));
    expect(card.querySelector("img[data-photo]")).toBeNull();
    expect(card.querySelector(".photo-fallback").textContent).toBe("照片无法显示");
  });

  it("未填写照片时直接显示占位", () => {
    const { root } = setup();
    const card = cardByTitle(root, "水槽下方渗水");
    expect(card.querySelector("img[data-photo]")).toBeNull();
    expect(card.querySelector(".photo-fallback").textContent).toBe("未添加照片");
  });
});

describe("注入防护（XSS）", () => {
  it("标题、位置、备注中的 HTML 被转义，不会创建元素", () => {
    const { root, app, storage } = setup();
    submitForm(
      root,
      validData({
        location: '<img src=x onerror="window.__xss=true">',
        title: "<script>alert(1)</script><b>粗体</b>",
        note: '<a href="javascript:alert(1)">x</a>'
      })
    );
    app.flush();

    expect(window.__xss).toBeUndefined();
    const card = cards(root).find((c) => c.textContent.includes("粗体"));
    expect(card.querySelector("p").innerHTML).toContain("&lt;script&gt;");
    expect(card.querySelector("h3").innerHTML).toContain("&lt;img");
    expect(card.querySelectorAll("b, script, a")).toHaveLength(0);

    // 存储中的原始内容在重新加载后仍被转义渲染
    const root2 = document.createElement("div");
    document.body.appendChild(root2);
    createApp(root2, { storage });
    const card2 = cards(root2).find((c) => c.textContent.includes("粗体"));
    expect(card2.querySelector("p").innerHTML).toContain("&lt;script&gt;");
  });
});

describe("全局环境隔离检查", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("默认使用全局 localStorage 也能正常工作", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const app = createApp(root);
    submitForm(root, validData({ title: "全局存储事项" }));
    app.flush();
    expect(localStorage.getItem("zfl-14-repairs")).toContain("全局存储事项");
  });
});
