/* ==========================================================
   원형 관계도 메이커 - app.js
   ========================================================== */

const DEFAULT_LINE_LEGEND = [
  { color: "#ff3b3b", text: "최애 CP" },
  { color: "#ff9500", text: "선호 CP" },
  { color: "#ffd60a", text: "선호 NCP" },
  { color: "#34c759", text: "스루 가능" },
  { color: "#111111", text: "지뢰" },
];

const state = {
  count: 12,
  title: "관계도 제목",
  watermark: "",
  circles: [],      // {image: dataURL|null, border:{enabled:bool,color:string}, label:string}
  lines: [],        // {id, from:index, to:index, color, arrow:bool, doubleArrow:bool}
  legend: {
    line: JSON.parse(JSON.stringify(DEFAULT_LINE_LEGEND)),
    border: [],
  },
};

let lineIdSeq = 1;
let connectMode = false;
let connectSource = null;     // index of source circle while connecting
let currentCircleIndex = null;
let pendingLine = null;       // {from, to} awaiting confirmation in line modal

/* ---------------- init circles array ---------------- */
function ensureCircleCount(n) {
  const arr = state.circles;
  while (arr.length < n) {
    arr.push({ image: null, border: { enabled: false, color: "#ff3b3b" }, label: "" });
  }
  if (arr.length > n) arr.length = n;
  // prune lines referencing removed circles
  state.lines = state.lines.filter(l => l.from < n && l.to < n);
}

/* ---------------- DOM refs ---------------- */
const el = (id) => document.getElementById(id);
const countSlider = el("countSlider");
const countInput = el("countInput");
const lineLegendList = el("lineLegendList");
const borderLegendList = el("borderLegendList");
const legendHeaderLine = el("legendHeaderLine");
const legendHeaderBorder = el("legendHeaderBorder");
const circleLayer = el("circleLayer");
const lineSvg = el("lineSvg");
const circleStage = el("circleStage");
const titleBadge = el("titleBadge");
const watermarkInput = el("watermarkInput");
const connectModeBtn = el("connectModeBtn");
const connectHint = el("connectHint");
const lineListEl = el("lineList");
const toast = el("toast");

/* ---------------- toast ---------------- */
let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 1800);
}

/* ---------------- legend rendering ---------------- */
function renderLegendEditor(container, arr, onChange) {
  container.innerHTML = "";
  arr.forEach((item, i) => {
    const row = document.createElement("div");
    row.className = "legend-item";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = item.color;
    colorInput.oninput = () => { item.color = colorInput.value; onChange(); };

    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.value = item.text;
    textInput.placeholder = "의미 (예: 최애 CP)";
    textInput.oninput = () => { item.text = textInput.value; onChange(); };

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.onclick = () => { arr.splice(i, 1); renderLegendEditor(container, arr, onChange); onChange(); };

    row.append(colorInput, textInput, del);
    container.appendChild(row);
  });
}

function renderLegendHeader(container, arr) {
  container.innerHTML = "";
  arr.forEach((item) => {
    if (!item.text.trim()) return;
    const entry = document.createElement("div");
    entry.className = "entry";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = item.color;
    const label = document.createElement("span");
    label.textContent = item.text;
    entry.append(dot, label);
    container.appendChild(entry);
  });
}

function refreshLegends() {
  renderLegendEditor(lineLegendList, state.legend.line, onLegendChanged);
  renderLegendEditor(borderLegendList, state.legend.border, onLegendChanged);
  renderLegendHeader(legendHeaderLine, state.legend.line);
  renderLegendHeader(legendHeaderBorder, state.legend.border);
  refreshLegendSelects();
}

function onLegendChanged() {
  renderLegendHeader(legendHeaderLine, state.legend.line);
  renderLegendHeader(legendHeaderBorder, state.legend.border);
  refreshLegendSelects();
}

function refreshLegendSelects() {
  const lineSel = el("lineLegendSelect");
  const borderSel = el("borderLegendSelect");
  lineSel.innerHTML = '<option value="">직접 색상 선택</option>';
  state.legend.line.forEach(item => {
    if (!item.text.trim()) return;
    const opt = document.createElement("option");
    opt.value = item.color;
    opt.textContent = item.text;
    lineSel.appendChild(opt);
  });
  borderSel.innerHTML = '<option value="">직접 색상 선택</option>';
  state.legend.border.forEach(item => {
    if (!item.text.trim()) return;
    const opt = document.createElement("option");
    opt.value = item.color;
    opt.textContent = item.text;
    borderSel.appendChild(opt);
  });
}

