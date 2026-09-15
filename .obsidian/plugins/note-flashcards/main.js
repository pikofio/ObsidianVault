// This plugin was generated entirely by AI: Claude Sonnet 5 (Anthropic),
// model id "claude-sonnet-5", via Claude Code, at the request of the vault owner.
const {
  Plugin,
  ItemView,
  PluginSettingTab,
  Setting,
  Notice,
  MarkdownRenderer,
  FuzzySuggestModal,
  Modal,
} = require("obsidian");

// CodeMirror 6 packages Obsidian exposes to plugins, used only to visually
// hide our own "^nfc-..." block-id markers in Source/Live Preview. Wrapped
// in a try/catch so the rest of the plugin still works if this ever isn't
// available - the block-id text would just stay visible as a fallback.
let CM6 = null;
try {
  CM6 = { view: require("@codemirror/view"), state: require("@codemirror/state") };
} catch (e) {
  CM6 = null;
}

const VIEW_TYPE_CREATE = "note-flashcards-create";
const VIEW_TYPE_REVIEW = "note-flashcards-review";
const DAY_MS = 24 * 60 * 60 * 1000;
const BLOCK_ID_PREFIX = "nfc-";

const DEFAULT_DATA = {
  settings: {
    cardsFolder: "Flashcards",
    folderFilter: [], // which SOURCE note folders to review from; empty = all notes
    newCardsPerDay: 20,
    intervals: { again: 0.007, hard: 1, good: 3, easy: 7 }, // days
    easeStart: 2.5,
    easeMin: 1.3,
    showBlockIds: false,
  },
  cards: [],
};

// ---------------------------------------------------------------------
// hide "^nfc-..." block-id markers in the editor (Source + Live Preview;
// Reading view already hides block references natively, no work needed there)
// ---------------------------------------------------------------------

// Returns { extension, effect } or null. `extension` is what gets registered
// with the editor; dispatching `effect.of(true/false)` to a live EditorView
// (via `editor.cm`) toggles visibility instantly in that editor. New editors
// pick up the plugin's current setting automatically via the field's create().
function buildHideBlockIdExtension(plugin) {
  if (!CM6) return null;
  try {
    const { ViewPlugin, Decoration, WidgetType, EditorView } = CM6.view;
    const { RangeSetBuilder, StateField, StateEffect } = CM6.state;

    class HiddenWidget extends WidgetType {
      toDOM() {
        return document.createElement("span");
      }
      eq() {
        return true;
      }
      ignoreEvent() {
        return true;
      }
    }

    const showEffect = StateEffect.define();
    const showField = StateField.define({
      create: () => !!plugin.data.settings.showBlockIds,
      update: (value, tr) => {
        for (const e of tr.effects) if (e.is(showEffect)) value = e.value;
        return value;
      },
    });

    // Legacy paragraph-level block reference ("^nfc-xxxxx", with the space
    // before it swallowed so hiding it doesn't leave a stray trailing space)
    // and the precise per-selection wrap markers ("%%nfc-qs-xxxxx%%" etc).
    const idRegex = new RegExp(
      `[ \\t]*\\^${BLOCK_ID_PREFIX}[a-zA-Z0-9]+|%%${BLOCK_ID_PREFIX}(?:qs|qe|as|ae)-[a-zA-Z0-9]+%%`,
      "g"
    );

    function extractTokens(text) {
      const re = new RegExp(`\\^${BLOCK_ID_PREFIX}[a-zA-Z0-9]+|%%${BLOCK_ID_PREFIX}(?:qs|qe|as|ae)-[a-zA-Z0-9]+%%`, "g");
      return text.match(re) || [];
    }

    // Tokens we've warned about deleting, so a later reappearance (typically
    // Ctrl+Z) can be recognized as a genuine restore rather than mistaken for
    // a brand-new marker from creating a different card.
    const recentlyDeleted = new Set();

    // Only inspects the text each change chunk actually touched (not the
    // whole document), so this stays cheap regardless of note size.
    function checkMarkerChanges(update) {
      let deletedCount = 0;
      let restoredCount = 0;
      update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const removedIds = toA > fromA ? extractTokens(update.startState.doc.sliceString(fromA, toA)) : [];
        const insertedIds = extractTokens(inserted.toString());
        const removedSet = new Set(removedIds);
        const insertedSet = new Set(insertedIds);

        for (const id of removedIds) {
          if (!insertedSet.has(id)) {
            deletedCount++;
            recentlyDeleted.add(id);
          }
        }
        for (const id of insertedIds) {
          if (!removedSet.has(id) && recentlyDeleted.has(id)) {
            restoredCount++;
            recentlyDeleted.delete(id);
          }
        }
      });

      if (deletedCount > 0) {
        new Notice(
          `Deleted ${deletedCount} flashcard sync marker${deletedCount > 1 ? "s" : ""} — ` +
            `linked card(s) will no longer sync precisely from this spot. Ctrl+Z to undo if that wasn't intended.`
        );
      }
      if (restoredCount > 0) {
        new Notice(
          `Restored ${restoredCount} flashcard sync marker${restoredCount > 1 ? "s" : ""} — ` +
            `linked card(s) will sync precisely from this spot again.`
        );
      }
    }

    function build(view) {
      const builder = new RangeSetBuilder();
      if (view.state.field(showField)) return builder.finish();
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        idRegex.lastIndex = 0;
        let match;
        while ((match = idRegex.exec(text))) {
          const start = from + match.index;
          const end = start + match[0].length;
          builder.add(start, end, Decoration.replace({ widget: new HiddenWidget() }));
        }
      }
      return builder.finish();
    }

    const viewPlugin = ViewPlugin.fromClass(
      class {
        constructor(view) {
          this.decorations = build(view);
        }
        update(update) {
          if (update.docChanged) checkMarkerChanges(update);
          if (
            update.docChanged ||
            update.viewportChanged ||
            update.startState.field(showField) !== update.state.field(showField)
          ) {
            this.decorations = build(update.view);
          }
        }
      },
      { decorations: (v) => v.decorations }
    );

    // Makes arrow keys (and Home/End, word jumps, etc.) treat a hidden marker
    // as one indivisible unit instead of letting the cursor land in the
    // middle of text that isn't even visible. No-op while markers are shown.
    const atomicHidden = EditorView.atomicRanges.of((view) => {
      const instance = view.plugin(viewPlugin);
      return instance ? instance.decorations : Decoration.none;
    });

    return { extension: [showField, viewPlugin, atomicHidden], effect: showEffect };
  } catch (e) {
    console.warn("note-flashcards: could not build block-id hiding extension", e);
    return null;
  }
}

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

