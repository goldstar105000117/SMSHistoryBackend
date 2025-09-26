CREATE TABLE IF NOT EXISTS sms_messages (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    address VARCHAR(50) NOT NULL,
    body TEXT NOT NULL,
    date BIGINT NOT NULL,
    type INT NOT NULL,
    contact_name VARCHAR(255) NULL,
    message_id VARCHAR(255) NULL,
    date_formatted VARCHAR(50) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_sms_per_user (user_id, address(20), body(100), date, type),
    INDEX idx_user_date (user_id, date),
    INDEX idx_user_address (user_id, address),
    INDEX idx_user_type (user_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;