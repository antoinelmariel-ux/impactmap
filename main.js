const COLUMN_LABELS = [
  "Objectif",
  "Tiers",
  "Moyen",
  "Contrôle",
  "Contournement",
  "Probabilité",
];

const APP_VERSION = "1.2.1";
const STORAGE_KEY = "impactmap-nodes";
const VIEW_KEY = "impactmap-view";

const viewport = document.getElementById("viewport");
const columnsContainer = document.getElementById("columns");
const connections = document.getElementById("connections");
const addRoot = document.getElementById("add-root");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const fitBtn = document.getElementById("fit");
const resetBtn = document.getElementById("reset");
const versionEl = document.getElementById("version");
const panzoomLayer = document.getElementById("panzoom");

versionEl.textContent = APP_VERSION;

let nodes = [];
let activeId = null;
let viewState = { scale: 1, offsetX: 0, offsetY: 0 };
let rafToken = null;
let shouldFocusActive = false;

function uid() {
  return crypto.randomUUID();
}

function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) nodes = parsed;
    }
    const savedView = localStorage.getItem(VIEW_KEY);
    if (savedView) viewState = { ...viewState, ...JSON.parse(savedView) };
  } catch (err) {
    console.warn("Storage read failed", err);
  }

  if (nodes.length === 0) {
    const root = { id: uid(), title: "", column: 0, parentId: null };
    nodes.push(root);
    activeId = root.id;
    shouldFocusActive = true;
  } else if (nodes.length > 0) {
    activeId = nodes[0].id;
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
    localStorage.setItem(VIEW_KEY, JSON.stringify(viewState));
  } catch (err) {
    console.warn("Storage write failed", err);
  }
}

function render() {
  columnsContainer.innerHTML = "";
  const perColumn = COLUMN_LABELS.map((label) => ({ label, items: [] }));
  for (const node of nodes) {
    if (perColumn[node.column]) perColumn[node.column].items.push(node);
  }

  perColumn.forEach((col, index) => {
    const colEl = document.createElement("div");
    colEl.className = "column";

    const title = document.createElement("div");
    title.className = "column-title";
    title.textContent = `${index + 1}. ${col.label}`;
    colEl.appendChild(title);

    col.items.forEach((node) => colEl.appendChild(renderNode(node)));

    columnsContainer.appendChild(colEl);
  });

  applyTransform();
  scheduleConnections();
  focusActiveInput();
}

function renderNode(node) {
  const card = document.createElement("div");
  card.className = "node";
  card.dataset.id = node.id;
  if (node.id === activeId) card.classList.add("active");

  const label = document.createElement("span");
  label.className = "node-label";
  label.textContent = COLUMN_LABELS[node.column];

  const input = document.createElement("input");
  input.className = "node-title";
  input.value = node.title;
  input.addEventListener("input", () => {
    node.title = input.value;
    save();
  });
  input.addEventListener("focus", () => setActive(node.id));
  input.addEventListener("keydown", (event) => handleInputKeydown(event, node));

  const actions = document.createElement("div");
  actions.className = "node-actions";

  const childBtn = document.createElement("button");
  childBtn.textContent = "+";
  childBtn.title = "Ajouter un enfant";
  childBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    addChild(node);
  });

  const removeBtn = document.createElement("button");
  removeBtn.textContent = "×";
  removeBtn.title = "Supprimer";
  removeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    removeNode(node.id);
  });

  actions.append(childBtn, removeBtn);

  card.append(label, input, actions);
  card.addEventListener("click", () => setActive(node.id));
  return card;
}

function handleInputKeydown(event, node) {
  if (event.key === "Tab" && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    addChild(node);
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    addSibling(node);
  }
}

function setActive(id) {
  shouldFocusActive = true;
  activeId = id;
  render();
  centerOnActive();
  save();
}

function addRootNode() {
  const root = { id: uid(), title: "", column: 0, parentId: null };
  nodes.push(root);
  shouldFocusActive = true;
  setActive(root.id);
}

function addSibling(node) {
  const sibling = { id: uid(), title: "", column: node.column, parentId: node.parentId };
  nodes.push(sibling);
  shouldFocusActive = true;
  setActive(sibling.id);
}

function addChild(node) {
  const nextColumn = Math.min(node.column + 1, COLUMN_LABELS.length - 1);
  const child = { id: uid(), title: "", column: nextColumn, parentId: node.id };
  nodes.push(child);
  shouldFocusActive = true;
  setActive(child.id);
}

function removeNode(id) {
  const toRemove = new Set();
  function collect(target) {
    toRemove.add(target);
    nodes
      .filter((n) => n.parentId === target)
      .forEach((child) => collect(child.id));
  }
  collect(id);
  nodes = nodes.filter((n) => !toRemove.has(n.id));
  if (nodes.length === 0) addRootNode();
  else setActive(nodes[0].id);
}

