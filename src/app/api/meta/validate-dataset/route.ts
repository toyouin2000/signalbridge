
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { safeJson } from '@/lib/http';

export const runtime = 'nodejs';

const schema = z.object({
  datasetId: z.string().trim().min(1),
  accessToken: z.string().trim().min(1),
});

export async function POST(request: NextRequest) {
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

  const body = schema.safeParse(
    await request.json().catch(() => null)
  );

  if (!body.success) {
    return NextResponse.json(
      { error: 'Dataset ID and Auth Token are required.' },
      { status: 400 }
    );
  }

  const { datasetId, accessToken } = body.data;

  try {
    const version = process.env.META_API_VERSION || 'v23.0';

    const url = new URL(
      `https://graph.facebook.com/${version}/${encodeURIComponent(datasetId)}`
    );

    url.searchParams.set('fields', 'id,name');

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });

    const result = await safeJson(response);

    if (!response.ok) {
      throw new Error(
        result.error?.message ||
        'Meta rejected the Dataset ID or access token.'
      );
    }

    if (!result.id || String(result.id) !== datasetId) {
      throw new Error(
        'Meta returned a different or invalid Dataset ID.'
      );
    }

    return NextResponse.json({
      valid: true,
      dataset: {
        id: result.id,
        name: result.name || null,
      },
    });
  } catch (error) {
    console.error('[Meta Dataset Validation]', error);

    return NextResponse.json(
      {
        valid: false,
        error:
          error instanceof Error
            ? error.message
            : 'Meta credential validation failed.',
      },
      { status: 400 }
    );
  }
}
