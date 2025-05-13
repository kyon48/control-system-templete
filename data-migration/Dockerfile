FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# TypeScript 빌드
RUN npm run build

# entrypoint.sh 파일 생성
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'echo "Waiting for database..."' >> /app/entrypoint.sh && \
    echo 'sleep 5' >> /app/entrypoint.sh && \
    echo 'node dist/index.js' >> /app/entrypoint.sh && \
    echo 'touch /app/migration-complete' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"] 