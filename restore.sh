#!/bin/bash

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# 에러 발생시 스크립트 중단
set -e

# 백업 디렉토리
BACKUP_DIR="./backups"

echo -e "${BLUE}🔄 데이터베이스 복원을 시작합니다...${NC}"

# 백업 디렉토리 확인
if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${RED}❌ 백업 디렉토리가 없습니다: $BACKUP_DIR${NC}"
    exit 1
fi

# 환경 변수 파일 확인
if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env 파일이 없습니다. 환경 변수를 확인해주세요.${NC}"
    exit 1
fi

# 환경 변수 로드
source .env

# 백업 파일 선택
if [ -z "$1" ]; then
    echo -e "${YELLOW}📋 사용 가능한 SQL 백업 파일들:${NC}"
    ls -la "$BACKUP_DIR"/*.sql 2>/dev/null | nl || {
        echo -e "${RED}❌ SQL 백업 파일이 없습니다.${NC}"
    }
    
    echo -e "\n${YELLOW}📋 사용 가능한 볼륨 백업 파일들:${NC}"
    ls -la "callcenter-db.tar" 2>/dev/null | nl || {
        echo -e "${RED}❌ 볼륨 백업 파일이 없습니다.${NC}"
    }
    
    echo -e "\n${YELLOW}사용법: $0 <백업파일명>${NC}"
    echo -e "${YELLOW}예시: $0 db_backup_20241201_143022.sql${NC}"
    echo -e "${YELLOW}예시: $0 callcenter-db.tar${NC}"
    exit 1
fi

BACKUP_FILE="$BACKUP_DIR/$1"

# 백업 파일 존재 확인
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}❌ 백업 파일을 찾을 수 없습니다: $BACKUP_FILE${NC}"
    exit 1
fi

echo -e "${YELLOW}📄 복원할 백업 파일: $BACKUP_FILE${NC}"

# 파일 확장자 확인
FILE_EXTENSION="${BACKUP_FILE##*.}"

if [ "$FILE_EXTENSION" = "tar" ]; then
    echo -e "${BLUE}📦 볼륨 백업 파일을 복원합니다...${NC}"
    
    # 복원 확인
    echo -e "${RED}⚠️  경고: 이 작업은 현재 데이터베이스의 모든 데이터를 덮어씁니다!${NC}"
    read -p "정말로 복원하시겠습니까? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}❌ 복원이 취소되었습니다.${NC}"
        exit 1
    fi
    
    # 데이터베이스 컨테이너 중지
    echo -e "${YELLOW}🛑 데이터베이스 컨테이너를 중지합니다...${NC}"
    docker-compose stop db
    
    # 기존 볼륨 삭제
    echo -e "${YELLOW}🗑️  기존 데이터베이스 볼륨을 삭제합니다...${NC}"
    docker volume rm callcenter-db 2>/dev/null || true
    
    # 새 볼륨 생성 및 복원
    echo -e "${YELLOW}📦 데이터베이스 볼륨을 복원합니다...${NC}"
    docker run --rm -v callcenter-db:/data -v "$(pwd):/backup" alpine sh -c "cd /data && tar xzf /backup/callcenter-db.tar"
    
    # 데이터베이스 컨테이너 재시작
    echo -e "${YELLOW}🔄 데이터베이스 컨테이너를 재시작합니다...${NC}"
    docker-compose up -d db
    
    echo -e "${GREEN}✅ 볼륨 백업 복원이 완료되었습니다!${NC}"
    
else
    echo -e "${BLUE}📦 SQL 백업 파일을 복원합니다...${NC}"
    
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

    # 복원 확인
    echo -e "${RED}⚠️  경고: 이 작업은 현재 데이터베이스의 모든 데이터를 덮어씁니다!${NC}"
    read -p "정말로 복원하시겠습니까? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}❌ 복원이 취소되었습니다.${NC}"
        exit 1
    fi

    echo -e "${YELLOW}📦 데이터베이스 복원을 수행합니다...${NC}"

    # 데이터베이스 복원 실행
    docker exec -i "$DB_CONTAINER" mariadb \
        -u"$DB_USER" \
        -p"$DB_PASSWORD" < "$BACKUP_FILE"

    echo -e "${GREEN}✅ SQL 백업 복원이 완료되었습니다!${NC}"
fi

echo -e "${BLUE}📊 복원된 파일: $BACKUP_FILE${NC}"

echo -e "\n${GREEN}🎉 데이터베이스 복원이 성공적으로 완료되었습니다!${NC}" 