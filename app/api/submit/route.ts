import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const MAKE_WEBHOOK    = 'https://hook.eu1.make.com/3p84j4bc467u06fgnwp8p8n95w4rvfwf';
const NOTIFY_WEBHOOK  = 'https://hook.eu1.make.com/b4xi0ufnijukds9rmojq8aa3kjk1pvcz';
const GITHUB_OWNER  = 'realshawon';
const GITHUB_REPO   = 'aksid-car-fuel-ai';
const DATA_PATH     = 'public/fuel-data.json';
const ATTACH_FOLDER = 'attachments';
const RAW_BASE      = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main/${ATTACH_FOLDER}`;
const ADMIN_EMAIL   = 'shawon@aksidcorp.com';

// ── Helpers ───────────────────────────────────────────────────────────────

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
    const m = fileName.match(/\.(\w+)$/);
    if (m) return m[1].toLowerCase();
  }
  return mimeType.includes('pdf') ? 'pdf'
    : mimeType.includes('png') ? 'png'
    : mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg'
    : 'bin';
}

function isImage(mimeType: string, fileName: string): boolean {
  const ext = fileExt(mimeType, fileName);
  return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
}

function tk(n: number | null | undefined): string {
  if (!n) return '-';
  return 'Tk ' + n.toLocaleString('en-BD');
}

// ── AI Image Analysis ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function analyzeAttachment(
  base64: string,
  mimeType: string,
  docType: 'fuel_bill' | 'log_sheet'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<Record<string, any> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });

  const prompt = docType === 'fuel_bill'
    ? `You are analyzing a car expense document for AKSID Corporation Limited (Bangladesh).
The document may be in English or Bengali. It could be:
- A fuel/petrol receipt (amounts → fuel_cost)
- A toll receipt (amounts → toll)
- A food/meal bill (amounts → food_bill)
- A maintenance/repair receipt (amounts → maintenance)
- A parking receipt (amounts → car_parking)
- A hotel receipt (amounts → hotel)
- A police fine receipt (amounts → police_fine)
- Any other transport expense (amounts → others)

Extract all data you can see. Return ONLY valid JSON, no markdown:
{
  "bill_type": "FUEL_RECEIPT|TOLL|FOOD_BILL|MAINTENANCE|PARKING|HOTEL|POLICE_FINE|OTHERS|UNKNOWN",
  "date": "YYYY-MM-DD or null",
  "vehicle_no": "string or null",
  "station_name": "string or null",
  "amounts": {
    "fuel_cost": number_or_null,
    "toll": number_or_null,
    "food_bill": number_or_null,
    "maintenance": number_or_null,
    "car_parking": number_or_null,
    "hotel": number_or_null,
    "police_fine": number_or_null,
    "others": number_or_null
  },
  "confidence": "HIGH|MEDIUM|LOW",
  "cannot_read": ["list of fields that are unclear or missing"],
  "notes": "any extra relevant info"
}`
    : `You are analyzing a Driver Log Sheet for AKSID Corporation Limited (Bangladesh).
This is a handwritten or printed table showing daily KM readings and trips.
Extract ALL information visible. Return ONLY valid JSON, no markdown:
{
  "driver_name": "string or null",
  "vehicle_no": "string or null",
  "date": "YYYY-MM-DD or null",
  "km_start": number_or_null,
  "km_end": number_or_null,
  "total_km": number_or_null,
  "trips": [{"from": "string", "to": "string", "km": number}],
  "confidence": "HIGH|MEDIUM|LOW",
  "cannot_read": ["list of fields that are unclear or missing"],
  "notes": "extra info"
}`;

  try {
    const validType = mimeType.includes('png') ? 'image/png'
      : mimeType.includes('gif') ? 'image/gif'
      : mimeType.includes('webp') ? 'image/webp'
      : 'image/jpeg';

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: validType as 'image/jpeg'|'image/png'|'image/gif'|'image/webp', data: base64 },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? JSON.parse(json) : null;
  } catch (e) {
    console.error('[submit] AI analysis error:', e);
    return null;
  }
}

// ── GitHub Operations ─────────────────────────────────────────────────────

async function uploadToGitHub(
  token: string, filename: string, base64Content: string, label: string
): Promise<string> {
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${ATTACH_FOLDER}/${filename}`;
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify({
      message: `attach: ${label}`,
      content: base64Content,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub upload failed (${res.status}): ${err.slice(0, 200)}`);
  }
  return `${RAW_BASE}/${filename}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateFuelData(
  token: string, row: Record<string, any>
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
      message: `Add expense: ${row.driver} on ${row.date}`,
      content: Buffer.from(JSON.stringify(fuelData, null, 2)).toString('base64'),
      sha: fileData.sha,
    }),
  });
  if (!putRes.ok) return { ok: false, error: `GitHub PUT failed: ${putRes.status}` };
  return { ok: true };
}

