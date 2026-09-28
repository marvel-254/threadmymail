import base64
from typing import Optional

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from backend.config import settings


class EncryptionService:
    def __init__(self):
        self._fernet: Optional[Fernet] = None
        self._initialize()

    def _initialize(self):
        key = settings.ENCRYPTION_KEY.encode()
        if len(key) != 32:
            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=b"threadmymail-salt",
                iterations=100000,
            )
            key = base64.urlsafe_b64encode(kdf.derive(key))
        self._fernet = Fernet(key)

    def encrypt(self, plaintext: str) -> str:
        if not plaintext:
            return ""
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        if not ciphertext:
            return ""
        return self._fernet.decrypt(ciphertext.encode()).decode()

    def encrypt_dict(self, data: dict) -> dict:
        return {k: self.encrypt(v) if isinstance(v, str) else v for k, v in data.items()}

    def decrypt_dict(self, data: dict) -> dict:
        return {k: self.decrypt(v) if isinstance(v, str) else v for k, v in data.items()}


encryption_service = EncryptionService()
