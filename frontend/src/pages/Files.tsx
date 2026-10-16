import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Download,
  Eye,
  File as FileIcon,
  Folder as FolderIcon,
  Heart,
  RotateCcw,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import {
  ApiError,
  createFolder,
  deleteFile,
  deleteFolder,
  downloadBlob,
  extractFile,
  fileContent,
  fileGoals,
  fileSummary,
  formatBytes,
  formatDate,
  getFile,
  getFolder,
  getGoalWithLinks,
  linkFileToGoal,
  listAllFolders,
  listCategories,
  listDuplicates,
  listFiles,
  listFolders,
  listGoals,
  previewBlob,
  restoreFile,
  restoreFolder,
  suggestForFile,
  trashFile,
  trashFolder,
  unlinkFileFromGoal,
  updateFile,
  updateFolder,
  uploadFile,
} from "../lib/api";
import type {
  Category,
  ContentOut,
  DuplicateGroup,
  FileItem,
  Folder,
  GoalItem,
  GoalLink,
  SuggestOut,
  SummaryOut,
  TaskItem,
  UploadResult,
} from "../lib/api";
import { useAuth } from "../lib/auth";

type View = "browse" | "duplicates" | "trash";

const MIME_FILTERS = [
  { value: "", label: "All types" },
  { value: "image/", label: "Images" },
  { value: "application/pdf", label: "PDF" },
  { value: "text/", label: "Text" },
  { value: "application/", label: "Documents & archives" },
];

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl bg-white p-5 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="flex items-center gap-2 font-bold">
          <AlertTriangle size={18} className="text-amber-500" /> {title}
        </h2>
        <p className="mt-2 text-sm text-slate-500">{body}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function folderDepth(folders: Folder[], folder: Folder): number {
  let depth = 0;
  let current: Folder | undefined = folder;
  const byId = new Map(folders.map((f) => [f.id, f]));
  while (current?.parent_id != null) {
    depth += 1;
    current = byId.get(current.parent_id);
    if (depth > 50) break;
  }
  return depth;
}

