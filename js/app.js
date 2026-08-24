/* ============================================================
   无障碍阅读伴侣 · 逻辑（app.js）
   - 支持多本书：LIBRARY 书库注册表（library.js）
   - 页签：导读 / 精读台 / 词典 / 进度 / 设置
   - 进度按「书/分部/章」独立记录；数据存 localStorage
   ============================================================ */
"use strict";

/* ---------- 小工具 ---------- */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escAttr(s) { return escHtml(s).replace(/'/g, "&#39;"); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }
function toast(msg) {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove("show"), 1600);
}
function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDaysIso(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/* ---------- 本地存储 ----------
   localStorage 在部分受限环境不可用（如沙箱内置浏览器），
   这里做降级：不可用时退回内存存储，保证功能不崩溃。
   正常浏览器（Chrome/Edge 双击打开）会使用真实 localStorage 持久化。 */
const storage = (() => {
  try {
    const t = "__hc_probe__";
    window.localStorage.setItem(t, "1");
    window.localStorage.removeItem(t);
    return window.localStorage;
  } catch (e) {
    const mem = {};
    return {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; }
    };
  }
})();

const store = {
  get(k, d) { try { const v = JSON.parse(storage.getItem("hc_" + k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } },
  set(k, v) { storage.setItem("hc_" + k, JSON.stringify(v)); },
  del(k) { storage.removeItem("hc_" + k); }
};

/* ---------- 状态 ---------- */
const DEFAULT_SETTINGS = { fontSize: 19, lineHeight: 1.9, letterSpacing: 0.02, rate: 0.9, theme: "light", focusMode: false };
let settings = Object.assign({}, DEFAULT_SETTINGS, store.get("settings", {}));
let progress = store.get("progress", {});        // 键："{bookId}/{partId}/{chapterN}" -> "done"
let goalMin  = store.get("goal", 10);
let readDates = store.get("dates", []);           // ["2026-08-23", ...]
let readerCount = store.get("readerCount", 0);    // 累计精读次数
let reviews = store.get("reviews", []);            // 间隔复习任务
let reviewDoneCount = store.get("reviewCount", 0); // 累计完成复习次数
let vocab = store.get("vocab", []);                 // 生词本 [{name, def}]
let currentBookIdx = Math.min(store.get("bookIdx", 0), LIBRARY.length - 1);
let currentPart = store.get("part", LIBRARY[currentBookIdx].parts[0].id);
let currentBook = store.get("chapter", 1);
let readingAll = false;
let speechIndex = -1;

/* ---------- 当前书 / 分部 / 章节 访问器 ---------- */
function getBook() { return LIBRARY[currentBookIdx]; }
function getPart() {
  const p = getBook().parts.find(x => x.id === currentPart);
  return p || getBook().parts[0];
}
function pKey(partId, n) { return `${getBook().id}/${partId}/${n}`; }
function isDone(partId, n) { return progress[pKey(partId, n)] === "done"; }
function setDone(partId, n, done) {
  const k = pKey(partId, n);
  if (done) progress[k] = "done"; else delete progress[k];
  store.set("progress", progress);
}
function savePosition() {
  store.set("bookIdx", currentBookIdx);
  store.set("part", currentPart);
  store.set("chapter", currentBook);
}

/* ============================================================
   1. 设置：应用样式
   ============================================================ */
function applySettings() {
  const r = document.documentElement.style;
  r.setProperty("--font-size", settings.fontSize + "px");
  r.setProperty("--line-height", settings.lineHeight);
  r.setProperty("--letter-spacing", settings.letterSpacing + "em");
  document.body.className = "theme-" + settings.theme;
  $("#focusMode").checked = settings.focusMode;
  $("#passageView").classList.toggle("focus-mode", settings.focusMode);
}
function saveSettings() { store.set("settings", settings); applySettings(); }

/* ============================================================
   2. 页签切换
   ============================================================ */
function switchTab(name) {
  stopSpeech();
  $$(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "tab-" + name));
}

/* ============================================================
   3. 导读：书目 / 分部 / 章节列表 / 导读卡
   ============================================================ */
function renderBookSelect() {
  const sel = $("#bookSelect");
  sel.innerHTML = "";
  LIBRARY.forEach((b, i) => {
    const opt = document.createElement("option");
    opt.value = i;
    opt.textContent = `${b.title}${b.subtitle ? " · " + b.subtitle : ""}`;
    sel.appendChild(opt);
  });
  sel.value = currentBookIdx;
}

function renderPartSelect() {
  const sel = $("#partSelect");
  sel.innerHTML = "";
  getBook().parts.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name}（${p.en} · ${p.books.length} 章/卷）`;
    sel.appendChild(opt);
  });
  // 若保存的分部在当前书中不存在，回退到第一部
  if (![...sel.options].some(o => o.value === currentPart)) {
    currentPart = getBook().parts[0].id;
  }
  sel.value = currentPart;
}

function renderBookList() {
  const part = getPart();
  const list = $("#bookList");
  list.innerHTML = "";
  const unit = part.unit || (part.books.length > 8 ? "卷" : "章");
  part.books.forEach(b => {
    const btn = document.createElement("button");
    btn.className = "book-btn";
    btn.dataset.n = b.n;
    if (isDone(part.id, b.n)) btn.classList.add("done");
    if (b.n === currentBook) btn.classList.add("active");
    btn.textContent = `${b.n} ${unit}`;
    btn.title = b.title;
    btn.addEventListener("click", () => { currentBook = b.n; savePosition(); renderBookList(); renderBookDetail(); });
    list.appendChild(btn);
  });
}

function bookStatusTag(partId, n) {
  return isDone(partId, n)
    ? '<span class="tag done-tag">已读完 ✓</span>'
    : '<span class="tag">未读完</span>';
}

function renderBookDetail() {
  const book = getBook();
  const part = getPart();
  const b = part.books.find(x => x.n === currentBook);
  if (!b) return;
  const wrap = $("#bookDetail");
  const done = isDone(part.id, b.n);

  const tags = arr => (arr || []).map(t => `<span class="tag">${escHtml(t)}</span>`).join("");
  const focusHtml = (b.focus || []).map(f =>
    `<div class="focus-item"><span class="where">${escHtml(f.where)}</span><br>${escHtml(f.why)}</div>`).join("");

  const quizHtml = (b.quiz || []).map((q, qi) => `
    <div class="quiz-item" data-quiz="${qi}">
      <div class="q">Q${qi + 1}. ${escHtml(q.q)}</div>
      ${q.options.map((o, oi) => `<label class="opt" data-oi="${oi}"><input type="radio" name="quiz-${part.id}-${b.n}-${qi}" value="${oi}"> ${escHtml(o)}</label>`).join("")}
      <div class="explain" hidden></div>
    </div>`).join("");

  const unit = part.unit || (part.books.length > 8 ? "卷" : "章");
  wrap.innerHTML = `
    <h2 class="book-title">第 ${b.n} ${unit} · ${escHtml(b.title)}</h2>
    <p class="book-sub">${escHtml(book.title)} · ${escHtml(part.name)} · ${bookStatusTag(part.id, b.n)}
      <button id="btnMarkBook" class="btn small">${done ? "取消读完" : "标记读完"}</button>
    </p>
    <div class="card detail-block">
      <h3>这${unit}讲什么（导读）</h3>
      <p>${escHtml(b.preview)}</p>
    </div>
    <div class="card detail-block">
      <h3>新出场人物</h3>
      <p>${(b.characters && b.characters.length) ? tags(b.characters) : "（无）"}</p>
    </div>
    <div class="card detail-block">
      <h3>新地名</h3>
      <p>${(b.places && b.places.length) ? tags(b.places) : "（无）"}</p>
    </div>
    <div class="card detail-block">
      <h3>关键概念</h3>
      <p>${tags(b.terms)}</p>
    </div>
    <div class="card detail-block">
      <h3>建议精读（先读这里，再回书里找）</h3>
      ${focusHtml || "<p>（暂无）</p>"}
    </div>
    <div class="card detail-block">
      <h3>读完回顾（小结）</h3>
      <p>${escHtml(b.recap)}</p>
    </div>
    <div class="card detail-block">
      <h3>自测一下（检验是否读懂）</h3>
      ${quizHtml}
    </div>
    <div class="nav-book">
      <button id="btnPrevBook" class="btn" ${b.n <= 1 ? "disabled" : ""}>← 上一${unit}</button>
      <button id="btnNextBook" class="btn" ${b.n >= part.books.length ? "disabled" : ""}>下一${unit} →</button>
    </div>`;

  $("#btnMarkBook").addEventListener("click", () => {
    const nowDone = !done;
    setDone(part.id, b.n, nowDone);
    if (nowDone) scheduleReviews(part.id, b.n); else cancelReviews(part.id, b.n);
    checkIn();
    renderBookList(); renderBookDetail(); renderProgress();
  });
  const prev = $("#btnPrevBook"), next = $("#btnNextBook");
  prev.addEventListener("click", () => { if (b.n > 1) { currentBook = b.n - 1; savePosition(); renderBookList(); renderBookDetail(); } });
  next.addEventListener("click", () => { if (b.n < part.books.length) { currentBook = b.n + 1; savePosition(); renderBookList(); renderBookDetail(); } });

  // 自测题交互：点选项即判对错
  $$(".quiz-item", wrap).forEach(item => {
    const qi = +item.dataset.quiz;
    const q = b.quiz[qi];
    const radios = $$('input[type="radio"]', item);
    radios.forEach(radio => radio.addEventListener("change", () => {
      const chosen = +radio.value;
      radios.forEach(r => r.disabled = true);
      $$(".opt", item).forEach(opt => {
        const oi = +opt.dataset.oi;
        if (oi === q.a) opt.classList.add("correct");
        else if (oi === chosen) opt.classList.add("wrong");
      });
      const ex = $(".explain", item);
      ex.hidden = false;
      ex.textContent = q.explain;
    }));
  });
}

/* ============================================================
   4. 精读台：断句 / 标注 / 要点 / 朗读
   ============================================================ */
const CONCL = ["总之","综上所述","由此可见","因此","所以","因而","可见","归根结底","简言之","结论","最终","这意味着","这表明","这说明","关键在于","核心是","根本原因","重点在于","值得注意","必须","应该","应当","总的来说"];
const ARG   = ["因为","由于","根据","依据","基于","研究表明","数据显示","统计表明","实验证明","调查显示","报告指出","理由","原因在于","相比","相较于","同比增长","同比下降","增长","下降","上升","导致","造成","使得","来自","占","达到","超过","约为","首先","其次","再次","最后","第一","第二","第三","一方面","另一方面","换言之","也就是说","换句话说","事实上","实际上","据统计","研究显示","指出","调查发现"];
const EX    = ["例如","比如","譬如","举例","举个例子","比方说","以……为例","比如说","如：","如 ","例如说","典型","案例","例如像","又如","再如","像是"];

function splitSentences(text) {
  const m = text.match(/[^。！？；…!?;]+[。！？；…!?;]?/g);
  return m ? m.map(s => s.trim()).filter(Boolean) : [];
}

function scoreSentence(s) {
  let score = 0;
  const len = s.length;
  if (len >= 12 && len <= 70) score += 2; else if (len > 70) score += 1;
  if (/\d+(\.\d+)?%?/.test(s)) score += 2;
  if (CONCL.some(m => s.includes(m))) score += 2.5;
  if (ARG.some(m => s.includes(m))) score += 1.5;
  if (EX.some(m => s.includes(m))) score += 1;
  for (const kw of ["关键","核心","重要","显著","最大","最小","首先","必须","重点","创新","突破"]) {
    if (s.includes(kw)) { score += 1; break; }
  }
  return score;
}

/* 术语集合：按当前书（词典 + 主题 + 各分部人物/地名/概念）构建 */
function buildTermPatternFor(book) {
  const set = new Set();
  (book.glossary || []).forEach(g => set.add(g.name));
  (book.themes || []).forEach(t => set.add(t.name));
  (book.parts || []).forEach(p => (p.books || []).forEach(b => {
    (b.characters || []).forEach(c => set.add(c));
    (b.places || []).forEach(x => set.add(x));
    (b.terms || []).forEach(t => set.add(t));
  }));
  const names = [...set].filter(n => n.length >= 2).sort((a, b) => b.length - a.length);
  const esc = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(esc.join("|"), "g");
}
let TERM_PATTERN = buildTermPatternFor(getBook());

function defOf(name) {
  const book = getBook();
  const g = (book.glossary || []).find(x => x.name === name);
  if (g) return `【${g.type}】${g.def}`;
  const t = (book.themes || []).find(x => x.name === name);
  if (t) return `【主题】${t.def}`;
  return `「${name}」：当前书中的专名，详见「词典」页。`;
}

function highlightTerms(htmlText) {
  return htmlText.replace(TERM_PATTERN, m =>
    `<mark class="term" data-term="${escAttr(m)}" title="${escAttr(defOf(m))}">${m}</mark>`);
}

function analyzePassage() {
  const raw = $("#passageInput").value.trim();
  if (!raw) { alert("请先粘贴一段文字再点「开始精读」。"); return; }

  const sentences = splitSentences(raw);
  const view = $("#passageView");
  view.innerHTML = sentences.map((s, i) =>
    `<span class="sentence" data-i="${i}">${highlightTerms(escHtml(s))}</span>`).join(" ");

  // 要点
  const scored = sentences
    .map(s => ({ s, score: scoreSentence(s) }))
    .sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 5);
  const box = $("#pointsBox");
  box.innerHTML = "<h3>要点提示</h3><ul>" +
    top.map(t => `<li>${escHtml(truncate(t.s, 62))}</li>`).join("") + "</ul>";
  box.hidden = false;

  $("#readerControls").hidden = false;
  readerCount += 1;
  store.set("readerCount", readerCount);

  // 点击句子朗读；点击高亮术语则加入生词本（不触发朗读）
  $$(".sentence", view).forEach(el => el.addEventListener("click", () => {
    readingAll = false;
    speakSentence(+el.dataset.i);
  }));
  $$("mark.term", view).forEach(m => m.addEventListener("click", (e) => {
    e.stopPropagation();
    addVocab(m.dataset.term, m.title);
  }));
  view.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- 朗读 ---------- */
function setActive(i) {
  speechIndex = i;
  $$(".sentence").forEach((el, idx) => el.classList.toggle("active", idx === i));
}
function clearActive() { speechIndex = -1; $$(".sentence").forEach(el => el.classList.remove("active")); }
function stopSpeech() {
  readingAll = false;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  clearActive();
}
function speakSentence(i) {
  const sents = $$(".sentence");
  if (!sents.length || i < 0 || i >= sents.length) return;
  if (!("speechSynthesis" in window)) { alert("当前浏览器不支持语音朗读，请换用 Chrome 或 Edge。"); return; }
  const text = sents[i].textContent;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = settings.rate;
  u.lang = /[\u4e00-\u9fff]/.test(text) ? "zh-CN" : "en-US";
  u.onend = () => { if (readingAll && i < sents.length - 1) speakSentence(i + 1); };
  speechSynthesis.cancel();
  setActive(i);
  speechSynthesis.speak(u);
}
function readAll() {
  const sents = $$(".sentence");
  if (!sents.length) { alert("请先「开始精读」再朗读。"); return; }
  readingAll = true;
  speakSentence(0);
}

/* ---------- 生词本 ---------- */
function addVocab(name, def) {
  const key = name.trim();
  if (!key) return false;
  if (vocab.some(v => v.name === key)) { toast("已在生词本中：" + key); return false; }
  vocab.push({ name: key, def: def || "" });
  store.set("vocab", vocab);
  renderVocab();
  toast("已加入生词本：" + key);
  return true;
}
function removeVocab(name) {
  vocab = vocab.filter(v => v.name !== name);
  store.set("vocab", vocab);
  renderVocab();
  renderGlossary($("#glossarySearch").value);
}
function renderVocab() {
  const box = $("#vocabBox");
  if (!box) return;
  let html = `<h3>生词本（${vocab.length}）</h3>
    <p class="hint">Anki 导入：文件 → 导入，选择导出的 .txt（第 1 列=正面，第 2 列=背面，用 Tab 分隔）。</p>`;
  html += `<div class="vocab-actions">
    <button id="btnExportAnki" class="btn primary">导出 Anki (.txt)</button>
    <button id="btnClearVocab" class="btn danger">清空生词本</button>
  </div>`;
  if (!vocab.length) {
    html += `<p class="hint">（还没有生词——在精读台点击高亮的术语，或在本页点「＋」）</p>`;
  } else {
    html += `<ul class="vocab-list">` + vocab.map(v =>
      `<li><span class="vname">${escHtml(v.name)}</span><span class="vdef">${escHtml(v.def)}</span><button class="btn small vocab-del" data-name="${escAttr(v.name)}">移除</button></li>`).join("") + `</ul>`;
  }
  box.innerHTML = html;
  $("#btnExportAnki").addEventListener("click", exportAnki);
  $("#btnClearVocab").addEventListener("click", () => {
    if (!vocab.length) return;
    if (!confirm("确定清空全部生词？")) return;
    vocab = []; store.set("vocab", vocab); renderVocab(); renderGlossary($("#glossarySearch").value);
  });
  $$(".vocab-del", box).forEach(btn => btn.addEventListener("click", () => removeVocab(btn.dataset.name)));
}
function exportAnki() {
  if (!vocab.length) { alert("生词本是空的，先收集一些词条吧。"); return; }
  const lines = vocab.map(v => `${v.name}	${v.def || ""}`);
  const content = "﻿" + lines.join("\n");  // BOM 防乱码；每行：名称 Tab 解释
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = "生词本-Anki-" + isoDate(new Date()) + ".txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("已导出 " + vocab.length + " 张卡片");
}

/* ============================================================
   5. 词典（按当前书）
   ============================================================ */
function renderGlossary(keyword) {
  const book = getBook();
  const wrap = $("#glossaryGroups");
  wrap.innerHTML = "";
  const kw = (keyword || "").trim();

  // 按类型分组（保持出现顺序）
  const groups = [];
  (book.glossary || []).forEach(g => {
    if (kw && !(g.name.includes(kw) || g.def.includes(kw))) return;
    let grp = groups.find(x => x.type === g.type);
    if (!grp) { grp = { type: g.type, items: [] }; groups.push(grp); }
    grp.items.push(g);
  });
  groups.forEach(grp => {
    const block = document.createElement("div");
    block.className = "gloss-group";
    block.innerHTML = `<h3>${escHtml(grp.type)}</h3>` + grp.items.map(g => {
      const inVocab = vocab.some(v => v.name === g.name);
      return `<div class="gloss-item"><span class="gname">${escHtml(g.name)}</span><span class="gdef">${escHtml(g.def)}</span>` +
        `<button class="btn small vocab-add-btn ${inVocab ? "added" : ""}" data-gname="${escAttr(g.name)}" data-gdef="${escAttr("【" + g.type + "】" + g.def)}">${inVocab ? "✓ 已收" : "＋"}</button></div>`;
    }).join("");
    wrap.appendChild(block);
  });
  $$(".vocab-add-btn", wrap).forEach(btn => btn.addEventListener("click", () => {
    addVocab(btn.dataset.gname, btn.dataset.gdef);
    renderGlossary($("#glossarySearch").value);
  }));

  // 核心主题组
  const themes = (book.themes || []).filter(t => !kw || t.name.includes(kw) || t.def.includes(kw));
  if (themes.length) {
    const block = document.createElement("div");
    block.className = "gloss-group";
    block.innerHTML = `<h3>核心主题</h3>` + themes.map(t =>
      `<div class="gloss-item"><span class="gname">${escHtml(t.name)}</span><span class="gdef">${escHtml(t.def)}</span></div>`).join("");
    wrap.appendChild(block);
  }

  if (!wrap.children.length) {
    wrap.innerHTML = "<p class='hint'>（没有匹配的词条）</p>";
  }
}

/* ============================================================
   6. 进度 / 习惯 / 徽章
   ============================================================ */
function checkIn() {
  const today = isoDate(new Date());
  if (!readDates.includes(today)) {
    readDates.push(today);
    readDates.sort();
    store.set("dates", readDates);
  }
  renderProgress();
}
function calcStreak() {
  const set = new Set(readDates);
  let streak = 0;
  const d = new Date();
  if (!set.has(isoDate(d))) d.setDate(d.getDate() - 1);
  while (set.has(isoDate(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}
function partDoneCount(part) {
  return part.books.filter(b => isDone(part.id, b.n)).length;
}
/* ---------- 间隔复习 ---------- */
function scheduleReviews(partId, n) {
  const book = getBook();
  const part = getPart();
  const b = part.books.find(x => x.n === n);
  if (!b) return;
  const unit = part.unit || (part.books.length > 8 ? "卷" : "章");
  const base = `${book.id}/${partId}/${n}`;
  const label = `${book.title} · ${part.name} · 第 ${n} ${unit}《${b.title}》`;
  [3, 7].forEach((d, i) => {
    const id = base + "@r" + (i + 1);
    if (!reviews.some(r => r.id === id)) {
      reviews.push({
        id,
        label,
        step: i === 0 ? "第 1 次复习" : "第 2 次复习",
        due: addDaysIso(d),
        done: false
      });
    }
  });
  store.set("reviews", reviews);
}
function cancelReviews(partId, n) {
  const base = `${getBook().id}/${partId}/${n}`;
  reviews = reviews.filter(r => !r.id.startsWith(base + "@"));
  store.set("reviews", reviews);
}
function completeReview(id) {
  const r = reviews.find(x => x.id === id);
  if (r && !r.done) {
    r.done = true;
    reviewDoneCount += 1;
    store.set("reviewCount", reviewDoneCount);
    store.set("reviews", reviews);
    renderProgress();
  }
}
function renderReviews() {
  const box = $("#reviewBox");
  if (!box) return;
  const today = isoDate(new Date());
  const due = reviews.filter(r => !r.done && r.due <= today);
  const upcoming = reviews.filter(r => !r.done && r.due > today)
    .sort((a, b) => a.due.localeCompare(b.due)).slice(0, 6);
  let html = `<h3>复习提醒</h3>
    <p class="hint">读完一章/卷后，第 3 天、第 7 天回来花 5 分钟看小结、做自测题，记忆更牢。</p>`;
  if (!reviews.length) {
    html += `<p class="hint">（还没有复习任务——把某章标记为「读完」后会自动生成）</p>`;
  } else {
    html += `<div class="review-group"><h4>今天待复习（${due.length}）</h4>`;
    html += due.length
      ? due.map(r => `<div class="review-item"><span class="review-label">${escHtml(r.label)} · ${escHtml(r.step)}</span><button class="btn small primary" data-review="${escAttr(r.id)}">完成复习</button></div>`).join("")
      : `<p class="hint">今天没有到期任务</p>`;
    html += `</div>`;
    if (upcoming.length) {
      html += `<div class="review-group"><h4>即将到期</h4>` + upcoming.map(r =>
        `<div class="review-item upcoming"><span class="review-label">${escHtml(r.label)} · ${escHtml(r.step)}</span><span class="review-due">${r.due}</span></div>`).join("") + `</div>`;
    }
  }
  html += `<p class="hint">已累计完成复习：${reviewDoneCount} 次</p>`;
  box.innerHTML = html;
  $$("[data-review]", box).forEach(btn => btn.addEventListener("click", () => completeReview(btn.dataset.review)));
}

function renderProgress() {
  const streak = calcStreak();
  $("#streakBadge").textContent = "连续 " + streak + " 天";

  $("#goalStatus").textContent =
    `今日目标：${goalMin} 分钟 · 本月已读 ${readDates.length} 天 · 连续 ${streak} 天`;

  const ep = $("#epicProgress");
  ep.innerHTML = "";
  getBook().parts.forEach(part => {
    const total = part.books.length, done = partDoneCount(part), pct = total ? Math.round(done / total * 100) : 0;
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${escHtml(part.name)}</h3>
      <div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
      <p class="progress-note">已读 ${done} / ${total} 卷/章（${pct}%）</p>`;
    ep.appendChild(card);
  });

  renderBadges();
  renderReviews();
}
function renderBadges() {
  const book = getBook();
  const streak = calcStreak();
  const anyDone = Object.values(progress).some(v => v === "done");
  const bookAll = book.parts.every(p => p.books.every(b => isDone(p.id, b.n)));

  const partBadges = book.parts.map(p => {
    const done = partDoneCount(p);
    return {
      icon: "📜",
      name: `读完《${p.name}》`,
      desc: `${done}/${p.books.length} 章/卷`,
      got: done === p.books.length
    };
  });

  const defs = [
    { icon: "📖", name: "初入书海", desc: "读完任意一章/卷", got: anyDone },
    { icon: "🔥", name: "三日之约", desc: "连续阅读 3 天", got: streak >= 3 },
    { icon: "⚡", name: "七日骑士", desc: "连续阅读 7 天", got: streak >= 7 },
    { icon: "🏁", name: `读完《${book.title}》`, desc: "当前书全部章节读完", got: bookAll },
    ...partBadges,
    { icon: "🔍", name: "精读十段", desc: "累计精读 10 次", got: readerCount >= 10 },
    { icon: "🧠", name: "温故知新", desc: "累计完成 5 次复习", got: reviewDoneCount >= 5 },
    { icon: "📇", name: "词卡达人", desc: "收集 10 张生词卡", got: vocab.length >= 10 }
  ];
  $("#badges").innerHTML = defs.map(b =>
    `<div class="badge ${b.got ? "" : "locked"}"><span class="icon">${b.icon}</span><span class="name">${escHtml(b.name)}</span><span class="desc">${escHtml(b.desc)}</span></div>`).join("");
}

