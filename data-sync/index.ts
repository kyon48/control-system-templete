import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import mysql from 'mysql2/promise';
import cron from 'node-cron';

// .env 파일 로드
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });

// MySQL 연결 설정
const dbConfig = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000, // 10초
  maxIdle: 10, // 최대 유휴 연결 수
  idleTimeout: 60000, // 60초
  timezone: '+09:00',
  connectTimeout: 20000, // 20초
  acquireTimeout: 20000, // 20초
};

// 커넥션 풀 생성
const pool = mysql.createPool(dbConfig);

// 커넥션 풀 이벤트 핸들러 등록
pool.on('acquire', function (connection) {
  console.log('Connection %d acquired', connection.threadId);
});

pool.on('release', function (connection) {
  console.log('Connection %d released', connection.threadId);
});

pool.on('enqueue', function () {
  console.log('Waiting for available connection slot');
});

// 타입 가드 함수
function isPageObjectResponse(page: any): page is PageObjectResponse {
  return page && 'properties' in page;
}

async function upsertComplaint(connection: mysql.Connection, complaint: any) {
  try {
    // complaintId로 기존 데이터 확인
    const [rows]: any = await connection.execute(
      'SELECT complaint_id FROM t_complaint WHERE complaint_id = ?',
      [complaint.complaintId]
    );

    const complaintData = {
      complaint_id: complaint.complaintId,
      complaint_date: complaint.complaintDate || null,
      last_edit_date: complaint.lastEditDate || null,
      complainant_tel_no: complaint.complainantTelNo || '',
      complainant_truck_no: complaint.complainantTruckNo || '',
      complainant_con_no: complaint.complainantConNo || '',
      target_service: complaint.targetService || '',
      target_terminal: complaint.targetTerminal || '',
      complaint_status: complaint.complaintStatus || '',
      complaint_receiver: complaint.complaintReceiver || '',
      complaint_handler: complaint.complaintHandler || '',
      complaint_type: complaint.complaintType || '',
      complaint_detail_type: complaint.complaintDetailType || '',
      complaint_title: complaint.complaintTitle || '',
      complaint_content: complaint.complaintContent || '',
      complaint_processing: complaint.complaintProcessing || '',
      complaint_handling: JSON.stringify(complaint.complaintHandling || [])
    };

    if (rows.length > 0) {
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

      await connection.execute(updateQuery, [
        complaintData.complaint_date,
        complaintData.last_edit_date,
        complaintData.complainant_tel_no,
        complaintData.complainant_truck_no,
        complaintData.complainant_con_no,
        complaintData.target_service,
        complaintData.target_terminal,
        complaintData.complaint_status,
        complaintData.complaint_receiver,
        complaintData.complaint_handler,
        complaintData.complaint_type,
        complaintData.complaint_detail_type,
        complaintData.complaint_title,
        complaintData.complaint_content,
        complaintData.complaint_processing,
        complaintData.complaint_handling,
        complaintData.complaint_id
      ]);

      console.log(`Updated complaint: ${complaint.complaintId}`);
    } else {
      // 삽입
      const insertQuery = `
        INSERT INTO t_complaint (
          complaint_id, complaint_date, last_edit_date, complainant_tel_no, complainant_truck_no,
          complainant_con_no, target_service, target_terminal, complaint_status,
          complaint_receiver, complaint_handler, complaint_type, complaint_detail_type,
          complaint_title, complaint_content, complaint_processing, complaint_handling
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await connection.execute(insertQuery, [
        complaintData.complaint_id,
        complaintData.complaint_date,
        complaintData.last_edit_date,
        complaintData.complainant_tel_no,
        complaintData.complainant_truck_no,
        complaintData.complainant_con_no,
        complaintData.target_service,
        complaintData.target_terminal,
        complaintData.complaint_status,
        complaintData.complaint_receiver,
        complaintData.complaint_handler,
        complaintData.complaint_type,
        complaintData.complaint_detail_type,
        complaintData.complaint_title,
        complaintData.complaint_content,
        complaintData.complaint_processing,
        complaintData.complaint_handling
      ]);

      console.log(`Inserted new complaint: ${complaint.complaintId}`);
    }
  } catch (error) {
    console.error(`Error processing complaint ${complaint.complaintId}:`, error);
    throw error;
  }
}

async function main() {
  console.log('Starting data sync service...');

  console.log('Running data sync task:', new Date().toISOString());
  let connection;

  try {
    // 커넥션 풀에서 연결 가져오기
    connection = await pool.getConnection();
    console.log('Connected to MySQL database');

    // 필터 조건 구성 - 최근 5분 동안의 데이터만 가져오기
    const response = await notion.databases.query({
      database_id: process.env.NOTION_DATABASE_ID || '',
      sorts: [
        {
          property: '최종편집일시',
          direction: 'descending'
        }
      ]
    });

    const simplifiedData = response.results
      .filter(isPageObjectResponse)
      .map(page => {
        const properties = page.properties;

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

        // 날짜 형식 변환
        const createdTime = new Date(page.created_time);
        const formattedDate = `${createdTime.getFullYear()}.${String(createdTime.getMonth() + 1).padStart(2, '0')}.${String(createdTime.getDate()).padStart(2, '0')} ${String(createdTime.getHours()).padStart(2, '0')}:${String(createdTime.getMinutes()).padStart(2, '0')}:${String(createdTime.getSeconds()).padStart(2, '0')}`;

        return {
          complaintId: `CALL-${getPropertyValue('ID-2', 'unique_id')}`,
          complaintDate: formattedDate,
          lastEditDate: formattedDate,
          complainantTelNo: getPropertyValue('신고자연락처', 'rich_text'),
          complainantTruckNo: getPropertyValue('차량번호', 'rich_text'),
          complainantConNo: getPropertyValue('컨테이너번호', 'rich_text'),
          targetService: getPropertyValue('서비스명', 'select'),
          targetTerminal: getPropertyValue('터미널', 'multi_select'),
          complaintStatus: getPropertyValue('처리상태', 'status'),
          complaintReceiver: getPropertyValue('접수자', 'select'),
          complaintHandler: getPropertyValue('처리자', 'select'),
          complaintType: getPropertyValue('민원유형', 'select'),
          complaintDetailType: getPropertyValue('상세민원유형', 'multi_select'),
          complaintTitle: getPropertyValue('민원제목', 'rich_text'),
          complaintContent: getPropertyValue('민원내용', 'rich_text'),
          complaintProcessing: getPropertyValue('민원처리', 'rich_text'),
          complaintHandling: JSON.parse(getPropertyValue('민원처리', 'rich_text') || '[]')
        };
      });

    // 각 민원 데이터에 대해 upsert 수행
    for (const complaint of simplifiedData) {
      await upsertComplaint(connection, complaint);
    }

    console.log('Data synchronization completed successfully');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    if (connection) {
      connection.release();
      console.log('Database connection released');
    }
  }
}

// Handle termination signals
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Shutting down gracefully...');
  await pool.end(); // 종료 시 커넥션 풀 정리
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT. Shutting down gracefully...');
  await pool.end(); // 종료 시 커넥션 풀 정리
  process.exit(0);
});

main().catch(console.error);