function FolderMoveSelect({
  folders,
  value,
  excludeId,
  onChange,
  allowRoot = true,
}: {
  folders: Folder[];
  value: number | null;
  excludeId?: number;
  onChange: (id: number | null) => void;
  allowRoot?: boolean;
}) {
  return (
    <select
      value={value === null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
      aria-label="Destination folder"
    >
      {allowRoot && <option value="">No folder (home)</option>}
      {folders
        .filter((f) => f.id !== excludeId && !f.is_trashed)
        .map((f) => (
          <option key={f.id} value={f.id}>
            {"\u00a0\u00a0".repeat(folderDepth(folders, f))}{f.name}
          </option>
        ))}
    </select>
  );
}

function FileDetail({
  file,
  folders,
  categories,
  onChanged,
  onClose,
  notify,
}: {
  file: FileItem;
  folders: Folder[];
  categories: Category[];
  onChanged: (f: FileItem | null) => void;
  onClose: () => void;
  notify: (msg: string | null, isError?: boolean) => void;
}) {
  const [name, setName] = useState(file.original_filename);
  const [description, setDescription] = useState(file.description);
  const [categoryName, setCategoryName] = useState(file.category_name ?? "");
  const [tagsText, setTagsText] = useState(file.tags.join(", "));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(file.original_filename);
    setDescription(file.description);
    setCategoryName(file.category_name ?? "");
    setTagsText(file.tags.join(", "));
  }, [file]);

  async function save(patch: Parameters<typeof updateFile>[1]) {
    setBusy(true);
    notify(null);
    try {
      onChanged(await updateFile(file.id, patch));
      notify("Saved.");
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    try {
      const blob = await downloadBlob(file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.original_filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteFile(file.id, true);
      onChanged(null);
      onClose();
      notify("File permanently deleted.");
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <aside aria-label="File details" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <h2 className="break-all font-bold">{file.original_filename}</h2>
        <button onClick={onClose} className="text-sm text-slate-500 underline" aria-label="Close details">
          Close
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-slate-500">Size</dt><dd>{formatBytes(file.size_bytes)}</dd></div>
        <div><dt className="text-slate-500">Type</dt><dd className="break-all">{file.mime_type}</dd></div>
        <div><dt className="text-slate-500">Uploaded</dt><dd>{formatDate(file.created_at)}</dd></div>
        <div><dt className="text-slate-500">Modified</dt><dd>{formatDate(file.updated_at)}</dd></div>
        <div className="col-span-2">
          <dt className="text-slate-500">SHA-256</dt>
          <dd className="break-all font-mono text-xs">{file.sha256}</dd>
        </div>
        {file.duplicate_count > 0 && (
          <div className="col-span-2">
            <dt className="text-slate-500">Duplicates</dt>
            <dd>{file.duplicate_count} exact cop{file.duplicate_count === 1 ? "y" : "ies"} (same hash)</dd>
          </div>
        )}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => save({ is_favorite: !file.is_favorite })}
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
          aria-pressed={file.is_favorite}
        >
          <Star size={14} className={file.is_favorite ? "fill-amber-400 text-amber-400" : ""} />
          {file.is_favorite ? "Favorited" : "Favorite"}
        </button>
        <button
          onClick={download}
          className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
        >
          <Download size={14} /> Download
        </button>
        {file.is_trashed ? (
          <button
            onClick={() => restoreFile(file.id).then(onChanged).catch((e) => notify(errMsg(e), true))}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
          >
            <RotateCcw size={14} /> Restore
          </button>
        ) : (
          <button
            onClick={() => trashFile(file.id).then(onChanged).catch((e) => notify(errMsg(e), true))}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
          >
            <Trash2 size={14} /> Trash
          </button>
        )}
        <button
          onClick={() => setConfirmDelete(true)}
          className="flex items-center gap-1 rounded-lg border border-red-300 px-2 py-1 text-sm text-red-600"
        >
          <Trash2 size={14} /> Delete forever
        </button>
      </div>

      <LinkedGoals file={file} onChanged={onChanged} notify={notify} />

      <AIInsights file={file} onChanged={onChanged} notify={notify} />

      <form
        className="mt-4 flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            original_filename: name.trim() || file.original_filename,
            description: description.trim(),
            category_name: categoryName.trim() || undefined,
            tags: tagsText.split(",").map((t) => t.trim()).filter(Boolean),
          });
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Filename
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Category (type a new name to create a custom one)
          <input
            value={categoryName}
            onChange={(e) => setCategoryName(e.target.value)}
            list="filemind-categories"
            className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
          />
          <datalist id="filemind-categories">
            {categories.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Tags (comma separated)
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          Move to folder
          <FolderMoveSelect
            folders={folders}
            value={file.folder_id}
            onChange={(id) => void save({ folder_id: id })}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {busy ? "Saving…" : "Save changes"}
        </button>
      </form>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this file forever?"
          body="This permanently removes the file and its stored bytes. Trashed files can be restored; deleted files cannot."
          confirmLabel="Delete forever"
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </aside>
  );
}

