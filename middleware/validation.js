const { body, validationResult } = require('express-validator');

// Validation rules
const registerValidation = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email'),
    body('password')
        .isLength({ min: 6 })
        .withMessage('Password must be at least 6 characters long'),
    body('full_name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Full name must be between 2 and 100 characters')
];

const loginValidation = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Please provide a valid email'),
    body('password')
        .notEmpty()
        .withMessage('Password is required')
];

const smsValidation = [
    body('sms_id')
        .notEmpty()
        .withMessage('SMS ID is required'),
    body('address')
        .notEmpty()
        .withMessage('Address is required'),
    body('body')
        .notEmpty()
        .withMessage('Message body is required'),
    body('date')
        .notEmpty()
        .withMessage('Date is required'),
    body('type')
        .optional()
        .isInt({ min: 0, max: 2 })
        .withMessage('Type must be 0, 1, or 2')
];

const bulkSmsValidation = [
    body('messages')
        .isArray({ min: 1 })
        .withMessage('Messages array is required and must not be empty'),
    body('messages.*.sms_id')
        .notEmpty()
        .withMessage('Each message must have an SMS ID'),
    body('messages.*.address')
        .notEmpty()
        .withMessage('Each message must have an address'),
    body('messages.*.body')
        .notEmpty()
        .withMessage('Each message must have a body'),
    body('messages.*.date')
        .notEmpty()
        .withMessage('Each message must have a date')
];

// Validation error handler
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array().map(error => ({
                field: error.path,
                message: error.msg
            }))
        });
    }

    next();
};

module.exports = {
    registerValidation,
    loginValidation,
    smsValidation,
    bulkSmsValidation,
    handleValidationErrors
};