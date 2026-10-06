#!/usr/bin/env sh
# Compila e instala o ts3j (protocolo cliente TeamSpeak 3/5/6, Apache-2.0) no repositorio Maven local.
# O commit fixado e o mesmo validado com servidores TS6 pelo projeto astrum-ts6.
set -eu
TS3J_COMMIT="${TS3J_COMMIT:-db57d60c989e399626aa16d921390f5033e6cdeb}"
WORK="$(mktemp -d)"
git clone --quiet https://github.com/Manevolent/ts3j "$WORK/ts3j"
git -C "$WORK/ts3j" checkout --quiet "$TS3J_COMMIT"
mvn -q -f "$WORK/ts3j/pom.xml" -DskipTests install
rm -rf "$WORK"
echo "ts3j instalado ($TS3J_COMMIT)"
