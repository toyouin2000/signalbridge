import { supabaseAdmin } from '@/lib/supabase/admin'; 
import { encryptSecret, decryptSecret } from '@/lib/crypto';

export async function saveProviderConnection(userId: string, provider: 'meta' | 'hubspot', accessToken: string, metadata: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('provider_connections').upsert({
    user_id: userId,
    provider,
    access_token_encrypted: encryptSecret(accessToken),
    metadata,
    status: 'connected',
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,provider' });
  if (error) throw error;
}


export async function getProviderConnection(
  userId: string,
  provider: 'meta' | 'hubspot'
) {
  const { data, error } = await supabaseAdmin
    .from('provider_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', provider)
    .eq('status', 'connected')
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    ...data,
    access_token: decryptSecret(data.access_token_encrypted),
  };
}



export async function refreshHubSpotConnection(userId: string) {
  const connection = await getProviderConnection(userId, 'hubspot');

  if (!connection) {
    throw new Error('HubSpot is not connected.');
  }

  const metadata = connection.metadata as Record<string, unknown>;

  const encryptedRefreshToken = metadata.refresh_token_encrypted;

  if (typeof encryptedRefreshToken !== 'string') {
    throw new Error('HubSpot refresh token is missing.');
  }

  const refreshToken = decryptSecret(encryptedRefreshToken);
  const clientId = process.env.HUBSPOT_CLIENT_ID;
const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  throw new Error('HubSpot OAuth credentials are not configured.');
}

  const response = await fetch(
    'https://api.hubapi.com/oauth/2026-03/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,  
        refresh_token: refreshToken,
      }),
      cache: 'no-store',
    }
  );

  const token = await response.json();

  if (!response.ok || !token.access_token || !token.expires_in) {
    throw new Error(
      token.error_description ||
      token.message ||
      'HubSpot token refresh failed.'
    );
  }

  const expiresIn = Number(token.expires_in);

  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Invalid HubSpot token expiration.');
  }

  await saveProviderConnection(
    userId,
    'hubspot',
    token.access_token,
    {
      ...metadata,
      refresh_token_encrypted: token.refresh_token
        ? encryptSecret(token.refresh_token)
        : encryptedRefreshToken,
      expires_in: expiresIn,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      hub_id: token.hub_id ?? metadata.hub_id,
    }
  );

  return token.access_token;
}
