const mysql = require('mysql2/promise');
require('dotenv').config();

const createDatabaseAndTables = async () => {
  let connection;

  try {
    // First, connect without specifying a database to check if it exists
    console.log('🔗 Connecting to MySQL server...');
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

    console.log('✅ Connected to MySQL server');

    // Check if database exists and create if it doesn't
    console.log(`🔍 Checking if database '${process.env.DB_NAME}' exists...`);
    const [databases] = await connection.execute(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [process.env.DB_NAME]
    );

    if (databases.length === 0) {
      console.log(`📦 Database '${process.env.DB_NAME}' does not exist. Creating...`);
      await connection.execute(`CREATE DATABASE ${process.env.DB_NAME}`);
      console.log(`✅ Database '${process.env.DB_NAME}' created successfully`);
    } else {
      console.log(`✅ Database '${process.env.DB_NAME}' already exists`);
    }

    // Now connect to the specific database
    await connection.end();
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    console.log(`✅ Connected to database '${process.env.DB_NAME}'`);

    // Create users table
    console.log('📋 Creating users table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        phone_number VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email)
      )
    `);
    console.log('✅ Users table created successfully');

    // Create sms_messages table
    console.log('📋 Creating sms_messages table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS sms_messages (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        sms_id VARCHAR(255) NOT NULL,
        address VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        date VARCHAR(50) NOT NULL,
        type INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_user_sms (user_id, sms_id),
        INDEX idx_user_id (user_id),
        INDEX idx_sms_id (sms_id),
        INDEX idx_address (address),
        INDEX idx_date (date)
      )
    `);
    console.log('✅ SMS messages table created successfully');

    // Create user_sessions table for better session management
    console.log('📋 Creating user_sessions table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_sessions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        token_hash VARCHAR(255) NOT NULL,
        device_info TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NULL DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_token_hash (token_hash),
        INDEX idx_expires_at (expires_at)
      )
    `);
    console.log('✅ User sessions table created successfully');

    console.log('🎉 All tables created successfully!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    
    // Provide more helpful error messages
    if (error.code === 'ECONNREFUSED') {
      console.error('💡 Make sure MySQL server is running and accessible');
      console.error(`💡 Check if MySQL is running on ${process.env.DB_HOST}:${process.env.DB_PORT}`);
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('💡 Check your database credentials in the .env file');
      console.error(`💡 User: ${process.env.DB_USER}`);
      console.error(`💡 Host: ${process.env.DB_HOST}`);
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error(`💡 Database '${process.env.DB_NAME}' access error`);
    } else if (error.code === 'ER_DBACCESS_DENIED_ERROR') {
      console.error(`💡 Access denied for database '${process.env.DB_NAME}'`);
      console.error(`💡 Make sure user '${process.env.DB_USER}' has proper permissions`);
    }
    
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
};

// Run migration
console.log('🚀 Starting database and table creation...');
createDatabaseAndTables();