
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decryptSecret } from '@/lib/crypto';
import {
  getProviderConnection,
  refreshHubSpotConnection,
} from '@/lib/integrations';

export async function getProviderToken(
  userId: string,
  provider: 'meta' | 'hubspot'
) {
  if (provider === 'hubspot') {
    const connection = await getProviderConnection(userId, 'hubspot');

    if (!connection) {
      throw new Error('HubSpot account is not connected');
    }

    const metadata = connection.metadata as Record<string, unknown>;
    const expiresAt = metadata.expires_at;

    if (typeof expiresAt !== 'string') {
      throw new Error('HubSpot token expiry is missing. Reconnect HubSpot.');
    }

    const expiryTime = new Date(expiresAt).getTime();

    if (!Number.isFinite(expiryTime)) {
      throw new Error('Invalid HubSpot token expiry. Reconnect HubSpot.');
    }

    // Refresh 5 minutes before expiration.
    if (Date.now() >= expiryTime - 5 * 60 * 1000) {
      const accessToken = await refreshHubSpotConnection(userId);
      return { accessToken, metadata };
    }

    return {
      accessToken: connection.access_token,
      metadata,
    };
  }

  const { data, error } = await supabaseAdmin
    .from('provider_connections')
    .select('access_token_encrypted,status,metadata')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();

  if (error) throw error;

  if (!data || data.status !== 'connected') {
    throw new Error(`${provider} account is not connected`);
  }

  return {
    accessToken: decryptSecret(data.access_token_encrypted),
    metadata: data.metadata || {},
  };
}

export async function getIntegrationToken(
  integrationId: string,
  userId: string
) {
  const { data, error } = await supabaseAdmin
    .from('integrations')
    .select('destination_token_encrypted')
    .eq('id', integrationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  if (!data?.destination_token_encrypted) {
    throw new Error('Destination auth token is not configured');
  }

  return decryptSecret(data.destination_token_encrypted);
}
