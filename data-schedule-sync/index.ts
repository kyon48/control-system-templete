import 'dotenv/config';
import mariadb from 'mariadb';
import { Client } from '@notionhq/client';
import path from 'path';
import fs from 'fs';
import axios from 'axios';

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
    page_id: string;
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

interface PageContent {
    complaint_id: string;
    page_content: string;
}

interface ImageData {
    complaint_id: string;
    image_path: string;
    image_name: string;
}

// 한국어 날짜를 Date 객체로 변환하는 함수
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

    // ISO 형식 처리 - 노션 API에서 가져온 시간은 UTC이므로 한국 시간으로 변환
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            console.warn(`Invalid date string: ${dateStr}, using current date`);
            return new Date();
        }
        // UTC 시간에 9시간을 더해 한국 시간으로 변환
        return new Date(date.getTime() + 9 * 60 * 60 * 1000);
    } catch (error) {
        console.warn(`Error parsing date: ${dateStr}, using current date`);
        return new Date();
    }
}


// 한국 시간 형식으로 포맷팅하는 함수
function formatKoreanTime(date: Date): string {
    return date.toISOString().replace('T', ' ').slice(0, 19);
}   

// 이미지 다운로드 함수
async function downloadImage(url: string, filePath: string): Promise<void> {
    const response = await axios({
        method: 'GET',
        url: url,
        responseType: 'stream'
    });

    const writer = fs.createWriteStream(filePath);
    (response.data as any).pipe(writer);

    return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });
}

// Notion API 호출을 위한 재시도 함수
async function retryNotionApiCall<T>(
    apiCall: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 2000
): Promise<T> {
    let lastError: any;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await apiCall();
        } catch (error: any) {
            lastError = error;
            
            // 특정 에러 코드에 대해서만 재시도
            if (error.code === 'notionhq_client_request_timeout' ||
                error.code === 'notionhq_client_response_error' ||
                error.code === 'ECONNRESET' ||
                error.status === 502) {
                
                console.log(`Retry attempt ${i + 1}/${maxRetries} after error: ${error.message}`);
                
                // 지수 백오프 적용
                const backoffDelay = delay * Math.pow(2, i);
                await new Promise(resolve => setTimeout(resolve, backoffDelay));
                continue;
            }
            
            // 재시도하지 않을 에러는 바로 throw
            throw error;
        }
    }
    
    throw lastError;
}

// 각 속성의 값을 추출하는 헬퍼 함수
const getPropertyValue = (properties: any, propertyName: string, type: string) => {
    const property = properties[propertyName];
    if (!property) return '';

    switch (type) {
        case 'title':
            return (property as any).title?.[0]?.plain_text || '';
        case 'select':
            return (property as any).select?.name || '';
        case 'multi_select':
            return (property as any).multi_select?.map((item: any) => item.name).join(', ') || '';
        case 'status':
            return (property as any).status?.name || '';
        case 'rich_text':
            return (property as any).rich_text?.[0]?.plain_text || '';
        case 'number':
            return (property as any).number?.toString() || '';
        case 'unique_id':
            return (property as any).unique_id?.number?.toString() || '';
        default:
            return '';
    }
};

