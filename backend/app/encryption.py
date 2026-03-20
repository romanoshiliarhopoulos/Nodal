"""
AES-256-GCM encryption for user API keys (BYOK).

Master key source (in priority order):
  1. Google Cloud Secret Manager  — set GCP_PROJECT + SECRET_MANAGER_KEY_NAME in .env
  2. MASTER_KEY_DEV env var       — base64-encoded 32 bytes, local dev only

Generate a local dev key:
  python -c "import os, base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
"""

import os
import base64
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.config import settings

_master_key: Optional[bytes] = None


def get_master_key() -> bytes:
    global _master_key
    if _master_key is not None:
        return _master_key

    if settings.gcp_project:
        from google.cloud import secretmanager
        client = secretmanager.SecretManagerServiceClient()
        name = (
            f"projects/{settings.gcp_project}"
            f"/secrets/{settings.secret_manager_key_name}/versions/latest"
        )
        resp = client.access_secret_version(request={"name": name})
        _master_key = base64.urlsafe_b64decode(resp.payload.data.decode().strip())

    elif settings.master_key_dev:
        _master_key = base64.urlsafe_b64decode(settings.master_key_dev)

    else:
        raise RuntimeError(
            "No encryption master key configured. "
            "Set GCP_PROJECT (production) or MASTER_KEY_DEV (local dev) in .env."
        )

    return _master_key


def encrypt_key(plaintext: str) -> dict:
    """Encrypt a plaintext API key. Returns {nonce, ct} dict safe to store in Firestore."""
    aesgcm = AESGCM(get_master_key())
    nonce = os.urandom(12)
    # ct includes the 16-byte GCM authentication tag appended automatically
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return {
        "nonce": base64.urlsafe_b64encode(nonce).decode(),
        "ct": base64.urlsafe_b64encode(ct).decode(),
    }


def decrypt_key(blob: dict) -> str:
    """Decrypt a stored {nonce, ct} blob back to the plaintext API key."""
    aesgcm = AESGCM(get_master_key())
    nonce = base64.urlsafe_b64decode(blob["nonce"])
    ct = base64.urlsafe_b64decode(blob["ct"])
    return aesgcm.decrypt(nonce, ct, None).decode("utf-8")
