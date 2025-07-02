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

echo -e "${GREEN}🚀 민원 관리 시스템 설정을 시작합니다...${NC}"

# 1. CSV 파일 확인
if [ ! -f "./data-migration/init-data/notion-export.csv" ]; then
    echo -e "${YELLOW}⚠️  CSV 파일이 없습니다. data-migration/init-data/notion-export.csv 파일을 추가해주세요.${NC}"
    exit 1
fi

# 2. 환경 변수 파일 확인
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env 파일이 없습니다. 다음 환경 변수들이 필요합니다:${NC}"
    echo "DB_USER=your_db_user"
    echo "DB_PASSWORD=your_db_password"
    echo "DB_NAME=your_db_name"
    echo "NOTION_API_KEY=your_notion_api_key"
    echo "NOTION_DATABASE_ID=your_notion_database_id"
    exit 1
fi

# 3. 기존 데이터 백업 확인
if docker ps | grep -q "callcenter-db"; then
    echo -e "${BLUE}💾 기존 데이터베이스가 실행 중입니다.${NC}"
    
    # 백업 수행 여부 질문
    read -p "기존 데이터를 백업하시겠습니까? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${BLUE}💾 백업을 수행합니다...${NC}"
        
        # 백업 디렉토리 생성
        if [ ! -d "$BACKUP_DIR" ]; then
            mkdir -p "$BACKUP_DIR"
        fi
        
        # 환경 변수 로드
        source .env
        
        # 실제 컨테이너 이름 찾기
        DB_CONTAINER=$(docker ps --format "table {{.Names}}" | grep "callcenter-db" | head -1)
        
        if [ -z "$DB_CONTAINER" ]; then
            echo -e "${YELLOW}⚠️  데이터베이스 컨테이너를 찾을 수 없습니다.${NC}"
        else
            echo -e "${BLUE}📦 데이터베이스 컨테이너: $DB_CONTAINER${NC}"
            
            # 백업 파일명 생성
            TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
            BACKUP_FILE="${BACKUP_DIR}/db_backup_${TIMESTAMP}.sql"
            
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
            
            if [ -f "$BACKUP_FILE" ]; then
                BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
                echo -e "${GREEN}✅ 백업이 완료되었습니다! (크기: $BACKUP_SIZE)${NC}"
            else
                echo -e "${YELLOW}⚠️  백업에 실패했습니다. 계속 진행합니다...${NC}"
            fi
        fi
    else
        echo -e "${YELLOW}⚠️  백업을 건너뜁니다.${NC}"
    fi
fi

# 4. 네트워크 확인 및 연결
echo -e "${BLUE}🌐 네트워크 연결을 확인합니다...${NC}"

# chainportal-control-system 네트워크가 존재하는지 확인
if ! docker network ls | grep -q "chainportal-control-system"; then
    echo -e "${YELLOW}⚠️  chainportal-control-system 네트워크가 존재하지 않습니다.${NC}"
    echo -e "${YELLOW}⚠️  네트워크를 먼저 생성하거나 기존 컨테이너를 확인해주세요.${NC}"
    exit 1
else
    echo -e "${GREEN}✅ chainportal-control-system 네트워크가 존재합니다.${NC}"
fi

# 5. 기존 컨테이너 정리
echo -e "${YELLOW}🧹 기존 컨테이너를 정리합니다...${NC}"

# 실행 중인 컨테이너 중지 및 삭제
echo -e "${YELLOW}📦 실행 중인 컨테이너를 중지하고 삭제합니다...${NC}"
docker compose down -v
sleep 3

# 모든 관련 이미지 삭제
echo -e "${YELLOW}🗑️  관련 Docker 이미지를 삭제합니다...${NC}"

# mariadb 이미지 삭제
if docker images | grep -q "mariadb"; then
    echo -e "${YELLOW}🗑️  MariaDB 이미지를 삭제합니다...${NC}"
    docker rmi $(docker images | grep 'mariadb' | awk '{print $3}') -f || true
fi

# 모든 프로젝트 관련 이미지 삭제 (더 넓은 패턴 사용)
if docker images | grep -q "data-\|control-system-templete-"; then
    echo -e "${YELLOW}🗑️  프로젝트 관련 이미지를 삭제합니다...${NC}"
    docker rmi $(docker images | grep 'data-\|control-system-templete-' | awk '{print $3}') -f || true
fi

# Docker 빌드 캐시 및 빌더 삭제
echo -e "${YELLOW}🧹 Docker 빌드 캐시를 삭제합니다...${NC}"
# 모든 빌더 삭제
echo -e "${YELLOW}🧹 Docker 빌더를 초기화합니다...${NC}"
docker buildx ls | grep -v default | awk 'NR>1 {print $1}' | xargs -r docker buildx rm || true
docker buildx prune -af || true

