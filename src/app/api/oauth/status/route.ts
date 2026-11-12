
import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const { data, error } = await supabase
    .from('provider_connections')
    .select('provider,status,metadata')
    .eq('user_id', user.id);

  if (error) {
    return NextResponse.json(
      { error: 'Could not check provider connections.' },
      { status: 500 }
    );
  }

  const connections = {
    meta: false,
    hubspot: false,
  };

  const authTypes = {
    meta: null as string | null,
    hubspot: null as string | null,
  };

  for (const connection of data ?? []) {
    if (connection.status !== 'connected') continue;

    if (connection.provider === 'meta') {
      connections.meta = true;
      authTypes.meta = 'oauth';
    }

    if (connection.provider === 'hubspot') {
      connections.hubspot = true;
      authTypes.hubspot =
        connection.metadata?.auth_type || 'oauth';
    }
  }

  return NextResponse.json(
    { connections, authTypes },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
