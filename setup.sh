#!/bin/bash

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 에러 발생시 스크립트 중단
set -e

echo -e "${GREEN}🚀 민원 관리 시스템 설정을 시작합니다...${NC}"

# 1. CSV 파일 확인
if [ ! -f "./data-migration/init-data/notion-export.csv" ]; then
    echo -e "${YELLOW}⚠️  CSV 파일이 없습니다. data-migration/init-data/notion-export.csv 파일을 추가해주세요.${NC}"
    exit 1
fi

# 2. 데이터베이스 컨테이너 실행
echo -e "${GREEN}📦 데이터베이스 컨테이너를 시작합니다...${NC}"
docker compose -f ./db/docker-compose.yaml up -d

# 3. 데이터 마이그레이션
echo -e "${GREEN}📥 노션 데이터를 데이터베이스에 마이그레이션합니다...${NC}"
cd ./data-migration
npm install
npm start
cd ..

# 4. 스케줄러 설정
echo -e "${GREEN}⏰ 데이터 동기화 스케줄러를 설정합니다...${NC}"
cd ./data-schedule-sync
npm install
docker compose up -d
cd ..

echo -e "${GREEN}✅ 모든 설정이 완료되었습니다!${NC}"
echo -e "${YELLOW}📝 시스템 상태 확인:${NC}"
echo "1. 데이터베이스 상태:"
docker ps | grep callcenter-db
echo "2. 스케줄러 상태:"
docker ps | grep data-sync

echo -e "\n${GREEN}🎉 시스템이 정상적으로 실행되었습니다.${NC}" 