# 기본 빌더 재설정
echo -e "${YELLOW}🔄 기본 빌더를 재설정합니다...${NC}"
docker buildx create --use --name default || true

# 빌드 캐시 삭제
docker builder prune -af --filter until=0s

# 사용하지 않는 이미지, 네트워크, 볼륨 정리
echo -e "${YELLOW}🗑️  사용하지 않는 Docker 리소스를 정리합니다...${NC}"
docker system prune -af --volumes
sleep 3

# 기존 app-network 삭제 (있다면)
if docker network ls | grep -q "control-system-templete_app-network"; then
    echo -e "${YELLOW}🗑️  기존 app-network를 삭제합니다...${NC}"
    docker network rm control-system-templete_app-network || true
fi

echo -e "${GREEN}✨ Docker 환경이 완전히 초기화되었습니다.${NC}"

# 6. 모든 서비스 실행
echo -e "${GREEN}📦 모든 서비스를 시작합니다...${NC}"

# 백업 파일이 있는지 확인
if [ -d "$BACKUP_DIR" ] && [ "$(ls -A $BACKUP_DIR/*.sql 2>/dev/null)" ]; then
    echo -e "${BLUE}💾 백업 파일이 발견되었습니다. data-migration 서비스를 비활성화합니다...${NC}"
    echo -e "${YELLOW}⚠️  기존 데이터를 보호하기 위해 초기 마이그레이션을 건너뜁니다.${NC}"
    
    # 백업 존재 여부를 환경 변수로 설정
    export SKIP_MIGRATION=true
    
    # migration 프로필을 제외하고 서비스 시작
    docker compose up -d
    
    echo -e "${GREEN}✅ 데이터베이스와 스케줄러만 시작되었습니다.${NC}"
else
    echo -e "${YELLOW}📦 모든 서비스를 시작합니다 (초기 마이그레이션 포함)...${NC}"
    
    # 마이그레이션 실행 플래그 설정
    export SKIP_MIGRATION=false
    
    # migration 프로필을 포함하여 모든 서비스 시작
    docker compose --profile migration up -d
fi

# 7. 데이터베이스가 준비될 때까지 대기
echo -e "${YELLOW}⏳ 데이터베이스가 준비될 때까지 대기합니다...${NC}"
sleep 10

# 8. 백업 복원 확인
if [ -d "$BACKUP_DIR" ] && [ "$(ls -A $BACKUP_DIR/*.sql 2>/dev/null)" ]; then
    echo -e "${BLUE}🔄 백업 파일이 발견되었습니다. 복원 여부를 확인합니다...${NC}"
    
    # 가장 최근 백업 파일 찾기
    LATEST_BACKUP=$(ls -t "$BACKUP_DIR"/*.sql 2>/dev/null | head -1)
    
    if [ -n "$LATEST_BACKUP" ]; then
        echo -e "${YELLOW}📄 최근 백업 파일: $(basename "$LATEST_BACKUP")${NC}"
        read -p "백업을 복원하시겠습니까? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            echo -e "${YELLOW}📦 데이터베이스 복원을 수행합니다...${NC}"
            
            # 환경 변수 로드
            source .env
            
            # 실제 컨테이너 이름 찾기
            DB_CONTAINER=$(docker ps --format "table {{.Names}}" | grep "callcenter-db" | head -1)
            
            if [ -n "$DB_CONTAINER" ]; then
                # 데이터베이스 복원 실행
                docker exec -i "$DB_CONTAINER" mariadb \
                    -u"$DB_USER" \
                    -p"$DB_PASSWORD" < "$LATEST_BACKUP"
                
                echo -e "${GREEN}✅ 데이터베이스 복원이 완료되었습니다!${NC}"
            else
                echo -e "${RED}❌ 데이터베이스 컨테이너를 찾을 수 없습니다.${NC}"
            fi
        else
            echo -e "${YELLOW}⚠️  백업 복원을 건너뜁니다.${NC}"
        fi
    fi
fi

echo -e "${GREEN}✅ 모든 설정이 완료되었습니다!${NC}"
echo -e "${YELLOW}📝 시스템 상태 확인:${NC}"
echo "1. 데이터베이스 상태:"
docker ps | grep callcenter-db
echo "2. 스케줄러 상태:"
docker ps | grep data-schedule-sync

echo -e "\n${GREEN}🎉 시스템이 정상적으로 실행되었습니다.${NC}"
echo -e "${BLUE}💡 추가 명령어:${NC}"
echo "  - 백업: ./backup.sh"
echo "  - 복원: ./restore.sh <백업파일명>" 