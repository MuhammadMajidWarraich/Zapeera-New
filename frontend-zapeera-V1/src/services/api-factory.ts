import { ApiService } from './api';
import { config } from '@/lib/config';

let cloudApiInstance: ApiService | null = null;
let localApiInstance: ApiService | null = null;
let backofficeApiInstance: ApiService | null = null;

export function getCloudApi(): ApiService {
  if (!cloudApiInstance) {
    const baseUrl = config.cloud.baseUrl;
    if (!baseUrl) {
      throw new Error('Cloud API URL is not configured. Set VITE_CLOUD_API_URL.');
    }
    cloudApiInstance = new ApiService(baseUrl);
  }
  return cloudApiInstance;
}

export function getLocalApi(): ApiService {
  if (!localApiInstance) {
    const baseUrl = config.local.baseUrl;
    if (!baseUrl) {
      throw new Error('Local API URL is not configured. Desktop runtime required.');
    }
    localApiInstance = new ApiService(baseUrl);
  }
  return localApiInstance;
}

export function getBackofficeApi(): ApiService {
  if (!backofficeApiInstance) {
    backofficeApiInstance = new ApiService(config.backoffice.baseUrl);
  }
  return backofficeApiInstance;
}

export function resetApiClients(): void {
  cloudApiInstance = null;
  localApiInstance = null;
  backofficeApiInstance = null;
}
