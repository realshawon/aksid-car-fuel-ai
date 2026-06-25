import { NextRequest, NextResponse } from 'next/server';

const MAKE_WEBHOOK = 'https://hook.eu1.make.com/3p84j4bc467u06fgnwp8p8n95w4rvfwf';
const GITHUB_OWNER = 'realshawon';
const GITHUB_REPO  = 'aksid-car-fuel-ai';
const GITHUB_PATH  = 'public/fuel-data.json';

function formatDate(isoDate: string): string {
  // "2026-01-06" -> "06 Jan 2026"
  const d = new Date(isoDate + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  }).replace(',', '');
}

async function updateFuelData(row: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { ok: false, error: 'GITHUB_TOKEN env var not set' };

  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'aksid-fuel-bill/1.0',
  };

  // 1. GET current file + SHA
  const getRes = await fetch(apiUrl, { headers, cache: 'no-store' });
  if (!getRes.ok) {
    return { ok: false, error: `GitHub GET failed: ${getRes.status} ${await getRes.text()}` };
  }
  const fileData = await getRes.json();
  const currentJson = Buffer.from(fileData.content, 'base64').toString('utf8');
  const fuelData = JSON.parse(currentJson) as { rows: unknown[]; updated: string; count: number };

  // 2. Append row
  fuelData.rows.push(row);
  fuelData.count = fuelData.rows.length;
  fuelData.updated = new Date().toISOString();

  const newContent = Buffer.from(JSON.stringify(fuelData, null, 2)).toString('base64');

  // 3. PUT updated file
  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Add fuel bill: ${row.driver} on ${row.date}`,
      content: newContent,
      sha: fileData.sha,
    }),
  });

  if (!putRes.ok) {
    return { ok: false, error: `GitHub PUT failed: ${putRes.status} ${await putRes.text()}` };
  }
  return { ok: true };
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    const dateStr = (payload.date as string) || new Date().toISOString().split('T')[0];
    const row: Record<string, unknown> = {
      date:         formatDate(dateStr),
      _dateStr:     dateStr,
      _dateNum:     new Date(dateStr + 'T00:00:00Z').getTime(),
      driver:       payload.driver       ?? '',
      dept:         payload.dept         ?? '',
      vehicle:      payload.vehicle      ?? '',
      kmStart:      +(payload.kmStart    ?? 0),
      kmEnd:        +(payload.kmEnd      ?? 0),
      km:           +(payload.km         ?? 0),
      fuel:         +(payload.fuel       ?? 0),
      toll:         +(payload.toll       ?? 0),
      food:         +(payload.food       ?? 0),
      maintenance:  +(payload.maintenance ?? 0),
      parking:      +(payload.parking    ?? 0),
      hotel:        +(payload.hotel      ?? 0),
      fine:         +(payload.fine       ?? 0),
      others:       +(payload.others     ?? 0),
      total:        +(payload.total      ?? 0),
      month:        payload.month        ?? '',
      billFrom:     payload.billPeriodFrom ?? '',
      billTo:       payload.billPeriodTo   ?? '',
      status:       'Pending Review',
      remarks:      payload.notes        ?? '',
      fuelBillUrl:  '',
      logSheetUrl:  '',
    };

    let dashboardUpdated = false;
    try {
      const ghResult = await updateFuelData(row);
      dashboardUpdated = ghResult.ok;
      if (!ghResult.ok) console.error('[submit] GitHub update failed:', ghResult.error);
    } catch (ghErr) {
      console.error('[submit] GitHub update threw:', ghErr);
    }

    fetch(MAKE_WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    }).catch(err => console.error('[submit] Make.com webhook error:', err));

    return NextResponse.json({
      success:          true,
      dashboardUpdated,
      message: dashboardUpdated
        ? 'Submission received and dashboard updated.'
        : 'Submission received. Processing in progress.',
    });

  } catch (err) {
    console.error('[submit] Unhandled error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
