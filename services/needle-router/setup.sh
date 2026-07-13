#!/usr/bin/env bash
set -euo pipefail

# Install Needle Router dependencies and the Needle model package.
pip install -r requirements.txt && pip install git+https://github.com/cactus-compute/needle
