// This plugin was generated entirely by AI: Claude Sonnet 5 (Anthropic),
// model id "claude-sonnet-5", via Claude Code, at the request of the vault owner.
const { Plugin, Modal, PluginSettingTab, Setting, Notice } = require("obsidian");

const DEFAULT_SETTINGS = {
  drawingsFolder: "Drawings",
  defaultWidth: 600,
  defaultHeight: 400,
};

const COLORS = ["#000000", "#e03131", "#1971c2", "#2f9e44", "#f08c00", "#9c36b5"];
const SIZES = [
  ["Thin", 2],
  ["Medium", 4],
  ["Thick", 8],
];
const ERASE_RADIUS = 12;

function randomId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function ensureFolder(app, folderPath) {
  const existing = app.vault.getAbstractFileByPath(folderPath);
  if (existing) return;
  try {
    await app.vault.createFolder(folderPath);
  } catch (e) {
    // folder already exists (race) - ignore
  }
}

function svgEl(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) {
    for (const key in attrs) node.setAttribute(key, attrs[key]);
  }
  return node;
}

function renderDrawingSvg(container, width, height, strokes) {
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width: "100%",
    class: "nsk-svg",
  });
  svg.appendChild(svgEl("rect", { x: 0, y: 0, width, height, fill: "#ffffff" }));
  for (const s of strokes) {
    if (!s.points || s.points.length < 2) continue;
    const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    svg.appendChild(
      svgEl("path", {
        d,
        stroke: s.color,
        "stroke-width": s.size,
        fill: "none",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
      })
    );
  }
  container.appendChild(svg);
}

function parseBlock(source) {
  const m = source.match(/path\s*:\s*(.+)/);
  return { path: m ? m[1].trim() : null };
}

// ---------------------------------------------------------------------
// Drawing modal
// ---------------------------------------------------------------------

class DrawModal extends Modal {
  constructor(app, plugin, initialData, onSave) {
    super(app);
    this.plugin = plugin;
    this.width = (initialData && initialData.width) || plugin.settings.defaultWidth;
    this.height = (initialData && initialData.height) || plugin.settings.defaultHeight;
    this.strokes = initialData && initialData.strokes ? JSON.parse(JSON.stringify(initialData.strokes)) : [];
    this.onSave = onSave;
    this.color = COLORS[0];
    this.size = SIZES[1][1];
    this.tool = "pen";
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nsk-modal");
    this.modalEl.addClass("nsk-modal-el");

    contentEl.createEl("h3", { text: "Draw" });

    const toolbar = contentEl.createDiv({ cls: "nsk-toolbar" });

    this.colorBtns = [];
    for (const c of COLORS) {
      const btn = toolbar.createEl("button", { cls: "nsk-color-btn" });
      btn.style.background = c;
      btn.addEventListener("click", () => {
        this.color = c;
        this.tool = "pen";
        this.updateToolbarState();
      });
      this.colorBtns.push({ btn, color: c });
    }

    this.customColorInput = toolbar.createEl("input", { attr: { type: "color" } });
    this.customColorInput.value = "#000000";
    this.customColorInput.addEventListener("input", () => {
      this.color = this.customColorInput.value;
      this.tool = "pen";
      this.updateToolbarState();
    });

    const sizeSelect = toolbar.createEl("select", { cls: "nsk-size-select" });
    for (const [label, val] of SIZES) {
      sizeSelect.createEl("option", { text: label, value: String(val) });
    }
    sizeSelect.value = String(this.size);
    sizeSelect.addEventListener("change", () => {
      this.size = parseInt(sizeSelect.value, 10);
    });

    this.eraserBtn = toolbar.createEl("button", { text: "Eraser" });
    this.eraserBtn.addEventListener("click", () => {
      this.tool = "eraser";
      this.updateToolbarState();
    });

    const undoBtn = toolbar.createEl("button", { text: "Undo" });
    undoBtn.addEventListener("click", () => {
      this.strokes.pop();
      this.redraw();
    });

    const clearBtn = toolbar.createEl("button", { text: "Clear" });
    clearBtn.addEventListener("click", () => {
      this.strokes = [];
      this.redraw();
    });

    this.updateToolbarState();

    const canvasWrap = contentEl.createDiv({ cls: "nsk-canvas-wrap" });
    this.canvas = canvasWrap.createEl("canvas", { cls: "nsk-canvas" });
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext("2d");
    this.redraw();
    this.setupPointerEvents();

    const btnRow = contentEl.createDiv({ cls: "nsk-btn-row" });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
    const saveBtn = btnRow.createEl("button", { text: "Save", cls: "nsk-save-btn" });
    saveBtn.addEventListener("click", () => this.save());
  }

  updateToolbarState() {
    for (const { btn, color } of this.colorBtns) {
      btn.toggleClass("nsk-active", this.tool === "pen" && this.color === color);
    }
    this.eraserBtn.toggleClass("nsk-active", this.tool === "eraser");
  }