export default function Files() {
  const { user, loading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<View>("browse");
  const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
  const [path, setPath] = useState<Folder[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [allFolders, setAllFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([]);
  const [trashFiles, setTrashFiles] = useState<FileItem[]>([]);
  const [trashFolders, setTrashFolders] = useState<Folder[]>([]);
  const [selected, setSelected] = useState<FileItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Filters (browse)
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [tag, setTag] = useState("");
  const [mime, setMime] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState("created_at");

  // New folder / rename
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmFolderDelete, setConfirmFolderDelete] = useState<Folder | null>(null);

  // Upload
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadTags, setUploadTags] = useState("");
  const [lastUpload, setLastUpload] = useState<UploadResult | null>(null);

  // Preview
  const [preview, setPreview] = useState<{ file: FileItem; url: string; kind: string } | null>(null);

  const searching = q.trim() !== "" || category !== "" || tag.trim() !== "" || mime !== "" || favoritesOnly;

  const notify = useCallback((msg: string | null, isError = false) => {
    if (isError) {
      setError(msg);
      setNotice(null);
    } else {
      setNotice(msg);
      setError(null);
    }
  }, []);

  const reload = useCallback(async () => {
    const [kids, all, cats] = await Promise.all([
      listFolders(currentFolderId),
      listAllFolders(),
      listCategories(),
    ]);
    setFolders(kids);
    setAllFolders(all);
    setCategories(cats);
    if (currentFolderId !== null) {
      setPath((await getFolder(currentFolderId)).path);
    } else {
      setPath([]);
    }
    if (searching) {
      setFiles(
        await listFiles({
          q: q.trim() || undefined,
          category: category || undefined,
          tag: tag.trim() || undefined,
          mime: mime || undefined,
          is_favorite: favoritesOnly || undefined,
          sort,
          limit: 200,
        }),
      );
    } else {
      const inFolder = await listFiles({ folder_id: currentFolderId, sort, limit: 200 });
      if (currentFolderId === null) {
        // Home shows root folders plus unfiled files; folder_id filter with
        // null is not expressible, so filter client-side from a wide query.
        const wide = await listFiles({ sort, limit: 200 });
        setFiles(wide.filter((f) => f.folder_id === null));
      } else {
        setFiles(inFolder);
      }
    }
    if (view === "duplicates") setDuplicates(await listDuplicates());
    if (view === "trash") {
      setTrashFiles(await listFiles({ trashed_only: true, limit: 200 }));
      setTrashFolders(all.filter((f) => f.is_trashed));
    }
  }, [currentFolderId, view, searching, q, category, tag, mime, favoritesOnly, sort]);

  useEffect(() => {
    if (!user) return;
    setBusy(true);
    reload()
      .catch((e) => setError(errMsg(e)))
      .finally(() => setBusy(false));
  }, [user, reload]);

  // Deep link: /files?open=<id> (used by goal links and dashboard entries).
  useEffect(() => {
    if (!user) return;
    const openId = searchParams.get("open");
    if (openId && !selected) {
      const id = Number(openId);
      if (Number.isInteger(id)) {
        getFile(id)
          .then(setSelected)
          .catch((e) => setError(errMsg(e)));
        setSearchParams({}, { replace: true });
      }
    }
    // Intentionally run once per login; selection changes must not re-trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const folderNameById = useMemo(() => new Map(allFolders.map((f) => [f.id, f.name])), [allFolders]);

  async function openPreview(file: FileItem) {
    notify(null);
    try {
      const blob = await previewBlob(file.id);
      const url = URL.createObjectURL(blob);
      const ext = file.original_filename.split(".").pop()?.toLowerCase() ?? "";
      const kind =
        file.mime_type.startsWith("image/") && ext !== "svg"
          ? "image"
          : file.mime_type === "application/pdf" || ext === "pdf"
            ? "pdf"
            : "text";
      setPreview({ file, url, kind });
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  async function download(file: FileItem) {
    try {
      const blob = await downloadBlob(file.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.original_filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    const input = fileInput.current;
    if (!input?.files?.length) {
      notify("Choose a file to upload.", true);
      return;
    }
    setBusy(true);
    notify(null);
    try {
      const result = await uploadFile({
        file: input.files[0],
        folderId: currentFolderId,
        category: uploadCategory || undefined,
        description: uploadDescription,
        tags: uploadTags,
      });
      setLastUpload(result);
      setSelected(result);
      input.value = "";
      setUploadDescription("");
      setUploadTags("");
      await reload();
      notify(
        `Uploaded “${result.original_filename}” → ${result.suggested_category} ` +
          `(${result.suggestion_source === "rule" ? "rule-based suggestion, correctable below" : "your chosen category"}).`,
      );
    } catch (err) {
      notify(errMsg(err), true);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">My Files</h1>
        <p className="text-sm text-slate-500">
          Sign in to manage your private file library.{" "}
          <Link to="/login" className="underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">My Files</h1>
        <div className="ml-auto flex gap-1" role="tablist" aria-label="File views">
          {(["browse", "duplicates", "trash"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => {
                setView(v);
                setSelected(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize ${
                view === v
                  ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                  : "border border-slate-200 dark:border-slate-700"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {notice && (
        <div role="status" className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {view === "browse" && (
        <>
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
            <button
              onClick={() => {
                setCurrentFolderId(null);
                setSelected(null);
              }}
              className={`rounded px-1 underline ${currentFolderId === null ? "font-bold" : ""}`}
            >
              Home
            </button>
            {path.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <span aria-hidden>/</span>
                <button
                  onClick={() => {
                    setCurrentFolderId(f.id);
                    setSelected(null);
                  }}
                  className={`rounded px-1 underline ${currentFolderId === f.id ? "font-bold" : ""}`}
                >
                  {f.name}
                </button>
              </span>
            ))}
          </nav>

          <form
            className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
            onSubmit={(e) => {
              e.preventDefault();
              void reload().catch((err) => setError(errMsg(err)));
            }}
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search filename, description, type…"
              aria-label="Search files"
              className="min-w-40 flex-1 rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              placeholder="tag"
              aria-label="Filter by tag"
              className="w-24 rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
            />
            <select
              value={mime}
              onChange={(e) => setMime(e.target.value)}
              aria-label="Filter by file type"
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
            >
              {MIME_FILTERS.map((m) => (
                <option key={m.label} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(e) => setFavoritesOnly(e.target.checked)}
              />
              <Heart size={14} /> Favorites
            </label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort files"
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
            >
              <option value="created_at">Newest</option>
              <option value="original_filename">Name</option>
              <option value="size_bytes">Size</option>
            </select>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Search
            </button>
            {searching && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setCategory("");
                  setTag("");
                  setMime("");
                  setFavoritesOnly(false);
                }}
                className="text-sm underline"
              >
                Clear
              </button>
            )}
          </form>

          {!searching && (
            <section aria-label="Folders" className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Folders</h2>
                <form
                  className="ml-auto flex gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newFolderName.trim()) return;
                    setBusy(true);
                    createFolder(newFolderName.trim(), currentFolderId)
                      .then(() => {
                        setNewFolderName("");
                        return reload();
                      })
                      .catch((err) => setError(errMsg(err)))
                      .finally(() => setBusy(false));
                  }}
                >
                  <input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="New folder name"
                    aria-label="New folder name"
                    className="w-40 rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700"
                  >
                    Create
                  </button>
                </form>
              </div>
              {folders.length === 0 ? (
                <p className="text-sm text-slate-500">No folders here yet.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {folders.map((f) => (
                    <li
                      key={f.id}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800"
                    >
                      <FolderIcon size={18} className="shrink-0 text-slate-400" />
                      {renamingId === f.id ? (
                        <form
                          className="flex flex-1 gap-1"
                          onSubmit={(e) => {
                            e.preventDefault();
                            updateFolder(f.id, { name: renameValue })
                              .then(() => {
                                setRenamingId(null);
                                return reload();
                              })
                              .catch((err) => setError(errMsg(err)));
                          }}
                        >
                          <input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            autoFocus
                            aria-label="Folder name"
                            className="w-full rounded border border-slate-300 bg-transparent px-1 text-sm dark:border-slate-600"
                          />
                          <button type="submit" className="text-sm underline">
                            Save
                          </button>
                        </form>
                      ) : (
                        <button
                          onClick={() => {
                            setCurrentFolderId(f.id);
                            setSelected(null);
                          }}
                          className="flex-1 truncate text-left text-sm font-medium hover:underline"
                        >
                          {f.name}
                        </button>
                      )}
                      <FolderMoveSelect
                        folders={allFolders}
                        value={f.parent_id}
                        excludeId={f.id}
                        onChange={(id) =>
                          updateFolder(f.id, {}, id === null)
                            .then(() => reload())
                            .catch((err) => setError(errMsg(err)))
                        }
                      />
                      <button
                        onClick={() => {
                          setRenamingId(f.id);
                          setRenameValue(f.name);
                        }}
                        className="text-xs underline"
                        aria-label={`Rename ${f.name}`}
                      >
                        Rename
                      </button>
                      <button
                        onClick={() =>
                          trashFolder(f.id)
                            .then(() => reload())
                            .catch((err) => setError(errMsg(err)))
                        }
                        className="text-xs underline"
                        aria-label={`Trash ${f.name}`}
                      >
                        Trash
                      </button>
                      <button
                        onClick={() => setConfirmFolderDelete(f)}
                        className="text-xs text-red-600 underline"
                        aria-label={`Delete ${f.name} forever`}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section aria-label="Files" className="flex flex-col gap-2">
            <h2 className="font-semibold">
              {searching ? `Results (${files.length})` : currentFolderId === null ? "Unfiled files" : "Files in this folder"}
            </h2>
            {files.length === 0 ? (
              <p className="text-sm text-slate-500">
                {searching ? "No files match these filters." : "No files here yet — upload one below."}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {files.map((f) => (
                  <li
                    key={f.id}
                    className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm dark:border-slate-800 ${
                      selected?.id === f.id ? "border-slate-400 bg-slate-50 dark:bg-slate-900" : "border-slate-200"
                    }`}
                  >
                    <FileIcon size={16} className="shrink-0 text-slate-400" />
                    <button
                      onClick={() => setSelected(selected?.id === f.id ? null : f)}
                      className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                      aria-expanded={selected?.id === f.id}
                    >
                      {f.original_filename}
                    </button>
                    {f.is_favorite && <Star size={14} className="fill-amber-400 text-amber-400" aria-label="Favorite" />}
                    {f.duplicate_count > 0 && (
                      <span className="rounded bg-amber-100 px-1.5 text-xs text-amber-800">
                        {f.duplicate_count} duplicate{f.duplicate_count === 1 ? "" : "s"}
                      </span>
                    )}
                    {f.goal_count > 0 && (
                      <span className="rounded bg-blue-100 px-1.5 text-xs text-blue-800">
                        {f.goal_count} goal link{f.goal_count === 1 ? "" : "s"}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">{f.category_name ?? "Uncategorized"}</span>
                    <span className="text-xs text-slate-500">{formatBytes(f.size_bytes)}</span>
                    {searching && f.folder_id !== null && (
                      <span className="text-xs text-slate-500">in {folderNameById.get(f.folder_id) ?? "…"}</span>
                    )}
                    <button onClick={() => void openPreview(f)} className="flex items-center gap-1 text-xs underline" aria-label={`Preview ${f.original_filename}`}>
                      <Eye size={13} /> Preview
                    </button>
                    <button onClick={() => void download(f)} className="flex items-center gap-1 text-xs underline" aria-label={`Download ${f.original_filename}`}>
                      <Download size={13} /> Download
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Upload" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <h2 className="flex items-center gap-2 font-semibold">
              <Upload size={16} /> Upload a file
              {currentFolderId !== null && (
                <span className="text-sm font-normal text-slate-500">→ {folderNameById.get(currentFolderId)}</span>
              )}
            </h2>
            <form onSubmit={(e) => void onUpload(e)} className="mt-2 flex flex-wrap items-end gap-2">
              <input
                ref={fileInput}
                type="file"
                aria-label="Choose file"
                className="text-sm"
              />
              <label className="flex flex-col gap-1 text-sm">
                Category (optional — otherwise suggested from the file type)
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
                >
                  <option value="">Auto-suggest</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Description
                <input
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Tags (comma separated)
                <input
                  value={uploadTags}
                  onChange={(e) => setUploadTags(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
              >
                {busy ? "Uploading…" : "Upload"}
              </button>
            </form>
            {lastUpload && (
              <p className="mt-2 text-sm text-slate-500">
                Last upload filed under <strong>{lastUpload.suggested_category}</strong> (
                {lastUpload.suggestion_source === "rule" ? "rule-based suggestion" : "your choice"}). Correct it
                in the file details panel if needed.
              </p>
            )}
          </section>
        </>
      )}

      {view === "duplicates" && (
        <section aria-label="Duplicate files" className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            Files grouped by SHA-256 hash — identical bytes, possibly different names. Each copy keeps its own
            stored bytes; deleting one never affects the others.
          </p>
          {duplicates.length === 0 ? (
            <p className="text-sm text-slate-500">No exact duplicates found.</p>
          ) : (
            duplicates.map((g) => (
              <div key={g.sha256} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                <p className="font-mono text-xs text-slate-500">
                  {g.sha256.slice(0, 16)}… · {formatBytes(g.size_bytes)} · {g.files.length} copies
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {g.files.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate">{f.original_filename}</span>
                      <span className="text-xs text-slate-500">{formatDate(f.created_at)}</span>
                      <button onClick={() => void download(f)} className="text-xs underline">
                        Download
                      </button>
                      <button
                        onClick={() =>
                          trashFile(f.id)
                            .then(() => reload())
                            .catch((err) => setError(errMsg(err)))
                        }
                        className="text-xs underline"
                      >
                        Trash
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      )}

      {view === "trash" && (
        <section aria-label="Trash" className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            Trashed items are hidden everywhere else. Restore them, or delete forever (this cannot be undone).
          </p>
          <h2 className="font-semibold">Trashed folders ({trashFolders.length})</h2>
          {trashFolders.length === 0 ? (
            <p className="text-sm text-slate-500">No trashed folders.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {trashFolders.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                  <FolderIcon size={16} className="text-slate-400" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <button
                    onClick={() => restoreFolder(f.id).then(() => void reload()).catch((err) => setError(errMsg(err)))}
                    className="text-xs underline"
                  >
                    Restore
                  </button>
                  <button onClick={() => setConfirmFolderDelete(f)} className="text-xs text-red-600 underline">
                    Delete forever
                  </button>
                </li>
              ))}
            </ul>
          )}
          <h2 className="font-semibold">Trashed files ({trashFiles.length})</h2>
          {trashFiles.length === 0 ? (
            <p className="text-sm text-slate-500">No trashed files.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {trashFiles.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800">
                  <FileIcon size={16} className="text-slate-400" />
                  <span className="flex-1 truncate">{f.original_filename}</span>
                  <button
                    onClick={() => restoreFile(f.id).then(() => void reload()).catch((err) => setError(errMsg(err)))}
                    className="text-xs underline"
                  >
                    Restore
                  </button>
                  <button
                    onClick={() =>
                      deleteFile(f.id, true)
                        .then(() => reload())
                        .catch((err) => setError(errMsg(err)))
                    }
                    className="text-xs text-red-600 underline"
                  >
                    Delete forever
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {selected && (
        <FileDetail
          file={selected}
          folders={allFolders}
          categories={categories}
          onChanged={(f) => {
            setSelected(f);
            void reload().catch((err) => setError(errMsg(err)));
          }}
          onClose={() => setSelected(null)}
          notify={notify}
        />
      )}

      {confirmFolderDelete && (
        <ConfirmDialog
          title={`Delete folder “${confirmFolderDelete.name}” forever?`}
          body="The folder must be empty first — move or delete its contents. This cannot be undone."
          confirmLabel="Delete forever"
          onConfirm={() =>
            deleteFolder(confirmFolderDelete.id, true)
              .then(() => {
                setConfirmFolderDelete(null);
                return reload();
              })
              .catch((err) => {
                setConfirmFolderDelete(null);
                setError(errMsg(err));
              })
          }
          onCancel={() => setConfirmFolderDelete(null)}
        />
      )}

      {preview && (
        <PreviewModal
          file={preview.file}
          url={preview.url}
          kind={preview.kind}
          onClose={() => {
            URL.revokeObjectURL(preview.url);
            setPreview(null);
          }}
        />
      )}
    </div>
  );
}

function PreviewModal({
  file,
  url,
  kind,
  onClose,
}: {
  file: FileItem;
  url: string;
  kind: string;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (kind !== "text") return;
    fetch(url)
      .then((r) => r.text())
      .then((t) => setText(t.slice(0, 50000)))
      .catch(() => setText("(could not load preview)"));
  }, [url, kind]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${file.original_filename}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white p-4 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="truncate font-bold">{file.original_filename}</h2>
          <button onClick={onClose} className="text-sm underline" aria-label="Close preview">
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200 dark:border-slate-700">
          {kind === "image" && <img src={url} alt={file.original_filename} className="mx-auto max-h-[70vh]" />}
          {kind === "pdf" && <iframe src={url} title={file.original_filename} className="h-[70vh] w-full" />}
          {kind === "text" && (
            <pre className="whitespace-pre-wrap p-3 text-xs">{text ?? "Loading…"}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

function LinkedGoals({
  file,
  onChanged,
  notify,
}: {
  file: FileItem;
  onChanged: (f: FileItem | null) => void;
  notify: (msg: string | null, isError?: boolean) => void;
}) {
  const [links, setLinks] = useState<GoalLink[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [pickGoal, setPickGoal] = useState("");
  const [pickTask, setPickTask] = useState("");
  const [note, setNote] = useState("");

  const reloadLinks = useCallback(async () => {
    try {
      const [ls, gs] = await Promise.all([fileGoals(file.id), listGoals({ limit: 200 })]);
      setLinks(ls);
      setGoals(gs);
    } catch (e) {
      notify(errMsg(e), true);
    }
  }, [file.id, notify]);

  useEffect(() => {
    void reloadLinks();
  }, [reloadLinks]);

  async function pickGoalTasks(goalId: string) {
    setPickGoal(goalId);
    setPickTask("");
    if (!goalId) {
      setTasks([]);
      return;
    }
    try {
      setTasks((await getGoalWithLinks(Number(goalId))).tasks);
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <h3 className="text-sm font-semibold">Linked goals ({links.length})</h3>
      {links.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">
          Not attached to any goal yet. Link it so it shows up as a related resource.
        </p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1">
          {links.map((l) => (
            <li
              key={`${l.goal_id}-${l.task_id ?? "goal"}`}
              className="flex items-center gap-2 text-sm"
            >
              <span className="flex-1 truncate font-medium">{l.goal_title}</span>
              {l.task_title && (
                <span className="rounded bg-blue-100 px-1.5 text-xs text-blue-800">
                  {l.task_title}
                </span>
              )}
              <Link to={`/goals?open=${l.goal_id}`} className="text-xs underline">
                Open
              </Link>
              <button
                onClick={() =>
                  unlinkFileFromGoal(l.goal_id, file.id, l.task_id)
                    .then(() => reloadLinks())
                    .then(() => getFileRefreshed(file.id, onChanged))
                    .catch((err) => notify(errMsg(err), true))
                }
                className="text-xs text-red-600 underline"
                aria-label={`Unlink from ${l.goal_title}`}
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-2 flex flex-wrap items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pickGoal) return;
          linkFileToGoal(Number(pickGoal), {
            file_id: file.id,
            task_id: pickTask ? Number(pickTask) : null,
            note: note.trim(),
          })
            .then(() => {
              setPickGoal("");
              setPickTask("");
              setTasks([]);
              setNote("");
              notify("Goal linked.");
              return reloadLinks();
            })
            .then(() => getFileRefreshed(file.id, onChanged))
            .catch((err) => notify(errMsg(err), true));
        }}
      >
        <select
          value={pickGoal}
          onChange={(e) => void pickGoalTasks(e.target.value)}
          aria-label="Goal to link"
          className="max-w-40 rounded border border-slate-200 bg-transparent px-1 py-1 text-sm dark:border-slate-700"
        >
          <option value="">Choose a goal…</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
        {tasks.length > 0 && (
          <select
            value={pickTask}
            onChange={(e) => setPickTask(e.target.value)}
            aria-label="Attach to a specific task or the whole goal"
            className="max-w-36 rounded border border-slate-200 bg-transparent px-1 py-1 text-sm dark:border-slate-700"
          >
            <option value="">Whole goal</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        )}
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note"
          aria-label="Link note"
          className="w-24 rounded border border-slate-200 bg-transparent px-1 py-1 text-sm dark:border-slate-700"
        />
        <button type="submit" className="text-sm underline">
          Link
        </button>
      </form>
    </div>
  );
}

async function getFileRefreshed(
  id: number,
  onChanged: (f: FileItem | null) => void,
): Promise<void> {
  try {
    onChanged(await getFile(id));
  } catch {
    /* file may be gone; selection refresh already handled by callers */
  }
}

function AIInsights({
  file,
  onChanged,
  notify,
}: {
  file: FileItem;
  onChanged: (f: FileItem | null) => void;
  notify: (msg: string | null, isError?: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState<SummaryOut | null>(null);
  const [suggest, setSuggest] = useState<SuggestOut | null>(null);
  const [content, setContent] = useState<ContentOut | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    setLoaded(false);
    setSummary(null);
    setSuggest(null);
    setContent(null);
    setUnavailable(null);
  }, [file.id]);

  async function load() {
    setOpen(true);
    if (loaded) return;
    try {
      const [s, g] = await Promise.all([
        fileSummary(file.id).catch(() => null),
        suggestForFile(file.id).catch(() => null),
      ]);
      let c: ContentOut | null = null;
      try {
        c = await fileContent(file.id);
      } catch {
        c = null;
      }
      setSummary(s);
      setSuggest(g);
      setContent(c);
      if (!s && !g && !c) {
        setUnavailable(
          "No extracted text for this file type yet (text, PDF, and Word are supported).",
        );
      }
    } catch (e) {
      notify(errMsg(e), true);
    } finally {
      setLoaded(true);
    }
  }

  async function reExtract() {
    try {
      const res = await extractFile(file.id);
      if (!res.extracted) {
        setUnavailable(res.reason ?? "Extraction not available for this file type.");
        return;
      }
      setLoaded(false);
      setUnavailable(null);
      await load();
      notify("Text extracted.");
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  if (!open) {
    return (
      <button onClick={() => void load()} className="mt-3 text-sm underline">
        Show AI insights (summary & suggestions, computed locally)
      </button>
    );
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">AI insights</h3>
        <span className="rounded bg-green-100 px-1.5 text-xs text-green-800">local</span>
        <button onClick={() => setOpen(false)} className="ml-auto text-xs underline">
          Hide
        </button>
      </div>
      {!loaded ? (
        <p className="mt-1 text-xs text-slate-500">Analyzing…</p>
      ) : unavailable ? (
        <div className="mt-1 text-xs text-slate-500">
          <p>{unavailable}</p>
          <button onClick={() => void reExtract()} className="mt-1 underline">
            Try extracting again
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2 text-sm">
          {summary && summary.summary && (
            <div>
              <p className="text-xs font-semibold text-slate-500">SUMMARY (extractive)</p>
              <p className="mt-0.5">{summary.summary}</p>
            </div>
          )}
          {suggest && (
            <div>
              <p className="text-xs font-semibold text-slate-500">
                SUGGESTIONS ({suggest.source})
              </p>
              {suggest.suggested_category ? (
                <p className="mt-0.5">
                  Category: <strong>{suggest.suggested_category}</strong>
                  {suggest.confidence !== null && (
                    <span className="text-xs text-slate-500">
                      {" "}
                      (confidence {suggest.confidence.toFixed(2)})
                    </span>
                  )}{" "}
                  {suggest.suggested_category !== file.category_name && (
                    <button
                      onClick={() =>
                        updateFile(file.id, { category_name: suggest.suggested_category ?? "" })
                          .then((f) => {
                            onChanged(f);
                            notify("Category updated from suggestion.");
                          })
                          .catch((e) => notify(errMsg(e), true))
                      }
                      className="text-xs underline"
                    >
                      Accept
                    </button>
                  )}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-slate-500">
                  No confident category suggestion from content.
                </p>
              )}
              {suggest.suggested_tags.length > 0 && (
                <p className="mt-0.5">
                  Tags: {suggest.suggested_tags.join(", ")}{" "}
                  <button
                    onClick={() => {
                      const merged = Array.from(
                        new Set([...file.tags, ...suggest.suggested_tags]),
                      );
                      updateFile(file.id, { tags: merged })
                        .then((f) => {
                          onChanged(f);
                          notify("Tags updated from suggestions.");
                        })
                        .catch((e) => notify(errMsg(e), true));
                    }}
                    className="text-xs underline"
                  >
                    Accept
                  </button>
                </p>
              )}
              {suggest.novel_tags.length > 0 && (
                <p className="mt-0.5 text-xs text-slate-500">
                  New tag ideas: {suggest.novel_tags.join(", ")}
                </p>
              )}
            </div>
          )}
          {content && (
            <details>
              <summary className="cursor-pointer text-xs text-slate-500">
                Extracted text ({content.char_count.toLocaleString()} chars, {content.method}
                {content.page_refs.length > 1 ? `, ${content.page_refs.length} pages` : ""})
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs dark:bg-slate-900">
                {content.text.slice(0, 4000)}
                {content.text.length > 4000 ? "…" : ""}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
