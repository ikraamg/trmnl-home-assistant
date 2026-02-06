#!/bin/sh
# ImageMagick 7 wrapper script
# Suppresses the "convert command is deprecated" warning from IM7
# The gm npm package calls 'convert', but IM7 wants 'magick'
#
# This wrapper:
# 1. Calls 'magick' with all arguments passed through
# 2. Filters out only the deprecation warning from stderr
# 3. Preserves stdout (for binary image data) and exit codes

# Create a temp file for filtered stderr
tmpfile=$(mktemp)
trap 'rm -f "$tmpfile"' EXIT

# Run magick, capture stderr to temp, let stdout pass through
/usr/local/bin/magick "$@" 2>"$tmpfile"
exit_code=$?

# Output filtered stderr (remove deprecation warning)
grep -v "The convert command is deprecated" "$tmpfile" >&2

exit $exit_code
