import {
  FLOW_STATUSES,
  LIMITS,
  PHOTO_FALLBACK,
  PRIORITIES,
  SORTS,
  STATUSES
} from "./constants.js";
import {
  createRepair,
  fingerprint,
  formatMoney,
  getLocations,
  getStats,
  queryRepairs,
  sortRepairs,
  transitionStatus,
  updateRepair
} from "./model.js";
import { RepairStore, normalizeView } from "./storage.js";

const FLOW_LABEL = { todo: "开始处理", doing: "标记完成", done: "重新打开" };
const FLOW_NEXT = { todo: "doing", doing: "done", done: "todo" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"'`]/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
      "`": "&#096;"
    };
    return map[char];
  });
}

export function createApp(root, options = {}) {
  const store = options.store || new RepairStore(options.storage || globalThis.localStorage);
  const now = options.now || (() => Date.now());
  const state = store.load(now());

  let editingId = null;
  let submitting = false;
  let lastAdded = { fingerprint: "", at: 0 };
  let saveTimer = null;

  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => store.save(state), 250);
  }

  // 数据变更立即落盘，避免关闭标签页丢失最后一次修改
  function persistNow() {
    clearTimeout(saveTimer);
    store.save(state);
  }

  function visibleRepairs() {
    return sortRepairs(queryRepairs(state.repairs, state.view), state.view.sort);
  }

  function render() {
    const stats = getStats(state.repairs);
    const locations = getLocations(state.repairs);
    // 当前位置筛选已无对应事项时（例如该位置事项被删除）自动复位
    if (state.view.location !== "all" && !locations.includes(state.view.location)) {
      state.view.location = "all";
    }
    const repairs = visibleRepairs();
    const editingRepair = editingId ? state.repairs.find((r) => r.id === editingId) : null;

    root.innerHTML = `
      <main class="shell">
        <header class="header">
          <div>
            <p class="eyebrow">本地家庭维护台</p>
            <h1>家庭维修事项</h1>
          </div>
          <section class="stats" aria-label="统计">
            <div class="stat"><span>未完成</span><strong data-stat="unfinishedCount">${stats.unfinishedCount}</strong></div>
            <div class="stat"><span>处理中</span><strong data-stat="doingCount">${stats.doingCount}</strong></div>
            <div class="stat"><span>未完成预计费用</span><strong data-stat="unfinishedCost">${formatMoney(stats.unfinishedCost)}</strong></div>
            <div class="stat"><span>已完成支出</span><strong data-stat="doneSpent">${formatMoney(stats.doneSpent)}</strong></div>
          </section>
        </header>

        <section class="layout">
          <aside class="panel">
            <h2>${editingRepair ? "编辑维修事项" : "新增维修事项"}</h2>
            ${renderForm(editingRepair)}
          </aside>

          <section>
            <div class="toolbar">
              <div class="segmented" role="group" aria-label="按状态筛选">
                ${Object.entries(STATUSES)
                  .map(
                    ([value, label]) => `
                  <button type="button" class="seg ${state.view.status === value ? "active" : ""}" data-action="filter-status" data-value="${value}">${label}</button>`
                  )
                  .join("")}
              </div>
              <input type="search" class="search" data-control="search" placeholder="搜索位置、问题或备注" value="${escapeHtml(state.view.search)}" aria-label="搜索">
              <select data-control="filter-location" aria-label="按位置筛选">
                <option value="all">全部位置</option>
                ${locations
                  .map(
                    (location) => `
                  <option value="${escapeHtml(location)}" ${state.view.location === location ? "selected" : ""}>${escapeHtml(location)}</option>`
                  )
                  .join("")}
              </select>
              <select data-control="filter-priority" aria-label="按优先级筛选">
                <option value="all">全部优先级</option>
                ${Object.entries(PRIORITIES)
                  .map(
                    ([value, label]) => `
                  <option value="${value}" ${state.view.priority === value ? "selected" : ""}>${label}</option>`
                  )
                  .join("")}
              </select>
              <select data-control="sort" aria-label="排序方式">
                ${Object.entries(SORTS)
                  .map(
                    ([value, label]) => `
                  <option value="${value}" ${state.view.sort === value ? "selected" : ""}>${label}</option>`
                  )
                  .join("")}
              </select>
            </div>
            <div class="repairs" data-role="list">
              ${repairs.length ? repairs.map((r) => renderRepair(r)).join("") : `<div class="empty">没有符合条件的维修事项</div>`}
            </div>
          </section>
        </section>
      </main>
    `;
  }

  function renderForm(editing) {
    const v = editing || {
      location: "",
      title: "",
      priority: "medium",
      cost: "",
      status: "todo",
      photo: "",
      note: ""
    };
    return `
      <form class="form" id="repair-form" novalidate>
        ${editing ? `<input type="hidden" name="id" value="${escapeHtml(editing.id)}">` : ""}
        <label>位置
          <input name="location" required maxlength="${LIMITS.locationMax}" placeholder="例如卫生间" value="${escapeHtml(v.location)}">
          <small class="error" data-error="location"></small>
        </label>
        <label>问题描述
          <textarea name="title" required maxlength="${LIMITS.titleMax}" placeholder="例如门锁松动">${escapeHtml(v.title)}</textarea>
          <small class="error" data-error="title"></small>
        </label>
        <label>优先级
          <select name="priority">
            ${Object.entries(PRIORITIES)
              .map(
                ([value, label]) =>
                  `<option value="${value}" ${v.priority === value ? "selected" : ""}>${label}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>预计费用（元）
          <input name="cost" type="number" min="0" step="0.01" max="${LIMITS.costMax}" inputmode="decimal" placeholder="0" value="${v.cost === "" ? "" : escapeHtml(v.cost)}">
          <small class="error" data-error="cost"></small>
        </label>
        <label>处理状态
          <select name="status">
            ${FLOW_STATUSES.map(
              (value) =>
                `<option value="${value}" ${v.status === value ? "selected" : ""}>${STATUSES[value]}</option>`
            ).join("")}
          </select>
        </label>
        <label>照片链接
          <input name="photo" type="url" placeholder="可选，粘贴 http/https 图片地址" value="${escapeHtml(v.photo)}">
          <small class="error" data-error="photo"></small>
        </label>
        <label>备注
          <textarea name="note" maxlength="${LIMITS.noteMax}" placeholder="师傅电话、材料或注意事项">${escapeHtml(v.note)}</textarea>
        </label>
        <p class="form-message" data-role="form-message" role="alert"></p>
        <div class="form-actions">
          <button class="primary" type="submit" ${submitting ? "disabled" : ""}>${editing ? "保存修改" : "保存事项"}</button>
          ${editing ? `<button type="button" class="ghost" data-action="cancel-edit">取消编辑</button>` : ""}
        </div>
      </form>
    `;
  }

  function renderRepair(repair) {
    return `
      <article class="repair" data-id="${escapeHtml(repair.id)}">
        <div class="photo">
          ${
            repair.photo
              ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片" data-photo>`
              : `<span class="photo-fallback">未添加照片</span>`
          }
        </div>
        <div class="content">
          <div class="row">
            <h3>${escapeHtml(repair.location)}</h3>
            <span class="priority ${repair.priority}">${PRIORITIES[repair.priority]}</span>
            <span class="status ${repair.status}">${STATUSES[repair.status]}</span>
          </div>
          <p>${escapeHtml(repair.title)}</p>
          <div class="row">
            <span class="chip">${repair.status === "done" ? "实际" : "预计"} ${formatMoney(repair.cost)}</span>
            ${repair.note ? `<span class="chip">${escapeHtml(repair.note)}</span>` : ""}
          </div>
          <div class="actions">
            <button type="button" class="ghost" data-action="flow">${FLOW_LABEL[repair.status]}</button>
            <button type="button" class="ghost" data-action="edit">编辑</button>
            <button type="button" class="danger" data-action="delete">删除</button>
          </div>
        </div>
      </article>
    `;
  }

  function showErrors(form, errors) {
    form.querySelectorAll("[data-error]").forEach((node) => {
      const field = node.dataset.error;
      node.textContent = errors[field] || "";
    });
  }

  function setFormMessage(message) {
    const node = root.querySelector('[data-role="form-message"]');
    if (node) node.textContent = message || "";
  }

  function handleSubmit(form) {
    // 防止双击/回车重复提交产生重复记录
    if (submitting) return;
    const input = Object.fromEntries(new FormData(form).entries());
    const id = input.id;
    delete input.id;

    if (id) {
      const target = state.repairs.find((r) => r.id === id);
      if (!target) {
        editingId = null;
        render();
        return;
      }
      const { repair, errors } = updateRepair(target, input, now());
      if (Object.keys(errors).length) {
        showErrors(form, errors);
        return;
      }
      submitting = true;
      state.repairs = state.repairs.map((r) => (r.id === id ? repair : r));
      editingId = null;
      persistNow();
      render();
      submitting = false;
      return;
    }

    const { repair, errors } = createRepair(input, now());
    if (Object.keys(errors).length) {
      showErrors(form, errors);
      return;
    }

    const stamp = fingerprint(repair);
    const current = now();
    if (stamp === lastAdded.fingerprint && current - lastAdded.at < 3000) {
      setFormMessage("内容相同的事项刚刚已保存，请勿重复提交");
      return;
    }
    lastAdded = { fingerprint: stamp, at: current };
    submitting = true;
    state.repairs.unshift(repair);
    persistNow();
    render();
    submitting = false;
  }

  function onSubmit(event) {
    // 注意：编辑表单含 name="id" 的隐藏控件，会遮蔽 form 元素内建的 id 属性
    // （event.target.id 在编辑态返回该 input 节点），因此必须用 getAttribute 判断。
    if (event.target.getAttribute?.("id") !== "repair-form") return;
    event.preventDefault();
    handleSubmit(event.target);
  }

  function onListClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button || !root.contains(button)) return;
    const card = button.closest(".repair");
    if (!card) return;
    const id = card.dataset.id;
    const index = state.repairs.findIndex((r) => r.id === id);
    if (index === -1) return;
    const action = button.dataset.action;

    if (action === "delete") {
      state.repairs.splice(index, 1);
      if (editingId === id) editingId = null;
      persistNow();
      render();
    } else if (action === "edit") {
      editingId = id;
      render();
      root.querySelector("#repair-form [name='location']")?.focus();
    } else if (action === "flow") {
      state.repairs[index] = transitionStatus(
        state.repairs[index],
        FLOW_NEXT[state.repairs[index].status],
        now()
      );
      persistNow();
      render();
    }
  }

  function onToolbarClick(event) {
    const button = event.target.closest('[data-action="filter-status"]');
    if (!button) return;
    state.view.status = button.dataset.value;
    persist();
    render();
  }

  function onControlChange(event) {
    const control = event.target.closest("[data-control]");
    if (!control) return;
    const kind = control.dataset.control;
    if (kind === "filter-location") {
      state.view.location = normalizeView({ location: control.value }).location;
    } else if (kind === "filter-priority") {
      state.view.priority = ["all", "high", "medium", "low"].includes(control.value)
        ? control.value
        : "all";
    } else if (kind === "sort") {
      state.view.sort = ["priority", "cost", "time"].includes(control.value)
        ? control.value
        : "priority";
    } else {
      return;
    }
    persist();
    render();
  }

  function onSearchInput(event) {
    if (event.target.dataset.control !== "search") return;
    state.view.search = event.target.value;
    persist();
    // 只刷新列表，保留输入焦点
    const list = root.querySelector("[data-role='list']");
    const repairs = visibleRepairs();
    list.innerHTML = repairs.length
      ? repairs.map((r) => renderRepair(r)).join("")
      : `<div class="empty">没有符合条件的维修事项</div>`;
  }

  function onCancelClick(event) {
    if (!event.target.closest('[data-action="cancel-edit"]')) return;
    editingId = null;
    render();
  }

  // 图片地址无效（404、断网、非图片内容）时用替代内容替换
  function onImageError(event) {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.matches("[data-photo]")) return;
    const box = img.parentElement;
    img.remove();
    const fallback = document.createElement("span");
    fallback.className = "photo-fallback";
    fallback.textContent = PHOTO_FALLBACK;
    box.appendChild(fallback);
  }

  root.addEventListener("submit", onSubmit);
  root.addEventListener("click", onListClick);
  root.addEventListener("click", onToolbarClick);
  root.addEventListener("click", onCancelClick);
  root.addEventListener("change", onControlChange);
  root.addEventListener("input", onSearchInput);
  root.addEventListener("error", onImageError, true);

  render();

  return {
    state,
    render,
    flush() {
      clearTimeout(saveTimer);
      store.save(state);
    }
  };
}
