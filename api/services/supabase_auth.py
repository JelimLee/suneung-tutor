"""JWT validation via Supabase GoTrue — read-only, no DB access.

The Edge fn validates the caller with `userClient.auth.getUser()` and 401s when
there is no user. We replicate that contract by calling GoTrue's /auth/v1/user
with the caller's bearer token. This touches auth only — NO project tables are
read or written (satisfies the Step-1 read-only rule).
"""

from __future__ import annotations

import os
from typing import Optional

import httpx


async def get_user(authorization: Optional[str]) -> Optional[dict]:
    """Return the user object for a valid bearer token, else None.

    Mirrors auth.getUser(): an absent/invalid token yields no user (→ 401 in the
    router). Never raises for an unauthenticated caller — only returns None.
    """
    if not authorization:
        return None

    url = os.environ["SUPABASE_URL"].rstrip("/") + "/auth/v1/user"
    anon = os.environ["SUPABASE_ANON_KEY"]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                url,
                headers={"apikey": anon, "Authorization": authorization},
            )
        if res.status_code != 200:
            return None
        user = res.json()
        # GoTrue returns the user object with an "id" when the token is valid.
        return user if user and user.get("id") else None
    except Exception:
        return None
