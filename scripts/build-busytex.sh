#!/bin/bash
set -euo pipefail
REX_ROOT=$(cd "$(dirname "$0")/.." && pwd)
TASK_ROOT="$REX_ROOT/artifacts/busytex-build"
mkdir -p "$TASK_ROOT"
export EMSDK_QUIET=1
SDK="$TASK_ROOT/toolchain/emsdk-4.0.23"
if [ ! -x "$SDK/upstream/emscripten/emcc" ]; then
  mkdir -p "$TASK_ROOT/toolchain"
  curl -fLsS https://github.com/emscripten-core/emsdk/archive/refs/tags/4.0.23.tar.gz -o "$TASK_ROOT/toolchain/emsdk.tar.gz"
  tar -xzf "$TASK_ROOT/toolchain/emsdk.tar.gz" -C "$TASK_ROOT/toolchain"
  "$SDK/emsdk" install 4.0.23
  "$SDK/emsdk" activate 4.0.23
fi
if [ ! -f "$TASK_ROOT/texlive-source.tar.gz" ]; then
  curl -fLsS https://github.com/TeX-Live/texlive-source/archive/refs/heads/tags/texlive-2026.0.tar.gz -o "$TASK_ROOT/texlive-source.tar.gz"
fi
python3 - "$TASK_ROOT/texlive-source.tar.gz" "$REX_ROOT/runtime/busytex/manifest.json" "$REX_ROOT/runtime/busytex/busytex.c" <<'VERIFY'
import hashlib,json,sys
m=json.load(open(sys.argv[2]))
for p,wanted in [(sys.argv[1],m['source']['sha256']),(sys.argv[3],m['source']['dispatcherSha256'])]:
    if hashlib.sha256(open(p,'rb').read()).hexdigest()!=wanted:raise SystemExit('Source integrity mismatch: '+p)
VERIFY
source "$SDK/emsdk_env.sh"
SRC="$TASK_ROOT/texlive-source-tags-texlive-2026.0"
OUT="$TASK_ROOT/tools-build"
mkdir -p "$OUT"
if [ ! -f "$SRC/configure" ]; then tar -xzf "$TASK_ROOT/texlive-source.tar.gz" -C "$TASK_ROOT"; fi
cd "$OUT"
emconfigure "$SRC/configure" --disable-all-pkgs --enable-bibtex-x --enable-bibtex8 --disable-bibtexu --enable-makeindexk --disable-native-texlive-build --disable-shared --enable-static --without-x --host=wasm32-unknown-emscripten --build="$(sh "$SRC/build-aux/config.guess")" CFLAGS=-Oz CXXFLAGS=-Oz > configure.log 2>&1
emmake make recurse CONF_SUBDIRS=texk/kpathsea MAKE_SUBDIRS=texk/kpathsea > make.log 2>&1
emmake make -C texk/kpathsea -j4 >> make.log 2>&1
emmake make -C texk -j4 CONF_SUBDIRS="bibtex-x makeindexk" >> make.log 2>&1
emcc -Oz -DBUSYTEX_BIBTEX8 -DBUSYTEX_MAKEINDEX -c "$REX_ROOT/runtime/busytex/busytex.c" -o dispatcher.o
cd texk/bibtex-x
emcc -Oz -DHAVE_CONFIG_H -I. -I"$SRC/texk/bibtex-x" -I.. -I"$SRC/texk" -DUNIX -DKPATHSEA -DSUPPORT_8BIT -Dmain=busymain_bibtex8 -c "$SRC/texk/bibtex-x/bibtex.c" -o bibtex8-entry.o
cd ../makeindexk
emcc -Oz -DHAVE_CONFIG_H -I. -I"$SRC/texk/makeindexk" -I.. -I"$SRC/texk" -DUNIX -DKPATHSEA -Dmain=busymain_makeindex -c "$SRC/texk/makeindexk/mkind.c" -o makeindex-entry.o
cd "$OUT"
emcc -Oz dispatcher.o texk/bibtex-x/bibtex8-entry.o texk/bibtex-x/bibtex8-bibtex-[1-4].o texk/bibtex-x/bibtex8-utils.o texk/makeindexk/makeindex-entry.o texk/makeindexk/genind.o texk/makeindexk/qsort.o texk/makeindexk/scanid.o texk/makeindexk/scanst.o texk/makeindexk/sortid.o texk/kpathsea/.libs/libkpathsea.a -sMODULARIZE=1 -sEXPORT_NAME=busytex -sENVIRONMENT=web,worker,node -sFORCE_FILESYSTEM=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=16777216 -sSTACK_SIZE=5242880 -sEXIT_RUNTIME=0 -sINVOKE_RUN=0 -sEXPORTED_FUNCTIONS='["_main","_flush_streams"]' -sEXPORTED_RUNTIME_METHODS='["callMain","FS","ENV"]' -o busytex-tools.js > link.log 2>&1
python3 - <<'ADAPTER'
from pathlib import Path
p=Path('busytex-tools.js')
p.with_suffix('.mjs').write_text("const require = globalThis.process?.versions?.node ? (await import('node:module')).createRequire(import.meta.url) : undefined;\nconst __dirname = decodeURIComponent(new URL('.', import.meta.url).pathname);\n" + p.read_text() + "\nexport default busytex;\n")
ADAPTER
python3 - "$OUT" "$REX_ROOT/runtime/busytex" <<'PUBLISH'
import hashlib,json,shutil,sys
from pathlib import Path
out,dest=map(Path,sys.argv[1:]);m=json.loads((dest/'manifest.json').read_text())
for ext in ['mjs','wasm']:
    name='busytex.'+ext;shutil.copyfile(out/('busytex-tools.'+ext),dest/name)
    b=(dest/name).read_bytes();m['files'][name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
(dest/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
PUBLISH
