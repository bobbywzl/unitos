# claude/optimistic-keller-tt8o52

**Intent:** Folders inside a project: the reader makes folders (a folder can hold folders), moves documents into them, and the document list under the header's pill draws each folder as a row whose own list opens beside it on hover, so the tree reads as a menu.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260923150000_document_folders/migration.sql`: `DocumentFolder` (notebookId, title, parentId, createdAt) and `NotebookDocument.folderId` (null = the project itself; `ON DELETE SET NULL`).
- `src/app/api/notebooks/[notebookId]/folders/route.ts` (new): `POST {title, parentId?}` makes a folder (editor).
- `src/app/api/notebooks/[notebookId]/folders/[folderId]/route.ts` (new): `PATCH {title?, parentId?}` renames or moves a folder, refusing a move into itself or a folder under it; `DELETE` moves what the folder holds up one level, then deletes it.
- `src/app/api/notebooks/[notebookId]/documents/[documentId]/route.ts`: `PATCH {folderId}` moves the attachment into a folder, or out of every folder with null; the fourth exclusive option of the body.
- `src/components/reader/document-folders.tsx` (new): the tree of rows (`DocumentTree`): folders first, by title, then the level's documents, then New folder. On md and up a folder row opens its list beside it on hover or press — a fixed panel in a portal, since the root list scrolls and would clip it — one open list per level; below md a press opens the list under the row, and the open document's folders open on their own. A folder's ⋯: New folder inside, Rename folder, Move to folder, Delete folder. `FolderPicker`: the project itself and every folder, indented by depth, for a move.
- `src/components/reader/document-bar.tsx`: `folders` prop; `folderId` on `AttachedDocument`; the flat map becomes `renderDocumentRow`, placed by the tree; Move to folder in a document's ⋯; a press in a fly-out counts as inside the list.
- `src/components/reader/workspace.tsx`, `src/app/n/[notebookId]/page.tsx`: the folders and each attachment's `folderId` ride from the page to the bar.
- `src/components/icons.tsx`: `FolderIcon`.
- `src/lib/i18n/dict/panes.ts`, `dict/api.ts`, `dict/common.ts`: the folder strings, en and zh; `folder 文件夹` in the glossary.
- `CLAUDE.md`, `SPEC.md` §3 and §6: the term and the behavior.

**Decisions:**
- Folders sort by title (numeric, case aside), documents keep the attach order: no order column, no drag to reorder. Reordering can come later with a column.
- Nesting is unbounded in the data; the UI opens one list per level, so a deep tree still reads as a menu.
- Delete folder moves the folder's documents and folders up one level rather than refusing or deleting them: nothing leaves the project.
- A hover on a sibling document row does not close an open fly-out; only hovering another folder, or leaving the list, does. This avoids the diagonal-move problem of cascading menus.
- No AI feature reads folders; the digest stays as it is.
- A new document lands outside every folder; the reader moves it. No "add into this folder" yet.
