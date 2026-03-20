import os
import firebase_admin
from firebase_admin import credentials, firestore


def init_firebase(service_account_path: str = "service-account.json") -> None:
    if firebase_admin._apps:
        return
    if os.path.exists(service_account_path):
        cred = credentials.Certificate(service_account_path)
        firebase_admin.initialize_app(cred)
    else:
        firebase_admin.initialize_app()


def get_db():
    return firestore.client()
