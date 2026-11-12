
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { makeOAuthState } from '@/lib/oauth-state';
import { appUrl } from '@/lib/http';

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(appUrl('/login'));
  }

  if (
    !process.env.HUBSPOT_CLIENT_ID ||
    !process.env.HUBSPOT_OAUTH_REDIRECT_URI
  ) {
    return NextResponse.json(
      {
        error:
          'HubSpot OAuth is not configured. Set HUBSPOT_CLIENT_ID and HUBSPOT_OAUTH_REDIRECT_URI.',
      },
      { status: 503 }
    );
  }

  const url = new URL('https://app.hubspot.com/oauth/authorize');

  const scopes = [
    'oauth',
    'crm.objects.contacts.read',
    'crm.objects.contacts.write',
  ];

  url.searchParams.set(
    'client_id',
    process.env.HUBSPOT_CLIENT_ID
  );

  url.searchParams.set(
    'redirect_uri',
    process.env.HUBSPOT_OAUTH_REDIRECT_URI
  );

  url.searchParams.set('scope', scopes.join(' '));

  url.searchParams.set(
    'state',
    makeOAuthState(user.id, 'hubspot')
  );

  return NextResponse.redirect(url);
}
