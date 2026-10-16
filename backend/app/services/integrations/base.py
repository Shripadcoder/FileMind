"""External provider integrations. Each provider is a small, honest client:

- public/unauthenticated APIs work with zero configuration,
- failures (offline, rate limits, unknown users) surface as clear 502/404
  errors — never fabricated data,
- anything written to FileMind (goals, activities) goes through the same
  validation and ownership checks as manual input.

Platforms without a public API (LeetCode, most course sites) are reported as
unavailable by the status endpoint with manual logging as the path forward."""

from dataclasses import dataclass


class ProviderError(Exception):
    """Upstream failure. Carries an HTTP status for the API layer."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class RepoInfo:
    owner: str
    name: str
    description: str
    html_url: str
    language: str | None
    stars: int
    updated_at: str | None


@dataclass
class CommitInfo:
    sha: str
    message: str
    author: str | None
    date: str | None
    html_url: str
