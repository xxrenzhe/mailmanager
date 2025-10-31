/**
 * 统一错误处理系统
 * 提供一致的错误处理、日志记录和用户友好的错误响应
 */

class ErrorHandler {
    constructor() {
        this.errorTypes = {
            VALIDATION_ERROR: 'VALIDATION_ERROR',
            AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
            AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
            NOT_FOUND_ERROR: 'NOT_FOUND_ERROR',
            DATABASE_ERROR: 'DATABASE_ERROR',
            EMAIL_SERVICE_ERROR: 'EMAIL_SERVICE_ERROR',
            MONITOR_ERROR: 'MONITOR_ERROR',
            RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
            INTERNAL_ERROR: 'INTERNAL_ERROR',
            NETWORK_ERROR: 'NETWORK_ERROR'
        };

        this.errorMessages = {
            [this.errorTypes.VALIDATION_ERROR]: '请求数据格式不正确',
            [this.errorTypes.AUTHENTICATION_ERROR]: '身份验证失败',
            [this.errorTypes.AUTHORIZATION_ERROR]: '权限不足',
            [this.errorTypes.NOT_FOUND_ERROR]: '请求的资源不存在',
            [this.errorTypes.DATABASE_ERROR]: '数据库操作失败',
            [this.errorTypes.EMAIL_SERVICE_ERROR]: '邮件服务异常',
            [this.errorTypes.MONITOR_ERROR]: '监控服务异常',
            [this.errorTypes.RATE_LIMIT_ERROR]: '请求过于频繁，请稍后再试',
            [this.errorTypes.INTERNAL_ERROR]: '服务器内部错误',
            [this.errorTypes.NETWORK_ERROR]: '网络连接异常'
        };
    }

    /**
     * 安全执行函数，统一处理错误
     */
    static async safeExecute(fn, fallback = null, context = 'Unknown') {
        try {
            return await fn();
        } catch (error) {
            console.error(`[ErrorHandler] ${context} 执行失败:`, error.message);
            if (fallback) {
                try {
                    return await fallback();
                } catch (fallbackError) {
                    console.error(`[ErrorHandler] ${context} 回退也失败:`, fallbackError.message);
                    throw ErrorHandler.createError(fallbackError, 'INTERNAL_ERROR');
                }
            }
            throw ErrorHandler.createError(error, 'INTERNAL_ERROR');
        }
    }

    /**
     * 创建标准化的错误对象
     */
    static createError(originalError, type = null, context = null) {
        const handler = new ErrorHandler();

        // 自动判断错误类型
        if (!type) {
            type = handler.detectErrorType(originalError);
        }

        const error = new Error(originalError.message || '未知错误');
        error.type = type;
        error.originalError = originalError;
        error.context = context;
        error.timestamp = new Date().toISOString();
        error.userMessage = handler.errorMessages[type] || '发生了未知错误';

        // 根据错误类型设置状态码
        error.statusCode = handler.getStatusCodeForError(type);

        return error;
    }

    /**
     * 检测错误类型
     */
    detectErrorType(error) {
        const message = error.message.toLowerCase();

        if (message.includes('validation') || message.includes('invalid') || message.includes('格式不正确')) {
            return this.errorTypes.VALIDATION_ERROR;
        }

        if (message.includes('unauthorized') || message.includes('authentication') || message.includes('认证失败')) {
            return this.errorTypes.AUTHENTICATION_ERROR;
        }

        if (message.includes('forbidden') || message.includes('permission') || message.includes('权限')) {
            return this.errorTypes.AUTHORIZATION_ERROR;
        }

        if (message.includes('not found') || message.includes('不存在')) {
            return this.errorTypes.NOT_FOUND_ERROR;
        }

        if (message.includes('database') || message.includes('sql') || message.includes('数据库')) {
            return this.errorTypes.DATABASE_ERROR;
        }

        if (message.includes('email') || message.includes('邮件') || message.includes('outlook') || message.includes('microsoft')) {
            return this.errorTypes.EMAIL_SERVICE_ERROR;
        }

        if (message.includes('monitor') || message.includes('监控')) {
            return this.errorTypes.MONITOR_ERROR;
        }

        if (message.includes('rate limit') || message.includes('too many') || message.includes('频率')) {
            return this.errorTypes.RATE_LIMIT_ERROR;
        }

        if (message.includes('network') || message.includes('timeout') || message.includes('网络')) {
            return this.errorTypes.NETWORK_ERROR;
        }

        return this.errorTypes.INTERNAL_ERROR;
    }

