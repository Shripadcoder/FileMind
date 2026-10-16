const TOKEN_KEY = "filemind_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(path, { ...options, headers });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : res.statusText;
    throw new ApiError(res.status, detail);
  }
  return data as T;
}

/* ---------- types ---------- */

export interface User {
  id: number;
  email: string;
  display_name: string;
  created_at: string;
}

export interface Folder {
  id: number;
  parent_id: number | null;
  name: string;
  description: string;
  is_trashed: boolean;
  created_at: string;
  updated_at: string;
}

export interface FolderWithPath extends Folder {
  path: Folder[];
}

export interface Category {
  id: number;
  name: string;
  is_system: boolean;
}

export interface Tag {
  id: number;
  name: string;
}

export interface FileItem {
  id: number;
  original_filename: string;
  folder_id: number | null;
  category_id: number | null;
  category_name: string | null;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  description: string;
  is_favorite: boolean;
  tags: string[];
  is_trashed: boolean;
  duplicate_count: number;
  created_at: string;
  updated_at: string;
}

export interface UploadResult extends FileItem {
  suggested_category: string;
  suggestion_source: string;
}

export interface DuplicateGroup {
  sha256: string;
  size_bytes: number;
  files: FileItem[];
}

export interface FileSearchParams {
  q?: string;
  folder_id?: number | null;
  category?: string;
  tag?: string;
  mime?: string;
  is_favorite?: boolean;
  include_trashed?: boolean;
  trashed_only?: boolean;
  duplicates_only?: boolean;
  sort?: string;
  order?: string;
  limit?: number;
  offset?: number;
}

/* ---------- health (Phase 1) ---------- */

export async function getHealth(): Promise<{ status: string; service?: string }> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health check failed: ${res.status}`);
  return res.json();
}

export async function getReady(): Promise<{ status: string; database?: string }> {
  const res = await fetch("/api/ready");
  if (!res.ok) throw new Error(`readiness check failed: ${res.status}`);
  return res.json();
}

/* ---------- auth ---------- */

export function register(
  email: string,
  password: string,
  displayName: string,
): Promise<{ access_token: string }> {
  return apiFetch("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
}

export function login(email: string, password: string): Promise<{ access_token: string }> {
  return apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function me(): Promise<User> {
  return apiFetch("/api/auth/me");
}

/* ---------- folders ---------- */

export function listFolders(parentId?: number | null, includeTrashed = false): Promise<Folder[]> {
  const params = new URLSearchParams();
  if (parentId !== undefined && parentId !== null) params.set("parent_id", String(parentId));
  if (includeTrashed) params.set("include_trashed", "true");
  const qs = params.toString();
  return apiFetch(`/api/folders${qs ? `?${qs}` : ""}`);
}

export async function listAllFolders(): Promise<Folder[]> {
  // Walk the tree breadth-first; fine for Phase 2 collection sizes.
  const all: Folder[] = [];
  const seen = new Set<number>();
  const queue: Array<number | undefined> = [undefined]; // undefined = top-level roots
  while (queue.length > 0) {
    const parentId = queue.shift();
    const kids = await listFolders(parentId, true);
    for (const kid of kids) {
      if (seen.has(kid.id)) continue;
      seen.add(kid.id);
      all.push(kid);
      queue.push(kid.id);
    }
  }
  return all;
}

export function createFolder(name: string, parentId: number | null): Promise<Folder> {
  return apiFetch("/api/folders", {
    method: "POST",
    body: JSON.stringify({ name, parent_id: parentId }),
  });
}

export function updateFolder(
  id: number,
  patch: { name?: string; parent_id?: number | null; description?: string },
  moveToRoot = false,
): Promise<Folder> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.parent_id !== undefined) body.parent_id = patch.parent_id;
  else if (moveToRoot) body.parent_id = null;
  return apiFetch(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function getFolder(id: number): Promise<FolderWithPath> {
  return apiFetch(`/api/folders/${id}`);
}

export function trashFolder(id: number): Promise<Folder> {
  return apiFetch(`/api/folders/${id}/trash`, { method: "POST" });
}

export function restoreFolder(id: number): Promise<Folder> {
  return apiFetch(`/api/folders/${id}/restore`, { method: "POST" });
}

export function deleteFolder(id: number, permanent: boolean): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/folders/${id}?permanent=${permanent ? "true" : "false"}`, {
    method: "DELETE",
  });
}

