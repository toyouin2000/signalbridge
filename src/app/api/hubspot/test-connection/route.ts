
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { saveProviderConnection } from '@/lib/integrations';

export async function POST() {
  const supabase = await createSupabaseServerClient();

  // 1. Verify logged-in user
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Please sign in to connect HubSpot.' },
      { status: 401 }
    );
  }

  // 2. Get Private App token from environment
  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

  if (!token) {
    return NextResponse.json(
      {
        error:
          'HubSpot Private App token is missing. Set HUBSPOT_PRIVATE_APP_TOKEN in .env.local.',
      },
      { status: 503 }
    );
  }

  try {
    // 3. Validate token with HubSpot API
    const response = await fetch(
      'https://api.hubapi.com/crm/v3/objects/contacts?limit=1&properties=email,firstname,lastname',
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          connected: false,
          error:
            result.message ||
            'HubSpot rejected the token. Check token permissions.',
        },
        { status: response.status }
      );
    }

    // 4. Encrypt and save token in Supabase
    await saveProviderConnection(
      user.id,
      'hubspot',
      token,
      {
        auth_type: 'private_app',
      }
    );

    // 5. Return successful connection
    return NextResponse.json(
      {
        connected: true,
        message: 'HubSpot connected successfully.',
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );

  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        error:
          error instanceof Error
            ? error.message
            : 'HubSpot connection failed.',
      },
      { status: 500 }
    );
  }
}
