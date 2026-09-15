// This plugin was generated entirely by AI: Claude Sonnet 5 (Anthropic),
// model id "claude-sonnet-5", via Claude Code, at the request of the vault owner.
const { Plugin, EditorSuggest, PluginSettingTab, Setting } = require("obsidian");

const DEFAULT_SETTINGS = {
  // typing ;<prefix>w<cols>h<rows>  (e.g. ;tw4h3) inserts a table
  tablePrefix: "t",
  lastHeadingLevel: 1,
  // folders (or specific notes) excluded from the ;wl heading-link search
  linkBlacklistFolders: [],
  snippets: [
    { id: "tip", trigger: "t", label: "Tip callout", type: "callout", value: "tip" },
    { id: "question", trigger: "q", label: "Question callout", type: "callout", value: "question" },
    { id: "note", trigger: "n", label: "Note callout", type: "callout", value: "note" },
    { id: "warning", trigger: "w", label: "Warning callout", type: "callout", value: "warning" },
    { id: "h1", trigger: "1", label: "Heading 1", type: "heading", value: 1 },
    { id: "h2", trigger: "2", label: "Heading 2", type: "heading", value: 2 },
    { id: "h3", trigger: "3", label: "Heading 3", type: "heading", value: 3 },
    { id: "h4", trigger: "4", label: "Heading 4", type: "heading", value: 4 },
    { id: "h5", trigger: "5", label: "Heading 5", type: "heading", value: 5 },
    { id: "h6", trigger: "6", label: "Heading 6", type: "heading", value: 6 },
    { id: "last-heading", trigger: "0", label: "Last used heading", type: "last-heading", value: null },
    { id: "bullet", trigger: "b", label: "Bullet list", type: "list", value: "- " },
    { id: "ordered", trigger: "o", label: "Numbered list", type: "list", value: "1. " },
    { id: "checkbox", trigger: "c", label: "Checkbox list", type: "list", value: "- [ ] " },
    { id: "mdlink", trigger: "l", label: "Link", type: "template", value: "[{{cursor}}]()" },
    { id: "wikilink", trigger: "wl", label: "Link to heading", type: "heading-link", value: null },
    { id: "embed", trigger: "e", label: "Embed", type: "template", value: "![[{{cursor}}]]" },
    { id: "image", trigger: "i", label: "Image", type: "template", value: "![{{cursor}}]()" },
    { id: "filelink", trigger: "f", label: "File link", type: "template", value: "[[{{cursor}}]]" },
    { id: "draw", trigger: "draw", label: "Drawing block", type: "template", value: "```draw\n```" },
  ],
};

// ids added after the initial release, backfilled into existing installs by loadSettings()
const BACKFILL_IDS = ["last-heading", "mdlink", "wikilink", "embed", "image", "filelink", "draw"];

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBlacklisted(path, folders) {
  if (!folders || folders.length === 0) return false;
  return folders.some((f) => path === f || path.startsWith(f.endsWith("/") ? f : f + "/"));
}

function templateInsert(value) {
  const marker = "{{cursor}}";
  const idx = value.indexOf(marker);
  if (idx === -1) return { text: value, cursorOffset: value.length };
  return { text: value.slice(0, idx) + value.slice(idx + marker.length), cursorOffset: idx };
}

function buildTable(cols, rows) {
  const cell = "  ";
  const line = (n) => "|" + Array.from({ length: n }, () => cell).join("|") + "|";
  const divider = "|" + Array.from({ length: cols }, () => " --- ").join("|") + "|";
  const lines = [line(cols), divider];
  for (let i = 0; i < rows; i++) lines.push(line(cols));
  return lines.join("\n");
}

function snippetText(snip) {
  if (snip.type === "callout") return `> [!${snip.value}] `;
  if (snip.type === "heading") return `${"#".repeat(Math.max(1, Math.min(6, Number(snip.value) || 1)))} `;
  return String(snip.value ?? "");
}

class SnippetSuggest extends EditorSuggest {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;