/* ---------- files ---------- */

function searchQuery(params: FileSearchParams): string {
  const p = new URLSearchParams();
  if (params.q) p.set("q", params.q);
  if (params.folder_id !== undefined && params.folder_id !== null) {
    p.set("folder_id", String(params.folder_id));
  }
  if (params.category) p.set("category", params.category);
  if (params.tag) p.set("tag", params.tag);
  if (params.mime) p.set("mime", params.mime);
  if (params.is_favorite !== undefined) p.set("is_favorite", String(params.is_favorite));
  if (params.include_trashed) p.set("include_trashed", "true");
  if (params.trashed_only) p.set("trashed_only", "true");
  if (params.duplicates_only) p.set("duplicates_only", "true");
  if (params.sort) p.set("sort", params.sort);
  if (params.order) p.set("order", params.order);
  if (params.limit !== undefined) p.set("limit", String(params.limit));
  if (params.offset !== undefined) p.set("offset", String(params.offset));
  return p.toString();
}

export function listFiles(params: FileSearchParams = {}): Promise<FileItem[]> {
  const qs = searchQuery(params);
  return apiFetch(`/api/files${qs ? `?${qs}` : ""}`);
}

export function getFile(id: number): Promise<FileItem> {
  return apiFetch(`/api/files/${id}`);
}

export function updateFile(
  id: number,
  patch: {
    original_filename?: string;
    folder_id?: number | null;
    category_name?: string;
    description?: string;
    is_favorite?: boolean;
    tags?: string[];
  },
): Promise<FileItem> {
  return apiFetch(`/api/files/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function trashFile(id: number): Promise<FileItem> {
  return apiFetch(`/api/files/${id}/trash`, { method: "POST" });
}

export function restoreFile(id: number): Promise<FileItem> {
  return apiFetch(`/api/files/${id}/restore`, { method: "POST" });
}

export function deleteFile(id: number, permanent: boolean): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/files/${id}?permanent=${permanent ? "true" : "false"}`, {
    method: "DELETE",
  });
}

export function listDuplicates(): Promise<DuplicateGroup[]> {
  return apiFetch("/api/files/duplicates");
}

export interface UploadArgs {
  file: File;
  folderId: number | null;
  category?: string;
  description?: string;
  tags?: string;
  isFavorite?: boolean;
}

export function uploadFile(args: UploadArgs): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", args.file);
  if (args.folderId !== null && args.folderId !== undefined) {
    form.append("folder_id", String(args.folderId));
  }
  if (args.category) form.append("category", args.category);
  form.append("description", args.description ?? "");
  form.append("tags", args.tags ?? "");
  form.append("is_favorite", args.isFavorite ? "true" : "false");
  return apiFetch("/api/files/upload", { method: "POST", body: form });
}

async function authedBlob(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (data && typeof data.detail === "string") detail = data.detail;
    } catch {
      /* keep status text */
    }
    throw new ApiError(res.status, detail);
  }
  return res.blob();
}

export function downloadBlob(id: number): Promise<Blob> {
  return authedBlob(`/api/files/${id}/download`);
}

export function previewBlob(id: number): Promise<Blob> {
  return authedBlob(`/api/files/${id}/preview`);
}

/* ---------- taxonomy ---------- */

export function listCategories(): Promise<Category[]> {
  return apiFetch("/api/categories");
}

export function createCategory(name: string): Promise<Category> {
  return apiFetch("/api/categories", { method: "POST", body: JSON.stringify({ name }) });
}

export function renameCategory(id: number, name: string): Promise<Category> {
  return apiFetch(`/api/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export function deleteCategory(id: number): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/categories/${id}`, { method: "DELETE" });
}

export function listTags(): Promise<Tag[]> {
  return apiFetch("/api/tags");
}

export function deleteTag(id: number): Promise<{ deleted: boolean }> {
  return apiFetch(`/api/tags/${id}`, { method: "DELETE" });
}

/* ---------- formatting ---------- */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
