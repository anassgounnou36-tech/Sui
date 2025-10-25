import { writeFileSync, existsSync, statSync, readdirSync, unlinkSync } from 'fs';
import { resolve, join } from 'path';

const LOG_DIR = resolve(process.cwd(), 'logs');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_LOG_FILES = 10;

class Logger {
  private logFilePath: string;

  constructor() {
    const today = new Date().toISOString().split('T')[0];
    this.logFilePath = join(LOG_DIR, `bot-${today}.log`);
    this.rotateLogsIfNeeded();
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  private formatMessage(level: string, message: string): string {
    return `[${this.timestamp()}] [${level}] ${message}`;
  }

  private writeToFile(message: string): void {
    try {
      writeFileSync(this.logFilePath, message + '\n', { flag: 'a' });
      this.checkLogRotation();
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  private checkLogRotation(): void {
    try {
      if (existsSync(this.logFilePath)) {
        const stats = statSync(this.logFilePath);
        if (stats.size > MAX_LOG_SIZE) {
          const rotatedPath = `${this.logFilePath}.${Date.now()}`;
          writeFileSync(rotatedPath, '');
          const today = new Date().toISOString().split('T')[0];
          this.logFilePath = join(LOG_DIR, `bot-${today}.log`);
          this.cleanOldLogs();
        }
      }
    } catch (error) {
      console.error('Failed to rotate logs:', error);
    }
  }

  private rotateLogsIfNeeded(): void {
    try {
      if (existsSync(this.logFilePath)) {
        const stats = statSync(this.logFilePath);
        if (stats.size > MAX_LOG_SIZE) {
          const rotatedPath = `${this.logFilePath}.${Date.now()}`;
          writeFileSync(rotatedPath, '');
          this.cleanOldLogs();
        }
      }
    } catch (error) {
      console.error('Failed to check log rotation:', error);
    }
  }

  private cleanOldLogs(): void {
    try {
      const files = readdirSync(LOG_DIR)
        .filter((f) => f.startsWith('bot-') && f.endsWith('.log'))
        .map((f) => ({
          name: f,
          path: join(LOG_DIR, f),
          time: statSync(join(LOG_DIR, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time);

      // Keep only the most recent MAX_LOG_FILES
      files.slice(MAX_LOG_FILES).forEach((file) => {
        try {
          unlinkSync(file.path);
        } catch (err) {
          console.error(`Failed to delete old log file ${file.name}:`, err);
        }
      });
    } catch (error) {
      console.error('Failed to clean old logs:', error);
    }
  }

  info(message: string): void {
    const formatted = this.formatMessage('INFO', message);
    console.log(formatted);
    this.writeToFile(formatted);
  }

  warn(message: string, error?: Error | unknown): void {
    let formatted = this.formatMessage('WARN', message);
    if (error) {
      if (error instanceof Error) {
        formatted += `\n${error.stack || error.message}`;
      } else {
        formatted += `\n${String(error)}`;
      }
    }
    console.warn(formatted);
    this.writeToFile(formatted);
  }

  error(message: string, error?: Error | unknown): void {
    let formatted = this.formatMessage('ERROR', message);
    if (error) {
      if (error instanceof Error) {
        formatted += `\n${error.stack || error.message}`;
      } else {
        formatted += `\n${String(error)}`;
      }
    }
    console.error(formatted);
    this.writeToFile(formatted);
  }

  debug(message: string): void {
    const formatted = this.formatMessage('DEBUG', message);
    console.log(formatted);
    this.writeToFile(formatted);
  }

  success(message: string): void {
    const formatted = this.formatMessage('SUCCESS', message);
    console.log(formatted);
    this.writeToFile(formatted);
  }

  /**
   * Log trade event as JSON line for structured logging
   */
  tradeEvent(event: {
    timestamp: string;
    direction: string;
    size: string;
    cetusQuote?: string;
    turbosQuote?: string;
    minOut: string;
    provider: string;
    repayAmount: string;
    realizedProfit?: string;
    txDigest?: string;
    status: 'success' | 'failed';
    error?: string;
  }): void {
    const jsonLine = JSON.stringify(event);
    const formatted = this.formatMessage('TRADE', jsonLine);
    console.log(formatted);
    this.writeToFile(formatted);
  }
}

export const logger = new Logger();
