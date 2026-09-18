/* Offline (SPEC.md §17). The service worker keeps Unitos loading without a
   network: the app's static files as they load, the offline page, and the
   pages and images of every project saved for offline, which
   lib/offline/saved.ts writes into a cache named after the project. GET only,
   same origin only. Every other request passes through untouched.

   - /_next/static/: cache first. The files are content-hashed, so a cached
     one never goes stale.
   - A page load: network first. Online, a page a saved copy holds is
     refreshed in that copy. Offline, the saved copy answers; anything else
     answers with the offline page, which lists the saved projects.
   - An image of a document or a note: network first, the saved copy second.
   - RSC fetches (the router's soft navigations) are never answered from the
     cache: when one fails offline the router falls back to a full load, and
     that load is what the cache answers. */

const SHELL = "unitos-shell-v1";
const STATIC = "unitos-static-v1";
const PROJECT_PREFIX = "unitos-project-";
const SHELL_URLS = ["/offline", "/icon.png", "/manifest.webmanifest"];
// The routes that need a model (lib/offline/ai-routes.ts keeps the same
// pattern for the client): offline, a call answers 503 with the plain
// message, in the app's language — the page posts it on every load, and
// it is kept in the shell cache so a restarted worker still has it.
const AI_ROUTE =
  /^\/api\/(derive|assistant(\/.*)?|notes\/gist|notes\/voice|documents\/[^/]+\/(glossary|translate|convert|reparse|transcribe|finish|article|figure|speakers)|multi(\/.*)?|notebooks\/[^/]+\/(connect|stitch)|drive\/import)$/;
const LANG_KEY = "/__lang";
const OFFLINE_AI = {
  en: "AI is off while offline. Notes, highlights, comments, and edits save on this device and sync when you are back online.",
  zh: "离线时 AI 不可用。笔记、高亮、评论和编辑会保存在此设备上，联网后同步。",
};

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "lang" || !(data.lang in OFFLINE_AI)) return;
  event.waitUntil(caches.open(SHELL).then((cache) => cache.put(LANG_KEY, new Response(data.lang))));
});

async function offlineAiResponse(request) {
  let lang = "en";
  try {
    const hit = await (await caches.open(SHELL)).match(LANG_KEY);
    const stored = hit ? await hit.text() : "";
    if (stored in OFFLINE_AI) lang = stored;
  } catch {
    // The default stands.
  }
  // Merge with AI shares its route with Join text, which queues; only the
  // AI mode answers with the message.
  if (new URL(request.url).pathname === "/api/notes/merge") {
    const body = await request.clone().json().catch(() => null);
    if (!body || body.mode !== "ai") throw new Error("not an AI call");
  }
  return new Response(JSON.stringify({ error: OFFLINE_AI[lang] }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
}

const STATIC_RE = /\/_next\/static\/[^"'\s)\\]+/g;

function fresh(res) {
  return res && res.ok && res.type === "basic" && !res.redirected;
}

// One static file into the static cache, once; a stylesheet's fonts with it.
async function keepStatic(cache, url) {
  if (await cache.match(url)) return;
  const res = await fetch(url);
  if (!fresh(res)) return;
  if (url.endsWith(".css")) {
    const text = await res.clone().text();
    await cache.put(url, res);
    for (const media of new Set(text.match(STATIC_RE) || [])) {
      await keepStatic(cache, media).catch(() => undefined);
    }
  } else {
    await cache.put(url, res);
  }
}

// The shell: the offline page with the chunks it loads (nobody visits it
// online, so they are fetched here), the icon, and the manifest.
async function warmShell() {
  const shell = await caches.open(SHELL);
  const statics = await caches.open(STATIC);
  for (const url of SHELL_URLS) {
    try {
      const res = await fetch(new Request(url, { cache: "reload" }));
      if (!fresh(res)) continue;
      if (url === "/offline") {
        const text = await res.clone().text();
        await shell.put(url, res);
        for (const chunk of new Set(text.match(STATIC_RE) || [])) {
          await keepStatic(statics, chunk).catch(() => undefined);
        }
      } else {
        await shell.put(url, res);
      }
    } catch {
      // Offline at install: the next install tries again.
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(warmShell().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function isStatic(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isAsset(url) {
  return /^\/api\/(images\/[^/]+|documents\/[^/]+\/(figure|page)\/[^/]+)$/.test(url.pathname);
}

function isShell(url) {
  return SHELL_URLS.includes(url.pathname);
}

// The cache that already holds this URL — a saved project's or the shell —
// so a fetch made online refreshes the copy.
async function cacheHolding(url) {
  for (const name of await caches.keys()) {
    if (name !== SHELL && !name.startsWith(PROJECT_PREFIX)) continue;
    const cache = await caches.open(name);
    if (await cache.match(url, { ignoreVary: true })) return cache;
  }
  return null;
}

async function cachedPage(url) {
  const exact = await caches.match(url.href, { ignoreVary: true });
  if (exact) return exact;
  // A project URL with no document named opens the project's first document,
  // which the bare URL holds.
  if (url.search && !url.searchParams.has("doc")) {
    return caches.match(url.origin + url.pathname, { ignoreVary: true });
  }
  return undefined;
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const res = await fetch(request);
  if (fresh(res)) await cache.put(request.url, res.clone());
  return res;
}

async function networkFirst(request, navigate) {
  const url = new URL(request.url);
  try {
    const res = await fetch(request);
    if (fresh(res)) {
      const cache = await cacheHolding(url.href);
      if (cache) await cache.put(url.href, res.clone());
    }
    return res;
  } catch (err) {
    const cached = navigate
      ? await cachedPage(url)
      : await caches.match(url.href, { ignoreVary: true });
    if (cached) return cached;
    if (navigate) {
      const offline = await caches.match("/offline", { ignoreVary: true });
      if (offline) return offline;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method !== "GET") {
    if (AI_ROUTE.test(url.pathname) || url.pathname === "/api/notes/merge") {
      event.respondWith(
        fetch(request).catch((err) => offlineAiResponse(request).catch(() => Promise.reject(err))),
      );
    }
    return;
  }
  if (isStatic(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, true));
    return;
  }
  if (request.headers.has("RSC") || request.headers.has("Next-Router-Prefetch")) return;
  if (isAsset(url) || isShell(url)) {
    event.respondWith(networkFirst(request, false));
  }
});
