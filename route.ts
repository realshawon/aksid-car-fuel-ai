import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// AKSID Driver roster — matches "List" sheet in Excel
const DRIVER_LIST: Record<string, { department: string; id: string }> = {
  'Sumon Khan':      { department: 'Management Expense',           id: '150400004' },
  'Md Hanif':        { department: 'Foreign Project Department',    id: '160900038' },
  'Mohammad Islam':  { department: 'Project Sales',                 id: '171200235' },
  'Md Sabuz Miah':   { department: 'Corporate Sales',               id: '181000333' },
  'Md Masud Rana':   { department: 'Technical Engineering',         id: '230100883' },
  'Shaha Alom':      { department: 'Retail Sales',                  id: '240301028' },
  'Shahidul Islam':  { department: 'Human Resource',                id: 'N/A'       },
  'Md. Liton':       { department: 'Administration',                id: '240111115' },
  'Md Liton':        { department: 'Administration',                id: '240111115' },
};

// Fuzzy-match driver name from the list
function matchDriver(name: string | null) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  for (const [key, val] of Object.entries(DRIVER_LIST)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase().split(' ')[1] ?? '')) {
      return { name: key, ...val };
    }
  }
  return null;
}

// Convert any image URL to base64
async function urlToBase64(url: string): Promise<{ base64: string; mediaType: string }> {
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const base64 = Buffer.from(buf).toString('base64');
  const mediaType = res.headers.get('content-type') ?? 'image/jpeg';
  return { base64, mediaType };
}

// Claude Vision extraction for one image
async function extractFromImage(base64: string, mediaType: string) {
  const PROMPT = `You are an AI assistant extracting structured data from AKSID Corporation car fuel bill documents.
The documents may be in English or Bengali. Types you may see:
  1. Fuel receipt (gas station – Jamuna/Padma/Shell etc.) → amounts go to fuel_cost
  2. Toll receipt (Dhaka Elevated Expressway, etc.) → amounts go to toll
  3. Food bill / Fund Requisition Slip → amounts go to food_bill (transport bill → others)
  4. Driver Log (handwritten table) → extract km_start, km_end, vehicle_no, driver_name, date
  5. Car Fuel Bill Summary form → extract all columns
  6. Parking receipt → car_parking
  7. Hotel receipt → hotel
  8. Police fine → police_fine
  9. Maintenance/repair → maintenance

Return ONLY valid JSON (no markdown, no extra text):
{
  "bill_type": "FUEL_RECEIPT|TOLL|FOOD_BILL|MAINTENANCE|PARKING|HOTEL|POLICE_FINE|DRIVER_LOG|FUEL_BILL_SUMMARY|FUND_REQUISITION|UNKNOWN",
  "date": "YYYY-MM-DD or null",
  "driver_name": "string or null",
  "vehicle_no": "string or null",
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
  "km": { "start": number_or_null, "end": number_or_null },
  "confidence": "HIGH|MEDIUM|LOW",
  "undetected_fields": [],
  "notes": "any extra info"
}
Numbers without currency symbols. Null when you cannot read it clearly.`;

  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 800,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 },
        },
        { type: 'text', text: PROMPT },
      ],
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    return json ? JSON.parse(json) : null;
  } catch {
    console.error('Parse error:', text);
    return null;
  }
}

// ── Main API handler ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    // Verify webhook secret
    const secret = request.headers.get('x-webhook-secret');
    if (process.env.WEBHOOK_SECRET && secret !== process.env.WEBHOOK_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      image_urls = [],   // Array of public image URLs (from Make.com)
      driver_name,       // Text sent by driver
      date,              // Date sent by driver (DD/MM/YYYY or YYYY-MM-DD)
      bill_period_from,
      bill_period_to,
      vehicle_no,
    } = body;

    if (!image_urls.length) {
      return NextResponse.json({ error: 'No image_urls provided' }, { status: 400 });
    }

    // Process all images in parallel
    const extractions = await Promise.all(
      image_urls.map(async (url: string) => {
        const { base64, mediaType } = await urlToBase64(url);
        return extractFromImage(base64, mediaType);
      })
    );

    const valid = extractions.filter(Boolean);

    // Consolidate amounts from all images
    const sumAmounts = (field: string) =>
      valid.reduce((s: number, d: any) => s + (d?.amounts?.[field] ?? 0), 0) || null;

    const resolvedDate =
      date ||
      valid.find((d: any) => d?.date)?.date ||
      null;

    const resolvedDriverName =
      driver_name ||
      valid.find((d: any) => d?.driver_name)?.driver_name ||
      null;

    const resolvedVehicleNo =
      vehicle_no ||
      valid.find((d: any) => d?.vehicle_no)?.vehicle_no ||
      null;

    const kmStart = valid.find((d: any) => d?.km?.start)?.km?.start ?? null;
    const kmEnd   = valid.find((d: any) => d?.km?.end)?.km?.end   ?? null;

    // Driver lookup
    const driverInfo = matchDriver(resolvedDriverName);

    // Build the "File Entry" row
    const entry = {
      date:                resolvedDate,
      driver_name:         driverInfo?.name ?? resolvedDriverName,
      department:          driverInfo?.department ?? null,
      driver_id:           driverInfo?.id ?? null,
      km_start:            kmStart,
      km_end:              kmEnd,
      total_km:            kmStart && kmEnd ? kmEnd - kmStart : null,
      fuel_cost:           sumAmounts('fuel_cost'),
      toll:                sumAmounts('toll'),
      food_bill:           sumAmounts('food_bill'),
      maintenance:         sumAmounts('maintenance'),
      car_parking:         sumAmounts('car_parking'),
      hotel:               sumAmounts('hotel'),
      police_fine:         sumAmounts('police_fine'),
      others:              sumAmounts('others'),
      vehicle_no:          resolvedVehicleNo,
      bill_period_from:    bill_period_from ?? null,
      bill_period_to:      bill_period_to   ?? null,
      submission_timestamp: new Date().toISOString(),
      status:              'Pending Review',
    };

    // Identify missing required fields
    const undetected: string[] = [];
    if (!entry.date)        undetected.push('Date');
    if (!entry.driver_name) undetected.push('Driver Name');
    if (!entry.vehicle_no)  undetected.push('Vehicle No');
    if (
      !entry.fuel_cost && !entry.toll && !entry.food_bill &&
      !entry.maintenance && !entry.car_parking && !entry.hotel
    ) undetected.push('Bill amounts (could not read any amount)');
    if (!driverInfo)        undetected.push('Department (driver not in roster)');

    return NextResponse.json({
      success: true,
      entry,
      raw_extractions: valid,
      undetected_fields: undetected,
      needs_review: undetected.length > 0,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
