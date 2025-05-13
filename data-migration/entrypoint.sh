#!/bin/sh
echo "Waiting for database..."
sleep 5
node src/index.ts
touch /app/migration-complete 