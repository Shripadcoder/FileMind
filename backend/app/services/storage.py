"""File-binary storage behind a small interface.

LocalFilesystemBackend is the Phase 2 implementation; a future object-storage
backend (S3/GCS) can implement the same methods. Binaries are keyed by a
random uuid hex plus owner id — the user-supplied filename never touches the
filesystem, which blocks path traversal by construction."""

import os
import re
import shutil
import uuid
from typing import BinaryIO, Protocol

from app.core.config import settings

_STORED_NAME_RE = re.compile(r"^[a-f0-9]{32}$")


def new_stored_name() -> str:
    return uuid.uuid4().hex


class StorageBackend(Protocol):
    def save_stream(
        self, owner_id: int, stored_name: str, stream: BinaryIO, max_bytes: int
    ) -> tuple[str, int]:
        """Persist stream, enforcing max_bytes. Returns (abs_path, size)."""
        ...

    def open(self, owner_id: int, stored_name: str) -> BinaryIO: ...
    def delete(self, owner_id: int, stored_name: str) -> bool: ...


class LocalStorageBackend:
    @property
    def base_dir(self) -> str:
        # Read settings at call time so tests can point at a temp directory.
        return os.path.abspath(settings.storage_dir)

    def _checked_name(self, stored_name: str) -> str:
        if not _STORED_NAME_RE.match(stored_name):
            raise ValueError("invalid stored name")
        return stored_name

    def _path(self, owner_id: int, stored_name: str) -> str:
        path = os.path.abspath(
            os.path.join(self.base_dir, str(int(owner_id)), self._checked_name(stored_name))
        )
        if not path.startswith(self.base_dir + os.sep):
            raise ValueError("path escapes storage directory")
        return path

    def save_stream(
        self, owner_id: int, stored_name: str, stream: BinaryIO, max_bytes: int
    ) -> tuple[str, int]:
        dest = self._path(owner_id, stored_name)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        tmp = dest + ".part"
        size = 0
        with open(tmp, "wb") as out:
            while True:
                chunk = stream.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes:
                    out.close()
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                    raise OversizeError(size)
                out.write(chunk)
        os.replace(tmp, dest)
        return dest, size

    def open(self, owner_id: int, stored_name: str) -> BinaryIO:
        return open(self._path(owner_id, stored_name), "rb")

    def delete(self, owner_id: int, stored_name: str) -> bool:
        try:
            os.remove(self._path(owner_id, stored_name))
            return True
        except FileNotFoundError:
            return False
        except OSError:
            return False


class OversizeError(Exception):
    def __init__(self, size: int):
        super().__init__(f"upload exceeds size limit ({size} bytes)")
        self.size = size


def get_storage() -> StorageBackend:
    return LocalStorageBackend()


def remove_blob_quietly(owner_id: int, stored_name: str) -> None:
    try:
        LocalStorageBackend().delete(owner_id, stored_name)
    except (ValueError, OSError):
        pass


def copy_blob_to(src_path: str, owner_id: int, stored_name: str) -> None:
    """Helper used only by tests/admin tooling; not part of the interface."""
    backend = LocalStorageBackend()
    dest = backend._path(owner_id, stored_name)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.copyfile(src_path, dest)
