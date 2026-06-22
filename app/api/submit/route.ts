import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MAKE_WEBHOOK = process.env.MAKE_WEBHOOK_URL || 'https://hook.eu1.make.com/3p84j4bc467u06fgnwp8p8n95w4rvfwf';

const DRIVER_LIST = {
  'Sumon Khan':    { department: 'Management Expense',        id: '150400004' },
  'Md Hanif':      { department: 'Foreign Project Department', id: '160900038' },
  'Mohammad Islam':{ department: 'Project Sales',             id: '171200235' },
  'Md Sabuz Miah': { department: 'Corporate Sales',           id: '181000333' },
  'Md Masud Rana': { department: 'Technical Engineering',     id: '230100883' },
  'Shaha Alom':    { department: 'Retail Sales',              id: '240301028' },
  'Shahidul Islam':{ department: 'Human Resource',            id: 'N/A'       },
  'Md. Liton':     { department: 'Administration',            id: '240111115' },
  'Md Liton':      { department: 'Administration',            id: '240111115' },
};

function matchDriver(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  for (const [key, val] of Object.entries(DRIVER_LIST)) {
    if (key.toLowerCase() === lower || key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
      return { name: key, ...val };
    }
  }
  return null;
}

async function extractFromImage(base64, mediaType) {
  const PROMPT = `Extract data from this AKSID fuel bill document (English or Bengali).
Identify type: FUEL_RECEIPT | TOLL | FOOD_BILL | MAINTENANCE | PARKING | HOTEL | POLICE_FINE | DRIVER_LOG | FUEL_BILL_SUMMARY | FUND_REQUISITION | UNKNOWN
Return ONLY valid JSON:
{
  "bill_type": "...",
  "date": "YYYY-MM-DD or null",
  "driver_name": null,
  "vehicle_no": null,
  "amounts": {"fuel_cost":null,"toll":null,"food_bill":null,"maintenance":null,"car_parking":null,"hotel":null,"police_fine":null,"others":null},
  "km": {"start":null,"end":null},
  "confidence": "HIGH|MEDIUM|LOW",
  "notes": ""
}`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 600,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: PROMPT },
    ]}],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? JSON.parse(json) : null;
  } catch { return null; }
}

export async function POST(request) {
  try {
    const formData = await request.formData();
    const driverName    = formData.get('driver_name');
    const vehicleNo     = formData.get('vehicle_no');
    const date          = formData.get('date');
    const billPeriodFrom = formData.get('bill_period_from');
    const billPeriodTo   = formData.get('bill_period_to');

    const imageFiles = [];
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('image_') && value instanceof Blob) {
        const buf    = await value.arrayBuffer();
        const base64 = Buffer.from(buf).toString('base64');
        imageFiles.push({ base64, mediaType: value.type || 'image/jpeg', name: (value as File).name || key });
      }
    }

    if (imageFiles.length === 0) {
      return NextResponse.json({ error: 'No images provided' }, { status: 400 });
    }

    // Process in batches of 5
    const results = [];
    for (let i = 0; i < imageFiles.length; i += 5) {
      const batch        = imageFiles.slice(i, i + 5);
      const batchResults = await Promise.all(batch.map(img => extractFromImage(img.base64, img.mediaType)));
      results.push(...batchResults);
    }

    const valid        = results.filter(Boolean);
    const recognized   = valid.filter(r => r.bill_type !== 'UNKNOWN' && r.confidence !== 'LOW');
    const unrecognized = valid.filter(r => r.bill_type === 'UNKNOWN' || r.confidence === 'LOW');
    const sum = (field) => recognized.reduce((s, d) => s + (d?.amounts?.[field] ?? 0), 0) || null;

    const billBreakdown = recognized.reduce((acc, r) => {
      acc[r.bill_type] = (acc[r.bill_type] || 0) + 1; return acc;
    }, {});

    const resolvedDate       = date       || valid.find(d => d?.date)?.date             || new Date().toISOString().split('T')[0];
    const resolvedDriverName = driverName || valid.find(d => d?.driver_name)?.driver_name || null;
    const resolvedVehicleNo  = vehicleNo  || valid.find(d => d?.vehicle_no)?.vehicle_no  || null;
    const kmStart  = valid.find(d => d?.km?.start)?.km?.start ?? null;
    const kmEnd    = valid.find(d => d?.km?.end)?.km?.end     ?? null;
    const driverInfo = matchDriver(resolvedDriverName);

    const entry = {
      date:         resolvedDate,
      driver_name:  driverInfo?.name ?? resolvedDriverName,
      department:   driverInfo?.department ?? null,
      driver_id:    driverInfo?.id ?? null,
      km_start: kmStart, km_end: kmEnd,
      total_km: kmStart && kmEnd ? kmEnd - kmStart : null,
      fuel_cost:    sum('fuel_cost'),    toll:        sum('toll'),
      food_bill:    sum('food_bill'),    maintenance: sum('maintenance'),
      car_parking:  sum('car_parking'),  hotel:       sum('hotel'),
      police_fine:  sum('police_fine'),  others:      sum('others'),
      vehicle_no:   resolvedVehicleNo,
      bill_period_from: billPeriodFrom || resolvedDate,
      bill_period_to:   billPeriodTo   || resolvedDate,
      submission_timestamp: new Date().toISOString(),
      status: 'Pending Review',
    };

    const undetected = [];
    if (!entry.date)        undetected.push('Date');
    if (!entry.driver_name) undetected.push('Driver Name');
    if (!entry.vehicle_no)  undetected.push('Vehicle No');
    if (!entry.fuel_cost && !entry.toll && !entry.food_bill && !entry.maintenance && !entry.car_parking && !entry.hotel) {
      undetected.push('Bill amounts');
    }
    if (!driverInfo) undetected.push('Department');

    const makePayload = {
      source: 'web_form', entry, bill_breakdown: billBreakdown,
      total_images:        imageFiles.length,
      recognized_images:   recognized.length,
      unrecognized_images: unrecognized.length,
      unrecognized_details: unrecognized.map((r, i) => ({ image_number: i+1, bill_type: r.bill_type, confidence: r.confidence, notes: r.notes })),
      undetected_fields: undetected,
      needs_review: undetected.length > 0 || unrecognized.length > 0,
    };

    // Send to Make.com - awaited so Vercel does not terminate before webhook completes
    try {
      await fetch(MAKE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': process.env.WEBHOOK_SECRET || '' },
        body: JSON.stringify(makePayload),
      });
    } catch (webhookErr) {
      console.error('Make webhook error:', webhookErr);
    }

    return NextResponse.json({ success: true, entry, bill_breakdown: billBreakdown,
      total_images: imageFiles.length, recognized_images: recognized.length,
      unrecognized_images: unrecognized.length, undetected_fields: undetected,
      needs_review: makePayload.needs_review });

  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
