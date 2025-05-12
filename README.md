# control-system: complain-db

민원 관리 시스템의 데이터베이스 및 동기화 시스템입니다.

## 시작하기

### 자동 설치 및 실행 (권장)

1. CSV 파일 준비
   - `./data-migration/init-data` 디렉토리에 노션 데이터베이스 CSV 파일을 `notion-export.csv`라는 이름으로 저장

2. 자동 설치 스크립트 실행
```bash
chmod +x setup.sh
./setup.sh
```

### 수동 설치 및 실행

1. CSV 파일 준비
   - `./data-migration/init-data` 디렉토리에 노션 데이터베이스 CSV 파일을 `notion-export.csv`라는 이름으로 저장

2. 데이터베이스 도커 컨테이너 실행
```bash
docker compose -f ./db/docker-compose.yaml up -d
```

3. 노션 데이터베이스 데이터 업로드
```bash
cd ./data-migration
npm install
npm start
```

4. 최신 데이터 동기화 스케줄러 실행
```bash
cd ../data-schedule-sync
docker compose up -d
```

## 시스템 구성

- `data-migration`: 노션 데이터베이스의 데이터를 MariaDB로 마이그레이션
- `data-schedule-sync`: 노션 데이터베이스와 MariaDB 간의 실시간 동기화
- `db`: MariaDB 데이터베이스 설정 및 데이터 저장

## 주의사항

- CSV 파일은 반드시 `notion-export.csv`라는 이름으로 저장해야 합니다.
- 데이터베이스 컨테이너가 실행 중이어야 스케줄러가 정상적으로 동작합니다.