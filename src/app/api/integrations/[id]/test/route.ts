import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getProviderToken } from '@/lib/provider-tokens';

const GRAPH_VERSION = process.env.META_API_VERSION || 'v23.0';
const HUBSPOT_API = 'https://api.hubapi.com';

type FieldMapping = {
  source: string;
  target: string;
};

type MetaLead = {
  id: string;
  created_time?: string;
  field_data?: Array<{
    name: string;
    values: string[];
  }>;
};

type TestResult = {
  leadId: string;
  createdTime?: string;
  email?: string;
  status: 'created' | 'updated' | 'failed';
  hubspotContactId?: string;
  error?: string;
};

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data?.message ||
        data?.error?.message ||
        data?.error ||
        `Request failed with status ${response.status}`,
    );
  }

  return data;
}

// Normalize Meta form field names so common standard
// fields can be mapped consistently.
function normalizeFieldName(value: string) {
  return value.toLowerCase().replace(/[\s_-]/g, '');
}

// Convert Meta's field_data array into a normalized object.
function getLeadValues(lead: MetaLead) {
  const createdTime = lead.created_time || '';

  const values: Record<string, string> = {
    id: lead.id,
    lead_id: lead.id,
    leadid: lead.id,
    created_time: createdTime,
    createdtime: createdTime,
    event_time: createdTime,
    eventtime: createdTime,
  };

  for (const field of lead.field_data || []) {
    const key = normalizeFieldName(field.name);
    const value = field.values?.[0] || '';

    if (value) {
      values[key] = value;
    }
  }

  // Support Meta forms that return full_name instead
  // of separate first_name and last_name fields.
  const fullName = values.fullname || values.full_name || '';
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);

  if (fullName) {
    values.full_name = fullName;
    values.fullname = fullName;
  }

  values.firstname = values.firstname || nameParts[0] || '';
  values.lastname =
    values.lastname || nameParts.slice(1).join(' ');

  // Support common Meta standard-field aliases.
  const aliases: Record<string, string[]> = {
    email: ['email'],
    first_name: ['firstname', 'first_name'],
    last_name: ['lastname', 'last_name'],
    phone: ['phone', 'phonenumber', 'phone_number'],
    company_name: ['companyname', 'company_name', 'company'],
  };

  for (const [target, candidates] of Object.entries(aliases)) {
    for (const candidate of candidates) {
      const value = values[normalizeFieldName(candidate)];

      if (value) {
        values[target] = value;
        break;
      }
    }
  }

  return values;
}

async function getMetaPageToken(
  accessToken: string,
  pageId: string,
) {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`,
  );

  url.searchParams.set('fields', 'id,name,access_token');
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', accessToken);

  const data = await readJson(
    await fetch(url, { cache: 'no-store' }),
  );

  const page = (data.data || []).find(
    (item: { id: string }) => item.id === pageId,
  );

  if (!page?.access_token) {
    throw new Error(
      'Could not access the selected Meta Page. Reconnect Meta and verify Page permissions.',
    );
  }

  return page.access_token as string;
}

async function verifyMetaForm(
  pageId: string,
  formId: string,
  pageToken: string,
) {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/leadgen_forms`,
  );

  url.searchParams.set('fields', 'id,name');
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', pageToken);

  const data = await readJson(
    await fetch(url, { cache: 'no-store' }),
  );

  const form = (data.data || []).find(
    (item: { id: string }) => item.id === formId,
  );

  if (!form) {
    throw new Error(
      'The selected Lead Form does not belong to this Page or is not accessible.',
    );
  }
}

