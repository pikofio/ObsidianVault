// This plugin was generated entirely by AI: Claude Sonnet 5 (Anthropic),
// model id "claude-sonnet-5", via Claude Code, at the request of the vault owner.
const { Plugin, EditorSuggest, PluginSettingTab, Setting } = require("obsidian");

// Template syntax: ${1:default}, ${2:default}, ... mark tab stops, in the
// order you Tab through them. Plain text with no ${...} markers just gets
// inserted with the cursor placed at the end (used for single symbols).
const DEFAULT_SETTINGS = {
  snippets: [
    { id: "frac", trigger: "frac", label: "Fraction", template: "\\frac{${1:a}}{${2:b}}" },
    { id: "sqrt", trigger: "sqrt", label: "Square root", template: "\\sqrt{${1:x}}" },
    { id: "nthroot", trigger: "nthroot", label: "Nth root", template: "\\sqrt[${1:n}]{${2:x}}" },
    { id: "sum", trigger: "sum", label: "Summation", template: "\\sum_{${1:i=1}}^{${2:n}} " },
    { id: "prod", trigger: "prod", label: "Product", template: "\\prod_{${1:i=1}}^{${2:n}} " },
    { id: "int", trigger: "int", label: "Integral", template: "\\int_{${1:a}}^{${2:b}} ${3:f(x)}\\, dx" },
    { id: "lim", trigger: "lim", label: "Limit", template: "\\lim_{${1:x \\to 0}} " },
    { id: "vec", trigger: "vec", label: "Vector", template: "\\vec{${1:v}}" },
    { id: "hat", trigger: "hat", label: "Hat / unit vector", template: "\\hat{${1:n}}" },
    { id: "abs", trigger: "abs", label: "Absolute value", template: "|${1:x}|" },
    { id: "sub", trigger: "sub", label: "Subscript", template: "_{${1:i}}" },
    { id: "sup", trigger: "sup", label: "Superscript", template: "^{${1:n}}" },
    {
      id: "matrix",
      trigger: "matrix",
      label: "2x2 matrix",
      template: "\\begin{pmatrix} ${1:a} & ${2:b} \\\\ ${3:c} & ${4:d} \\end{pmatrix}",
    },
    {
      id: "cases",
      trigger: "cases",
      label: "Cases",
      template: "\\begin{cases} ${1:a} & ${2:x < 0} \\\\ ${3:b} & ${4:otherwise} \\end{cases}",
    },
    { id: "alpha", trigger: "alpha", label: "α alpha", template: "\\alpha " },
    { id: "beta", trigger: "beta", label: "β beta", template: "\\beta " },
    { id: "gamma", trigger: "gamma", label: "γ gamma", template: "\\gamma " },
    { id: "delta", trigger: "delta", label: "δ delta", template: "\\delta " },
    { id: "theta", trigger: "theta", label: "θ theta", template: "\\theta " },
    { id: "lambda", trigger: "lambda", label: "λ lambda", template: "\\lambda " },
    { id: "mu", trigger: "mu", label: "μ mu", template: "\\mu " },
    { id: "pi", trigger: "pi", label: "π pi", template: "\\pi " },
    { id: "sigma", trigger: "sigma", label: "σ sigma", template: "\\sigma " },
    { id: "phi", trigger: "phi", label: "φ phi", template: "\\phi " },
    { id: "omega", trigger: "omega", label: "ω omega", template: "\\omega " },
    { id: "inf", trigger: "inf", label: "∞ infinity", template: "\\infty " },
    { id: "neq", trigger: "neq", label: "≠ not equal", template: "\\neq " },
    { id: "leq", trigger: "leq", label: "≤ less-or-equal", template: "\\leq " },
    { id: "geq", trigger: "geq", label: "≥ greater-or-equal", template: "\\geq " },
    { id: "approx", trigger: "approx", label: "≈ approx", template: "\\approx " },
    { id: "cdot", trigger: "cdot", label: "· cdot", template: "\\cdot " },
    { id: "times", trigger: "times", label: "× times", template: "\\times " },
  ],
};

