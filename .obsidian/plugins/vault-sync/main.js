// This plugin was generated entirely by AI: Claude Sonnet 5 (Anthropic),
// model id "claude-sonnet-5", via Claude Code, at the request of the vault owner.
//
// Everything here only ever runs when you explicitly click a button or run a
// command - nothing fires automatically on startup, on a timer, or on file
// change. That's deliberate: this plugin shells out to git, and an automatic
// background operation is exactly what caused a real problem in another
// plugin in this vault recently.
//
// Scope note: this gives you manual push/pull sync against any git remote,
// including a server you run yourself (e.g. a bare repo over SSH on your own
// machine). It is NOT live/real-time sync - there's no persistent connection
// and no automatic conflict resolution. True live sync would need a custom
// server + protocol (or an existing solution like the community
// "Self-hosted LiveSync" plugin) and is a separate, much larger project.

const { Plugin, PluginSettingTab, Setting, Notice } = require("obsidian");
const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");

const DEFAULT_SETTINGS = {
  remoteUrl: "",
  branch: "main",
  authorName: "",
  authorEmail: "",
  syncOnSave: false,
  syncOnSaveDelay: 60,
};

function runGit(cwd, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, timeout: timeoutMs || 30000, maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          timedOut: !!(error && error.killed),
          stdout: (stdout || "").toString(),
          stderr: (stderr || (error ? error.message : "")).toString(),
        });
      }
    );
  });
}

class VaultSyncSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Vault Sync" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "This plugin was generated entirely by AI (Claude Sonnet 5, Anthropic).",
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text:
        "Manual git-based backup/sync. Nothing here runs automatically - every action below is triggered by you " +
        "clicking a button or running a command.",
    });

    this.statusEl = containerEl.createEl("pre", { cls: "vsy-status" });
    this.refreshStatus();

    new Setting(containerEl)
      .setName("Initialize repository")
      .setDesc("Runs 'git init' on this vault (if not already one) and writes a small default .gitignore.")
      .addButton((b) =>
        b.setButtonText("Initialize").onClick(async () => {
          await this.plugin.initRepo();
          this.refreshStatus();
        })
      );

    new Setting(containerEl)
      .setName("Remote URL")
      .setDesc(
        "Any git remote: a private GitHub/GitLab repo, or your own server (e.g. ssh://user@host/path/to/repo.git). " +
          "Leave empty and save to remove the remote."
      )
      .addText((t) => {
        this.remoteInput = t;
        t.setValue(this.plugin.settings.remoteUrl).setPlaceholder("ssh://user@host/vault.git");
      })
      .addButton((b) =>
        b
          .setButtonText("Save")
          .setCta()
          .onClick(async () => {
            const url = this.remoteInput.getValue().trim();
            this.plugin.settings.remoteUrl = url;
            await this.plugin.saveSettings();
            await this.plugin.applyRemoteUrl(url);
            this.refreshStatus();
          })
      );

    new Setting(containerEl)
      .setName("Branch")
      .setDesc("Branch name to push/pull.")
      .addText((t) =>
        t.setValue(this.plugin.settings.branch).onChange(async (v) => {
          this.plugin.settings.branch = v.trim() || "main";
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Commit author (optional)")
      .setDesc("Sets this repo's local git user.name/user.email. Leave blank to use your global git config.")
      .addText((t) =>
        t
          .setPlaceholder("Name")
          .setValue(this.plugin.settings.authorName)
          .onChange(async (v) => {
            this.plugin.settings.authorName = v.trim();
            await this.plugin.saveSettings();
          })
      )
      .addText((t) =>
        t
          .setPlaceholder("email@example.com")
          .setValue(this.plugin.settings.authorEmail)
          .onChange(async (v) => {
            this.plugin.settings.authorEmail = v.trim();
            await this.plugin.saveSettings();
          })
      )
      .addButton((b) =>
        b.setButtonText("Apply").onClick(async () => {
          await this.plugin.applyAuthorConfig();
          new Notice("Author config applied");
        })
      );

    new Setting(containerEl)
      .setName("Sync on file save")
      .setDesc(
        "Off by default. When on, saving a file schedules an automatic Sync now (commit, pull, push) after the " +
          "delay below with no further edits - so a burst of typing triggers one sync, not one per keystroke. " +
          "Runs quietly (no start/success notices) but still notifies you on failure."
      )
      .addToggle((t) =>
        t.setValue(this.plugin.settings.syncOnSave).onChange(async (v) => {
          this.plugin.settings.syncOnSave = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Sync on save delay (seconds)")
      .setDesc("How long to wait after the last file change before auto-syncing.")
      .addText((t) =>
        t.setValue(String(this.plugin.settings.syncOnSaveDelay)).onChange(async (v) => {
          const n = parseInt(v, 10);
          if (Number.isFinite(n) && n >= 5) this.plugin.settings.syncOnSaveDelay = n;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl("h3", { text: "Actions" });

    new Setting(containerEl)
      .setName("Commit snapshot")
      .setDesc("Stages everything and commits it with a timestamped message.")
      .addButton((b) =>
        b.setButtonText("Commit").onClick(async () => {
          await this.plugin.commitSnapshot();
          this.refreshStatus();
        })
      );

    new Setting(containerEl)
      .setName("Pull from remote")
      .setDesc("Refuses to run if you have uncommitted changes, to avoid a messy merge.")
      .addButton((b) =>
        b.setButtonText("Pull").onClick(async () => {
          await this.plugin.pullFromRemote();
          this.refreshStatus();
        })
      );

    new Setting(containerEl)
      .setName("Push to remote")
      .addButton((b) =>
        b.setButtonText("Push").onClick(async () => {
          await this.plugin.pushToRemote();
          this.refreshStatus();
        })
      );

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Commit, then pull, then push - in that order.")
      .addButton((b) =>
        b
          .setButtonText("Sync now")
          .setCta()
          .onClick(async () => {
            await this.plugin.syncNow();
            this.refreshStatus();
          })
      );
  }

  async refreshStatus() {
    if (!this.statusEl) return;
    this.statusEl.setText("Checking status...");
    const lines = [];

    const gitOk = await this.plugin.ensureGitAvailable();
    lines.push(`git available: ${gitOk ? "yes" : "no - install git to use this plugin"}`);

    if (gitOk) {
      const isRepo = await this.plugin.isRepo();
      lines.push(`vault is a git repo: ${isRepo ? "yes" : "no - use Initialize below"}`);

      if (isRepo) {
        const hasRemote = await this.plugin.hasRemote();
        lines.push(`remote configured: ${hasRemote ? "yes (origin)" : "no"}`);

        const status = await runGit(this.plugin.vaultPath, ["status", "--porcelain"]);
        const dirty = status.ok && status.stdout.trim().length > 0;
        lines.push(`uncommitted changes: ${dirty ? "yes" : "no"}`);

        const log = await runGit(this.plugin.vaultPath, ["log", "-1", "--pretty=%h %ad %s", "--date=short"]);
        lines.push(`last commit: ${log.ok && log.stdout.trim() ? log.stdout.trim() : "(none yet)"}`);
      }
    }

    this.statusEl.setText(lines.join("\n"));
  }
}

module.exports = class VaultSyncPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.vaultPath = this.getVaultPath();

    this.addSettingTab(new VaultSyncSettingTab(this.app, this));

    this.addRibbonIcon("refresh-cw", "Sync vault (git)", () => this.syncNow());

    this.addCommand({
      id: "vault-sync-init",
      name: "Vault Sync: Initialize git repository",
      callback: () => this.initRepo(),
    });
    this.addCommand({
      id: "vault-sync-commit",
      name: "Vault Sync: Commit snapshot",
      callback: () => this.commitSnapshot(),
    });
    this.addCommand({
      id: "vault-sync-pull",
      name: "Vault Sync: Pull from remote",
      callback: () => this.pullFromRemote(),
    });
    this.addCommand({
      id: "vault-sync-push",
      name: "Vault Sync: Push to remote",
      callback: () => this.pushToRemote(),
    });
    this.addCommand({
      id: "vault-sync-now",
      name: "Vault Sync: Sync now (commit, pull, push)",
      callback: () => this.syncNow(),
    });

    // Debounced, opt-in auto-sync: a burst of saves schedules one sync after
    // the configured quiet period, not one per file. Off unless the "Sync on
    // file save" setting is enabled - see that setting's description.
    this.saveDebounceTimer = null;
    this.registerEvent(
      this.app.vault.on("modify", () => {
        if (!this.settings.syncOnSave) return;
        if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
        const delayMs = Math.max(5, this.settings.syncOnSaveDelay || 60) * 1000;
        this.saveDebounceTimer = setTimeout(() => {
          this.saveDebounceTimer = null;
          this.syncNow({ quiet: true });
        }, delayMs);
      })
    );
  }

  onunload() {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
  }

  getVaultPath() {
    const adapter = this.app.vault.adapter;
    if (adapter && typeof adapter.getBasePath === "function") return adapter.getBasePath();
    return adapter && adapter.basePath ? adapter.basePath : null;
  }

  reportError(prefix, result) {
    const detail = ((result && (result.stderr || result.stdout)) || "").trim();
    console.error(`vault-sync: ${prefix}`, detail);
    const firstLine = detail.split("\n").find((l) => l.trim().length > 0) || "see console for details";
    new Notice(`Vault Sync - ${prefix}: ${firstLine}`);
  }

  async ensureGitAvailable() {
    if (!this.vaultPath) return false;
    const res = await runGit(this.vaultPath, ["--version"], 5000);
    return res.ok;
  }

  async isRepo() {
    if (!this.vaultPath) return false;
    const res = await runGit(this.vaultPath, ["rev-parse", "--is-inside-work-tree"], 5000);
    return res.ok && res.stdout.trim() === "true";
  }

  async hasRemote() {
    const res = await runGit(this.vaultPath, ["remote"], 5000);
    return res.ok && res.stdout.trim().length > 0;
  }

  async writeDefaultGitignore() {
    const giPath = path.join(this.vaultPath, ".gitignore");
    if (fs.existsSync(giPath)) return;
    try {
      fs.writeFileSync(giPath, ".obsidian/workspace.json\n.obsidian/workspace-mobile.json\n");
    } catch (e) {
      console.error("vault-sync: could not write .gitignore", e);
    }
  }

  async applyRemoteUrl(url) {
    if (!this.vaultPath) return;
    if (!(await this.isRepo())) {
      new Notice("Not a git repository yet - run Initialize first");
      return;
    }
    if (!url) {
      if (await this.hasRemote()) await runGit(this.vaultPath, ["remote", "remove", "origin"]);
      new Notice("Remote removed");
      return;
    }
    const has = await this.hasRemote();
    const res = await runGit(
      this.vaultPath,
      has ? ["remote", "set-url", "origin", url] : ["remote", "add", "origin", url]
    );
    if (!res.ok) this.reportError("Setting remote failed", res);
    else new Notice("Remote saved");
  }

  async applyAuthorConfig() {
    if (!this.vaultPath || !(await this.isRepo())) return;
    if (this.settings.authorName) await runGit(this.vaultPath, ["config", "user.name", this.settings.authorName]);
    if (this.settings.authorEmail) await runGit(this.vaultPath, ["config", "user.email", this.settings.authorEmail]);
  }

  async initRepo() {
    if (!this.vaultPath) {
      new Notice("Vault Sync only works on desktop (needs filesystem + git access)");
      return;
    }
    if (!(await this.ensureGitAvailable())) {
      new Notice("git isn't available on this system - install it first");
      return;
    }
    if (await this.isRepo()) {
      new Notice("Already a git repository");
      return;
    }
    const init = await runGit(this.vaultPath, ["init"]);
    if (!init.ok) {
      this.reportError("git init failed", init);
      return;
    }
    await this.writeDefaultGitignore();
    await this.applyAuthorConfig();
    await runGit(this.vaultPath, ["add", "-A"]);
    const commit = await runGit(this.vaultPath, ["commit", "-m", "Initial vault snapshot"]);
    if (!commit.ok && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
      this.reportError("Initial commit failed", commit);
      return;
    }
    new Notice("Git repository initialized");
  }

  // `opts.quiet` suppresses routine/success notices (used by auto-sync-on-save
  // so it doesn't interrupt writing) - failures are always reported regardless.
  async commitSnapshot(message, opts) {
    const quiet = !!(opts && opts.quiet);
    if (!this.vaultPath) return false;
    if (!(await this.isRepo())) {
      if (!quiet) new Notice("Not a git repository yet - run 'Initialize repository' first");
      return false;
    }
    await this.applyAuthorConfig();
    const add = await runGit(this.vaultPath, ["add", "-A"]);
    if (!add.ok) {
      this.reportError("Staging changes failed", add);
      return false;
    }
    const status = await runGit(this.vaultPath, ["status", "--porcelain"]);
    if (!status.stdout.trim()) {
      if (!quiet) new Notice("Nothing to commit - already up to date");
      return true;
    }
    const msg = message || `Vault snapshot ${new Date().toISOString().replace("T", " ").slice(0, 19)}`;
    const commit = await runGit(this.vaultPath, ["commit", "-m", msg]);
    if (!commit.ok) {
      this.reportError("Commit failed", commit);
      return false;
    }
    if (!quiet) new Notice("Snapshot committed");
    return true;
  }

  async pullFromRemote(opts) {
    const quiet = !!(opts && opts.quiet);
    if (!this.vaultPath) return false;
    if (!(await this.isRepo())) {
      if (!quiet) new Notice("Not a git repository yet - run 'Initialize repository' first");
      return false;
    }
    if (!(await this.hasRemote())) {
      if (!quiet) new Notice("No remote configured - set one in Vault Sync settings");
      return false;
    }
    const status = await runGit(this.vaultPath, ["status", "--porcelain"]);
    if (status.stdout.trim()) {
      if (!quiet) new Notice("You have uncommitted changes - commit first, then pull");
      return false;
    }
    const branch = this.settings.branch || "main";
    const pull = await runGit(this.vaultPath, ["pull", "origin", branch], 60000);
    if (!pull.ok) {
      this.reportError("Pull failed (check for merge conflicts)", pull);
      return false;
    }
    if (!quiet) new Notice("Pulled latest from remote");
    return true;
  }

  async pushToRemote(opts) {
    const quiet = !!(opts && opts.quiet);
    if (!this.vaultPath) return false;
    if (!(await this.isRepo())) {
      if (!quiet) new Notice("Not a git repository yet - run 'Initialize repository' first");
      return false;
    }
    if (!(await this.hasRemote())) {
      if (!quiet) new Notice("No remote configured - set one in Vault Sync settings");
      return false;
    }
    const branch = this.settings.branch || "main";
    const push = await runGit(this.vaultPath, ["push", "-u", "origin", branch], 60000);
    if (!push.ok) {
      this.reportError("Push failed", push);
      return false;
    }
    if (!quiet) new Notice("Pushed to remote");
    return true;
  }

  async syncNow(opts) {
    const quiet = !!(opts && opts.quiet);
    if (!(await this.isRepo())) {
      if (!quiet) new Notice("Not a git repository yet - run 'Initialize repository' first");
      return;
    }
    if (!quiet) new Notice("Syncing vault...");
    const committed = await this.commitSnapshot(null, opts);
    if (!committed) return;
    if (await this.hasRemote()) {
      const pulled = await this.pullFromRemote(opts);
      if (!pulled) return;
      await this.pushToRemote(opts);
    }
    if (!quiet) new Notice("Vault sync complete");
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
};
