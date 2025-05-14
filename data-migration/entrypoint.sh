#!/bin/sh

echo "Waiting for database to be ready..."
MAX_RETRIES=30
RETRY_INTERVAL=5

# Function to check if database is ready
check_db() {
    node -e "
        const mariadb = require('mariadb');
        const pool = mariadb.createPool({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            connectTimeout: 10000
        });
        
        const checkTable = async () => {
            let conn;
            try {
                conn = await pool.getConnection();
                console.log('Database connection established');
                
                // 테이블 존재 여부 확인
                const [tables] = await conn.query('SHOW TABLES LIKE \"t_complaint\"');
                if (tables.length === 0) {
                    console.log('t_complaint 테이블이 없습니다. 테이블을 생성합니다...');
                    await conn.query(\`
                        CREATE TABLE IF NOT EXISTS t_complaint (
                            complaint_id VARCHAR(50) PRIMARY KEY,
                            complaint_date DATETIME,
                            last_edit_date DATETIME,
                            complainant_tel_no VARCHAR(20),
                            complainant_truck_no VARCHAR(20),
                            complainant_con_no VARCHAR(20),
                            target_service VARCHAR(100),
                            target_terminal VARCHAR(100),
                            complaint_status VARCHAR(50),
                            complaint_receiver VARCHAR(50),
                            complaint_handler VARCHAR(50),
                            complaint_type VARCHAR(100),
                            complaint_detail_type VARCHAR(100),
                            complaint_title VARCHAR(200),
                            complaint_content TEXT,
                            complaint_processing TEXT,
                            complaint_handling TEXT,
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                    \`);
                    console.log('t_complaint 테이블이 생성되었습니다.');
                } else {
                    console.log('t_complaint 테이블이 이미 존재합니다.');
                }
                
                conn.release();
                process.exit(0);
            } catch (err) {
                console.error('Database check failed:', err);
                if (conn) conn.release();
                process.exit(1);
            } finally {
                if (pool) pool.end();
            }
        };
        
        checkTable();
    "
}

# Wait for database
RETRIES=0
until check_db || [ $RETRIES -eq $MAX_RETRIES ]; do
    echo "Waiting for database... (Attempt $((RETRIES+1))/$MAX_RETRIES)"
    RETRIES=$((RETRIES+1))
    sleep $RETRY_INTERVAL
done

if [ $RETRIES -eq $MAX_RETRIES ]; then
    echo "Could not connect to database after $MAX_RETRIES attempts. Exiting."
    exit 1
fi

echo "Starting data migration..."
node dist/index.js

# Mark migration as complete
touch /app/migration-complete 