async function fetchMetaLeads(
  formId: string,
  pageToken: string,
  limit: number,
): Promise<MetaLead[]> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_VERSION}/${formId}/leads`,
  );

  url.searchParams.set(
    'fields',
    'id,created_time,field_data',
  );
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('access_token', pageToken);

  const data = await readJson(
    await fetch(url, { cache: 'no-store' }),
  );

  return (data.data || []).slice(0, limit);
}

async function findHubSpotContact(
  accessToken: string,
  email: string,
) {
  const response = await fetch(
    `${HUBSPOT_API}/crm/v3/objects/contacts/search`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'email',
                operator: 'EQ',
                value: email,
              },
            ],
          },
        ],
        properties: ['email'],
        limit: 1,
      }),
      cache: 'no-store',
    },
  );

  const data = await readJson(response);

  return data.results?.[0] || null;
}

async function upsertHubSpotContact(
  accessToken: string,
  properties: Record<string, string>,
) {
  const email = properties.email?.trim();

  if (!email) {
    throw new Error(
      'Email is required to create or update a HubSpot contact.',
    );
  }

  const existing = await findHubSpotContact(
    accessToken,
    email,
  );

  if (existing) {
    const response = await fetch(
      `${HUBSPOT_API}/crm/v3/objects/contacts/${encodeURIComponent(existing.id)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ properties }),
        cache: 'no-store',
      },
    );

    const updated = await readJson(response);

    return {
      status: 'updated' as const,
      contactId: updated.id,
    };
  }

  const response = await fetch(
    `${HUBSPOT_API}/crm/v3/objects/contacts`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties }),
      cache: 'no-store',
    },
  );

  const created = await readJson(response);

  return {
    status: 'created' as const,
    contactId: created.id,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // 1. Authenticate the current user.
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json(
      { error: 'Unauthorized. Please sign in again.' },
      { status: 401 },
    );
  }

  const { id } = await params;

  // 2. Validate the requested test size.
  const body = await request.json().catch(() => ({}));
  const limit = Number(body.limit ?? 3);

  if (!Number.isInteger(limit) || limit < 1 || limit > 3) {
    return NextResponse.json(
      { error: 'Test limit must be between 1 and 3.' },
      { status: 400 },
    );
  }

  try {
    // 3. Load the saved integration belonging to this user.
    const { data: integration, error: integrationError } =
      await supabaseAdmin
        .from('integrations')
        .select(
          'id,user_id,flow,source_config,field_mapping,status',
        )
        .eq('id', id)
        .eq('user_id', user.id)
        .single();

    if (integrationError || !integration) {
      return NextResponse.json(
        { error: 'Integration not found.' },
        { status: 404 },
      );
    }

    if (integration.flow !== 'meta_leads') {
      return NextResponse.json(
        {
          error:
            'This test endpoint only supports Meta Lead Ads to HubSpot.',
        },
        { status: 400 },
      );
    }

    const pageId = integration.source_config?.page;
    const formId = integration.source_config?.form;

    if (
      !pageId ||
      !formId ||
      !/^\d+$/.test(String(pageId)) ||
      !/^\d+$/.test(String(formId))
    ) {
      return NextResponse.json(
        { error: 'The saved Meta Page or Lead Form is invalid.' },
        { status: 400 },
      );
    }

    const mappings = (
      Array.isArray(integration.field_mapping)
        ? integration.field_mapping
        : []
    ) as FieldMapping[];

    if (
      !mappings.some(
        (item) =>
          item.source === 'email' &&
          item.target === 'email',
      )
    ) {
      return NextResponse.json(
        {
          error:
            'Map the Meta email field to HubSpot email before testing.',
        },
        { status: 400 },
      );
    }

    // 4. Retrieve server-stored OAuth credentials.
    const [{ accessToken: metaToken }, { accessToken: hubspotToken }] =
      await Promise.all([
        getProviderToken(user.id, 'meta'),
        getProviderToken(user.id, 'hubspot'),
      ]);

    // 5. Verify Page and Form ownership.
    const pageToken = await getMetaPageToken(
      metaToken,
      String(pageId),
    );

    await verifyMetaForm(
      String(pageId),
      String(formId),
      pageToken,
    );

    // 6. Fetch up to three real Meta leads.
    const leads = await fetchMetaLeads(
      String(formId),
      pageToken,
      limit,
    );

    if (!leads.length) {
      return NextResponse.json(
        {
          success: false,
          results: [],
          error:
            'No accessible leads were found in the selected Meta Lead Form.',
        },
        { status: 400 },
      );
    }

    // 7. Map and sync each lead independently.
    const results: TestResult[] = [];

    for (const lead of leads) {
      try {
        const sourceValues = getLeadValues(lead);
        const properties: Record<string, string> = {};

        for (const mapping of mappings) {
          if (!mapping?.source || !mapping?.target) continue;

          const sourceKey =
            normalizeFieldName(mapping.source);

          const targetKey = mapping.target.trim();

          if (
            !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(targetKey)
          ) {
            continue;
          }

          const value = sourceValues[sourceKey];

          if (value?.trim()) {
            properties[targetKey] = value.trim();
          }
        }

        const email = properties.email;

        if (!email) {
          throw new Error(
            'This Meta lead does not contain an email value.',
          );
        }

        // 8. Create or update the HubSpot contact.
        const syncResult = await upsertHubSpotContact(
          hubspotToken,
          properties,
        );

        results.push({
          leadId: lead.id,
          createdTime: lead.created_time,
          email,
          status: syncResult.status,
          hubspotContactId: syncResult.contactId,
        });
      } catch (error) {
        results.push({
          leadId: lead.id,
          createdTime: lead.created_time,
          status: 'failed',
          error:
            error instanceof Error
              ? error.message
              : 'Could not sync this lead.',
        });
      }
    }

    // 9. Report the overall test outcome.
    const success =
      results.length > 0 &&
      results.every((result) => result.status !== 'failed');

    return NextResponse.json(
      {
        success,
        integrationId: integration.id,
        tested: results.length,
        results,
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    console.error('Integration test failed:', error);

    return NextResponse.json(
      {
        success: false,
        results: [],
        error:
          error instanceof Error
            ? error.message
            : 'Integration test failed.',
      },
      { status: 400 },
    );
  }
}