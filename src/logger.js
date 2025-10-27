"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const LOG_DIR = (0, path_1.resolve)(process.cwd(), 'logs');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES = 10;
class Logger {
    constructor() {
        const today = new Date().toISOString().split('T')[0];
        this.logFilePath = (0, path_1.join)(LOG_DIR, `bot-${today}.log`);
        this.rotateLogsIfNeeded();
    }
    timestamp() {
        return new Date().toISOString();
    }
    formatMessage(level, message) {
        return `[${this.timestamp()}] [${level}] ${message}`;
    }
    writeToFile(message) {
        try {
            (0, fs_1.writeFileSync)(this.logFilePath, message + '\n', { flag: 'a' });
            this.checkLogRotation();
        }
        catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }
    checkLogRotation() {
        try {
            if ((0, fs_1.existsSync)(this.logFilePath)) {
                const stats = (0, fs_1.statSync)(this.logFilePath);
                if (stats.size > MAX_LOG_SIZE) {
                    const rotatedPath = `${this.logFilePath}.${Date.now()}`;
                    (0, fs_1.writeFileSync)(rotatedPath, '');
                    const today = new Date().toISOString().split('T')[0];
                    this.logFilePath = (0, path_1.join)(LOG_DIR, `bot-${today}.log`);
                    this.cleanOldLogs();
                }
            }
        }
        catch (error) {
            console.error('Failed to rotate logs:', error);
        }
    }
    rotateLogsIfNeeded() {
        try {
            if ((0, fs_1.existsSync)(this.logFilePath)) {
                const stats = (0, fs_1.statSync)(this.logFilePath);
                if (stats.size > MAX_LOG_SIZE) {
                    const rotatedPath = `${this.logFilePath}.${Date.now()}`;
                    (0, fs_1.writeFileSync)(rotatedPath, '');
                    this.cleanOldLogs();
                }
            }
        }
        catch (error) {
            console.error('Failed to check log rotation:', error);
        }
    }
    cleanOldLogs() {
        try {
            const files = (0, fs_1.readdirSync)(LOG_DIR)
                .filter((f) => f.startsWith('bot-') && f.endsWith('.log'))
                .map((f) => ({
                name: f,
                path: (0, path_1.join)(LOG_DIR, f),
                time: (0, fs_1.statSync)((0, path_1.join)(LOG_DIR, f)).mtime.getTime(),
            }))
                .sort((a, b) => b.time - a.time);
            // Keep only the most recent MAX_LOG_FILES
            files.slice(MAX_LOG_FILES).forEach((file) => {
                try {
                    (0, fs_1.unlinkSync)(file.path);
                }
                catch (err) {
                    console.error(`Failed to delete old log file ${file.name}:`, err);
                }
            });
        }
        catch (error) {
            console.error('Failed to clean old logs:', error);
        }
    }
    info(message) {
        const formatted = this.formatMessage('INFO', message);
        console.log(formatted);
        this.writeToFile(formatted);
    }
    warn(message, error) {
        let formatted = this.formatMessage('WARN', message);
        if (error) {
            if (error instanceof Error) {
                formatted += `\n${error.stack || error.message}`;
            }
            else {
                formatted += `\n${String(error)}`;
            }
        }
        console.warn(formatted);
        this.writeToFile(formatted);
    }
    error(message, error) {
        let formatted = this.formatMessage('ERROR', message);
        if (error) {
            if (error instanceof Error) {
                formatted += `\n${error.stack || error.message}`;
            }
            else {
                formatted += `\n${String(error)}`;
            }
        }
        console.error(formatted);
        this.writeToFile(formatted);
    }
    debug(message) {
        const formatted = this.formatMessage('DEBUG', message);
        console.log(formatted);
        this.writeToFile(formatted);
    }
    success(message) {
        const formatted = this.formatMessage('SUCCESS', message);
        console.log(formatted);
        this.writeToFile(formatted);
    }
    /**
     * Log trade event as JSON line for structured logging
     */
    tradeEvent(event) {
        const jsonLine = JSON.stringify(event);
        const formatted = this.formatMessage('TRADE', jsonLine);
        console.log(formatted);
        this.writeToFile(formatted);
    }
}
exports.logger = new Logger();
