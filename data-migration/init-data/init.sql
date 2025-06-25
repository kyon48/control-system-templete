-- 테이블이 존재하면 삭제
DROP TABLE IF EXISTS t_complaint;
DROP TABLE IF EXISTS t_complaint_content;
DROP TABLE IF EXISTS t_complaint_images;
DROP TABLE IF EXISTS t_complaint_comment;

-- 테이블 생성
CREATE TABLE t_complaint (
  complaint_id VARCHAR(50) PRIMARY KEY,
  page_id VARCHAR(50),
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
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 페이지 내용을 저장할 테이블
CREATE TABLE t_complaint_content (
    complaint_id VARCHAR(50) PRIMARY KEY,
    page_content TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (complaint_id) REFERENCES t_complaint(complaint_id)
);

-- 이미지 정보를 저장할 테이블
CREATE TABLE t_complaint_images (
    image_id INT AUTO_INCREMENT PRIMARY KEY,
    complaint_id VARCHAR(50),
    image_path VARCHAR(255),
    image_name VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (complaint_id) REFERENCES t_complaint(complaint_id),
    UNIQUE KEY unique_complaint_image (complaint_id, image_name)
);

-- 댓글 테이블 생성
CREATE TABLE t_complaint_comment (
  comment_id VARCHAR(50) PRIMARY KEY,
  complaint_id VARCHAR(50) NOT NULL,
  author_name VARCHAR(100),
  comment_content TEXT,
  comment_created_at DATETIME,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (complaint_id) REFERENCES t_complaint(complaint_id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 인덱스 추가
CREATE INDEX idx_complaint_date ON t_complaint(complaint_date);
CREATE INDEX idx_last_edit_date ON t_complaint(last_edit_date);
CREATE INDEX idx_complaint_status ON t_complaint(complaint_status);
CREATE INDEX idx_complaint_type ON t_complaint(complaint_type); 