    // Enter is handled natively by EditorSuggest; also allow Space to confirm
    // so ";t " and ";tw4h3 " work the same as pressing Enter.
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
    // Semicolon must start the token: beginning of line, after whitespace,
    // or after a blockquote marker (so it also works nested inside callouts).
    const match = sub.match(/(^|[\s>])(;([A-Za-z0-9]*))$/);
    if (!match) return null;
    const query = match[3];

    // Defer to HeadingLinkSuggest once its full trigger is typed (e.g. ";wl") -
    // it takes over from here with free-text search, so don't also pop this up.
    const headingLinkTrigger = this.plugin.settings.snippets.find((s) => s.type === "heading-link");
    if (headingLinkTrigger && headingLinkTrigger.trigger && query === headingLinkTrigger.trigger) {
      return null;
    }

    const semicolonCh = cursor.ch - match[2].length;
    return {
      start: { line: cursor.line, ch: semicolonCh },
      end: cursor,
      query,
    };
  }

  getSuggestions(context) {
    const query = context.query.toLowerCase();
    const items = [];

    for (const snip of this.plugin.settings.snippets) {
      if (!snip.trigger || snip.type === "heading-link") continue;
      if (query !== "" && !snip.trigger.toLowerCase().startsWith(query)) continue;

      if (snip.type === "last-heading") {
        const level = Math.max(1, Math.min(6, Number(this.plugin.settings.lastHeadingLevel) || 1));
        items.push({
          label: `${snip.label || "Last used heading"} (H${level})`,
          display: `;${snip.trigger}`,
          apply: (editor, start, end) => {
            const text = `${"#".repeat(level)} `;
            editor.replaceRange(text, start, end);
            editor.setCursor({ line: start.line, ch: start.ch + text.length });
            this.plugin.recordLastAction(text, text.length);
          },
        });
        continue;
      }

      if (snip.type === "template") {
        const { text, cursorOffset } = templateInsert(String(snip.value ?? ""));
        items.push({
          label: snip.label || snip.trigger,
          display: `;${snip.trigger}`,
          apply: (editor, start, end) => {
            editor.replaceRange(text, start, end);
            editor.setCursor({ line: start.line, ch: start.ch + cursorOffset });
            this.plugin.recordLastAction(text, cursorOffset);
          },
        });
        continue;
      }

      items.push({
        label: snip.label || snip.trigger,
        display: `;${snip.trigger}`,
        apply: (editor, start, end) => {
          const text = snippetText(snip);
          editor.replaceRange(text, start, end);
          editor.setCursor({ line: start.line, ch: start.ch + text.length });
          this.plugin.recordLastAction(text, text.length);
          if (snip.type === "heading") {
            this.plugin.settings.lastHeadingLevel = Number(snip.value) || 1;
            this.plugin.saveSettings();
          }
        },
      });
    }

    const prefix = (this.plugin.settings.tablePrefix || "t").toLowerCase();
    if (query.startsWith(prefix)) {
      const rest = query.slice(prefix.length);
      const tableMatch = rest.match(/^w(\d{1,2})h(\d{1,3})$/);
      if (tableMatch) {
        const cols = parseInt(tableMatch[1], 10);
        const rows = parseInt(tableMatch[2], 10);
        if (cols > 0 && rows > 0) {
          items.push({
            label: `Table ${cols}×${rows}`,
            display: `;${query}`,
            apply: (editor, start, end) => {
              const text = buildTable(cols, rows);
              editor.replaceRange(text, start, end);
              const cellCh = start.ch + 2;
              editor.setCursor({ line: start.line, ch: cellCh });
              this.plugin.recordLastAction(text, 2);
            },
          });
        }
      }
    }

    return items;
  }

  renderSuggestion(item, el) {
    el.addClass("callout-snippet-suggestion-item");
    el.createSpan({ text: item.label, cls: "callout-snippet-suggestion-label" });
    el.createEl("code", { text: item.display, cls: "callout-snippet-suggestion-trigger" });
  }

  selectSuggestion(item) {
    const { editor, start, end } = this.context;
    item.apply(editor, start, end);
    this.close();
  }
}

