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
    // body('id').isInt({ min: 1 }).withMessage('Message ID is required and must be a positive integer'),
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
    // body('messages.*.id').isInt({ min: 1 }).withMessage('Each message must have a valid ID'),
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
        const { address, body, date, type, contactName, dateFormatted } = req.body;
        const userId = req.user.userId || req.user.id;

        // Check if message exists for this user
        const [existingMessages] = await pool.execute(
            'SELECT message_id FROM sms_messages WHERE date = ? AND user_id = ? AND address = ? AND body = ?',
            [date, userId, address, body]
        );

        let isNew = false;
        let savedMessage;

        if (existingMessages.length > 0) {
            res.status(200).json({
                success: true,
                message: 'SMS message updated successfully',
                data: {
                    message: existingMessages[0],
                    isNew: isNew
                }
            });
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

            res.status(isNew ? 201 : 200).json({
                success: true,
                message: isNew ? 'SMS message created successfully' : 'SMS message updated successfully',
                data: {
                    message: savedMessage,
                    isNew: isNew
                }
            });
        }
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

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Messages array is required and cannot be empty'
            });
        }

        // Create a Set to track existing messages using composite key
        const existingMessages = new Set();
        
        // Check which messages already exist by querying for each unique combination
        for (const msg of messages) {
            if (!msg.address || !msg.body || !msg.date) {
                continue; // Skip validation here, will be caught later
            }
            
            const [existing] = await pool.execute(
                'SELECT id FROM sms_messages WHERE user_id = ? AND address = ? AND body = ? AND date = ?',
                [userId, msg.address, msg.body, msg.date]
            );
            
            if (existing.length > 0) {
                const compositeKey = `${msg.address}|${msg.body}|${msg.date}`;
                existingMessages.add(compositeKey);
            }
        }

        let insertedCount = 0;
        let updatedCount = 0;
        const errors = [];

        // Process each message
        for (const msg of messages) {
            try {
                // Validate required fields
                if (!msg.address || !msg.body || !msg.date || !msg.type) {
                    errors.push({
                        message: `${msg.address || 'unknown'} - ${(msg.body || '').substring(0, 50)}...`,
                        error: 'Missing required fields (address, body, date, type)'
                    });
                    continue;
                }

                const compositeKey = `${msg.address}|${msg.body}|${msg.date}`;
                
                if (existingMessages.has(compositeKey)) {
                } else {
                    // Insert new message
                    await pool.execute(`
                        INSERT INTO sms_messages (user_id, address, body, date, type, contact_name, date_formatted, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    `, [
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
                console.error(`Error processing message ${msg.address} - ${msg.body?.substring(0, 50)}:`, msgError);
                
                let errorMessage = 'Processing failed';
                if (msgError.code === 'ER_DUP_ENTRY') {
                    errorMessage = 'Duplicate entry conflict';
                } else if (msgError.code === 'ER_DATA_TOO_LONG') {
                    errorMessage = 'Data too long for field';
                } else if (msgError.code === 'ER_BAD_NULL_ERROR') {
                    errorMessage = 'Required field cannot be null';
                }
                
                errors.push({
                    message: `${msg.address || 'unknown'} - ${(msg.body || '').substring(0, 50)}...`,
                    error: errorMessage,
                    details: msgError.message
                });
            }
        }

        const totalProcessed = insertedCount + updatedCount;
        const hasErrors = errors.length > 0;

        // Determine appropriate status code
        let statusCode = 200;
        if (hasErrors) {
            statusCode = totalProcessed > 0 ? 207 : 400; // 207 for partial success, 400 for complete failure
        }

        res.status(statusCode).json({
            success: !hasErrors || totalProcessed > 0,
            message: hasErrors
                ? `Processed ${totalProcessed}/${messages.length} messages with ${errors.length} errors`
                : 'All SMS messages processed successfully',
            data: {
                totalMessages: messages.length,
                insertedMessages: insertedCount,
                updatedMessages: updatedCount,
                processedMessages: totalProcessed,
                erroredMessages: errors.length,
                ...(hasErrors && { errors })
            }
        });

    } catch (error) {
        console.error('Save/Update bulk SMS error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process SMS messages',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;