/**
 * Kraken request signing (server-only).
 *
 * Only read-only API permissions are ever needed (balances, trade history, ledger).
 * Keys are stored encrypted server-side and never reach the browser.
 */

import { createHash, createHmac } from "node:crypto";

/**
 * Spot REST: API-Sign = base64( HMAC-SHA512( base64decode(secret), path + SHA256(nonce + postData) ) )
 */
export function signKrakenSpot(path: string, nonce: string, postData: string, secretB64: string): string {
  const sha256 = createHash("sha256").update(nonce + postData).digest();
  return createHmac("sha512", Buffer.from(secretB64, "base64"))
    .update(Buffer.concat([Buffer.from(path, "utf8"), sha256]))
    .digest("base64");
}

/**
 * Futures REST: Authent = base64( HMAC-SHA512( base64decode(secret), SHA256(postData + nonce + endpointPath) ) )
 * `postData` carries the raw (non URL-encoded) query string for GET requests;
 * `endpointPath` excludes the `/derivatives` prefix.
 */
export function signKrakenFutures(endpointPath: string, nonce: string, postData: string, secretB64: string): string {
  const path = endpointPath.replace(/^\/derivatives/, "");
  const sha256 = createHash("sha256").update(postData + nonce + path).digest();
  return createHmac("sha512", Buffer.from(secretB64, "base64")).update(sha256).digest("base64");
}