class HeadingLinkSuggest extends EditorSuggest {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.level = 1;

    this.scope.register([], "ArrowLeft", () => {
      this.level = Math.max(1, this.level - 1);
      this.refresh();
      return false;
    });
    this.scope.register([], "ArrowRight", () => {
      this.level = Math.min(6, this.level + 1);
      this.refresh();
      return false;
    });
  }

  refresh() {
    if (!this.context) return;
    const items = this.getSuggestions(this.context);
    if (this.suggestions && typeof this.suggestions.setSuggestions === "function") {
      this.suggestions.setSuggestions(items);
    }
  }

  getTriggerSnippet() {
    return this.plugin.settings.snippets.find((s) => s.type === "heading-link");
  }

  onTrigger(cursor, editor) {
    const snip = this.getTriggerSnippet();
    if (!snip || !snip.trigger) return null;

    const line = editor.getLine(cursor.line);
    const sub = line.slice(0, cursor.ch);
    const escaped = escapeRegExp(snip.trigger);
    const re = new RegExp(`(^|[\\s>])(;${escaped}(.*))$`);
    const match = sub.match(re);
    if (!match) return null;

    const semicolonCh = cursor.ch - match[2].length;
    return {
      start: { line: cursor.line, ch: semicolonCh },
      end: cursor,
      query: match[3],
    };
  }

  getSuggestions(context) {
    const raw = context.query;
    const spaceIdx = raw.indexOf(" ");
    // ";wl<text>" filters by heading text. ";wl <text>" (a space right after
    // the trigger, or after the heading text) switches to filtering by the
    // note's path instead - handy when you know the note but not the wording.
    const headingQuery = (spaceIdx === -1 ? raw : raw.slice(0, spaceIdx)).trim().toLowerCase();
    const noteQuery = spaceIdx === -1 ? null : raw.slice(spaceIdx + 1).trim().toLowerCase();

    const results = [];
    const blacklist = this.plugin.settings.linkBlacklistFolders || [];
    for (const file of this.plugin.app.vault.getMarkdownFiles()) {
      if (isBlacklisted(file.path, blacklist)) continue;
      if (noteQuery && !file.path.toLowerCase().includes(noteQuery)) continue;
      const cache = this.plugin.app.metadataCache.getFileCache(file);
      if (!cache || !cache.headings) continue;
      for (const heading of cache.headings) {
        if (heading.level !== this.level) continue;
        if (headingQuery && !heading.heading.toLowerCase().includes(headingQuery)) continue;
        results.push({ file, heading: heading.heading });
        if (results.length >= 50) return results;
      }
    }
    return results;
  }

  renderSuggestion(item, el) {
    el.addClass("callout-snippet-suggestion-item");
    el.createSpan({ text: item.heading, cls: "callout-snippet-suggestion-label" });
    el.createEl("code", {
      text: `H${this.level} · ${item.file.basename}`,
      cls: "callout-snippet-suggestion-trigger",
    });
  }

  selectSuggestion(item) {
    const { editor, start, end } = this.context;
    const activeFile = this.plugin.app.workspace.getActiveFile();
    const text =
      activeFile && item.file.path === activeFile.path
        ? `[[#${item.heading}]]`
        : `[[${this.plugin.app.metadataCache.fileToLinktext(item.file, activeFile ? activeFile.path : "", true)}#${item.heading}]]`;
    editor.replaceRange(text, start, end);
    editor.setCursor({ line: start.line, ch: start.ch + text.length });
    this.plugin.recordLastAction(text, text.length);
    this.close();
  }
}

class SnippetSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Callout Snippets" });
    containerEl.createEl("p", {
      text: "Type ; anywhere in the editor to open the snippet search, keep typing to filter, then press Enter or Space to confirm.",
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "This plugin was generated entirely by AI (Claude Sonnet 5, Anthropic).",
    });

    new Setting(containerEl)
      .setName("Table trigger prefix")
      .setDesc("Typing ;<prefix>w<cols>h<rows>, e.g. ;tw4h3, inserts a 4-column, 3-row table.")
      .addText((text) =>
        text.setValue(this.plugin.settings.tablePrefix).onChange(async (value) => {
          this.plugin.settings.tablePrefix = value.trim() || "t";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Blacklisted folders (link search)")
      .setDesc(
        "Comma-separated folder or note paths to exclude from the ;wl heading-link search (e.g. Templates, Archive/Old). " +
          "Only affects that vault-wide search - it can't filter Obsidian's own native [[ suggester used by ;f and ;e."
      )
      .addTextArea((text) =>
        text.setValue((this.plugin.settings.linkBlacklistFolders || []).join(", ")).onChange(async (value) => {
          this.plugin.settings.linkBlacklistFolders = value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Snippets" });

    this.plugin.settings.snippets.forEach((snip, index) => {
      const setting = new Setting(containerEl);
      setting.settingEl.addClass("callout-snippet-row");

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

      setting.addDropdown((drop) =>
        drop
          .addOption("callout", "Callout")
          .addOption("heading", "Heading")
          .addOption("last-heading", "Last used heading (dynamic)")
          .addOption("list", "List / text")
          .addOption("template", "Link / template")
          .addOption("heading-link", "Link to heading (search, dynamic)")
          .setValue(snip.type)
          .onChange(async (value) => {
            snip.type = value;
            await this.plugin.saveSettings();
            this.display();
          })
      );

      setting.addText((text) =>
        text
          .setPlaceholder(
            snip.type === "heading"
              ? "level 1-6"
              : snip.type === "callout"
              ? "callout type"
              : snip.type === "last-heading"
              ? "(auto - unused)"
              : snip.type === "template"
              ? "e.g. [{{cursor}}]()"
              : snip.type === "heading-link"
              ? "(auto - unused)"
              : "text to insert"
          )
          .setValue(snip.type === "last-heading" || snip.type === "heading-link" ? "" : String(snip.value))
          .setDisabled(snip.type === "last-heading" || snip.type === "heading-link")
          .onChange(async (value) => {
            snip.value = snip.type === "heading" ? Math.max(1, Math.min(6, parseInt(value, 10) || 1)) : value;
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
          type: "list",
          value: "",
        });
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }
}

module.exports = class CalloutSnippetsPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.lastAction = null;
    this.addSettingTab(new SnippetSettingTab(this.app, this));
    this.registerEditorSuggest(new HeadingLinkSuggest(this));
    this.registerEditorSuggest(new SnippetSuggest(this));

    // Typing ;; repeats whatever the last confirmed snippet inserted.
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor) => {
        if (!this.lastAction) return;
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const beforeCursor = line.slice(0, cursor.ch);
        if (!/(^|[\s>]);;$/.test(beforeCursor)) return;

        const start = { line: cursor.line, ch: cursor.ch - 2 };
        editor.replaceRange(this.lastAction.text, start, cursor);
        editor.setCursor({ line: start.line, ch: start.ch + this.lastAction.cursorOffset });
      })
    );
  }

  recordLastAction(text, cursorOffset) {
    this.lastAction = { text, cursorOffset };
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    if (!Array.isArray(this.settings.snippets) || this.settings.snippets.length === 0) {
      this.settings.snippets = DEFAULT_SETTINGS.snippets;
    }
    if (typeof this.settings.lastHeadingLevel !== "number") {
      this.settings.lastHeadingLevel = 1;
    }
    for (const id of BACKFILL_IDS) {
      if (!this.settings.snippets.some((s) => s.id === id)) {
        const def = DEFAULT_SETTINGS.snippets.find((s) => s.id === id);
        if (def) this.settings.snippets.push({ ...def });
      }
    }
    // Upgrade path: the wikilink snippet used to be a plain "[[]]" template;
    // it's now the dynamic heading-search link. Keep the user's trigger/label,
    // just fix the mechanism.
    const wikilink = this.settings.snippets.find((s) => s.id === "wikilink");
    if (wikilink && wikilink.type !== "heading-link") {
      wikilink.type = "heading-link";
      wikilink.value = null;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};
