
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { saveProviderConnection } from '@/lib/integrations';

export async function POST() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

  if (!token) {
    return NextResponse.json(
      { error: 'HubSpot Private App token missing' },
      { status: 503 }
    );
  }

  try {
    // Validate the Private App token
    const response = await fetch(
      'https://api.hubapi.com/crm/v3/objects/contacts?limit=1',
      {
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
        { error: result.message || 'Invalid HubSpot token' },
        { status: response.status }
      );
    }

    // Encrypt and save token in Supabase
    await saveProviderConnection(
      user.id,
      'hubspot',
      token,
      { auth_type: 'private_app' }
    );

    return NextResponse.json({
      connected: true,
      message: 'HubSpot connected successfully',
    });

  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : 'Connection failed',
      },
      { status: 500 }
    );
  }
}
