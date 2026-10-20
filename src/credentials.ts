// Хранение учётных данных через safeStorage (шифрование ключом из Keychain).
import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { Credentials } from './types';

function credPath(): string {
  return path.join(app.getPath('userData'), 'credentials.bin');
}

export function hasCredentials(): boolean {
  return fs.existsSync(credPath());
}

export function saveCredentials(creds: Credentials): void {
  const json = JSON.stringify(creds);
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage: шифрование недоступно (нет доступа к Keychain)');
  }
  const enc = safeStorage.encryptString(json);
  fs.mkdirSync(path.dirname(credPath()), { recursive: true });
  fs.writeFileSync(credPath(), enc);
}

export function loadCredentials(): Credentials | null {
  try {
    const enc = fs.readFileSync(credPath());
    const json = safeStorage.decryptString(enc);
    return JSON.parse(json) as Credentials;
  } catch {
    return null;
  }
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(credPath());
  } catch {
    /* ignore */
  }
}