async function renderMd(app, component, text, el, sourcePath) {
  el.empty();
  if (typeof MarkdownRenderer.render === "function") {
    await MarkdownRenderer.render(app, text || "", el, sourcePath || "", component);
  } else if (typeof MarkdownRenderer.renderMarkdown === "function") {
    await MarkdownRenderer.renderMarkdown(text || "", el, sourcePath || "", component);
  } else {
    el.setText(text || "");
  }
}

// Attaches a single delegated click handler to a container that keeps being
// re-rendered (via renderMd) so internal links inside it navigate correctly,
// even though their actual DOM nodes get replaced on every re-render.
function attachLinkNavigation(app, el, getSourcePath) {
  el.addEventListener("click", (evt) => {
    const anchor = evt.target.closest("a.internal-link");
    if (!anchor) return;
    evt.preventDefault();
    const href = anchor.getAttribute("data-href") || anchor.getAttribute("href");
    if (!href) return;
    app.workspace.openLinkText(href, getSourcePath() || "", evt.ctrlKey || evt.metaKey);
  });
}

function randomId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function slugify(text, maxLen) {
  const cleaned = text
    .replace(/[\[\]#|^\\/:*?"<>]/g, "")
    .trim()
    .slice(0, maxLen || 40)
    .trim();
  return cleaned || "Card";
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

async function openNotePath(app, path) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) {
    new Notice(`Note not found: ${path}`);
    return;
  }
  await app.workspace.getLeaf(false).openFile(file);
}

// Precise per-character markers wrapping exactly a question/answer selection,
// using Obsidian's native %%comment%% syntax (already invisible in Reading
// view for free) plus our own CM6 decoration to hide it in Source/Live
// Preview too. role is "q" or "a", edge is "s" (start) or "e" (end).
function markerTag(role, edge, id) {
  return `%%${BLOCK_ID_PREFIX}${role}${edge}-${id}%%`;
}

// Applies several {offset, text} insertions to `text` in one pass, without
// the earlier insertions' offsets shifting under the later ones.
function insertMarkers(text, insertions) {
  const sorted = insertions.slice().sort((a, b) => b.offset - a.offset);
  let result = text;
  for (const { offset, text: insertText } of sorted) {
    result = result.slice(0, offset) + insertText + result.slice(offset);
  }
  return result;
}

async function readMarkerText(app, filePath, id, role) {
  if (!id) return null;
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!file) return null;
  const content = await app.vault.read(file);
  const start = content.indexOf(markerTag(role, "s", id));
  if (start === -1) return null;
  const contentStart = start + markerTag(role, "s", id).length;
  const end = content.indexOf(markerTag(role, "e", id), contentStart);
  if (end === -1) return null;
  return content.slice(contentStart, end).trim();
}

// Reads the CURRENT text of a block by id, straight from the live file - this
// is what makes "Sync from note" possible. Strips the trailing block-id
// marker itself so it never leaks into card text. Returns null if the note or
// block no longer exists.
async function readBlockText(app, filePath, blockId) {
  if (!blockId) return null;
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!file) return null;
  const cache = app.metadataCache.getFileCache(file);
  const block = cache && cache.blocks && cache.blocks[blockId];
  if (!block) return null;
  const content = await app.vault.read(file);
  const lines = content.split("\n");
  const text = lines.slice(block.position.start.line, block.position.end.line + 1).join("\n");
  return text.replace(/\s*\^[a-zA-Z0-9-]+\s*$/, "").trim();
}

function buildCardNoteContent(question, answer, note, sourceBasename) {
  return (
    `## Question\n${question}\n\n` +
    `## Answer\n${answer}\n\n` +
    (note ? `## Note\n${note}\n\n` : "") +
    `Source: [[${sourceBasename}]]\n`
  );
}

// Strips a card's own sync markers/block references out of its source note,
// leaving everything else untouched. Returns true if the note was modified.
async function removeCardMarkersFromSource(app, card) {
  const file = app.vault.getAbstractFileByPath(card.sourcePath);
  if (!file) return false;

  let content = await app.vault.read(file);
  let changed = false;

  const stripTag = (tag) => {
    if (!content.includes(tag)) return;
    content = content.split(tag).join("");
    changed = true;
  };
  if (card.questionMarkerId) {
    stripTag(markerTag("q", "s", card.questionMarkerId));
    stripTag(markerTag("q", "e", card.questionMarkerId));
  }
  if (card.answerMarkerId) {
    stripTag(markerTag("a", "s", card.answerMarkerId));
    stripTag(markerTag("a", "e", card.answerMarkerId));
  }

  // Legacy paragraph-level block references (ids already include the "nfc-"
  // prefix). Their charset is alnum + "-", so no regex chars need escaping.
  const stripBlockRef = (id) => {
    if (!id) return;
    const re = new RegExp(`[ \\t]*\\^${id}\\b`, "g");
    if (re.test(content)) {
      content = content.replace(re, "");
      changed = true;
    }
  };
  stripBlockRef(card.questionBlockId);
  stripBlockRef(card.answerBlockId);

  if (changed) await app.vault.modify(file, content);
  return changed;
}