// 노션 페이지 ID 조회 및 저장 함수
async function fetchAndSaveNotionPageId(conn: mariadb.PoolConnection, complaintId: string) {
    try {
        // complaintId에서 숫자 부분만 추출
        const numericId = complaintId.replace('CALL-', '');
        console.log(`Searching for Notion page with ID: ${numericId}`);

        const response = await retryNotionApiCall(() => 
            notion.databases.query({
                database_id: process.env.NOTION_DATABASE_ID || '',
                filter: {
                    and: [
                        {
                            property: 'ID-2',
                            unique_id: {
                                equals: parseInt(numericId)
                            }
                        }
                    ]
                }
            })
        );

        console.log(`Found ${response.results.length} matching pages`);

        if (response.results.length > 0) {
            const page = response.results[0];
            const properties = (page as any).properties;

            // 각 속성의 값을 추출하는 헬퍼 함수
            const getPropertyValue = (propertyName: string, type: string) => {
                const property = properties[propertyName];
                if (!property) return '';

                switch (type) {
                    case 'title':
                        return (property as any).title?.[0]?.plain_text || '';
                    case 'select':
                        return (property as any).select?.name || '';
                    case 'multi_select':
                        return (property as any).multi_select?.map((item: any) => item.name).join(', ') || '';
                    case 'status':
                        return (property as any).status?.name || '';
                    case 'rich_text':
                        return (property as any).rich_text?.[0]?.plain_text || '';
                    case 'number':
                        return (property as any).number?.toString() || '';
                    case 'unique_id':
                        return (property as any).unique_id?.number?.toString() || '';
                    default:
                        return '';
                }
            };

            // 페이지 ID 확인
            const pageId = (page as any).id;
            const pageUniqueId = getPropertyValue('ID-2', 'unique_id');

            // ID가 일치하는지 확인
            if (pageUniqueId === numericId) {
                // page_id 업데이트
                await conn.query(
                    'UPDATE t_complaint SET page_id = ? WHERE complaint_id = ?',
                    [pageId, complaintId]
                );
                
                console.log(`Updated page_id for complaint: ${complaintId}`);
                return pageId;
            } else {
                console.warn(`ID mismatch for complaint ${complaintId}: expected ${numericId}, got ${pageUniqueId}`);
                return null;
            }
        } else {
            console.warn(`No Notion page found for complaint: ${complaintId}`);
            return null;
        }
    } catch (err) {
        console.error(`Error fetching Notion page ID for complaint ${complaintId}:`, err);
        return null;
    }
}

