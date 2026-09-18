# claude/sleepy-lamport-s0zx2i

**Intent:** Offline copies (SPEC.md §17, Unitos Ultra): Save for offline keeps a project's pages and images in the browser, a service worker loads them without a network, and offline Unitos shows only the saved projects, like Google Drive offline in Chrome.

**Files:**
- `public/sw.js` — the service worker: static files cache first; page loads network first, the saved copy second, the offline page last; document and note images network first, the copy second; the offline page and its chunks cached at install; any cached page or image refreshed when fetched online. RSC fetches pass through.
- `src/components/offline/service-worker.tsx` — registers the worker in production; mounted in `src/app/layout.tsx`.
- `src/lib/offline/db.ts` — the one IndexedDB opener of offline work (version 2, the new `saved` store); `src/lib/offline/queue.ts` now imports it instead of opening its own.
- `src/lib/offline/saved.ts` — the saved-projects store and the saver: fetches the project's pages (the reader per document, the notes full page) and their images into `unitos-project-<id>`, the chunks and fonts they load into the static cache; list, remove, clear on sign out, background refresh of copies older than an hour.
- `src/app/api/notebooks/[notebookId]/offline/route.ts` — what a copy holds (title, section count, documents); 403 below Ultra: the gate.
- `src/app/offline/page.tsx`, `src/components/offline/offline-shelf.tsx` — the offline page: this account's saved projects from IndexedDB, plain links so the worker answers the load; goes to Projects on the online event.
- `src/components/works/work-card.tsx`, `works-shelf.tsx`, `src/app/page.tsx` — Save for offline / Remove offline copy in the ⋯ menu, the Offline badge, the Ultra mark on the item below Ultra, the one-line toast; the shelf passes `ultra` and `billing`.
- `src/components/settings-form.tsx` — the count of saved projects under Your data; sign out removes the copies first.
- `src/middleware.ts` — `/offline` and `/sw.js` are public doors.
- `src/lib/i18n/dict/{works,common,api,settings}.ts` — en and zh strings; the zh glossary gains offline copy 离线副本 and Save for offline 离线保存.
- `SPEC.md` §17, `TIERS.md`, `CLAUDE.md` — the feature, the tier decision (2026-09-18), the vocabulary.

**Decisions:**
- The copy is the rendered pages, not the data: the reader and the notes page are server components, so caching their HTML (with the embedded RSC payload) is the one way to open them offline without a second client renderer. A copy refreshes when the page is fetched online and in the background after an hour.
- Save for offline lives on the dashboard card's ⋯ menu only, not in the reader header, which is full.
- Videos and the assistant's page are not part of a copy; the video pane needs the network.
- The route is the gate (403 below Ultra); the client's Ultra mark and message are a courtesy, like Visualize.
- Verified end to end on the production build with headless Chromium: save, kill the server and set the browser offline, load the dashboard (offline page lists the project), the reader (hydrates, offline pill shows), the notes page, an unsaved page (offline page), the card on the offline page, back online, remove.