// Removes a card from the database, strips its markers out of the source
// note, and trashes its generated card note (if it still exists) - respecting
// the user's configured deletion behavior.
async function deleteCard(app, plugin, card) {
  await removeCardMarkersFromSource(app, card);
  if (card.cardPath) {
    const file = app.vault.getAbstractFileByPath(card.cardPath);
    if (file) await app.fileManager.trashFile(file);
  }
  plugin.data.cards = plugin.data.cards.filter((c) => c.id !== card.id);
  await plugin.savePluginData();
}

// Re-pulls a card's question/answer from their source (marker-wrapped text
// for cards created after precise markers were added, or a whole paragraph
// via the older block-reference for cards created before that) and keeps the
// generated card note file in sync too. Returns { changed, missing }.
async function syncCardFromSource(app, plugin, card) {
  let changed = false;
  let missing = 0;

  async function resolve(field, markerIdField, blockIdField, role) {
    let text;
    if (card[markerIdField]) text = await readMarkerText(app, card.sourcePath, card[markerIdField], role);
    else if (card[blockIdField]) text = await readBlockText(app, card.sourcePath, card[blockIdField]);
    else return;

    if (text === null) missing++;
    else if (text !== card[field]) {
      card[field] = text;
      changed = true;
    }
  }

  await resolve("question", "questionMarkerId", "questionBlockId", "q");
  await resolve("answer", "answerMarkerId", "answerBlockId", "a");

  if (changed) {
    await plugin.savePluginData();
    if (card.cardPath) {
      const file = app.vault.getAbstractFileByPath(card.cardPath);
      if (file) {
        const sourceFile = app.vault.getAbstractFileByPath(card.sourcePath);
        const sourceBasename = sourceFile ? sourceFile.basename : card.sourcePath.split("/").pop().replace(/\.md$/, "");
        await app.vault.modify(file, buildCardNoteContent(card.question, card.answer, card.note, sourceBasename));
      }
    }
  }
  return { changed, missing };
}

function hasSyncAnchor(card) {
  return !!(card.questionMarkerId || card.answerMarkerId || card.questionBlockId || card.answerBlockId);
}

function notifySyncResult(result) {
  if (result.missing > 0) {
    new Notice(
      `⚠ Couldn't find ${result.missing} block reference${result.missing > 1 ? "s" : ""} for this card — ` +
        `it may have been deleted from the source note.`
    );
  } else {
    new Notice(result.changed ? "Card synced from note" : "Already up to date");
  }
}

function matchesFolder(path, filters) {
  if (!filters || filters.length === 0) return true;
  return filters.some((f) => path === f || path.startsWith(f.endsWith("/") ? f : f + "/"));
}

function scheduleCard(card, grade, settings) {
  const now = Date.now();
  card.reps = (card.reps || 0) + 1;

  if (grade === "again") {
    card.ease = Math.max(settings.easeMin, (card.ease || settings.easeStart) - 0.2);
    card.interval = settings.intervals.again;
  } else {
    let ease = card.ease || settings.easeStart;
    if (grade === "hard") ease = Math.max(settings.easeMin, ease - 0.15);
    if (grade === "easy") ease = ease + 0.15;
    card.ease = ease;

    if (card.reps <= 1) {
      card.interval = settings.intervals[grade] || settings.intervals.good;
    } else {
      const prevInterval = card.interval > 0 ? card.interval : settings.intervals.good;
      card.interval = Math.max(prevInterval * ease, settings.intervals[grade] || 1);
    }
  }
  card.dueDate = now + card.interval * DAY_MS;
}

// Wipes a card's scheduling progress (interval/ease/reps) and puts it back
// due immediately, as if it had never been reviewed.
function resetCardSchedule(card, settings) {
  card.interval = 0;
  card.ease = settings.easeStart;
  card.reps = 0;
  card.dueDate = Date.now();
}

class FilePickerModal extends FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Choose a note...");
  }
  getItems() {
    return this.app.vault.getMarkdownFiles();
  }
  getItemText(file) {
    return file.path;
  }
  onChooseItem(file) {
    this.onChoose(file);
  }
}

// Checkbox tree mirroring the vault's actual folder/note structure. Checking
// a folder includes everything inside it; individual notes can also be
// checked on their own for finer-grained scope.
class FolderFilterModal extends Modal {
  constructor(app, initialSelected, onApply, title) {
    super(app);
    this.onApply = onApply;
    this.title = title || "Filter by folder / note";
    this.selected = new Set(initialSelected || []);
  }

