import 'dotenv/config';
import mariadb from 'mariadb';
import { Client } from '@notionhq/client';

// MariaDB 연결 풀 생성
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT || '3306'),
    connectionLimit: 5
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

// 한국어 날짜를 Date 객체로 변환하는 함수
function parseKoreanDate(dateStr: string): Date {
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

    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), hour24, parseInt(minute));
}

// 한국 시간으로 변환하는 함수
function getKoreanTime(date: Date): Date {
    return new Date(date.getTime() + (9 * 60 * 60 * 1000)); // UTC+9
}

// 한국 시간 형식으로 포맷팅하는 함수
function formatKoreanTime(date: Date): string {
    const koreanDate = getKoreanTime(date);
    return koreanDate.toISOString().replace('T', ' ').slice(0, 19);
}

async function syncData() {
    let conn;
    try {
        conn = await pool.getConnection();
        console.log('\nConnection acquired');
        console.log('Connected to MySQL database');

        // 현재 한국 시간 기준으로 5분 전 시간 계산
        const now = new Date();
        const fiveMinutesAgo = new Date(now.getTime() - (5 * 60 * 1000));
        const koreanFiveMinutesAgo = getKoreanTime(fiveMinutesAgo);

        console.log('Running data sync task:', formatKoreanTime(now));

        const response = await notion.databases.query({
            database_id: process.env.NOTION_DATABASE_ID || '',
            filter: {
                timestamp: 'last_edited_time',
                last_edited_time: {
                    after: koreanFiveMinutesAgo.toISOString()
                }
            }
        });

        console.log(`Fetched ${response.results.length} complaints updated in the last 5 minutes`);

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
                    default:
                        return null;
                }
            };

            // 날짜 형식 변환 (한국 시간 기준)
            const createdTime = getKoreanTime(new Date((page as any).created_time));
            const formattedDate = `${createdTime.getFullYear()}.${String(createdTime.getMonth() + 1).padStart(2, '0')}.${String(createdTime.getDate()).padStart(2, '0')} ${String(createdTime.getHours()).padStart(2, '0')}:${String(createdTime.getMinutes()).padStart(2, '0')}:${String(createdTime.getSeconds()).padStart(2, '0')}`;

            const complaintData: ComplaintData = {
                complaint_id: `CALL-${getPropertyValue('ID-2', 'unique_id')}`,
                complaint_date: parseKoreanDate(formattedDate),
                last_edit_date: parseKoreanDate(formattedDate),
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
                await conn.query(
                    `INSERT INTO t_complaint (
                        complaint_id, complaint_date, last_edit_date, complainant_tel_no,
                        complainant_truck_no, complainant_con_no, target_service,
                        target_terminal, complaint_status, complaint_receiver,
                        complaint_handler, complaint_type, complaint_detail_type,
                        complaint_title, complaint_content, complaint_processing,
                        complaint_handling
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        complaint_date = VALUES(complaint_date),
                        last_edit_date = VALUES(last_edit_date),
                        complainant_tel_no = VALUES(complainant_tel_no),
                        complainant_truck_no = VALUES(complainant_truck_no),
                        complainant_con_no = VALUES(complainant_con_no),
                        target_service = VALUES(target_service),
                        target_terminal = VALUES(target_terminal),
                        complaint_status = VALUES(complaint_status),
                        complaint_receiver = VALUES(complaint_receiver),
                        complaint_handler = VALUES(complaint_handler),
                        complaint_type = VALUES(complaint_type),
                        complaint_detail_type = VALUES(complaint_detail_type),
                        complaint_title = VALUES(complaint_title),
                        complaint_content = VALUES(complaint_content),
                        complaint_processing = VALUES(complaint_processing),
                        complaint_handling = VALUES(complaint_handling)`,
                    Object.values(complaintData)
                );
                console.log(`Inserted new complaint: ${complaintData.complaint_id}`);
            } catch (err) {
                console.error(`Error inserting complaint ${complaintData.complaint_id}:`, err);
            }
        }

        console.log('Data synchronization completed successfully');
    } catch (err) {
        console.error('Error during data sync:', err);
    } finally {
        if (conn) {
            conn.release();
            console.log('Connection released');
        }
    }
}

// 5분마다 데이터 동기화 실행
setInterval(syncData, 5 * 60 * 1000);

// 초기 실행
syncData();