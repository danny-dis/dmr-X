#!/usr/bin/env bash
cd "$(dirname "$0")"
source .venv/Scripts/activate || true
python server.py
