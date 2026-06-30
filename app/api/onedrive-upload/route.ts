import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/onedrive-upload
 * Creates a Microsoft Graph upload session so the browser can upload
 * the original (uncompressed) file directly to OneDrive/SharePoint
 * without routing through Vercel (bypassing the 4.5 MB body limit).
 *
 * Required env vars:
 *   GRAPH_TENANT_ID     — Azure AD tenant ID
 *   GRAPH_CLIENT_ID     — App registration client ID
 *   GRAPH_CLIENT_SECRET — App registration client secret
 *   GRAPH_SITE_ID       — SharePoint site ID (or "me" for personal OneDrive)
 *
 * Body: { filename: string, folder: string, size: number }
 * Returns: { uploadUrl: string } — PUT target for the browser
 */
export async function POST(request: NextRequest) {
  const tenantId     = process.env.GRAPH_TENANT_ID;
  const clientId     = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  const siteId       = process.env.GRAPH_SITE_ID;

  // If not configured, return 503 so browser skips silently
  if (!tenantId || !clientId || !clientSecret || !siteId) {
    return NextResponse.json({ error: 'OneDrive not configured' }, { status: 503 });
  }

  let filename: string, folder: string;
  try {
    ({ filename, folder } = await request.json());
    if (!filename || !folder) throw new Error('Missing fields');
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // ── 1. Get access token ──────────────────────────────────────
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     clientId,
        client_secret: clientSecret,
        scope:         'https://graph.microsoft.com/.default',
      }),
    }
  );

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('[OneDrive] Token error:', err);
    return NextResponse.json({ error: 'Auth failed' }, { status: 502 });
  }

  const { access_token } = await tokenRes.json() as { access_token: string };

  // ── 2. Create upload session ─────────────────────────────────
  // Path: Fuel Bill Originals/{folder}/{filename}
  const safeName   = filename.replace(/[#%&*:<>?/\\|]/g, '_');
  const safeFolder = folder.replace(/[#%&*:<>?/\\|]/g, '_');
  const itemPath   = `Fuel Bill Originals/${safeFolder}/${safeName}`;

  // Use /me/drive for personal OneDrive, or /sites/{id}/drive for SharePoint
  const driveBase = siteId === 'me'
    ? 'https://graph.microsoft.com/v1.0/me/drive'
    : `https://graph.microsoft.com/v1.0/sites/${siteId}/drive`;

  const sessionRes = await fetch(
    `${driveBase}/root:/${encodeURIComponent(itemPath)}:/createUploadSession`,
    {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        item: { '@microsoft.graph.conflictBehavior': 'rename' },
      }),
    }
  );

  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    console.error('[OneDrive] Session error:', err);
    return NextResponse.json({ error: 'Upload session failed' }, { status: 502 });
  }

  const { uploadUrl } = await sessionRes.json() as { uploadUrl: string };
  return NextResponse.json({ uploadUrl });
}
