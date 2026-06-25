import { NextRequest, NextResponse } from 'next/server';

const GITHUB_OWNER = 'realshawon';
const GITHUB_REPO  = 'aksid-car-fuel-ai';
const GITHUB_PATH  = 'public/fuel-data.json';

async function githubGet() {
  const token = process.env.GITHUB_TOKEN;
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;
  const res = await fetch(apiUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'User-Agent': 'aksid-fuel-bill/1.0' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  const file = await res.json();
  return { data: JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')), sha: file.sha };
}

async function githubPut(data: object, sha: string, message: string) {
  const token = process.env.GITHUB_TOKEN;
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json', 'User-Agent': 'aksid-fuel-bill/1.0' },
    body: JSON.stringify({ message, content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'), sha }),
  });
  if (!res.ok) throw new Error(`GitHub PUT failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { submittedAt, fuelBillUrl, logSheetUrl } = body;

    if (!submittedAt) return NextResponse.json({ error: 'submittedAt is required' }, { status: 400 });

    const { data: fuelData, sha } = await githubGet();
    const idx = (fuelData.rows as any[]).findIndex((r: any) => r.submittedAt === submittedAt);

    if (idx === -1) return NextResponse.json({ error: `No row found with submittedAt=${submittedAt}` }, { status: 404 });

    const row = fuelData.rows[idx] as any;
    if (fuelBillUrl) row.fuelBillUrl = fuelBillUrl;
    if (logSheetUrl) row.logSheetUrl = logSheetUrl;
    fuelData.updated = new Date().toISOString();

    await githubPut(fuelData, sha, `chore: add SharePoint URLs for ${row.driver} on ${row.date}`);
    return NextResponse.json({ success: true, driver: row.driver, date: row.date });

  } catch (err) {
    console.error('[update-urls] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
