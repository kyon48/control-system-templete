require('dotenv').config();
const mariadb = require('mariadb');
const fs = require('fs');
const { parse } = require('csv-parse');
const path = require('path');

// 한국어 날짜를 Date 객체로 변환하는 함수
function parseKoreanDate(dateStr) {
    if (!dateStr) return new Date();
    const match = dateStr.match(/(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2})/);
    if (!match) return new Date();

    const [_, year, month, day, ampm, hour, minute] = match;
    let hour24 = parseInt(hour);

    if (ampm === '오후' && hour24 < 12) {
        hour24 += 12;
    }
    if (ampm === '오전' && hour24 === 12) {
        hour24 = 0;
    }

    return new Date(year, month - 1, day, hour24, minute);
}

// MariaDB 연결 풀 생성
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    connectionLimit: 5
});

async function migrateData() {
    let conn;
    try {
        conn = await pool.getConnection();

        // CSV 파일 읽기
        const csvFilePath = path.join(__dirname, '../init-data/notion-export.csv');
        const parser = fs
            .createReadStream(csvFilePath)
            .pipe(parse({
                columns: true,
                skip_empty_lines: true,
                bom: true,
                trim: true
            }));

        for await (const record of parser) {
            try {
                // CSV 데이터를 DB 스키마에 맞게 변환
                const complaintData = {
                    complaint_id: record['ID-2'] || '',
                    complaint_date: parseKoreanDate(record['접수일시']),
                    last_edit_date: parseKoreanDate(record['최종편집일시']),
                    complainant_tel_no: (record['신고자연락처'] || '').substring(0, 20),
                    complainant_truck_no: (record['차량번호'] || '').substring(0, 20),
                    complainant_con_no: (record['컨테이너번호'] || '').substring(0, 20),
                    target_service: (record['서비스명'] || '').substring(0, 100),
                    target_terminal: (record['터미널'] || '').substring(0, 100),
                    complaint_status: (record['처리상태'] || '').substring(0, 50),
                    complaint_receiver: (record['접수자'] || '').substring(0, 50),
                    complaint_handler: (record['처리자'] || '').substring(0, 50),
                    complaint_type: (record['민원유형`'] || '').substring(0, 100),
                    complaint_detail_type: (record['상세민원유형'] || '').substring(0, 100),
                    complaint_title: (record['민원내용'] || '').substring(0, 200),
                    complaint_content: (record['문의상세'] || '').substring(0, 1000),
                    complaint_processing: (record['처리내용'] || '').substring(0, 1000),
                    complaint_handling: (record['민원처리'] || '').substring(0, 1000)
                };

                // 데이터 삽입
                await conn.query(
                    `INSERT INTO t_complaint (
                        complaint_id, complaint_date, last_edit_date, complainant_tel_no,
                        complainant_truck_no, complainant_con_no, target_service,
                        target_terminal, complaint_status, complaint_receiver,
                        complaint_handler, complaint_type, complaint_detail_type,
                        complaint_title, complaint_content, complaint_processing,
                        complaint_handling
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    Object.values(complaintData)
                );

                console.log(`Inserted record: ${complaintData.complaint_id}`);
            } catch (err) {
                if (err.code === 'ER_DATA_TOO_LONG') {
                    console.warn(`Warning: Data too long for record ${record['ID-2']}, truncated and continuing...`);
                    continue;
                } else if (err.code === 'ER_DUP_ENTRY') {
                    console.warn(`Warning: Duplicate entry for record ${record['ID-2']}, skipping...`);
                    continue;
                } else {
                    console.error(`Error processing record ${record['ID-2']}:`, err);
                    continue;
                }
            }
        }

        console.log('Migration completed successfully!');
    } catch (err) {
        console.error('Error during migration:', err);
    } finally {
        if (conn) conn.release();
        await pool.end();
    }
}

migrateData();