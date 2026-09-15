// Mobile git support via isomorphic-git (a pure-JS git implementation), since
// Obsidian mobile has no child_process/git-binary access at all - the desktop
// half of this plugin (main.js) keeps using the real git CLI unchanged.
//
// Known limitation I can't verify from this environment: GitHub's git HTTP
// endpoints don't send permissive CORS headers, so a direct `fetch()` from a
// webview context (which is what this plugin runs in, even on mobile) may be
// blocked by CORS. The isomorphic-git ecosystem's standard workaround is a
// CORS proxy (e.g. https://cors.isomorphic-git.org, or one you run yourself) -
// exposed here as an optional setting. Whether Obsidian's mobile webview
// actually needs one is something only testing on a real device can answer.

const ROOT = "/";
const GITDIR = "/.git";

function normalize(filepath) {
  const p = String(filepath).replace(/^\/+/, "");
  return p === "" ? "" : p;
}

function toArrayBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

// Wraps Obsidian's cross-platform DataAdapter (app.vault.adapter) into the
// promise-based fs interface isomorphic-git expects. isomorphic-git talks in
// posix-style absolute paths ("/", "/.git/config", ...); we strip the leading
// slash and defer to the adapter's vault-relative paths underneath.
function createFsShim(adapter) {
  function makeStat(s, isDir) {
    return {
      mode: isDir ? 0o40000 : 0o100644,
      size: (s && s.size) || 0,
      mtimeMs: (s && s.mtime) || Date.now(),
      ctimeMs: (s && (s.ctime || s.mtime)) || Date.now(),
      uid: 1,
      gid: 1,
      dev: 1,
      ino: 1,
      isFile: () => !isDir,
      isDirectory: () => isDir,
      isSymbolicLink: () => false,
    };
  }

  const promises = {
    async readFile(filepath, opts) {
      const encoding = typeof opts === "string" ? opts : opts && opts.encoding;
      const path = normalize(filepath);
      if (encoding === "utf8") return await adapter.read(path);
      const buf = await adapter.readBinary(path);
      return new Uint8Array(buf);
    },

    async writeFile(filepath, data, opts) {
      const encoding = typeof opts === "string" ? opts : opts && opts.encoding;
      const path = normalize(filepath);
      if (typeof data === "string" || encoding === "utf8") {
        await adapter.write(path, typeof data === "string" ? data : new TextDecoder().decode(data));
      } else {
        const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
        await adapter.writeBinary(path, toArrayBuffer(u8));
      }
    },

    async unlink(filepath) {
      const path = normalize(filepath);
      await adapter.remove(path);
    },

    async readdir(filepath) {
      const path = normalize(filepath);
      const listing = await adapter.list(path);
      const names = [];
      for (const f of listing.files) names.push(f.split("/").pop());
      for (const f of listing.folders) names.push(f.split("/").pop());
      return names;
    },

    async mkdir(filepath) {
      const path = normalize(filepath);
      try {
        await adapter.mkdir(path);
      } catch (e) {
        if (await adapter.exists(path)) return;
        throw e;
      }
    },

    async rmdir(filepath) {
      const path = normalize(filepath);
      await adapter.rmdir(path, false);
    },

    async stat(filepath) {
      const path = normalize(filepath);
      const s = await adapter.stat(path);
      if (!s) {
        const err = new Error(`ENOENT: no such file or directory, stat '${filepath}'`);
        err.code = "ENOENT";
        throw err;
      }
      return makeStat(s, s.type === "folder");
    },

    async lstat(filepath) {
      return promises.stat(filepath);
    },

    async readlink() {
      const err = new Error("readlink not supported (no symlinks in an Obsidian vault)");
      err.code = "ENOSYS";
      throw err;
    },

    async symlink() {
      const err = new Error("symlink not supported (no symlinks in an Obsidian vault)");
      err.code = "ENOSYS";
      throw err;
    },
  };

  return { promises };
}

// Converts a scp-style SSH remote ("git@host:user/repo.git") to HTTPS, since
// isomorphic-git's browser/web http transport only speaks HTTP(S), never SSH.
// Leaves anything that isn't in that exact shape untouched.
function sshToHttps(url) {
  const m = String(url || "").match(/^git@([^:]+):(.+?)(\.git)?$/);
  if (!m) return url;
  return `https://${m[1]}/${m[2]}.git`;
}

class MobileGit {
  constructor(isoGit, isoHttp, adapter) {
    this.git = isoGit;
    this.http = isoHttp;
    this.fs = createFsShim(adapter);
  }

  async isRepo() {
    try {
      const s = await this.fs.promises.stat(GITDIR);
      return s.isDirectory();
    } catch (e) {
      return false;
    }
  }

  async init(defaultBranch) {
    await this.git.init({ fs: this.fs, dir: ROOT, gitdir: GITDIR, defaultBranch: defaultBranch || "main" });
  }

  async currentBranch(fallback) {
    const name = await this.git.currentBranch({ fs: this.fs, dir: ROOT, gitdir: GITDIR, fullname: false });
    return name || fallback || "main";
  }

  async isDirty() {
    const status = await this.git.statusMatrix({ fs: this.fs, dir: ROOT, gitdir: GITDIR });
    return status.some(([, head, workdir, stage]) => !(head === 1 && workdir === 1 && stage === 1));
  }

  // Official isomorphic-git "stage everything, including deletions" pattern.
  async addAll() {
    const status = await this.git.statusMatrix({ fs: this.fs, dir: ROOT, gitdir: GITDIR });
    for (const [filepath, , worktreeStatus] of status) {
      if (worktreeStatus) await this.git.add({ fs: this.fs, dir: ROOT, gitdir: GITDIR, filepath });
      else await this.git.remove({ fs: this.fs, dir: ROOT, gitdir: GITDIR, filepath });
    }
  }

  async commit(message, author) {
    return await this.git.commit({
      fs: this.fs,
      dir: ROOT,
      gitdir: GITDIR,
      message,
      author: { name: (author && author.name) || "Obsidian", email: (author && author.email) || "obsidian@localhost" },
    });
  }

  authCallback(token, username) {
    return () => ({ username: username || "x-access-token", password: token });
  }

  async clone(url, ref, token, username, corsProxy) {
    await this.git.clone({
      fs: this.fs,
      http: this.http,
      dir: ROOT,
      gitdir: GITDIR,
      url: sshToHttps(url),
      ref,
      singleBranch: true,
      corsProxy: corsProxy || undefined,
      onAuth: this.authCallback(token, username),
    });
  }

  async pull(url, ref, token, username, author, corsProxy) {
    return await this.git.pull({
      fs: this.fs,
      http: this.http,
      dir: ROOT,
      gitdir: GITDIR,
      url: sshToHttps(url),
      ref,
      singleBranch: true,
      corsProxy: corsProxy || undefined,
      author: { name: (author && author.name) || "Obsidian", email: (author && author.email) || "obsidian@localhost" },
      onAuth: this.authCallback(token, username),
    });
  }

  async push(url, ref, token, username, corsProxy) {
    return await this.git.push({
      fs: this.fs,
      http: this.http,
      dir: ROOT,
      gitdir: GITDIR,
      url: sshToHttps(url),
      ref,
      corsProxy: corsProxy || undefined,
      onAuth: this.authCallback(token, username),
    });
  }
}

module.exports = { MobileGit, sshToHttps, createFsShim };
