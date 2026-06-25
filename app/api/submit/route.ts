import { NextRequest, NextResponse } from 'next/server';

const MAKE_WEBHOOK  = 'https://hook.eu1.make.com/3p84j4bc467u06fgnwp8p8n95w4rvfwf';
const GITHUB_OWNER  = 'realshawon';
const GITHUB_REPO   = 'aksid-car-fuel-ai';
const DATA_PATH     = 'public/fuel-data.json';
const ATTACH_FOLDER = 'attachments';
const RAW_BASE      = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${ATTACH_FOLDER}`;

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'aksid-fuel-bill/1.0',
  };
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).replace(',', '');
}

function safeSlug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 30);
}

function fileExt(mimeType: string, fileName: string): string {
  if (fileName) {
    const m = fileName.match(/\.(w+)$/);
    if (m) return m[1].toLowerCase();
  }
  return mimeType.includes('pdf') ? 'pdf'
    : mimeType.includes('png') ? 'png'
    : mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg'
    : 'bin';
}

async function uploadToGitHub(
  token: string, filename: string, base64Content: string, label: string
): Promise<string> {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ATTACH_FOLDER}/${filename}`;
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify({
      message: `attach: ${label} (${filename})`,
      content: base64Content,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub upload failed (${res.status}): ${err.slice(0, 200)}`);
  }
  return `${RAW_BASE}/${filename}`;
}

async function updateFuelData(
  token: string, row: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${DATA_PATH}`;
  const hdrs   = ghHeaders(token);

  const getRes = await fetch(apiUrl, { headers: hdrs, cache: 'no-store' });
  if (!getRes.ok) return { ok: false, error: `GitHub GET failed: ${getRes.status}` };

  const fileData = await getRes.json();
  const fuelData = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf8')) as {
    rows: unknown[]; updated: string; count: number;
  };

  fuelData.rows.push(row);
  fuelData.count   = fuelData.rows.length;
  fuelData.updated = new Date().toISOString();

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: hdrs,
    body: JSON.stringify({
      message: `Add fuel bill: ${row.driver} on ${row.date}`,
      content: Buffer.from(JSON.stringify(fuelData, null, 2)).toString('base64'),
      sha: fileData.sha,
    }),
  });
  if (!putRes.ok) return { ok: false, error: `GitHub PUT failed: ${putRes.status}` };
  return { ok: true };
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();
    const token   = process.env.GITHUB_TOKEN ?? '';

    const dateStr     = (payload.date as string) || new Date().toISOString().split('T')[0];
    const submittedAt = (payload.submittedAt as string) || new Date().toISOString();
    const tsSlug      = submittedAt.replace(/[:.]/g, '-').replace('Z', '');
    const driverSlug  = safeSlug(payload.driver ?? 'unknown');

    let fuelBillUrl = '';
    let logSheetUrl = '';

    if (token && payload.fuelBillBase64) {
      try {
        const ext  = fileExt(payload.fuelBillType ?? '', payload.fuelBillFileName ?? '');
        const name = `${tsSlug}_${driverSlug}_fuel.${ext}`;
        fuelBillUrl = await uploadToGitHub(token, name, payload.fuelBillBase64, `fuel bill – ${payload.driver}`);
      } catch (e) { console.error('[submit] fuelBill upload failed:', e); }
    }

    if (token && payload.logSheetBase64) {
      try {
        const ext  = fileExt(payload.logSheetType ?? '', payload.logSheetFileName ?? '');
        const name = `${tsSlug}_${driverSlug}_log.${ext}`;
        logSheetUrl = await uploadToGitHub(token, name, payload.logSheetBase64, `log sheet – ${payload.driver}`);
      } catch (e) { console.error('[submit] logSheet upload failed:', e); }
    }

    const row: Record<string, unknown> = {
      date:        formatDate(dateStr),
      _dateStr:    dateStr,
      _dateNum:    new Date(dateStr + 'T00:00:00Z').getTime(),
      submittedAt,
      driver:      payload.driver      ?? '',
      dept:        payload.dept        ?? '',
      vehicle:     payload.vehicle     ?? '',
      kmStart:     +(payload.kmStart   ?? 0),
      kmEnd:       +(payload.kmEnd     ?? 0),
      km:          +(payload.km        ?? 0),
      fuel:        +(payload.fuel      ?? 0),
      toll:        +(payload.toll      ?? 0),
      food:        +(payload.food      ?? 0),
      maintenance: +(payload.maintenance ?? 0),
      parking:     +(payload.parking   ?? 0),
      hotel:       +(payload.hotel     ?? 0),
      fine:        +(payload.fine      ?? 0),
      others:      +(payload.others    ?? 0),
      total:       +(payload.total     ?? 0),
      month:       payload.month       ?? '',
      billFrom:    payload.billPeriodFrom ?? '',
      billTo:      payload.billPeriodTo   ?? '',
      status:      'Pending Review',
      remarks:     payload.notes       ?? '',
      fuelBillUrl,
      logSheetUrl,
    };

    let dashboardUpdated = false;
    if (token) {
      try {
        const result = await updateFuelData(token, row);
        dashboardUpdated = result.ok;
        if (!result.ok) console.error('[submit] fuel-data update failed:', result.error);
      } catch (e) { console.error('[submit] fuel-data update threw:', e); }
    }

    fetch(MAKE_WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    }).catch(err => console.error('[submit] Make.com error:', err));

    return NextResponse.json({
      success: true,
      dashboardUpdated,
      fuelBillUrl,
      logSheetUrl,
      message: dashboardUpdated
        ? 'Submission received and dashboard updated.'
        : 'Submission received. Processing in progress.',
    });

  } catch (err) {
    console.error('[submit] Unhandled error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