function handleKeydown(event) {
  if (!activeId) return;
  const activeNode = nodes.find((n) => n.id === activeId);
  if (!activeNode) return;

  if (event.key === "Enter") {
    event.preventDefault();
    addSibling(activeNode);
  }
  if (event.key === "Tab") {
    event.preventDefault();
    addChild(activeNode);
  }
  if (event.key === "Delete" || event.key === "Backspace") {
    const target = event.target;
    if (target && target.classList && target.classList.contains("node-title") && target.value !== "") {
      return;
    }
    event.preventDefault();
    removeNode(activeNode.id);
  }
}

function focusActiveInput() {
  if (!shouldFocusActive || !activeId) return;
  requestAnimationFrame(() => {
    const input = document.querySelector(`.node.active .node-title`);
    if (input) {
      input.focus();
      input.select();
      shouldFocusActive = false;
    }
  });
}

function scheduleConnections() {
  if (rafToken) cancelAnimationFrame(rafToken);
  rafToken = requestAnimationFrame(updateConnections);
}

function updateConnections() {
  const nodeEls = Array.from(document.querySelectorAll(".node"));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const layout = new Map();
  nodeEls.forEach((el) => {
    const rect = el.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    layout.set(el.dataset.id, new DOMRect(
      rect.x - viewportRect.x,
      rect.y - viewportRect.y,
      rect.width,
      rect.height
    ));
  });

  const paths = [];
  nodes.forEach((child) => {
    if (!child.parentId) return;
    const parent = byId.get(child.parentId);
    if (!parent) return;
    const parentRect = layout.get(child.parentId);
    const childRect = layout.get(child.id);
    if (!parentRect || !childRect) return;

    const startX = parentRect.x + parentRect.width;
    const startY = parentRect.y + parentRect.height / 2;
    const endX = childRect.x;
    const endY = childRect.y + childRect.height / 2;
    const controlX = (startX + endX) / 2;
    const curveOffset = (endY - startY) * 0.15;
    paths.push(
      `M ${startX} ${startY} C ${controlX} ${startY + curveOffset}, ${controlX} ${endY - curveOffset}, ${endX} ${endY}`
    );
  });

  connections.setAttribute("viewBox", `0 0 ${viewport.clientWidth} ${viewport.clientHeight}`);
  connections.innerHTML = paths
    .map(
      (d) =>
        `<path d="${d}" fill="none" stroke="rgba(47,111,237,0.5)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />`
    )
    .join("");
}

function applyTransform() {
  panzoomLayer.style.transform = `translate(${viewState.offsetX}px, ${viewState.offsetY}px) scale(${viewState.scale})`;
}

function zoom(delta) {
  viewState.scale = Math.min(2.5, Math.max(0.5, viewState.scale + delta));
  applyTransform();
  scheduleConnections();
  save();
}

function resetView() {
  viewState = { scale: 1, offsetX: 0, offsetY: 0 };
  applyTransform();
  scheduleConnections();
  save();
}

function fitView() {
  const nodesEls = Array.from(document.querySelectorAll(".node"));
  if (nodesEls.length === 0) return;
  const rects = nodesEls.map((el) => el.getBoundingClientRect());
  const minX = Math.min(...rects.map((r) => r.x));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  const viewportRect = viewport.getBoundingClientRect();
  const padding = 80;
  const scaleX = (viewportRect.width - padding) / (maxX - minX);
  const scaleY = (viewportRect.height - padding) / (maxY - minY);
  const scale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.4), 2.5);
  viewState.scale = scale;
  viewState.offsetX = (viewportRect.width - (minX + maxX)) / 2;
  viewState.offsetY = (viewportRect.height - (minY + maxY)) / 2;
  applyTransform();
  scheduleConnections();
  save();
}

function centerOnActive() {
  if (!activeId) return;
  const activeEl = document.querySelector(`.node[data-id="${activeId}"]`);
  if (!activeEl) return;
  const rect = activeEl.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  viewState.offsetX += viewportRect.width / 2 - (rect.x + rect.width / 2);
  viewState.offsetY += viewportRect.height / 2 - (rect.y + rect.height / 2);
  applyTransform();
  scheduleConnections();
  save();
}

function dragPan() {
  let isPanning = false;
  let startX = 0;
  let startY = 0;
  viewport.addEventListener("pointerdown", (e) => {
    isPanning = true;
    startX = e.clientX - viewState.offsetX;
    startY = e.clientY - viewState.offsetY;
    viewport.setPointerCapture(e.pointerId);
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!isPanning) return;
    viewState.offsetX = e.clientX - startX;
    viewState.offsetY = e.clientY - startY;
    applyTransform();
    scheduleConnections();
  });
  viewport.addEventListener("pointerup", (e) => {
    if (!isPanning) return;
    isPanning = false;
    viewport.releasePointerCapture(e.pointerId);
    save();
  });
}

function init() {
  load();
  render();
  applyTransform();
  dragPan();
  focusActiveInput();

  document.addEventListener("keydown", handleKeydown);
  addRoot.addEventListener("click", addRootNode);
  zoomInBtn.addEventListener("click", () => zoom(0.1));
  zoomOutBtn.addEventListener("click", () => zoom(-0.1));
  resetBtn.addEventListener("click", resetView);
  fitBtn.addEventListener("click", fitView);
  window.addEventListener("resize", scheduleConnections);
}

init();
