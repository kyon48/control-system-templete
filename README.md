# control-system: complain-db

# data-migration
```bash
cd ./data-migration
```
1. ./data-migration/data에 노션 데이터베이스 csv 파일을 "notion-export.csv"라는 이름으로 저장

2. 데이터베이스 도커 컨테이너 실행
```bash
docker compose -f ./db/docker-compose.yaml up -d
```

3. 데이터베이스에 노션 데이터베이 데이터 업로드
```bash
npm install
npm start
```

# data-sync
최신 데이터 동기화 실행
```bash
cd ../data-sync
npm install
npm start
```

# data-schedule-sync
최신 데이터 동기화 실행
```bash
cd ../data-schedule-sync
docker compose up -d
```