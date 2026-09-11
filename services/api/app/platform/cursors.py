"""Opaque keyset cursors for the app-facing list endpoints.

A cursor encodes the sort key and id of the last row a client received. Both
values are already present on every list response model, so the client can build
the next cursor from the last item it holds and no response envelope is needed —
which is what keeps pagination additive here: the endpoints still return a bare
JSON array, exactly as their contract tests require.

Keyset rather than offset because these lists are written while they are read; an
offset silently skips or repeats rows when something is inserted mid-pagination.
Admin lists deliberately stay on offset, since their numbered pager needs a total.
"""

from __future__ import annotations

import base64
import binascii
from datetime import datetime, timezone
from typing import Tuple

from app.platform.errors import ApiError

_SEPARATOR = "|"


def encode_cursor(sort_value: datetime, row_id: str) -> str:
    """Build the cursor a client would send to resume after this row."""
    if sort_value.tzinfo is None:
        sort_value = sort_value.replace(tzinfo=timezone.utc)
    raw = f"{sort_value.astimezone(timezone.utc).isoformat()}{_SEPARATOR}{row_id}"
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def decode_cursor(cursor: str) -> Tuple[datetime, str]:
    """Parse a cursor, or raise a 400 that does not echo the input back."""
    padding = "=" * (-len(cursor) % 4)
    try:
        raw = base64.urlsafe_b64decode(cursor + padding).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError, ValueError) as exc:
        raise _invalid() from exc

    sort_part, separator, row_id = raw.partition(_SEPARATOR)
    if not separator or not row_id:
        raise _invalid()

    try:
        sort_value = datetime.fromisoformat(sort_part)
    except ValueError as exc:
        raise _invalid() from exc

    if sort_value.tzinfo is None:
        sort_value = sort_value.replace(tzinfo=timezone.utc)
    return sort_value, row_id


def _invalid() -> ApiError:
    return ApiError(
        status_code=400,
        code="INVALID_CURSOR",
        message=(
            "The pagination cursor is malformed. Use the value derived from the "
            "last item of the previous page, or omit it to start from the "
            "beginning."
        ),
    )