// ── Email HTML Builder ────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildEmailHtml(
  row: Record<string, any>,
  fuelBillUrl: string,
  logSheetUrl: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fuelAnalysis: Record<string, any> | null,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logAnalysis: Record<string, any> | null,
  undetectedFields: string[],
  approveUrl: string,
  rejectUrl: string
): string {
  const warningBlock = undetectedFields.length > 0
    ? `<div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px 16px;margin:16px 0;border-radius:4px;">
        <strong>⚠ Fields that could NOT be auto-read from attachments:</strong><br>
        ${undetectedFields.map(f => `&bull; ${f}`).join('<br>')}
        <br><small>Please update the Excel file manually for these fields.</small>
      </div>` : '';

  const analysisBlock = fuelAnalysis
    ? `<h3 style="color:#1f4e79;margin:20px 0 8px">AI Analysis — Fuel Bill</h3>
       <table style="width:100%;border-collapse:collapse;font-size:13px">
         <tr><td style="padding:4px 8px;color:#555">Type Detected</td><td style="padding:4px 8px;font-weight:bold">${fuelAnalysis.bill_type ?? '-'}</td></tr>
         ${fuelAnalysis.station_name ? `<tr><td style="padding:4px 8px;color:#555">Station/Vendor</td><td style="padding:4px 8px">${fuelAnalysis.station_name}</td></tr>` : ''}
         <tr><td style="padding:4px 8px;color:#555">Confidence</td><td style="padding:4px 8px">${fuelAnalysis.confidence ?? '-'}</td></tr>
         ${fuelAnalysis.cannot_read && (fuelAnalysis.cannot_read as string[]).length > 0
           ? `<tr><td style="padding:4px 8px;color:#c00">Cannot Read</td><td style="padding:4px 8px;color:#c00">${(fuelAnalysis.cannot_read as string[]).join(', ')}</td></tr>`
           : ''}
         ${fuelAnalysis.notes ? `<tr><td style="padding:4px 8px;color:#555">Notes</td><td style="padding:4px 8px">${fuelAnalysis.notes}</td></tr>` : ''}
       </table>` : '';

  const logAnalysisBlock = logAnalysis
    ? `<h3 style="color:#1f4e79;margin:20px 0 8px">AI Analysis — Driver Log Sheet</h3>
       <table style="width:100%;border-collapse:collapse;font-size:13px">
         <tr><td style="padding:4px 8px;color:#555">Driver (from log)</td><td style="padding:4px 8px;font-weight:bold">${logAnalysis.driver_name ?? '-'}</td></tr>
         <tr><td style="padding:4px 8px;color:#555">Vehicle No (from log)</td><td style="padding:4px 8px">${logAnalysis.vehicle_no ?? '-'}</td></tr>
         <tr><td style="padding:4px 8px;color:#555">KM Start</td><td style="padding:4px 8px">${logAnalysis.km_start ?? '-'}</td></tr>
         <tr><td style="padding:4px 8px;color:#555">KM End</td><td style="padding:4px 8px">${logAnalysis.km_end ?? '-'}</td></tr>
         <tr><td style="padding:4px 8px;color:#555">Total KM</td><td style="padding:4px 8px">${logAnalysis.total_km ?? '-'}</td></tr>
         <tr><td style="padding:4px 8px;color:#555">Confidence</td><td style="padding:4px 8px">${logAnalysis.confidence ?? '-'}</td></tr>
         ${logAnalysis.cannot_read && (logAnalysis.cannot_read as string[]).length > 0
           ? `<tr><td style="padding:4px 8px;color:#c00">Cannot Read</td><td style="padding:4px 8px;color:#c00">${(logAnalysis.cannot_read as string[]).join(', ')}</td></tr>`
           : ''}
       </table>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;color:#333">
  <div style="background:#1f4e79;padding:20px 24px;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;margin:0;font-size:20px">AKSID Corporation — Transport Expense Submission</h1>
    <p style="color:#cde;margin:4px 0 0;font-size:13px">Submitted on ${new Date().toLocaleString('en-BD', {timeZone:'Asia/Dhaka'})}</p>
  </div>

  <div style="background:#f8f9fa;padding:20px 24px">
    ${warningBlock}

    <h2 style="color:#1f4e79;margin:0 0 16px;font-size:16px">Submission Details</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="background:#e8f0f8"><td style="padding:8px 12px;width:40%;font-weight:bold;color:#1f4e79">Driver Name</td><td style="padding:8px 12px">${row.driver}</td></tr>
      <tr><td style="padding:8px 12px;color:#555">Department</td><td style="padding:8px 12px">${row.dept}</td></tr>
      <tr style="background:#e8f0f8"><td style="padding:8px 12px;color:#555">Vehicle No</td><td style="padding:8px 12px">${row.vehicle || '-'}</td></tr>
      <tr><td style="padding:8px 12px;color:#555">Date</td><td style="padding:8px 12px">${row.date}</td></tr>
      <tr style="background:#e8f0f8"><td style="padding:8px 12px;color:#555">Bill Period</td><td style="padding:8px 12px">${row.billFrom || '-'} to ${row.billTo || '-'}</td></tr>
      <tr><td style="padding:8px 12px;color:#555">Odometer Start</td><td style="padding:8px 12px">${row.kmStart || '-'} km</td></tr>
      <tr style="background:#e8f0f8"><td style="padding:8px 12px;color:#555">Odometer End</td><td style="padding:8px 12px">${row.kmEnd || '-'} km</td></tr>
      <tr><td style="padding:8px 12px;color:#555">Total KM</td><td style="padding:8px 12px"><strong>${row.km || '-'} km</strong></td></tr>
    </table>

    <h2 style="color:#1f4e79;margin:20px 0 12px;font-size:16px">Expense Breakdown</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="background:#1f4e79"><th style="padding:8px 12px;color:#fff;text-align:left">Expense Type</th><th style="padding:8px 12px;color:#fff;text-align:right">Amount</th></tr>
      <tr><td style="padding:7px 12px">Fuel Cost</td><td style="padding:7px 12px;text-align:right">${tk(row.fuel as number)}</td></tr>
      <tr style="background:#e8f0f8"><td style="padding:7px 12px">Toll</td><td style="padding:7px 12px;text-align:right">${tk(row.toll as number)}</td></tr>
      <tr><td style="padding:7px 12px">Food Bill</td><td style="padding:7px 12px;text-align:right">${tk(row.food as number)}</td></tr>
      <tr style="background:#e8f0f8"><td style="padding:7px 12px">Maintenance</td><td style="padding:7px 12px;text-align:right">${tk(row.maintenance as number)}</td></tr>
      <tr><td style="padding:7px 12px">Car Parking</td><td style="padding:7px 12px;text-align:right">${tk(row.parking as number)}</td></tr>
      <tr style="background:#e8f0f8"><td style="padding:7px 12px">Hotel</td><td style="padding:7px 12px;text-align:right">${tk(row.hotel as number)}</td></tr>
      <tr><td style="padding:7px 12px">Police Fine</td><td style="padding:7px 12px;text-align:right">${tk(row.fine as number)}</td></tr>
      <tr style="background:#e8f0f8"><td style="padding:7px 12px">Others</td><td style="padding:7px 12px;text-align:right">${tk(row.others as number)}</td></tr>
      <tr style="background:#1f4e79"><td style="padding:10px 12px;color:#fff;font-weight:bold">GRAND TOTAL</td><td style="padding:10px 12px;color:#fff;font-weight:bold;text-align:right">${tk(row.total as number)}</td></tr>
    </table>

    ${row.remarks ? `<p style="margin:16px 0 0"><strong>Remarks:</strong> ${row.remarks}</p>` : ''}

    <h2 style="color:#1f4e79;margin:20px 0 12px;font-size:16px">Attached Documents</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr>
        <td style="padding:8px 12px">
          <strong>Fuel Bill</strong><br>
          ${fuelBillUrl
            ? `<a href="${fuelBillUrl}" style="color:#1f4e79">View Attachment</a>`
            : '<span style="color:#c00">Not uploaded</span>'}
        </td>
        <td style="padding:8px 12px">
          <strong>Driver Log Sheet</strong><br>
          ${logSheetUrl
            ? `<a href="${logSheetUrl}" style="color:#1f4e79">View Attachment</a>`
            : '<span style="color:#c00">Not uploaded</span>'}
        </td>
      </tr>
    </table>

    ${analysisBlock}
    ${logAnalysisBlock}

    <div style="margin-top:24px;padding:12px 16px;background:#e8f0f8;border-radius:4px;font-size:12px;color:#555">
      <strong>Status:</strong> Pending Review &nbsp;|&nbsp;
      <strong>Submitted:</strong> ${new Date().toISOString()} &nbsp;|&nbsp;
      <a href="https://aksid-car-fuel-ai.vercel.app/dashboard.html" style="color:#1f4e79">View Dashboard</a>
    </div>

    <div style="margin-top:28px;text-align:center;padding:20px 0;border-top:1px solid #dde3eb">
      <p style="margin:0 0 16px;font-size:14px;color:#555;font-weight:600">Quick Approval Action</p>
      <a href="${approveUrl}"
         style="display:inline-block;padding:12px 32px;background:#38a169;color:white;text-decoration:none;border-radius:6px;font-weight:700;font-size:15px;margin-right:12px">
        ✅ Approve
      </a>
      <a href="${rejectUrl}"
         style="display:inline-block;padding:12px 32px;background:#e53e3e;color:white;text-decoration:none;border-radius:6px;font-weight:700;font-size:15px">
        ❌ Reject
      </a>
      <p style="margin:12px 0 0;font-size:11px;color:#999">Clicking will immediately update the dashboard status.</p>
    </div>
  </div>
</body></html>`;
}

