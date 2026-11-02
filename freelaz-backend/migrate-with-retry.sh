#!/bin/bash
ATTEMPTS=5
for i in $(seq 1 $ATTEMPTS); do
  echo "[migrate] attempt $i / $ATTEMPTS"
  if npx prisma migrate deploy; then
    echo "[migrate] success"
    exit 0
  fi
  echo "[migrate] failed, retrying in 5s..."
  sleep 5
done
echo "[migrate] all attempts failed"
exit 1