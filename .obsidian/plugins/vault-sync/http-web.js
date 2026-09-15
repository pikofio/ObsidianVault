// CommonJS rewrite of isomorphic-git's "http/web" transport (which upstream
// only ships as ESM, incompatible with Obsidian's require()-based plugin
// loading). Logic follows the upstream implementation faithfully; only the
// module wrapper differs. Uses the standard `fetch` API, available in both
// Obsidian desktop (Electron) and mobile (Capacitor webview).

function fromValue(value) {
  let queue = [value];
  return {
    next() {
      return Promise.resolve({ done: queue.length === 0, value: queue.pop() });
    },
    return() {
      queue = [];
      return {};
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

function getIterator(iterable) {
  if (iterable[Symbol.asyncIterator]) return iterable[Symbol.asyncIterator]();
  if (iterable[Symbol.iterator]) return iterable[Symbol.iterator]();
  if (iterable.next) return iterable;
  return fromValue(iterable);
}

async function forAwait(iterable, cb) {
  const iter = getIterator(iterable);
  while (true) {
    const { value, done } = await iter.next();
    if (value) await cb(value);
    if (done) break;
  }
  if (iter.return) iter.return();
}

async function collect(iterable) {
  let size = 0;
  const buffers = [];
  await forAwait(iterable, (value) => {
    buffers.push(value);
    size += value.byteLength;
  });
  const result = new Uint8Array(size);
  let nextIndex = 0;
  for (const buffer of buffers) {
    result.set(buffer, nextIndex);
    nextIndex += buffer.byteLength;
  }
  return result;
}

function fromStream(stream) {
  if (stream[Symbol.asyncIterator]) return stream;
  const reader = stream.getReader();
  return {
    next() {
      return reader.read();
    },
    return() {
      reader.releaseLock();
      return {};
    },
    [Symbol.asyncIterator]() {
      return this;
    },
  };
}

async function request({ url, method = "GET", headers = {}, fetchOptions = {}, body, signal }) {
  if (body) {
    body = await collect(body);
  }
  const res = await fetch(url, {
    ...fetchOptions,
    method,
    headers,
    body,
    signal: signal || fetchOptions.signal,
  });
  const iter =
    res.body && res.body.getReader ? fromStream(res.body) : [new Uint8Array(await res.arrayBuffer())];
  const resHeaders = {};
  for (const [key, value] of res.headers.entries()) resHeaders[key] = value;
  return {
    url: res.url,
    method: res.method,
    statusCode: res.status,
    statusMessage: res.statusText,
    body: iter,
    headers: resHeaders,
  };
}

module.exports = { request };
