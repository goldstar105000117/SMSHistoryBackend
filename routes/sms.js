const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const {
    smsValidation,
    bulkSmsValidation,
    handleValidationErrors
} = require('../middleware/validation');

const router = express.Router();

// Get all SMS messages for user
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 100, address, search } = req.query;

        // Properly validate and convert parameters
        const pageNum = Math.max(1, parseInt(page) || 1);
        const limitNum = Math.max(1, Math.min(1000, parseInt(limit) || 100)); // Cap at 1000
        const offset = (pageNum - 1) * limitNum;

        const userId = req.user.id;

        let query = `
      SELECT sms_id, address, body, date, type, created_at, updated_at
      FROM sms_messages 
      WHERE user_id = ?
    `;
        let queryParams = [userId];

        // Add address filter if provided
        if (address) {
            query += ' AND address = ?';
            queryParams.push(address);
        }

        // Add search filter if provided
        if (search) {
            query += ' AND (body LIKE ? OR address LIKE ?)';
            queryParams.push(`%${search}%`, `%${search}%`);
        }

        // Add ordering and pagination with properly validated numbers
        query += ' ORDER BY date DESC LIMIT ? OFFSET ?';
        queryParams.push(limitNum, offset);

        const [messages] = await pool.execute(query, queryParams);

        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM sms_messages WHERE user_id = ?';
        let countParams = [userId];

        if (address) {
            countQuery += ' AND address = ?';
            countParams.push(address);
        }

        if (search) {
            countQuery += ' AND (body LIKE ? OR address LIKE ?)';
            countParams.push(`%${search}%`, `%${search}%`);
        }

        const [countResult] = await pool.execute(countQuery, countParams);
        const total = countResult[0].total;

        res.json({
            success: true,
            data: {
                messages: messages.map(msg => ({
                    _id: msg.sms_id,
                    address: msg.address,
                    body: msg.body,
                    date: msg.date,
                    type: msg.type
                })),
                pagination: {
                    current_page: pageNum,
                    per_page: limitNum,
                    total: total,
                    total_pages: Math.ceil(total / limitNum)
                }
            }
        });

    } catch (error) {
        console.error('Get SMS error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Save single SMS message
router.post('/', authenticateToken, smsValidation, handleValidationErrors, async (req, res) => {
    try {
        const { sms_id, address, body, date, type = 1 } = req.body;
        const userId = req.user.id;

        // Use INSERT IGNORE to avoid duplicates
        const [result] = await pool.execute(`
      INSERT IGNORE INTO sms_messages (user_id, sms_id, address, body, date, type)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [userId, sms_id, address, body, date, type]);

        if (result.affectedRows === 0) {
            return res.json({
                success: true,
                message: 'SMS already exists',
                data: { sms_id, duplicate: true }
            });
        }

        res.status(201).json({
            success: true,
            message: 'SMS saved successfully',
            data: { sms_id, duplicate: false }
        });

    } catch (error) {
        console.error('Save SMS error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Bulk save SMS messages
router.post('/bulk', authenticateToken, bulkSmsValidation, handleValidationErrors, async (req, res) => {
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        const { messages } = req.body;
        console.log(messages)
        const userId = req.user.id;

        let savedCount = 0;
        let duplicateCount = 0;
        const errors = [];

        for (const message of messages) {
            try {
                const { sms_id, address, body, date, type = 1 } = message;

                const [result] = await connection.execute(`
          INSERT IGNORE INTO sms_messages (user_id, sms_id, address, body, date, type)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [userId, sms_id, address, body, date, type]);

                if (result.affectedRows > 0) {
                    savedCount++;
                } else {
                    duplicateCount++;
                }

            } catch (error) {
                errors.push({
                    sms_id: message.sms_id,
                    error: error.message
                });
            }
        }

        await connection.commit();

        res.json({
            success: true,
            message: 'Bulk SMS save completed',
            data: {
                total_processed: messages.length,
                saved_count: savedCount,
                duplicate_count: duplicateCount,
                error_count: errors.length,
                errors: errors.slice(0, 10) // Limit error details
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Bulk save SMS error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error during bulk save'
        });
    } finally {
        connection.release();
    }
});

// Get SMS statistics
router.get('/stats', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get total count
        const [totalResult] = await pool.execute(
            'SELECT COUNT(*) as total FROM sms_messages WHERE user_id = ?',
            [userId]
        );

        // Get count by type
        const [typeResult] = await pool.execute(`
      SELECT type, COUNT(*) as count 
      FROM sms_messages 
      WHERE user_id = ? 
      GROUP BY type
    `, [userId]);

        // Get top contacts
        const [contactsResult] = await pool.execute(`
      SELECT address, COUNT(*) as message_count 
      FROM sms_messages 
      WHERE user_id = ? 
      GROUP BY address 
      ORDER BY message_count DESC 
      LIMIT 10
    `, [userId]);

        // Get recent activity (last 30 days)
        const [recentResult] = await pool.execute(`
      SELECT DATE(FROM_UNIXTIME(date/1000)) as date, COUNT(*) as count
      FROM sms_messages 
      WHERE user_id = ? AND date > ?
      GROUP BY DATE(FROM_UNIXTIME(date/1000))
      ORDER BY date DESC
      LIMIT 30
    `, [userId, Date.now() - (30 * 24 * 60 * 60 * 1000)]);

        res.json({
            success: true,
            data: {
                total_messages: totalResult[0].total,
                by_type: typeResult.reduce((acc, item) => {
                    acc[item.type] = item.count;
                    return acc;
                }, {}),
                top_contacts: contactsResult,
                recent_activity: recentResult
            }
        });

    } catch (error) {
        console.error('Get SMS stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Delete SMS message
router.delete('/:smsId', authenticateToken, async (req, res) => {
    try {
        const { smsId } = req.params;
        const userId = req.user.id;

        const [result] = await pool.execute(
            'DELETE FROM sms_messages WHERE user_id = ? AND sms_id = ?',
            [userId, smsId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: 'SMS message not found'
            });
        }

        res.json({
            success: true,
            message: 'SMS message deleted successfully'
        });

    } catch (error) {
        console.error('Delete SMS error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

module.exports = router;