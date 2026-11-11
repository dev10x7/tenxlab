"""HMAC-SHA256 signing for outbound webhooks to the LMS.

Mirrors packages/contracts/src/crypto.ts so both sides agree byte-for-byte:
the signature is the lowercase hex digest of HMAC-SHA256(secret, rawBody).
"""

from __future__ import annotations

import hashlib
import hmac
import json

SIGNATURE_HEADER = "x-tenxlab-signature-256"


def sign(secret: str, body: str) -> str:
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


def verify(secret: str, body: str, provided: str | None) -> bool:
    if not provided:
        return False
    expected = sign(secret, body)
    return hmac.compare_digest(expected, provided)


def signed_payload(secret: str, payload: dict) -> tuple[str, str]:
    """Return (body, signature) with compact, stable JSON serialization."""
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    return body, sign(secret, body)
