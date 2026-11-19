# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from pathlib import Path


sys.setrecursionlimit(sys.getrecursionlimit() * 5)


package_root = Path(SPECPATH)
project_root = package_root.parent

from PyInstaller.utils.hooks import collect_submodules


backend_root = project_root / "backend"
frontend_dist = project_root / "frontend" / "dist"
migrations = backend_root / "migrations"
conda_bin = Path(r"C:\ProgramData\anaconda3\Library\bin")
extra_binaries = []
for dll_name in ("ffi.dll", "sqlite3.dll"):
    dll_path = conda_bin / dll_name
    if dll_path.is_file():
        extra_binaries.append((str(dll_path), "."))

hiddenimports = []
for package in ("uvicorn", "celery", "kombu", "alembic"):
    hiddenimports += collect_submodules(package)
hiddenimports += [
    "sqlalchemy.dialects.sqlite",
    "statsmodels.tsa.holtwinters",
    "openpyxl",
    "cryptography.fernet",
]

a = Analysis(
    [str(package_root / "launcher.py")],
    pathex=[str(backend_root), str(package_root)],
    binaries=extra_binaries,
    datas=[
        (str(frontend_dist), "frontend_dist"),
        (str(migrations), "migrations"),
    ],
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "pytest",
        "matplotlib",
        "IPython",
        "jupyter",
        "torch",
        "torchvision",
        "torchaudio",
        "onnxruntime",
        "tensorflow",
        "keras",
        "numba",
        "llvmlite",
        "av",
        "pygame",
        "cv2",
        "sklearn",
        "xgboost",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="SpendWise-v3.0",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
