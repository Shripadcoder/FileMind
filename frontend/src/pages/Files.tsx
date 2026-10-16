import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  Download,
  Eye,
  File as FileIcon,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder as FolderIcon,
  Heart,
  Home,
  LayoutGrid,
  List,
  Presentation,
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
  versionGroups as fetchVersionGroups,
  compareFiles,
} from "../lib/api";
import type {
  Category,
  CompareOut,
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
  VersionGroup,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, EmptyState, Notice, PageHeader, SegmentedTabs, Spinner, cardCls, inputCls } from "../components/ui";

function fileKind(filename: string): "pdf" | "image" | "code" | "sheet" | "slides" | "archive" | "doc" | "other" {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)) return "image";
  if (["py", "js", "ts", "tsx", "jsx", "java", "c", "h", "cpp", "go", "rs", "rb", "php", "html", "css", "json", "xml", "yml", "yaml", "sql", "sh", "ipynb"].includes(ext)) return "code";
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return "sheet";
  if (["ppt", "pptx", "odp"].includes(ext)) return "slides";
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) return "archive";
  if (["doc", "docx", "odt", "txt", "md", "rtf"].includes(ext)) return "doc";
  return "other";
}

function FileTypeIcon({ filename, size = 16 }: { filename: string; size?: number }) {
  const kind = fileKind(filename);
  const cls = "shrink-0";
  switch (kind) {
    case "pdf":
      return <FileText size={size} className={`${cls} text-red-500`} aria-hidden />;
    case "image":
      return <FileImage size={size} className={`${cls} text-violet-500`} aria-hidden />;
    case "code":
      return <FileCode2 size={size} className={`${cls} text-indigo-500`} aria-hidden />;
    case "sheet":
      return <FileSpreadsheet size={size} className={`${cls} text-green-600`} aria-hidden />;
    case "slides":
      return <Presentation size={size} className={`${cls} text-amber-500`} aria-hidden />;
    case "archive":
      return <FileArchive size={size} className={`${cls} text-slate-400`} aria-hidden />;
    case "doc":
      return <FileText size={size} className={`${cls} text-blue-500`} aria-hidden />;
    default:
      return <FileIcon size={size} className={`${cls} text-slate-400`} aria-hidden />;
  }
}