// 페이지 내용과 이미지 저장 함수
async function savePageContentAndImages(conn: mariadb.PoolConnection, pageId: string, complaintId: string) {
    try {
        // 페이지 내용 가져오기
        const pageContent = await retryNotionApiCall(() => 
            notion.blocks.children.list({
                block_id: pageId
            })
        );

        // 페이지 메타데이터 가져오기
        const pageMetadata = await retryNotionApiCall(() =>
            notion.pages.retrieve({
                page_id: pageId
            })
        );

        const properties = (pageMetadata as any).properties;

        // 페이지 내용을 마크다운으로 변환
        let markdownContent = '';
        for (const block of pageContent.results) {
            if ((block as any).type === 'paragraph') {
                markdownContent += (block as any).paragraph.rich_text.map((text: any) => text.plain_text).join('') + '\n\n';
            }
        }

        // 이미지 처리
        const images: ImageData[] = [];
        let imageIndex = 1;
        for (const block of pageContent.results) {
            if ((block as any).type === 'image') {
                const imageUrl = (block as any).image.file?.url || (block as any).image.external?.url;
                if (imageUrl) {
                    // URL에서 파일 확장자 추출
                    const urlObj = new URL(imageUrl);
                    const pathname = urlObj.pathname;
                    const extension = path.extname(pathname) || '.jpg';

                    // 새로운 파일 이름 생성 (complaint_id_imageIndex.extension)
                    const imageName = `${complaintId}_image${imageIndex}${extension}`;
                    const imagePath = `images/${complaintId}/${imageName}`;
                    const fullImagePath = path.join(__dirname, '..', imagePath);

                    // 이미지 디렉토리 생성
                    const imageDir = path.dirname(fullImagePath);
                    if (!fs.existsSync(imageDir)) {
                        fs.mkdirSync(imageDir, { recursive: true });
                    }

                    try {
                        // 이미지 다운로드
                        await downloadImage(imageUrl, fullImagePath);

                        images.push({
                            complaint_id: complaintId,
                            image_path: imagePath,
                            image_name: imageName
                        });

                        imageIndex++;
                    } catch (err) {
                        console.error(`Error downloading image for complaint ${complaintId}:`, err);
                        continue;
                    }
                }
            }
        }

        // 노션 API에서 가져온 시간은 UTC이므로 한국 시간(KST)으로 변환
        const utcCreatedTime = new Date((pageMetadata as any).created_time);
        const utcLastEditedTime = new Date((pageMetadata as any).last_edited_time);
        
        // UTC 시간에 9시간을 더해 한국 시간으로 변환
        const createdTime = new Date(utcCreatedTime.getTime() + 9 * 60 * 60 * 1000);
        const lastEditedTime = new Date(utcLastEditedTime.getTime() + 9 * 60 * 60 * 1000);

        // 날짜가 유효한지 확인
        if (isNaN(createdTime.getTime()) || isNaN(lastEditedTime.getTime())) {
            console.error(`Invalid date for complaint ${complaintId}, using current date`);
            return;
        }

        const complaintData: ComplaintData = {
            complaint_id: complaintId,
            page_id: pageId,
            complaint_date: createdTime,
            last_edit_date: lastEditedTime,
            complainant_tel_no: (getPropertyValue(properties, '신고자연락처', 'rich_text') || '').substring(0, 20),
            complainant_truck_no: (getPropertyValue(properties, '차량번호', 'rich_text') || '').substring(0, 20),
            complainant_con_no: (getPropertyValue(properties, '컨테이너번호', 'rich_text') || '').substring(0, 20),
            target_service: (getPropertyValue(properties, '서비스명', 'select') || '').substring(0, 100),
            target_terminal: (getPropertyValue(properties, '터미널', 'multi_select') || '').substring(0, 100),
            complaint_status: (getPropertyValue(properties, '처리상태', 'status') || '').substring(0, 50),
            complaint_receiver: (getPropertyValue(properties, '접수자', 'select') || '').substring(0, 50),
            complaint_handler: (getPropertyValue(properties, '처리자', 'select') || '').substring(0, 50),
            complaint_type: (getPropertyValue(properties, '민원유형', 'select') || '').substring(0, 100),
            complaint_detail_type: (getPropertyValue(properties, '상세민원유형', 'multi_select') || '').substring(0, 100),
            complaint_title: (getPropertyValue(properties, '민원내용', 'title') || '').substring(0, 200),
            complaint_content: (getPropertyValue(properties, '문의상세', 'rich_text') || '').substring(0, 1000),
            complaint_processing: (getPropertyValue(properties, '처리내용', 'rich_text') || '').substring(0, 1000),
            complaint_handling: (getPropertyValue(properties, '민원처리', 'rich_text') || '').substring(0, 1000)
        };

        // ID가 비어있으면 건너뛰기
        if (!complaintData.complaint_id || complaintData.complaint_id === 'CALL-null') {
            console.log('Skipping record with empty ID');
            return;
        }

        try {
            // 기존 complaint 데이터 저장
            await conn.query(
                `INSERT INTO t_complaint (
                    complaint_id, page_id, complaint_date, last_edit_date, complainant_tel_no,
                    complainant_truck_no, complainant_con_no, target_service,
                    target_terminal, complaint_status, complaint_receiver,
                    complaint_handler, complaint_type, complaint_detail_type,
                    complaint_title, complaint_content, complaint_processing,
                    complaint_handling
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    page_id = VALUES(page_id),
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

            // 페이지 내용 저장
            await conn.query(
                `INSERT INTO t_complaint_content (complaint_id, page_content)
                VALUES (?, ?)
                ON DUPLICATE KEY UPDATE
                page_content = VALUES(page_content)`,
                [complaintData.complaint_id, markdownContent]
            );

            // 이미지 정보 저장
            for (const image of images) {
                await conn.query(
                    `INSERT INTO t_complaint_images (complaint_id, image_path, image_name)
                    VALUES (?, ?, ?)`,
                    [image.complaint_id, image.image_path, image.image_name]
                );
            }

            console.log(`Inserted new complaint: ${complaintData.complaint_id}`);
        } catch (err) {
            console.error(`Error inserting complaint ${complaintData.complaint_id}:`, err);
        }
    } catch (err) {
        console.error(`Error saving page content and images for complaint ${complaintId}:`, err);
    }
}

async function syncData() {
    let conn;
    try {
        conn = await pool.getConnection();
        console.log('\nConnection acquired');
        console.log('Connected to MySQL database');

        const now = new Date();
        const specificMinutesAgo = new Date(now.getTime() - (10 * 60 * 1000));
        // const koreanSpecificMinutesAgo = getKoreanTime(specificMinutesAgo);

        console.log('Running data sync task:', formatKoreanTime(now));

        const response = await retryNotionApiCall(() => 
            notion.databases.query({
                database_id: process.env.NOTION_DATABASE_ID || '',
                filter: {
                    timestamp: 'last_edited_time',
                    last_edited_time: {
                        after: specificMinutesAgo.toISOString()
                    }
                }
            })
        );

        console.log(`Fetched ${response.results.length} complaints updated in the last 10 minutes`);

        for (const page of response.results) {
            const properties = (page as any).properties;
            const pageId = (page as any).id;
            
            // 노션 API에서 가져온 시간은 UTC이므로 한국 시간(KST)으로 변환
            const utcCreatedTime = new Date((page as any).created_time);
            const utcLastEditedTime = new Date((page as any).last_edited_time);
            
            // UTC 시간에 9시간을 더해 한국 시간으로 변환
            const createdTime = new Date(utcCreatedTime.getTime() + 9 * 60 * 60 * 1000);
            const lastEditedTime = new Date(utcLastEditedTime.getTime() + 9 * 60 * 60 * 1000);

            // 날짜가 유효한지 확인
            if (isNaN(createdTime.getTime()) || isNaN(lastEditedTime.getTime())) {
                console.error(`Invalid date for complaint ${pageId}, skipping...`);
                continue;
            }

            const numericId = getPropertyValue(properties, 'ID-2', 'unique_id');
            const complaintId = `CALL-${numericId}`;

            const complaintData: ComplaintData = {
                complaint_id: complaintId,
                page_id: pageId,
                complaint_date: createdTime,
                last_edit_date: lastEditedTime,
                complainant_tel_no: (getPropertyValue(properties, '신고자연락처', 'rich_text') || '').substring(0, 20),
                complainant_truck_no: (getPropertyValue(properties, '차량번호', 'rich_text') || '').substring(0, 20),
                complainant_con_no: (getPropertyValue(properties, '컨테이너번호', 'rich_text') || '').substring(0, 20),
                target_service: (getPropertyValue(properties, '서비스명', 'select') || '').substring(0, 100),
                target_terminal: (getPropertyValue(properties, '터미널', 'multi_select') || '').substring(0, 100),
                complaint_status: (getPropertyValue(properties, '처리상태', 'status') || '').substring(0, 50),
                complaint_receiver: (getPropertyValue(properties, '접수자', 'select') || '').substring(0, 50),
                complaint_handler: (getPropertyValue(properties, '처리자', 'select') || '').substring(0, 50),
                complaint_type: (getPropertyValue(properties, '민원유형', 'select') || '').substring(0, 100),
                complaint_detail_type: (getPropertyValue(properties, '상세민원유형', 'multi_select') || '').substring(0, 100),
                complaint_title: (getPropertyValue(properties, '민원내용', 'title') || '').substring(0, 200),
                complaint_content: (getPropertyValue(properties, '문의상세', 'rich_text') || '').substring(0, 1000),
                complaint_processing: (getPropertyValue(properties, '처리내용', 'rich_text') || '').substring(0, 1000),
                complaint_handling: (getPropertyValue(properties, '민원처리', 'rich_text') || '').substring(0, 1000)
            };

            // ID가 비어있으면 건너뛰기
            if (!complaintData.complaint_id || complaintData.complaint_id === 'CALL-null') {
                console.log('Skipping record with empty ID');
                continue;
            }

            try {
                // 페이지 내용과 이미지 저장
                await savePageContentAndImages(conn, pageId, complaintId);
                
                // 기존 complaint 데이터 저장
                await conn.query(
                    `INSERT INTO t_complaint (
                        complaint_id, page_id, complaint_date, last_edit_date, complainant_tel_no,
                        complainant_truck_no, complainant_con_no, target_service,
                        target_terminal, complaint_status, complaint_receiver,
                        complaint_handler, complaint_type, complaint_detail_type,
                        complaint_title, complaint_content, complaint_processing,
                        complaint_handling
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        page_id = VALUES(page_id),
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

                console.log(`Inserted/Updated complaint: ${complaintData.complaint_id}`);
            } catch (err) {
                console.error(`Error processing complaint ${complaintData.complaint_id}:`, err);
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

// 1분마다 데이터 동기화 실행
setInterval(syncData, 1 * 60 * 1000);

// 초기 실행
syncData();