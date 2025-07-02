#!/bin/bash

# 색상 정의
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# 에러 발생시 스크립트 중단
set -e

DB_IMAGE_NAME=callcenter-db
DB_TAR_FILE=${DB_IMAGE_NAME}.tar

echo -e "${GREEN}🚀 데이터가 포함된 MariaDB 이미지 빌드를 시작합니다...${NC}"

# 1. 환경 변수 파일 확인
echo -e "${BLUE}📋 환경 변수 파일을 확인합니다...${NC}"

if [ ! -f ".env" ]; then
    echo -e "${RED}❌ .env 파일이 없습니다.${NC}"
    echo -e "${YELLOW}⚠️  다음 환경 변수들이 필요합니다:${NC}"
    echo "DB_USER=your_db_user"
    echo "DB_PASSWORD=your_db_password"
    echo "DB_NAME=your_db_name"
    exit 1
fi

echo -e "${GREEN}✅ 환경 변수 파일이 확인되었습니다.${NC}"

# 2. 환경 변수 로드
source .env

# 3. 데이터베이스 컨테이너가 실행 중인지 확인
echo -e "${BLUE}🔍 데이터베이스 컨테이너 상태를 확인합니다...${NC}"

if ! docker ps | grep -q "callcenter-db"; then
    echo -e "${RED}❌ callcenter-db 컨테이너가 실행 중이지 않습니다.${NC}"
    echo -e "${YELLOW}⚠️  먼저 시스템을 시작해주세요:${NC}"
    echo "docker-compose up -d db"
    exit 1
fi

# 실제 컨테이너 이름 찾기
DB_CONTAINER=$(docker ps --format "table {{.Names}}" | grep "callcenter-db" | head -1)

if [ -z "$DB_CONTAINER" ]; then
    echo -e "${RED}❌ callcenter-db 컨테이너를 찾을 수 없습니다.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 데이터베이스 컨테이너가 실행 중입니다: $DB_CONTAINER${NC}"

# 4. 데이터베이스 상태 확인
echo -e "${BLUE}🔍 데이터베이스 연결 상태를 확인합니다...${NC}"

if ! docker exec "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASSWORD" -e "SELECT 1;" > /dev/null 2>&1; then
    echo -e "${RED}❌ 데이터베이스 연결에 실패했습니다.${NC}"
    echo -e "${YELLOW}⚠️  데이터베이스가 완전히 준비될 때까지 기다려주세요.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 데이터베이스 연결이 정상입니다.${NC}"

# 5. 데이터베이스 내용 확인
echo -e "${BLUE}📊 데이터베이스 내용을 확인합니다...${NC}"

# 테이블 목록 확인
TABLES=$(docker exec "$DB_CONTAINER" mariadb -u"$DB_USER" -p"$DB_PASSWORD" -e "SHOW TABLES;" "$DB_NAME" 2>/dev/null | tail -n +2 | wc -l)

if [ "$TABLES" -eq 0 ]; then
    echo -e "${YELLOW}⚠️  데이터베이스에 테이블이 없습니다.${NC}"
    echo -e "${YELLOW}⚠️  데이터 마이그레이션을 먼저 실행해주세요.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 데이터베이스에 $TABLES 개의 테이블이 있습니다.${NC}"

# 6. 기존 이미지 정리
echo -e "${YELLOW}🧹 기존 이미지를 정리합니다...${NC}"

if docker images | grep -q "${DB_IMAGE_NAME}"; then
    echo -e "${YELLOW}🗑️  기존 ${DB_IMAGE_NAME} 이미지를 삭제합니다...${NC}"
    docker rmi ${DB_IMAGE_NAME}:latest -f || true
fi

# 7. 현재 컨테이너를 이미지로 커밋
echo -e "${BLUE}📦 현재 컨테이너를 이미지로 변환합니다...${NC}"

echo -e "${YELLOW}📦 컨테이너를 이미지로 커밋합니다...${NC}"
docker commit "$DB_CONTAINER" ${DB_IMAGE_NAME}:latest

if docker images | grep -q "${DB_IMAGE_NAME}"; then
    echo -e "${GREEN}✅ 이미지 생성이 완료되었습니다!${NC}"
else
    echo -e "${RED}❌ 이미지 생성에 실패했습니다.${NC}"
    exit 1
fi

# 8. 이미지를 tar 파일로 저장
echo -e "${BLUE}💾 이미지를 tar 파일로 저장합니다...${NC}"

echo -e "${YELLOW}📦 이미지를 tar 파일로 저장합니다...${NC}"
docker save -o ${DB_TAR_FILE} ${DB_IMAGE_NAME}:latest

if [ -f "$DB_TAR_FILE" ]; then
    DB_TAR_SIZE=$(du -h ${DB_TAR_FILE} | cut -f1)
    echo -e "${GREEN}✅ tar 파일 저장이 완료되었습니다! (크기: $DB_TAR_SIZE)${NC}"
else
    echo -e "${RED}❌ tar 파일 저장에 실패했습니다.${NC}"
    exit 1
fi

# 9. 이미지 정보 출력
echo -e "${BLUE}📊 생성된 이미지 정보:${NC}"
docker images ${DB_IMAGE_NAME}:latest

# 10. 결과 출력
echo -e "\n${GREEN}✅ 데이터가 포함된 MariaDB 이미지 빌드가 완료되었습니다!${NC}"
echo -e "${BLUE}📄 생성된 파일: ${DB_TAR_FILE} (크기: ${DB_TAR_SIZE})${NC}"

echo -e "\n${GREEN}✅ Portainer에 업로드할 준비가 완료되었습니다!${NC}"
echo -e "${BLUE}💡 다음 단계:${NC}"
echo "1. ${DB_TAR_FILE} 파일을 Portainer 서버로 전송"
echo "2. Portainer에서 이미지 로드:"
echo "   - docker load -i ${DB_TAR_FILE}"
echo "3. 스택 생성 시 다음 환경 변수 설정:"
echo "   - DB_USER=${DB_USER}"
echo "   - DB_PASSWORD=${DB_PASSWORD}"
echo "   - DB_NAME=${DB_NAME}"
echo ""
echo -e "${YELLOW}포테이너 스택 설정:${NC}"
echo "- 데이터베이스: ${DB_IMAGE_NAME}:latest (데이터가 포함된 커스텀 이미지)"
echo "- 포트: 3306"
echo "- 볼륨: 자동으로 데이터가 포함됨"
echo ""
echo -e "${BLUE}💡 사용 예시:${NC}"
echo "docker run -d \\"
echo "  --name callcenter-db \\"
echo "  -p 3306:3306 \\"
echo "  -e MYSQL_ROOT_PASSWORD=${DB_PASSWORD} \\"
echo "  -e MYSQL_DATABASE=${DB_NAME} \\"
echo "  -e MYSQL_USER=${DB_USER} \\"
echo "  -e MYSQL_PASSWORD=${DB_PASSWORD} \\"
echo "  ${DB_IMAGE_NAME}:latest"