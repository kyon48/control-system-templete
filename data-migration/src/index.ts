import 'dotenv/config';
import mariadb from 'mariadb';
import fs from 'fs';
import { parse } from 'csv-parse';
import path from 'path';
import { Client } from '@notionhq/client';
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

// MariaDB 연결 풀 생성
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '33306'),
    connectionLimit: 5,
    keepAliveDelay: 10000,
    idleTimeout: 60000,
    timezone: '+09:00',
    connectTimeout: 20000,
    acquireTimeout: 20000
});

// Notion 클라이언트 초기화
const notion = new Client({
    auth: process.env.NOTION_API_KEY,
});

interface ComplaintData {
    complaint_id: string;
    complaint_date: Date;
    last_edit_date: Date;
    complainant_tel_no: string;
    complainant_truck_no: string;
    complainant_con_no: string;
    target_service: string;
    target_terminal: string;
    complaint_status: string;
    complaint_receiver: string;
    complaint_handler: string;
    complaint_type: string;
    complaint_detail_type: string;
    complaint_title: string;
    complaint_content: string;
    complaint_processing: string;
    complaint_handling: string;
}

function parseDate(dateStr: string): Date {
    if (!dateStr) return new Date();

    // 한국어 날짜 형식 처리 (예: "2025년 5월 12일 오전 11:37")
    const koreanMatch = dateStr.match(/(\d{4})년 (\d{1,2})월 (\d{1,2})일 (오전|오후) (\d{1,2}):(\d{2})/);
    if (koreanMatch) {
        const [_, year, month, day, ampm, hour, minute] = koreanMatch;
        let hour24 = parseInt(hour);

        if (ampm === '오후' && hour24 < 12) {
            hour24 += 12;
        }
        if (ampm === '오전' && hour24 === 12) {
            hour24 = 0;
        }

        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hour24, parseInt(minute));
        return date;
    }

    // ISO 형식 처리
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            console.warn(`Invalid date string: ${dateStr}, using current date`);
            return new Date();
        }
        // UTC 시간에 9시간을 더해 KST로 변환
        return new Date(date.getTime() + 9 * 60 * 60 * 1000);
    } catch (error) {
        console.warn(`Error parsing date: ${dateStr}, using current date`);
        return new Date();
    }
}

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
                trim: true,
                delimiter: ',',
                relax_quotes: true,
                relax_column_count: true
            }));

        for await (const record of parser) {
            try {
                // CSV 데이터를 DB 스키마에 맞게 변환
                const complaintData: ComplaintData = {
                    complaint_id: record['ID-2'] || '',
                    complaint_date: parseDate(record['접수일시']),
                    last_edit_date: parseDate(record['최종편집일시']),
                    complainant_tel_no: (record['신고자연락처'] || '').substring(0, 20),
                    complainant_truck_no: (record['차량번호'] || '').substring(0, 20),
                    complainant_con_no: (record['컨테이너번호'] || '').substring(0, 20),
                    target_service: (record['서비스명'] || '').substring(0, 100),
                    target_terminal: (record['터미널'] || '').substring(0, 100),
                    complaint_status: (record['처리상태'] || '').substring(0, 50),
                    complaint_receiver: (record['접수자'] || '').substring(0, 50),
                    complaint_handler: (record['처리자'] || '').substring(0, 50),
                    complaint_type: (record['민원유형'] || '').substring(0, 100),
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
            } catch (err: any) {
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
        throw err;
    } finally {
        if (conn) {
            conn.release();
        }
    }
}

// 최신 데이터 동기화 함수
async function syncLatestData(conn: mariadb.PoolConnection) {
    try {
        console.log('Fetching latest data from Notion...');
        const response = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID || '',
            sorts: [
                {
                    property: '최종편집일시',
                    direction: 'descending',
                },
            ],
            page_size: 100,
        });

        for (const page of response.results) {
            const properties = (page as any).properties;
            
            // 각 속성의 값을 추출하는 헬퍼 함수
            const getPropertyValue = (propertyName: string, type: string) => {
                const property = properties[propertyName];
                if (!property) return null;

                switch (type) {
                    case 'select':
                        return (property as any).select?.name || null;
                    case 'multi_select':
                        return (property as any).multi_select?.map((item: any) => item.name).join(', ') || null;
                    case 'status':
                        return (property as any).status?.name || null;
                    case 'rich_text':
                        return (property as any).rich_text?.[0]?.plain_text || null;
                    case 'number':
                        return (property as any).number?.toString() || null;
                    case 'unique_id':
                        return (property as any).unique_id?.number?.toString() || null;
                    case 'date':
                        return (property as any).date?.start || null;
                    default:
                        return null;
                }
            };
            const complaintId = `CALL-${getPropertyValue('ID-2', 'unique_id')}`;

            const createdTime = new Date(new Date((page as PageObjectResponse).created_time).getTime());
            const editedTime = new Date(new Date((page as PageObjectResponse).last_edited_time).getTime());
            
            const formattedcreatedTime = `${createdTime.getFullYear()}.${String(createdTime.getMonth() + 1).padStart(2, '0')}.${String(createdTime.getDate()).padStart(2, '0')} ${String(createdTime.getHours()).padStart(2, '0')}:${String(createdTime.getMinutes()).padStart(2, '0')}:${String(createdTime.getSeconds()).padStart(2, '0')}`;
            const formattedEditedTime = `${editedTime.getFullYear()}.${String(editedTime.getMonth() + 1).padStart(2, '0')}.${String(editedTime.getDate()).padStart(2, '0')} ${String(editedTime.getHours()).padStart(2, '0')}:${String(editedTime.getMinutes()).padStart(2, '0')}:${String(editedTime.getSeconds()).padStart(2, '0')}`;

            const complaintData: ComplaintData = {
                complaint_id: complaintId,
                complaint_date: parseDate(formattedcreatedTime),
                last_edit_date: parseDate(formattedEditedTime),
                complainant_tel_no: (getPropertyValue('신고자연락처', 'rich_text') || '').substring(0, 20),
                complainant_truck_no: (getPropertyValue('차량번호', 'rich_text') || '').substring(0, 20),
                complainant_con_no: (getPropertyValue('컨테이너번호', 'rich_text') || '').substring(0, 20),
                target_service: (getPropertyValue('서비스명', 'select') || '').substring(0, 100),
                target_terminal: (getPropertyValue('터미널', 'multi_select') || '').substring(0, 100),
                complaint_status: (getPropertyValue('처리상태', 'status') || '').substring(0, 50),
                complaint_receiver: (getPropertyValue('접수자', 'select') || '').substring(0, 50),
                complaint_handler: (getPropertyValue('처리자', 'select') || '').substring(0, 50),
                complaint_type: (getPropertyValue('민원유형', 'select') || '').substring(0, 100),
                complaint_detail_type: (getPropertyValue('상세민원유형', 'multi_select') || '').substring(0, 100),
                complaint_title: (getPropertyValue('민원제목', 'rich_text') || '').substring(0, 200),
                complaint_content: (getPropertyValue('민원내용', 'rich_text') || '').substring(0, 1000),
                complaint_processing: (getPropertyValue('민원처리', 'rich_text') || '').substring(0, 1000),
                complaint_handling: (getPropertyValue('민원처리', 'rich_text') || '').substring(0, 1000)
            };

            // ID가 비어있으면 건너뛰기
            if (!complaintData.complaint_id || complaintData.complaint_id === 'CALL-null') {
                console.log('Skipping record with empty ID');
                continue;
            }

            try {
                // 기존 데이터 확인
                const [existingRows] = await conn.execute(
                    'SELECT complaint_id FROM t_complaint WHERE complaint_id = ?',
                    [complaintId]
                );
                console.log(existingRows);
                if (existingRows) {
                    // 업데이트
                    const updateQuery = `
                        UPDATE t_complaint SET
                        complaint_date = ?,
                        last_edit_date = ?,
                        complainant_tel_no = ?,
                        complainant_truck_no = ?,
                        complainant_con_no = ?,
                        target_service = ?,
                        target_terminal = ?,
                        complaint_status = ?,
                        complaint_receiver = ?,
                        complaint_handler = ?,
                        complaint_type = ?,
                        complaint_detail_type = ?,
                        complaint_title = ?,
                        complaint_content = ?,
                        complaint_processing = ?,
                        complaint_handling = ?
                        WHERE complaint_id = ?
                    `;

                    await conn.execute(updateQuery, Object.values(complaintData));
                    console.log(`Updated record: ${complaintData.complaint_id}`);
                } else {
                    // 삽입
                    const insertQuery = `
                        INSERT INTO t_complaint (
                            complaint_id, complaint_date, last_edit_date, complainant_tel_no,
                            complainant_truck_no, complainant_con_no, target_service,
                            target_terminal, complaint_status, complaint_receiver,
                            complaint_handler, complaint_type, complaint_detail_type,
                            complaint_title, complaint_content, complaint_processing,
                            complaint_handling
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `

                    await conn.execute(insertQuery, Object.values(complaintData));                    
                    console.log(`Inserted record: ${complaintData.complaint_id}`);
                }
            } catch (err) {
                console.error(`Error processing record ${complaintData.complaint_id}:`, err);
                throw err;
            }
        }
        console.log('Latest data sync completed successfully!');
    } catch (err) {
        console.error('Error during latest data sync:', err);
        throw err;
    }
}

async function main() {
    let conn;
    try {
        console.log('Starting data migration...');
        await migrateData();
        
        console.log('Starting latest data sync...');
        conn = await pool.getConnection();
        await syncLatestData(conn);
        
        console.log('All processes completed successfully!');
    } catch (err) {
        console.error('Error in main process:', err);
    } finally {
        if (conn) {
            conn.release();
        }
        await pool.end();
    }
}

// Handle termination signals
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    await pool.end();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('Received SIGINT. Shutting down gracefully...');
    await pool.end();
    process.exit(0);
});

main().catch(console.error); 