el("addLineLegend").onclick = () => {
  state.legend.line.push({ color: "#4f6bff", text: "" });
  renderLegendEditor(lineLegendList, state.legend.line, onLegendChanged);
  onLegendChanged();
};
el("addBorderLegend").onclick = () => {
  state.legend.border.push({ color: "#4f6bff", text: "" });
  renderLegendEditor(borderLegendList, state.legend.border, onLegendChanged);
  onLegendChanged();
};

/* ---------------- circle count controls ---------------- */
function applyCount(n) {
  n = Math.max(2, Math.min(30, Math.round(n)));
  state.count = n;
  countSlider.value = n;
  countInput.value = n;
  ensureCircleCount(n);
  renderAll();
}
countSlider.oninput = () => applyCount(countSlider.value);
countInput.oninput = () => applyCount(countInput.value || 2);

/* ---------------- geometry ---------------- */
function circleSizeFor(n) {
  if (n <= 6) return 88;
  if (n <= 10) return 76;
  if (n <= 16) return 64;
  if (n <= 22) return 54;
  return 44;
}

function positions(n) {
  const radiusPct = 42; // % of stage width/height
  const cx = 50, cy = 50;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    pts.push({
      x: cx + radiusPct * Math.cos(angle),
      y: cy + radiusPct * Math.sin(angle),
    });
  }
  return pts;
}

/* ---------------- rendering ---------------- */
function labelFor(i) {
  const c = state.circles[i];
  return (c && c.label && c.label.trim()) ? c.label.trim() : `원 ${i + 1}`;
}

function renderCircles() {
  circleLayer.innerHTML = "";
  const n = state.count;
  const size = circleSizeFor(n);
  const pts = positions(n);

  pts.forEach((p, i) => {
    const c = state.circles[i];
    const node = document.createElement("div");
    node.className = "circle-node";
    node.style.left = p.x + "%";
    node.style.top = p.y + "%";
    node.dataset.index = i;
    if (connectSource === i) node.classList.add("connect-source");

    const disc = document.createElement("div");
    disc.className = "disc" + (c.image ? "" : " empty");
    disc.style.setProperty("--circle-size", size + "px");
    if (c.image) disc.style.backgroundImage = `url(${c.image})`;
    if (c.border && c.border.enabled) {
      disc.style.border = `3px solid ${c.border.color}`;
    } else {
      disc.style.border = "0px solid transparent";
    }
    node.appendChild(disc);

    if (c.label && c.label.trim()) {
      const lbl = document.createElement("div");
      lbl.className = "node-label";
      lbl.textContent = c.label.trim();
      node.appendChild(lbl);
    }

    node.onclick = () => onCircleClick(i);
    circleLayer.appendChild(node);
  });
}

function colorToId(color) {
  return "c" + color.replace("#", "");
}

function renderLines() {
  const n = state.count;
  const pts = positions(n);
  const stageRect = circleStage.getBoundingClientRect();
  const w = stageRect.width || 1;
  const h = stageRect.height || 1;

  // build defs with arrow markers for used colors
  const usedColors = new Set(state.lines.map(l => l.color));
  let defs = "<defs>";
  usedColors.forEach(color => {
    const id = colorToId(color);
    defs += `<marker id="arrow-${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 Z" fill="${color}"></path>
    </marker>`;
  });
  defs += "</defs>";

  let svgContent = defs;
  state.lines.forEach(l => {
    if (l.from >= n || l.to >= n) return;
    const a = pts[l.from], b = pts[l.to];
    const x1 = (a.x / 100) * w, y1 = (a.y / 100) * h;
    const x2 = (b.x / 100) * w, y2 = (b.y / 100) * h;
    const id = colorToId(l.color);
    const markerEnd = l.arrow ? `marker-end="url(#arrow-${id})"` : "";
    const markerStart = l.doubleArrow ? `marker-start="url(#arrow-${id})"` : "";
    svgContent += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${l.color}" stroke-width="3" ${markerEnd} ${markerStart} stroke-linecap="round"></line>`;
  });

  lineSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  lineSvg.innerHTML = svgContent;
}

