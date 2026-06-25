import { NextResponse } from 'next/server';

const GITHUB_OWNER = 'realshawon';
const GITHUB_REPO  = 'aksid-car-fuel-ai';
const GITHUB_PATH  = 'public/fuel-data.json';

export async function GET() {
  try {
    const token = process.env.GITHUB_TOKEN;
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_PATH}`;

    const res = await fetch(apiUrl, {
      headers: {
        Authorization: token ? `Bearer ${token}` : '',
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'aksid-fuel-bill/1.0',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `GitHub fetch failed: ${res.status}` },
        { status: 502 }
      );
    }

    const fileData = await res.json();
    const content = Buffer.from(fileData.content, 'base64').toString('utf8');
    const fuelData = JSON.parse(content);

    return NextResponse.json(fuelData, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[fuel-data] Error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