function parseTemplate(template) {
  const re = /\$\{(\d+)(?::([^}]*))?\}/g;
  const positions = [];
  let lastIndex = 0;
  let m;
  while ((m = re.exec(template))) {
    positions.push({ literal: template.slice(lastIndex, m.index), default: m[2] || "" });
    lastIndex = re.lastIndex;
  }
  return { positions, tail: template.slice(lastIndex) };
}

function advancePos(pos, str) {
  const idx = str.lastIndexOf("\n");
  if (idx === -1) return { line: pos.line, ch: pos.ch + str.length };
  const linesAdded = (str.match(/\n/g) || []).length;
  return { line: pos.line + linesAdded, ch: str.length - idx - 1 };
}

function previewOf(template) {
  return template.replace(/\$\{(\d+)(?::([^}]*))?\}/g, (_, n, def) => def || "");
}

function countUnescapedDollars(str) {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "$" && str[i - 1] !== "\\") count++;
  }
  return count;
}

// Inline math ($...$) doesn't cross lines in normal use, so an odd number of
// unescaped $ before the cursor on the current line means we're inside one.
function isInsideInlineMath(editor, pos) {
  const line = editor.getLine(pos.line);
  return countUnescapedDollars(line.slice(0, pos.ch)) % 2 === 1;
}

function insertSnippet(plugin, editor, start, end, template) {
  const wrapped = isInsideInlineMath(editor, start) ? template : `$${template}$`;
  const { positions, tail } = parseTemplate(wrapped);
  const fullText = positions.map((p) => p.literal + p.default).join("") + tail;
  editor.replaceRange(fullText, start, end);

  if (positions.length === 0) {
    editor.setCursor(advancePos(start, fullText));
    plugin.snippetSession = null;
    return;
  }

  let pos = { line: start.line, ch: start.ch };
  pos = advancePos(pos, positions[0].literal);
  const firstStart = { line: pos.line, ch: pos.ch };
  pos = advancePos(pos, positions[0].default);
  const firstEnd = { line: pos.line, ch: pos.ch };

  editor.setSelection(firstStart, firstEnd);

  plugin.snippetSession = {
    index: 0,
    total: positions.length,
    // gaps[k] = literal text right after stop k, leading into stop k+1 (or the tail after the last stop)
    gaps: positions.slice(1).map((p) => p.literal).concat([tail]),
    nextDefaults: positions.slice(1).map((p) => p.default),
  };
}

class MathSnippetSuggest extends EditorSuggest {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;

    this.scope.register([], " ", (evt) => {
      const suggestions = this.suggestions;
      if (suggestions && typeof suggestions.useSelectedItem === "function") {
        suggestions.useSelectedItem(evt);
        return false;
      }
      return true;
    });
  }

  onTrigger(cursor, editor) {
    const line = editor.getLine(cursor.line);
    const sub = line.slice(0, cursor.ch);
    const match = sub.match(/(?<!:)::([A-Za-z0-9]*)$/);
    if (!match) return null;
    return {
      start: { line: cursor.line, ch: cursor.ch - match[0].length },
      end: cursor,
      query: match[1],
    };
  }

  getSuggestions(context) {
    const query = context.query.toLowerCase();
    return this.plugin.settings.snippets.filter(
      (s) => s.trigger && (query === "" || s.trigger.toLowerCase().startsWith(query))
    );
  }

  renderSuggestion(item, el) {
    el.addClass("math-snippet-suggestion-item");
    el.createSpan({ text: item.label, cls: "math-snippet-suggestion-label" });
    el.createEl("code", { text: previewOf(item.template), cls: "math-snippet-suggestion-trigger" });
  }

  selectSuggestion(item) {
    const { editor, start, end } = this.context;
    insertSnippet(this.plugin, editor, start, end, item.template);
    this.close();
  }
}

class MathSnippetSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Math Snippets" });
    containerEl.createEl("p", {
      text:
        "Type :: anywhere to search and insert a LaTeX snippet, then press Tab to jump through its placeholders. " +
        "If the cursor isn't already inside inline math, the snippet is automatically wrapped in $...$. " +
        "Templates use ${1:default}, ${2:default}, ... for tab stops, numbered in the order you want to Tab through " +
        "them; plain text with no ${...} is a single symbol with no stops.",
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "This plugin was generated entirely by AI (Claude Sonnet 5, Anthropic).",
    });

    this.plugin.settings.snippets.forEach((snip, index) => {
      const setting = new Setting(containerEl);
      setting.settingEl.addClass("math-snippet-row");

      setting.addText((text) =>
        text
          .setPlaceholder("trigger")
          .setValue(snip.trigger)
          .onChange(async (value) => {
            snip.trigger = value.trim();
            await this.plugin.saveSettings();
          })
      );

      setting.addText((text) =>
        text
          .setPlaceholder("label")
          .setValue(snip.label)
          .onChange(async (value) => {
            snip.label = value;
            await this.plugin.saveSettings();
          })
      );

      setting.addText((text) =>
        text
          .setPlaceholder("template, e.g. \\frac{${1:a}}{${2:b}}")
          .setValue(snip.template)
          .onChange(async (value) => {
            snip.template = value;
            await this.plugin.saveSettings();
          })
      );

      setting.addExtraButton((btn) =>
        btn
          .setIcon("trash")
          .setTooltip("Remove")
          .onClick(async () => {
            this.plugin.settings.snippets.splice(index, 1);
            await this.plugin.saveSettings();
            this.display();
          })
      );
    });

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("Add snippet").onClick(async () => {
        this.plugin.settings.snippets.push({
          id: `snip-${Date.now()}`,
          trigger: "",
          label: "New snippet",
          template: "",
        });
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }
}

module.exports = class MathSnippetsPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.snippetSession = null;

    this.addSettingTab(new MathSnippetSettingTab(this.app, this));
    this.registerEditorSuggest(new MathSnippetSuggest(this));

    // Tab/Escape need to work while the user is filling in a snippet's
    // placeholders, which happens *after* the search popup has already
    // closed - so this is a plain global key listener, not part of the
    // EditorSuggest above.
    this.registerDomEvent(
      document,
      "keydown",
      (evt) => {
        if (!this.snippetSession) return;
        if (evt.key === "Tab") {
          this.handleTab(evt);
        } else if (evt.key === "Escape") {
          this.snippetSession = null;
        }
      },
      true
    );
  }

  handleTab(evt) {
    const session = this.snippetSession;
    const info = this.app.workspace.activeEditor;
    const editor = info && info.editor;
    if (!editor) {
      this.snippetSession = null;
      return;
    }

    evt.preventDefault();

    const cursorEnd = editor.getCursor("to");
    const gap = session.gaps[session.index];
    const nextStart = advancePos(cursorEnd, gap);
    const nextOrdinal = session.index + 1;

    if (nextOrdinal < session.total) {
      const nextDefault = session.nextDefaults[session.index];
      const nextEnd = advancePos(nextStart, nextDefault);
      editor.setSelection(nextStart, nextEnd);
      session.index += 1;
    } else {
      editor.setCursor(nextStart);
      this.snippetSession = null;
    }
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    if (!Array.isArray(this.settings.snippets) || this.settings.snippets.length === 0) {
      this.settings.snippets = DEFAULT_SETTINGS.snippets;
    }
    // "inline"/"block" wrapper snippets are obsolete now that inline math is
    // auto-detected and auto-wrapped; drop any left over from an earlier save.
    this.settings.snippets = this.settings.snippets.filter((s) => s.id !== "inline" && s.id !== "block");
    // the "graph" snippet (and its math-plot companion plugin) were removed
    this.settings.snippets = this.settings.snippets.filter((s) => s.id !== "graph");
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};
