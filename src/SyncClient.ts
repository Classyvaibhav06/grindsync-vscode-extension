import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import { SyncBatchPayload, HeartbeatPayload, PairResponse } from './types';

export class SyncClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public setBaseUrl(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public setToken(token: string | null) {
    this.token = token;
  }

  public hasToken(): boolean {
    return !!this.token;
  }

  /**
   * Pair extension with GrindSync using single-use 6-digit code
   */
  public async pair(code: string, deviceName: string): Promise<PairResponse> {
    const endpoint = `${this.baseUrl}/api/ide/pair`;
    return this.postRequest<PairResponse>(endpoint, {
      code: code.trim(),
      deviceName,
      ide: 'VS Code'
    });
  }

  /**
   * Send 30s lightweight heartbeat
   */
  public async sendHeartbeat(payload: HeartbeatPayload): Promise<{ success: boolean; error?: string }> {
    if (!this.token) return { success: false, error: 'Not authenticated' };
    const endpoint = `${this.baseUrl}/api/ide/heartbeat`;
    return this.postRequest(endpoint, payload, this.token);
  }

  /**
   * Send batch activity intervals
   */
  public async syncBatch(payload: SyncBatchPayload): Promise<{
    success: boolean;
    totalTodaySeconds?: number;
    pointsAwarded?: number;
    error?: string;
  }> {
    if (!this.token) return { success: false, error: 'Not authenticated' };
    const endpoint = `${this.baseUrl}/api/ide/session/sync`;
    return this.postRequest(endpoint, payload, this.token);
  }

  /**
   * Fetch current developer IDE stats
   */
  public async getStats(): Promise<{
    success: boolean;
    todaySeconds?: number;
    weeklySeconds?: number;
    monthlySeconds?: number;
    totalSeconds?: number;
    streak?: number;
    pointsEarned?: number;
    languages?: Record<string, number>;
    error?: string;
  }> {
    if (!this.token) return { success: false, error: 'Not authenticated' };
    const endpoint = `${this.baseUrl}/api/ide/stats`;
    return this.getRequest(endpoint, this.token);
  }

  private postRequest<T>(targetUrl: string, body: any, authToken?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new url.URL(targetUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;

      const postData = JSON.stringify(body);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        timeout: 10000
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed as T);
            } else {
              resolve({
                success: false,
                error: parsed.error || `HTTP ${res.statusCode}`
              } as unknown as T);
            }
          } catch (e) {
            resolve({
              success: false,
              error: `Invalid JSON response: ${data.substring(0, 100)}`
            } as unknown as T);
          }
        });
      });

      req.on('error', (err) => {
        resolve({
          success: false,
          error: err.message || 'Network request failed'
        } as unknown as T);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Request timed out'
        } as unknown as T);
      });

      req.write(postData);
      req.end();
    });
  }

  private getRequest<T>(targetUrl: string, authToken: string): Promise<T> {
    return new Promise((resolve) => {
      const parsedUrl = new url.URL(targetUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const lib = isHttps ? https : http;

      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        timeout: 10000
      };

      const req = lib.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed as T);
          } catch (e) {
            resolve({
              success: false,
              error: `Invalid JSON response`
            } as unknown as T);
          }
        });
      });

      req.on('error', (err) => {
        resolve({
          success: false,
          error: err.message || 'Network request failed'
        } as unknown as T);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Request timed out'
        } as unknown as T);
      });

      req.end();
    });
  }
}