  onOpen() {
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nfc-filter-modal");

    contentEl.createEl("h3", { text: this.title });
    contentEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Check the folders or individual notes to include. Checking a folder includes everything inside it, " +
        "so you don't need to also check its notes. Leave everything unchecked to review your whole vault.",
    });

    const treeEl = contentEl.createDiv({ cls: "nfc-tree" });
    this.renderFolder(treeEl, this.app.vault.getRoot(), 0);

    const btnRow = contentEl.createDiv({ cls: "nfc-filter-btns" });
    const clearBtn = btnRow.createEl("button", { text: "Clear all" });
    clearBtn.addEventListener("click", () => {
      this.selected.clear();
      this.render();
    });
    const applyBtn = btnRow.createEl("button", { text: "Apply", cls: "nfc-save-btn" });
    applyBtn.addEventListener("click", () => {
      this.onApply(Array.from(this.selected));
      this.close();
    });
  }

  renderFolder(container, folder, depth) {
    const children = (folder.children || []).slice().sort((a, b) => {
      const aIsFolder = !!a.children;
      const bIsFolder = !!b.children;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const child of children) {
      const isFolder = !!child.children;
      if (!isFolder && child.extension !== "md") continue;

      const row = container.createDiv({ cls: "nfc-tree-row" });
      row.style.paddingLeft = `${depth * 16}px`;

      const checkbox = row.createEl("input", { attr: { type: "checkbox" } });
      checkbox.checked = this.selected.has(child.path);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(child.path);
        else this.selected.delete(child.path);
      });

      row.createSpan({
        text: isFolder ? `${child.name}/` : child.name,
        cls: isFolder ? "nfc-tree-folder" : "nfc-tree-note",
      });

      if (isFolder) this.renderFolder(container, child, depth + 1);
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

// Lets you edit an existing card's question/answer/note text in place. Keeps
// the plugin's card database and the generated card note file in sync.
class EditCardModal extends Modal {
  constructor(app, plugin, card, onSaved) {
    super(app);
    this.plugin = plugin;
    this.card = card;
    this.onSaved = onSaved;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("nfc-edit-modal");

    contentEl.createEl("h3", { text: "Edit card" });
    contentEl.createEl("div", { text: `Source: ${this.card.sourcePath}`, cls: "setting-item-description" });

    contentEl.createEl("label", { text: "Question" });
    this.qInput = contentEl.createEl("textarea", { cls: "nfc-edit-textarea" });
    this.qInput.value = this.card.question;

    contentEl.createEl("label", { text: "Answer" });
    this.aInput = contentEl.createEl("textarea", { cls: "nfc-edit-textarea" });
    this.aInput.value = this.card.answer;

    contentEl.createEl("label", { text: "Note (optional)" });
    this.nInput = contentEl.createEl("textarea", { cls: "nfc-edit-textarea" });
    this.nInput.value = this.card.note || "";

    const btnRow = contentEl.createDiv({ cls: "nfc-filter-btns" });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel" });
    cancelBtn.addEventListener("click", () => this.close());
    const saveBtn = btnRow.createEl("button", { text: "Save", cls: "nfc-save-btn" });
    saveBtn.addEventListener("click", () => this.save());
  }

  async save() {
    const question = this.qInput.value.trim();
    const answer = this.aInput.value.trim();
    const note = this.nInput.value.trim();
    if (!question || !answer) {
      new Notice("Question and answer can't be empty");
      return;
    }

    this.card.question = question;
    this.card.answer = answer;
    this.card.note = note;
    await this.plugin.savePluginData();

    if (this.card.cardPath) {
      const file = this.app.vault.getAbstractFileByPath(this.card.cardPath);
      if (file) {
        const sourceFile = this.app.vault.getAbstractFileByPath(this.card.sourcePath);
        const sourceBasename = sourceFile ? sourceFile.basename : this.card.sourcePath.split("/").pop().replace(/\.md$/, "");
        await this.app.vault.modify(file, buildCardNoteContent(question, answer, note, sourceBasename));
      }
    }

    new Notice("Card updated");
    this.onSaved();
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

// ---------------------------------------------------------------------
// Creation view
// ---------------------------------------------------------------------

class CreateView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.file = null;
    this.rawText = "";
    this.manualPick = false;
    this.pendingQuestion = null;
    this.pendingAnswer = null;
    this.pendingNote = null;
    this.browseSearch = "";
    this.browseFilter = [];
  }

  getViewType() {
    return VIEW_TYPE_CREATE;
  }
  getDisplayText() {
    return "Create flashcards";
  }
  getIcon() {
    return "help-circle";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("nfc-create-view");

    const header = root.createDiv({ cls: "nfc-header" });
    this.fileLabel = header.createDiv({ cls: "nfc-file-label", text: "No note loaded" });
    const btnRow = header.createDiv({ cls: "nfc-header-btns" });
    const pickBtn = btnRow.createEl("button", { text: "Choose note..." });
    pickBtn.addEventListener("click", () => {
      new FilePickerModal(this.app, (file) => {
        this.manualPick = true;
        this.loadFile(file);
      }).open();
    });
    const useActiveBtn = btnRow.createEl("button", { text: "Use active note" });
    useActiveBtn.addEventListener("click", () => {
      this.manualPick = false;
      const active = this.app.workspace.getActiveFile();
      if (active && active.extension === "md") this.loadFile(active);
    });

    root.createEl("div", {
      cls: "nfc-hint",
      text: "Select text below, then mark it as the question or the answer. Repeat to build multiple cards.",
    });

    this.textarea = root.createEl("textarea", { cls: "nfc-source" });
    this.textarea.readOnly = true;

    const markRow = root.createDiv({ cls: "nfc-btn-row" });
    const qBtn = markRow.createEl("button", { text: "Set as Question", cls: "nfc-mark-btn" });
    const aBtn = markRow.createEl("button", { text: "Set as Answer", cls: "nfc-mark-btn" });
    const nBtn = markRow.createEl("button", { text: "Set as Note", cls: "nfc-mark-btn" });
    qBtn.addEventListener("click", () => this.captureSelection("question"));
    aBtn.addEventListener("click", () => this.captureSelection("answer"));
    nBtn.addEventListener("click", () => this.captureSelection("note"));

    this.qBody = this.buildPreview(root, "Question");
    this.aBody = this.buildPreview(root, "Answer");
    this.nBody = this.buildPreview(root, "Note (optional, shown with the answer)");

    const saveRow = root.createDiv({ cls: "nfc-save-row" });
    const saveBtn = saveRow.createEl("button", { text: "Save card", cls: "nfc-save-btn" });
    saveBtn.addEventListener("click", () => this.saveCard());
    const clearBtn = saveRow.createEl("button", { text: "Clear" });
    clearBtn.addEventListener("click", () => this.clearPending());

    const browseHeader = root.createDiv({ cls: "nfc-browse-header" });
    browseHeader.createEl("h4", { text: "Browse cards" });

    const browseBar = root.createDiv({ cls: "nfc-browse-bar" });
    const searchInput = browseBar.createEl("input", {
      cls: "nfc-search-input",
      attr: { type: "search", placeholder: "Search questions, answers, notes..." },
    });
    searchInput.addEventListener("input", () => {
      this.browseSearch = searchInput.value.toLowerCase();
      this.renderCardList();
    });
    const browseFilterBtn = browseBar.createEl("button", { text: "Filter..." });
    browseFilterBtn.addEventListener("click", () => {
      new FolderFilterModal(
        this.app,
        this.browseFilter,
        (selected) => {
          this.browseFilter = selected;
          this.renderCardList();
        },
        "Browse cards by folder / note"
      ).open();
    });

    this.browseFilterSummaryEl = root.createDiv({ cls: "nfc-filter-summary" });

    this.listEl = root.createDiv({ cls: "nfc-list" });

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (this.manualPick) return;
        const active = this.app.workspace.getActiveFile();
        if (active && active.extension === "md" && (!this.file || active.path !== this.file.path)) {
          this.loadFile(active);
        }
      })
    );

    const active = this.app.workspace.getActiveFile();
    if (active && active.extension === "md") await this.loadFile(active);
  }

  buildPreview(root, label) {
    const box = root.createDiv({ cls: "nfc-preview" });
    box.createDiv({ text: label + ":", cls: "nfc-preview-label" });
    return box.createDiv({ cls: "nfc-preview-body" });
  }

  async loadFile(file) {
    this.file = file;
    this.fileLabel.setText(file.path);
    this.rawText = await this.app.vault.read(file);
    this.textarea.value = this.rawText;
    this.clearPending();
    this.renderCardList();
  }

  captureSelection(kind) {
    if (!this.textarea || !this.file) return;
    const start = this.textarea.selectionStart;
    const end = this.textarea.selectionEnd;
    if (start === end) {
      new Notice("Select some text first");
      return;
    }
    const text = this.textarea.value.slice(start, end);
    if (kind === "question") {
      this.pendingQuestion = { text, start, end };
      renderMd(this.app, this, text, this.qBody, this.file.path);
    } else if (kind === "answer") {
      this.pendingAnswer = { text, start, end };
      renderMd(this.app, this, text, this.aBody, this.file.path);
    } else {
      this.pendingNote = { text, start, end };
      renderMd(this.app, this, text, this.nBody, this.file.path);
    }
  }

  clearPending() {
    this.pendingQuestion = null;
    this.pendingAnswer = null;
    this.pendingNote = null;
    if (this.qBody) this.qBody.empty();
    if (this.aBody) this.aBody.empty();
    if (this.nBody) this.nBody.empty();
  }

  async saveCard() {
    if (!this.file) {
      new Notice("Open a note first");
      return;
    }
    if (!this.pendingQuestion || !this.pendingAnswer) {
      new Notice("Set both a question and an answer first");
      return;
    }

    // Wrap exactly the selected question/answer text in a pair of hidden
    // markers, so "Sync from note" can pull their precise current text later
    // - not just whatever paragraph they happened to sit in.
    const questionMarkerId = randomId("");
    const answerMarkerId = randomId("");
    const newSourceText = insertMarkers(this.rawText, [
      { offset: this.pendingQuestion.start, text: markerTag("q", "s", questionMarkerId) },
      { offset: this.pendingQuestion.end, text: markerTag("q", "e", questionMarkerId) },
      { offset: this.pendingAnswer.start, text: markerTag("a", "s", answerMarkerId) },
      { offset: this.pendingAnswer.end, text: markerTag("a", "e", answerMarkerId) },
    ]);
    if (newSourceText !== this.rawText) {
      await this.app.vault.modify(this.file, newSourceText);
      this.rawText = newSourceText;
      this.textarea.value = newSourceText;
    }

    const folder = this.plugin.data.settings.cardsFolder || "Flashcards";
    await ensureFolder(this.app, folder);

    const baseName = slugify(this.pendingQuestion.text, 40);
    const fileName = `${baseName} ${Math.random().toString(36).slice(2, 7)}.md`;
    const path = `${folder}/${fileName}`;
    const noteText = this.pendingNote ? this.pendingNote.text : "";
    const content = buildCardNoteContent(this.pendingQuestion.text, this.pendingAnswer.text, noteText, this.file.basename);
    const cardFile = await this.app.vault.create(path, content);

    const card = {
      id: randomId("c"),
      question: this.pendingQuestion.text,
      answer: this.pendingAnswer.text,
      note: noteText,
      sourcePath: this.file.path,
      cardPath: cardFile.path,
      questionMarkerId,
      answerMarkerId,
      created: Date.now(),
      dueDate: Date.now(),
      interval: 0,
      ease: this.plugin.data.settings.easeStart,
      reps: 0,
    };
    this.plugin.data.cards.push(card);
    await this.plugin.savePluginData();

    new Notice("Card saved");
    this.clearPending();
    this.renderCardList();
  }

  renderCardList() {
    this.listEl.empty();

    const filter = this.browseFilter || [];
    this.browseFilterSummaryEl.setText(filter.length ? `Filter: ${filter.join(", ")}` : "Filter: whole vault");

    const search = this.browseSearch || "";
    const cards = this.plugin.data.cards.filter((c) => {
      if (!matchesFolder(c.sourcePath, filter)) return false;
      if (!search) return true;
      return (
        (c.question || "").toLowerCase().includes(search) ||
        (c.answer || "").toLowerCase().includes(search) ||
        (c.note || "").toLowerCase().includes(search)
      );
    });

    if (cards.length === 0) {
      this.listEl.createDiv({ text: "No cards match.", cls: "nfc-empty" });
      return;
    }

    for (const card of cards) {
      const row = this.listEl.createDiv({ cls: "nfc-card-row" });

      const info = row.createDiv({ cls: "nfc-card-row-info" });
      info.createDiv({ text: card.question.slice(0, 70), cls: "nfc-card-row-q" });
      info.createDiv({ text: card.sourcePath, cls: "nfc-card-row-source" });

      const btnGroup = row.createDiv({ cls: "nfc-card-row-btns" });
      const reset = btnGroup.createEl("button", { text: "Reset", cls: "nfc-del-btn" });
      reset.setAttribute("title", "Clear this card's interval/ease/reps and put it back due immediately");
      reset.addEventListener("click", async () => {
        resetCardSchedule(card, this.plugin.data.settings);
        await this.plugin.savePluginData();
        new Notice("Progress reset - card is due now");
      });
      if (hasSyncAnchor(card)) {
        const sync = btnGroup.createEl("button", { text: "Sync", cls: "nfc-del-btn" });
        sync.setAttribute("title", "Re-pull question/answer text from their current paragraphs in the source note");
        sync.addEventListener("click", async () => {
          const result = await syncCardFromSource(this.app, this.plugin, card);
          notifySyncResult(result);
          this.renderCardList();
        });
      }
      const edit = btnGroup.createEl("button", { text: "Edit", cls: "nfc-del-btn" });
      edit.addEventListener("click", () => {
        new EditCardModal(this.app, this.plugin, card, () => this.renderCardList()).open();
      });
      const del = btnGroup.createEl("button", { text: "Delete", cls: "nfc-del-btn" });
      del.addEventListener("click", async () => {
        await deleteCard(this.app, this.plugin, card);
        if (this.file && card.sourcePath === this.file.path) {
          this.rawText = await this.app.vault.read(this.file);
          this.textarea.value = this.rawText;
        }
        this.renderCardList();
      });
    }
  }
}

