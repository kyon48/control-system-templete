#!/bin/bash

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# 에러 발생시 스크립트 중단
set -e

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

# 3. 기존 컨테이너 정리
echo -e "${YELLOW}🧹 기존 컨테이너를 정리합니다...${NC}"

# 실행 중인 컨테이너 중지 및 삭제
if docker ps -a | grep -q "callcenter-db\|data-migration\|data-sync"; then
    echo -e "${YELLOW}📦 실행 중인 컨테이너를 중지하고 삭제합니다...${NC}"
    docker compose down -v
fi
sleep 5

# 사용하지 않는 이미지, 네트워크, 볼륨 정리
echo -e "${YELLOW}🗑️  사용하지 않는 Docker 리소스를 정리합니다...${NC}"
docker system prune -f
docker volume prune -f
sleep 5


# 4. 모든 서비스 실행
echo -e "${GREEN}📦 모든 서비스를 시작합니다...${NC}"
docker compose up -d

echo -e "${GREEN}✅ 모든 설정이 완료되었습니다!${NC}"
echo -e "${YELLOW}📝 시스템 상태 확인:${NC}"
echo "1. 데이터베이스 상태:"
docker ps | grep callcenter-db
echo "2. 데이터 마이그레이션 상태:"
docker ps | grep data-migration
echo "3. 스케줄러 상태:"
docker ps | grep data-sync

echo -e "\n${GREEN}🎉 시스템이 정상적으로 실행되었습니다.${NC}" 