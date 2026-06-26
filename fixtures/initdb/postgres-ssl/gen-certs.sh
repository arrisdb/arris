#!/bin/sh
# Mint a self-signed CA plus a server cert (SAN=localhost, so "Verify Identity"
# passes from the host) and a client cert (CN=certuser, for mTLS). Server key
# lands in the shared /server volume with postgres-owned 0600 perms; the CA and
# client material land in /client (bind-mounted to ./initdb/postgres-ssl/certs)
# so you can point Arris's CA / client certificate / client key fields at them.
set -eu

SERVER=/server
CLIENT=/client

if [ -f "$SERVER/server.key" ] && [ -f "$CLIENT/ca.crt" ]; then
  echo "[pg-ssl] certs already present, skipping"
  exit 0
fi

echo "[pg-ssl] generating CA + server + client certs"

# Certificate authority.
openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
  -keyout "$CLIENT/ca.key" -out "$CLIENT/ca.crt" \
  -subj "/CN=Arris Test CA"

# Server cert — SAN must include localhost/127.0.0.1 so hostname verification
# (Verify Identity) succeeds when connecting to localhost:5433.
openssl req -nodes -newkey rsa:2048 \
  -keyout "$SERVER/server.key" -out /tmp/server.csr \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
openssl x509 -req -in /tmp/server.csr \
  -CA "$CLIENT/ca.crt" -CAkey "$CLIENT/ca.key" -CAcreateserial \
  -days 3650 -out "$SERVER/server.crt" -copy_extensions copy

# Client cert — CN must equal the cert-auth role name (certuser) in pg_hba.
openssl req -nodes -newkey rsa:2048 \
  -keyout "$CLIENT/client.key" -out /tmp/client.csr \
  -subj "/CN=certuser"
openssl x509 -req -in /tmp/client.csr \
  -CA "$CLIENT/ca.crt" -CAkey "$CLIENT/ca.key" -CAcreateserial \
  -days 3650 -out "$CLIENT/client.crt"

# Postgres refuses a server key that is group/world readable or not owned by the
# postgres user (uid 999 in the postgres:18 image).
chmod 600 "$SERVER/server.key"
chown 999:999 "$SERVER/server.key" "$SERVER/server.crt"
chmod 644 "$CLIENT/ca.crt" "$CLIENT/client.crt"
chmod 600 "$CLIENT/client.key"

rm -f /tmp/server.csr /tmp/client.csr "$CLIENT/ca.srl"
echo "[pg-ssl] done -> CA: initdb/postgres-ssl/certs/ca.crt  client: client.{crt,key}"