  redraw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of this.strokes) this.paintStroke(s);
  }

  paintStroke(stroke) {
    if (!stroke.points || stroke.points.length < 2) return;
    const ctx = this.ctx;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(stroke.points[0][0], stroke.points[0][1]);
    for (let i = 1; i < stroke.points.length; i++) ctx.lineTo(stroke.points[i][0], stroke.points[i][1]);
    ctx.stroke();
  }

  setupPointerEvents() {
    let drawing = false;
    let current = null;

    const getPos = (evt) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      return [(evt.clientX - rect.left) * scaleX, (evt.clientY - rect.top) * scaleY];
    };

    this.canvas.addEventListener("pointerdown", (evt) => {
      drawing = true;
      this.canvas.setPointerCapture(evt.pointerId);
      if (this.tool === "eraser") {
        this.eraseAt(getPos(evt));
      } else {
        current = { color: this.color, size: this.size, points: [getPos(evt)] };
        this.strokes.push(current);
      }
    });

    this.canvas.addEventListener("pointermove", (evt) => {
      if (!drawing) return;
      if (this.tool === "eraser") {
        this.eraseAt(getPos(evt));
      } else if (current) {
        current.points.push(getPos(evt));
        this.redraw();
      }
    });

    const end = () => {
      drawing = false;
      current = null;
    };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointerleave", end);
  }

  eraseAt(pos) {
    const before = this.strokes.length;
    this.strokes = this.strokes.filter(
      (s) => !s.points.some(([x, y]) => Math.hypot(x - pos[0], y - pos[1]) < ERASE_RADIUS)
    );
    if (this.strokes.length !== before) this.redraw();
  }

  async save() {
    await this.onSave({ width: this.width, height: this.height, strokes: this.strokes });
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------

class NoteSketchSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Note Sketch" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "This plugin was generated entirely by AI (Claude Sonnet 5, Anthropic).",
    });

    new Setting(containerEl)
      .setName("Drawings folder")
      .setDesc("Each drawing is saved as its own file here, referenced by the ```draw block that shows it.")
      .addText((t) =>
        t.setValue(this.plugin.settings.drawingsFolder).onChange(async (v) => {
          this.plugin.settings.drawingsFolder = v.trim() || "Drawings";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Default canvas width")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.defaultWidth)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) this.plugin.settings.defaultWidth = n;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Default canvas height")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.defaultHeight)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n > 0) this.plugin.settings.defaultHeight = n;
          await this.plugin.saveSettings();
        })
      );
  }
}

// ---------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------

module.exports = class NoteSketchPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new NoteSketchSettingTab(this.app, this));

    this.registerMarkdownCodeBlockProcessor("draw", (source, el, ctx) => {
      this.renderBlock(source, el, ctx);
    });

    this.addCommand({
      id: "insert-drawing-block",
      name: "Insert drawing block",
      editorCallback: (editor) => {
        editor.replaceSelection("```draw\n```\n");
      },
    });
  }

  async renderBlock(source, el, ctx) {
    const { path } = parseBlock(source);
    const data = path ? await this.loadDrawingData(path) : null;
    this.paintBlock(el, ctx, path, data);
  }

  async loadDrawingData(path) {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!file) return null;
    try {
      return JSON.parse(await this.app.vault.read(file));
    } catch (e) {
      return null;
    }
  }

  paintBlock(el, ctx, path, data) {
    el.empty();
    el.addClass("nsk-block");

    if (data) {
      const wrap = el.createDiv({ cls: "nsk-display" });
      renderDrawingSvg(wrap, data.width, data.height, data.strokes);
      const editBtn = el.createEl("button", { text: "Edit drawing", cls: "nsk-edit-btn" });
      editBtn.addEventListener("click", () => this.openEditor(el, ctx, path, data));
    } else {
      const placeholder = el.createDiv({ cls: "nsk-placeholder", text: "✏️ Click to start drawing" });
      placeholder.addEventListener("click", () => this.openEditor(el, ctx, path, null));
    }
  }

  openEditor(el, ctx, existingPath, existingData) {
    new DrawModal(this.app, this, existingData, async (result) => {
      let path = existingPath;
      if (!path) {
        const folder = this.settings.drawingsFolder || "Drawings";
        await ensureFolder(this.app, folder);
        path = `${folder}/sketch-${randomId()}.json`;
        await this.app.vault.create(path, JSON.stringify(result));
        await this.updateBlockSource(ctx, el, path);
      } else {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file) await this.app.vault.modify(file, JSON.stringify(result));
        else await this.app.vault.create(path, JSON.stringify(result));
      }
      new Notice("Drawing saved");
      this.paintBlock(el, ctx, path, result);
    }).open();
  }

  async updateBlockSource(ctx, el, path) {
    const info = ctx.getSectionInfo(el);
    if (!info) return;
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!file) return;
    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const newLines = ["```draw", `path: ${path}`, "```"];
    lines.splice(info.lineStart, info.lineEnd - info.lineStart + 1, ...newLines);
    await this.app.vault.modify(file, lines.join("\n"));
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};
