const express = require('express');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Validation middleware
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
    }
    next();
};

// Single SMS validation rules
const singleSMSValidation = [
    body('id').isInt({ min: 1 }).withMessage('Message ID is required and must be a positive integer'),
    body('address').trim().notEmpty().withMessage('Address is required'),
    body('body').notEmpty().withMessage('Message body is required'),
    body('date').isInt({ min: 0 }).withMessage('Date must be a valid timestamp'),
    body('type').isInt({ min: 0 }).withMessage('Type must be a valid integer'),
    body('contactName').optional(),
    body('dateFormatted').optional()
];

// Multiple SMS validation rules
const multipleSMSValidation = [
    body('messages').isArray({ min: 1 }).withMessage('Messages must be an array with at least one message'),
    body('messages.*.id').isInt({ min: 1 }).withMessage('Each message must have a valid ID'),
    body('messages.*.address').trim().notEmpty().withMessage('Each message must have an address'),
    body('messages.*.body').notEmpty().withMessage('Each message must have a body'),
    body('messages.*.date').isInt({ min: 0 }).withMessage('Each message must have a valid timestamp'),
    body('messages.*.type').isInt({ min: 0 }).withMessage('Each message must have a valid type'),
    body('messages.*.contactName').optional(),
    body('messages.*.dateFormatted').optional()
];

/**
 * POST /api/sms/message
 * Save or update a single SMS message
 */
router.post('/message', authenticateToken, singleSMSValidation, handleValidationErrors, async (req, res) => {
    try {
        const { id, address, body, date, type, contactName, dateFormatted } = req.body;
        const userId = req.user.userId || req.user.id;

        // Check if message exists for this user
        const [existingMessages] = await pool.execute(
            'SELECT message_id FROM sms_messages WHERE message_id = ? AND user_id = ?',
            [id, userId]
        );

        let isNew = false;
        let savedMessage;

        if (existingMessages.length > 0) {
            // Update existing message
            await pool.execute(`
                UPDATE sms_messages 
                SET address = ?, body = ?, date = ?, type = ?, contact_name = ?, date_formatted = ?, updated_at = CURRENT_TIMESTAMP
                WHERE message_id = ? AND user_id = ?
            `, [
                address,
                body,
                date,
                type,
                contactName || null,
                dateFormatted || null,
                id,
                userId
            ]);

            // Get updated message
            const [messages] = await pool.execute(
                'SELECT * FROM sms_messages WHERE message_id = ? AND user_id = ?',
                [id, userId]
            );
            savedMessage = messages[0];
            isNew = false;

        } else {
            // Insert new message with provided ID
            await pool.execute(`
                INSERT INTO sms_messages (message_id, user_id, address, body, date, type, contact_name, date_formatted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                id,
                userId,
                address,
                body,
                date,
                type,
                contactName || null,
                dateFormatted || null
            ]);

            // Get inserted message
            const [messages] = await pool.execute(
                'SELECT * FROM sms_messages WHERE message_id = ? AND user_id = ?',
                [id, userId]
            );
            savedMessage = messages[0];
            isNew = true;
        }

        res.status(isNew ? 201 : 200).json({
            success: true,
            message: isNew ? 'SMS message created successfully' : 'SMS message updated successfully',
            data: {
                message: savedMessage,
                isNew: isNew
            }
        });

    } catch (error) {
        console.error('Save/Update single SMS error:', error);
        
        // Handle duplicate key error (if ID already exists for another user)
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(409).json({
                success: false,
                message: 'Message ID already exists. Please use a unique ID.'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'Failed to save SMS message'
            });
        }
    }
});

/**
 * POST /api/sms/messages
 * Save or update multiple SMS messages in bulk
 */
router.post('/messages', authenticateToken, multipleSMSValidation, handleValidationErrors, async (req, res) => {
    try {
        const { messages } = req.body;
        const userId = req.user.userId || req.user.id;
        console.log(messages)
        console.log(userId)

        // Get all message IDs to check which ones exist
        const messageIds = messages.map(msg => msg.id);
        const [existingMessages] = await pool.execute(
            `SELECT message_id FROM sms_messages WHERE message_id IN (${messageIds.map(() => '?').join(',')}) AND user_id = ?`,
            [...messageIds, userId]
        );

        const existingIds = new Set(existingMessages.map(msg => msg.message_id));
        let insertedCount = 0;
        let updatedCount = 0;
        const errors = [];

        // Process each message
        for (const msg of messages) {
            try {
                console.log(msg.id)
                if (existingIds.has(String(msg.id))) {
                    // Update existing message
                    await pool.execute(`
                        UPDATE sms_messages 
                        SET address = ?, body = ?, date = ?, type = ?, contact_name = ?, date_formatted = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE message_id = ? AND user_id = ?
                    `, [
                        msg.address,
                        msg.body,
                        msg.date,
                        msg.type,
                        msg.contactName || null,
                        msg.dateFormatted || null,
                        msg.id,
                        userId
                    ]);
                    updatedCount++;
                } else {
                    // Insert new message
                    await pool.execute(`
                        INSERT INTO sms_messages (message_id, user_id, address, body, date, type, contact_name, date_formatted)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        msg.id,
                        userId,
                        msg.address,
                        msg.body,
                        msg.date,
                        msg.type,
                        msg.contactName || null,
                        msg.dateFormatted || null
                    ]);
                    insertedCount++;
                }
            } catch (msgError) {
                console.error(`Error processing message ID ${msg.id}:`, msgError);
                errors.push({
                    messageId: msg.id,
                    error: msgError.code === 'ER_DUP_ENTRY' ? 'Duplicate ID conflict' : 'Processing failed'
                });
            }
        }

        const totalProcessed = insertedCount + updatedCount;
        const hasErrors = errors.length > 0;

        res.status(hasErrors ? 207 : 200).json({ // 207 = Multi-Status for partial success
            success: !hasErrors || totalProcessed > 0,
            message: hasErrors 
                ? `Processed ${totalProcessed}/${messages.length} messages with ${errors.length} errors`
                : 'All SMS messages processed successfully',
            data: {
                totalMessages: messages.length,
                insertedMessages: insertedCount,
                updatedMessages: updatedCount,
                erroredMessages: errors.length,
                ...(hasErrors && { errors })
            }
        });

    } catch (error) {
        console.error('Save/Update bulk SMS error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process SMS messages'
        });
    }
});

module.exports = router;