
import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  getProviderToken,
  getIntegrationToken,
} from '@/lib/provider-tokens';
import { safeJson } from '@/lib/http';

export const runtime = 'nodejs';

const MAX_TIMESTAMP_AGE = 5 * 60 * 1000;

const META_API_VERSION =
  process.env.META_API_VERSION || 'v27.0';

function normalizeHubSpotUri(uri: string) {
  const decodedCharacters: Record<string, string> = {
    '%3A': ':',
    '%2F': '/',
    '%3F': '?',
    '%40': '@',
    '%21': '!',
    '%24': '$',
    '%27': "'",
    '%28': '(',
    '%29': ')',
    '%2A': '*',
    '%2C': ',',
    '%3B': ';',
  };

  return uri
    .split('#')[0]
    .replace(
      /%(3A|2F|3F|40|21|24|27|28|29|2A|2C|3B)/gi,
      (match) => decodedCharacters[match.toUpperCase()] ?? match
    );
}

function verifyHubSpotSignature(
  request: NextRequest,
  rawBody: string
) {
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  const publicUrl = process.env.HUBSPOT_WEBHOOK_PUBLIC_URL;

  const signature = request.headers.get('x-hubspot-signature-v3');
  const timestamp = request.headers.get('x-hubspot-request-timestamp');

  if (!clientSecret || !publicUrl || !signature || !timestamp) {
    return false;
  }

  if (!/^\d+$/.test(timestamp)) return false;

  const timestampNumber = Number(timestamp);

  if (
    !Number.isSafeInteger(timestampNumber) ||
    Math.abs(Date.now() - timestampNumber) > MAX_TIMESTAMP_AGE
  ) {
    return false;
  }

  const requestUri = normalizeHubSpotUri(publicUrl);

  const signedPayload =
    request.method + requestUri + rawBody + timestamp;

  const expectedSignature = crypto
    .createHmac('sha256', clientSecret)
    .update(signedPayload, 'utf8')
    .digest('base64');

  const receivedBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function sha256(value: string) {
  return crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

function normalizeEmail(value?: string | null) {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();

  return normalized ? sha256(normalized) : null;
}

function normalizePhone(value?: string | null) {
  if (!value) return null;

  // Remove formatting characters. Do not guess a country code.
  const normalized = value.replace(/\D/g, '');

  return normalized ? sha256(normalized) : null;
}

type HubSpotEvent = {
  subscriptionType?: string;
  objectId?: number | string;
  portalId?: number | string;
  propertyName?: string;
  propertyValue?: string;
  occurredAt?: number;
  eventId?: number | string;
};

type FieldMapping = {
  source: string;
  target: string;
};

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // 1. Verify HubSpot webhook signature.
    if (!verifyHubSpotSignature(request, rawBody)) {
      console.warn('[HubSpot Webhook] Invalid signature');

      return NextResponse.json(
        { success: false, error: 'Invalid webhook signature' },
        { status: 401 }
      );
    }

    const notifications: unknown = JSON.parse(rawBody);

    if (!Array.isArray(notifications)) {
      return NextResponse.json(
        { success: false, error: 'Invalid webhook payload' },
        { status: 400 }
      );
    }

    // 2. Select lead status changes.
    const statusEvents = (notifications as HubSpotEvent[]).filter(
      (event) =>
        (
          event.subscriptionType === 'contact.propertyChange' ||
          event.subscriptionType === 'object.propertyChange'
        ) &&
        event.propertyName === 'hs_lead_status'
    );

    console.log(
      `[HubSpot Webhook] Received ${notifications.length} notification(s); ${statusEvents.length} lead status change(s)`
    );

    let successfulDeliveries = 0;
    let failedDeliveries = 0;

    // 3. Process every status change.
    for (const event of statusEvents) {
      try {
        if (!event.objectId || !event.portalId) {
          console.warn('[HubSpot Webhook] Missing contact or portal ID');
          failedDeliveries++;
          continue;
        }

        const portalId = String(event.portalId);
        const contactId = String(event.objectId);

        // 4. Find SignalBridge accounts connected to this HubSpot portal.
        const { data: connections, error: connectionError } =
          await supabaseAdmin
            .from('provider_connections')
            .select('user_id')
            .eq('provider', 'hubspot')
            .eq('status', 'connected')
            .eq('metadata->>hub_id', portalId);

        if (connectionError) throw connectionError;

        if (!connections?.length) {
          console.log(
            '[HubSpot Webhook] No connected SignalBridge account:',
            portalId
          );
          continue;
        }

        const userIds = [
          ...new Set(connections.map((connection) => connection.user_id)),
        ];

        // 5. Find active HubSpot → Meta CRM CAPI integrations.
        const { data: integrations, error: integrationError } =
          await supabaseAdmin
            .from('integrations')
            .select(
              'id,user_id,source_config,field_mapping,destination_config'
            )
            .in('user_id', userIds)
            .eq('flow', 'hubspot_capi')
            .eq('status', 'active');

        if (integrationError) throw integrationError;

        const contactIntegrations = (integrations ?? []).filter(
          (integration) =>
            (integration.source_config as Record<string, unknown>)?.module ===
            'contacts'
        );

        if (!contactIntegrations.length) {
          console.log(
            '[HubSpot Webhook] No active Contacts CRM → CAPI integration:',
            portalId
          );
          continue;
        }

        // 6. Process each matching integration.
        for (const integration of contactIntegrations) {
          try {
            const mappings: FieldMapping[] = Array.isArray(
              integration.field_mapping
            )
              ? integration.field_mapping as FieldMapping[]
              : [];

            const properties = [
              ...new Set([
                'meta_lead_id',
                'hs_lead_status',
                'email',
                'phone',
                'mobilephone',
                ...mappings.map((mapping) => mapping.source),
              ]),
            ];

            // 7. Get HubSpot access token.
            const { accessToken } = await getProviderToken(
              integration.user_id,
              'hubspot'
            );

            // 8. Fetch the latest HubSpot contact.
            const query = new URLSearchParams();

            for (const property of properties) {
              query.append('properties', property);
            }

            const contactResponse = await fetch(
              `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?${query.toString()}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
                cache: 'no-store',
              }
            );

            const contact = await safeJson(contactResponse);

            if (!contactResponse.ok) {
              throw new Error(
                contact.message || 'Could not retrieve HubSpot contact.'
              );
            }

            const contactProperties = contact.properties ?? {};

            // 9. Get the Meta Dataset ID and token.
            const destinationConfig =
              integration.destination_config as Record<string, unknown>;

            const datasetId = String(
              destinationConfig?.datasetId ?? ''
            ).trim();

            if (!datasetId) {
              throw new Error('Meta Dataset ID is missing.');
            }

            const metaAccessToken = await getIntegrationToken(
              integration.id,
              integration.user_id
            );

            if (!metaAccessToken) {
              throw new Error('Meta CAPI access token is missing.');
            }

            // 10. Determine the CRM stage and event timestamp.
            const leadStatus =
              event.propertyValue ||
              contactProperties.hs_lead_status;

            if (!leadStatus || typeof leadStatus !== 'string') {
              throw new Error('HubSpot lead status is missing.');
            }

            if (
              !event.occurredAt ||
              !Number.isFinite(event.occurredAt)
            ) {
              throw new Error('HubSpot event timestamp is missing.');
            }

            const eventTime = Math.floor(event.occurredAt / 1000);

            // 11. Build Meta user_data.
            const userData: Record<string, unknown> = {};

            const metaLeadId = String(
              contactProperties.meta_lead_id ?? ''
            ).trim();

            // Preserve the original Meta Lead ID as a string
            // to avoid JavaScript number precision loss.
            if (/^\d{15,17}$/.test(metaLeadId)) {
              userData.lead_id = metaLeadId;
            }

            const emailHash = normalizeEmail(
              contactProperties.email
            );

            if (emailHash) {
              userData.em = [emailHash];
            }

            const phoneHash = normalizePhone(
              contactProperties.phone ||
              contactProperties.mobilephone
            );

            if (phoneHash) {
              userData.ph = [phoneHash];
            }

            if (!Object.keys(userData).length) {
              throw new Error(
                'No usable Meta Lead ID, email or phone found.'
              );
            }

            // 12. Build the Meta CRM CAPI event.
            const payload: Record<string, unknown> = {
              data: [
                {
                  event_name: leadStatus,
                  event_time: eventTime,
                  action_source: 'system_generated',
                  user_data: userData,
                  custom_data: {
                    event_source: 'crm',
                    lead_event_source: 'HubSpot',
                  },
                },
              ],
            };

            // Optional: send to Meta Test Events instead of production.
            const testEventCode =
              process.env.META_TEST_EVENT_CODE?.trim();

            if (testEventCode) {
              payload.test_event_code = testEventCode;
            }

            console.log('[HubSpot Webhook] Sending event to Meta:', {
              integrationId: integration.id,
              datasetId,
              eventName: leadStatus,
              eventTime,
              leadIdPresent: Boolean(userData.lead_id),
              emailPresent: Boolean(userData.em),
              phonePresent: Boolean(userData.ph),
              testMode: Boolean(testEventCode),
            });

            // 13. Send event to Meta Conversions API.
            const metaUrl =
              `https://graph.facebook.com/${META_API_VERSION}/${encodeURIComponent(datasetId)}/events`;

            const metaResponse = await fetch(metaUrl, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${metaAccessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
              cache: 'no-store',
            });

            const metaResult = await safeJson(metaResponse);

            if (!metaResponse.ok || metaResult.error) {
              console.error('[Meta CAPI] Delivery failed:', {
                integrationId: integration.id,
                datasetId,
                status: metaResponse.status,
                error: metaResult.error?.message || metaResult.message,
              });

              throw new Error(
                metaResult.error?.message ||
                metaResult.message ||
                `Meta API request failed with status ${metaResponse.status}`
              );
            }

            successfulDeliveries++;

            // 14. Log Meta's response without exposing personal information.
            console.log('[Meta CAPI] Event accepted:', {
              integrationId: integration.id,
              datasetId,
              eventName: leadStatus,
              eventsReceived: metaResult.events_received,
              messages: metaResult.messages,
              fbtraceId: metaResult.fbtrace_id,
              testMode: Boolean(testEventCode),
            });
          } catch (integrationError) {
            failedDeliveries++;

            console.error('[Meta CAPI] Integration processing failed:', {
              integrationId: integration.id,
              error:
                integrationError instanceof Error
                  ? integrationError.message
                  : 'Unknown error',
            });
          }
        }
      } catch (eventError) {
        failedDeliveries++;

        console.error('[HubSpot Webhook] Event processing failed:', {
          eventId: event.eventId,
          error:
            eventError instanceof Error
              ? eventError.message
              : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: failedDeliveries === 0,
      received: notifications.length,
      statusChanges: statusEvents.length,
      successfulDeliveries,
      failedDeliveries,
    });
  } catch (error) {
    console.error('[HubSpot Webhook] Processing error:', error);

    return NextResponse.json(
      { success: false, error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
