import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { STORAGE_KEY } from "../src/constants.js";
import { defaultState, parseStoredState, RepairStore } from "../src/storage.js";

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear()
  };
}

describe("parseStoredState / 损坏恢复", () => {
  it("空字符串/空值返回默认状态", () => {
    const state = parseStoredState("");
    expect(Array.isArray(state.repairs)).toBe(true);
    expect(state.repairs.length).toBe(1);
    expect(state.view).toEqual({
      status: "all",
      location: "all",
      priority: "all",
      search: "",
      sort: "priority"
    });
  });

  it("JSON 整体损坏时回退到默认状态，不抛异常", () => {
    expect(() => parseStoredState("{not valid json")).not.toThrow();
    const state = parseStoredState("{not valid json");
    expect(state.repairs.length).toBe(1);
  });

  it("根对象结构错误时回退", () => {
    expect(parseStoredState("[]").repairs.length).toBe(1);
    expect(parseStoredState('"hello"').repairs.length).toBe(1);
    expect(parseStoredState('{"repairs": 5}').repairs.length).toBe(1);
    expect(parseStoredState("null").repairs.length).toBe(1);
  });

  it("字段缺失的记录被补默认值", () => {
    const state = parseStoredState(
      JSON.stringify({
        repairs: [{ title: "只有标题" }],
        view: {}
      })
    );
    expect(state.repairs).toHaveLength(1);
    const repair = state.repairs[0];
    expect(repair.location).toBe("未填写位置");
    expect(repair.priority).toBe("medium");
    expect(repair.status).toBe("todo");
    expect(repair.cost).toBe(0);
    expect(repair.photo).toBe("");
    expect(repair.note).toBe("");
    expect(repair.createdAt).toBeGreaterThan(0);
    expect(repair.id).toMatch(/^[A-Za-z0-9_-]{4,64}$/);
  });

  it("字段类型错误时被纠正", () => {
    const state = parseStoredState(
      JSON.stringify({
        repairs: [
          {
            id: "bad id!!!",
            title: "字段错乱",
            status: "weird",
            priority: 9,
            cost: "abc",
            photo: "javascript:alert(1)",
            createdAt: "nope",
            note: 12345
          }
        ]
      })
    );
    const repair = state.repairs[0];
    expect(repair.status).toBe("todo");
    expect(repair.priority).toBe("medium");
    expect(repair.cost).toBe(0);
    expect(repair.photo).toBe("");
    expect(repair.note).toBe("12345");
    expect(repair.id).not.toContain(" ");
  });

  it("无法恢复的坏记录被丢弃，好记录保留", () => {
    const state = parseStoredState(
      JSON.stringify({
        repairs: [null, 42, "str", { title: "" }, { title: "有效事项" }]
      })
    );
    expect(state.repairs).toHaveLength(1);
    expect(state.repairs[0].title).toBe("有效事项");
  });

  it("重复 id 自动重新分配", () => {
    const state = parseStoredState(
      JSON.stringify({
        repairs: [
          { id: "same-id", title: "事项一" },
          { id: "same-id", title: "事项二" }
        ]
      })
    );
    expect(state.repairs[0].id).not.toBe(state.repairs[1].id);
  });

  it("非法视图参数被重置为默认值", () => {
    const state = parseStoredState(
      JSON.stringify({
        repairs: [],
        view: { status: "bogus", priority: 9, sort: "zzz", search: 123 }
      })
    );
    expect(state.view.status).toBe("all");
    expect(state.view.priority).toBe("all");
    expect(state.view.sort).toBe("priority");
    expect(state.view.search).toBe("");
  });

  it("合法旧数据完整保留", () => {
    const state = parseStoredState(
      JSON.stringify({
        repairs: [
          {
            id: "abc-1234",
            location: "阳台",
            title: "纱窗破了",
            priority: "low",
            cost: 80,
            status: "done",
            photo: "https://example.com/a.png",
            note: "已维修",
            createdAt: 123,
            updatedAt: 456
          }
        ],
        view: { status: "done", location: "阳台", priority: "low", search: "纱窗", sort: "cost" }
      })
    );
    expect(state.repairs[0]).toMatchObject({
      id: "abc-1234",
      location: "阳台",
      title: "纱窗破了",
      priority: "low",
      cost: 80,
      status: "done",
      photo: "https://example.com/a.png"
    });
    expect(state.view.search).toBe("纱窗");
    expect(state.view.sort).toBe("cost");
  });
});

describe("RepairStore / localStorage 持久化", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("save 后再 load 数据完整往返", () => {
    const store = new RepairStore(localStorage);
    const state = defaultState(1000);
    store.save(state);
    const loaded = store.load(2000);
    expect(loaded.repairs).toHaveLength(1);
    expect(loaded.repairs[0].title).toBe("水槽下方渗水");
    expect(loaded.view.status).toBe("all");
    expect(localStorage.getItem(STORAGE_KEY)).toContain("水槽下方渗水");
  });

  it("存储内容损坏时 load 不抛异常并回退默认", () => {
    localStorage.setItem(STORAGE_KEY, "<<<broken>>>");
    const store = new RepairStore(localStorage);
    const loaded = store.load();
    expect(loaded.repairs.length).toBe(1);
  });

  it("storage 抛异常（隐私模式等）时不崩溃", () => {
    const throwing = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      }
    };
    const store = new RepairStore(throwing);
    expect(() => store.load()).not.toThrow();
    expect(store.load().repairs.length).toBe(1);
    expect(store.save({ repairs: [] })).toBe(false);
  });

  it("没有 storage 时也能工作（内存降级）", () => {
    const store = new RepairStore(null);
    expect(store.load().repairs.length).toBe(1);
    expect(store.save({ repairs: [] })).toBe(false);
  });

  it("使用自定义 key 不影响其他数据", () => {
    const storage = memoryStorage();
    const store = new RepairStore(storage, "custom-key");
    store.save(defaultState());
    expect(storage.getItem("custom-key")).toContain("水槽下方渗水");
  });
});
