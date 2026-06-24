import { NextResponse } from 'next/server';

// Server-side proxy to fetch Excel file from OneDrive
// This bypasses CORS since the request originates from Vercel's server, not the browser
const ONEDRIVE_SHARE_LINK = process.env.ONEDRIVE_SHARE_LINK ||
  'https://aksidcorpcom-my.sharepoint.com/:x:/g/personal/it_aksidcorp_com/IQDgZtT3QuO0RYrrLENNAbWaAacWd46Xo3p0mCC_-SrFOWg?e=c7bfHE';

function toDownloadUrl(shareLink: string): string {
  // Convert OneDrive/SharePoint sharing link to direct download URL
  // IMPORTANT: Keep existing params (e.g. ?e=xxx sharing token) — stripping them breaks auth
  if (shareLink.includes('sharepoint.com') || shareLink.includes('onedrive.live.com')) {
    if (shareLink.includes('download=1')) return shareLink;
    return shareLink.includes('?') ? shareLink + '&download=1' : shareLink + '?download=1';
  }
  return shareLink;
}

export async function GET() {
  try {
    const downloadUrl = toDownloadUrl(ONEDRIVE_SHARE_LINK);

    const response = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AKSID-Dashboard/1.0)',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch Excel file: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="Car-Fuel-Bill-Summary-2026.xlsx"',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('Excel proxy error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
