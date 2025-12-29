/**
 * Webhook Delivery - Uploads screenshots to TRMNL webhook endpoints
 *
 * Stateless service with single options object parameter.
 * Throws on HTTP errors (caller handles gracefully).
 *
 * @module lib/scheduler/webhook-delivery
 */

import {
  SCHEDULER_LOG_PREFIX,
  SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH,
} from '../../const.js'
import type { ImageFormat } from '../../types/domain.js'

/** MIME type mapping */
const CONTENT_TYPES: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  bmp: 'image/bmp',
  png: 'image/png',
}

/** Options for webhook upload */
export interface WebhookDeliveryOptions {
  webhookUrl: string
  webhookHeaders?: Record<string, string>
  imageBuffer: Buffer
  format: ImageFormat
}

/** Result from webhook upload */
export interface WebhookDeliveryResult {
  success: boolean
  status: number
  statusText: string
}

/**
 * Uploads screenshot to webhook via HTTP POST.
 *
 * @param options - Upload options
 * @returns Result with success status and HTTP info
 * @throws Error on HTTP errors (4xx, 5xx) or network failures
 */
export async function uploadToWebhook(
  options: WebhookDeliveryOptions
): Promise<WebhookDeliveryResult> {
  const { webhookUrl, webhookHeaders = {}, imageBuffer, format } = options
  const contentType = CONTENT_TYPES[format] || 'image/png'

  console.log(`${SCHEDULER_LOG_PREFIX} Sending webhook to: ${webhookUrl}`)
  console.log(`${SCHEDULER_LOG_PREFIX} Content-Type: ${contentType}, Size: ${imageBuffer.length} bytes`)

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { ...webhookHeaders, 'Content-Type': contentType },
    body: new Uint8Array(imageBuffer),
  })

  const responseText = await response.text()
  console.log(`${SCHEDULER_LOG_PREFIX} Webhook response: ${response.status} ${response.statusText}`)

  if (responseText) {
    const truncated = responseText.substring(0, SCHEDULER_RESPONSE_BODY_TRUNCATE_LENGTH)
    console.log(`${SCHEDULER_LOG_PREFIX} Response body: ${truncated}`)
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  }

  console.log(`${SCHEDULER_LOG_PREFIX} Uploaded to webhook: ${webhookUrl}`)

  return { success: true, status: response.status, statusText: response.statusText }
}