function renderLineList() {
  lineListEl.innerHTML = "";
  state.lines.forEach((l) => {
    const row = document.createElement("div");
    row.className = "item-row";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = l.color;
    const lbl = document.createElement("span");
    lbl.className = "lbl";
    lbl.textContent = `${labelFor(l.from)} ${l.doubleArrow ? "↔" : (l.arrow ? "→" : "—")} ${labelFor(l.to)}`;
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "✕";
    del.onclick = () => {
      state.lines = state.lines.filter(x => x.id !== l.id);
      renderAll();
    };
    row.append(swatch, lbl, del);
    lineListEl.appendChild(row);
  });
}

function renderAll() {
  renderCircles();
  renderLines();
  renderLineList();
}

window.addEventListener("resize", () => renderLines());

/* ---------------- circle click / connect mode ---------------- */
function onCircleClick(i) {
  if (connectMode) {
    if (connectSource === null) {
      connectSource = i;
      renderCircles();
      connectHint.textContent = `"${labelFor(i)}" 선택됨. 연결할 다른 원을 클릭하세요.`;
    } else if (connectSource === i) {
      connectSource = null;
      renderCircles();
      connectHint.textContent = "원을 두 개 순서대로 클릭하면 선이 만들어져요.";
    } else {
      pendingLine = { from: connectSource, to: i };
      openLineModal();
      connectSource = null;
    }
  } else {
    openCircleModal(i);
  }
}

connectModeBtn.onclick = () => {
  connectMode = !connectMode;
  connectSource = null;
  connectModeBtn.classList.toggle("active", connectMode);
  connectModeBtn.textContent = connectMode ? "🔗 선 연결 모드 끄기" : "🔗 선 연결 모드 켜기";
  connectHint.textContent = connectMode
    ? "원을 두 개 순서대로 클릭하면 선이 만들어져요."
    : "선 연결 모드가 꺼져 있어요.";
  renderCircles();
};

/* ---------------- circle edit modal ---------------- */
const circleModal = el("circleModal");
const circleImgInput = el("circleImgInput");
const borderEnabled = el("borderEnabled");
const borderColorPicker = el("borderColorPicker");
const borderLegendSelect = el("borderLegendSelect");
const circleLabelInput = el("circleLabelInput");

function openCircleModal(i) {
  currentCircleIndex = i;
  const c = state.circles[i];
  borderEnabled.checked = !!c.border.enabled;
  borderColorPicker.value = c.border.color || "#ff3b3b";
  borderLegendSelect.value = "";
  circleLabelInput.value = c.label || "";
  circleModal.classList.remove("hidden");
}

el("uploadImgBtn").onclick = () => circleImgInput.click();

circleImgInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    downscaleImage(ev.target.result, 400, (dataUrl) => {
      state.circles[currentCircleIndex].image = dataUrl;
      renderCircles();
    });
  };
  reader.readAsDataURL(file);
  circleImgInput.value = "";
};

function downscaleImage(dataUrl, maxSize, cb) {
  const img = new Image();
  img.onload = () => {
    let { width, height } = img;
    if (width > maxSize || height > maxSize) {
      const scale = maxSize / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, width, height);
    cb(canvas.toDataURL("image/png"));
  };
  img.src = dataUrl;
}

el("removeImgBtn").onclick = () => {
  if (currentCircleIndex === null) return;
  state.circles[currentCircleIndex].image = null;
  renderCircles();
};

borderEnabled.onchange = () => {
  state.circles[currentCircleIndex].border.enabled = borderEnabled.checked;
  renderCircles();
};
borderColorPicker.oninput = () => {
  state.circles[currentCircleIndex].border.color = borderColorPicker.value;
  borderEnabled.checked = true;
  state.circles[currentCircleIndex].border.enabled = true;
  renderCircles();
};
borderLegendSelect.onchange = () => {
  if (!borderLegendSelect.value) return;
  borderColorPicker.value = borderLegendSelect.value;
  state.circles[currentCircleIndex].border.color = borderLegendSelect.value;
  state.circles[currentCircleIndex].border.enabled = true;
  borderEnabled.checked = true;
  renderCircles();
};
circleLabelInput.oninput = () => {
  state.circles[currentCircleIndex].label = circleLabelInput.value;
  renderCircles();
};

el("startConnectFromModal").onclick = () => {
  connectMode = true;
  connectSource = currentCircleIndex;
  connectModeBtn.classList.add("active");
  connectModeBtn.textContent = "🔗 선 연결 모드 끄기";
  connectHint.textContent = `"${labelFor(currentCircleIndex)}" 선택됨. 연결할 다른 원을 클릭하세요.`;
  circleModal.classList.add("hidden");
  renderCircles();
};