/* ============================================================
   7. 初始化
   ============================================================ */
function switchBook(idx) {
  currentBookIdx = idx;
  currentPart = getBook().parts[0].id;
  currentBook = 1;
  TERM_PATTERN = buildTermPatternFor(getBook());
  savePosition();
  renderBookSelect();
  renderPartSelect();
  renderBookList();
  renderBookDetail();
  renderVocab();
  renderGlossary("");
  renderProgress();
}

/* 旧版进度迁移：{iliad:{1:"done"}} -> {"homer/iliad/1":"done"} */
function migrateProgress() {
  const map = { iliad: "homer/iliad", odyssey: "homer/odyssey" };
  let changed = false;
  Object.keys(progress).forEach(k => {
    if (map[k] && typeof progress[k] === "object") {
      Object.keys(progress[k]).forEach(n => {
        if (progress[k][n] === "done") { progress[map[k] + "/" + n] = "done"; changed = true; }
      });
      delete progress[k];
      changed = true;
    }
  });
  if (changed) store.set("progress", progress);
}

function bindEvents() {
  // 页签
  $$(".tab-btn").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));

  // 导读：书目与分部
  $("#bookSelect").addEventListener("change", e => switchBook(+e.target.value));
  $("#partSelect").addEventListener("change", e => {
    currentPart = e.target.value;
    currentBook = 1;
    savePosition();
    renderBookList(); renderBookDetail();
  });

  // 精读
  $("#btnAnalyze").addEventListener("click", analyzePassage);
  $("#btnClear").addEventListener("click", () => { $("#passageInput").value = ""; $("#passageView").innerHTML = ""; $("#pointsBox").hidden = true; $("#readerControls").hidden = true; stopSpeech(); });
  $("#btnReadAll").addEventListener("click", readAll);
  $("#btnStop").addEventListener("click", stopSpeech);

  // 排版控制
  const step = (key, delta, min, max, round) => () => {
    settings[key] = Math.min(max, Math.max(min, settings[key] + delta));
    if (round) settings[key] = Math.round(settings[key] * 100) / 100;
    saveSettings();
  };
  $("#fontMinus").addEventListener("click", step("fontSize", -1, 14, 34, false));
  $("#fontPlus").addEventListener("click", step("fontSize", 1, 14, 34, false));
  $("#lhMinus").addEventListener("click", step("lineHeight", -0.1, 1.2, 3.2, true));
  $("#lhPlus").addEventListener("click", step("lineHeight", 0.1, 1.2, 3.2, true));
  $("#lsMinus").addEventListener("click", step("letterSpacing", -0.01, 0, 0.2, true));
  $("#lsPlus").addEventListener("click", step("letterSpacing", 0.01, 0, 0.2, true));
  $("#rateMinus").addEventListener("click", step("rate", -0.1, 0.5, 2, true));
  $("#ratePlus").addEventListener("click", step("rate", 0.1, 0.5, 2, true));

  // 词典
  $("#glossarySearch").addEventListener("input", e => renderGlossary(e.target.value));

  // 进度
  $("#goalInput").value = goalMin;
  $("#btnGoal").addEventListener("click", () => {
    goalMin = Math.max(1, Math.min(300, +$("#goalInput").value || 10));
    store.set("goal", goalMin);
    renderProgress();
  });
  $("#btnCheckIn").addEventListener("click", checkIn);

  // 设置
  $$(".theme-btn").forEach(b => b.addEventListener("click", () => {
    settings.theme = b.dataset.theme; saveSettings();
  }));
  $("#focusMode").addEventListener("change", e => { settings.focusMode = e.target.checked; saveSettings(); });
  $("#btnResetData").addEventListener("click", () => {
    if (!confirm("确定清空全部进度、打卡与设置？此操作不可恢复。")) return;
    ["hc_progress", "hc_dates", "hc_goal", "hc_settings", "hc_readerCount", "hc_bookIdx", "hc_part", "hc_chapter", "hc_reviews", "hc_reviewCount", "hc_vocab"].forEach(k => store.del(k));
    location.reload();
  });
}

/* 删书后自动清理该书的进度与复习任务（书不在书库里的数据直接移除） */
function cleanupMissingBooks() {
  const ids = new Set(LIBRARY.map(b => b.id));
  let changed = false;
  Object.keys(progress).forEach(k => {
    const bookId = k.split("/")[0];
    if (!ids.has(bookId)) { delete progress[k]; changed = true; }
  });
  const oldLen = reviews.length;
  reviews = reviews.filter(r => ids.has(r.id.split("/")[0]));
  if (changed) store.set("progress", progress);
  if (reviews.length !== oldLen) store.set("reviews", reviews);
}

function init() {
  migrateProgress();
  cleanupMissingBooks();
  applySettings();
  bindEvents();
  renderBookSelect();
  renderPartSelect();
  renderBookList();
  renderBookDetail();
  renderGlossary("");
  renderProgress();
}
document.addEventListener("DOMContentLoaded", init);

/* 调试钩子：仅供测试 / 高级用户查看内部状态，不影响正常功能 */
window.__hcDebug = {
  reviews: () => reviews,
  completeReview,
  scheduleReviews,
  renderProgress
};