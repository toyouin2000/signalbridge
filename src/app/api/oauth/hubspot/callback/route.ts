import { NextRequest, NextResponse } from 'next/server';
import { verifyOAuthState } from '@/lib/oauth-state';
import { safeJson, appUrl } from '@/lib/http';
import { saveProviderConnection } from '@/lib/integrations';
import { encryptSecret } from '@/lib/crypto';

export async function GET(request: NextRequest) {
  const code=request.nextUrl.searchParams.get('code'); const state=request.nextUrl.searchParams.get('state');
  const error=request.nextUrl.searchParams.get('error');
  if(error)return NextResponse.redirect(appUrl('/?oauthError='+encodeURIComponent(error)));
  const userId=state?verifyOAuthState(state,'hubspot'):null;
  if(!code||!userId)return NextResponse.redirect(appUrl('/?oauthError=Invalid%20HubSpot%20OAuth%20state'));
  try {
    const response=await fetch('https://api.hubapi.com/oauth/2026-09/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:process.env.HUBSPOT_CLIENT_ID!,client_secret:process.env.HUBSPOT_CLIENT_SECRET!,redirect_uri:process.env.HUBSPOT_OAUTH_REDIRECT_URI!,code}),cache:'no-store'});
    const token=await safeJson(response);
    if (!response.ok || !token.access_token || !token.refresh_token) {
      throw new Error(
        token.message || token.error_description || 'HubSpot token exchange failed.'
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
    refresh_token_encrypted: encryptSecret(token.refresh_token),
    expires_in: expiresIn,
    expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    hub_id: token.hub_id
  }
);
    return NextResponse.redirect(appUrl('/?connected=hubspot'));
  } catch(e){return NextResponse.redirect(appUrl('/?oauthError='+encodeURIComponent(e instanceof Error?e.message:'HubSpot OAuth failed')));}
}
