#!/bin/bash
# Kancelarija agenata: upali / ugasi / status.
#   scripts/kancelarija.sh upali     pokrene server u pozadini (ako ne radi) i ispiše adresu
#   scripts/kancelarija.sh ugasi     ugasi server
#   scripts/kancelarija.sh status    radi li i ko je prijavljen
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${KANCELARIJA_DIR:-$HOME/.kancelarija}"
AKT="$DIR/aktivno.json"
URL="http://localhost:${PORT:-4848}"
mkdir -p "$DIR"

pid() { node -e 'try{const a=require(process.argv[1]);if(a.pid>0){process.kill(a.pid,0);console.log(a.pid)}}catch{}' "$AKT" 2>/dev/null || true; }

case "${1:-status}" in
  upali)
    if [ -n "$(pid)" ]; then echo "Kancelarija već radi: $URL"; exit 0; fi
    cd "$ROOT"
    # klijent se pravi ponovo samo ako je izvor noviji od dist/
    if [ ! -f dist/index.html ] || [ -n "$(find src shared -newer dist/index.html -type f | head -1)" ]; then
      npx vite build --logLevel warn
    fi
    nohup node server/index.ts > "$DIR/server.log" 2>&1 &
    for _ in $(seq 1 30); do [ -n "$(pid)" ] && break; sleep 0.2; done
    [ -n "$(pid)" ] && echo "Kancelarija upaljena: $URL" || { echo "Server nije krenuo, vidi $DIR/server.log"; exit 1; }
    ;;
  ugasi)
    p="$(pid)"; [ -n "$p" ] && kill "$p" && echo "Kancelarija ugašena." || echo "Kancelarija ne radi."
    ;;
  status)
    p="$(pid)"; [ -n "$p" ] && echo "Radi (pid $p): $URL" || echo "Ne radi."
    node "$ROOT/scripts/prijavi.mjs" --spisak
    ;;
  *) echo "Upotreba: $0 upali|ugasi|status"; exit 1 ;;
esac