// ── Main API Handler ──────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const payload     = await request.json();
    const token       = process.env.GITHUB_TOKEN ?? '';

    const dateStr     = (payload.date as string) || new Date().toISOString().split('T')[0];
    const submittedAt = (payload.submittedAt as string) || new Date().toISOString();
    const driverSlug  = safeSlug(payload.driver ?? 'unknown');
    const dateSlug    = dateStr; // YYYY-MM-DD

    // ── AI Analysis of image attachments ────────────────────────────────
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let fuelAnalysis: Record<string, any> | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let logAnalysis:  Record<string, any> | null = null;
    const undetectedFields: string[] = [];

    // Normalise fuel bill files: accept new array format or old single-file format
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fuelBillFiles: Array<{ name: string; type: string; base64: string }> =
      Array.isArray(payload.fuelBillFiles) && payload.fuelBillFiles.length > 0
        ? payload.fuelBillFiles
        : payload.fuelBillBase64
          ? [{ name: payload.fuelBillFileName ?? 'fuel.jpg', type: payload.fuelBillType ?? 'image/jpeg', base64: payload.fuelBillBase64 }]
          : [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fuelAnalyses: Array<Record<string, any> | null> = [];
    for (let i = 0; i < fuelBillFiles.length; i++) {
      const fb = fuelBillFiles[i];
      const label = fuelBillFiles.length > 1 ? `Receipt ${i + 1} (${fb.name})` : 'Fuel Bill';
      if (isImage(fb.type, fb.name)) {
        const analysis = await analyzeAttachment(fb.base64, fb.type, 'fuel_bill');
        if (!analysis) {
          undetectedFields.push(`${label} — could not analyze image (AI unavailable or read error)`);
        } else if (analysis.cannot_read && (analysis.cannot_read as string[]).length > 0) {
          (analysis.cannot_read as string[]).forEach((f: string) =>
            undetectedFields.push(`${label} — ${f}`)
          );
        }
        fuelAnalyses.push(analysis);
      } else {
        undetectedFields.push(`${label} is a PDF — auto-analysis not available, please review manually`);
        fuelAnalyses.push(null);
      }
    }

    // Use first successful analysis for bill_type / confidence metadata
    fuelAnalysis = fuelAnalyses.find(a => a !== null) ?? null;

    // Helper: sum a numeric field across all fuel analyses
    const sumFuel = (field: string): number =>
      fuelAnalyses.reduce((acc, a) => acc + (+(a?.amounts?.[field] ?? 0)), 0);

    if (payload.logSheetBase64 && isImage(payload.logSheetType ?? '', payload.logSheetFileName ?? '')) {
      logAnalysis = await analyzeAttachment(payload.logSheetBase64, payload.logSheetType ?? 'image/jpeg', 'log_sheet');
      if (!logAnalysis) {
        undetectedFields.push('Log Sheet — could not analyze image (AI unavailable or read error)');
      } else if (logAnalysis.cannot_read && (logAnalysis.cannot_read as string[]).length > 0) {
        (logAnalysis.cannot_read as string[]).forEach((f: string) =>
          undetectedFields.push(`Log Sheet — ${f}`)
        );
      }
    } else if (payload.logSheetBase64) {
      undetectedFields.push('Driver Log Sheet is a PDF — auto-analysis not available, please review manually');
    }

    // Auto-fill missing values from AI analysis
    const aiKmStart = logAnalysis?.km_start ?? null;
    const aiKmEnd   = logAnalysis?.km_end   ?? null;
    const aiVehicle = (logAnalysis?.vehicle_no ?? fuelAnalysis?.vehicle_no ?? null) as string | null;

    // ── Upload attachments to GitHub with descriptive names ──────────────
    const fuelBillUrls: string[] = [];
    let logSheetUrl = '';

    for (let i = 0; i < fuelBillFiles.length; i++) {
      const fb = fuelBillFiles[i];
      if (token) {
        try {
          const ext    = fileExt(fb.type, fb.name);
          const suffix = fuelBillFiles.length > 1 ? `_${i + 1}` : '';
          const name   = `${driverSlug}_${dateSlug}_FuelBill${suffix}.${ext}`;
          const url    = await uploadToGitHub(token, name, fb.base64,
            `${payload.driver} – Fuel Bill${suffix} – ${formatDate(dateStr)}`);
          fuelBillUrls.push(url);
        } catch (e) {
          console.error('[submit] fuelBill upload failed:', e);
          undetectedFields.push(`Fuel Bill ${fuelBillFiles.length > 1 ? i + 1 + ' ' : ''}attachment — upload to GitHub failed`);
        }
      }
    }
    const fuelBillUrl = fuelBillUrls[0] ?? '';

    if (token && payload.logSheetBase64) {
      try {
        const ext  = fileExt(payload.logSheetType ?? '', payload.logSheetFileName ?? '');
        // Name: DriverName_YYYY-MM-DD_DriverLogSheet.ext
        const name = `${driverSlug}_${dateSlug}_DriverLogSheet.${ext}`;
        logSheetUrl = await uploadToGitHub(token, name, payload.logSheetBase64,
          `${payload.driver} – Driver Log Sheet – ${formatDate(dateStr)}`);
      } catch (e) {
        console.error('[submit] logSheet upload failed:', e);
        undetectedFields.push('Driver Log Sheet attachment — upload to GitHub failed');
      }
    }

    // ── Build fuel-data.json row ─────────────────────────────────────────
    const kmStart = +(payload.kmStart ?? aiKmStart ?? 0);
    const kmEnd   = +(payload.kmEnd   ?? aiKmEnd   ?? 0);
    const km      = +(payload.km ?? (kmEnd > kmStart ? kmEnd - kmStart : 0));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row: Record<string, any> = {
      date:        formatDate(dateStr),
      _dateStr:    dateStr,
      _dateNum:    new Date(dateStr + 'T00:00:00Z').getTime(),
      submittedAt,
      driver:      payload.driver      ?? '',
      dept:        payload.dept        ?? '',
      vehicle:     payload.vehicle     || aiVehicle || '',
      kmStart,
      kmEnd,
      km,
      fuel:        +(payload.fuel        ?? sumFuel('fuel_cost')    ?? 0),
      toll:        +(payload.toll        ?? sumFuel('toll')          ?? 0),
      food:        +(payload.food        ?? sumFuel('food_bill')     ?? 0),
      maintenance: +(payload.maintenance ?? sumFuel('maintenance')   ?? 0),
      parking:     +(payload.parking     ?? sumFuel('car_parking')   ?? 0),
      hotel:       +(payload.hotel       ?? sumFuel('hotel')         ?? 0),
      fine:        +(payload.fine        ?? sumFuel('police_fine')   ?? 0),
      others:      +(payload.others      ?? sumFuel('others')        ?? 0),
      total:       +(payload.total     ?? 0),
      month:       payload.month       ?? '',
      billFrom:    payload.billPeriodFrom ?? '',
      billTo:      payload.billPeriodTo   ?? '',
      status:      'Pending Review',
      remarks:     payload.notes       ?? '',
      fuelBillUrl,
      fuelBillUrls,
      logSheetUrl,
      // AI analysis metadata
      aiAnalyzed:         !!(fuelAnalysis || logAnalysis),
      fuelBillType:       fuelAnalysis?.bill_type ?? null,
      aiConfidence:       fuelAnalysis?.confidence ?? logAnalysis?.confidence ?? null,
      undetectedFields:   undetectedFields.length > 0 ? undetectedFields : null,
      needsManualReview:  undetectedFields.length > 0,
    };

    // Recalc total if not provided
    if (!row.total || row.total === 0) {
      row.total = (row.fuel as number)
        + (row.toll as number) + (row.food as number)
        + (row.maintenance as number) + (row.parking as number)
        + (row.hotel as number) + (row.fine as number)
        + (row.others as number);
    }

    // ── Update fuel-data.json on GitHub ──────────────────────────────────
    let dashboardUpdated = false;
    if (token) {
      try {
        const result = await updateFuelData(token, row);
        dashboardUpdated = result.ok;
        if (!result.ok) console.error('[submit] fuel-data update failed:', result.error);
      } catch (e) {
        console.error('[submit] fuel-data update threw:', e);
      }
    }

    // ── Build approval URLs ──────────────────────────────────────────────
    const BASE_URL   = 'https://aksid-car-fuel-ai.vercel.app';
    const approveUrl = `${BASE_URL}/api/approve?id=${encodeURIComponent(submittedAt)}&action=approve`;
    const rejectUrl  = `${BASE_URL}/api/approve?id=${encodeURIComponent(submittedAt)}&action=reject`;

    // ── Build rich Make.com payload (Excel + OneDrive + Email) ───────────
    const emailHtml = buildEmailHtml(row, fuelBillUrl, logSheetUrl, fuelAnalysis, logAnalysis, undetectedFields, approveUrl, rejectUrl);

    const makePayload = {
      // Core submission data
      ...payload,
      // Resolved values (may differ from raw form if AI filled gaps)
      resolved_driver:      row.driver,
      resolved_dept:        row.dept,
      resolved_vehicle:     row.vehicle,
      resolved_date:        row.date,
      resolved_km_start:    row.kmStart,
      resolved_km_end:      row.kmEnd,
      resolved_km:          row.km,
      resolved_fuel:        row.fuel,
      resolved_toll:        row.toll,
      resolved_food:        row.food,
      resolved_maintenance: row.maintenance,
      resolved_parking:     row.parking,
      resolved_hotel:       row.hotel,
      resolved_fine:        row.fine,
      resolved_others:      row.others,
      resolved_total:       row.total,
      // Attachment info
      fuel_bill_url:    fuelBillUrl,
      fuel_bill_urls:   fuelBillUrls,
      log_sheet_url:    logSheetUrl,
      fuel_bill_name:   fuelBillUrl ? fuelBillUrl.split('/').pop() : null,
      fuel_bill_names:  fuelBillUrls.map(u => u.split('/').pop()),
      log_sheet_name:   logSheetUrl ? logSheetUrl.split('/').pop() : null,
      // AI analysis
      ai_analyzed:      row.aiAnalyzed,
      ai_fuel_type:     row.fuelBillType,
      ai_confidence:    row.aiConfidence,
      undetected_fields: undetectedFields,
      needs_manual_review: row.needsManualReview,
      // Email
      email_to:         ADMIN_EMAIL,
      email_subject:    `[AKSID Fuel] New Submission — ${row.driver} — ${row.date}${undetectedFields.length > 0 ? ' ⚠ NEEDS REVIEW' : ''}`,
      email_html:       emailHtml,
      // Excel row data (flat, for Make.com to write directly)
      excel_row: {
        date:           row.date,
        driver_name:    row.driver,
        department:     row.dept,
        vehicle_no:     row.vehicle,
        bill_from:      row.billFrom,
        bill_to:        row.billTo,
        km_start:       row.kmStart,
        km_end:         row.kmEnd,
        total_km:       row.km,
        fuel_cost:      row.fuel,
        toll:           row.toll,
        food_bill:      row.food,
        maintenance:    row.maintenance,
        car_parking:    row.parking,
        hotel:          row.hotel,
        police_fine:    row.fine,
        others:         row.others,
        grand_total:    row.total,
        month:          row.month,
        submitted_at:   row.submittedAt,
        fuel_bill_url:  fuelBillUrls.join(' | '),
        log_sheet_url:  logSheetUrl,
        ai_analyzed:    row.aiAnalyzed ? 'Yes' : 'No',
        needs_review:   row.needsManualReview ? 'Yes — ' + undetectedFields.join(' | ') : 'No',
        status:         'Pending Review',
      },
      // OneDrive folder target
      onedrive_folder_name: `${dateStr}_${driverSlug}`,
      // Approval links (click in email to approve/reject)
      approve_url: approveUrl,
      reject_url:  rejectUrl,
    };

    // Fire-and-forget to Make.com (SharePoint + WhatsApp)
    fetch(MAKE_WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(makePayload),
    }).catch(err => console.error('[submit] Make.com error:', err));

    // Fire-and-forget to Notify webhook → sends Outlook email with approve/reject buttons
    fetch(NOTIFY_WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        to:            ADMIN_EMAIL,
        email_subject: makePayload.email_subject,
        email_html:    emailHtml,
        bcc:           '',
      }),
    }).catch(err => console.error('[submit] Notify webhook error:', err));

    return NextResponse.json({
      success: true,
      dashboardUpdated,
      fuelBillUrl,
      fuelBillUrls,
      logSheetUrl,
      aiAnalyzed:      !!(fuelAnalysis || logAnalysis),
      undetectedFields,
      needsManualReview: undetectedFields.length > 0,
      message: dashboardUpdated
        ? 'Submission received, dashboard updated, and notifications sent.'
        : 'Submission received. Dashboard update in progress.',
    });

  } catch (err) {
    console.error('[submit] Unhandled error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