// ---------------------------------------------------------------------
// Review view
// ---------------------------------------------------------------------

class ReviewView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.queue = [];
    this.index = 0;
  }

  getViewType() {
    return VIEW_TYPE_REVIEW;
  }
  getDisplayText() {
    return "Review flashcards";
  }
  getIcon() {
    return "check-circle";
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("nfc-review-view");

    const topRow = root.createDiv({ cls: "nfc-review-top" });
    this.progressEl = topRow.createDiv({ cls: "nfc-progress" });
    const topBtns = topRow.createDiv({ cls: "nfc-review-top-btns" });
    const filterBtn = topBtns.createEl("button", { text: "Filter..." });
    filterBtn.addEventListener("click", () => {
      new FolderFilterModal(
        this.app,
        this.plugin.data.settings.folderFilter,
        async (selected) => {
          this.plugin.data.settings.folderFilter = selected;
          await this.plugin.savePluginData();
          this.loadQueue();
        },
        "Filter review by folder / note"
      ).open();
    });
    const refreshBtn = topBtns.createEl("button", { text: "Refresh queue" });
    refreshBtn.addEventListener("click", () => this.loadQueue());
    const resetAllBtn = topBtns.createEl("button", { text: "Reset all", cls: "nfc-reset-btn" });
    resetAllBtn.setAttribute("title", "Clear interval/ease/reps for every card in the current filter and put them all due now");
    resetAllBtn.addEventListener("click", () => this.resetAll());

    this.filterSummaryEl = root.createDiv({ cls: "nfc-filter-summary" });

    this.cardEl = root.createDiv({ cls: "nfc-review-card" });
    this.qEl = this.cardEl.createDiv({ cls: "nfc-review-question" });
    this.aEl = this.cardEl.createDiv({ cls: "nfc-review-answer" });
    this.nEl = this.cardEl.createDiv({ cls: "nfc-review-note" });
    this.aEl.hide();
    this.nEl.hide();

    const getSourcePath = () => {
      const card = this.queue[this.index];
      return card ? card.sourcePath : "";
    };
    attachLinkNavigation(this.app, this.qEl, getSourcePath);
    attachLinkNavigation(this.app, this.aEl, getSourcePath);
    attachLinkNavigation(this.app, this.nEl, getSourcePath);

    const controls = root.createDiv({ cls: "nfc-review-controls" });
    this.showBtn = controls.createEl("button", { text: "Show answer", cls: "nfc-show-btn" });
    this.showBtn.addEventListener("click", () => this.reveal());

    this.gradeRow = controls.createDiv({ cls: "nfc-grade-row" });
    this.gradeRow.hide();
    for (const [key, label] of [
      ["again", "Again"],
      ["hard", "Hard"],
      ["good", "Good"],
      ["easy", "Easy"],
    ]) {
      const btn = this.gradeRow.createEl("button", { text: label, cls: `nfc-grade-btn nfc-grade-${key}` });
      btn.addEventListener("click", () => this.grade(key));
    }

    const openRow = root.createDiv({ cls: "nfc-open-row" });
    this.openSourceBtn = openRow.createEl("button", { text: "Open source note", cls: "nfc-open-btn" });
    this.openSourceBtn.addEventListener("click", () => this.openSource());
    this.openCardBtn = openRow.createEl("button", { text: "Open card note", cls: "nfc-open-btn" });
    this.openCardBtn.addEventListener("click", () => this.openCard());
    this.syncBtn = openRow.createEl("button", { text: "Sync from note", cls: "nfc-open-btn" });
    this.syncBtn.setAttribute("title", "Re-pull question/answer text from their current paragraphs in the source note");
    this.syncBtn.addEventListener("click", () => this.syncCurrent());

    // Deliberately NOT calling the pruning loadQueue() here: this runs during
    // Obsidian's own workspace restoration at startup, when the vault index
    // isn't guaranteed ready yet - scanning+deleting files at that moment
    // risks misfiring (or hanging) before the app is even interactive.
    // "Refresh queue" (and the other explicit user actions below) still use
    // the full pruning version safely, since those only happen once you're
    // already using the app.
    this.buildQueue();
  }

  // Safe, read-only: just computes the due-card queue from whatever is
  // currently in the database. No vault scanning, no file writes.
  buildQueue() {
    const now = Date.now();
    const settings = this.plugin.data.settings;
    const filter = settings.folderFilter || [];
    this.filterSummaryEl.setText(filter.length ? `Filter: ${filter.join(", ")}` : "Filter: whole vault");

    const due = this.plugin.data.cards.filter((c) => c.dueDate <= now && matchesFolder(c.sourcePath, filter));
    const reviewCards = due.filter((c) => c.reps > 0);
    const newCards = due.filter((c) => c.reps === 0).slice(0, settings.newCardsPerDay);
    this.queue = reviewCards.concat(newCards);
    this.index = 0;
    this.renderCurrent();
  }

  // Full refresh: also prunes cards whose source note no longer exists.
  // Only ever called from explicit user actions (button clicks), never
  // automatically on view open - see the comment in onOpen() above.
  async loadQueue() {
    const orphaned = this.plugin.data.cards.filter((c) => !this.app.vault.getAbstractFileByPath(c.sourcePath));
    for (const card of orphaned) {
      await deleteCard(this.app, this.plugin, card);
    }
    if (orphaned.length > 0) {
      new Notice(`Removed ${orphaned.length} card${orphaned.length > 1 ? "s" : ""} whose source note no longer exists`);
    }

    this.buildQueue();
  }

  renderCurrent() {
    this.aEl.hide();
    this.nEl.hide();
    this.gradeRow.hide();
    this.showBtn.show();

    if (this.index >= this.queue.length) {
      this.progressEl.setText("No cards due");
      this.qEl.empty();
      this.qEl.setText("All done for now.");
      this.aEl.empty();
      this.nEl.empty();
      this.showBtn.hide();
      this.openSourceBtn.hide();
      this.openCardBtn.hide();
      this.syncBtn.hide();
      return;
    }
    this.showBtn.show();
    this.openSourceBtn.show();
    this.openCardBtn.show();
    this.syncBtn.show();
    const card = this.queue[this.index];
    this.progressEl.setText(`${this.index + 1} / ${this.queue.length} due`);
    renderMd(this.app, this, card.question, this.qEl, card.sourcePath);
    renderMd(this.app, this, card.answer, this.aEl, card.sourcePath);
    this.nEl.empty();
    if (card.note) {
      this.nEl.createDiv({ text: "Note", cls: "nfc-review-note-label" });
      const noteBody = this.nEl.createDiv();
      renderMd(this.app, this, card.note, noteBody, card.sourcePath);
    }
  }

  reveal() {
    this.aEl.show();
    const card = this.queue[this.index];
    if (card && card.note) this.nEl.show();
    this.gradeRow.show();
    this.showBtn.hide();
  }

  async grade(key) {
    const card = this.queue[this.index];
    scheduleCard(card, key, this.plugin.data.settings);
    await this.plugin.savePluginData();
    this.index += 1;
    this.renderCurrent();
  }

  async resetAll() {
    const filter = this.plugin.data.settings.folderFilter || [];
    const targets = this.plugin.data.cards.filter((c) => matchesFolder(c.sourcePath, filter));
    if (targets.length === 0) {
      new Notice("No cards in the current filter");
      return;
    }
    const scope = filter.length ? "the current filter" : "your whole vault";
    if (!window.confirm(`Reset progress for all ${targets.length} card(s) in ${scope}? This clears their interval/ease/reps and puts them all due now.`)) {
      return;
    }
    for (const card of targets) resetCardSchedule(card, this.plugin.data.settings);
    await this.plugin.savePluginData();
    new Notice(`Reset ${targets.length} card(s)`);
    this.loadQueue();
  }

  openSource() {
    if (this.index >= this.queue.length) return;
    const card = this.queue[this.index];
    openNotePath(this.app, card.sourcePath);
  }

  openCard() {
    if (this.index >= this.queue.length) return;
    const card = this.queue[this.index];
    if (!card.cardPath) {
      new Notice("This card has no note (created before this feature was added)");
      return;
    }
    openNotePath(this.app, card.cardPath);
  }

  async syncCurrent() {
    if (this.index >= this.queue.length) return;
    const card = this.queue[this.index];
    if (!hasSyncAnchor(card)) {
      new Notice("This card has no source link to sync from (created before this feature was added)");
      return;
    }
    const result = await syncCardFromSource(this.app, this.plugin, card);
    notifySyncResult(result);
    if (result.changed) this.renderCurrent();
  }
}

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------

class NoteFlashcardsSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Note Flashcards" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "This plugin was generated entirely by AI (Claude Sonnet 5, Anthropic).",
    });

    const settings = this.plugin.data.settings;

    new Setting(containerEl)
      .setName("Flashcards folder")
      .setDesc("Every saved card is written here as its own note (Question/Answer + a link back to the source note).")
      .addText((t) =>
        t.setValue(settings.cardsFolder).onChange(async (v) => {
          settings.cardsFolder = v.trim() || "Flashcards";
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Show flashcard sync markers")
      .setDesc(
        "The hidden markers (\"%%nfc-qs-...%%\" around exact question/answer text, plus older \"^nfc-...\" block " +
          "references) cards use to sync with their source. Normally invisible in Source and Live Preview; same " +
          "toggle as the \"...\" menu on a note. Off by default."
      )
      .addToggle((t) =>
        t.setValue(!!settings.showBlockIds).onChange(async (v) => {
          settings.showBlockIds = v;
          await this.plugin.savePluginData();
          this.plugin.toggleBlockIdVisibility(v);
        })
      );

    new Setting(containerEl)
      .setName("Folders / notes to review")
      .setDesc(
        "Comma-separated folder or note paths - only cards from these (and subfolders) show up in review; empty = whole vault. " +
          "For a checkbox tree of your actual vault structure instead, use the \"Filter...\" button in the Review view."
      )
      .addTextArea((t) =>
        t.setValue((settings.folderFilter || []).join(", ")).onChange(async (v) => {
          settings.folderFilter = v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("New cards per day")
      .setDesc("Cap on never-reviewed cards introduced per queue load. Cards already in review are never capped.")
      .addText((t) =>
        t.setValue(String(settings.newCardsPerDay)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n >= 0) settings.newCardsPerDay = n;
          await this.plugin.savePluginData();
        })
      );

    containerEl.createEl("h3", { text: "Grading intervals (days)" });
    containerEl.createEl("p", {
      text: "How far out a card is scheduled the first time you pick each grade. Later reviews scale this by the card's ease.",
      cls: "setting-item-description",
    });

    for (const key of ["again", "hard", "good", "easy"]) {
      new Setting(containerEl)
        .setName(key[0].toUpperCase() + key.slice(1))
        .addText((t) =>
          t.setValue(String(settings.intervals[key])).onChange(async (v) => {
            const n = parseFloat(v);
            if (Number.isFinite(n) && n > 0) settings.intervals[key] = n;
            await this.plugin.savePluginData();
          })
        );
    }
  }
}

// ---------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------

module.exports = class NoteFlashcardsPlugin extends Plugin {
  async onload() {
    await this.loadPluginData();

    const hideBlockIds = buildHideBlockIdExtension(this);
    if (hideBlockIds) {
      this.showBlockIdsEffect = hideBlockIds.effect;
      this.registerEditorExtension(hideBlockIds.extension);
    }

    this.registerView(VIEW_TYPE_CREATE, (leaf) => new CreateView(leaf, this));
    this.registerView(VIEW_TYPE_REVIEW, (leaf) => new ReviewView(leaf, this));

    this.addSettingTab(new NoteFlashcardsSettingTab(this.app, this));

    this.addRibbonIcon("check-circle", "Review flashcards", () => this.activateView(VIEW_TYPE_REVIEW));

    this.addCommand({
      id: "open-flashcard-creator",
      name: "Open flashcard creator",
      callback: () => this.activateView(VIEW_TYPE_CREATE),
    });
    this.addCommand({
      id: "open-flashcard-review",
      name: "Open flashcard review",
      callback: () => this.activateView(VIEW_TYPE_REVIEW),
    });

    // Adds "Show flashcard sync markers" to a note's "..." (more options) menu,
    // right where the reading/live preview/source mode switcher lives.
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file, source) => {
        if (source !== "more-options") return;
        menu.addItem((item) => {
          item
            .setTitle("Show flashcard sync markers")
            .setIcon("eye")
            .setChecked(!!this.data.settings.showBlockIds)
            .onClick(async () => {
              this.data.settings.showBlockIds = !this.data.settings.showBlockIds;
              await this.savePluginData();
              this.toggleBlockIdVisibility(this.data.settings.showBlockIds);
            });
        });
      })
    );
  }

  toggleBlockIdVisibility(value) {
    if (!this.showBlockIdsEffect) return;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const editor = leaf.view && leaf.view.editor;
      const cm = editor && editor.cm;
      if (cm) cm.dispatch({ effects: this.showBlockIdsEffect.of(value) });
    });
  }

  async activateView(viewType) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(viewType)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: viewType, active: true });
    }
    workspace.revealLeaf(leaf);
  }

  async loadPluginData() {
    const data = await this.loadData();
    this.data = Object.assign({}, DEFAULT_DATA, data);
    this.data.settings = Object.assign({}, DEFAULT_DATA.settings, data && data.settings);
    this.data.settings.intervals = Object.assign(
      {},
      DEFAULT_DATA.settings.intervals,
      data && data.settings && data.settings.intervals
    );
    if (!Array.isArray(this.data.cards)) this.data.cards = [];
  }

  async savePluginData() {
    await this.saveData(this.data);
  }
};
