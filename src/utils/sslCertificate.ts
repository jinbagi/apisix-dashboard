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
import { PrivateKey, PrivateKeyInfo } from '@peculiar/asn1-pkcs8';
import { AsnParser, AsnSerializer } from '@peculiar/asn1-schema';
import { SubjectPublicKeyInfo } from '@peculiar/asn1-x509';
import { PemConverter, SubjectAlternativeNameExtension, X509Certificate } from '@peculiar/x509';

import { stripSystemReadonlyFields } from '@/utils/apisixEditable';

export const SSL_PEM_LIMIT = 1024 * 1024;
export type CertificateSummary = {
  subject: string; issuer: string; names: string[]; notBefore: string; notAfter: string;
  fingerprint: string; algorithm: string; chainLength: number;
};
export type CertificateCheck = { certificate: CertificateSummary; warnings: string[] };

function certificateChain(pem: string) {
  if (pem.length > SSL_PEM_LIMIT) throw new Error('Certificate input exceeds the 1 MiB limit.');
  if (pem.trim().startsWith('$secret://')) throw new Error('Secret references cannot be inspected locally. Use the SSL form or RAW to manage references.');
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  if (!blocks.length || pem.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, '').trim())
    throw new Error('Use PEM CERTIFICATE blocks, with the leaf certificate first.');
  try { return blocks.map((block) => new X509Certificate(block)); }
  catch { throw new Error('The certificate PEM could not be parsed.'); }
}
async function summarize(chain: X509Certificate[]): Promise<CertificateSummary> {
  const cert = chain[0];
  const names = cert.getExtension(SubjectAlternativeNameExtension)?.names.items
    .filter((name) => name.type === 'dns' || name.type === 'ip').map((name) => name.value)
    ?? cert.subjectName.getField('CN');
  const digest = await crypto.subtle.digest('SHA-256', cert.rawData);
  return { subject: cert.subject, issuer: cert.issuer, names,
    notBefore: cert.notBefore.toISOString(), notAfter: cert.notAfter.toISOString(),
    fingerprint: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(':'),
    algorithm: cert.publicKey.algorithm.name, chainLength: chain.length };
}
export async function inspectCertificate(pem: string): Promise<CertificateSummary> {
  if (!globalThis.crypto?.subtle) throw new Error('Certificate inspection requires HTTPS or localhost with Web Crypto support.');
  return summarize(certificateChain(pem));
}

function matchesName(pattern: string, server: string) {
  const name = pattern.toLowerCase().replace(/\.$/, '');
  const target = server.toLowerCase().replace(/\.$/, '');
  if (name === target) return true;
  return name.startsWith('*.') && !target.includes('*') && target.split('.').length === name.split('.').length && target.endsWith(name.slice(1));
}
export async function checkCertificatePair(pem: string, keyPem: string, serverNames: string[], now = Date.now()): Promise<CertificateCheck> {
  if (!globalThis.crypto?.subtle) throw new Error('Key verification requires HTTPS or localhost with Web Crypto support.');
  const chain = certificateChain(pem);
  const cert = chain[0];
  if (keyPem.length > SSL_PEM_LIMIT) throw new Error('Private key input exceeds the 1 MiB limit.');
  if (keyPem.trim().startsWith('$secret://')) throw new Error('A Secret reference cannot prove a local key match. Use the SSL form or RAW to manage references.');
  if (/ENCRYPTED|Proc-Type:|DEK-Info:/i.test(keyPem)) throw new Error('Encrypted private keys are unsupported. Supply an unencrypted PEM key.');
  const keyBlock = keyPem.trim().match(/^-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----\s*([A-Za-z0-9+/=\s]+)-----END \1-----$/);
  if (!keyBlock) throw new Error('Use one unencrypted PKCS#8, RSA PKCS#1, or EC SEC1 PEM private key.');
  const algorithm = cert.publicKey.algorithm;
  const rsa = algorithm.name === 'RSASSA-PKCS1-v1_5';
  const ec = algorithm.name === 'ECDSA';
  if (!rsa && !ec) throw new Error('This certificate algorithm is unsupported by the helper. RSA and ECDSA keys are supported.');
  if ((keyBlock[1] === 'RSA PRIVATE KEY' && !rsa) || (keyBlock[1] === 'EC PRIVATE KEY' && !ec))
    throw new Error('The private key type does not match the certificate.');
  const importAlgorithm: RsaHashedImportParams | EcKeyImportParams = rsa
    ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
    : { name: 'ECDSA', namedCurve: (algorithm as EcKeyAlgorithm).namedCurve };
  const signAlgorithm: Algorithm | EcdsaParams = rsa ? { name: 'RSASSA-PKCS1-v1_5' } : { name: 'ECDSA', hash: 'SHA-256' };
  let verified = false;
  try {
    let encoded = PemConverter.decodeFirst(keyPem);
    if (keyBlock[1] !== 'PRIVATE KEY') {
      const publicInfo = AsnParser.parse(cert.publicKey.rawData, SubjectPublicKeyInfo);
      encoded = AsnSerializer.serialize(new PrivateKeyInfo({
        privateKeyAlgorithm: publicInfo.algorithm, privateKey: new PrivateKey(encoded),
      }));
    }
    const privateKey = await crypto.subtle.importKey('pkcs8', encoded, importAlgorithm, false, ['sign']);
    const publicKey = await cert.publicKey.export(importAlgorithm, ['verify']);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const signature = await crypto.subtle.sign(signAlgorithm, privateKey, challenge);
    verified = await crypto.subtle.verify(signAlgorithm, publicKey, signature, challenge);
  } catch { throw new Error('The private key could not be verified. Check the key, certificate, and supported PEM format.'); }
  if (!verified) throw new Error('The private key does not match this certificate.');
  const warnings: string[] = [];
  if (chain.some((item) => item.notBefore.getTime() > now)) warnings.push('The certificate or an included chain certificate is not valid yet.');
  if (chain.some((item) => item.notAfter.getTime() <= now)) warnings.push('The certificate or an included chain certificate has expired.');
  const certificate = await summarize(chain);
  const uncovered = serverNames.filter((name) => !certificate.names.some((pattern) => matchesName(pattern, name)));
  if (uncovered.length) warnings.push(`Configured server names not covered by the leaf certificate: ${uncovered.join(', ')}.`);
  return { certificate, warnings };
}

export function sslReplacementPayload(current: Record<string, unknown>, pair: number, cert: string, key: string) {
  const payload = structuredClone(stripSystemReadonlyFields(current));
  delete payload.validity_start; delete payload.validity_end;
  if (!Number.isInteger(pair) || pair < 0) throw new Error('Choose an existing certificate pair.');
  const certs = Array.isArray(payload.certs) ? [...payload.certs] : [];
  const keys = Array.isArray(payload.keys) ? [...payload.keys] : [];
  if (certs.length !== keys.length || pair > certs.length) throw new Error('The existing certificate/key pairs are incomplete. Repair them in the SSL form first.');
  if (pair === 0) { payload.cert = cert.trim(); payload.key = key.trim(); }
  else { certs[pair - 1] = cert.trim(); keys[pair - 1] = key.trim(); payload.certs = certs; payload.keys = keys; }
  const allKeys = [payload.key, ...(Array.isArray(payload.keys) ? payload.keys : [])];
  if (allKeys.filter((_, index) => index !== pair).some((value) => typeof value !== 'string' || (!value.trim().startsWith('$secret://') && !/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(value))))
    throw new Error('An unchanged private key is unavailable or masked. The helper cannot safely preserve it in a full SSL update. Use the SSL form with every required key.');
  return payload;
}