el("closeModalBtn").onclick = () => {
  circleModal.classList.add("hidden");
  currentCircleIndex = null;
};

/* ---------------- line modal ---------------- */
const lineModal = el("lineModal");
const lineColorPicker = el("lineColorPicker");
const lineLegendSelect = el("lineLegendSelect");
const arrowEnabled = el("arrowEnabled");
const doubleArrowEnabled = el("doubleArrowEnabled");

function openLineModal() {
  lineColorPicker.value = state.legend.line[0] ? state.legend.line[0].color : "#ff3b3b";
  lineLegendSelect.value = "";
  arrowEnabled.checked = true;
  doubleArrowEnabled.checked = false;
  lineModal.classList.remove("hidden");
}

lineLegendSelect.onchange = () => {
  if (lineLegendSelect.value) lineColorPicker.value = lineLegendSelect.value;
};

el("confirmLineBtn").onclick = () => {
  if (!pendingLine) return;
  state.lines.push({
    id: lineIdSeq++,
    from: pendingLine.from,
    to: pendingLine.to,
    color: lineColorPicker.value,
    arrow: arrowEnabled.checked,
    doubleArrow: doubleArrowEnabled.checked,
  });
  pendingLine = null;
  lineModal.classList.add("hidden");
  renderAll();
};

el("cancelLineBtn").onclick = () => {
  pendingLine = null;
  lineModal.classList.add("hidden");
};

/* ---------------- title / watermark binding ---------------- */
titleBadge.textContent = state.title;
titleBadge.oninput = () => { state.title = titleBadge.textContent; };
watermarkInput.oninput = () => { state.watermark = watermarkInput.value; };

/* ---------------- JSON save / load ---------------- */
el("saveJsonBtn").onclick = () => {
  const data = {
    version: 1,
    count: state.count,
    title: state.title,
    watermark: watermarkInput.value,
    circles: state.circles,
    lines: state.lines,
    legend: state.legend,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "circle-diagram.json";
  a.click();
  URL.revokeObjectURL(url);
  showToast("JSON 파일로 저장했어요.");
};

el("loadJsonBtn").onclick = () => el("loadJsonInput").click();

el("loadJsonInput").onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      state.count = Math.max(2, Math.min(30, data.count || 12));
      state.title = data.title || "관계도 제목";
      state.circles = Array.isArray(data.circles) ? data.circles : [];
      state.lines = Array.isArray(data.lines) ? data.lines : [];
      lineIdSeq = state.lines.reduce((m, l) => Math.max(m, l.id || 0), 0) + 1;
      state.legend.line = (data.legend && data.legend.line) ? data.legend.line : JSON.parse(JSON.stringify(DEFAULT_LINE_LEGEND));
      state.legend.border = (data.legend && data.legend.border) ? data.legend.border : [];
      ensureCircleCount(state.count);

      countSlider.value = state.count;
      countInput.value = state.count;
      titleBadge.textContent = state.title;
      watermarkInput.value = data.watermark || "";

      refreshLegends();
      renderAll();
      showToast("JSON 파일을 불러왔어요.");
    } catch (err) {
      showToast("JSON 파일을 읽지 못했어요.");
      console.error(err);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
};

/* ---------------- PNG export ---------------- */
el("exportPngBtn").onclick = async () => {
  const scale = parseInt(el("pngScale").value, 10) || 3;
  const captureArea = el("captureArea");

  // deselect UI states that shouldn't show in export
  const wasConnectMode = connectMode;
  connectMode = false;
  connectSource = null;
  renderCircles();
  document.activeElement && document.activeElement.blur();

  showToast("이미지를 생성하는 중...");
  try {
    const canvas = await html2canvas(captureArea, {
      scale,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "circle-diagram.png";
      a.click();
      URL.revokeObjectURL(url);
      showToast("PNG로 저장했어요!");
    }, "image/png");
  } catch (err) {
    console.error(err);
    showToast("이미지 생성에 실패했어요.");
  } finally {
    connectMode = wasConnectMode;
    connectModeBtn.classList.toggle("active", connectMode);
    renderCircles();
  }
};

/* ---------------- close modal on overlay click ---------------- */
[circleModal, lineModal].forEach(modal => {
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });
});

/* ---------------- init ---------------- */
ensureCircleCount(state.count);
refreshLegends();
renderAll();
