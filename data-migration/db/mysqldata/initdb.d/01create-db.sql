-- MySQL Workbench Forward Engineering

SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0;
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0;
SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

-- -----------------------------------------------------
-- Schema callcenter
-- -----------------------------------------------------

-- -----------------------------------------------------
-- Schema callcenter
-- -----------------------------------------------------
CREATE SCHEMA IF NOT EXISTS `callcenter` DEFAULT CHARACTER SET utf8mb4 ;
USE `callcenter` ;

-- -----------------------------------------------------
-- Table `callcenter`.`t_complaint`
-- -----------------------------------------------------
CREATE TABLE IF NOT EXISTS `callcenter`.`t_complaint` (
  `complaint_id` VARCHAR(36) NOT NULL COMMENT 'ID-2',
  `complaint_date` DATETIME NOT NULL COMMENT '접수일시',
  `last_edit_date` DATETIME NOT NULL COMMENT '최종편집일시',
  `complainant_tel_no` VARCHAR(45) NOT NULL COMMENT '신고자연락처',
  `complainant_truck_no` VARCHAR(255) NOT NULL COMMENT '차량번호',
  `complainant_con_no` VARCHAR(255) NOT NULL COMMENT '컨테이너번호',
  `target_service` VARCHAR(45) NOT NULL COMMENT '서비스명',
  `target_terminal` VARCHAR(45) NOT NULL COMMENT '터미널',
  `complaint_status` VARCHAR(45) NOT NULL COMMENT '처리상태',
  `complaint_receiver` VARCHAR(45) NOT NULL COMMENT '접수자',
  `complaint_handler` VARCHAR(45) NOT NULL COMMENT '처리자',
  `complaint_type` VARCHAR(45) NOT NULL COMMENT '민원유형',
  `complaint_detail_type` VARCHAR(45) NOT NULL COMMENT '상세민원유형',
  `complaint_title` TEXT NOT NULL COMMENT '민원내용',
  `complaint_content` TEXT NOT NULL COMMENT '문의상세',
  `complaint_processing` TEXT NOT NULL COMMENT '처리내용',
  `complaint_handling` TEXT NOT NULL COMMENT '민원처리',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',
  PRIMARY KEY (`complaint_id`),
  INDEX `idx_complaint_date` (`complaint_date`),
  INDEX `idx_complaint_status` (`complaint_status`),
  INDEX `idx_complaint_type` (`complaint_type`)
)
ENGINE = InnoDB
COMMENT = '민원 정보 테이블';

SET SQL_MODE=@OLD_SQL_MODE;
SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS;
SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS;