type View = "browse" | "duplicates" | "versions" | "trash";

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
        className="fm-pop w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-pop dark:border-slate-700 dark:bg-slate-900"
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
    <aside aria-label="File details" className={`${cardCls} fm-fade p-4 md:p-5`}>
      <div className="flex items-start gap-2">
        <FileTypeIcon filename={file.original_filename} size={22} />
        <h2 className="min-w-0 flex-1 break-all text-[15px] font-bold tracking-tight">{file.original_filename}</h2>
        <button onClick={onClose} className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Close details">
          ✕
        </button>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-slate-50 p-3 text-[13px] dark:bg-slate-800/60">
        <div><dt className="text-xs text-slate-400">Size</dt><dd className="fm-num font-medium">{formatBytes(file.size_bytes)}</dd></div>
        <div><dt className="text-xs text-slate-400">Type</dt><dd className="break-all font-medium">{file.mime_type}</dd></div>
        <div><dt className="text-xs text-slate-400">Uploaded</dt><dd className="font-medium">{formatDate(file.created_at)}</dd></div>
        <div><dt className="text-xs text-slate-400">Modified</dt><dd className="font-medium">{formatDate(file.updated_at)}</dd></div>
        <div className="col-span-2">
          <dt className="text-xs text-slate-400">SHA-256</dt>
          <dd className="break-all font-mono text-xs">{file.sha256}</dd>
        </div>
        {file.duplicate_count > 0 && (
          <div className="col-span-2">
            <dd><Badge tone="amber">{file.duplicate_count} exact {file.duplicate_count === 1 ? "copy" : "copies"} (same hash)</Badge></dd>
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
  const [versionGroups, setVersionGroups] = useState<VersionGroup[]>([]);
  const [compareA, setCompareA] = useState<number | null>(null);
  const [compareB, setCompareB] = useState<number | null>(null);
  const [compareResult, setCompareResult] = useState<CompareOut | null>(null);
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

  // Browse layout + drag-and-drop upload state.
  const [layout, setLayout] = useState<"list" | "grid">(
    () => (localStorage.getItem("filemind-files-layout") as "list" | "grid") || "list",
  );
  const [dragOver, setDragOver] = useState(false);

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
    if (view === "versions") setVersionGroups(await fetchVersionGroups());
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

  // Deep links: /files?open=<id> and /files?folder=<id>
  // (used by goal links, dashboard entries, and the knowledge graph).
  useEffect(() => {
    if (!user) return;
    const openId = searchParams.get("open");
    const folderId = searchParams.get("folder");
    if (folderId && currentFolderId === null) {
      const fid = Number(folderId);
      if (Number.isInteger(fid)) setCurrentFolderId(fid);
    }
    if (openId && !selected) {
      const id = Number(openId);
      if (Number.isInteger(id)) {
        getFile(id)
          .then(setSelected)
          .catch((e) => setError(errMsg(e)));
      }
    }
    if (openId || folderId) setSearchParams({}, { replace: true });
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

  async function doUpload(picked: File) {
    setBusy(true);
    notify(null);
    try {
      const result = await uploadFile({
        file: picked,
        folderId: currentFolderId,
        category: uploadCategory || undefined,
        description: uploadDescription,
        tags: uploadTags,
      });
      setLastUpload(result);
      setSelected(result);
      if (fileInput.current) fileInput.current.value = "";
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

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    const input = fileInput.current;
    if (!input?.files?.length) {
      notify("Choose a file to upload.", true);
      return;
    }
    await doUpload(input.files[0]);
  }

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="My Files" sub="Sign in to manage your private file library." />
        <EmptyState
          title="You're signed out"
          hint="Your library is private to your account."
          action={<Link to="/login" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Sign in</Link>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="My Files"
        sub={currentFolderId !== null ? `Browsing ${folderNameById.get(currentFolderId) ?? "folder"}` : "Your private document library."}
        actions={
          view === "browse" && (
            <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700" role="group" aria-label="Layout">
              <button
                onClick={() => {
                  setLayout("list");
                  localStorage.setItem("filemind-files-layout", "list");
                }}
                aria-pressed={layout === "list"}
                title="List view"
                className={`rounded-md p-1.5 ${layout === "list" ? "bg-slate-200 dark:bg-slate-700" : "text-slate-400"}`}
              >
                <List size={15} />
              </button>
              <button
                onClick={() => {
                  setLayout("grid");
                  localStorage.setItem("filemind-files-layout", "grid");
                }}
                aria-pressed={layout === "grid"}
                title="Grid view"
                className={`rounded-md p-1.5 ${layout === "grid" ? "bg-slate-200 dark:bg-slate-700" : "text-slate-400"}`}
              >
                <LayoutGrid size={15} />
              </button>
            </div>
          )
        }
      />
      <SegmentedTabs
        label="File views"
        value={view}
        onChange={(v) => {
          setView(v);
          setSelected(null);
        }}
        options={[
          { value: "browse", label: "Browse" },
          { value: "duplicates", label: "Duplicates" },
          { value: "versions", label: "Versions" },
          { value: "trash", label: "Trash" },
        ]}
      />

      {notice && <Notice kind="ok">{notice}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      {view === "browse" && (
        <>
          <nav aria-label="Breadcrumb" className={`${cardCls} flex flex-wrap items-center gap-1 px-3 py-2 text-sm`}>
            <button
              onClick={() => {
                setCurrentFolderId(null);
                setSelected(null);
              }}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${
                currentFolderId === null ? "text-indigo-600 dark:text-indigo-300" : "text-slate-500"
              }`}
            >
              <Home size={14} aria-hidden /> Home
            </button>
            {path.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <span aria-hidden className="text-slate-300 dark:text-slate-600">/</span>
                <button
                  onClick={() => {
                    setCurrentFolderId(f.id);
                    setSelected(null);
                  }}
                  className={`rounded-md px-2 py-1 transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 ${
                    currentFolderId === f.id ? "font-semibold text-indigo-600 dark:text-indigo-300" : "text-slate-600 dark:text-slate-300"
                  }`}
                >
                  {f.name}
                </button>
              </span>
            ))}
          </nav>

          <form
            className={`${cardCls} grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center`}
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
              className={`${inputCls} col-span-2 min-w-0 flex-1 lg:col-span-1`}
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by category"
              className={inputCls}
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
              className={`${inputCls} w-full lg:w-24`}
            />
            <select
              value={mime}
              onChange={(e) => setMime(e.target.value)}
              aria-label="Filter by file type"
              className={inputCls}
            >
              {MIME_FILTERS.map((m) => (
                <option key={m.label} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(e) => setFavoritesOnly(e.target.checked)}
                className="h-4 w-4 accent-indigo-600"
              />
              <Heart size={14} aria-hidden /> Favorites
            </label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              aria-label="Sort files"
              className={inputCls}
            >
              <option value="created_at">Newest</option>
              <option value="original_filename">Name</option>
              <option value="size_bytes">Size</option>
            </select>
            <div className="col-span-2 flex items-center gap-2 lg:col-span-1">
              <Button type="submit" variant="primary">Search</Button>
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
                  className="text-sm text-slate-500 underline"
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {!searching && (
            <section aria-label="Folders" className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-bold tracking-tight">Folders · {folders.length}</h2>
                <form
                  className="ml-auto flex gap-1.5"
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
                    className={`${inputCls} w-36 sm:w-44`}
                  />
                  <Button type="submit" disabled={busy}>Create</Button>
                </form>
              </div>
              {folders.length === 0 ? (
                <EmptyState title="No folders here yet" hint="Create one to start organizing." />
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {folders.map((f) => (
                    <li
                      key={f.id}
                      className={`${cardCls} group flex items-center gap-2.5 p-3 transition-shadow hover:shadow-pop`}
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400" aria-hidden>
                        <FolderIcon size={18} />
                      </span>
                      {renamingId === f.id ? (
                        <form
                          className="flex min-w-0 flex-1 gap-1"
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
                            className={`${inputCls} w-full px-1.5 py-1`}
                          />
                          <Button type="submit" variant="primary" className="!px-2.5 !py-1 !text-xs">Save</Button>
                        </form>
                      ) : (
                        <button
                          onClick={() => {
                            setCurrentFolderId(f.id);
                            setSelected(null);
                          }}
                          className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-indigo-600 dark:hover:text-indigo-300"
                          title={`Open ${f.name}`}
                        >
                          {f.name}
                        </button>
                      )}
                      <span className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                        <span title="Move to folder">
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
                        </span>
                        <button
                          onClick={() => {
                            setRenamingId(f.id);
                            setRenameValue(f.name);
                          }}
                          className="rounded-md px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800"
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
                          className="rounded-md px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800"
                          aria-label={`Trash ${f.name}`}
                        >
                          Trash
                        </button>
                        <button
                          onClick={() => setConfirmFolderDelete(f)}
                          className="rounded-md px-1.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                          aria-label={`Delete ${f.name} forever`}
                        >
                          Delete
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section aria-label="Files" className="flex flex-col gap-2.5">
            <h2 className="text-[15px] font-bold tracking-tight">
              {searching ? `Results · ${files.length}` : currentFolderId === null ? "Unfiled files" : `Files in this folder · ${files.length}`}
            </h2>
            {files.length === 0 ? (
              <EmptyState
                title={searching ? "No files match these filters" : "No files here yet"}
                hint={searching ? "Try different keywords or clear the filters." : "Upload your first file below — or drag and drop it anywhere onto the upload card."}
              />
            ) : layout === "grid" && !searching ? (
              <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                {files.map((f) => (
                  <li key={f.id}>
                    <button
                      onClick={() => setSelected(selected?.id === f.id ? null : f)}
                      aria-expanded={selected?.id === f.id}
                      className={`flex w-full flex-col items-center gap-1.5 rounded-xl border p-4 text-center transition-shadow hover:shadow-pop ${
                        selected?.id === f.id
                          ? "border-indigo-400 bg-indigo-50/50 dark:border-indigo-500 dark:bg-indigo-950/40"
                          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                      }`}
                    >
                      <FileTypeIcon filename={f.original_filename} size={30} />
                      <span className="w-full truncate text-[13px] font-medium" title={f.original_filename}>
                        {f.original_filename}
                      </span>
                      <span className="fm-num text-xs text-slate-400">{formatBytes(f.size_bytes)}</span>
                      <span className="flex flex-wrap justify-center gap-1">
                        {f.is_favorite && <Star size={12} className="fill-amber-400 text-amber-400" aria-label="Favorite" />}
                        {f.goal_count > 0 && <Badge tone="blue">{f.goal_count} linked</Badge>}
                        {f.duplicate_count > 0 && <Badge tone="amber">dup ×{f.duplicate_count}</Badge>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className={`${cardCls} divide-y divide-slate-100 overflow-hidden !p-0 dark:divide-slate-800`}>
                {files.map((f) => (
                  <li
                    key={f.id}
                    className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-2.5 text-sm transition-colors ${
                      selected?.id === f.id ? "bg-indigo-50/60 dark:bg-indigo-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}
                  >
                    <FileTypeIcon filename={f.original_filename} />
                    <button
                      onClick={() => setSelected(selected?.id === f.id ? null : f)}
                      className="min-w-0 flex-1 truncate text-left font-medium hover:text-indigo-600 dark:hover:text-indigo-300"
                      aria-expanded={selected?.id === f.id}
                      title={f.original_filename}
                    >
                      {f.original_filename}
                    </button>
                    {f.is_favorite && <Star size={14} className="shrink-0 fill-amber-400 text-amber-400" aria-label="Favorite" />}
                    {f.duplicate_count > 0 && (
                      <Badge tone="amber">{f.duplicate_count} duplicate{f.duplicate_count === 1 ? "" : "s"}</Badge>
                    )}
                    {f.goal_count > 0 && (
                      <Badge tone="blue">{f.goal_count} goal link{f.goal_count === 1 ? "" : "s"}</Badge>
                    )}
                    <Badge tone="slate">{f.category_name ?? "Uncategorized"}</Badge>
                    <span className="fm-num hidden text-xs text-slate-400 sm:inline">{formatBytes(f.size_bytes)}</span>
                    {searching && f.folder_id !== null && (
                      <span className="hidden text-xs text-slate-400 md:inline">in {folderNameById.get(f.folder_id) ?? "…"}</span>
                    )}
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <button onClick={() => void openPreview(f)} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800" aria-label={`Preview ${f.original_filename}`}>
                        <Eye size={13} /> Preview
                      </button>
                      <button onClick={() => void download(f)} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800" aria-label={`Download ${f.original_filename}`}>
                        <Download size={13} /> Download
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Upload" className={cardCls + " p-4 md:p-5"}>
            <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
              <Upload size={16} aria-hidden /> Upload a file
              {currentFolderId !== null && (
                <span className="text-sm font-normal text-slate-400">→ {folderNameById.get(currentFolderId)}</span>
              )}
            </h2>
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const picked = e.dataTransfer.files?.[0];
                if (picked) void doUpload(picked);
              }}
              className={`mt-3 rounded-xl border-2 border-dashed p-4 text-center transition-colors sm:p-6 ${
                dragOver
                  ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40"
                  : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <p className="text-sm font-medium">
                {busy ? "Uploading…" : dragOver ? "Drop to upload" : "Drag and drop a file here"}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">or choose a file below — PDF, docs, images, code, archives</p>
            </div>
            <form onSubmit={(e) => void onUpload(e)} className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-6 lg:items-end">
              <input
                ref={fileInput}
                type="file"
                aria-label="Choose file"
                className="col-span-2 text-sm file:mr-2 file:rounded-lg file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-50 dark:file:border-slate-700 dark:file:bg-slate-900 lg:col-span-2"
              />
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Category
                <select
                  value={uploadCategory}
                  onChange={(e) => setUploadCategory(e.target.value)}
                  className={inputCls}
                >
                  <option value="">Auto-suggest</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Description
                <input
                  value={uploadDescription}
                  onChange={(e) => setUploadDescription(e.target.value)}
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-500">
                Tags
                <input
                  value={uploadTags}
                  onChange={(e) => setUploadTags(e.target.value)}
                  placeholder="comma separated"
                  className={inputCls}
                />
              </label>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Uploading…" : "Upload"}
              </Button>
            </form>
            {lastUpload && (
              <p className="mt-2 rounded-lg bg-indigo-50 p-2.5 text-[13px] text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">
                Filed under <strong>{lastUpload.suggested_category}</strong> (
                {lastUpload.suggestion_source === "rule" ? "rule-based suggestion" : "your choice"}). Correct it
                in the details panel if needed.
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
            <EmptyState
              title="No exact duplicates found"
              hint="Files with byte-identical content (same SHA-256) will be grouped here."
            />
          ) : (
            duplicates.map((g) => (
              <div key={g.sha256} className={`${cardCls} p-3.5`}>
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

      {view === "versions" && (
        <section aria-label="Document versions" className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            Likely versions are grouped by a filename heuristic (same folder, same type, names
            differing only by version-like tokens). Pick any two files to compare their extracted
            text line by line.
          </p>
          {versionGroups.length === 0 ? (
            <EmptyState
              title="No version groups detected"
              hint="Files like report-v1.txt and report-v2.txt in the same folder are grouped here automatically."
            />
          ) : (
            versionGroups.map((g) => (
              <div key={g.key} className={`${cardCls} p-3.5`}>
                <p className="text-sm font-semibold">
                  {g.stem}
                  <span className="ml-2 text-xs font-normal text-slate-500">
                    {g.folder_name ?? "home"} · {g.extension} · {g.reason}
                  </span>
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {g.files.map((f) => (
                    <li key={f.id} className="flex items-center gap-2 text-sm">
                      <label className="flex items-center gap-1 text-xs" title="Compare as A (older)">
                        <input
                          type="radio"
                          name={`cmp-a-${g.key}`}
                          checked={compareA === f.id}
                          onChange={() => setCompareA(f.id)}
                          aria-label={`Compare ${f.original_filename} as A`}
                        />
                        A
                      </label>
                      <label className="flex items-center gap-1 text-xs" title="Compare as B (newer)">
                        <input
                          type="radio"
                          name={`cmp-b-${g.key}`}
                          checked={compareB === f.id}
                          onChange={() => setCompareB(f.id)}
                          aria-label={`Compare ${f.original_filename} as B`}
                        />
                        B
                      </label>
                      <span className="flex-1 truncate">{f.original_filename}</span>
                      <span className="text-xs text-slate-500">{formatDate(f.created_at)}</span>
                      <button onClick={() => void download(f)} className="text-xs underline">
                        Download
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
          <div>
            <button
              disabled={compareA === null || compareB === null || compareA === compareB}
              onClick={() => {
                if (compareA === null || compareB === null) return;
                compareFiles(compareA, compareB)
                  .then(setCompareResult)
                  .catch((err) => setError(errMsg(err)));
              }}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              Compare selected
            </button>
          </div>
        </section>
      )}

      {view === "trash" && (
        <section aria-label="Trash" className="flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            Trashed items are hidden everywhere else. Restore them, or delete forever (this cannot be undone).
          </p>
          <h2 className="text-[15px] font-bold tracking-tight">Trashed folders ({trashFolders.length})</h2>
          {trashFolders.length === 0 ? (
            <EmptyState title="No trashed folders" />
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
          <h2 className="text-[15px] font-bold tracking-tight">Trashed files ({trashFiles.length})</h2>
          {trashFiles.length === 0 ? (
            <EmptyState title="No trashed files" />
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

      {compareResult && (
        <CompareModal result={compareResult} onClose={() => setCompareResult(null)} />
      )}
    </div>
  );
}

function CompareModal({ result, onClose }: { result: CompareOut; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Compare ${result.names.a} with ${result.names.b}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white p-4 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="truncate font-bold">
            {result.names.a} → {result.names.b}
          </h2>
          <button onClick={onClose} className="text-sm underline" aria-label="Close comparison">
            Close
          </button>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          Similarity {(result.similarity * 100).toFixed(1)}% · +{result.added_lines} lines ·
          −{result.removed_lines} lines{result.truncated ? " · diff truncated" : ""}
        </p>
        <div className="min-h-0 flex-1 overflow-auto rounded border border-slate-200 font-mono text-xs dark:border-slate-700">
          {result.opcodes.map((op, i) => {
            if (op.type === "equal") {
              return (
                <p key={i} className="px-2 py-0.5 text-slate-400">
                  … {op.a[1] - op.a[0]} unchanged lines …
                </p>
              );
            }
            return (
              <div
                key={i}
                className={op.type === "added" ? "bg-green-50 dark:bg-green-950" : "bg-red-50 dark:bg-red-950"}
              >
                {op.lines.map((line, j) => (
                  <p key={j} className="whitespace-pre-wrap break-words px-2 py-0.5">
                    <span aria-hidden>{op.type === "added" ? "+" : "−"}</span> {line}
                  </p>
                ))}
              </div>
            );
          })}
        </div>
      </div>
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
        className="fm-pop flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-pop dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-tight">{file.original_filename}</h2>
          <button onClick={onClose} className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Close preview">
            ✕
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
