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
let lastLineSettings = { color: "#ff3b3b", arrow: true, doubleArrow: false }; // 마지막으로 선택한 선 설정 기억

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

function renderLegendHeader(container, arr, style) {
  container.innerHTML = "";
  arr.forEach((item) => {
    if (!item.text.trim()) return;
    const entry = document.createElement("div");
    entry.className = "entry";
    const dot = document.createElement("span");
    dot.className = "dot" + (style === "ring" ? " ring" : "");
    if (style === "ring") {
      dot.style.borderColor = item.color;
    } else {
      dot.style.background = item.color;
    }
    const label = document.createElement("span");
    label.textContent = item.text;
    entry.append(dot, label);
    container.appendChild(entry);
  });
}

function refreshLegends() {
  renderLegendEditor(lineLegendList, state.legend.line, onLegendChanged);
  renderLegendEditor(borderLegendList, state.legend.border, onLegendChanged);
  renderLegendHeader(legendHeaderLine, state.legend.line, "fill");
  renderLegendHeader(legendHeaderBorder, state.legend.border, "ring");
  refreshLegendSelects();
}

function onLegendChanged() {
  renderLegendHeader(legendHeaderLine, state.legend.line, "fill");
  renderLegendHeader(legendHeaderBorder, state.legend.border, "ring");
  refreshLegendSelects();
  scheduleAutosave();
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
  if (n <= 6) return 104;
  if (n <= 10) return 92;
  if (n <= 16) return 78;
  if (n <= 22) return 66;
  return 54;
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
      disc.style.border = `6px solid ${c.border.color}`;
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

// 화살표는 <marker>/url(#..) 참조 대신 좌표를 직접 계산한 삼각형으로 그립니다.
// (iframe, blob URL 등 일부 환경에서 url(#id) 프래그먼트 참조가 깨지는 문제를 피하기 위함)
function arrowHeadPolygon(tipX, tipY, angleRad, size) {
  const spread = Math.PI / 7.5;
  const a1 = angleRad + Math.PI - spread;
  const a2 = angleRad + Math.PI + spread;
  const p1x = tipX + size * Math.cos(a1);
  const p1y = tipY + size * Math.sin(a1);
  const p2x = tipX + size * Math.cos(a2);
  const p2y = tipY + size * Math.sin(a2);
  return `${tipX},${tipY} ${p1x},${p1y} ${p2x},${p2y}`;
}

function renderLines() {
  const n = state.count;
  const pts = positions(n);
  const stageRect = circleStage.getBoundingClientRect();
  const w = stageRect.width || 1;
  const h = stageRect.height || 1;
  const radius = circleSizeFor(n) / 2;
  const arrowSize = 12;

  let svgContent = "";
  state.lines.forEach(l => {
    if (l.from >= n || l.to >= n) return;
    const a = pts[l.from], b = pts[l.to];
    let x1 = (a.x / 100) * w, y1 = (a.y / 100) * h;
    let x2 = (b.x / 100) * w, y2 = (b.y / 100) * h;

    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    const angle = Math.atan2(dy, dx);

    // 원 테두리 바깥에서 선이 시작/끝나도록 반지름만큼 당겨줌
    const startX = x1 + ux * radius, startY = y1 + uy * radius;
    const endX = x2 - ux * radius, endY = y2 - uy * radius;

    // 화살표가 있으면 선 끝을 화살표 길이만큼 더 당겨서 삼각형이 원에 파묻히지 않게 함
    const lineEndX = l.arrow ? endX - ux * (arrowSize * 0.6) : endX;
    const lineEndY = l.arrow ? endY - uy * (arrowSize * 0.6) : endY;
    const lineStartX = l.doubleArrow ? startX + ux * (arrowSize * 0.6) : startX;
    const lineStartY = l.doubleArrow ? startY + uy * (arrowSize * 0.6) : startY;

    svgContent += `<line x1="${lineStartX}" y1="${lineStartY}" x2="${lineEndX}" y2="${lineEndY}" stroke="${l.color}" stroke-width="3.5" stroke-linecap="round"></line>`;

    if (l.arrow) {
      svgContent += `<polygon points="${arrowHeadPolygon(endX, endY, angle, arrowSize)}" fill="${l.color}"></polygon>`;
    }
    if (l.doubleArrow) {
      svgContent += `<polygon points="${arrowHeadPolygon(startX, startY, angle + Math.PI, arrowSize)}" fill="${l.color}"></polygon>`;
    }
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
  scheduleAutosave();
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
    downscaleImage(ev.target.result, 1000, (dataUrl) => {
      openCropModal(dataUrl);
    });
  };
  reader.readAsDataURL(file);
  circleImgInput.value = "";
};

el("recropImgBtn").onclick = () => {
  if (currentCircleIndex === null) return;
  const c = state.circles[currentCircleIndex];
  const src = c.rawImage || c.image;
  if (!src) {
    showToast("먼저 이미지를 업로드해 주세요.");
    return;
  }
  openCropModal(src);
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
  state.circles[currentCircleIndex].rawImage = null;
  renderCircles();
  scheduleAutosave();
};

/* ---------------- image crop modal ---------------- */
const cropModal = el("cropModal");
const cropImage = el("cropImage");
const cropZoom = el("cropZoom");
let cropperInstance = null;
let cropSourceDataUrl = null;

function openCropModal(srcDataUrl) {
  cropSourceDataUrl = srcDataUrl;
  circleModal.classList.add("hidden");
  cropModal.classList.remove("hidden");
  cropZoom.value = 0;

  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }

  cropImage.src = srcDataUrl;
  cropImage.onload = () => {
    cropperInstance = new Cropper(cropImage, {
      aspectRatio: 1,
      viewMode: 1,
      dragMode: "move",
      background: false,
      autoCropArea: 1,
      cropBoxResizable: false,
      cropBoxMovable: false,
      toggleDragModeOnDblclick: false,
      guides: false,
      center: false,
      highlight: false,
    });
  };
}

function closeCropModal() {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
  cropModal.classList.add("hidden");
  cropSourceDataUrl = null;
  if (currentCircleIndex !== null) openCircleModal(currentCircleIndex);
}

cropZoom.oninput = () => {
  if (!cropperInstance) return;
  const ratio = 1 + (parseInt(cropZoom.value, 10) / 100) * 2.5; // 1x ~ 3.5x
  cropperInstance.zoomTo(ratio);
};

el("cropRotateLeft").onclick = () => cropperInstance && cropperInstance.rotate(-90);
el("cropRotateRight").onclick = () => cropperInstance && cropperInstance.rotate(90);
el("cropResetBtn").onclick = () => {
  if (!cropperInstance) return;
  cropperInstance.reset();
  cropZoom.value = 0;
};

el("confirmCropBtn").onclick = () => {
  if (!cropperInstance || currentCircleIndex === null) { closeCropModal(); return; }
  const canvas = cropperInstance.getCroppedCanvas({
    width: 450,
    height: 450,
    imageSmoothingQuality: "high",
  });
  if (canvas) {
    const finalDataUrl = canvas.toDataURL("image/png");
    state.circles[currentCircleIndex].image = finalDataUrl;
    state.circles[currentCircleIndex].rawImage = cropSourceDataUrl;
    renderCircles();
    scheduleAutosave();
  }
  closeCropModal();
};

el("cancelCropBtn").onclick = () => closeCropModal();

borderEnabled.onchange = () => {
  state.circles[currentCircleIndex].border.enabled = borderEnabled.checked;
  renderCircles();
  scheduleAutosave();
};
borderColorPicker.oninput = () => {
  state.circles[currentCircleIndex].border.color = borderColorPicker.value;
  borderEnabled.checked = true;
  state.circles[currentCircleIndex].border.enabled = true;
  renderCircles();
  scheduleAutosave();
};
borderLegendSelect.onchange = () => {
  if (!borderLegendSelect.value) return;
  borderColorPicker.value = borderLegendSelect.value;
  state.circles[currentCircleIndex].border.color = borderLegendSelect.value;
  state.circles[currentCircleIndex].border.enabled = true;
  borderEnabled.checked = true;
  renderCircles();
  scheduleAutosave();
};
circleLabelInput.oninput = () => {
  state.circles[currentCircleIndex].label = circleLabelInput.value;
  renderCircles();
  scheduleAutosave();
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
  // 지난번에 고른 색/화살표 설정을 그대로 유지
  lineColorPicker.value = lastLineSettings.color;
  const matched = state.legend.line.find(it => it.color.toLowerCase() === lastLineSettings.color.toLowerCase());
  lineLegendSelect.value = matched ? matched.color : "";
  arrowEnabled.checked = lastLineSettings.arrow;
  doubleArrowEnabled.checked = lastLineSettings.doubleArrow;
  lineModal.classList.remove("hidden");
}

lineLegendSelect.onchange = () => {
  if (lineLegendSelect.value) lineColorPicker.value = lineLegendSelect.value;
};

el("confirmLineBtn").onclick = () => {
  if (!pendingLine) return;
  lastLineSettings = {
    color: lineColorPicker.value,
    arrow: arrowEnabled.checked,
    doubleArrow: doubleArrowEnabled.checked,
  };
  state.lines.push({
    id: lineIdSeq++,
    from: pendingLine.from,
    to: pendingLine.to,
    color: lastLineSettings.color,
    arrow: lastLineSettings.arrow,
    doubleArrow: lastLineSettings.doubleArrow,
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
titleBadge.oninput = () => { state.title = titleBadge.textContent; scheduleAutosave(); };
watermarkInput.oninput = () => { state.watermark = watermarkInput.value; scheduleAutosave(); };

/* ---------------- JSON save / load ---------------- */
function serializeState() {
  return {
    version: 1,
    count: state.count,
    title: state.title,
    watermark: watermarkInput.value,
    circles: state.circles,
    lines: state.lines,
    legend: state.legend,
  };
}

function applyLoadedData(data) {
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
}

el("saveJsonBtn").onclick = () => {
  const data = serializeState();
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
      applyLoadedData(data);
      scheduleAutosave(true);
      showToast("JSON 파일을 불러왔어요.");
    } catch (err) {
      showToast("JSON 파일을 읽지 못했어요.");
      console.error(err);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
};

/* ---------------- 브라우저 자동 저장 (localStorage) ---------------- */
const AUTOSAVE_KEY = "circle-diagram-autosave-v1";
const autosaveHint = el("autosaveHint");
let autosaveTimer = null;
let autosaveWarned = false;

function scheduleAutosave(immediate) {
  clearTimeout(autosaveTimer);
  const run = () => {
    try {
      const data = serializeState();
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
      autosaveHint.textContent = "이 브라우저에 자동 저장됐어요 (" + new Date().toLocaleTimeString("ko-KR") + ")";
      autosaveWarned = false;
    } catch (err) {
      console.error("autosave failed", err);
      if (!autosaveWarned) {
        autosaveWarned = true;
        showToast("이미지 용량이 커서 자동 저장에 실패했어요. JSON 저장을 이용해 주세요.");
        autosaveHint.textContent = "자동 저장 실패 - 용량 초과. JSON으로 저장해 두세요.";
      }
    }
  };
  if (immediate) run();
  else autosaveTimer = setTimeout(run, 500);
}

function tryRestoreAutosave() {
  let raw;
  try {
    raw = localStorage.getItem(AUTOSAVE_KEY);
  } catch (err) {
    return false;
  }
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    applyLoadedData(data);
    autosaveHint.textContent = "이전에 작업하던 내용을 불러왔어요.";
    return true;
  } catch (err) {
    console.error("autosave restore failed", err);
    return false;
  }
}

el("clearAutosaveBtn").onclick = () => {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch (err) { /* ignore */ }
  autosaveHint.textContent = "자동 저장 내용을 지웠어요. 지금부터 새로 저장돼요.";
  showToast("자동 저장 내용을 지웠어요.");
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
const restored = tryRestoreAutosave();
if (!restored) {
  ensureCircleCount(state.count);
  refreshLegends();
  renderAll();
}