    /**
     * 获取错误对应的HTTP状态码
     */
    getStatusCodeForError(errorType) {
        const statusCodes = {
            [this.errorTypes.VALIDATION_ERROR]: 400,
            [this.errorTypes.AUTHENTICATION_ERROR]: 401,
            [this.errorTypes.AUTHORIZATION_ERROR]: 403,
            [this.errorTypes.NOT_FOUND_ERROR]: 404,
            [this.errorTypes.RATE_LIMIT_ERROR]: 429,
            [this.errorTypes.DATABASE_ERROR]: 500,
            [this.errorTypes.EMAIL_SERVICE_ERROR]: 502,
            [this.errorTypes.MONITOR_ERROR]: 502,
            [this.errorTypes.NETWORK_ERROR]: 503,
            [this.errorTypes.INTERNAL_ERROR]: 500
        };

        return statusCodes[errorType] || 500;
    }

    /**
     * Express错误处理中间件
     */
    static expressMiddleware() {
        return (error, req, res, next) => {
            const handler = new ErrorHandler();

            // 如果已经是标准化错误，直接使用
            if (error.type && error.statusCode) {
                return handler.sendErrorResponse(res, error);
            }

            // 否则转换为标准化错误
            const standardError = handler.createError(error);
            handler.sendErrorResponse(res, standardError);
        };
    }

    /**
     * 异步错误包装器
     */
    static asyncWrapper(fn) {
        return (req, res, next) => {
            Promise.resolve(fn(req, res, next)).catch(next);
        };
    }

    /**
     * 发送错误响应
     */
    sendErrorResponse(res, error) {
        const response = {
            success: false,
            error: {
                type: error.type,
                message: error.userMessage,
                code: error.statusCode
            },
            timestamp: new Date().toISOString()
        };

        // 开发环境下包含调试信息
        if (process.env.NODE_ENV !== 'production') {
            response.error.details = error.message;
            response.error.stack = error.stack;
            if (error.context) {
                response.error.context = error.context;
            }
        }

        res.status(error.statusCode).json(response);
    }

    /**
     * 发送成功响应
     */
    static sendSuccessResponse(res, data = {}, message = '操作成功') {
        const response = {
            success: true,
            message,
            data,
            timestamp: new Date().toISOString()
        };

        res.status(200).json(response);
    }

    /**
     * 记录错误日志
     */
    static logError(error, context = 'Unknown') {
        const logEntry = {
            timestamp: new Date().toISOString(),
            context,
            type: error.type || 'UNKNOWN',
            message: error.message,
            stack: error.stack,
            originalError: error.originalError ? {
                name: error.originalError.name,
                message: error.originalError.message
            } : null
        };

        console.error(`[ERROR] ${context}:`, JSON.stringify(logEntry, null, 2));

        // TODO: 集成日志系统（如Winston）进行持久化日志记录
    }

    /**
     * 速率限制检查
     */
    static createRateLimiter(maxRequests = 100, windowMs = 15 * 60 * 1000) {
        const requests = new Map();

        return (req, res, next) => {
            const key = req.ip || req.connection.remoteAddress;
            const now = Date.now();
            const windowStart = now - windowMs;

            // 清理过期记录
            if (requests.has(key)) {
                const userRequests = requests.get(key).filter(time => time > windowStart);
                requests.set(key, userRequests);
            } else {
                requests.set(key, []);
            }

            // 检查是否超过限制
            if (requests.get(key).length >= maxRequests) {
                const error = new Error('请求过于频繁，请稍后再试');
                error.type = 'RATE_LIMIT_ERROR';
                error.statusCode = 429;
                return next(error);
            }

            // 记录当前请求
            requests.get(key).push(now);
            next();
        };
    }
}

module.exports = ErrorHandler;