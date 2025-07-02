#!/bin/bash

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# 에러 발생시 스크립트 중단
set -e

# 백업 디렉토리 생성
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/db_backup_${TIMESTAMP}.sql"

echo -e "${BLUE}💾 데이터베이스 백업을 시작합니다...${NC}"

# 백업 디렉토리가 없으면 생성
if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${YELLOW}📁 백업 디렉토리를 생성합니다: $BACKUP_DIR${NC}"
    mkdir -p "$BACKUP_DIR"
fi

# 환경 변수 파일 확인
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env 파일이 없습니다. 환경 변수를 확인해주세요.${NC}"
    exit 1
fi

# 환경 변수 로드
source .env

# 데이터베이스 컨테이너가 실행 중인지 확인
if ! docker ps | grep -q "callcenter-db"; then
    echo -e "${YELLOW}⚠️  데이터베이스 컨테이너가 실행 중이지 않습니다. 먼저 시스템을 시작해주세요.${NC}"
    exit 1
fi

# 실제 컨테이너 이름 찾기
DB_CONTAINER=$(docker ps --format "table {{.Names}}" | grep "callcenter-db" | head -1)

if [ -z "$DB_CONTAINER" ]; then
    echo -e "${YELLOW}⚠️  데이터베이스 컨테이너를 찾을 수 없습니다. 먼저 시스템을 시작해주세요.${NC}"
    exit 1
fi

echo -e "${BLUE}📦 데이터베이스 컨테이너: $DB_CONTAINER${NC}"

echo -e "${YELLOW}📦 데이터베이스 백업을 수행합니다...${NC}"
echo -e "${BLUE}📄 백업 파일: $BACKUP_FILE${NC}"

# 데이터베이스 백업 실행
docker exec "$DB_CONTAINER" mariadb-dump \
    -u"$DB_USER" \
    -p"$DB_PASSWORD" \
    --single-transaction \
    --routines \
    --triggers \
    --events \
    --add-drop-database \
    --databases "$DB_NAME" > "$BACKUP_FILE"

# 백업 파일 크기 확인
if [ -f "$BACKUP_FILE" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✅ SQL 백업이 완료되었습니다!${NC}"
    echo -e "${BLUE}📊 백업 파일 크기: $BACKUP_SIZE${NC}"
    echo -e "${BLUE}📁 백업 위치: $BACKUP_FILE${NC}"
else
    echo -e "${RED}❌ SQL 백업에 실패했습니다.${NC}"
    exit 1
fi

# 데이터베이스 볼륨 백업 (tar 파일)
echo -e "\n${YELLOW}📦 데이터베이스 볼륨 백업을 시작합니다...${NC}"
VOLUME_BACKUP_FILE="callcenter-db.tar"

# 데이터베이스 볼륨 백업
docker run --rm -v callcenter-db:/data -v "$(pwd):/backup" alpine tar czf "/backup/callcenter-db.tar" -C /data .

if [ -f "$VOLUME_BACKUP_FILE" ]; then
    VOLUME_BACKUP_SIZE=$(du -h "$VOLUME_BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✅ 볼륨 백업이 완료되었습니다!${NC}"
    echo -e "${BLUE}📊 볼륨 백업 파일 크기: $VOLUME_BACKUP_SIZE${NC}"
    echo -e "${BLUE}📁 볼륨 백업 위치: $VOLUME_BACKUP_FILE${NC}"
else
    echo -e "${RED}❌ 볼륨 백업에 실패했습니다.${NC}"
fi

# 최근 백업 파일들을 보여줌
echo -e "\n${YELLOW}📋 최근 백업 파일들:${NC}"
ls -la "$BACKUP_DIR"/*.sql 2>/dev/null | tail -3 || echo "SQL 백업 파일이 없습니다."
ls -la "callcenter-db.tar" 2>/dev/null || echo "볼륨 백업 파일이 없습니다."

echo -e "\n${GREEN}🎉 데이터베이스 백업이 성공적으로 완료되었습니다!${NC}" 