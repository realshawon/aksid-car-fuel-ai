import { NextRequest, NextResponse } from 'next/server';

const GITHUB_OWNER  = 'realshawon';
const GITHUB_REPO   = 'aksid-car-fuel-ai';
const DATA_PATH     = 'public/fuel-data.json';

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'aksid-car-fuel-ai/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id     = searchParams.get('id');     // submittedAt timestamp
  const action = searchParams.get('action') || 'approve'; // approve | reject
  const token  = process.env.GITHUB_TOKEN;

  if (!id) return html('Missing submission ID.', '❌ Error', '#e53e3e');
  if (!token) return html('Server configuration error (no GitHub token).', '❌ Error', '#e53e3e');

  const apiBase = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents`;

  // 1. GET current fuel-data.json
  const getRes = await fetch(`${apiBase}/${DATA_PATH}`, {
    headers: ghHeaders(token),
    cache: 'no-store',
  });
  if (!getRes.ok) return html('Could not load data from GitHub.', '❌ Error', '#e53e3e');

  const fileData = await getRes.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fuelData = JSON.parse(Buffer.from(fileData.content, 'base64').toString('utf8')) as { rows: any[]; updated: string; count: number };

  // 2. Find the matching row
  const idx = fuelData.rows.findIndex((r: any) => r.submittedAt === id);
  if (idx === -1) {
    return html(`No submission found with ID: ${id}`, '❌ Not Found', '#e53e3e');
  }

  const row = fuelData.rows[idx];
  const prevStatus = row.status;

  // 3. Already actioned?
  if (prevStatus === 'Approved' || prevStatus === 'Rejected') {
    return html(
      `This submission by <strong>${row.driver}</strong> on <strong>${row.date}</strong> was already <strong>${prevStatus}</strong>.`,
      `ℹ️ Already ${prevStatus}`,
      prevStatus === 'Approved' ? '#38a169' : '#e53e3e'
    );
  }

  // 4. Update status
  const newStatus = action === 'reject' ? 'Rejected' : 'Approved';
  fuelData.rows[idx].status = newStatus;
  fuelData.rows[idx].actionedAt = new Date().toISOString();
  fuelData.updated = new Date().toISOString();

  // 5. Commit updated file
  const newContent = Buffer.from(JSON.stringify(fuelData, null, 2)).toString('base64');
  const putRes = await fetch(`${apiBase}/${DATA_PATH}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify({
      message: `${newStatus.toLowerCase()}: ${row.driver} submission ${new Date().toISOString().slice(0,10)}`,
      content: newContent,
      sha: fileData.sha,
    }),
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    return html(`Failed to update: ${err.slice(0,200)}`, '❌ Error', '#e53e3e');
  }

  const color  = newStatus === 'Approved' ? '#38a169' : '#e53e3e';
  const icon   = newStatus === 'Approved' ? '✅' : '❌';
  const detail = `
    <p style="color:#555;margin:12px 0 4px"><strong>Driver:</strong> ${row.driver}</p>
    <p style="color:#555;margin:4px 0"><strong>Date:</strong> ${row.date}</p>
    <p style="color:#555;margin:4px 0"><strong>Total:</strong> Tk ${(+row.total).toLocaleString()}</p>
    <p style="color:#555;margin:4px 0"><strong>Department:</strong> ${row.dept}</p>
  `;

  return html(detail, `${icon} Submission ${newStatus}`, color);
}

function html(body: string, title: string, color: string): NextResponse {
  return new NextResponse(
    `<!DOCTYPE html><html><head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} - AKSID</title>
    <style>
      body{font-family:'Segoe UI',sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
      .card{background:white;border-radius:12px;padding:40px 48px;max-width:480px;width:90%;box-shadow:0 4px 20px rgba(0,0,0,.1);text-align:center}
      h1{color:${color};font-size:24px;margin:0 0 16px}
      p{color:#555;line-height:1.6;margin:8px 0}
      .badge{display:inline-block;background:${color};color:white;padding:6px 18px;border-radius:20px;font-weight:700;font-size:14px;margin-top:16px}
      .link{display:inline-block;margin-top:24px;padding:10px 24px;background:#0078d4;color:white;text-decoration:none;border-radius:6px;font-weight:600}
    </style></head><body>
    <div class="card">
      <h1>${title}</h1>
      <div>${body}</div>
      <span class="badge">${title.replace(/[✅❌ℹ️]/g,'').trim()}</span><br>
      <a class="link" href="https://aksid-car-fuel-ai.vercel.app/dashboard.html">View Dashboard</a>
    </div>
    </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
