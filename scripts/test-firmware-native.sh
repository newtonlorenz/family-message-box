#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
build_dir=$(mktemp -d "${TMPDIR:-/tmp}/message-box-firmware-tests.XXXXXX")
trap 'rm -rf "$build_dir"' EXIT HUP INT TERM

cxx=${CXX:-c++}
include_dir="$repo_root/firmware/include"

for test_source in "$repo_root"/firmware/test/native/*.cpp; do
  test_name=$(basename "$test_source" .cpp)
  test_binary="$build_dir/$test_name"
  "$cxx" -std=c++17 -Wall -Wextra -Werror -I"$include_dir" \
    "$test_source" -o "$test_binary"
  "$test_binary"
done
