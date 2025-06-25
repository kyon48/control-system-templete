import { Client } from '@notionhq/client';
import { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import axios from 'axios';
import { parse } from 'csv-parse';
import 'dotenv/config';
import fs from 'fs';
import mariadb from 'mariadb';
import path from 'path';

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

interface ImageData {
    complaint_id: string;
    image_path: string;
    image_name: string;
}

interface CommentData {
    comment_id: string;
    complaint_id: string;
    author_name: string;
    comment_content: string;
    comment_created_at: Date;
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

async function savePageComments(conn: mariadb.PoolConnection, pageId: string, complaintId: string) {
    try {
        const response = await notion.comments.list({
            block_id: pageId,
        });

        for (const comment of response.results) {
            if ('created_by' in comment && 'rich_text' in comment && comment.rich_text.length > 0) {
                const author = await notion.users.retrieve({ user_id: comment.created_by.id });
                const authorName = 'name' in author && author.name ? author.name : 'Unknown User';
                
                const commentContent = (comment.rich_text as any[]).map(rt => rt.plain_text).join('');

                const utcCommentCreatedAt = new Date(comment.created_time);
                const kstCommentCreatedAt = new Date(utcCommentCreatedAt.getTime() + 9 * 60 * 60 * 1000);

                const commentData: CommentData = {
                    comment_id: comment.id,
                    complaint_id: complaintId,
                    author_name: authorName,
                    comment_content: commentContent,
                    comment_created_at: kstCommentCreatedAt,
                };

                await conn.query(
                    `INSERT INTO t_complaint_comment (comment_id, complaint_id, author_name, comment_content, comment_created_at)
                     VALUES (?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE
                        author_name = VALUES(author_name),
                        comment_content = VALUES(comment_content),
                        comment_created_at = VALUES(comment_created_at)`,
                    Object.values(commentData)
                );
            }
        }
    } catch (error) {
        console.error(`Error saving comments for page ${pageId}:`, error);
    }
}

// 페이지 내용과 이미지 저장 함수
async function savePageContentAndImages(conn: mariadb.PoolConnection, pageId: string, complaintId: string) {
    try {
        // 페이지 내용 가져오기
        const pageContent = await notion.blocks.children.list({
            block_id: pageId
        });

        // 페이지 내용을 마크다운으로 변환
        let markdownContent = '';
        for (const block of pageContent.results) {
            const blockType = (block as any).type;
            
            switch (blockType) {
                case 'paragraph':
                    const paragraphText = (block as any).paragraph.rich_text.map((text: any) => text.plain_text).join('');
                    if (paragraphText) {
                        markdownContent += paragraphText + '\n\n';
                    }
                    break;
                    
                case 'bulleted_list_item':
                    const bulletText = (block as any).bulleted_list_item.rich_text.map((text: any) => text.plain_text).join('');
                    if (bulletText) {
                        markdownContent += `- ${bulletText}\n`;
                    }
                    break;
                    
                case 'numbered_list_item':
                    const numberText = (block as any).numbered_list_item.rich_text.map((text: any) => text.plain_text).join('');
                    if (numberText) {
                        markdownContent += `1. ${numberText}\n`;
                    }
                    break;
                    
                case 'heading_1':
                    const heading1Text = (block as any).heading_1.rich_text.map((text: any) => text.plain_text).join('');
                    if (heading1Text) {
                        markdownContent += `# ${heading1Text}\n\n`;
                    }
                    break;
                    
                case 'heading_2':
                    const heading2Text = (block as any).heading_2.rich_text.map((text: any) => text.plain_text).join('');
                    if (heading2Text) {
                        markdownContent += `## ${heading2Text}\n\n`;
                    }
                    break;
                    
                case 'heading_3':
                    const heading3Text = (block as any).heading_3.rich_text.map((text: any) => text.plain_text).join('');
                    if (heading3Text) {
                        markdownContent += `### ${heading3Text}\n\n`;
                    }
                    break;
                    
                case 'code':
                    const codeText = (block as any).code.rich_text.map((text: any) => text.plain_text).join('');
                    if (codeText) {
                        markdownContent += '```\n' + codeText + '\n```\n\n';
                    }
                    break;
                    
                case 'quote':
                    const quoteText = (block as any).quote.rich_text.map((text: any) => text.plain_text).join('');
                    if (quoteText) {
                        markdownContent += `> ${quoteText}\n\n`;
                    }
                    break;
            }
        }

        // 페이지 내용 저장
        await conn.query(
            `INSERT INTO t_complaint_content (complaint_id, page_content)
            VALUES (?, ?)
            ON DUPLICATE KEY UPDATE
            page_content = VALUES(page_content)`,
            [complaintId, markdownContent]
        );

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
                    const imagePath = `images/${pageId}/${imageName}`;
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

        // 이미지 정보 저장
        for (const image of images) {
            await conn.query(
                `INSERT INTO t_complaint_images (image_id, complaint_id, image_path, image_name)
                VALUES (NULL, ?, ?, ?)`,
                [image.complaint_id, image.image_path, image.image_name]
            );
        }

        console.log(`Saved page content and images for complaint: ${complaintId}`);

        // 페이지 댓글 저장
        await savePageComments(conn, pageId, complaintId);

    } catch (err) {
        console.error(`Error saving page content and images for complaint ${complaintId}:`, err);
    }
}

// 노션 페이지 ID 조회 및 저장 함수
async function fetchAndSaveNotionPageId(conn: mariadb.PoolConnection, complaintId: string) {
    try {
        // complaintId에서 숫자 부분만 추출
        const numericId = complaintId.replace('CALL-', '');
        console.log(`Searching for Notion page with ID: ${numericId}`);

        const response = await notion.databases.query({
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
        });

        console.log(`Found ${response.results.length} matching pages`);

        if (response.results.length > 0) {
            const page = response.results[0];
            const properties = (page as any).properties;


            // 페이지 ID 확인
            const pageId = (page as any).id;
            const pageUniqueId = getPropertyValue(properties, 'ID-2', 'unique_id');

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

// 모든 complaint에 대한 페이지 내용 저장 함수
async function saveAllPageContents(conn: mariadb.PoolConnection) {
    try {
        console.log('Fetching complaints from the last 30 days to save page contents...');
        
        // t_complaint 테이블에서 page_id가 비어있고, 최근 30일 내에 수정된 complaint_id를 내림차순으로 조회
        const rows = await conn.query(
            'SELECT complaint_id, page_id FROM t_complaint WHERE page_id = "" AND last_edit_date >= DATE_SUB(NOW(), INTERVAL 30 DAY) ORDER BY CAST(SUBSTRING(complaint_id, 6) AS UNSIGNED) DESC'
        );

        console.log(`Found ${rows.length} complaints to process from the last 30 days`);

        for (const row of rows) {
            try {
                // 노션 페이지 ID 조회 및 저장
                const pageId = await fetchAndSaveNotionPageId(conn, row.complaint_id);
                
                if (pageId) {
                    // 페이지 내용과 이미지 저장
                    await savePageContentAndImages(conn, pageId, row.complaint_id);
                    // 페이지 댓글 저장
                    await savePageComments(conn, pageId, row.complaint_id);
                    console.log(`Processed page content for complaint: ${row.complaint_id}`);
                }
            } catch (err) {
                console.error(`Error processing page content for complaint ${row.complaint_id}:`, err);
                continue;
            }
        }

        console.log('All page contents saved successfully');
    } catch (err) {
        console.error('Error saving all page contents:', err);
        throw err;
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
            const pageId = (page as any).id;
            
            // 각 속성의 값을 추출하는 헬퍼 함수
            const complaintId = `CALL-${getPropertyValue(properties, 'ID-2', 'unique_id')}`;

            // 노션 API에서 가져온 시간은 UTC이므로 한국 시간(KST)으로 변환
            const utcCreatedTime = new Date((page as PageObjectResponse).created_time);
            const utcEditedTime = new Date((page as PageObjectResponse).last_edited_time);
            
            // UTC 시간에 9시간을 더해 한국 시간으로 변환
            const createdTime = new Date(utcCreatedTime.getTime() + 9 * 60 * 60 * 1000);
            const editedTime = new Date(utcEditedTime.getTime() + 9 * 60 * 60 * 1000);

            const complaintData: ComplaintData = {
                complaint_id: complaintId,
                page_id: pageId,
                complaint_date: createdTime,
                last_edit_date: editedTime,
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
                        page_id = ?,
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
                            complaint_id, page_id, complaint_date, last_edit_date, complainant_tel_no,
                            complainant_truck_no, complainant_con_no, target_service,
                            target_terminal, complaint_status, complaint_receiver,
                            complaint_handler, complaint_type, complaint_detail_type,
                            complaint_title, complaint_content, complaint_processing,
                            complaint_handling
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `

                    await conn.execute(insertQuery, Object.values(complaintData));                    
                    console.log(`Inserted record: ${complaintData.complaint_id}`);
                }

                // 페이지 내용과 이미지 저장
                await savePageContentAndImages(conn, pageId, complaintId);

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
                    page_id: '',  // page_id는 나중에 노션에서 조회하여 업데이트
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
                        complaint_id, page_id, complaint_date, last_edit_date, complainant_tel_no,
                        complainant_truck_no, complainant_con_no, target_service,
                        target_terminal, complaint_status, complaint_receiver,
                        complaint_handler, complaint_type, complaint_detail_type,
                        complaint_title, complaint_content, complaint_processing,
                        complaint_handling
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

async function main() {
    let conn;
    try {
        console.log('Starting data migration...');
        await migrateData();
        conn = await pool.getConnection();
        
        console.log('Starting latest data sync...');
        await syncLatestData(conn);
        
        console.log('Starting page content sync for remaining complaints...');
        await saveAllPageContents(conn);
        
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
