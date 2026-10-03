/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { z } from 'zod';

const MAX_BYTES = 2 * 1024 * 1024;
const envelopeSchema = z.object({
  version: z.literal(1), savedAt: z.number().finite(),
  salt: z.string().length(24), iv: z.string().length(16),
  ciphertext: z.string().max(MAX_BYTES * 2),
});
const snapshotSchema = z.object({ original: z.string(), value: z.string() });
export type RawDraftSnapshot = z.infer<typeof snapshotSchema>;
export const rawDraftKey = (api: string) => `raw-draft:v1:${encodeURIComponent(api)}`;

const bytesToBase64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
const base64ToBytes = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const context = (api: string) => new TextEncoder().encode(`${location.origin}\n${api}`);
const deriveKey = async (password: string, salt: Uint8Array<ArrayBuffer>) => {
  const source = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 },
    source, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
};

export const encryptRawDraft = async (api: string, draft: RawDraftSnapshot, password: string) => {
  if (!crypto.subtle) throw new Error('Encrypted drafts require HTTPS or localhost.');
  if (password.length < 12) throw new Error('Use a draft password with at least 12 characters.');
  const data = new TextEncoder().encode(JSON.stringify(draft));
  if (data.byteLength > MAX_BYTES) throw new Error('This draft exceeds the 2 MiB storage limit.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: context(api) }, key, data);
  return JSON.stringify({
    version: 1, savedAt: Date.now(), salt: bytesToBase64(salt), iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  });
};

export const decryptRawDraft = async (api: string, encoded: string, password: string): Promise<RawDraftSnapshot> => {
  if (!crypto.subtle) throw new Error('Encrypted drafts require HTTPS or localhost.');
  try {
    const entry = envelopeSchema.parse(JSON.parse(encoded));
    const key = await deriveKey(password, base64ToBytes(entry.salt));
    const plaintext = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: base64ToBytes(entry.iv), additionalData: context(api),
    }, key, base64ToBytes(entry.ciphertext));
    const draft = snapshotSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
    const original: unknown = JSON.parse(draft.original);
    if (!original || typeof original !== 'object' || Array.isArray(original)) throw new Error('Invalid baseline');
    return draft;
  } catch {
    throw new Error('Could not unlock this draft. Check the password; the stored data may also be damaged.');
  }
};

export const getRawDraftDate = (encoded: string) => {
  try { return new Date(envelopeSchema.parse(JSON.parse(encoded)).savedAt).toLocaleString(); }
  catch { return 'Unknown (stored data could not be read)'; }
};

