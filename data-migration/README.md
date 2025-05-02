# Notion CSV to MariaDB Migration Service

이 서비스는 노션에서 내보낸 CSV 데이터를 MariaDB로 마이그레이션하는 도구입니다.

## 설치 방법

1. 필요한 패키지 설치:
```bash
npm install
```

2. 환경 변수 설정:
- `.env` 파일을 수정하여 데이터베이스 연결 정보를 설정합니다.

3. CSV 파일 준비:
- 노션에서 내보낸 CSV 파일을 `data/notion-export.csv` 경로에 저장합니다.

## 실행 방법

```bash
npm start
```

## 주요 기능

- CSV 파일에서 데이터를 읽어 MariaDB로 마이그레이션
- 데이터베이스 연결 풀링을 통한 효율적인 데이터 처리
- 에러 처리 및 로깅

## 주의사항

- CSV 파일의 컬럼명이 노션 내보내기 형식과 일치해야 합니다.
- 데이터베이스 스키마가 `01create-db.sql`에 정의된 형식과 일치해야 합니다.