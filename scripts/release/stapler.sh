#!/bin/bash
set -euo pipefail

if [[ $# -ne 2 || ( "$1" != staple && "$1" != validate ) ]]; then
  echo "Usage: stapler.sh staple|validate artifact" >&2
  exit 2
fi

# EX_NOHOST (68) is stapler's CloudKit/network failure. Keep signature/ticket
# rejection fatal, and still require a successful final validation.
for attempt in 1 2 3; do
  if xcrun stapler "$1" "$2"; then
    exit 0
  else
    result=$?
  fi
  if [[ "$result" -ne 68 || "$attempt" -eq 3 ]]; then
    exit "$result"
  fi
  echo "Apple ticket service unavailable; retrying stapler ($attempt/3)." >&2
  sleep "$((attempt * 5))"
done
