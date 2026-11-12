#!/usr/bin/env bash
# Creates (or updates) the nine teammates and the sandbox environment.
set -euo pipefail
cd "$(dirname "$0")/.."
ant apply agents/michael.md agents/mia.md agents/leo.md agents/jimmy.md agents/raphaella.md agents/jason.md agents/sara.md agents/freya.md agents/martina.md environment.yaml
echo
echo "Copy the agent IDs and the environment ID above into .env (see .env.example)."
